"use client";

// Per-API-key rate limits + budgets (rpm, tokens, cost, period).
// Saves on blur for numeric inputs and on change for the period select.
// No limits set (all zero) means unlimited (FR-TO-007).
import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Toggle } from "@/shared/components";

const PERIODS = ["daily", "monthly"];

const DEFAULT_LIMITS = { rpm: 0, tokens: 0, cost: 0, period: "daily" };

export default function KeyLimitsControls({ apiKey, onChange }) {
  const [limits, setLimits] = useState({ ...DEFAULT_LIMITS, ...(apiKey.limits || {}) });
  const [usage, setUsage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Usage snapshot; fetched on mount and after each save.
  const loadUsage = (id) =>
    fetch(`/api/keys/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  const refreshUsage = () => loadUsage(apiKey.id).then((data) => data && setUsage(data.usage || null));
  useEffect(() => {
    let alive = true;
    loadUsage(apiKey.id).then((data) => {
      if (alive && data) setUsage(data.usage || null);
    });
    return () => { alive = false; };
  }, [apiKey.id]);

  const save = async (next) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${apiKey.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limits: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Save failed (${res.status})`);
        return;
      }
      setLimits({ ...DEFAULT_LIMITS, ...(data.key?.limits || next) });
      onChange?.(data.key?.limits || next);
      refreshUsage();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const setField = (field, raw) => {
    const num = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(num)) return;
    const next = { ...limits, [field]: num };
    setLimits(next);
  };
  const blurSave = () => save(limits);

  const hasLimits = (limits.rpm || 0) > 0 || (limits.tokens || 0) > 0 || (limits.cost || 0) > 0;

  return (
    <div className="mt-2" data-testid="key-limits">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Limits</span>
        {saving && <span className="text-xs text-muted-foreground">saving…</span>}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          RPM
          <input
            type="number"
            min={0}
            max={600}
            value={limits.rpm || 0}
            onChange={(e) => setField("rpm", e.target.value)}
            onBlur={() => blurSave("rpm")}
            className="w-20 rounded border border-border bg-transparent px-2 py-1 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Tokens / period
          <input
            type="number"
            min={0}
            max={5000000}
            value={limits.tokens || 0}
            onChange={(e) => setField("tokens", e.target.value)}
            onBlur={() => blurSave("tokens")}
            className="w-28 rounded border border-border bg-transparent px-2 py-1 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Cost / period
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={limits.cost || 0}
            onChange={(e) => setField("cost", e.target.value)}
            onBlur={() => blurSave("cost")}
            className="w-24 rounded border border-border bg-transparent px-2 py-1 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Period
          <select
            value={limits.period || "daily"}
            onChange={(e) => {
              const next = { ...limits, period: e.target.value };
              setLimits(next);
              save(next);
            }}
            className="rounded border border-border bg-transparent px-2 py-1 text-sm text-foreground"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        0 = unlimited. Resets per period (UTC).
      </p>
      {hasLimits && usage && (
        <div className="mt-2 text-xs text-muted-foreground">
          Used this period: {usage.tokens} tokens, ${Number(usage.cost).toFixed(4)}, {usage.requests} requests. Resets {new Date(usage.resetsAt).toLocaleString()}.
        </div>
      )}
    </div>
  );
}

KeyLimitsControls.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    limits: PropTypes.shape({ rpm: PropTypes.number, tokens: PropTypes.number, cost: PropTypes.number, period: PropTypes.string }),
  }).isRequired,
  onChange: PropTypes.func,
};
