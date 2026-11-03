"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import * as d3 from "d3";
import Card from "@/shared/components/Card";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { useWidth } from "./RankBars";

// Pattern adapted from affectUI "Agent Queue": live lanes + stat strip + depth chart.
// ponytail: depth history is sampled client-side from SSE state (1 Hz, last 96s) and
// resets on reload; persist server-side if a longer window is ever needed.
const WINDOW = 96;
const H = 120;
const M = { top: 8, right: 8, bottom: 18, left: 28 };

const laneKey = (r) => `${r.provider}|${r.model}|${r.account}`;
const fmtSec = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

function DepthChart({ samples }) {
  const box = useRef(null);
  const width = useWidth(box, 640);
  const x = d3.scaleLinear().domain([0, WINDOW - 1]).range([M.left, width - M.right]);
  const y = d3.scaleLinear().domain([0, Math.max(4, d3.max(samples, (s) => s.depth) || 0)]).nice().range([H - M.bottom, M.top]);
  const offset = WINDOW - samples.length;
  const area = d3.area().x((_, i) => x(i + offset)).y0(y(0)).y1((s) => y(s.depth)).curve(d3.curveMonotoneX);
  const last = samples.at(-1);
  const peak = d3.max(samples, (s) => s.depth) || 0;
  const errors = samples.filter((s) => s.error).length;

  return (
    <div ref={box} className="min-w-0">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`In-flight requests over the last ${WINDOW}s: ${last?.depth || 0} now, peak ${peak}, ${errors}s with provider errors.`}
        className="block text-muted-foreground"
      >
        {samples.map((s, i) => s.error && (
          <rect key={i} x={x(i + offset) - 2} y={M.top} width={4 + (width - M.left - M.right) / WINDOW} height={H - M.top - M.bottom} fill="var(--color-warning)" fillOpacity={0.12} />
        ))}
        {y.ticks(2).map((t) => (
          <g key={t} transform={`translate(0,${y(t)})`}>
            <line x1={M.left} x2={width - M.right} stroke="currentColor" strokeOpacity={0.12} />
            <text x={M.left - 6} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor" className="tabular-nums">{t}</text>
          </g>
        ))}
        <path d={area(samples)} fill="var(--chart-1)" fillOpacity={0.12} />
        <path d={area.lineY1()(samples)} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} />
        {last && <circle cx={x(WINDOW - 1)} cy={y(last.depth)} r={3} fill="var(--chart-1)" />}
        <text x={M.left} y={H - 4} fontSize={11} fill="currentColor">{WINDOW}s ago</text>
        <text x={width - M.right} y={H - 4} fontSize={11} fill="currentColor" textAnchor="end">now</text>
      </svg>
    </div>
  );
}

DepthChart.propTypes = { samples: PropTypes.array.isRequired };

