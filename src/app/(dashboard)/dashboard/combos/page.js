"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { Card, Button, Modal, Input, CardSkeleton, ErrorState, ModelSelectModal, ConfirmModal, CapacityBadges, Select, Toggle, Badge, SmartPolicyModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { aggregateComboCapabilities } from "open-sse/providers/capabilities.js";
import { resolveProviderId, AI_PROVIDERS } from "@/shared/constants/providers";
import FallbackChainCard from "./FallbackChainCard";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// Capacity adapter: global fallback pools of models per input-modality capability.
// A request needing a capability the target model/combo lacks switches straight
// to the first enabled model here instead of erroring or dropping the data.
const CAPACITY_ADAPTER_CAPS = [
  { key: "vision", label: "Vision", icon: "visibility", desc: "images (png, jpg, webp, …)" },
  // pdf, videoInput temporarily hidden — no translator support yet for those blocks.
  { key: "audioInput", label: "Audio", icon: "graphic_eq", desc: "audio input" },
];
const DEFAULT_FALLBACK_MODEL = "oc/mimo-v2.6-flash-free";
const EMPTY_CAP_ENTRY = { enabled: true, roundRobin: false, models: [] };
const EMPTY_CAPACITY_ADAPTER = {
  vision: { ...EMPTY_CAP_ENTRY },
  pdf: { ...EMPTY_CAP_ENTRY },
  audioInput: { ...EMPTY_CAP_ENTRY },
  videoInput: { ...EMPTY_CAP_ENTRY },
};
const upgradeLegacyModel = (m) => (m === "oc/mimo-v2.5-free" ? DEFAULT_FALLBACK_MODEL : m);

// Backward-compat: legacy stored form was an array of {model, enabled}.
function normalizeCapEntry(entry) {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.map((e) => upgradeLegacyModel(e?.model || e)).filter(Boolean) };
  }
  if (entry && typeof entry === "object") {
    return {
      enabled: entry.enabled !== false,
      roundRobin: !!entry.roundRobin,
      models: Array.isArray(entry.models) ? entry.models.map(upgradeLegacyModel).filter(Boolean) : [],
    };
  }
  return { ...EMPTY_CAP_ENTRY };
}

const STRATEGY_OPTIONS = [
  { value: "fallback", label: "Fallback - try in order" },
  { value: "round-robin", label: "Round Robin - rotate" },
  { value: "smart", label: "Smart Router - System One" },
  { value: "fusion", label: "Fusion - panel + judge" },
  { value: "orchestrate", label: "Orchestrate - planner + workers" },
];

function getPolicyBadgeLabel(strategy = {}) {
  const policy = strategy.smartPolicy || (strategy.sessionSticky === false ? "per-turn" : "smart");
  if (policy === "strict") return "Strict Lock";
  if (policy === "per-turn") return "Per-Turn";
  if (policy === "custom") {
    const raw = strategy.confidenceThreshold;
    const pct = Math.round((raw || 0.7) * (raw && raw <= 1 ? 100 : 1));
    return `Custom (≥${pct || 70}%)`;
  }
  return "Smart (≥70%)";
}

