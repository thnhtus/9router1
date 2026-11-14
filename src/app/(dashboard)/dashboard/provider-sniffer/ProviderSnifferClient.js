"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Badge, Modal } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";

const STATUS_BADGE = {
  candidate: { variant: "warning", label: "Candidate" },
  verified: { variant: "success", label: "Verified" },
  registered: { variant: "info", label: "Registered" },
  ignored: { variant: "default", label: "Ignored" },
  failed: { variant: "error", label: "Failed" },
};

export default function ProviderSnifferClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [testKey, setTestKey] = useState("");
  const [draftModal, setDraftModal] = useState({ open: false, code: "", filename: "", provider: null });
  const [addModal, setAddModal] = useState(false);

  // Form for manual add
  const [newProv, setNewProv] = useState({
    id: "",
    name: "",
    baseUrl: "",
    validateUrl: "",
    format: "openai",
    notice: "",
    noAuth: false,
  });

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/provider-sniffer");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const handleAction = async (action, id, payload = {}) => {
    setBusyId(id || action);
    try {
      const res = await fetch("/api/provider-sniffer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, ...payload }),
      });
      const json = await res.json();
      if (res.ok) {
        if (action === "scan") {
          alert(`Scanned ${json.scanned} providers from Free-LLM catalog — ${json.added} new candidate(s) added.`);
          await loadData();
        } else if (action === "crawlLogos") {
          alert(`Logos: ${json.fetched} fetched, ${json.skipped} already present, ${json.failed} failed.`);
          await loadData();
        } else if (action === "install") {
          alert(`Installed to open-sse/providers/registry/${json.filename} — restart the server to load it.`);
          setDraftModal({ open: false, code: "", filename: "", provider: null });
          await loadData();
        } else if (action === "generateDraft") {
          setDraftModal({
            open: true,
            code: json.draftCode,
            filename: json.filename,
            provider: id,
          });
        } else {
          await loadData();
        }
      } else {
        alert(json.error || "Action failed");
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!newProv.id || !newProv.baseUrl) {
      alert("ID & BaseURL are required");
      return;
    }
    await handleAction("add", null, { providerData: newProv });
    setAddModal(false);
    setNewProv({ id: "", name: "", baseUrl: "", validateUrl: "", format: "openai", notice: "", noAuth: false });
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-3xl text-muted-foreground">progress_activity</span>
      </div>
    );
  }

  const providers = data?.providers || [];
  const stats = data?.stats || { total: 0, candidate: 0, verified: 0, registered: 0, ignored: 0, failed: 0 };

  const filtered = providers.filter((p) => {
    if (filter !== "all" && p.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.name?.toLowerCase().includes(q) || p.id?.toLowerCase().includes(q) || p.baseUrl?.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-6 max-w-[140rem] mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-2xl!">radar</span>
            Provider Sniffer
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Discover, verify & catalog free LLM API providers across reach-mcp, last30days & last30flames sources.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadData()}>
            <span className="material-symbols-outlined text-sm">refresh</span> Refresh
          </Button>
          <Button variant="outline" size="sm" disabled={busyId === "scan"} onClick={() => handleAction("scan")}>
            <span className={`material-symbols-outlined text-sm ${busyId === "scan" ? "animate-spin" : ""}`}>
              {busyId === "scan" ? "sync" : "travel_explore"}
            </span>{" "}
            Scan Free-LLM
          </Button>
          <Button variant="outline" size="sm" disabled={busyId === "crawlLogos"} onClick={() => handleAction("crawlLogos")}>
            <span className={`material-symbols-outlined text-sm ${busyId === "crawlLogos" ? "animate-spin" : ""}`}>
              {busyId === "crawlLogos" ? "sync" : "image"}
            </span>{" "}
            Crawl Logos
          </Button>
          <Button variant="primary" size="sm" onClick={() => setAddModal(true)}>
            <span className="material-symbols-outlined text-sm">add</span> Add Candidate
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total Scanned</div>
          <div className="text-lg font-bold text-foreground mt-1">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Candidates</div>
          <div className="text-lg font-bold text-warning-foreground mt-1">{stats.candidate}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Verified</div>
          <div className="text-lg font-bold text-success-foreground mt-1">{stats.verified}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">In 9router Registry</div>
          <div className="text-lg font-bold text-info-foreground mt-1">{stats.registered}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Failed / Down</div>
          <div className="text-lg font-bold text-error-foreground mt-1">{stats.failed}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Ignored</div>
          <div className="text-lg font-bold text-muted-foreground mt-1">{stats.ignored}</div>
        </Card>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-card p-3 rounded-lg border border-border">
        <div className="flex flex-wrap items-center gap-1.5">
          {["all", "candidate", "verified", "registered", "failed", "ignored"].map((st) => (
            <button
              key={st}
              onClick={() => setFilter(st)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                filter === st ? "bg-primary text-primary-foreground font-semibold" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {st.charAt(0).toUpperCase() + st.slice(1)}
            </button>
          ))}
        </div>
        <div className="w-full sm:w-64">
          <Input
            placeholder="Search provider, URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>

      {/* Test Key Input bar */}
      <div className="flex items-center gap-3 bg-secondary/50 px-3 py-2 rounded-md border border-border text-xs">
        <span className="material-symbols-outlined text-muted-foreground text-sm">key</span>
        <span className="text-muted-foreground whitespace-nowrap">Optional Test Key for Verification:</span>
        <input
          type="password"
          placeholder="Paste API Key here (optional for reachability test)..."
          value={testKey}
          onChange={(e) => setTestKey(e.target.value)}
          className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs outline-none"
        />
      </div>

      {/* Provider List */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {filtered.map((p) => {
          const badge = STATUS_BADGE[p.status] || STATUS_BADGE.candidate;
          const isBusy = busyId === p.id;
          return (
            <Card key={p.id} className="p-4 flex flex-col justify-between gap-3 hover:border-primary/40 transition-colors">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ProviderIcon
                      providerId={p.id}
                      size={28}
                      className="rounded-md"
                      alt={p.name}
                      fallbackText={p.textIcon || p.id.slice(0, 2).toUpperCase()}
                      fallbackColor="var(--primary)"
                    />
                    <div>
                      <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                        {p.name}
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </h3>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span>Source: {p.discoveredFrom}</span>
                        {p.lastVerifiedAt && (
                          <span>• Verified: {new Date(p.lastVerifiedAt).toLocaleTimeString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      title="Test Endpoint Ping"
                      disabled={isBusy}
                      onClick={() => handleAction("verify", p.id, { apiKey: testKey })}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <span className={`material-symbols-outlined text-base ${isBusy ? "animate-spin" : ""}`}>
                        {isBusy ? "sync" : "play_circle"}
                      </span>
                    </button>
                    <button
                      title="Generate Registry Draft"
                      onClick={() => handleAction("generateDraft", p.id)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      <span className="material-symbols-outlined text-base">code</span>
                    </button>
                    <button
                      title="Delete Candidate"
                      onClick={() => handleAction("delete", p.id)}
                      className="p-1 rounded hover:bg-muted text-error hover:text-error"
                    >
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>
                </div>

                <div className="mt-3 bg-muted/40 p-2 rounded text-[11px] font-mono space-y-1 text-muted-foreground break-all">
                  <div><strong className="text-foreground">BaseURL:</strong> {p.baseUrl}</div>
                  {p.validateUrl && <div><strong className="text-foreground">ValidateURL:</strong> {p.validateUrl}</div>}
                  {p.notice && <div className="text-foreground/80 font-sans mt-1">ℹ️ {p.notice}</div>}
                  {p.verificationError && <div className="text-error font-sans">❌ {p.verificationError}</div>}
                  {p.verificationNote && <div className="text-success font-sans">✅ {p.verificationNote} {p.latencyMs && `(${p.latencyMs}ms)`}</div>}
                </div>

                {p.models && p.models.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-muted-foreground mr-1">Models:</span>
                    {p.models.map((m) => (
                      <span key={m.id} className="text-[10px] bg-secondary px-1.5 py-0.5 rounded font-mono text-foreground/80">
                        {m.name || m.id}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border pt-2.5 mt-1 text-xs">
                <div className="flex items-center gap-1.5">
                  {p.status !== "registered" && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleAction("updateStatus", p.id, { status: "registered" })}
                    >
                      Mark as Registered
                    </Button>
                  )}
                  {p.status !== "ignored" && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => handleAction("updateStatus", p.id, { status: "ignored" })}
                    >
                      Ignore
                    </Button>
                  )}
                </div>
                {p.website && (
                  <a
                    href={p.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline text-[11px]"
                  >
                    Docs / Web <span className="material-symbols-outlined text-[12px]!">open_in_new</span>
                  </a>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Add Candidate Modal */}
      {addModal && (
        <Modal isOpen={addModal} onClose={() => setAddModal(false)} title="Add Provider Candidate">
          <form onSubmit={handleAddSubmit} className="space-y-3 p-1">
            <div>
              <label className="text-xs font-medium block mb-1">Provider ID (kebab-case)</label>
              <Input
                placeholder="e.g. cerebras-free"
                value={newProv.id}
                onChange={(e) => setNewProv({ ...newProv, id: e.target.value })}
                className="text-xs"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Display Name</label>
              <Input
                placeholder="e.g. Cerebras Free Tier"
                value={newProv.name}
                onChange={(e) => setNewProv({ ...newProv, name: e.target.value })}
                className="text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Base URL</label>
              <Input
                placeholder="https://api.cerebras.ai/v1/chat/completions"
                value={newProv.baseUrl}
                onChange={(e) => setNewProv({ ...newProv, baseUrl: e.target.value })}
                className="text-xs"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Validate URL (Optional)</label>
              <Input
                placeholder="https://api.cerebras.ai/v1/models"
                value={newProv.validateUrl}
                onChange={(e) => setNewProv({ ...newProv, validateUrl: e.target.value })}
                className="text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Notice / Description</label>
              <Input
                placeholder="e.g. 1M tokens/day limit"
                value={newProv.notice}
                onChange={(e) => setNewProv({ ...newProv, notice: e.target.value })}
                className="text-xs"
              />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddModal(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm">
                Save Candidate
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Draft Code Modal */}
      {draftModal.open && (
        <Modal
          isOpen={draftModal.open}
          onClose={() => setDraftModal({ open: false, code: "", filename: "", provider: null })}
          title={`Registry Draft (${draftModal.filename})`}
          className="sm:max-w-[110rem]"
        >
          <div className="space-y-3 p-1">
            <p className="text-xs text-muted-foreground">
              Copy this JS file into <code>{draftModal.filename}</code> to officially wire this provider into 9router.
            </p>
            <pre className="p-3 bg-muted rounded font-mono text-[11px] max-h-96 overflow-auto border border-border whitespace-pre">
              {draftModal.code}
            </pre>
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(draftModal.code);
                  alert("Copied draft code to clipboard!");
                }}
              >
                Copy JS Code
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busyId === draftModal.provider}
                  onClick={() => handleAction("install", draftModal.provider)}
                >
                  <span className={`material-symbols-outlined text-sm ${busyId === draftModal.provider ? "animate-spin" : ""}`}>
                    {busyId === draftModal.provider ? "sync" : "add_circle"}
                  </span>{" "}
                  Install to Providers
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDraftModal({ open: false, code: "", filename: "", provider: null })}
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
