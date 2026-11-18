// The 3D board for /host: owns the canvases and hands each snapshot to the scene.
// Layers, back to front: the Kawarp backdrop, a scrim, the transparent three.js
// canvas. The glass chrome from Projector.tsx floats above all three.

import { useEffect, useRef, useState } from "react";
import type { BoardProps } from "./Projector";
import { ArenaScene } from "./scene";

export function Board3D({ state, positions, stage, tick }: BoardProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const backdrop = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ArenaScene | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    const stageEl = el?.parentElement;
    if (!el || !stageEl) return;
    let made: ArenaScene;
    try {
      made = new ArenaScene(el, backdrop.current);
    } catch {
      setFailed(true);
      return;
    }
    scene.current = made;
    const fit = () => made.resize(stageEl.clientWidth, stageEl.clientHeight);
    const observer = new ResizeObserver(fit);
    observer.observe(stageEl);
    fit();
    return () => {
      observer.disconnect();
      made.dispose();
      scene.current = null;
    };
  }, []);

  // Positions are mutated in place; `tick` re-renders this when they change.
  useEffect(() => {
    scene.current?.set({ state, positions, stage });
  }, [state, positions, stage, tick]);

  return (
    <>
      <canvas className="backdrop" ref={backdrop} width={256} height={256} aria-hidden="true" />
      <div className="scrim" />
      <canvas
        className="arena3d"
        ref={canvas}
        role="img"
        aria-label="The arena: four answer platforms, with player tokens moving between them"
      />
      {failed ? (
        <div className="no-webgl" data-testid="no-webgl">
          <p>This device cannot draw the 3D arena</p>
          <a href={`/host/2d${location.search}`}>Open the 2D view</a>
        </div>
      ) : null}
    </>
  );
}
