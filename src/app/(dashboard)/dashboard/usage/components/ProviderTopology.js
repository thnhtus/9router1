"use client";

// Visual clone of affectUI "Agent Graph" (captured with REA): hub + discs, orthogonal
// rounded links, pulses travelling along live links, breathing ring on busy nodes.
import { useMemo, useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderIconSrc, markProviderIconMissing } from "@/shared/utils/providerIcon";

// Force-stop FE animation if a provider stays active longer than this
const FE_ACTIVE_TIMEOUT_MS = 60000;
const FE_ACTIVE_TICK_MS = 1000;

const GAP_X = 96; // column pitch
const ROW = 110; // row pitch
const BUS = 40; // bus line distance from its row
const PAD = 64;
const D = 40; // provider disc
const HUB_D = 56;
const R = 8; // corner radius
const MAX_COLS = 8;

// Slots alternate around the trunk (-0.5, +0.5, -1.5, ...) so no disc ever sits on it.
const slot = (j) => (j % 2 === 0 ? -1 : 1) * (Math.floor(j / 2) + 0.5);

// Trunk from hub (x0,y0) to bus y, along the bus to x, then into the node at y.
function linkPath(x0, y0, busY, x, y) {
  const dy = Math.sign(busY - y0);
  const dx = Math.sign(x - x0);
  return `M${x0} ${y0}L${x0} ${busY - dy * R}Q${x0} ${busY} ${x0 + dx * R} ${busY}`
    + `L${x - dx * R} ${busY}Q${x} ${busY} ${x} ${busY + dy * R}L${x} ${y}`;
}

function buildLayout(providers) {
  const n = providers.length;
  const perSide = Math.ceil(n / 2);
  const cols = Math.min(MAX_COLS, Math.max(2, perSide + (perSide % 2)));
  const rowsTop = Math.ceil(perSide / cols);
  const rowsBottom = Math.ceil((n - perSide) / cols);
  const width = cols * GAP_X + PAD * 2;
  const cx = width / 2;
  const cy = PAD + 24 + Math.max(rowsTop, 1) * ROW;
  const height = cy + Math.max(rowsBottom, 1) * ROW + PAD;

  const nodes = providers.map((p, i) => {
    const top = i < perSide;
    const k = top ? i : i - perSide;
    const row = Math.floor(k / cols);
    const dir = top ? -1 : 1;
    const x = cx + slot(k % cols) * GAP_X;
    const y = cy + dir * (row + 1) * ROW;
    return { p, x, y, top, path: linkPath(cx, cy, y - dir * BUS, x, y) };
  });
  return { nodes, width, height, cx, cy };
}

function ProviderDisc({ node, state, onIconError, iconFailed }) {
  const { p, x, y, top } = node;
  const config = AI_PROVIDERS[p.provider] || { color: "#6b7280", name: p.provider };
  const label = (config.name !== p.provider ? config.name : null) || p.nodeName || p.name || p.provider;
  const src = iconFailed ? null : getProviderIconSrc(p.provider);
  const initials = config.textIcon || (p.provider || "?").slice(0, 2).toUpperCase();
  const r = D / 2;
  return (
    <g className="pt-node" data-status={state} transform={`translate(${x} ${y})`}>
      <title>{`${label}${state !== "idle" ? ` · ${state}` : ""}`}</title>
      {state === "active" && <circle className="pt-ring" r={r} />}
      <circle className="pt-disc" r={r} />
      {state === "error" && <circle className="pt-spin" r={r + 0.5} pathLength="1" />}
      {src ? (
        <image
          href={src} x={-10} y={-10} width={20} height={20}
          preserveAspectRatio="xMidYMid meet"
          onError={() => onIconError(p.provider, src)}
        />
      ) : (
        <text className="pt-initials" dy="0.35em" fill={config.color}>{initials}</text>
      )}
      {state === "last" && <circle className="pt-badge" cx={r * 0.72} cy={-r * 0.72} r={4} />}
      <text className="pt-name" y={top ? -r - 10 : r + 16}>
        {label.length > 16 ? `${label.slice(0, 15)}…` : label}
      </text>
    </g>
  );
}

ProviderDisc.propTypes = {
  node: PropTypes.object.isRequired,
  state: PropTypes.string.isRequired,
  onIconError: PropTypes.func.isRequired,
  iconFailed: PropTypes.bool,
};

