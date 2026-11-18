// Landing: what `/` shows a visitor with no room code and no game to rejoin
// (App.tsx decides). It only links onward: /host, or the join form through onRoom.
// The video files live in public/video/ and are made by test/e2e/video.mjs.

import { useRef, useState, useSyncExternalStore } from "react";
import { CODE_LENGTH, CODE_PATTERN } from "../../shared/config";
import { Icon } from "../common/icons";
import { GlassButton, useGlassMode } from "../ui/glass";
import "./landing.css";

const STILL = "(prefers-reduced-motion: reduce)";
const SMALL = "(max-width: 759px)"; // the same breakpoint as landing.css

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => matchMedia(query).matches,
  );
}

export default function Landing({ clean, onRoom }: { clean(raw: string): string; onRoom(code: string): void }) {
  const [code, setCode] = useState("");
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const still = useMedia(STILL);
  const size = useMedia(SMALL) ? "360" : "720";
  const glass = useGlassMode();
  const ready = CODE_PATTERN.test(code);

  return (
    <main className="landing">
      <header className="ld-head">
        <h1 className="ld-title">Trivia</h1>
        <p className="ld-line">Live elimination trivia for in-person events.</p>
      </header>

      <div className="ld-actions">
        <a className="ld-host" href="/host" data-testid="landing-host">
          Host a game
        </a>
        <form
          className="ld-join"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onRoom(code);
          }}
        >
          <input
            data-testid="landing-room"
            aria-label="Room code"
            placeholder="Room code"
            value={code}
            onChange={(event) => setCode(clean(event.target.value))}
            maxLength={CODE_LENGTH}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <button type="submit" disabled={!ready} aria-label="Join" data-testid="landing-join">
            <Icon name="arrow_right_circle_fill" />
          </button>
        </form>
      </div>

      <div className="ld-video">
        <video
          ref={video}
          data-testid="landing-video"
          key={size}
          src={`/video/trivia-${size}.mp4`}
          poster={`/video/trivia-${size}.webp`}
          width={size === "360" ? 640 : 1280}
          height={size === "360" ? 360 : 720}
          aria-label="A round of Trivia: the projector and one player's phone, side by side"
          muted
          playsInline
          loop
          autoPlay={!still}
          preload={still ? "none" : "auto"}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={() => {
            if (still) video.current?.pause();
          }}
        />
        {still && !playing ? (
          <div className="ld-over">
            <GlassButton
              className={glass === "refract" ? "ld-play" : "glass ld-play"}
              aria-label="Play"
              data-testid="landing-play"
              onClick={() => void video.current?.play()}
            >
              <Icon name="play_fill" />
            </GlassButton>
          </div>
        ) : null}
      </div>
    </main>
  );
}
