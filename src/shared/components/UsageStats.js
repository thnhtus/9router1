"use client";

import { useState, useEffect, useRef } from "react";
import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";

// Keep providers without serviceKinds (default LLM) or with "llm" in serviceKinds
function isLLMProvider(id) {
  const p = AI_PROVIDERS[id];
  if (!p?.serviceKinds) return true;
  return p.serviceKinds.includes("llm");
}
import Card from "./Card";
import SegmentedControl from "./SegmentedControl";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
const fmt = (n) => new Intl.NumberFormat().format(n || 0);
import dynamic from "next/dynamic";
// Lazy-load: keeps recharts out of the initial bundle
const ProviderTopology = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/ProviderTopology"), { ssr: false });
const LiveQueue = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/LiveQueue"), { ssr: false });
const UsageCalendar = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/UsageCalendar"), { ssr: false });
const ProviderBarChart = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/ProviderBarChart"), { ssr: false });
const UsageLinesChart = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/UsageLinesChart"), { ssr: false });
const TopModelsChart = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/TopModelsChart"), { ssr: false });

function timeAgo(timestamp) {
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Auto-update time display every second without re-rendering parent
function TimeAgo({ timestamp }) {
  const [, setTick] = useState(0);
  
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  
  return <>{timeAgo(timestamp)}</>;
}

function RecentRequests({ requests = [] }) {
  return (
    <Card title="Recent Requests" className="flex h-[480px] min-w-0 flex-col overflow-hidden lg:h-auto" padding="sm">

      {!requests.length ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No requests yet.</div>
      ) : (
        // Absolute scroller: rows don't grow the grid row, so height follows Provider topology
        <div className="relative flex-1"><div className="absolute inset-0 overflow-y-auto">
          <table className="w-full min-w-[300px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border">
                <th className="w-3 py-1.5"><span className="sr-only">Status</span></th>
                <th className="py-1.5 text-left font-medium text-muted-foreground">Model</th>
                <th className="py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap">In / Out</th>
                <th className="py-1.5 text-right font-medium text-muted-foreground">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {requests.map((r, i) => {
                const ok = !r.status || r.status === "ok" || r.status === "success";
                return (
                  <tr key={i} className="hover:bg-muted/40">
                    <td className="py-1.5">
                      <span title={ok ? "OK" : "Failed"} className={`block size-1.5 rounded-full ${ok ? "bg-success" : "bg-danger"}`} />
                    </td>
                    <td className="max-w-[160px] py-1.5" title={r.seat ? `${r.model} · ${r.seat}` : r.model}>
                      <div className="truncate font-mono">{r.model}</div>
                      {r.seat && <div className="truncate text-[10px] text-muted-foreground">{r.seat}</div>}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap tabular-nums">
                      <span className="font-semibold text-primary">{fmt(r.promptTokens)}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="font-semibold text-success">{fmt(r.completionTokens)}</span>
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground whitespace-nowrap"><TimeAgo timestamp={r.timestamp} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      )}
    </Card>
  );
}

const TABLE_OPTIONS = [
  { value: "model", label: "Usage by Model" },
  { value: "account", label: "Usage by Account" },
  { value: "apiKey", label: "Usage by API Key" },
  { value: "endpoint", label: "Usage by Endpoint" },
  { value: "agent", label: "Usage by Rig / Seat" },
];

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];

export default function UsageStats({ period: periodProp, setPeriod: setPeriodProp, hidePeriodSelector = false } = {}) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [tableView, setTableView] = useState("model");
  const [providers, setProviders] = useState([]);
  const [periodLocal, setPeriodLocal] = useState("today");
  const isInitialLoad = useRef(true);
  const hasLoadedStats = useRef(false);
  const period = periodProp ?? periodLocal;
  const setPeriod = setPeriodProp ?? setPeriodLocal;

  // Fetch connected providers once, deduplicate by provider type
  // Always include noAuth free providers (e.g. opencode) regardless of connections
  useEffect(() => {
    Promise.all([
      fetch("/api/providers").then((r) => r.ok ? r.json() : null),
      fetch("/api/provider-nodes").then((r) => r.ok ? r.json() : null),
    ])
      .then(([d, nodesData]) => {
        // Build node name lookup for custom providers
        const nodeNameMap = {};
        for (const node of (nodesData?.nodes || [])) {
          nodeNameMap[node.id] = node.name;
        }
        const seen = new Set();
        const unique = (d?.connections || []).filter((c) => {
          if (c.isActive === false) return false;
          if (!isLLMProvider(c.provider)) return false;
          if (AI_PROVIDERS[c.provider]?.hidden) return false;
          if (seen.has(c.provider)) return false;
          seen.add(c.provider);
          return true;
        }).map((c) => ({
          ...c,
          nodeName: nodeNameMap[c.provider] || null,
        }));
        const noAuthProviders = Object.values(FREE_PROVIDERS)
          .filter((p) => p.noAuth && !p.hidden && !seen.has(p.id) && isLLMProvider(p.id))
          .map((p) => ({ provider: p.id, name: p.name }));
        setProviders([...unique, ...noAuthProviders]);
      })
      .catch(() => {});
  }, []);

  // Fetch filtered stats via REST when period changes
  useEffect(() => {
    // First load: show full spinner; subsequent: show subtle fetching indicator
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      setLoading(true);
    } else {
      setFetching(true);
    }

    fetch(`/api/usage/stats?period=${period}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          hasLoadedStats.current = true;
          setStats((prev) => ({ ...prev, ...data }));
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setFetching(false);
      });
  }, [period]);

  // SSE connection - real-time updates for activeRequests + recentRequests only
  useEffect(() => {
    const es = new EventSource("/api/usage/stream");

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        // Always merge only real-time fields, never overwrite full stats from REST
        setStats((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activeRequests: data.activeRequests,
            recentRequests: data.recentRequests,
            errorProvider: data.errorProvider,
            pending: data.pending,
            today: data.today,
          };
        });
        if (hasLoadedStats.current) setLoading(false);
      } catch (err) {
        console.error("[SSE CLIENT] parse error:", err);
      }
    };

    es.onerror = () => setLoading(false);

    return () => es.close();
  }, []);

  if (!stats && !loading) return <div className="py-12 text-center text-sm text-muted-foreground">Failed to load usage statistics.</div>;

  const spinner = (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <span className="material-symbols-outlined text-[24px] animate-spin motion-reduce:animate-none" aria-label="Loading">progress_activity</span>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Period selector (hidden when controlled by parent) */}
      {!hidePeriodSelector && (
        <div className="flex w-full items-center gap-2 sm:w-auto sm:self-end">
          <SegmentedControl className="flex-1 sm:flex-none" value={period} onChange={setPeriod} options={PERIODS} disabled={fetching} />
          {fetching && (
            <span className="material-symbols-outlined text-[16px] text-muted-foreground animate-spin">progress_activity</span>
          )}
        </div>
      )}

      {/* Overview cards */}
      {loading ? spinner : <OverviewCards stats={stats} />}

      {/* Live queue: in-flight lanes + depth over the last 96s */}
      {!loading && (
        <LiveQueue
          activeRequests={stats.activeRequests || []}
          recentRequests={stats.recentRequests || []}
          last10Minutes={stats.last10Minutes || []}
          today={stats.today || {}}
          errorProvider={stats.errorProvider || ""}
        />
      )}

      {/* Provider topology + Recent Requests */}
      {loading ? spinner : (
        <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <ProviderTopology
            providers={providers}
            activeRequests={stats.activeRequests || []}
            lastProvider={stats.recentRequests?.[0]?.provider || ""}
            errorProvider={stats.errorProvider || ""}
          />
          <RecentRequests requests={stats.recentRequests || []} />
        </div>
      )}

      {/* Activity: daily token calendar, always full history */}
      {loading ? spinner : <UsageCalendar />}

      {/* Provider and model breakdown charts */}
      {!loading && (stats.byProvider || stats.byModel) && (
        <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
          <ProviderBarChart byProvider={stats.byProvider} />
          <TopModelsChart byModel={stats.byModel} />
        </div>
      )}

      {/* Usage breakdown line chart with dropdown selector */}
      <div className="flex flex-col gap-3">
        <select
          value={tableView}
          aria-label="Group usage by"
          onChange={(e) => setTableView(e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 sm:w-auto sm:self-start"
          style={{ colorScheme: 'auto' }}
        >
          {TABLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {!loading && (
          <UsageLinesChart
            key={tableView}
            period={period}
            dim={tableView}
            title={TABLE_OPTIONS.find((o) => o.value === tableView).label}
          />
        )}
      </div>
    </div>
  );
}
