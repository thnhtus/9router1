"use client";

import { cn } from "cn";
import { Button as UIButton } from "@/components/ui/button";

// Legacy API → shadcn Button variants/sizes
const variants = { primary: "default", secondary: "secondary", outline: "outline", ghost: "ghost", danger: "destructive", success: "default" };
const sizes = { xs: "xs", sm: "sm", md: "lg", lg: "lg" };

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  const iconCls = cn("material-symbols-outlined", size === "xs" ? "text-[14px]" : "text-[18px]");
  return (
    <UIButton
      variant={variants[variant] || "default"}
      size={sizes[size] || "lg"}
      className={cn(
        "shrink cursor-pointer", // legacy buttons could shrink; shadcn sets shrink-0
        variant === "success" && "bg-green-600 text-white hover:bg-green-700",
        size === "lg" && "h-11 px-6",
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className={cn(iconCls, "animate-spin")}>progress_activity</span>
      ) : icon ? (
        <span className={iconCls}>{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && <span className={iconCls}>{iconRight}</span>}
    </UIButton>
  );
}
