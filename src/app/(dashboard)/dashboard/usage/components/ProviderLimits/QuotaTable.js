"use client";

import { useMemo, useState } from "react";
import { formatResetTime, getRemainingPercentage } from "./utils";

const PAGE_SIZE = 10;

/**
 * Format reset time display (Today, 12:00 PM)
 */
function formatResetTimeDisplay(resetTime) {
  if (!resetTime) return null;

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayStr = "";
    if (date >= today && date < tomorrow) {
      dayStr = "Today";
    } else if (date >= tomorrow && date < new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)) {
      dayStr = "Tomorrow";
    } else {
      dayStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return `${dayStr}, ${timeStr}`;
  } catch {
    return null;
  }
}

// Usage-meter states (affectUI Usage Meter look): ok → neutral pill,
// warn/limit → tinted pill with a status dot. Thresholds on remaining %.
const METER_TONES = {
  ok: { bar: "bg-primary", pill: "bg-muted text-muted-foreground" },
  warn: { bar: "bg-warning", pill: "bg-warning/12 text-warning" },
  limit: { bar: "bg-danger", pill: "bg-danger/10 text-danger" },
  credit: { bar: "bg-info", pill: "bg-info/10 text-info" },
};

function getMeterState(remainingPercentage) {
  if (remainingPercentage > 70) return "ok";
  if (remainingPercentage >= 30) return "warn";
  return "limit";
}

function sortQuotas(quotas, sortMode) {
  if (sortMode === "remaining-asc") {
    return [...quotas].sort((a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name));
  }

  if (sortMode === "remaining-desc") {
    return [...quotas].sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
  }

  return quotas;
}

/**
 * Quota Table Component - Table-based display for quota data
 */
