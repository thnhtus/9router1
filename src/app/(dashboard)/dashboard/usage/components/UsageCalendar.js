"use client";

import { useState, useEffect, useRef } from "react";
import * as d3 from "d3";
import Card from "@/shared/components/Card";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { fmtCompact, useWidth } from "./RankBars";

// Calendar heatmap of daily usage, after https://observablehq.com/@d3/calendar/2 (weeks run Sunday-first).
const LEFT = 28;
const TOP = 30;
const fmtDay = d3.timeFormat("%a, %b %-d, %Y");
const VIEW = {
  tokens: { label: "Tokens", fmt: fmtCompact, full: (n) => `${d3.format(",")(n)} tokens`, color: "var(--chart-1)" },
  requests: { label: "Requests", fmt: d3.format(","), full: (n) => `${d3.format(",")(n)} requests`, color: "var(--chart-3)" },
  cost: { label: "Cost", fmt: (n) => `$${(n || 0).toFixed(n >= 1 ? 2 : 4)}`, full: (n) => `$${(n || 0).toFixed(n >= 1 ? 2 : 4)}`, color: "var(--chart-4)" },
};
const MODES = Object.entries(VIEW).map(([value, v]) => ({ value, label: v.label }));

function Year({ year, days, color, fill, mode, cell, offset, onHover, hoverKey }) {
  const start = d3.timeYear(days[0].d);
  const week = (d) => d3.timeSunday.count(start, d);
  const months = d3.timeMonths(start, d3.timeYear.offset(start, 1));
  return (
    <g>
      <text x={0} y={TOP - 4} dy={-12} fontSize={11} fontWeight={600} fill="currentColor">{year}</text>
      {["S", "M", "T", "W", "T", "F", "S"].map((l, i) => i % 2 === 1 && (
        <text key={i} x={LEFT - 6} y={TOP + i * cell + cell / 2} dy="0.32em" textAnchor="end" fontSize={10} fill="currentColor">{l}</text>
      ))}
      {months.map((m) => (
        <text key={+m} x={LEFT + week(m) * cell} y={TOP - 4} fontSize={10} fill="currentColor">
          {d3.timeFormat("%b")(m)}
        </text>
      ))}
      {days.map((x) => (
        <rect
          key={x.date}
          x={LEFT + week(x.d) * cell}
          y={TOP + x.d.getDay() * cell}
          width={cell - 2}
          height={cell - 2}
          rx={2}
          fill={x[mode] > 0 ? fill : "currentColor"}
          fillOpacity={x[mode] > 0 ? color(x[mode]) : 0.08}
          stroke={hoverKey === x.date ? "currentColor" : "none"}
          onPointerEnter={() => onHover({ ...x, cx: LEFT + week(x.d) * cell + cell / 2 - 1, cy: offset + TOP + x.d.getDay() * cell })}
        />
      ))}
    </g>
  );
}

export default function UsageCalendar() {
  const box = useRef(null);
  const width = useWidth(box, 720);
  const [state, setState] = useState({ status: "loading", days: [] });
  const [hover, setHover] = useState(null);
  const [mode, setMode] = useState("tokens");
  const cfg = VIEW[mode];

  useEffect(() => {
    let alive = true;
    fetch("/api/usage/chart?period=all")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((json) => {
        if (!alive) return;
        const days = (Array.isArray(json) ? json : [])
          .filter((x) => x.date)
          .map((x) => ({ date: x.date, tokens: x.tokens || 0, requests: x.requests || 0, cost: x.cost || 0, d: new Date(`${x.date}T00:00:00`) }));
        setState({ status: "ok", days });
      })
      .catch(() => alive && setState({ status: "error", days: [] }));
    return () => { alive = false; };
  }, []);

  const { status, days } = state;
  const max = d3.max(days, (x) => x[mode]) || 0;
  // Opacity on the theme chart color keeps the ramp readable in light and dark mode.
  const color = d3.scaleSqrt().domain([0, max || 1]).range([0.2, 1]);
  const years = d3.groups(days, (x) => x.d.getFullYear()).reverse();
  const cell = Math.max(8, Math.min(16, Math.floor((width - LEFT) / 53)));
  const yearH = TOP + cell * 7 + 16;

  const msg = status === "loading" ? "Loading..." : status === "error" ? "Couldn't load calendar data." : max === 0 ? "No usage yet" : null;

  return (
    <Card title="Activity" padding="sm" className="min-w-0" action={<SegmentedControl size="sm" value={mode} onChange={setMode} options={MODES} />}>
      <div ref={box} className="min-w-0 overflow-x-auto text-muted-foreground">
        {msg ? (
          <p className="flex h-[140px] items-center justify-center text-sm">{msg}</p>
        ) : (
          <div className="relative w-max" onPointerLeave={() => setHover(null)}>
            <svg width={Math.max(width, LEFT + cell * 53)} height={yearH * years.length} role="img" aria-label={`Calendar of daily ${cfg.label.toLowerCase()}`} className="block">
              {years.map(([year, ds], i) => (
                <g key={year} transform={`translate(0,${i * yearH})`}>
                  <Year year={year} days={ds} color={color} fill={cfg.color} mode={mode} cell={cell} offset={i * yearH} onHover={setHover} hoverKey={hover?.date} />
                </g>
              ))}
            </svg>
            {hover && (
              <div
                aria-live="polite"
                className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-soft"
                // Top rows flip the tooltip below the cell so the scroll container doesn't clip it.
                style={{ left: hover.cx, top: hover.d.getDay() < 3 ? hover.cy + cell + 4 : hover.cy - 6, transform: `translate(-50%, ${hover.d.getDay() < 3 ? "0" : "-100%"})` }}
              >
                <div className="text-muted-foreground">{fmtDay(hover.d)}</div>
                <div className="font-medium tabular-nums text-foreground">{cfg.full(hover[mode])}</div>
              </div>
            )}
          </div>
        )}
        {!msg && (
          <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] tabular-nums">
            <span>0</span>
            {[0.15, 0.35, 0.55, 0.75, 1].map((t) => (
              <span key={t} className="size-2.5 rounded-sm" style={{ background: cfg.color, opacity: color(max * t) }} />
            ))}
            <span>{cfg.fmt(max)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
