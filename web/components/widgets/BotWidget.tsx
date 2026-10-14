"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, pctClass } from "../../lib/api";

// Read-only view of the trading bot's Alpaca PAPER account (server: routes/alpaca.ts).
// Deliberately no forms or buttons that act on the account.

type BotAccount = {
  status: string;
  currency: string;
  equity: number | null;
  lastEquity: number | null;
  dayPl: number | null;
  dayPlPct: number | null;
  cash: number | null;
  buyingPower: number | null;
};
type BotPosition = {
  symbol: string;
  qty: number | null;
  side: string;
  avgEntryPrice: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  unrealizedPlPct: number | null;
};
type BotOrder = {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: number | null;
  notional: number | null;
  filledQty: number | null;
  filledAvgPrice: number | null;
  status: string;
  submittedAt: string | null;
  filledAt: string | null;
};
type BotSnapshot = { paper: true; account: BotAccount; positions: BotPosition[]; orders: BotOrder[] };

export default function BotWidget() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["alpaca-paper"],
    queryFn: () => apiGet<BotSnapshot>("/api/alpaca"),
    refetchInterval: 30_000,
  });

  if (error) return <div className="p-2 down">Alpaca: {(error as Error).message}</div>;
  if (isLoading || !data) return <div className="p-2 dim">Loading paper account…</div>;

  const a = data.account;
  const unrealized = data.positions.reduce((s, p) => s + (p.unrealizedPl ?? 0), 0);

  return (
    <div>
      <div className="flex gap-2 p-1 items-center flex-wrap border-b border-[var(--border)]">
        <span className="amber font-bold">PAPER</span>
        <span className="dim">{a.status}</span>
        <span className="ml-auto">
          <span className="dim">Equity</span> <span className="amber">{fmt(a.equity)}</span>{" "}
          <span className="dim">Day</span>{" "}
          <span className={pctClass(a.dayPl)}>
            {fmt(a.dayPl)} ({fmt(a.dayPlPct)}%)
          </span>{" "}
          <span className="dim">Unrl</span> <span className={pctClass(unrealized)}>{fmt(unrealized)}</span>{" "}
          <span className="dim">Cash</span> {fmt(a.cash)}
        </span>
      </div>

      <table className="data-table">
        <thead>
          <tr><th>Sym</th><th>Qty</th><th>Avg Entry</th><th>Last</th><th>Mkt Val</th><th>Unrl PnL</th><th>Unrl %</th></tr>
        </thead>
        <tbody>
          {data.positions.length === 0 && (
            <tr><td colSpan={7} className="!text-left dim">No open positions</td></tr>
          )}
          {data.positions.map((p) => (
            <tr key={p.symbol}>
              <td className="font-bold">{p.symbol}</td>
              <td>{fmt(p.qty, 4)}</td>
              <td>{fmt(p.avgEntryPrice)}</td>
              <td>{fmt(p.currentPrice)}</td>
              <td>{fmt(p.marketValue)}</td>
              <td className={pctClass(p.unrealizedPl)}>{fmt(p.unrealizedPl)}</td>
              <td className={pctClass(p.unrealizedPlPct)}>{fmt(p.unrealizedPlPct)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dim px-1 pt-2 text-[10px] uppercase tracking-wider">Last {data.orders.length} orders</div>
      <table className="data-table">
        <thead>
          <tr><th>Submitted</th><th>Sym</th><th>Side</th><th>Type</th><th>Qty</th><th>Filled @</th><th>Status</th></tr>
        </thead>
        <tbody>
          {data.orders.map((o) => (
            <tr key={o.id}>
              <td className="!text-left dim">{o.submittedAt ? new Date(o.submittedAt).toLocaleString() : "—"}</td>
              <td className="font-bold">{o.symbol}</td>
              <td className={o.side === "buy" ? "up" : "down"}>{o.side.toUpperCase()}</td>
              <td className="dim">{o.type}</td>
              <td>{o.qty !== null ? fmt(o.qty, 4) : o.notional !== null ? `$${fmt(o.notional)}` : "—"}</td>
              <td>{fmt(o.filledAvgPrice)}</td>
              <td className="dim">{o.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
