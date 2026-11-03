"use client";

import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function Tooltip({ text, children, position = "top", color }) {
  return (
    <UITooltip>
      <TooltipTrigger render={<span className="relative inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent side={position} style={color ? { backgroundColor: color } : undefined}>{text}</TooltipContent>
    </UITooltip>
  );
}
