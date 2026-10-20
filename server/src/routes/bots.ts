import { Router } from "express";

// Read-only view of every trading bot, live money included, for the BOTS widget.
//
// No Alpaca keys here. The bots' own read-only pages on the same host already
// serve their numbers: the overview (:8049/api/overview) lists every bot, and
// each bot's dashboard (/api/status) adds its signal lines and positions. This
// router only GETs those, on 127.0.0.1, so the live account's keys never leave
// the trading bot. Every field is copied out explicitly; nothing is passed
// through as-is.
export const BOTS_HOST = "http://127.0.0.1";
const overviewPort = () => Number(process.env.TRADING_OVERVIEW_PORT ?? 8049);
// The bots' dashboards live on 8050-8059; a port outside that is never fetched.
const isBotPort = (p: unknown): p is number => Number.isInteger(p) && (p as number) >= 8050 && (p as number) <= 8059;

type Trade = { time?: string; symbol?: string; side?: string; qty?: number; entry?: number; exit?: number; pnl?: number; reason?: string };
type OverviewCard = {
  instance: string;
  port: number;
  online: boolean;
  name?: string;
  profile?: string;
  mode?: string;
  heartbeat?: string;
  market_open?: boolean;
  account?: { equity?: number; cash?: number; last_equity?: number };
  start_equity?: number;
  holding?: string[];
  watching?: string[];
  last_trade?: Trade | null;
};
type Signal = { label?: string; strategy?: string; price?: number | null; detail?: string; held?: boolean };
type BotStatus = {
  positions?: Record<string, { qty?: number; entry?: number; stop?: number; opened?: string }>;
  status?: Record<string, Signal>;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);

async function localGet<T>(port: number, path: string): Promise<T> {
  const res = await fetch(`${BOTS_HOST}:${port}${path}`, { method: "GET", signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function trade(t: Trade | null | undefined) {
  if (!t) return null;
  return {
    time: str(t.time), symbol: str(t.symbol), side: str(t.side), qty: num(t.qty),
    entry: num(t.entry), exit: num(t.exit), pnl: num(t.pnl), reason: str(t.reason),
  };
}

function bot(card: OverviewCard, detail: BotStatus | null) {
  const equity = num(card.account?.equity);
  const lastEquity = num(card.account?.last_equity);
  const startEquity = num(card.start_equity);
  const status = detail?.status ?? {};
  return {
    instance: String(card.instance),
    name: str(card.name) ?? String(card.instance),
    live: card.mode === "LIVE",
    online: card.online === true,
    profile: str(card.profile),
    heartbeat: str(card.heartbeat),
    marketOpen: card.market_open === true,
    equity,
    cash: num(card.account?.cash),
    dayPl: equity !== null && lastEquity !== null ? equity - lastEquity : null,
    dayPlPct: equity !== null && lastEquity ? ((equity - lastEquity) / lastEquity) * 100 : null,
    startEquity,
    sinceStartPct: equity !== null && startEquity ? ((equity - startEquity) / startEquity) * 100 : null,
    holding: strs(card.holding),
    watching: strs(card.watching),
    lastTrade: trade(card.last_trade),
    signals: Object.values(status).map((s) => ({
      label: str(s.label), strategy: str(s.strategy), price: num(s.price), detail: str(s.detail), held: s.held === true,
    })),
    positions: Object.entries(detail?.positions ?? {}).map(([symbol, p]) => {
      const qty = num(p.qty), entry = num(p.entry), price = num(status[symbol]?.price);
      return {
        symbol, qty, entry, price, opened: str(p.opened),
        unrealizedPl: qty !== null && entry !== null && price !== null ? (price - entry) * qty : null,
      };
    }),
  };
}

export const botsRouter = Router();

botsRouter.get("/", async (_req, res) => {
  let cards: OverviewCard[];
  try {
    cards = await localGet<OverviewCard[]>(overviewPort(), "/api/overview");
    if (!Array.isArray(cards)) throw new Error("not a list");
  } catch {
    return res.status(502).json({ error: "the trading overview (:8049) isn't answering" });
  }
  const bots = await Promise.all(
    cards.map(async (c) => {
      const detail = c.online && isBotPort(c.port) ? await localGet<BotStatus>(c.port, "/api/status").catch(() => null) : null;
      return bot(c, detail);
    })
  );
  bots.sort((a, b) => Number(b.live) - Number(a.live));   // real money first
  res.json({ fetchedAt: new Date().toISOString(), bots });
});
