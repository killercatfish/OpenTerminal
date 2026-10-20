import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The real app (real mount order, real requireApiKey) on an ephemeral port.
// Only calls to the bots' pages are mocked; calls to the test server use the real fetch.
const API_KEY = "test-api-key";
const realFetch = globalThis.fetch;
let tmpDir: string;
let server: Server;
let base: string;
let marketRouter: (typeof import("./market.js"))["marketRouter"];

const OVERVIEW = [
  {
    instance: "paper-research", port: 8054, online: true, name: "Paper AI picks $1,000 (research)",
    profile: "research", mode: "PAPER", heartbeat: "2026-10-20T19:49:54Z", market_open: true,
    account: { equity: 979.38, cash: 979.38, last_equity: 979.38, daytrade_count: 0 }, start_equity: 987.36,
    holding: [], watching: ["AI research picks"],
    last_trade: { time: "2026-10-19T13:30:39Z", symbol: "SPY", side: "sell", qty: 1.2494, entry: 777.57, exit: 767.375, pnl: -12.74, reason: "research now says DOWN" },
  },
  {
    instance: "live-double", port: 8050, online: true, name: "Real money $100 (double-100)",
    profile: "double", mode: "LIVE", heartbeat: "2026-10-20T19:49:55Z", market_open: true,
    account: { equity: 100.97, cash: 4.01, last_equity: 99.83 }, start_equity: 100.0,
    holding: ["Bitcoin"], watching: [], last_trade: { time: "2026-10-17T00:00:08Z", symbol: "BTC/USD", side: "buy", qty: 0.00117784, entry: 81505.08 },
    extra: "never passed through",
  },
  { instance: "paper-small", port: 8052, online: false, error: "URLError" },
  { instance: "odd", port: 22, online: true, name: "port outside 8050-8059" },
];
const STATUS: Record<number, unknown> = {
  8050: {
    positions: { "BTC/USD": { qty: 0.001, entry: 80000, stop: 0, opened: "2026-10-17T00:00:08Z" } },
    status: { "BTC/USD": { label: "Bitcoin", strategy: "EMA trend, all-in", price: 82000, detail: "trend IN" } },
    account: { equity: 100.97 },
  },
  8054: { positions: {}, status: { RESEARCH: { label: "AI research picks", strategy: "all-in", price: null, detail: "In cash", held: false } } },
};

const fakeBots = async (input: string | URL | Request, _init?: RequestInit) => {
  const u = new URL(String(input));
  const port = Number(u.port);
  if (port === 8049 && u.pathname === "/api/overview") return new Response(JSON.stringify(OVERVIEW));
  if (u.pathname === "/api/status" && STATUS[port]) return new Response(JSON.stringify(STATUS[port]));
  return new Response("Not found", { status: 404 });
};
const botsFetch = vi.fn(fakeBots);

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "openterminal-bots-test-"));
  process.env.DATA_DIR = tmpDir;
  process.env.API_KEY = API_KEY;
  ({ marketRouter } = await import("./market.js"));
  const { app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith(base) ? realFetch(input, init) : botsFetch(input, init)
  );
});

afterEach(() => {
  botsFetch.mockClear();
  botsFetch.mockImplementation(fakeBots);
});

afterAll(() => {
  vi.unstubAllGlobals();
  server.close();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.API_KEY;
});

const get = (headers: Record<string, string> = { "x-api-key": API_KEY }) => fetch(`${base}/api/bots`, { headers });

describe("GET /api/bots", () => {
  it("is not shadowed by marketRouter, which is mounted on all of /api", () => {
    const match = (marketRouter as any).stack.find((l: any) => l.match("/bots") || l.match("/bots/"));
    expect(match).toBeUndefined();
  });

  it("requires the API key, before touching the bots", async () => {
    const res = await get({});
    expect(res.status).toBe(401);
    expect(botsFetch).not.toHaveBeenCalled();
  });

  it("lists every bot, real money first, with signals and positions", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const { bots } = await res.json();
    expect(bots.map((b: any) => b.instance)).toEqual(["live-double", "paper-research", "paper-small", "odd"]);

    const live = bots[0];
    expect(live).toMatchObject({ live: true, online: true, equity: 100.97, cash: 4.01, holding: ["Bitcoin"] });
    expect(live.dayPl).toBeCloseTo(1.14);
    expect(live.sinceStartPct).toBeCloseTo(0.97);
    expect(live.signals).toEqual([expect.objectContaining({ label: "Bitcoin", detail: "trend IN", price: 82000 })]);
    expect(live.positions).toEqual([expect.objectContaining({ symbol: "BTC/USD", qty: 0.001, entry: 80000, price: 82000 })]);
    expect(live.positions[0].unrealizedPl).toBeCloseTo(2);
    expect(live.extra).toBeUndefined();
    expect(live.account).toBeUndefined();

    expect(bots[1]).toMatchObject({ live: false, lastTrade: expect.objectContaining({ pnl: -12.74, reason: "research now says DOWN" }) });
    expect(bots[2]).toMatchObject({ online: false, equity: null, signals: [] });
  });

  it("only ever GETs 127.0.0.1, and never a port outside the bots' 8050-8059", async () => {
    await get();
    const urls = botsFetch.mock.calls.map(([u]) => new URL(String(u)));
    for (const u of urls) expect(u.hostname).toBe("127.0.0.1");
    for (const [, init] of botsFetch.mock.calls) expect(init?.method).toBe("GET");
    expect(urls.map((u) => Number(u.port)).sort()).toEqual([8049, 8050, 8054]);   // not the offline 8052, not 22
  });

  it("says so when the overview is down", async () => {
    botsFetch.mockImplementation(async () => { throw new TypeError("fetch failed"); });
    const res = await get();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/8049/);
  });

  it("has no write routes", async () => {
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
      const res = await fetch(`${base}/api/bots`, { method, headers: { "x-api-key": API_KEY } });
      expect(res.status).toBe(404);
    }
    expect(botsFetch).not.toHaveBeenCalled();
  });
});
