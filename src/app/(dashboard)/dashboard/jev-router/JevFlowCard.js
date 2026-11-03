"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { sankey, sankeyLinkHorizontal, sankeyLeft } from "d3-sankey";
import { Card, Button } from "@/shared/components";

const NO_DECISION = "no decision (fallback order)";
const M = { top: 8, right: 8, bottom: 8, left: 8 };

// Combo → chosen model → provider (model prefix before "/"), from the kept Jev logs.
// Node ids are prefixed so a combo, model and provider can share a name.
function toGraph(flows) {
  const nodes = new Map();
  const links = new Map();
  const add = (id, name, side) => nodes.has(id) || nodes.set(id, { id, name, side });
  const link = (source, target, n) => {
    const k = `${source}\n${target}`;
    links.set(k, { source, target, value: (links.get(k)?.value || 0) + n });
  };
  for (const f of flows) {
    const s = `c:${f.combo || "—"}`, t = `m:${f.choice || NO_DECISION}`;
    add(s, f.combo || "—", "combo");
    add(t, f.choice || NO_DECISION, "model");
    link(s, t, f.n);
    if (!f.choice) continue;
    const provider = f.choice.includes("/") ? f.choice.split("/")[0] : "—";
    add(`p:${provider}`, provider, "provider");
    link(t, `p:${provider}`, f.n);
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}

function Sankey({ flows }) {
  const box = useRef(null);
  const svgRef = useRef(null);
  const [width, setWidth] = useState(720);
  const { nodes } = toGraph(flows);
  const height = Math.max(240, ...["combo", "model", "provider"].map((s) => nodes.filter((n) => n.side === s).length * 28));

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
    const total = d3.sum(g.nodes.filter((n) => n.side === "combo"), (n) => n.value);
    const pct = (v) => `${Math.round((v / total) * 100)}%`;

    svg.append("g").attr("fill", "none").selectAll("path").data(g.links).join("path")
      .attr("d", sankeyLinkHorizontal()).attr("stroke", (l) => color(l.target.side === "provider" ? l.target.id : l.source.id))
      .attr("stroke-opacity", (l) => (l.target.name === NO_DECISION ? 0.15 : 0.4)).attr("stroke-width", (l) => Math.max(1, l.width))
      .append("title").text((l) => `${l.source.name} → ${l.target.name}: ${l.value} (${pct(l.value)})`);

    svg.append("g").selectAll("rect").data(g.nodes).join("rect")
      .attr("x", (n) => n.x0).attr("y", (n) => n.y0).attr("width", (n) => n.x1 - n.x0).attr("height", (n) => Math.max(1, n.y1 - n.y0))
      .attr("rx", 2).attr("fill", (n) => (n.side !== "model" ? color(n.id) : n.name === NO_DECISION ? "#94a3b8" : "currentColor"))
      .append("title").text((n) => `${n.name}: ${n.value} (${pct(n.value)})`);

    svg.append("g").attr("font-size", 11).attr("fill", "currentColor").selectAll("text").data(g.nodes).join("text")
      .attr("x", (n) => (n.x0 < width / 2 ? n.x1 + 6 : n.x0 - 6)).attr("y", (n) => (n.y0 + n.y1) / 2).attr("dy", "0.35em")
      .attr("text-anchor", (n) => (n.x0 < width / 2 ? "start" : "end"))
      .text((n) => `${n.name.length > 40 ? `${n.name.slice(0, 39)}…` : n.name} · ${n.value}`);
  }, [flows, width, height]);

  return (
    <div ref={box}>
      <svg ref={svgRef} width={width} height={height} role="img"
        aria-label={`Jev routing flows: ${flows.map((f) => `${f.combo || "—"} to ${f.choice || NO_DECISION}, ${f.n}`).join("; ")}`} />
    </div>
  );
}

export default function JevFlowCard() {
  const [flows, setFlows] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => fetch("/api/jev-logs?flows=1").then((r) => r.json())
    .then((d) => (d.error ? setMsg(d.error) : setFlows(d.flows))).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  return (
    <Card
      title="Routing flow"
      subtitle="Where Jev sent each combo's requests, and which provider served them (last 1000 decisions). Link width = number of requests; hover for counts."
      action={<Button size="sm" variant="secondary" onClick={load}>Refresh</Button>}
    >
      {msg && <p className="mb-2 text-sm text-text-muted" role="status">{msg}</p>}
      {!flows ? <p className="text-sm text-text-muted">Loading…</p>
        : !flows.length ? <p className="text-sm text-text-muted">No decisions yet.</p>
        : <Sankey flows={flows} />}
    </Card>
  );
}
