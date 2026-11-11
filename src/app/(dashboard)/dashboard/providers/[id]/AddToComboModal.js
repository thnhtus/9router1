"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Modal, Button, Select } from "@/shared/components";

export default function AddToComboModal({ isOpen, onClose, providerName, availableModels = [] }) {
  const [combos, setCombos] = useState([]);
  const [loadingCombos, setLoadingCombos] = useState(true);
  const [selectedComboId, setSelectedComboId] = useState("");
  const [selectedModelSet, setSelectedModelSet] = useState(() => new Set(availableModels));
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    let isMounted = true;
    fetch("/api/combos")
      .then((res) => (res.ok ? res.json() : { combos: [] }))
      .then((data) => {
        if (!isMounted) return;
        const llmCombos = (data.combos || []).filter((c) => !c.kind || c.kind === "llm");
        setCombos(llmCombos);
        if (llmCombos.length > 0) {
          setSelectedComboId(llmCombos[0].id);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch combos:", err);
      })
      .finally(() => {
        if (isMounted) setLoadingCombos(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const selectedCombo = useMemo(() => {
    return combos.find((c) => c.id === selectedComboId) || null;
  }, [combos, selectedComboId]);

  const { newModels, existingModels } = useMemo(() => {
    if (!selectedCombo) return { newModels: [], existingModels: [] };
    const currentComboModels = new Set(selectedCombo.models || []);
    const checkedModels = Array.from(selectedModelSet);

    const newM = checkedModels.filter((m) => !currentComboModels.has(m));
    const existingM = checkedModels.filter((m) => currentComboModels.has(m));
    return { newModels: newM, existingModels: existingM };
  }, [selectedCombo, selectedModelSet]);

  const comboOptions = useMemo(() => {
    return combos.map((c) => ({
      value: c.id,
      label: `${c.name} (${c.models?.length || 0} models)`,
    }));
  }, [combos]);

  const toggleModel = (model) => {
    setSelectedModelSet((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedModelSet.size === availableModels.length) {
      setSelectedModelSet(new Set());
    } else {
      setSelectedModelSet(new Set(availableModels));
    }
  };

  const handleSave = async () => {
    if (!selectedCombo || newModels.length === 0 || saving) return;
    setSaving(true);
    setSuccessMsg("");
    try {
      const updatedModels = Array.from(new Set([...(selectedCombo.models || []), ...newModels]));
      const res = await fetch(`/api/combos/${selectedCombo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedCombo.name,
          models: updatedModels,
        }),
      });

      if (res.ok) {
        setSuccessMsg(`Added ${newModels.length} model(s) to "${selectedCombo.name}"!`);
        setCombos((prev) =>
          prev.map((c) => (c.id === selectedCombo.id ? { ...c, models: updatedModels } : c))
        );
        setTimeout(() => {
          onClose();
        }, 800);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update combo");
      }
    } catch (error) {
      console.error("Error adding models to combo:", error);
      alert("Failed to update combo");
    } finally {
      setSaving(false);
    }
  };

  const allChecked = availableModels.length > 0 && selectedModelSet.size === availableModels.length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Add ${providerName || ""} Models to Combo`}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {loadingCombos ? (
          <div className="py-8 text-center text-xs text-muted-foreground">Loading combos…</div>
        ) : combos.length === 0 ? (
          <div className="py-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-3">
              <span className="material-symbols-outlined text-2xl">layers</span>
            </div>
            <p className="text-sm font-medium mb-1">No combos available</p>
            <p className="text-xs text-muted-foreground mb-4">
              Create a model combo first to add provider models to it.
            </p>
            <Link
              href="/dashboard/combos"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Go to Combos
            </Link>
          </div>
        ) : (
          <>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-foreground">Target Combo</label>
              <Select
                options={comboOptions}
                value={selectedComboId}
                onChange={(e) => setSelectedComboId(e.target.value)}
                selectClassName="py-1.5 text-xs font-mono"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-foreground">
                  Available Models ({selectedModelSet.size}/{availableModels.length} selected)
                </label>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[11px] text-primary hover:underline font-medium cursor-pointer"
                >
                  {allChecked ? "Deselect All" : "Select All"}
                </button>
              </div>

              <div className="max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-black/[0.02] dark:bg-white/[0.02] p-2 space-y-1">
                {availableModels.map((model) => {
                  const isChecked = selectedModelSet.has(model);
                  const isAlreadyInCombo = selectedCombo?.models?.includes(model);
                  return (
                    <label
                      key={model}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleModel(model)}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <code className="font-mono truncate">{model}</code>
                      </div>
                      {isAlreadyInCombo && (
                        <span className="text-[10px] text-muted-foreground/70 italic shrink-0">
                          (already in combo)
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {selectedCombo && (
              <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.03] p-2.5 text-xs flex items-center justify-between">
                <span className="text-muted-foreground">
                  Adding <strong className="text-foreground">{newModels.length}</strong> new model(s)
                  {existingModels.length > 0 && (
                    <span> ({existingModels.length} already in combo)</span>
                  )}
                </span>
                {newModels.length === 0 && selectedModelSet.size > 0 && (
                  <span className="text-[11px] text-amber-500 font-medium">All selected already exist</span>
                )}
              </div>
            )}

            {successMsg && (
              <p className="text-xs text-green-600 dark:text-green-400 font-medium">{successMsg}</p>
            )}

            <div className="flex gap-2 pt-1">
              <Button onClick={onClose} variant="ghost" fullWidth size="sm">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                fullWidth
                size="sm"
                disabled={!selectedCombo || newModels.length === 0 || saving}
              >
                {saving ? "Adding..." : `Add ${newModels.length} Model(s)`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
