"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  const items = [
    { label: "Total Requests", value: fmt(stats.totalRequests) },
    { label: "Total Input Tokens", value: fmt(stats.totalPromptTokens), tone: "text-primary" },
    { label: "Cached Tokens", value: fmt(stats.totalCachedTokens), tone: "text-info" },
    { label: "Output Tokens", value: fmt(stats.totalCompletionTokens), tone: "text-success" },
    { label: "Est. Cost", value: `~${fmtCost(stats.totalCost)}`, tone: "text-warning", note: "Estimated, not actual billing" },
  ];

  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
      {items.map(({ label, value, tone, note }) => (
        <Card key={label} padding="sm" className="flex min-w-0 flex-col gap-1 last:col-span-2 md:last:col-span-1">
          <span className="text-[13px] text-muted-foreground">{label}</span>
          <span className={`truncate text-xl font-semibold tracking-tight tabular-nums ${tone || ""}`} title={value}>{value}</span>
          {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
        </Card>
      ))}
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
