import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";

// vi.mock is hoisted above every import (including the static import of
// ./useSwarm below), so the mock data it closes over must be built inside
// vi.hoisted to run before anything else in the module.
const { destroy, setGround, createSwarm } = vi.hoisted(() => {
  const destroy = vi.fn(), setGround = vi.fn();
  const createSwarm = vi.fn(() => ({ destroy, setGround, replay: vi.fn(), state: vi.fn() }));
  return { destroy, setGround, createSwarm };
});
vi.mock("@a-workbench/brand", () => ({ createSwarm }));

import { useSwarm } from "./useSwarm";

function Host({ ground, enabled = true }: { ground: "dark" | "accent"; enabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useSwarm(ref, { ground, enabled });
  return <div><canvas ref={ref} /></div>;
}

beforeEach(() => { createSwarm.mockClear(); destroy.mockClear(); setGround.mockClear(); });

describe("useSwarm", () => {
  it("creates the swarm on mount with the given ground and destroys it on unmount", () => {
    const { unmount } = render(<Host ground="dark" />);
    expect(createSwarm).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), expect.objectContaining({ ground: "dark" }));
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  it("switches ground without rebuilding", () => {
    const { rerender } = render(<Host ground="dark" />);
    rerender(<Host ground="accent" />);
    expect(createSwarm).toHaveBeenCalledTimes(1);
    expect(setGround).toHaveBeenCalledWith("accent");
  });
  it("does nothing when disabled", () => {
    render(<Host ground="dark" enabled={false} />);
    expect(createSwarm).not.toHaveBeenCalled();
  });
});
