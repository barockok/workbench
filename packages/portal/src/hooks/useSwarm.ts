import { useEffect, useRef, type RefObject } from "react";
import { createSwarm, type Swarm } from "@a-workbench/brand";

// Mounts the brand swarm on a canvas for the life of the component. Ground
// changes are forwarded, not rebuilt, so a theme toggle never replays the
// entrance.
export function useSwarm(ref: RefObject<HTMLCanvasElement | null>, opts: { ground: "dark" | "accent"; enabled?: boolean; markX?: number | (() => number); markY?: number | (() => number); markFrac?: number; ambient?: boolean }) {
  const swarm = useRef<Swarm | null>(null);
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled || !ref.current) return;
    // markX/markY may be a function so a caller can measure the canvas's
    // actual laid-out size right here, after paint, instead of during render
    // (when CSS dimensions aren't settled yet).
    const markX = typeof opts.markX === "function" ? opts.markX() : opts.markX;
    const markY = typeof opts.markY === "function" ? opts.markY() : opts.markY;
    swarm.current = createSwarm(ref.current, { ground: opts.ground, markX, markY, markFrac: opts.markFrac, ambient: opts.ambient });
    return () => { swarm.current?.destroy(); swarm.current = null; };
    // ground is handled by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ref]);
  useEffect(() => { swarm.current?.setGround(opts.ground); }, [opts.ground]);
}
