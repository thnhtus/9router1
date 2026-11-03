"use client";

import { useId } from "react";
import { cn } from "cn";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import Field from "./Field";

export default function Select({ label, options = [], placeholder = "Select an option", error, hint, required = false, className, selectClassName, id, ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <Field id={inputId} label={label} required={required} error={error} hint={hint} className={className}>
      <NativeSelect
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${inputId}-msg` : undefined}
        className={cn("w-full [&_select]:h-9 [&_select]:text-[16px] sm:[&_select]:text-sm", selectClassName)}
        {...props}
      >
        <NativeSelectOption value="" disabled>{placeholder}</NativeSelectOption>
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}
