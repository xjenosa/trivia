// Framework7 Icons (MIT), filled variants, straight from the package's svg folder.
// One set, one weight: nothing else is mixed in, and never SF Symbols.

import arrowRight from "framework7-icons/svg/arrow_right_circle_fill.svg?raw";
import fullscreen from "framework7-icons/svg/arrow_up_left_arrow_down_right.svg?raw";
import checkmark from "framework7-icons/svg/checkmark_circle_fill.svg?raw";
import next from "framework7-icons/svg/forward_end_fill.svg?raw";
import heart from "framework7-icons/svg/heart_fill.svg?raw";
import house from "framework7-icons/svg/house_fill.svg?raw";
import pause from "framework7-icons/svg/pause_fill.svg?raw";
import personCrop from "framework7-icons/svg/person_crop_circle_fill.svg?raw";
import play from "framework7-icons/svg/play_fill.svg?raw";
import speaker from "framework7-icons/svg/speaker_2_fill.svg?raw";
import speakerOff from "framework7-icons/svg/speaker_slash_fill.svg?raw";
import wifiOff from "framework7-icons/svg/wifi_slash.svg?raw";
import xmark from "framework7-icons/svg/xmark_circle_fill.svg?raw";
import { cn } from "./cn";

const RAW = {
  play_fill: play,
  forward_end_fill: next,
  pause_fill: pause,
  heart_fill: heart,
  house_fill: house,
  speaker_2_fill: speaker,
  speaker_slash_fill: speakerOff,
  arrow_up_left_arrow_down_right: fullscreen,
  checkmark_circle_fill: checkmark,
  xmark_circle_fill: xmark,
  wifi_slash: wifiOff,
  arrow_right_circle_fill: arrowRight,
} as const;

export type IconName = keyof typeof RAW;

interface Glyph {
  d: string;
  transform?: string;
}

function parse(svg: string): Glyph {
  const d = /<path[^>]*\sd="([^"]+)"/.exec(svg)?.[1] ?? "";
  const transform = /<path[^>]*\stransform="([^"]+)"/.exec(svg)?.[1];
  return transform ? { d, transform } : { d };
}

// Every glyph sits on a 56-unit grid.
export const ICON_GRID = 56;
export const GLYPHS = Object.fromEntries(
  Object.entries(RAW).map(([name, svg]) => [name, parse(svg)]),
) as Record<IconName, Glyph>;

// A token with no name yet, as Contacts draws one: the head and shoulders from
// person_crop_circle_fill without its circle. The shoulders end on an arc of
// radius 20.2 round the grid's center, so a viewBox of that circle lets the bubble
// crop them at its edge.
const crop = parse(personCrop).d;
export const SILHOUETTE = { d: crop.slice(crop.indexOf("Z") + 1).trim(), viewBox: "7.8 7.8 40.4 40.4" };

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const glyph = GLYPHS[name];
  return (
    <svg className={cn("ico", className)} viewBox={`0 0 ${ICON_GRID} ${ICON_GRID}`} aria-hidden="true">
      <path d={glyph.d} transform={glyph.transform} />
    </svg>
  );
}
