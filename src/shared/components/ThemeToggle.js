"use client";

import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";

export default function ThemeToggle({ className, variant = "default" }) {
  const { isDark, toggleTheme } = useTheme();

  const variants = {
    default: cn(
      "flex items-center justify-center size-8 rounded-md",
      "text-muted-foreground hover:text-foreground transition-colors",
      "hover:bg-black/[0.04] dark:hover:bg-white/[0.05]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    ),
    card: cn(
      "flex items-center justify-center size-11 rounded-full",
      "bg-card/60 hover:bg-card",
      "border border-border",
      "backdrop-blur-md shadow-sm hover:shadow-[var(--shadow-warm)]",
      "text-muted-foreground hover:text-primary",
      "transition-all group"
    ),
  };

  return (
    <button
      onClick={toggleTheme}
      className={cn(variants[variant], className)}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <span
        className={cn(
          variant === "card" ? "material-symbols-outlined text-[22px]" : "material-symbols-outlined text-[18px]! leading-none",
          variant === "card" && "transition-transform duration-300 group-hover:rotate-12"
        )}
      >
        {isDark ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}
