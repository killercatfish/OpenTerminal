"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, pctClass } from "../../lib/api";

// Every trading bot, live money included, read from the bots' own pages on the
// host (server: routes/bots.ts). No keys, and deliberately no buttons.

type Trade = {
  time: string | null; symbol: string | null; side: string | null; qty: number | null;
  entry: number | null; exit: number | null; pnl: number | null; reason: string | null;
};
type Bot = {
  instance: string;
  name: string;
  live: boolean;
  online: boolean;
  heartbeat: string | null;
  equity: number | null;
  cash: number | null;
  dayPl: number | null;
  dayPlPct: number | null;
  startEquity: number | null;
  sinceStartPct: number | null;
  holding: string[];
  watching: string[];
  lastTrade: Trade | null;
  signals: Array<{ label: string | null; strategy: string | null; price: number | null; detail: string | null; held: boolean }>;
  positions: Array<{ symbol: string; qty: number | null; entry: number | null; price: number | null; unrealizedPl: number | null }>;
};
type BotsSnapshot = { fetchedAt: string; bots: Bot[] };

// A bot loop beats every minute; older than this means it has stopped.
const STALE_MS = 10 * 60_000;
const stale = (b: Bot) => !b.heartbeat || Date.now() - new Date(b.heartbeat).getTime() > STALE_MS;

function Mode({ bot }: { bot: Bot }) {
  return bot.live ? <span className="down font-bold">LIVE $</span> : <span className="amber font-bold">PAPER</span>;
}

export default function BotsWidget() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["trading-bots"],
    queryFn: () => apiGet<BotsSnapshot>("/api/bots"),
    refetchInterval: 30_000,
  });

  if (error) return <div className="p-2 down">Bots: {(error as Error).message}</div>;
  if (isLoading || !data) return <div className="p-2 dim">Loading bots…</div>;

  return (
    <div>
      <table className="data-table">
        <thead>
          <tr><th>Bot</th><th>Mode</th><th>Equity</th><th>Day</th><th>Since start</th><th>Cash</th><th>Holding</th></tr>
        </thead>
        <tbody>
          {data.bots.map((b) => (
            <tr key={b.instance}>
              <td className="!text-left font-bold">
                {b.instance}
                {(!b.online || stale(b)) && <span className="down"> · {b.online ? "stalled" : "offline"}</span>}
              </td>
              <td><Mode bot={b} /></td>
              <td className="amber">{fmt(b.equity)}</td>
              <td className={pctClass(b.dayPl)}>{fmt(b.dayPl)} ({fmt(b.dayPlPct)}%)</td>
              <td className={pctClass(b.sinceStartPct)}>{fmt(b.sinceStartPct)}%</td>
              <td>{fmt(b.cash)}</td>
              <td className="!text-left">{b.holding.join(", ") || <span className="dim">cash</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.bots.filter((b) => b.online).map((b) => (
        <div key={b.instance} className="px-1 pt-2 border-t border-[var(--border)]">
          <div className="flex gap-2 items-center">
            <Mode bot={b} />
            <span className="font-bold">{b.name}</span>
            <span className="ml-auto dim">started {fmt(b.startEquity)}</span>
          </div>
          {b.positions.map((p) => (
            <div key={p.symbol}>
              <span className="font-bold">{p.symbol}</span> <span className="dim">qty</span> {fmt(p.qty, 6)}{" "}
              <span className="dim">entry</span> {fmt(p.entry)} <span className="dim">bar close</span> {fmt(p.price)}{" "}
              <span className="dim">unrl at close</span> <span className={pctClass(p.unrealizedPl)}>{fmt(p.unrealizedPl)}</span>
            </div>
          ))}
          {b.signals.map((s, i) => (
            <div key={i} className="dim">
              <span className={s.held ? "amber" : ""}>{s.label}</span>: {s.detail}
            </div>
          ))}
          {b.lastTrade && (
            <div className="dim">
              Last trade {b.lastTrade.time ? new Date(b.lastTrade.time).toLocaleDateString() : "—"}:{" "}
              <span className={b.lastTrade.side === "buy" ? "up" : "down"}>{b.lastTrade.side?.toUpperCase()}</span>{" "}
              {b.lastTrade.symbol} @ {fmt(b.lastTrade.exit ?? b.lastTrade.entry)}
              {b.lastTrade.pnl !== null && (
                <> · <span className={pctClass(b.lastTrade.pnl)}>{fmt(b.lastTrade.pnl)}</span></>
              )}
              {b.lastTrade.reason && <> · {b.lastTrade.reason}</>}
            </div>
          )}
        </div>
      ))}
      <div className="dim px-1 pt-2 text-[10px]">Read from the bots' own dashboards · {new Date(data.fetchedAt).toLocaleTimeString()}</div>
    </div>
  );
}
