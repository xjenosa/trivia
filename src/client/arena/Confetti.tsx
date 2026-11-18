// Confetti for the winner: paper in the platform colors, falling once. A plain 2D
// canvas over the stage, so both projector pages share it. Off under reduced motion.

import { useEffect, useRef } from "react";
import { ZONE_COUNT } from "../../shared/config";
import { platformColor, reducedMotion, token } from "../common/brand";

const PIECES = 150;
const SECONDS = 4.2;

export function Confetti({ run }: { run: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (!run || !el || !g || reducedMotion()) return;

    const w = (el.width = el.clientWidth);
    const h = (el.height = el.clientHeight);
    const colors = [...Array.from({ length: ZONE_COUNT }, (_, i) => platformColor(i)), token("--color-live"), token("--color-text")];
    const pieces = Array.from({ length: PIECES }, (_, i) => ({
      x: w * (0.15 + Math.random() * 0.7),
      y: -h * (0.05 + Math.random() * 0.35),
      vx: (Math.random() - 0.5) * w * 0.12,
      vy: h * (0.18 + Math.random() * 0.28),
      size: w * (0.005 + Math.random() * 0.006),
      spin: Math.random() * Math.PI * 2,
      turn: (Math.random() - 0.5) * 9,
      color: colors[i % colors.length]!,
    }));

    let frame = 0;
    let last = performance.now();
    const start = last;
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const age = (now - start) / 1000;
      g.clearRect(0, 0, w, h);
      g.globalAlpha = Math.max(0, Math.min(1, (SECONDS - age) / 0.8));
      for (const p of pieces) {
        p.vy += h * 0.35 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.spin += p.turn * dt;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.spin);
        // A flat piece of paper turning in the air: its width breathes.
        g.scale(Math.cos(p.spin * 1.7), 1);
        g.fillStyle = p.color;
        g.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
        g.restore();
      }
      if (age < SECONDS) frame = requestAnimationFrame(draw);
      else g.clearRect(0, 0, w, h);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      g.clearRect(0, 0, w, h);
    };
  }, [run]);

  return <canvas ref={canvas} className="confetti" aria-hidden="true" />;
}
