import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <ConfirmDialog open={false} title="Disconnect acme" body="Stored credentials will be removed."
        confirmLabel="Disconnect" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the title and body in a dialog", () => {
    render(
      <ConfirmDialog open title="Disconnect acme" body="Stored credentials will be removed."
        confirmLabel="Disconnect" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Stored credentials will be removed.")).toBeInTheDocument();
  });

  it("reports confirm and cancel separately", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Disconnect acme" body="Gone for good." confirmLabel="Disconnect"
        onConfirm={onConfirm} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
