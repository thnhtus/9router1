"use client";

import { cn } from "cn";
import { Badge as UIBadge } from "@/components/ui/badge";

const tones = {
  default: "",
  primary: "bg-primary/10 text-primary",
  success: "bg-green-500/10 text-green-600 dark:text-green-400",
  warning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  error: "bg-red-500/10 text-red-600 dark:text-red-400",
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
};
const dots = { default: "bg-muted-foreground", primary: "bg-primary", success: "bg-green-500", warning: "bg-yellow-500", error: "bg-red-500", info: "bg-blue-500" };
const sizes = { sm: "h-4 px-1.5 text-[10px]", md: "", lg: "h-6 px-2.5 text-sm" };

export default function Badge({ children, variant = "default", size = "md", dot = false, icon, className }) {
  return (
    <UIBadge variant={variant === "default" ? "secondary" : "default"} className={cn(tones[variant], sizes[size], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", dots[variant])} />}
      {icon && <span className="material-symbols-outlined text-[14px]">{icon}</span>}
      {children}
    </UIBadge>
  );
}
