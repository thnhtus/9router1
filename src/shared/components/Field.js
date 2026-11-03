"use client";

// Shared label / error / hint wrapper for Input and Select
export default function Field({ id, label, required, error, hint, className, children }) {
  const msgId = `${id}-msg`;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </label>
      )}
      {children}
      {error && (
        <p id={msgId} role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-destructive">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}
      {hint && !error && <p id={msgId} className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
