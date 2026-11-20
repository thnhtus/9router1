"use client";
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { sankey, sankeyLinkHorizontal, sankeyLeft } from "d3-sankey";
import { Card } from "@/shared/components";

const M = { top: 8, right: 8, bottom: 8, left: 8 };
const STATE_COLOR = { ready: "#22c55e", installed: "#38bdf8", "never connected": "#94a3b8", missing: "#ef4444", unknown: "#a1a1aa" };

// Pi (source) → category → server, weighted by exposed tools (1 when the server was
// never connected, so it still shows up). Same shape as the Routing flow chart.
function toGraph(servers) {
  const nodes = new Map();
  const links = new Map();
  const add = (id, name, side) => nodes.has(id) || nodes.set(id, { id, name, side });
  const link = (source, target, n) => {
    const k = `${source}\n${target}`;
    links.set(k, { source, target, value: (links.get(k)?.value || 0) + n });
  };
  add("p:Pi", "Pi", "source");
  for (const s of servers) {
    const c = `c:${s.category || "Other"}`, n = `n:${s.name}`, w = Math.max(1, Number(s.tools) || 0);
    add(c, s.category || "Other", "category");
    add(n, s.name, "server");
    link("p:Pi", c, w);
    link(c, n, w);
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}

const callText = (n) => (n > 0 ? ` · ${n} call${n === 1 ? "" : "s"}` : "");
const toolText = (n) => `${n} tool${n === 1 ? "" : "s"}`;

function nodeLabel(n, ctx) {
  const name = n.name.length > 32 ? `${n.name.slice(0, 31)}…` : n.name;
  const calls = n.side === "server" ? ctx.calls(n.name) : n.side === "category" ? ctx.reqByCat[n.name] || 0 : ctx.totalRequests;
  return `${name} · ${toolText(n.value)}${callText(calls)}`;
}

function nodeTitle(n, ctx, stateOf) {
  const calls = n.side === "server" ? ctx.calls(n.name) : n.side === "category" ? ctx.reqByCat[n.name] || 0 : ctx.totalRequests;
  const head = n.side === "server" ? `${n.name} (${stateOf.get(n.id)})` : n.name;
  return `${head}: ${toolText(n.value)}${callText(calls)}`;
}

function linkTitle(l, ctx, pct) {
  const calls = l.target.side === "server" ? ctx.calls(l.target.name) : ctx.reqByCat[l.target.name] || 0;
  return `${l.source.name} → ${l.target.name}: ${toolText(l.value)} (${pct(l.value)})${callText(calls)}`;
}

function Sankey({ servers, requests = {} }) {
  const box = useRef(null);
  const svgRef = useRef(null);
  const [width, setWidth] = useState(720);
  const { nodes } = toGraph(servers);
  const height = Math.max(200, ...["source", "category", "server"].map((s) => nodes.filter((n) => n.side === s).length * 32));

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    const reqByServer = new Map(Object.entries(requests));
    const reqByCat = servers.reduce((acc, s) => {
      const k = s.category || "Other";
      acc[k] = (acc[k] || 0) + (Number(reqByServer.get(s.name)) || 0);
      return acc;
    }, {});
    const totalRequests = Object.values(requests).reduce((a, n) => a + (Number(n) || 0), 0);
    const g = sankey().nodeId((d) => d.id).nodeAlign(sankeyLeft).nodeWidth(12).nodePadding(13)
      .extent([[M.left, M.top], [width - M.right, height - M.bottom]])(toGraph(servers));
    const color = d3.scaleOrdinal(d3.schemeTableau10);
    const stateOf = new Map(servers.map((s) => [`n:${s.name}`, s.state]));
    const total = d3.sum(g.links.filter((l) => l.target.side === "server"), (l) => l.value) || 1;
    const pct = (v) => `${Math.round((v / total) * 100)}%`;
    const ctx = { reqByCat, totalRequests, calls: (name) => Number(reqByServer.get(name)) || 0 };

    svg.append("g").attr("fill", "none").selectAll("path").data(g.links).join("path")
      .attr("d", sankeyLinkHorizontal()).attr("stroke", (l) => color(l.source.id))
      .attr("stroke-opacity", (l) => (l.target.side === "server" ? 0.35 : 0.2)).attr("stroke-width", (l) => Math.max(1, l.width))
      .append("title").text((l) => linkTitle(l, ctx, pct));

    svg.append("g").selectAll("rect").data(g.nodes).join("rect")
      .attr("x", (n) => n.x0).attr("y", (n) => n.y0).attr("width", (n) => n.x1 - n.x0).attr("height", (n) => Math.max(1, n.y1 - n.y0))
      .attr("rx", 2)
      .attr("fill", (n) => (n.side === "source" ? "currentColor" : n.side === "category" ? color(n.id) : STATE_COLOR[stateOf.get(n.id)] || "currentColor"))
      .append("title").text((n) => nodeTitle(n, ctx, stateOf));

    svg.append("g").attr("font-size", 11).attr("fill", "currentColor").selectAll("text").data(g.nodes).join("text")
      .attr("x", (n) => (n.x0 < width / 2 ? n.x1 + 6 : n.x0 - 6)).attr("y", (n) => (n.y0 + n.y1) / 2).attr("dy", "0.35em")
      .attr("text-anchor", (n) => (n.x0 < width / 2 ? "start" : "end"))
      .text((n) => nodeLabel(n, ctx));
  }, [servers, width, height, requests]);

  return (
    <div ref={box}>
      <svg ref={svgRef} width={width} height={height} role="img"
        aria-label={`MCP servers by category: ${servers.map((s) => `${s.name} in ${s.category}, ${s.tools ?? 0} tools, ${s.state}`).join("; ")}`} />
    </div>
  );
}

export default function McpStats({ servers = [], requests = {} }) {
  const ready = servers.filter((s) => s.state === "ready").length;
  const tools = servers.reduce((a, s) => a + Math.max(1, Number(s.tools) || 0), 0);
  const totalRequests = Object.values(requests).reduce((a, n) => a + (Number(n) || 0), 0);
  const categories = new Set(servers.map((s) => s.category || "Other"));

  return (
    <Card
      title="MCP layout"
      subtitle="Which category each MCP server belongs to, band width = exposed tools. Server colour = connection state; call counts come from Pi MCP tool calls (30d). Hover for details."
      action={<span className="text-xs text-muted-foreground">{categories.size} categories · {servers.length} servers</span>}
    >
      {servers.length === 0 ? (
        <p className="text-sm text-text-muted">No MCP servers configured.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            {servers.length} servers · {ready} connected · {toolText(tools)} · {totalRequests} Pi MCP calls (30d)
            {" · "}
            {[...categories].join(" · ")}
          </p>
          <Sankey servers={servers} requests={requests} />
        </>
      )}
    </Card>
  );
}