function Stat({ label, value, unit, tone }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone || ""}`}>
        {value}{unit && <span className="text-sm font-normal text-muted-foreground">{unit}</span>}
      </dd>
    </div>
  );
}

Stat.propTypes = { label: PropTypes.string, value: PropTypes.node, unit: PropTypes.string, tone: PropTypes.string };

export default function LiveQueue({ activeRequests = [], recentRequests = [], last10Minutes = [], errorProvider = "" }) {
  const [now, setNow] = useState(() => Date.now());
  const [samples, setSamples] = useState([]);
  const [seen, setSeen] = useState({});
  const live = useRef({ activeRequests, errorProvider });

  // First-seen time per lane so the bar can grow while the request runs.
  useEffect(() => {
    live.current = { activeRequests, errorProvider };
  }, [activeRequests, errorProvider]);

  // 1 Hz tick: clock, first-seen per lane, depth sample.
  useEffect(() => {
    const t = setInterval(() => {
      const { activeRequests: a, errorProvider: e } = live.current;
      const ts = Date.now();
      setNow(ts);
      setSeen((prev) => Object.fromEntries(a.map((r) => [laneKey(r), prev[laneKey(r)] ?? ts])));
      setSamples((s) => [...s.slice(1 - WINDOW), { depth: a.reduce((n, r) => n + (r.count || 0), 0), error: !!e }]);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const inFlight = activeRequests.reduce((n, r) => n + (r.count || 0), 0);
  const full = last10Minutes.slice(0, -1); // current minute is partial
  const throughput = full.length ? Math.round(d3.mean(full, (b) => b.requests || 0)) : 0;
  const isOk = (r) => {
    const s = (r.status || "").toLowerCase();
    if (!s || s === "ok" || s === "success" || s.startsWith("200")) return true;
    if (s.includes("fail") || s.includes("error")) return false;
    return true;
  };
  const done = recentRequests.filter(isOk).length;
  const failed = recentRequests.length - done;

  const badge = errorProvider ? (
    <span role="status" className="inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
      <span className="size-1.5 rounded-full bg-warning" /> Error · {errorProvider}
    </span>
  ) : (
    <span role="status" className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      <span className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" /> Live
    </span>
  );

  return (
    <Card title="Live Queue" subtitle="In-flight requests across providers" icon="view_agenda" action={badge} padding="none" className="min-w-0 overflow-hidden [&>div:first-child]:mb-0 [&>div:first-child]:px-4 [&>div:first-child]:pt-4">
      <dl className="mt-3 grid grid-cols-2 divide-border border-y border-border sm:grid-cols-4 sm:divide-x">
        <Stat label="In flight" value={inFlight} />
        <Stat label="Throughput" value={throughput} unit="/min" />
        <Stat label="Done" value={done} unit=" recent" tone="text-success" />
        <Stat label="Failed" value={failed} unit=" recent" tone={failed ? "text-danger" : ""} />
      </dl>

      <div className="px-4 py-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Lanes <span className="tabular-nums">{activeRequests.length}</span>
        </p>
        {!activeRequests.length ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nothing in flight</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {activeRequests.map((r) => {
              const k = laneKey(r);
              const elapsed = now - (seen[k] || now);
              const erroring = errorProvider && errorProvider.toLowerCase() === r.provider?.toLowerCase();
              // Bar fills asymptotically: no ETA is known, so it never claims to be done.
              const pct = Math.min(95, 100 * (1 - Math.exp(-elapsed / 15000)));
              return (
                <li key={k} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-3 rounded-lg border border-border px-2.5 py-1.5">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <ProviderIcon providerId={r.provider} alt="" size={20} fallbackText={r.provider?.[0]?.toUpperCase()} />
                    <span className="truncate" title={r.account}>{r.provider}</span>
                  </span>
                  <span className="relative flex h-7 min-w-0 items-center overflow-hidden rounded-md bg-muted/50 px-2 text-xs">
                    <span
                      aria-hidden="true"
                      className={`absolute inset-y-0 left-0 transition-[width] duration-1000 ease-linear motion-reduce:transition-none ${erroring ? "bg-warning/20" : "bg-primary/15"}`}
                      style={{ width: `${pct}%` }}
                    />
                    <span className="relative min-w-0 flex-1 truncate font-mono" title={r.model}>
                      {r.model}{r.count > 1 && <span className="text-muted-foreground"> ×{r.count}</span>}
                    </span>
                    <span className={`relative ml-2 tabular-nums ${erroring ? "text-warning" : "text-primary"}`}>
                      {erroring ? "Error" : fmtSec(elapsed)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border px-4 pb-3 pt-3">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">In-flight depth</p>
        <DepthChart samples={samples} />
      </div>
    </Card>
  );
}

LiveQueue.propTypes = {
  activeRequests: PropTypes.arrayOf(PropTypes.shape({
    provider: PropTypes.string, model: PropTypes.string, account: PropTypes.string, count: PropTypes.number,
  })),
  recentRequests: PropTypes.array,
  last10Minutes: PropTypes.array,
  errorProvider: PropTypes.string,
};
