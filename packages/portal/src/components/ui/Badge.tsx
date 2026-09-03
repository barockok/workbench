import type { ReactNode } from "react";

export interface BadgeProps {
  variant?: "primary" | "blue" | "green" | "orange" | "red" | "yellow" | "neutral";
  children: ReactNode;
}

export function Badge({ variant = "neutral", children }: BadgeProps) {
  return <span className={`ui-badge ui-badge-${variant}`}>{children}</span>;
}
