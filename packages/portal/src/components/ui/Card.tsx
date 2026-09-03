import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  clickable?: boolean;
  disabled?: boolean;
}

export function Card({ clickable, disabled, className, ...rest }: CardProps) {
  const classes = ["ui-card", clickable && "ui-card-clickable", disabled && "ui-card-disabled", className]
    .filter(Boolean)
    .join(" ");
  return <div className={classes} {...rest} />;
}
