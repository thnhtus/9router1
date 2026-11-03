"use client";

import { cn } from "cn";
import { Skeleton as UISkeleton } from "@/components/ui/skeleton";

// Spinner loading
export function Spinner({ size = "md", className }) {
  const sizes = {
    sm: "size-4",
    md: "size-6",
    lg: "size-8",
    xl: "size-12",
  };

  return (
    <span
      className={cn(
        "material-symbols-outlined animate-spin text-primary",
        sizes[size],
        className
      )}
    >
      progress_activity
    </span>
  );
}

// Full page loading
export function PageLoading({ message = "Loading..." }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <Spinner size="xl" />
      <p className="mt-4 text-muted-foreground">{message}</p>
    </div>
  );
}

// Skeleton loading
export const Skeleton = UISkeleton;

// Load failure with retry. Shown instead of a silently empty page.
export function ErrorState({ message = "Couldn't load this page.", onRetry, className }) {
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm", className)}>
      <span className="material-symbols-outlined text-[20px] text-destructive" aria-hidden="true">error</span>
      <p className="min-w-0 flex-1 text-foreground">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-xs font-medium text-foreground hover:bg-muted">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
          Retry
        </button>
      )}
    </div>
  );
}

// Card skeleton
export function CardSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="p-6 rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-10 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export default function Loading({ type = "spinner", ...props }) {
  switch (type) {
    case "page":
      return <PageLoading {...props} />;
    case "skeleton":
      return <Skeleton {...props} />;
    case "card":
      return <CardSkeleton {...props} />;
    default:
      return <Spinner {...props} />;
  }
}
