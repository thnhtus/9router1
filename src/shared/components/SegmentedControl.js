"use client";

import { cn } from "cn";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const sizes = { sm: "sm", md: "default", lg: "lg" };

export default function SegmentedControl({ options = [], value, onChange, size = "md", className, disabled }) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v) => v[0] !== undefined && onChange(v[0])}
      size={sizes[size]}
      spacing={0}
      disabled={disabled}
      className={cn("max-w-full gap-1 overflow-x-auto rounded-xl border border-black/[0.06] bg-white p-1 shadow-soft dark:border-white/[0.07] dark:bg-white/[0.03]", className)}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="rounded-[7px]! border-0 px-3.5 font-medium text-foreground/40 hover:text-foreground/70 data-pressed:bg-black/[0.06] data-pressed:text-foreground dark:data-pressed:bg-white/[0.08]"
        >
          {o.icon && <span className="material-symbols-outlined text-[16px]">{o.icon}</span>}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