export default function CombosPage() {
  const [combos, setCombos] = useState([]);
  const [comboHealth, setComboHealth] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const [capacityAdapter, setCapacityAdapter] = useState(EMPTY_CAPACITY_ADAPTER);
  const [smartAutoPool, setSmartAutoPool] = useState({ enabled: false, models: [] });
  const { getCaps } = useModelCaps();
  const [confirmState, setConfirmState] = useState(null);
  const [presetLoading, setPresetLoading] = useState(null); // "cursor" | "claude" | null
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { copied, copy } = useCopyToClipboard();


  // Drop stale selection when the combo list changes (delete / refresh).
  useEffect(() => {
    const alive = new Set(combos.map((c) => c.id));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((prev) => prev.filter((id) => alive.has(id)));
  }, [combos]);

  const selectedCombos = combos.filter((c) => selectedIds.includes(c.id));
  const someSelected = selectedIds.length > 0;

  // Case-insensitive search over the combo name and its model ids, so both
  // "deepseek" and "deepseek-v4.1-flash" find the right rows.
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredCombos = normalizedQuery
    ? combos.filter((c) => {
        if (String(c.name || "").toLowerCase().includes(normalizedQuery)) return true;
        return (c.models || []).some((m) => String(m).toLowerCase().includes(normalizedQuery));
      })
    : combos;

  // Select-all follows the search: with a query active it must only reach the
  // rows on screen, otherwise the bulk Delete would take out hidden combos.
  const allSelected = filteredCombos.length > 0 && filteredCombos.every((c) => selectedIds.includes(c.id));

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : filteredCombos.map((c) => c.id));
  };

  const clearSelection = () => setSelectedIds([]);

  const handleGeneratePresets = async (source) => {
    const label = source === "cursor" ? "Cursor Default" : "Claude Default";
    setPresetLoading(source);
    try {
      const previewRes = await fetch(`/api/combos/presets?source=${source}`);
      const preview = await previewRes.json();
      if (!previewRes.ok) {
        alert(preview.error || `Failed to preview ${label}`);
        return;
      }

      const toCreate = preview.toCreate ?? (preview.items || []).filter((i) => !i.exists).length;
      const toSkip = preview.toSkip ?? (preview.items || []).filter((i) => i.exists).length;
      const total = (preview.items || []).length;

      if (total === 0) {
        alert(`No ${label} models available to generate.`);
        return;
      }

      if (toCreate === 0) {
        alert(`All ${total} ${label} combos already exist. Nothing to create.`);
        return;
      }

      setConfirmState({
        title: `Generate ${label}`,
        message: `Create ${toCreate} combo${toCreate === 1 ? "" : "s"} named like ${source === "cursor" ? "Cursor" : "Claude"} model IDs (seeded with cu/… or cc/…). ${toSkip} already exist and will be skipped. You can edit any combo afterward to add fallbacks.`,
        confirmText: "Generate",
        variant: "primary",
        onConfirm: async () => {
          setConfirmState((prev) => prev ? { ...prev, loading: true } : null);
          try {
            const res = await fetch("/api/combos/presets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source }),
            });
            const data = await res.json();
            if (!res.ok) {
              alert(data.error || `Failed to generate ${label}`);
              return;
            }
            await fetchData();
            setConfirmState(null);
          } catch (error) {
            console.log(`Error generating ${label}:`, error);
            alert(`Failed to generate ${label}`);
            setConfirmState((prev) => prev ? { ...prev, loading: false } : null);
          }
        },
      });
    } catch (error) {
      console.log(`Error previewing ${label}:`, error);
      alert(`Failed to preview ${label}`);
    } finally {
      setPresetLoading(null);
    }
  };

  const fetchData = async () => {
    try {
      const [combosRes, providersRes, settingsRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        fetch("/api/settings"),
      ]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};

      // Only LLM combos here - webSearch/webFetch combos belong to media-providers/web
      if (combosRes.ok) {
        setCombos((combosData.combos || []).filter(c => !c.kind || c.kind === "llm"));
        setComboHealth(combosData.health || {});
      }
      if (providersRes.ok) {
        setActiveProviders((providersData.connections || []).filter((c) => c.isActive !== false));
      }
      setComboStrategies(settingsData.comboStrategies || {});
      const rawAdapter = settingsData.capacityAdapter || {};
      const normalized = {};
      for (const cap of CAPACITY_ADAPTER_CAPS) {
        normalized[cap.key] = normalizeCapEntry(rawAdapter[cap.key]);
      }
      setCapacityAdapter(normalized);
      const rawPool = settingsData.smartAutoPool || {};
      setSmartAutoPool({ enabled: !!rawPool.enabled, models: Array.isArray(rawPool.models) ? rawPool.models : [] });
      setLoadError(!combosRes.ok || !providersRes.ok);
    } catch (error) {
      console.log("Error fetching data:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSetCapacityAdapter = async (next) => {
    setCapacityAdapter(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacityAdapter: next }),
      });
    } catch (error) {
      console.log("Error updating capacity adapter:", error);
    }
  };

  const handleSetSmartAutoPool = async (next) => {
    setSmartAutoPool(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smartAutoPool: next }),
      });
    } catch (error) {
      console.log("Error updating smart auto pool:", error);
    }
  };

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create combo");
      }
    } catch (error) {
      console.log("Error creating combo:", error);
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update combo");
      }
    } catch (error) {
      console.log("Error updating combo:", error);
    }
  };

  const pruneStrategiesForNames = (names, base = comboStrategies) => {
    const updated = { ...base };
    for (const name of names) delete updated[name];
    return updated;
  };

  const persistComboStrategies = async (updated) => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comboStrategies: updated }),
    });
    setComboStrategies(updated);
  };

  const handleDelete = async (id) => {
    const combo = combos.find((c) => c.id === id);
    setConfirmState({
      title: "Delete Combo",
      message: combo ? `Delete combo "${combo.name}"?` : "Delete this combo?",
      onConfirm: async () => {
        setConfirmState((prev) => prev ? { ...prev, loading: true } : null);
        try {
          const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
          if (res.ok) {
            if (combo?.name) {
              await persistComboStrategies(pruneStrategiesForNames([combo.name]));
            }
            setCombos((prev) => prev.filter((c) => c.id !== id));
            setSelectedIds((prev) => prev.filter((x) => x !== id));
          }
          setConfirmState(null);
        } catch (error) {
          console.log("Error deleting combo:", error);
          setConfirmState((prev) => prev ? { ...prev, loading: false } : null);
        }
      }
    });
  };

  const handleBulkDelete = () => {
    if (selectedCombos.length === 0) return;
    const count = selectedCombos.length;
    setConfirmState({
      title: "Delete Selected Combos",
      message: `Delete ${count} selected combo${count === 1 ? "" : "s"}? This cannot be undone.`,
      confirmText: "Delete",
      variant: "danger",
      onConfirm: async () => {
        setConfirmState((prev) => prev ? { ...prev, loading: true } : null);
        setBulkBusy(true);
        try {
          const ids = selectedCombos.map((c) => c.id);
          const names = selectedCombos.map((c) => c.name);
          const results = await Promise.all(
            ids.map((id) => fetch(`/api/combos/${id}`, { method: "DELETE" }))
          );
          const failed = results.filter((r) => !r.ok).length;
          await persistComboStrategies(pruneStrategiesForNames(names));
          setCombos((prev) => prev.filter((c) => !ids.includes(c.id)));
          clearSelection();
          setConfirmState(null);
          if (failed > 0) alert(`Deleted with ${failed} failure${failed === 1 ? "" : "s"}.`);
        } catch (error) {
          console.log("Error bulk deleting combos:", error);
          alert("Failed to delete selected combos");
          setConfirmState((prev) => prev ? { ...prev, loading: false } : null);
        } finally {
          setBulkBusy(false);
        }
      },
    });
  };

  // Merge a per-combo strategy patch into settings.comboStrategies. Passing an empty
  // patch (strategy back to default "fallback") drops the entry entirely.
  const handleSetComboStrategy = async (comboName, patch) => {
    try {
      const updated = { ...comboStrategies };
      const next = { ...(updated[comboName] || {}), ...patch };
      // Prune to keep settings clean: default fallback with no extras = no entry.
      const isDefaultDrop = next.dropFails === undefined || next.dropFails === 5;
      if ((!next.fallbackStrategy || next.fallbackStrategy === "fallback") && isDefaultDrop) {
        delete updated[comboName];
      } else {
        updated[comboName] = next;
      }

      await persistComboStrategies(updated);
    } catch (error) {
      console.log("Error updating combo strategy:", error);
    }
  };

  const handleBulkSetStrategy = async (strategy) => {
    if (selectedCombos.length === 0 || !strategy) return;
    setBulkBusy(true);
    try {
      const updated = { ...comboStrategies };
      for (const combo of selectedCombos) {
        if (!strategy || strategy === "fallback") {
          delete updated[combo.name];
        } else {
          updated[combo.name] = {
            ...(updated[combo.name] || {}),
            fallbackStrategy: strategy,
          };
        }
      }
      await persistComboStrategies(updated);
    } catch (error) {
      console.log("Error bulk updating combo strategy:", error);
      alert("Failed to update strategy for selected combos");
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {loadError && <ErrorState message="Couldn't load data. Check that the 9Router server is running, then retry." onRetry={fetchData} />}
      {/* Header */}
      <div className="flex flex-col gap-3 rounded-xl border border-black/5 bg-white/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.015] sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Group models under one name, then pick a strategy per combo:</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-3xl">Fallback tries in order. Round Robin rotates requests. Smart Router picks the best member. Fusion runs all panel models + a judge. Orchestrate plans, runs workers, then writes one answer.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-stretch">
          <div className="relative w-full sm:w-64">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-muted-foreground">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search combos…"
              aria-label="Search combos"
              className="w-full rounded-lg border border-black/10 bg-card py-2 pl-10 pr-9 text-sm text-foreground transition-colors placeholder-muted-foreground/70 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon="auto_awesome"
              loading={presetLoading === "cursor"}
              disabled={!!presetLoading}
              onClick={() => handleGeneratePresets("cursor")}
              title="Generate Cursor model combos"
            >
              Cursor
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon="auto_awesome"
              loading={presetLoading === "claude"}
              disabled={!!presetLoading}
              onClick={() => handleGeneratePresets("claude")}
              title="Generate Claude model combos"
            >
              Claude
            </Button>
            <Button icon="add" onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto whitespace-nowrap">
              Create Combo
            </Button>
          </div>
        </div>
      </div>

      {combos.length > 0 && <FallbackChainCard />}

      {/* Combos List */}
      {combos.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">layers</span>
            </div>
            <p className="text-foreground font-medium mb-1">No combos yet</p>
            <p className="text-sm text-muted-foreground mb-4">Create model combos with fallback support</p>
            <Button icon="add" onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">
              Create Combo
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Selection toolbar */}
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-black/5 bg-black/[0.01] px-3 py-2 dark:border-white/10 dark:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-primary select-none">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={toggleSelectAll}
                className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span>
                {someSelected
                  ? `${selectedIds.length} selected`
                  : `Select all (${filteredCombos.length})`}
              </span>
            </label>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {normalizedQuery && (
                <span className="text-xs text-muted-foreground">
                  {filteredCombos.length} of {combos.length} shown
                </span>
              )}
              {someSelected && (
                <>
                  <div className="w-full min-w-[160px] sm:w-[200px]">
                    <Select
                      options={STRATEGY_OPTIONS}
                      value=""
                      placeholder="Set strategy…"
                      disabled={bulkBusy}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) handleBulkSetStrategy(v);
                      }}
                      selectClassName="py-1.5 text-xs"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    icon="delete"
                    disabled={bulkBusy}
                    loading={bulkBusy}
                    onClick={handleBulkDelete}
                    className="whitespace-nowrap"
                  >
                    Delete ({selectedIds.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearSelection}
                    disabled={bulkBusy}
                  >
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {(() => {
              const comboByName = Object.fromEntries(combos.map((c) => [c.name, c.models]));
              if (filteredCombos.length === 0) {
                return (
                  <Card>
                    <div className="text-center py-10">
                      <p className="text-foreground font-medium mb-1">No combos match “{searchQuery.trim()}”</p>
                      <p className="text-sm text-muted-foreground mb-4">Try a shorter query, or clear the search to see all {combos.length} combos.</p>
                      <Button variant="secondary" onClick={() => setSearchQuery("")}>
                        Clear search
                      </Button>
                    </div>
                  </Card>
                );
              }
              return filteredCombos.map((combo) => (
                <ComboCard
                  key={combo.id}
                  combo={combo}
                  getCaps={getCaps}
                  comboByName={comboByName}
                  activeProviders={activeProviders}
                  copied={copied}
                  onCopy={copy}
                  onEdit={() => setEditingCombo(combo)}
                  onDelete={() => handleDelete(combo.id)}
                  onRestore={(model) => handleUpdate(combo.id, { models: [...combo.models, model] })}
                  strategy={comboStrategies[combo.name] || {}}
                  health={comboHealth[combo.name] || {}}
                  onSetStrategy={(patch) => handleSetComboStrategy(combo.name, patch)}
                  selected={selectedIds.includes(combo.id)}
                  onToggleSelect={() => toggleSelect(combo.id)}
                />
              ));
            })()}
          </div>
        </div>
      )}

      <SmartAutoPoolSection
        pool={smartAutoPool}
        onChange={handleSetSmartAutoPool}
        activeProviders={activeProviders}
        getCaps={getCaps}
      />

      {/* Capacity Adapter */}
      <CapacityAdapterSection
        capacityAdapter={capacityAdapter}
        onChange={handleSetCapacityAdapter}
        activeProviders={activeProviders}
        getCaps={getCaps}
      />

      {/* Create Modal - Use key to force remount and reset state */}
      {showCreateModal && (
        <ComboFormModal
          key="create"
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreate}
          activeProviders={activeProviders}
        />
      )}

      {editingCombo && (
        <ComboFormModal
          key={editingCombo.id}
          isOpen={!!editingCombo}
          combo={editingCombo}
          onClose={() => setEditingCombo(null)}
          onSave={(data) => handleUpdate(editingCombo.id, data)}
          health={comboHealth[editingCombo.name] || {}}
          activeProviders={activeProviders}
        />
      )}

      {/* Confirm (delete / generate presets) */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => !confirmState?.loading && setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        confirmText={confirmState?.confirmText || "Confirm"}
        variant={confirmState?.variant || "danger"}
        loading={!!confirmState?.loading}
      />
    </div>
  );
}

