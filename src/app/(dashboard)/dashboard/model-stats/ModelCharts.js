"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { Card } from "@/shared/components";

const TIER_COLOR = { free: "#16a34a", cheap: "#0ea5e9", mid: "#f59e0b", premium: "#ef4444", unknown: "#94a3b8" };
const TOP_N = 15;
const fmt = d3.format(".3~g");
const BAR_M = { top: 8, right: 48, bottom: 24, left: 200 };
const DOT_M = { top: 16, right: 24, bottom: 40, left: 52 };

function useWidth(ref) {
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

// Horizontal ranking bars, like llm-stats' leaderboard chart view.
function RankBars({ rows, metric }) {
  const box = useRef(null);
  const svgRef = useRef(null);
  const width = useWidth(box);
  const M = BAR_M;
  const height = M.top + M.bottom + rows.length * 24;

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!rows.length) return;
    const x = d3.scaleLinear().domain([0, 100]).range([M.left, width - M.right]).nice();
    const y = d3.scaleBand().domain(rows.map((r) => r.id)).range([M.top, height - M.bottom]).padding(0.25);

    svg.append("g").attr("transform", `translate(0,${height - M.bottom})`).call(d3.axisBottom(x).ticks(5))
      .call((g) => g.selectAll(".tick line").attr("stroke-opacity", 0.3));
    svg.append("g").attr("transform", `translate(${M.left},0)`).call(d3.axisLeft(y).tickSize(0).tickPadding(8))
      .call((g) => g.select(".domain").remove())
      .call((g) => g.selectAll("text").text((d) => (d.length > 28 ? `${d.slice(0, 27)}…` : d)).append("title").text((d) => d));

    const bar = svg.append("g").selectAll("g").data(rows).join("g");
    bar.append("rect").attr("x", M.left).attr("y", (r) => y(r.id)).attr("height", y.bandwidth())
      .attr("width", (r) => x(r.v) - M.left).attr("rx", 3).attr("fill", (r) => TIER_COLOR[r.tier])
      .append("title").text((r) => `${r.id}: ${metric} ${fmt(r.v)} · ${r.tier}${r.price != null ? ` · $${r.price}/M in` : ""}`);
    bar.append("text").attr("x", (r) => x(r.v) + 4).attr("y", (r) => y(r.id) + y.bandwidth() / 2).attr("dy", "0.35em")
      .attr("font-size", 11).attr("fill", "currentColor").text((r) => fmt(r.v));
  }, [rows, width, height, metric, M]);

  return <div ref={box}><svg ref={svgRef} width={width} height={height} role="img" aria-label={`Top ${rows.length} models by ${metric}`} className="text-text-muted" /></div>;
}

// Score vs input price (log). Up-and-left = cheap and strong: what Jev should prefer.
function ScoreVsPrice({ rows, metric }) {
  const box = useRef(null);
  const svgRef = useRef(null);
  const width = useWidth(box);
  const H = 340;
  const M = DOT_M;
  const pts = rows.filter((r) => r.price != null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!pts.length) return;
    const [lo, hi] = d3.extent(pts, (p) => p.price);
    const x = d3.scaleLog().domain([lo / 1.5, hi * 1.5]).range([M.left, width - M.right]).nice();
    const y = d3.scaleLinear().domain([0, 100]).range([H - M.bottom, M.top]).nice();

    svg.append("g").attr("transform", `translate(0,${H - M.bottom})`).call(d3.axisBottom(x).ticks(6, "$~g"))
      .call((g) => g.append("text").attr("x", width - M.right).attr("y", 34).attr("text-anchor", "end").attr("fill", "currentColor")
        .text("Input $ per 1M tokens (log, free shown at $0.01)"));
    svg.append("g").attr("transform", `translate(${M.left},0)`).call(d3.axisLeft(y).ticks(6))
      .call((g) => g.append("text").attr("x", -M.left + 4).attr("y", M.top - 6).attr("text-anchor", "start").attr("fill", "currentColor").text(`${metric} percentile`));
    svg.selectAll(".tick line").attr("stroke-opacity", 0.3);

    const tip = svg.append("text").attr("font-size", 12).attr("fill", "currentColor").attr("pointer-events", "none");
    svg.append("g").selectAll("circle").data(pts).join("circle")
      .attr("cx", (p) => x(p.price)).attr("cy", (p) => y(p.v)).attr("r", 5)
      .attr("fill", (p) => TIER_COLOR[p.tier]).attr("fill-opacity", 0.85).attr("stroke", "currentColor").attr("stroke-opacity", 0.3)
      .on("mouseenter", (_e, p) => {
        const flip = x(p.price) > width / 2;
        tip.attr("x", x(p.price) + (flip ? -8 : 8)).attr("y", y(p.v) - 8).attr("text-anchor", flip ? "end" : "start")
          .text(`${p.id} · ${fmt(p.v)} · ${p.tier}`);
      })
      .on("mouseleave", () => tip.text(""))
      .append("title").text((p) => `${p.id}: ${metric} ${fmt(p.v)}, $${p.price}/M in`);
  }, [pts, width, metric, M]);

  if (!pts.length) return <p className="text-sm text-text-muted">No priced models for this metric.</p>;
  return <div ref={box}><svg ref={svgRef} width={width} height={H} role="img" aria-label={`${metric} versus price for ${pts.length} models`} className="text-text-muted" /></div>;
}

export default function ModelCharts({ models }) {
  const withStats = useMemo(() => models.filter((m) => m.stats), [models]);
  const metrics = useMemo(() => {
    const count = d3.rollup(withStats.flatMap((m) => Object.keys(m.ranks || {})), (v) => v.length, (k) => k);
    return [...count].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [withStats]);
  const [metric, setMetric] = useState("");
  const active = metrics.includes(metric) ? metric : metrics[0];

  const rows = useMemo(() => withStats
    .filter((m) => m.ranks?.[active] > 0)
    .map((m) => ({ id: m.id, tier: m.tier, v: m.ranks[active], price: m.tier === "free" ? 0.01 : m.stats.inPrice }))
    .sort((a, b) => b.v - a.v), [withStats, active]);

  if (!withStats.length) return null;
  return (
    <Card title="Charts" subtitle={`${withStats.length} of ${models.length} available models matched in llm-stats. Colour = cost tier. Scores are percentiles across the llm-stats catalog (100 = best).`}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor="metric" className="text-sm text-text-muted">Metric</label>
        <select id="metric" value={active} onChange={(e) => setMetric(e.target.value)}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm">
          {metrics.map((k) => <option key={k} value={k}>{k.replaceAll("_", " ")}</option>)}
        </select>
        <ul className="ml-auto flex flex-wrap gap-3 text-xs text-text-muted" aria-label="Legend">
          {Object.entries(TIER_COLOR).map(([t, c]) => (
            <li key={t} className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full" style={{ background: c }} />{t}</li>
          ))}
        </ul>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-medium">Top {Math.min(TOP_N, rows.length)} by {active?.replaceAll("_", " ")}</h3>
          <RankBars rows={rows.slice(0, TOP_N)} metric={active} />
        </section>
        <section>
          <h3 className="mb-2 text-sm font-medium">Score vs price</h3>
          <ScoreVsPrice rows={rows} metric={active} />
        </section>
      </div>
    </Card>
  );
}
