// Brand tokens for canvases and three.js. The values live in brand.css; this
// reads them back so no color is written twice.

import { COLOR_COUNT, ZONE_COUNT } from "../../shared/config";

const cache = new Map<string, string>();

export function token(name: string): string {
  let value = cache.get(name);
  if (value === undefined) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    cache.set(name, value);
  }
  return value;
}

const wrap = (index: number, count: number) => ((index % count) + count) % count;

export const platformColor = (zone: number) => token(`--color-platform-${wrap(zone, ZONE_COUNT)}`);
export const platformVar = (zone: number) => `var(--color-platform-${wrap(zone, ZONE_COUNT)})`;
export const avatarColor = (index: number) => token(`--color-avatar-${wrap(index, COLOR_COUNT)}`);
export const avatarVar = (index: number) => `var(--color-avatar-${wrap(index, COLOR_COUNT)})`;

export const FONT = '"Inter Variable", sans-serif';

// A name's first letter, for the token face. Empty for no name: the token then
// shows the person silhouette (bits.tsx), never a stand-in character.
export function initial(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toUpperCase() : "";
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
