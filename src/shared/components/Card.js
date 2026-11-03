"use client";

import { cn } from "cn";

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev = false,
  className,
  ...props
}) {
  const paddings = {
    none: "",
    xs: "p-3",
    sm: "p-4",
    md: "p-5",
    lg: "p-6",
  };

  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-xl border border-black/[0.06] bg-card text-card-foreground shadow-soft dark:border-white/[0.07]",
        elev && "shadow-[var(--shadow-elev)]",
        hover && "cursor-pointer transition-all hover:border-primary/30 hover:shadow-[var(--shadow-warm)]",
        paddings[padding],
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && (
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]! leading-none text-muted-foreground">{icon}</span>
            )}
            <div>
              {title && (
                <h3 className="text-[15px] font-semibold tracking-tight text-card-foreground">{title}</h3>
              )}
              {subtitle && (
                <p className="text-[13px] text-muted-foreground">{subtitle}</p>
              )}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

Card.Section = function CardSection({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-muted/40 p-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.Row = function CardRow({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "p-3 -mx-3 px-3 transition-colors",
        "border-b last:border-b-0",
        "hover:bg-muted/50",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({
  children,
  actions,
  className,
  ...props
}) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between p-3 -mx-3 px-3",
        "border-b last:border-b-0",
        "hover:bg-muted/50 transition-colors",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
          {actions}
        </div>
      )}
    </div>
  );
};
