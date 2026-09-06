import { useEffect, useRef, type RefObject } from "react";
import { createSwarm, type Swarm } from "@a-workbench/brand";

// Mounts the brand swarm on a canvas for the life of the component. Ground
// changes are forwarded, not rebuilt, so a theme toggle never replays the
// entrance.
export function useSwarm(ref: RefObject<HTMLCanvasElement | null>, opts: { ground: "dark" | "accent"; enabled?: boolean; markX?: number; ambient?: boolean }) {
  const swarm = useRef<Swarm | null>(null);
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled || !ref.current) return;
    swarm.current = createSwarm(ref.current, { ground: opts.ground, markX: opts.markX, ambient: opts.ambient });
    return () => { swarm.current?.destroy(); swarm.current = null; };
    // ground is handled by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ref]);
  useEffect(() => { swarm.current?.setGround(opts.ground); }, [opts.ground]);
}
