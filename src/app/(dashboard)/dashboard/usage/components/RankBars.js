"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import * as d3 from "d3";
import Card from "@/shared/components/Card";
import SegmentedControl from "@/shared/components/SegmentedControl";

export const fmtCompact = d3.format(".3~s");

export function useWidth(ref, fallback = 480) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

const ROW = 28;
const LABEL_W = 148;
const VALUE_W = 52;

// Horizontal ranked bars; labels sit in their own column so long ids never collide with bars.
function Bars({ rows }) {
  const box = useRef(null);
  const width = useWidth(box);
  const max = d3.max(rows, (r) => r.v) || 1;
  const x = d3.scaleLinear().domain([0, max]).range([0, Math.max(40, width - LABEL_W - VALUE_W)]);

  return (
    <div ref={box} className="min-w-0">
      <svg width={width} height={rows.length * ROW} role="img" aria-label={rows.map((r) => `${r.name}: ${r.label}`).join(", ")} className="block">
        {rows.map((r, i) => (
          <g key={r.name} transform={`translate(0,${i * ROW})`}>
            <title>{`${r.name}: ${r.label}`}</title>
            <text x={0} y={ROW / 2} dy="0.35em" fontSize={12} className="fill-foreground">
              {r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name}
            </text>
            <rect x={LABEL_W} y={6} width={width - LABEL_W - VALUE_W} height={ROW - 12} rx={3} className="fill-muted" />
            <rect x={LABEL_W} y={6} width={Math.max(2, x(r.v))} height={ROW - 12} rx={3} fill="var(--chart-1)" fillOpacity={i === 0 ? 1 : 0.7} />
            <text x={width} y={ROW / 2} dy="0.35em" textAnchor="end" fontSize={12} className="fill-muted-foreground tabular-nums">{r.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

Bars.propTypes = { rows: PropTypes.array.isRequired };

const MODES = [{ value: "tokens", label: "Tokens" }, { value: "requests", label: "Requests" }];

// Card wrapper shared by ProviderBarChart and TopModelsChart.
export default function RankCard({ title, items, empty, limit }) {
  const [mode, setMode] = useState("tokens");
  const rows = items
    .map((d) => ({ name: d.name, v: d[mode] }))
    .filter((d) => d.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, limit)
    .map((d) => ({ ...d, label: mode === "tokens" ? fmtCompact(d.v) : d3.format(",")(d.v) }));

  return (
    <Card title={title} padding="sm" className="min-w-0" action={<SegmentedControl size="sm" value={mode} onChange={setMode} options={MODES} />}>
      {rows.length ? <Bars rows={rows} /> : <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>}
    </Card>
  );
}

RankCard.propTypes = {
  title: PropTypes.string.isRequired,
  items: PropTypes.array.isRequired,
  empty: PropTypes.string.isRequired,
  limit: PropTypes.number,
};
