import type { ReactNode } from "react";

type MaxWidth = "3xl" | "5xl" | "6xl" | "7xl";

export function Container(props: { children: ReactNode; className?: string; maxWidth?: MaxWidth }) {
  const { children, className = "", maxWidth = "7xl" } = props;
  const shell =
    maxWidth === "3xl"
      ? "max-w-3xl"
      : maxWidth === "5xl"
        ? "max-w-5xl"
        : maxWidth === "6xl"
          ? "max-w-6xl"
          : "max-w-7xl";
  return <div className={`mx-auto w-full ${shell} px-4 ${className}`}>{children}</div>;
}