const fmtK = (n) => {
  if (!n) return "?";
  if (n >= 1000000) {
    const m = n / 1000000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(n / 1000)}k`;
};

function getRouterModelStatus(routerModel, activeProviders) {
  const effectiveModel = (typeof routerModel === "string" && routerModel.trim())
    ? routerModel.trim()
    : "oc/jev-1.13-free";
  const slashIdx = effectiveModel.indexOf("/");
  const prefix = slashIdx !== -1 ? effectiveModel.slice(0, slashIdx) : effectiveModel;
  const providerId = resolveProviderId(prefix);
  const providerDef = AI_PROVIDERS[providerId];
  const isNoAuth = !!providerDef?.noAuth;

  if (isNoAuth) {
    return { ready: true, label: "Ready (Free)", providerId };
  }

  const isConnected = (activeProviders || []).some((c) => c.provider === providerId && c.isActive !== false);
  if (isConnected) {
    return { ready: true, label: "Connected", providerId };
  }

  return { ready: false, label: "Not configured", providerId };
}

function ComboCard({ combo, getCaps, comboByName = {}, activeProviders = [], copied, onCopy, onEdit, onDelete, onRestore, strategy = {}, health = {}, onSetStrategy, selected = false, onToggleSelect }) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const [showRouterSelect, setShowRouterSelect] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const current = strategy.fallbackStrategy || "fallback";
  const dropFails = Number.isInteger(strategy.dropFails) ? strategy.dropFails : 5;
  const judge = strategy.judgeModel || "";
  const routerModel = strategy.routerModel || "";
  const isFusion = current === "fusion" || current === "orchestrate";
  const isSmart = current === "smart";
  // The synced catalog is server-only, so resolving here would fall back to the
  // generic patterns and under-report the limits. getCaps carries the server's
  // answer for /api/models.
  const comboCaps = aggregateComboCapabilities(combo.models, comboByName, getCaps);

  return (
    <Card padding="sm" className={`group ${selected ? "ring-1 ring-primary/40 bg-primary/[0.03]" : ""}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <label className="flex shrink-0 cursor-pointer items-center pt-1 sm:pt-0" title="Select combo">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              aria-label={`Select ${combo.name}`}
            />
          </label>
          <div className="min-w-0 flex-1">
            <code className="block truncate font-mono text-sm font-medium">{combo.name}</code>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {combo.models.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">No models</span>
              ) : (
                combo.models.slice(0, 3).map((model, index) => (
                  <code key={index} className="inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-muted-foreground dark:bg-white/5">
                    <span>{model}</span>
                    {health[model]?.failStreak > 0 && (
                      <span
                        className="rounded bg-red-500/15 px-1 text-[10px] font-medium text-red-600 dark:text-red-400"
                        title={`Jev: unreachable ${health[model].failStreak}${dropFails > 0 ? `/${dropFails}` : ""} routings${dropFails > 0 ? ` — auto-removed at ${dropFails}` : ""}`}
                      >
                        {health[model].failStreak}{dropFails > 0 ? `/${dropFails}` : ""}
                      </span>
                    )}
                    <CapacityBadges caps={
                      comboByName[model]
                        ? aggregateComboCapabilities(comboByName[model], comboByName, getCaps)
                        : getCaps?.(model)
                    } />
                  </code>
                ))
              )}
              {combo.models.length > 3 && (
                <span className="text-xs text-muted-foreground">+{combo.models.length - 3} more</span>
              )}
            </div>
            {(() => {
              const dropped = Object.entries(health).filter(([m, st]) => st?.removedAt && !combo.models.includes(m));
              if (dropped.length === 0) return null;
              const visibleDropped = dropped.slice(0, 4);
              return (
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                  <span className="font-medium">Jev removed:</span>
                  {visibleDropped.map(([m]) => (
                    <span key={m} className="inline-flex items-center gap-0.5 rounded bg-red-500/10 px-1.5 py-0.5">
                      <code className="font-mono text-xs">{m}</code>
                      <button
                        type="button"
                        onClick={() => onRestore?.(m)}
                        className="inline-flex items-center rounded text-primary hover:bg-primary/10"
                        title={`Restore ${m} to this combo`}
                        aria-label={`Restore ${m} to this combo`}
                      >
                        <span className="material-symbols-outlined text-[13px]">undo</span>
                      </button>
                    </span>
                  ))}
                  {dropped.length > 4 && (
                    <span title={dropped.slice(4).map(([m]) => m).join("\n")} className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-500 tabular-nums">
                      +{dropped.length - 4} more
                    </span>
                  )}
                </div>
              );
            })()}
            {comboCaps && (
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                <span>ctx {fmtK(comboCaps.contextWindow)}</span>
                <span className="opacity-40">·</span>
                <span>max {fmtK(comboCaps.maxOutput)}</span>
              </div>
            )}
            {/* Fusion: judge picker (Auto = first model) */}
            {isFusion && (
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{current === "orchestrate" ? "Planner" : "Judge"}</span>
                <button
                  onClick={() => setShowJudgeSelect(true)}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-dashed border-primary/40 px-1.5 py-0.5 text-xs text-primary hover:border-primary hover:bg-primary/5 transition-colors"
                  title="Pick the model that fuses panel answers"
                >
                  <span className="material-symbols-outlined text-[14px]">gavel</span>
                  <span className="truncate">{judge || `Auto - ${combo.models[0] || "first model"}`}</span>
                </button>
                {judge && (
                  <button
                    onClick={() => onSetStrategy({ judgeModel: "" })}
                    className="p-0.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    title="Reset judge to Auto"
                  >
                    <span className="material-symbols-outlined text-[13px]">close</span>
                  </button>
                )}
              </div>
            )}
            {/* Round-robin: per-member concurrency cap (blank/0 = unlimited) */}
            {current === "round-robin" && (
              <label className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-medium">Max in-flight / model</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={strategy.maxConcurrency || ""}
                  placeholder="∞"
                  onBlur={(e) => {
                    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                    if (n !== (strategy.maxConcurrency || 0)) onSetStrategy({ maxConcurrency: n });
                  }}
                  className="w-14 rounded border border-border/70 bg-transparent px-1.5 py-0.5 text-xs tabular-nums text-foreground focus:border-primary focus:outline-none"
                  aria-label="Max concurrent requests per combo member"
                  title="When a member is full, the request moves to the next member"
                />
              </label>
            )}
            {/* Smart: System One router picker and policy modal trigger */}
            {isSmart && (() => {
              const routerStatus = getRouterModelStatus(routerModel, activeProviders);
              const policyLabel = getPolicyBadgeLabel(strategy);
              return (
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Router</span>
                  <button
                    onClick={() => setShowRouterSelect(true)}
                    className="inline-flex max-w-full items-center gap-1 rounded border border-dashed border-primary/40 px-1.5 py-0.5 text-xs text-primary hover:border-primary hover:bg-primary/5 transition-colors"
                    title="Pick the System One model that decides model routing"
                  >
                    <span className="material-symbols-outlined text-[14px]">psychology</span>
                    <span className="truncate">{routerModel || "Auto - oc/jev-1.13-free"}</span>
                  </button>
                  {routerStatus.ready ? (
                    <Badge variant="success" size="sm" dot>{routerStatus.label}</Badge>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Badge variant="error" size="sm" dot>{routerStatus.label}</Badge>
                      <Link
                        href={`/dashboard/media-providers/systemone/${routerStatus.providerId}`}
                        className="text-xs font-medium text-primary hover:underline"
                        title="Configure in Media Providers"
                      >
                        Configure
                      </Link>
                    </span>
                  )}
                  <button
                    onClick={() => setShowPolicyModal(true)}
                    className="inline-flex items-center gap-1 rounded border border-border/70 bg-black/[0.02] dark:bg-white/[0.02] px-2 py-0.5 text-xs text-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors"
                    title="Configure routing policy and prompt cache retention"
                  >
                    <span className="material-symbols-outlined text-[14px] text-muted-foreground">tune</span>
                    <span className="font-medium">{policyLabel}</span>
                  </button>
                  <button
                    onClick={() => onSetStrategy({ shuffle: !strategy.shuffle })}
                    aria-pressed={!!strategy.shuffle}
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs transition-colors ${strategy.shuffle ? "border-primary bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-primary/50 hover:bg-primary/5"}`}
                    title="Shuffle members each request; the router's pick still goes first"
                  >
                    <span className="material-symbols-outlined text-[14px]">shuffle</span>
                    <span className="font-medium">Shuffle {strategy.shuffle ? "on" : "off"}</span>
                  </button>
                  {routerModel && (
                    <button
                      onClick={() => onSetStrategy({ routerModel: "" })}
                      className="p-0.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      title="Reset router to Auto"
                    >
                      <span className="material-symbols-outlined text-[13px]">close</span>
                    </button>
                  )}
                </div>
              );
            })()}
            {/* Auto-drop threshold for unreachable models (0 = disabled) */}
            <label className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium">Auto-drop after</span>
              <input
                type="number"
                min={0}
                step={1}
                key={`drop-${combo.id}-${dropFails}`}
                defaultValue={dropFails}
                onBlur={(e) => {
                  const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                  if (n !== dropFails) onSetStrategy({ dropFails: n });
                }}
                className="w-12 rounded border border-border/70 bg-transparent px-1.5 py-0.5 text-xs tabular-nums text-foreground focus:border-primary focus:outline-none"
                aria-label="Auto-drop failed model after N routings"
                title="Remove unreachable models after N consecutive failed routings (0 = off)"
              />
              <span>failed routings{dropFails === 0 ? " (off)" : ""}</span>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          {/* Strategy selector + actions */}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
            <div className="w-full sm:w-[190px]">
              <Select
                options={STRATEGY_OPTIONS}
                value={current}
                onChange={(e) => onSetStrategy({ fallbackStrategy: e.target.value })}
                selectClassName="py-1.5 text-xs"
              />
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); onCopy(combo.name, `combo-${combo.id}`); }}
                className="inline-flex items-center gap-1 rounded border border-black/10 bg-black/[0.02] px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground dark:border-white/10 dark:bg-white/[0.03]"
                title="Copy combo name"
              >
                <span className="material-symbols-outlined text-[16px]">{copied === `combo-${combo.id}` ? "check" : "content_copy"}</span>
                <span>Copy</span>
              </button>
              <button
                onClick={onEdit}
                className="inline-flex items-center gap-1 rounded border border-black/10 bg-black/[0.02] px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground dark:border-white/10 dark:bg-white/[0.03]"
                title="Edit combo"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
                <span>Edit</span>
              </button>
              <button
                onClick={onDelete}
                className="inline-flex items-center gap-1 rounded border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-xs text-red-600 transition-colors hover:border-red-500/40 hover:bg-red-500/10 dark:text-red-400"
                title="Delete combo"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Judge model picker (single-select; combo members make natural judges too) */}
      {showJudgeSelect && (
        <ModelSelectModal
          isOpen={showJudgeSelect}
          onClose={() => setShowJudgeSelect(false)}
          onSelect={(m) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }}
          activeProviders={activeProviders}
          title="Select Judge Model"
          addedModelValues={judge ? [judge] : []}
          closeOnSelect={true}
        />
      )}

      {/* System One Router model picker (single-select from systemone kind) */}
      {showRouterSelect && (
        <ModelSelectModal
          isOpen={showRouterSelect}
          onClose={() => setShowRouterSelect(false)}
          onSelect={(m) => { onSetStrategy({ routerModel: m?.value || "" }); setShowRouterSelect(false); }}
          activeProviders={activeProviders}
          title="Select System One Router Model"
          kindFilter="systemone"
          addedModelValues={routerModel ? [routerModel] : []}
          closeOnSelect={true}
        />
      )}

      {/* Smart Router Policy Settings Modal */}
      {showPolicyModal && (
        <SmartPolicyModal
          isOpen={showPolicyModal}
          onClose={() => setShowPolicyModal(false)}
          comboName={combo.name}
          currentPolicy={strategy.smartPolicy || (strategy.sessionSticky === false ? "per-turn" : "smart")}
          currentThreshold={strategy.confidenceThreshold ?? 70}
          onSave={onSetStrategy}
        />
      )}
    </Card>
  );
}

// Extra models Jev may pick for Smart Router combos even though they aren't combo
// members — lets it route cheap tasks to connected cheaper/free models.
function SmartAutoPoolSection({ pool, onChange, activeProviders, getCaps }) {
  const [showModelSelect, setShowModelSelect] = useState(false);
  const { enabled, models } = pool;
  const add = (m) => {
    const v = m?.value || m?.name || m;
    if (v && !models.includes(v)) onChange({ ...pool, models: [...models, v] });
  };
  const remove = (m) => {
    const v = m?.value || m?.name || m;
    onChange({ ...pool, models: models.filter((x) => x !== v) });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Smart Router Cost Pool</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Smart combos may also route to these models when Jev finds a cheaper fit. Combo members stay the default order.
        </p>
      </div>
      <Card padding="sm" className={!enabled ? "opacity-60" : ""}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Toggle checked={enabled} onChange={(v) => onChange({ ...pool, enabled: v })} aria-label="Enable Smart Router cost pool" />
            <span className="text-sm">{models.length} model{models.length === 1 ? "" : "s"} in pool</span>
          </div>
          <Button icon="add" variant="ghost" size="sm" onClick={() => setShowModelSelect(true)}>
            Add Model
          </Button>
        </div>
        {models.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {models.map((m) => (
              <code key={m} className="inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs dark:bg-white/5">
                <span>{m}</span>
                <CapacityBadges caps={getCaps?.(m)} />
                <button
                  type="button"
                  onClick={() => remove(m)}
                  className="rounded text-muted-foreground hover:text-red-500"
                  aria-label={`Remove ${m}`}
                >
                  <span className="material-symbols-outlined text-[14px] leading-none">close</span>
                </button>
              </code>
            ))}
          </div>
        )}
      </Card>
      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={add}
          onDeselect={remove}
          activeProviders={activeProviders}
          title="Add Cost Pool Model"
          addedModelValues={models}
          closeOnSelect={false}
        />
      )}
    </div>
  );
}

function CapacityAdapterSection({ capacityAdapter, onChange, activeProviders, getCaps }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Vision Adapter</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Your model can&apos;t read image/audio? Auto-switches to a model in the pool below.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        {CAPACITY_ADAPTER_CAPS.map((cap) => (
          <CapacityAdapterCap
            key={cap.key}
            cap={cap}
            entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY}
            onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })}
            activeProviders={activeProviders}
            getCaps={getCaps}
          />
        ))}
      </div>
    </div>
  );
}

function CapacityAdapterCap({ cap, entry, onChange, activeProviders, getCaps }) {
  const [showModelSelect, setShowModelSelect] = useState(false);
  const { enabled, roundRobin, models } = entry;

  const patch = (p) => onChange({ ...entry, ...p });

  const handleAdd = (model) => {
    const value = model?.value || model?.name || model;
    if (!value || models.includes(value)) return;
    patch({ models: [...models, value] });
  };

  const handleDeselect = (model) => {
    const value = model?.value || model?.name || model;
    const next = models.filter((m) => m !== value);
    patch({ models: next.length === 0 ? [DEFAULT_FALLBACK_MODEL] : next });
  };

  const handleRemove = (index) => {
    const next = models.filter((_, i) => i !== index);
    patch({ models: next.length === 0 ? [DEFAULT_FALLBACK_MODEL] : next });
  };

  const handleMove = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= models.length) return;
    const next = [...models];
    [next[index], next[target]] = [next[target], next[index]];
    patch({ models: next });
  };

  return (
    <Card padding="sm" className={`group ${!enabled ? "opacity-50" : ""}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Master toggle + icon + label */}
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center">
          <Toggle
            checked={enabled}
            onChange={(v) => patch({ enabled: v })}
            aria-label={`Enable ${cap.label} adapter`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-[16px] shrink-0">{cap.icon}</span>
                <span className="text-sm font-medium">{cap.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{cap.desc}</p>
            </div>
          </div>
        </div>

        {/* Actions: Round-robin toggle + Add Model */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <Toggle
              checked={roundRobin}
              onChange={(v) => patch({ roundRobin: v })}
              disabled={!enabled}
              aria-label={`Round-robin ${cap.label} adapter`}
            />
            <span>Round</span>
          </label>
          <Button
            icon="add"
            variant="ghost"
            size="sm"
            onClick={() => setShowModelSelect(true)}
            disabled={!enabled}
            title={`Add ${cap.label} model`}
          >
            Add Model
          </Button>
        </div>
      </div>

      {/* Model pool list/table */}
      {models.length === 0 ? (
        <div className="mt-3 py-2 text-center text-xs text-muted-foreground italic">
          No models in pool (will fallback to {DEFAULT_FALLBACK_MODEL})
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-border/50">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/40 bg-black/[0.02] text-muted-foreground dark:bg-white/[0.02]">
                <th className="w-12 px-3 py-1.5 font-medium text-center">#</th>
                <th className="px-3 py-1.5 font-medium">Model</th>
                <th className="w-24 px-3 py-1.5 font-medium text-center">Order</th>
                <th className="w-12 px-3 py-1.5 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {models.map((model, index) => (
                <tr key={`${model}-${index}`} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                  <td className="px-3 py-2 text-center text-xs tabular-nums text-muted-foreground">
                    #{index + 1}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <code className="font-mono text-xs truncate">{model}</code>
                      <CapacityBadges caps={getCaps?.(model)} />
                      {model === DEFAULT_FALLBACK_MODEL && (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          free default
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleMove(index, -1)}
                        disabled={!enabled || index === 0}
                        className={`p-1 rounded transition-colors ${
                          !enabled || index === 0
                            ? "text-muted-foreground/20 cursor-not-allowed"
                            : "text-muted-foreground hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"
                        }`}
                        title="Move up"
                      >
                        <span className="material-symbols-outlined text-[16px] leading-none">arrow_upward</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(index, 1)}
                        disabled={!enabled || index === models.length - 1}
                        className={`p-1 rounded transition-colors ${
                          !enabled || index === models.length - 1
                            ? "text-muted-foreground/20 cursor-not-allowed"
                            : "text-muted-foreground hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"
                        }`}
                        title="Move down"
                      >
                        <span className="material-symbols-outlined text-[16px] leading-none">arrow_downward</span>
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemove(index)}
                      disabled={!enabled}
                      className={`p-1 rounded transition-colors ${
                        !enabled
                          ? "text-muted-foreground/20 cursor-not-allowed"
                          : "text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                      }`}
                      title="Remove model"
                    >
                      <span className="material-symbols-outlined text-[16px] leading-none">close</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAdd}
          onDeselect={handleDeselect}
          activeProviders={activeProviders}
          title={`Add ${cap.label} Model`}
          addedModelValues={models}
          capFilter={cap.key}
          closeOnSelect={false}
        />
      )}
    </Card>
  );
}

// Model evaluation from /api/llm-stats: cost tier, price, best category rank (topPct = top N%).
const TIER_CLS = { free: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", cheap: "bg-sky-500/10 text-sky-600 dark:text-sky-400", mid: "bg-amber-500/10 text-amber-600 dark:text-amber-400", premium: "bg-rose-500/10 text-rose-600 dark:text-rose-400" };
function modelEvalMap(models = []) {
  return Object.fromEntries(models.map((m) => {
    const [cat, v] = Object.entries(m.ranks || {}).sort((a, b) => b[1] - a[1])[0] || [];
    return [m.id, { tier: m.tier, inPrice: m.stats?.inPrice, outPrice: m.stats?.outPrice, cat, topPct: v ? 101 - v : null }];
  }));
}

function ModelItem({ id, index, model, info, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    // no transition — prevents the CSS settle animation fighting React's re-render on drop
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : undefined,
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model);
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { setDraft(model); setEditing(false); }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 bg-black/[0.02] hover:bg-black/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.04] transition-colors ${isDragging ? "shadow-md ring-1 ring-primary/30" : ""}`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        type="button"
        className="cursor-grab touch-none p-0.5 rounded text-muted-foreground hover:text-primary active:cursor-grabbing shrink-0"
        title="Drag to reorder"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="4" r="2"/><circle cx="15" cy="4" r="2"/>
          <circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/>
          <circle cx="9" cy="20" r="2"/><circle cx="15" cy="20" r="2"/>
        </svg>
      </button>

      {/* Index badge */}
      <span className="text-xs font-medium text-muted-foreground w-3 text-center shrink-0 tabular-nums">{index + 1}</span>

      {/* Inline editable model value */}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 rounded border border-primary/40 bg-white px-1.5 py-0.5 font-mono text-xs text-foreground outline-none dark:bg-black/20"
        />
      ) : (
        <div
          className="min-w-0 flex-1 cursor-text truncate rounded px-1.5 py-0.5 font-mono text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          onClick={() => setEditing(true)}
          title="Click to edit"
        >
          {model}
        </div>
      )}

      {info && (
        <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex" title="Estimated from llm-stats.com">
          <span className={`rounded px-1 ${TIER_CLS[info.tier] || ""}`}>{info.tier}</span>
          {info.inPrice != null && <span className="tabular-nums">${info.inPrice}/M in</span>}
          {info.topPct && <span className="tabular-nums">{info.cat} top {info.topPct}%</span>}
        </span>
      )}

      {/* Priority arrows */}
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className={`p-0.5 rounded ${isFirst ? "text-muted-foreground/20 cursor-not-allowed" : "text-muted-foreground hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
          title="Move up"
        >
          <span className="material-symbols-outlined text-[12px]">arrow_upward</span>
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className={`p-0.5 rounded ${isLast ? "text-muted-foreground/20 cursor-not-allowed" : "text-muted-foreground hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
          title="Move down"
        >
          <span className="material-symbols-outlined text-[12px]">arrow_downward</span>
        </button>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="p-0.5 hover:bg-red-500/10 rounded text-muted-foreground hover:text-red-500 transition-all"
        title="Remove"
      >
        <span className="material-symbols-outlined text-[12px]">close</span>
      </button>
    </div>
  );
}

function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, kindFilter = null, health = {} }) {
  // Initialize state with combo values - key prop on parent handles reset on remount
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState(combo?.models || []);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const [evalMap, setEvalMap] = useState({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Use stable index-based IDs so duplicates and similar names are handled correctly
  const modelItems = models.map((model, i) => ({ uid: `item-${i}`, model }));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = modelItems.findIndex((m) => m.uid === active.id);
      const newIndex = modelItems.findIndex((m) => m.uid === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setModels((prev) => arrayMove(prev, oldIndex, newIndex));
      }
    }
  };

  const fetchModalData = async () => {
    try {
      const aliasesRes = await fetch("/api/models/alias");
      if (!aliasesRes.ok) return;
      const aliasesData = await aliasesRes.json();
      setModelAliases(aliasesData.aliases || {});
    } catch (error) {
      console.error("Error fetching modal data:", error);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fire-and-forget fetches, setState happens in async callbacks
    fetchModalData();
    fetch("/api/llm-stats").then((r) => (r.ok ? r.json() : null)).then((d) => d && setEvalMap(modelEvalMap(d.models))).catch(() => {});
  }, [isOpen]);

  const validateName = (value) => {
    if (!value.trim()) {
      setNameError("Name is required");
      return false;
    }
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError("Only letters, numbers, -, _ and . allowed");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleAddModel = (model) => {
    if (!models.includes(model.value)) {
      setModels([...models, model.value]);
    }
  };

  const handleDeselectModel = (model) => {
    setModels(models.filter((m) => m !== model.value));
  };

  const handleRemoveModel = (index) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newModels = [...models];
    [newModels[index - 1], newModels[index]] = [newModels[index], newModels[index - 1]];
    setModels(newModels);
  };

  const handleMoveDown = (index) => {
    if (index === models.length - 1) return;
    const newModels = [...models];
    [newModels[index], newModels[index + 1]] = [newModels[index + 1], newModels[index]];
    setModels(newModels);
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    await onSave({ name: name.trim(), models });
    setSaving(false);
  };

  const isEdit = !!combo;
  // Models Jev dropped from this combo; restore adds them back (persisted on Save, which clears their health).
  const removed = Object.entries(health).filter(([m, st]) => st?.removedAt && !models.includes(m));

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={isEdit ? "Edit Combo" : "Create Combo"}
        size="full"
      >
        <div className="flex flex-col gap-3">
          {/* Name */}
          <div>
            <Input
              label="Combo Name"
              value={name}
              onChange={handleNameChange}
              placeholder="my-combo"
              error={nameError}
            />
            <p className="mt-0.5 text-xs text-muted-foreground">
              Only letters, numbers, -, _ and . allowed
            </p>
          </div>

          {/* Models */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Models</label>

            {models.length === 0 ? (
              <div className="text-center py-4 border border-dashed border-black/10 dark:border-white/10 rounded-lg bg-black/[0.01] dark:bg-white/[0.01]">
                <span className="material-symbols-outlined text-muted-foreground text-xl mb-1">layers</span>
                <p className="text-xs text-muted-foreground">No models added yet</p>
              </div>
            ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
              <SortableContext items={modelItems.map((m) => m.uid)} strategy={verticalListSortingStrategy}>
                <div className="flex max-h-[55vh] min-w-0 flex-col gap-1 overflow-y-auto sm:max-h-[460px]">
                  {modelItems.map(({ uid, model }, index) => (
                    <ModelItem
                      key={uid}
                      id={uid}
                      index={index}
                      model={model}
                      isFirst={index === 0}
                      isLast={index === modelItems.length - 1}
                      onEdit={(newVal) => {
                        const updated = [...models];
                        updated[index] = newVal;
                        setModels(updated);
                      }}
                      onMoveUp={() => handleMoveUp(index)}
                      onMoveDown={() => handleMoveDown(index)}
                      info={evalMap[model]}
                      onRemove={() => handleRemoveModel(index)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            )}

            {/* Add Model button */}
            <button
              onClick={() => setShowModelSelect(true)}
              className="w-full mt-2 py-2 border border-dashed border-black/10 dark:border-white/10 rounded-lg text-xs text-primary font-medium hover:text-primary hover:border-primary/50 transition-colors flex items-center justify-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Add Model
            </button>
          </div>

          {removed.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <span className="font-medium">Removed by Jev:</span>
              {removed.map(([m]) => (
                <button key={m} type="button" onClick={() => setModels([...models, m])}
                  className="inline-flex items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 hover:bg-red-500/20">
                  <code className="font-mono">{m}</code>
                  <span className="material-symbols-outlined text-[13px]">undo</span>
                  Restore
                </button>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button onClick={onClose} variant="ghost" fullWidth size="sm">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              fullWidth
              size="sm"
              disabled={!name.trim() || !!nameError || saving}
            >
              {saving ? "Saving..." : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Model Select Modal */}
      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAddModel}
          onDeselect={handleDeselectModel}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Add Model to Combo"
          kindFilter={kindFilter}
          addedModelValues={models}
          closeOnSelect={false}
        />
      )}
    </>
  );
}