export default function QuotaTable({
  quotas = [],
  compact = false,
  sortMode = "default",
  showSortLabel = false,
  onHideQuota = null,
}) {
  const [pageState, setPage] = useState(1);
  const [pageKey, setPageKey] = useState({ sortMode, quotas });
  if (pageKey.sortMode !== sortMode || pageKey.quotas !== quotas) {
    setPageKey({ sortMode, quotas });
    setPage(1);
  }

  const normalizedQuotas = useMemo(
    () => quotas.map((quota, index) => ({
      ...quota,
      index,
      remaining: getRemainingPercentage(quota),
    })),
    [quotas],
  );

  const sortedQuotas = useMemo(
    () => sortQuotas(normalizedQuotas, sortMode),
    [normalizedQuotas, sortMode],
  );

  const totalPages = Math.max(1, Math.ceil(sortedQuotas.length / PAGE_SIZE));

  const page = Math.min(pageState, totalPages);

  if (!quotas || quotas.length === 0) {
    return null;
  }

  const currentPageRows = sortedQuotas.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const pageStart = sortedQuotas.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, sortedQuotas.length);

  const hasHideAction = typeof onHideQuota === "function";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 px-2 pt-0.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.5px] text-muted-foreground">
          {sortedQuotas.length} quota{sortedQuotas.length > 1 ? "s" : ""}
        </span>
        {showSortLabel && (
          <span className="text-[10px] text-muted-foreground">Sorted by account remaining</span>
        )}
      </div>

      <ul className="grid">
        {currentPageRows.map((quota) => {
          const isUnlimited = quota.unlimited === true;
          const isCreditBalance = quota.isCreditBalance === true;
          const state = getMeterState(quota.colorPercentage ?? quota.remaining);
          const tone = isCreditBalance ? METER_TONES.credit : METER_TONES[state];
          // Qoder flags open-ended plans with `neverExpires` (its API reports a
          // year-9999 sentinel). Return "-"/"Never expires" rather than an empty
          // countdown: the render below branches on `countdown !== "-"`, so an
          // empty string would fall through to the "in " label.
          const countdown = quota.neverExpires ? "-" : formatResetTime(quota.resetAt);
          // Providers that expose a detail page but no per-bucket reset date
          // (Qoder add-on grants) get a pointer to it instead of a bare "N/A".
          const seeDetails = !quota.neverExpires && !quota.resetAt && Boolean(quota.detailUrl);
          const resetDisplay = quota.emptyMessage
            ? quota.emptyMessage
            : quota.neverExpires
            ? "Never expires"
            : seeDetails
              ? "See details"
              : formatResetTimeDisplay(quota.resetAt);
          const resetSecondaryText = seeDetails && quota.detailUrl ? quota.detailUrl : resetDisplay;
          // recurring defaults true: a missing flag means the quota
          // refreshes at resetAt. Bonus/one-shot packs set recurring:false
          // and their resetAt is a hard expiry, so word it as "expires".
          const recurring = quota.recurring !== false;
          const countdownLabel = recurring ? `in ${countdown}` : `expires in ${countdown}`;
          const showsAlert = !isUnlimited && !isCreditBalance && state !== "ok";

          const valueTitle = isUnlimited
            ? `${quota.used.toLocaleString()} used · Unlimited`
            : isCreditBalance
            ? `Credit balance: ${quota.total.toFixed(2)} ${quota.currency || ""}`
            : `${quota.used.toLocaleString()} / ${quota.total > 0 ? quota.total.toLocaleString() : "∞"}`;

          const resetNode = seeDetails ? (
            <a
              href={quota.detailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 hover:text-foreground hover:underline"
              title={`Open usage details: ${resetSecondaryText}`}
              aria-label={`Open usage details for ${quota.name}`}
            >
              {resetDisplay}
              <span className="material-symbols-outlined text-[12px]">open_in_new</span>
            </a>
          ) : countdown !== "-" ? (
            countdownLabel
          ) : (
            resetDisplay || <span className="italic">N/A</span>
          );

          return (
            <li
              key={`${quota.name}-${quota.index}`}
              className={`group rounded-md px-2 transition-colors hover:bg-muted/40 ${compact ? "py-1.5" : "py-2"}`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`size-2 shrink-0 rounded-[2px] ${tone.bar}`} aria-hidden="true" />
                <span
                  className={`min-w-0 flex-1 truncate font-medium text-foreground ${compact ? "text-xs" : "text-sm"}`}
                  title={quota.name}
                >
                  {quota.name}
                </span>
                <span
                  className={`shrink-0 tabular-nums font-medium text-foreground ${compact ? "text-xs" : "text-sm"}`}
                  title={valueTitle}
                >
                  {isUnlimited ? (
                    <>
                      {quota.used.toLocaleString()}
                      <span className="font-normal text-muted-foreground"> of ∞</span>
                    </>
                  ) : isCreditBalance ? (
                    <>
                      {quota.total.toFixed(2)}
                      <span className="font-normal text-muted-foreground"> {quota.currency || "credit"}</span>
                    </>
                  ) : (
                    <>
                      {quota.used.toLocaleString()}
                      <span className="font-normal text-muted-foreground">
                        {" "}of {quota.total > 0 ? quota.total.toLocaleString() : "∞"}
                        {quota.unit ? ` ${quota.unit}` : ""}
                      </span>
                    </>
                  )}
                </span>
                {!isCreditBalance && (
                  <span
                    className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium tabular-nums ${
                      isUnlimited ? METER_TONES.ok.pill : tone.pill
                    }`}
                    title={isUnlimited ? "Unlimited" : `${quota.remaining}% remaining`}
                  >
                    {showsAlert && (
                      <span className={`size-1.5 rounded-full ${tone.bar}`} aria-hidden="true" />
                    )}
                    {isUnlimited ? "∞" : `${quota.remaining}%`}
                  </span>
                )}
                {hasHideAction && (
                  <button
                    type="button"
                    onClick={() => onHideQuota(quota)}
                    className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    title="Hide this quota row"
                    aria-label={`Hide quota ${quota.name}`}
                  >
                    <span className="material-symbols-outlined text-[14px]">visibility_off</span>
                  </button>
                )}
              </div>

              <div className="mt-1.5 flex min-w-0 items-center gap-2.5 pl-[18px]">
                {isUnlimited ? (
                  <span
                    className="h-1 flex-1 rounded-full bg-[repeating-linear-gradient(90deg,var(--color-border)_0_4px,transparent_4px_7px)]"
                    role="img"
                    aria-label={`${quota.name}: ${quota.used.toLocaleString()}, unlimited`}
                  />
                ) : isCreditBalance ? (
                  <span className="flex-1" />
                ) : (
                  <span
                    className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
                    role="meter"
                    aria-label={`${quota.name} remaining`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(quota.remaining, 100)}
                  >
                    <span
                      className={`block h-full rounded-full transition-[width] duration-300 ${tone.bar}`}
                      style={{ width: `${Math.min(quota.remaining, 100)}%` }}
                    />
                  </span>
                )}
                <span
                  className="max-w-[45%] shrink-0 truncate text-[11px] tabular-nums text-muted-foreground"
                  title={resetSecondaryText || ""}
                >
                  {resetNode}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-2 pt-1.5 text-[10px] tabular-nums text-muted-foreground">
          <span>
            {pageStart}–{pageEnd} of {sortedQuotas.length} · Page {page}/{totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
              disabled={page === 1}
              className="flex h-6 items-center rounded-md border border-border px-2 text-[10px] text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
              disabled={page === totalPages}
              className="flex h-6 items-center rounded-md border border-border px-2 text-[10px] text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
