"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Card, Button, SegmentedControl } from "@/shared/components";

const WINDOWS = [{ value: "24", label: "24h" }, { value: "168", label: "7d" }, { value: "720", label: "30d" }];
// Per request, exactly one outcome for lossy savers (Headroom/Caveman).
const KEYS = [
  { key: "lossyApplied", label: "Lossy applied", color: "#10b981" },
  { key: "lossyBlocked", label: "Blocked by Jev", color: "#f59e0b" },
  { key: "lossyOff", label: "Lossy off in settings", color: "#94a3b8" },
  { key: "other", label: "Not applied (other)", color: "#cbd5e1" },
];
const M = { top: 8, right: 16, bottom: 24, left: 72 };
const fmt = d3.format(",");

function LevelBars({ rows }) {
  const box = useRef(null);
  const svgRef = useRef(null);
  const [width, setWidth] = useState(720);
  const height = M.top + M.bottom + rows.length * 32;

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const data = rows.map((r) => ({
      ...r,
      name: r.level || "No Jev signal",
      other: Math.max(0, r.total - r.lossyApplied - r.lossyBlocked - r.lossyOff),
    }));
    const series = d3.stack().keys(KEYS.map((k) => k.key))(data);
    const x = d3.scaleLinear().domain([0, d3.max(data, (d) => d.total) || 1]).nice().range([M.left, width - M.right]);
    const y = d3.scaleBand().domain(data.map((d) => d.name)).range([M.top, height - M.bottom]).padding(0.25);
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    svg.append("g").selectAll("g").data(series).join("g")
      .attr("fill", (s) => KEYS.find((k) => k.key === s.key).color)
      .selectAll("rect").data((s) => s.map((d) => ({ ...d, key: s.key }))).join("rect")
      .attr("x", (d) => x(d[0])).attr("y", (d) => y(d.data.name))
      .attr("width", (d) => Math.max(0, x(d[1]) - x(d[0]))).attr("height", y.bandwidth())
      .append("title").text((d) => `${d.data.name} · ${KEYS.find((k) => k.key === d.key).label}: ${fmt(d[1] - d[0])} / ${fmt(d.data.total)}`);

    svg.append("g").attr("transform", `translate(0,${height - M.bottom})`)
      .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(width / 100))).tickFormat(d3.format("~s")))
      .attr("font-size", 11);
    svg.append("g").attr("transform", `translate(${M.left},0)`).call(d3.axisLeft(y).tickSize(0)).attr("font-size", 11)
      .call((g) => g.select(".domain").remove());
  }, [rows, width, height]);

  return (
    <div ref={box}>
      <svg ref={svgRef} width={width} height={height} role="img"
        aria-label={`Lossy saver outcome by Jev task level: ${rows.map((r) => `${r.level || "no signal"} ${r.lossyApplied} applied, ${r.lossyBlocked} blocked of ${r.total}`).join("; ")}`} />
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-text-muted">
        {KEYS.map((k) => (
          <span key={k.key} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: k.color }} />{k.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "" }) {
  return (
    <div>
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

export default function JevSaverCard() {
  const [hours, setHours] = useState("168");
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const load = (h = hours) => fetch(`/api/token-saver/stats?hours=${h}`).then((r) => r.json())
    .then((d) => (d.error ? setMsg(d.error) : (setMsg(""), setData(d)))).catch((e) => setMsg(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load() is a fire-and-forget fetch keyed by `hours`
  useEffect(() => { load(hours); }, [hours]);

  const s = data?.summary;
  return (
    <Card
      id="saver-stats"
      title="Token saver × Jev"
      subtitle="How Jev's task level gated lossy savers (Headroom, Caveman). L1/L2 with confident classification allow lossy compression; L3/L4 keep full fidelity. Hover bars for counts."
      action={
        <div className="flex items-center gap-2">
          <SegmentedControl size="sm" value={hours} onChange={setHours} options={WINDOWS} />
          <Button size="sm" variant="secondary" onClick={() => load()}>Refresh</Button>
        </div>
      }
    >
      {msg && <p className="mb-2 text-sm text-text-muted" role="status">{msg}</p>}
      {!data ? <p className="text-sm text-text-muted">Loading…</p>
        : !s.total ? <p className="text-sm text-text-muted">No requests recorded yet in this window.</p>
        : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <Stat label="Requests" value={fmt(s.total)} />
              <Stat label="Lossy applied" value={fmt(s.lossyApplied)} tone="text-success" />
              <Stat label="Blocked by Jev" value={fmt(s.lossyBlocked)} tone="text-warning" />
              <Stat label="RTK hits" value={fmt(s.rtkHits)} />
              <Stat label="Headroom tokens saved" value={fmt(s.headroomSaved)} tone="text-success" />
            </div>
            <LevelBars rows={data.byLevel} />
          </div>
        )}
    </Card>
  );
}
