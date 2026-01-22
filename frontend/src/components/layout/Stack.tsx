import type { CSSProperties, ReactNode } from "react";

export function Stack(props: {
  children: ReactNode;
  className?: string;
  gapClassName?: string;
  style?: CSSProperties;
}) {
  const { children, className = "", gapClassName = "gap-4", style } = props;
  return (
    <div className={`flex min-w-0 flex-col ${gapClassName} ${className}`} style={style}>
      {children}
    </div>
  );
}

