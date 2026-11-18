import type { Pack, Question } from "../types";
import { computerScience } from "./computer-science";

// Add a pack here and the lobby grows a picker (it shows only above one pack).
export const PACKS: Pack[] = [computerScience];
export const DEFAULT_PACK = computerScience.id;

export function getPack(id: string): Pack {
  return PACKS.find((p) => p.id === id) ?? computerScience;
}

const byId = new Map<string, Question>();
for (const pack of PACKS) for (const q of pack.questions) byId.set(q.id, q);

export function getQuestion(id: string): Question | undefined {
  return byId.get(id);
}
