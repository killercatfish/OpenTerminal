import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The real app (real mount order, real requireApiKey) on an ephemeral port.
// Only calls to Alpaca are mocked; calls to the test server use the real fetch.
const API_KEY = "test-api-key";
const realFetch = globalThis.fetch;
let tmpDir: string;
let server: Server;
let base: string;
let marketRouter: (typeof import("./market.js"))["marketRouter"];
let ALPACA_PAPER_BASE: string;

const ACCOUNT = {
  status: "ACTIVE",
  currency: "USD",
  equity: "1010.50",
  last_equity: "1000.00",
  cash: "10.50",
  buying_power: "21.00",
};
const POSITIONS = [
  {
    symbol: "SPY",
    qty: "1.5",
    side: "long",
    avg_entry_price: "600",
    current_price: "610",
    market_value: "915",
    unrealized_pl: "15",
    unrealized_plpc: "0.0166667",
  },
];
const ORDERS = Array.from({ length: 30 }, (_, i) => ({
  id: `o${i}`,
  symbol: "SPY",
  side: i % 2 ? "sell" : "buy",
  type: "market",
  qty: "1",
  notional: null,
  filled_qty: "1",
  filled_avg_price: "600.25",
  status: "filled",
  submitted_at: "2026-10-07T14:30:00Z",
  filled_at: "2026-10-07T14:30:01Z",
}));

const fakeAlpaca = async (input: string | URL | Request, _init?: RequestInit) => {
  const url = String(input);
  const path = url.slice(ALPACA_PAPER_BASE.length).split("?")[0];
  const body = { "/v2/account": ACCOUNT, "/v2/positions": POSITIONS, "/v2/orders": ORDERS }[path];
  return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
};
const alpacaFetch = vi.fn(fakeAlpaca);

function alpacaCalls() {
  return alpacaFetch.mock.calls.filter(([u]) => String(u).includes("alpaca.markets"));
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "openterminal-alpaca-test-"));
  process.env.DATA_DIR = tmpDir;
  process.env.API_KEY = API_KEY;
  ({ ALPACA_PAPER_BASE } = await import("./alpaca.js"));
  ({ marketRouter } = await import("./market.js"));
  const { app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith(base) ? realFetch(input, init) : alpacaFetch(input, init)
  );
});

afterEach(() => {
  alpacaFetch.mockClear();
  alpacaFetch.mockImplementation(fakeAlpaca);
  vi.unstubAllEnvs();
});

afterAll(() => {
  vi.unstubAllGlobals();
  server.close();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.API_KEY;
});

const get = (headers: Record<string, string> = { "x-api-key": API_KEY }) =>
  fetch(`${base}/api/alpaca`, { headers });

describe("GET /api/alpaca", () => {
  it("is not shadowed by marketRouter, which is mounted on all of /api", () => {
    const match = (marketRouter as any).stack.find((l: any) => l.match("/alpaca") || l.match("/alpaca/"));
    expect(match).toBeUndefined();
  });

  it("requires the API key, before touching Alpaca", async () => {
    vi.stubEnv("ALPACA_KEY", "PKTEST");
    vi.stubEnv("ALPACA_SECRET", "secret");
    const res = await get({});
    expect(res.status).toBe(401);
    expect(alpacaCalls()).toHaveLength(0);
  });

  it("returns account, positions and the last 25 orders from the paper host, GETs only", async () => {
    vi.stubEnv("ALPACA_KEY", "PKTEST");
    vi.stubEnv("ALPACA_SECRET", "secret");
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.paper).toBe(true);
    expect(body.account).toMatchObject({ equity: 1010.5, lastEquity: 1000, cash: 10.5, status: "ACTIVE" });
    expect(body.account.dayPl).toBeCloseTo(10.5);
    expect(body.account.dayPlPct).toBeCloseTo(1.05);
    expect(body.positions).toEqual([
      expect.objectContaining({ symbol: "SPY", qty: 1.5, unrealizedPl: 15, currentPrice: 610 }),
    ]);
    expect(body.positions[0].unrealizedPlPct).toBeCloseTo(1.66667, 3);
    expect(body.orders).toHaveLength(25);
    expect(body.orders[0]).toMatchObject({ id: "o0", side: "buy", filledAvgPrice: 600.25, status: "filled" });

    const calls = alpacaCalls();
    expect(calls).toHaveLength(3);
    for (const [url, init] of calls) {
      expect(String(url).startsWith(`${ALPACA_PAPER_BASE}/v2/`)).toBe(true);
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>)["APCA-API-KEY-ID"]).toBe("PKTEST");
    }
    expect(calls.map(([u]) => String(u))).toContain(
      `${ALPACA_PAPER_BASE}/v2/orders?status=all&limit=25&direction=desc`
    );
  });

  it("refuses when ALPACA_PAPER=false, without calling Alpaca", async () => {
    vi.stubEnv("ALPACA_KEY", "PKTEST");
    vi.stubEnv("ALPACA_SECRET", "secret");
    vi.stubEnv("ALPACA_PAPER", "false");
    const res = await get();
    expect(res.status).toBe(503);
    expect(alpacaCalls()).toHaveLength(0);
  });

  it("says so when the keys are missing", async () => {
    vi.stubEnv("ALPACA_KEY", "");
    vi.stubEnv("ALPACA_SECRET", "");
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/ALPACA_KEY/);
  });

  it("maps rejected keys to 502 without echoing them", async () => {
    vi.stubEnv("ALPACA_KEY", "AKLIVE");
    vi.stubEnv("ALPACA_SECRET", "secret");
    alpacaFetch.mockImplementation(async () => new Response("{}", { status: 403 }));
    const res = await get();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toMatch(/PAPER keys/);
    expect(text).not.toMatch(/AKLIVE|secret/);
  });

  it("has no write routes: POST, PATCH and DELETE never reach Alpaca", async () => {
    vi.stubEnv("ALPACA_KEY", "PKTEST");
    vi.stubEnv("ALPACA_SECRET", "secret");
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
      const res = await fetch(`${base}/api/alpaca`, {
        method,
        headers: { "x-api-key": API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ symbol: "SPY", qty: 1, side: "buy" }),
      });
      expect(res.status).toBe(404);
    }
    expect(alpacaCalls()).toHaveLength(0);
  });
});
