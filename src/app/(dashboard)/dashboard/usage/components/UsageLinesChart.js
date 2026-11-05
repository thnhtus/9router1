"use client";

// Multi-line chart per series (model/account/API key/endpoint), after https://observablehq.com/@d3/multi-line-chart/2:
// hover snaps to the nearest point, highlights its line and fades the rest.
import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import * as d3 from "d3";
import Card from "@/shared/components/Card";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { fmtCompact, useWidth } from "./RankBars";

const VIEW = {
  tokens: { label: "Tokens", fmt: fmtCompact },
  requests: { label: "Requests", fmt: d3.format(",") },
  cost: { label: "Cost", fmt: (n) => `$${(n || 0).toFixed(n >= 1 ? 2 : 4)}` },
};
const MODES = Object.entries(VIEW).map(([value, v]) => ({ value, label: v.label }));
// ponytail: top 10 series only; more lines become unreadable spaghetti.
const MAX_LINES = 10;
const H = 300;
const M = { top: 16, right: 16, bottom: 24, left: 48 };

function Lines({ data, mode, dim }) {
  const box = useRef(null);
  const width = useWidth(box, 720);
  const [hover, setHover] = useState(null);
  const cfg = VIEW[mode];

  const totals = d3.rollup(data.flatMap((d) => Object.entries(d.series?.[dim] || {})), (v) => d3.sum(v, ([, m]) => m[mode] || 0), ([k]) => k);
  const names = [...totals].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, MAX_LINES).map(([k]) => k);
  const series = names.map((name) => ({ name, values: data.map((d) => d.series?.[dim]?.[name]?.[mode] || 0) }));
  const points = series.flatMap((s, si) => s.values.map((v, i) => [i, v, si]));

  const x = d3.scalePoint().domain(data.map((_, i) => i)).range([M.left, width - M.right]);
  const y = d3.scaleLinear().domain([0, d3.max(points, (p) => p[1]) || 1]).nice().range([H - M.bottom, M.top]);
  const color = d3.scaleOrdinal(names, ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]);
  const line = d3.line().x((_, i) => x(i)).y((v) => y(v)).curve(d3.curveMonotoneX);
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor((width - M.left) / 64))));

  const onMove = (e) => {
    const r = box.current.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    setHover(d3.least(points, (p) => Math.hypot(x(p[0]) - px, y(p[1]) - py)));
  };
  const hs = hover ? series[hover[2]] : null;

  return (
    <div ref={box} className="relative min-w-0">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`${cfg.label} per ${dim} over time: ${series.map((s) => `${s.name} ${cfg.fmt(d3.sum(s.values))}`).join(", ")}`}
        className="block text-muted-foreground"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {y.ticks(5).map((t) => (
          <g key={t} transform={`translate(0,${y(t)})`}>
            <line x1={M.left} x2={width - M.right} stroke="currentColor" strokeOpacity={0.12} />
            <text x={M.left - 8} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor" className="tabular-nums">{cfg.fmt(t)}</text>
          </g>
        ))}
        {data.map((d, i) => i % every === 0 && (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="currentColor" className="tabular-nums">{d.label}</text>
        ))}
        {series.map((s, si) => (
          <path
            key={s.name}
            d={line(s.values)}
            fill="none"
            stroke={hs && hover[2] !== si ? "currentColor" : color(s.name)}
            strokeOpacity={hs && hover[2] !== si ? 0.25 : 1}
            strokeWidth={hover?.[2] === si ? 2.25 : 1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {hs && <circle cx={x(hover[0])} cy={y(hover[1])} r={4} fill={color(hs.name)} className="stroke-card" strokeWidth={2} />}
      </svg>
      {hs && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-soft"
          style={{ left: Math.min(x(hover[0]) + 10, width - 200), top: Math.max(0, y(hover[1]) - 48) }}
        >
          <div className="max-w-[180px] truncate font-medium text-foreground">{hs.name}</div>
          <div className="text-muted-foreground tabular-nums">{data[hover[0]].label} · {cfg.fmt(hover[1])}</div>
        </div>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <li key={s.name} className="flex min-w-0 items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: color(s.name) }} />
            <span className="max-w-[200px] truncate">{s.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

Lines.propTypes = { data: PropTypes.array.isRequired, mode: PropTypes.string.isRequired, dim: PropTypes.string.isRequired };

export default function UsageLinesChart({ period = "7d", dim = "model", title = "Usage by Model" }) {
  const [res, setRes] = useState({ period: null, data: [], ok: true });
  const [mode, setMode] = useState("tokens");

  useEffect(() => {
    let alive = true;
    fetch(`/api/usage/chart?period=${period}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((json) => alive && setRes({ period, data: Array.isArray(json) ? json : [], ok: true }))
      .catch(() => alive && setRes({ period, data: [], ok: false }));
    return () => { alive = false; };
  }, [period]);

  const data = res.data;
  const status = res.period !== period ? "loading" : res.ok ? "ok" : "error";
  const hasData = data.some((d) => Object.values(d.series?.[dim] || {}).some((m) => (m[mode] || 0) > 0));
  const msg = status === "loading" ? "Loading..." : status === "error" ? "Couldn't load chart data. Change the period to retry." : !hasData ? "No data for this period" : null;

  return (
    <Card title={title} padding="sm" className="min-w-0" action={<SegmentedControl size="sm" value={mode} onChange={setMode} options={MODES} />}>
      {msg ? <p className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">{msg}</p> : <Lines data={data} mode={mode} dim={dim} />}
    </Card>
  );
}

UsageLinesChart.propTypes = {
  period: PropTypes.string,
  dim: PropTypes.oneOf(["model", "account", "apiKey", "endpoint", "agent"]),
  title: PropTypes.string,
};
