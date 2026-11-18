"use client";
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { sankey, sankeyLinkHorizontal, sankeyLeft } from "d3-sankey";
import { Card, Button } from "@/shared/components";

const WINDOWS = [
  { value: 24, label: "24h" },
  { value: 168, label: "7d" },
  { value: 720, label: "30d" },
];
const M = { top: 8, right: 8, bottom: 8, left: 8 };

// Source (jev / llm / embedding) → skill category → injected skill, from the kept
// hourly counters. Node ids are prefixed so a source, category and skill can share a name.
function toGraph(flows) {
  const nodes = new Map();
  const links = new Map();
  const add = (id, name, side) => nodes.has(id) || nodes.set(id, { id, name, side });
  const link = (source, target, n) => {
    const k = `${source}\n${target}`;
    links.set(k, { source, target, value: (links.get(k)?.value || 0) + n });
  };
  for (const f of flows) {
    const s = `s:${f.source || "—"}`, c = `c:${f.category || "Other"}`, t = `k:${f.target}`;
    add(s, f.source || "—", "source");
    add(c, f.category || "Other", "category");
    add(t, f.target, "skill");
    link(s, c, f.n);
    link(c, t, f.n);
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}

function Sankey({ flows }) {
  const box = useRef(null);
  const svgRef = useRef(null);
  const [width, setWidth] = useState(720);
  const { nodes } = toGraph(flows);
  const height = Math.max(240, ...["source", "category", "skill"].map((s) => nodes.filter((n) => n.side === s).length * 28));

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    const g = sankey().nodeId((d) => d.id).nodeAlign(sankeyLeft).nodeWidth(12).nodePadding(10)
      .extent([[M.left, M.top], [width - M.right, height - M.bottom]])(toGraph(flows));
    const color = d3.scaleOrdinal(d3.schemeTableau10);
    const total = d3.sum(g.nodes.filter((n) => n.side === "source"), (n) => n.value) || 1;
    const pct = (v) => `${Math.round((v / total) * 100)}%`;

    svg.append("g").attr("fill", "none").selectAll("path").data(g.links).join("path")
      .attr("d", sankeyLinkHorizontal()).attr("stroke", (l) => color(l.source.id))
      .attr("stroke-opacity", (l) => (l.target.side === "skill" ? 0.4 : 0.25)).attr("stroke-width", (l) => Math.max(1, l.width))
      .append("title").text((l) => `${l.source.name} → ${l.target.name}: ${l.value} (${pct(l.value)})`);

    svg.append("g").selectAll("rect").data(g.nodes).join("rect")
      .attr("x", (n) => n.x0).attr("y", (n) => n.y0).attr("width", (n) => n.x1 - n.x0).attr("height", (n) => Math.max(1, n.y1 - n.y0))
      .attr("rx", 2).attr("fill", (n) => (n.side === "category" ? "currentColor" : color(n.side === "source" ? n.id : (g.links.find((l) => l.target.id === n.id)?.source.id || n.id))))
      .attr("opacity", (n) => (n.side === "category" ? 0.5 : 1))
      .append("title").text((n) => `${n.name}: ${n.value} (${pct(n.value)})`);

    svg.append("g").attr("font-size", 11).attr("fill", "currentColor").selectAll("text").data(g.nodes).join("text")
      .attr("x", (n) => (n.x0 < width / 2 ? n.x1 + 6 : n.x0 - 6)).attr("y", (n) => (n.y0 + n.y1) / 2).attr("dy", "0.35em")
      .attr("text-anchor", (n) => (n.x0 < width / 2 ? "start" : "end"))
      .text((n) => `${n.name.length > 40 ? `${n.name.slice(0, 39)}…` : n.name} · ${n.value}`);
  }, [flows, width, height]);

  return (
    <div ref={box}>
      <svg ref={svgRef} width={width} height={height} role="img"
        aria-label={`Skill auto-inject flows: ${flows.map((f) => `${f.source} to ${f.target}, ${f.n}`).join("; ")}`} />
    </div>
  );
}

export default function SkillPickStats() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");

  const load = () => {
    fetch(`/api/cli-tools/pi-settings/skill-stats?hours=${hours}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setMsg(d.error);
          return;
        }
        setMsg("");
        setData(d);
      })
      .catch((e) => setMsg(e.message));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);

  const flows = data?.flows || [];
  const bySource = data?.bySource || [];
  const totals = bySource.reduce((a, s) => ({ requests: a.requests + s.requests, withSkill: a.withSkill + s.withSkill }), { requests: 0, withSkill: 0 });
  const rate = totals.requests ? Math.round((totals.withSkill / totals.requests) * 100) : 0;

  return (
    <Card
      title="Skill picks"
      subtitle={`Which skill each source injected (last ${hours}h). Link width = number of requests; hover for counts.`}
      action={(
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button key={w.value} onClick={() => setHours(w.value)}
              className={`rounded px-2 py-1 text-xs ${hours === w.value ? "bg-primary text-white" : "text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"}`}>
              {w.label}
            </button>
          ))}
          <Button size="sm" variant="secondary" onClick={load}>Refresh</Button>
        </div>
      )}
    >
      {msg && <p className="mb-2 text-sm text-text-muted" role="status">{msg}</p>}
      {!data ? <p className="text-sm text-text-muted">Loading…</p>
        : !flows.length ? <p className="text-sm text-text-muted">No picks yet in the last {hours}h ({totals.requests} requests, none injected a skill).</p>
          : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {rate}% · {totals.withSkill} of {totals.requests} requests got a skill
                {bySource.map((s) => ` · ${s.source} ${s.withSkill}/${s.requests}`).join("")}
              </p>
              <Sankey flows={flows} />
            </>
          )}
    </Card>
  );
}
