import type { ReactNode } from "react";

export function MobileCardList(props: { children: ReactNode; className?: string }) {
  const { children, className = "" } = props;
  return <div className={`space-y-3 ${className}`}>{children}</div>;
}

export function MobileCard(props: { children: ReactNode; className?: string }) {
  const { children, className = "" } = props;
  return <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white ${className}`}>{children}</div>;
}

export function MobileCardBody(props: { children: ReactNode; className?: string }) {
  const { children, className = "" } = props;
  return <div className={`p-4 ${className}`}>{children}</div>;
}

export function MobileCardHeader(props: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; className?: string }) {
  const { title, subtitle, right, className = "" } = props;
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <div className="truncate text-sm font-extrabold text-slate-900">{title}</div>
        {subtitle ? <div className="mt-1 truncate text-xs font-semibold text-slate-600">{subtitle}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function MobileCardMetaGrid(props: { children: ReactNode; className?: string }) {
  const { children, className = "" } = props;
  return <div className={`mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 ${className}`}>{children}</div>;
}

export function MobileCardMeta(props: { label: string; value: ReactNode; className?: string }) {
  const { label, value, className = "" } = props;
  return (
    <div className={className}>
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}

export function MobileCardActions(props: { children: ReactNode; className?: string }) {
  const { children, className = "" } = props;
  return <div className={`mt-4 flex flex-wrap items-center gap-2 ${className}`}>{children}</div>;
}

