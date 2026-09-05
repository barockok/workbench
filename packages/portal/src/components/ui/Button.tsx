import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  const classes = ["ui-button", `ui-button-${variant}`, `ui-button-${size}`, className]
    .filter(Boolean)
    .join(" ");
  return <button className={classes} {...rest} />;
}
