import { ArrowUpDown, MoveDown, MoveUp } from "lucide-react";

export type SortDir = "asc" | "desc";

export default function SortHeaderCell(props: {
  label: string;
  k: string;
  sort: { key: string; dir: SortDir };
  onToggle: (k: string) => void;
  className?: string;
  title?: string;
  align?: "left" | "right" | "center";
}) {
  const { label, k, sort, onToggle, className, title, align = "left" } = props;
  const active = sort.key === k;
  const icon = !active ? (
    <ArrowUpDown aria-hidden="true" className="h-4 w-4 text-slate-400" />
  ) : sort.dir === "asc" ? (
    <MoveUp aria-hidden="true" className="h-3 w-4 text-slate-400" />
  ) : (
    <MoveDown aria-hidden="true" className="h-3 w-4 text-slate-400" />
  );

  const thAlign = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  return (
    <button
      type="button"
      onClick={() => onToggle(k)}
      title={title ?? `Sort by ${label}`}
      className={[
        "inline-flex w-full items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100",
        thAlign,
        className ?? "",
      ].join(" ")}
    >
      <span className={["min-w-0 flex-1 truncate whitespace-nowrap", thAlign].join(" ")}>{label}</span>
      <span className="shrink-0">{icon}</span>
    </button>
  );
}