export default function ProviderTopology({ providers = [], activeRequests = [], lastProvider = "", errorProvider = "" }) {
  // Serialize to stable string keys so useMemo only re-runs when values actually change
  const activeKey = useMemo(
    () => activeRequests.map((r) => r.provider?.toLowerCase()).filter(Boolean).sort().join(","),
    [activeRequests]
  );
  const rawActiveSet = useMemo(() => new Set(activeKey ? activeKey.split(",") : []), [activeKey]);
  const lastKey = lastProvider?.toLowerCase() || "";
  const errorKey = errorProvider?.toLowerCase() || "";

  // Track firstSeen per active provider; drop provider if running too long (BE stuck)
  const firstSeenRef = useRef({});
  const [staleKey, setStaleKey] = useState("");

  useEffect(() => {
    const seen = firstSeenRef.current;
    const now = Date.now();
    for (const p of rawActiveSet) if (!seen[p]) seen[p] = now;
    for (const p of Object.keys(seen)) if (!rawActiveSet.has(p)) delete seen[p];
    if (rawActiveSet.size === 0) return;
    const id = setInterval(() => {
      const t = Date.now();
      setStaleKey([...rawActiveSet].filter((p) => t - seen[p] >= FE_ACTIVE_TIMEOUT_MS).join(","));
    }, FE_ACTIVE_TICK_MS);
    return () => clearInterval(id);
  }, [rawActiveSet]);

  const activeSet = useMemo(() => {
    const stale = new Set(staleKey.split(","));
    return new Set([...rawActiveSet].filter((p) => !stale.has(p)));
  }, [rawActiveSet, staleKey]);

  const [failedIcons, setFailedIcons] = useState({});
  const onIconError = (id, src) => {
    const m = src?.match(/^\/providers\/([^/]+)\.png$/i);
    if (m) markProviderIconMissing(m[1]);
    setFailedIcons((f) => ({ ...f, [id]: true }));
  };

  const layout = useMemo(() => buildLayout(providers), [providers]);
  const stateOf = (id) => {
    const k = id?.toLowerCase();
    if (activeSet.has(k)) return "active";
    if (errorKey === k) return "error";
    if (lastKey === k) return "last";
    return "idle";
  };
  const busy = activeSet.size > 0;
  const { nodes, width, height, cx, cy } = layout;

  return (
    <div className="pt-graph flex min-w-0 flex-col rounded-lg border border-border bg-muted/30 p-3">
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-primary">
          <path d="M8 8.4 3.2 4M8 8.4l5-4.2M8 8.4l4.4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
          <circle cx="8" cy="8.4" r="2.4" fill="currentColor" />
          <circle cx="3.2" cy="4" r="1.6" fill="currentColor" />
          <circle cx="13" cy="4.2" r="1.6" fill="currentColor" />
          <circle cx="12.4" cy="12.4" r="1.6" fill="currentColor" />
        </svg>
        <span className="text-sm font-medium text-text-main">Provider topology</span>
        <span className="ml-auto flex gap-3 tabular-nums text-text-muted">
          <span><b className="font-medium text-text-main">{providers.length}</b> providers</span>
          <span><b className="font-medium text-text-main">{activeSet.size}</b> active</span>
          {errorKey && <span className="font-medium text-danger">error: {errorKey}</span>}
        </span>
      </header>
      <div className="relative flex min-h-[280px] flex-1 items-center justify-center overflow-hidden rounded-[10px] bg-surface shadow-[0_0_0_0.5px_var(--color-border)]">
        {providers.length === 0 ? (
          <span className="text-sm text-text-muted">No providers connected</span>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="block h-auto max-h-[480px] w-full"
            role="img"
            aria-label={`Provider topology: ${providers.length} providers, ${activeSet.size} active`}
          >
            <defs>
              <radialGradient id="pt-glow">
                <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0.18" />
                <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse className="pt-halo" data-on={busy || undefined} cx={cx} cy={cy} rx={width * 0.22} ry={ROW * 0.9} fill="url(#pt-glow)" />
            <g>
              {/* Idle first so highlighted links aren't painted over on the shared trunk */}
              {[...nodes].sort((a, b) => (stateOf(a.p.provider) !== "idle") - (stateOf(b.p.provider) !== "idle")).map((n) => (
                <path key={n.p.provider} className="pt-edge" data-status={stateOf(n.p.provider)} d={n.path} pathLength="1" />
              ))}
            </g>
            <g>
              {nodes.filter((n) => stateOf(n.p.provider) === "active").map((n, i) => (
                <g key={n.p.provider} style={{ "--pt-delay": `${i * 180}ms` }}>
                  <path className="pt-pulse pt-pulse-glow" d={n.path} pathLength="1" />
                  <path className="pt-pulse" d={n.path} pathLength="1" />
                  <path className="pt-pulse pt-pulse-res" d={n.path} pathLength="1" />
                </g>
              ))}
            </g>
            {nodes.map((n) => (
              <ProviderDisc
                key={n.p.provider}
                node={n}
                state={stateOf(n.p.provider)}
                onIconError={onIconError}
                iconFailed={!!failedIcons[n.p.provider]}
              />
            ))}
            <g className="pt-node pt-hub" data-status={busy ? "active" : "idle"} transform={`translate(${cx} ${cy})`}>
              <title>{`9Router · ${activeSet.size} active`}</title>
              {busy && <circle className="pt-ring" r={HUB_D / 2} />}
              <circle className="pt-disc" r={HUB_D / 2} />
              <image href="/favicon.svg" x={-13} y={-13} width={26} height={26} />
              <text className="pt-name pt-hub-name" y={HUB_D / 2 + 16}>9Router</text>
              {busy && (
                <g transform={`translate(${HUB_D * 0.36} ${-HUB_D * 0.36})`}>
                  <circle className="pt-count" r={9} />
                  <text className="pt-count-text" dy="0.35em">{activeSet.size}</text>
                </g>
              )}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}

ProviderTopology.propTypes = {
  providers: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    provider: PropTypes.string,
    name: PropTypes.string,
  })),
  activeRequests: PropTypes.arrayOf(PropTypes.shape({
    provider: PropTypes.string,
    model: PropTypes.string,
    account: PropTypes.string,
  })),
  lastProvider: PropTypes.string,
  errorProvider: PropTypes.string,
};
