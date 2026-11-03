"use client";

import { cn } from "cn";
import { Switch } from "@/components/ui/switch";

export default function Toggle({ checked = false, onChange, label, description, disabled = false, size = "md", className, title, "aria-label": ariaLabel }) {
  return (
    <div className={cn("flex items-center gap-3", disabled && "opacity-50", className)}>
      <Switch
        checked={checked}
        onCheckedChange={(v) => onChange?.(v)}
        disabled={disabled}
        size={size === "sm" ? "sm" : "default"}
        aria-label={ariaLabel || label || title}
        title={title}
      />
      {(label || description) && (
        <div className="flex flex-col">
          {label && <span className="text-sm font-medium text-foreground">{label}</span>}
          {description && <span className="text-xs text-muted-foreground">{description}</span>}
        </div>
      )}
    </div>
  );
}
