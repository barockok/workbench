import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  state?: "default" | "valid" | "error";
}

export function Input({ state = "default", className, ...rest }: InputProps) {
  const classes = ["ui-input", `ui-input-${state}`, className].filter(Boolean).join(" ");
  return <input className={classes} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  state?: "default" | "valid" | "error";
}

export function Select({ state = "default", className, children, ...rest }: SelectProps) {
  const classes = ["ui-input", `ui-input-${state}`, className].filter(Boolean).join(" ");
  return (
    <select className={classes} {...rest}>
      {children}
    </select>
  );
}
