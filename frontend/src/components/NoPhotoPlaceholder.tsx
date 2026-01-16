export default function NoPhotoPlaceholder(props: { title?: string; variant?: "tile" | "detail"; className?: string }) {
    const variant = props.variant ?? "detail";
    const wrapCls =
        variant === "tile"
            ? "flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500"
            : "flex h-full w-full flex-col items-center justify-center gap-2 bg-linear-to-b from-slate-50 to-slate-100 text-slate-500";

    const iconCls = variant === "tile" ? "h-6 w-6" : "h-9 w-9";
    const textCls = variant === "tile" ? "text-xs font-semibold" : "text-xs font-semibold";

    return (
        <div className={[wrapCls, props.className ?? ""].join(" ").trim()}>
            <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3l2-2h8l2 2h3a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
            </svg>
            <div className={textCls}>No images provided</div>
        </div>
    );
}

