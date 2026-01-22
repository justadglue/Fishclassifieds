import type { CSSProperties, ReactNode } from "react";

export function Inline(props: {
  children: ReactNode;
  className?: string;
  gapClassName?: string;
  wrap?: boolean;
  style?: CSSProperties;
}) {
  const { children, className = "", gapClassName = "gap-3", wrap = true, style } = props;
  return (
    <div className={`flex min-w-0 items-center ${wrap ? "flex-wrap" : ""} ${gapClassName} ${className}`} style={style}>
      {children}
    </div>
  );
}

