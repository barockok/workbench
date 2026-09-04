import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InstanceUrlDialog } from "./InstanceUrlDialog";

const CONFIG = { label: "Instance URL", default: "https://example.com", placeholder: "https://…" };

describe("InstanceUrlDialog", () => {
  it("prefills the field with the configured default", () => {
    render(<InstanceUrlDialog open config={CONFIG} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText("Instance URL")).toHaveValue("https://example.com");
  });

  it("submits what the human typed", () => {
    const onSubmit = vi.fn();
    render(<InstanceUrlDialog open config={CONFIG} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Instance URL"), { target: { value: "https://acme.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith("https://acme.example.com");
  });

  it("falls back to the default when the field is emptied", () => {
    const onSubmit = vi.fn();
    render(<InstanceUrlDialog open config={CONFIG} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Instance URL"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith("https://example.com");
  });
});
