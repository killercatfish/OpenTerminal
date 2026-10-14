import { existsSync } from "node:fs";
import { Router } from "express";

// Read-only view of an Alpaca PAPER account for the BOT widget.
//
// Paper only, by construction: the host below is fixed, the router defines a
// single GET, and every upstream call is a GET to one of three fixed paths, so
// nothing a caller sends can reach an order-placing endpoint or a live account.
export const ALPACA_PAPER_BASE = "https://paper-api.alpaca.markets";

// Same variable names the trading bot uses (ALPACA_KEY / ALPACA_SECRET /
// ALPACA_PAPER, read from a .env file with dotenv). ALPACA_ENV_FILE may point at
// such a file; like dotenv, it never overrides variables already set.
const envFile = process.env.ALPACA_ENV_FILE;
if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);

type AlpacaAccount = {
  status: string;
  currency: string;
  equity: string;
  last_equity: string;
  cash: string;
  buying_power: string;
};

type AlpacaPosition = {
  symbol: string;
  qty: string;
  side: string;
  avg_entry_price: string;
  current_price: string | null;
  market_value: string | null;
  unrealized_pl: string | null;
  unrealized_plpc: string | null;
};

type AlpacaOrder = {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: string | null;
  notional: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  status: string;
  submitted_at: string | null;
  filled_at: string | null;
};

class UpstreamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function alpacaGet<T>(path: string, key: string, secret: string): Promise<T> {
  const res = await fetch(`${ALPACA_PAPER_BASE}${path}`, {
    method: "GET",
    headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new UpstreamError("Alpaca rejected the keys (they must be PAPER keys)", 502);
  }
  if (!res.ok) throw new UpstreamError(`Alpaca ${path.split("?")[0]}: HTTP ${res.status}`, 502);
  return (await res.json()) as T;
}

export const alpacaRouter = Router();

alpacaRouter.get("/", async (_req, res) => {
  if ((process.env.ALPACA_PAPER ?? "true").toLowerCase() === "false") {
    return res.status(503).json({ error: "ALPACA_PAPER=false: this widget reads paper accounts only" });
  }
  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;
  if (!key || !secret) {
    return res.status(503).json({ error: "ALPACA_KEY / ALPACA_SECRET not set on the API server" });
  }

  try {
    const [account, positions, orders] = await Promise.all([
      alpacaGet<AlpacaAccount>("/v2/account", key, secret),
      alpacaGet<AlpacaPosition[]>("/v2/positions", key, secret),
      alpacaGet<AlpacaOrder[]>("/v2/orders?status=all&limit=25&direction=desc", key, secret),
    ]);

    const equity = num(account.equity);
    const lastEquity = num(account.last_equity);
    const dayPl = equity !== null && lastEquity !== null ? equity - lastEquity : null;

    res.json({
      paper: true,
      account: {
        status: account.status,
        currency: account.currency,
        equity,
        lastEquity,
        dayPl,
        dayPlPct: dayPl !== null && lastEquity ? (dayPl / lastEquity) * 100 : null,
        cash: num(account.cash),
        buyingPower: num(account.buying_power),
      },
      positions: positions.map((p) => ({
        symbol: p.symbol,
        qty: num(p.qty),
        side: p.side,
        avgEntryPrice: num(p.avg_entry_price),
        currentPrice: num(p.current_price),
        marketValue: num(p.market_value),
        unrealizedPl: num(p.unrealized_pl),
        unrealizedPlPct: p.unrealized_plpc === null ? null : (num(p.unrealized_plpc) ?? 0) * 100,
      })),
      orders: orders.slice(0, 25).map((o) => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        qty: num(o.qty),
        notional: num(o.notional),
        filledQty: num(o.filled_qty),
        filledAvgPrice: num(o.filled_avg_price),
        status: o.status,
        submittedAt: o.submitted_at,
        filledAt: o.filled_at,
      })),
    });
  } catch (err) {
    if (err instanceof UpstreamError) return res.status(err.status).json({ error: err.message });
    res.status(502).json({ error: "could not reach Alpaca" });
  }
});
