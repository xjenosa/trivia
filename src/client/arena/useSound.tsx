// Turns what the room says into sound cues. All the game logic stays in the
// room: this only notices changes between snapshots.

import { useEffect, useRef, useState } from "react";
import type { StateMsg } from "../../shared/protocol";
import { useTimeLeft } from "../common/bits";
import { Sound } from "./audio";
import type { RevealStage } from "./layout";

export function useSound(state: StateMsg | null, stage: RevealStage, muted: boolean): { sound: Sound | null; audio: string } {
  const ref = useRef<Sound | null>(null);
  const [sound, setSound] = useState<Sound | null>(null);
  const [audio, setAudio] = useState("off");
  const mutedNow = useRef(muted);
  mutedNow.current = muted;

  useEffect(() => {
    const made = new Sound();
    made.setMuted(mutedNow.current);
    made.onState = setAudio;
    ref.current = made;
    setSound(made);
    // Browsers hold audio until a gesture: the host's first key press or click.
    const unlock = () => made.unlock();
    window.addEventListener("keydown", unlock);
    window.addEventListener("pointerdown", unlock);
    return () => {
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("pointerdown", unlock);
      made.dispose();
      ref.current = null;
    };
  }, []);

  useEffect(() => ref.current?.setMuted(muted), [muted]);

  // Join blip: the roster grew while in the lobby.
  const phase = state?.phase;
  const count = state?.players.length ?? 0;
  const lastCount = useRef<number | null>(null);
  useEffect(() => {
    if (!state) return;
    if (lastCount.current !== null && phase === "lobby" && count > lastCount.current) ref.current?.join();
    lastCount.current = count;
  }, [state, phase, count]);

  // Phase cues and the music that goes with each phase.
  const cue = state ? `${state.phase}:${state.questionNumber}` : "";
  const winners = state?.winners.length ?? 0;
  useEffect(() => {
    const s = ref.current;
    if (!s || !phase) return;
    if (phase === "lobby") s.music("lobby");
    else if (phase === "question") {
      s.questionStart();
      s.music("question");
    } else {
      s.music(null);
      if (phase === "over" && winners > 0) s.win();
    }
    // `sound` is a dependency so the first cue plays once the engine exists.
  }, [cue, phase, winners, sound]);

  // Collapse: the beat of the reveal where wrong platforms drop.
  const drops = state?.phase === "reveal" && stage === 1 && state.floorHeld === false && state.players.some((p) => p.hit);
  useEffect(() => {
    if (drops) ref.current?.collapse();
  }, [drops]);

  return { sound, audio };
}

// Ticks in the last five seconds of a question. Its own component, because the
// countdown re-renders ten times a second.
export function Ticker({ state, sound }: { state: StateMsg | null; sound: Sound | null }) {
  const { seconds } = useTimeLeft(state);
  const ticking = state?.phase === "question" && !state.paused;
  useEffect(() => {
    if (ticking && seconds >= 1 && seconds <= 5) sound?.tick(seconds === 1);
  }, [ticking, seconds, sound]);
  return null;
}
