"use client";

import { useId } from "react";
import { cn } from "cn";
import { Input as UIInput } from "@/components/ui/input";
import Field from "./Field";

export default function Input({ label, error, hint, icon, required = false, className, inputClassName, id, ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <Field id={inputId} label={label} required={required} error={error} hint={hint} className={className}>
      <div className="relative">
        {icon && (
          <span className="material-symbols-outlined pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[20px] text-muted-foreground">{icon}</span>
        )}
        <UIInput
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${inputId}-msg` : undefined}
          className={cn("h-9 text-[16px] sm:text-sm", icon && "pl-10", inputClassName)}
          {...props}
        />
      </div>
    </Field>
  );
}
