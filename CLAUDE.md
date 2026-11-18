# Trivia: rules for working in this repo

Trivia is a live elimination trivia game for in-person events. A projector page hosts a
room, phones join from a QR code, and one Cloudflare Durable Object per room runs the game.

## Writing

- No em dash (U+2014) anywhere: code, comments, docs, commit messages, chat.
- Code comments are for an AI reader: keep only what bears load (constraints, invariants,
  cross-file links, a non-obvious reason).
- This file holds rules only: no dates, quotes or history. Anything pending goes in QUEUE.md.
- QUEUE.md (repo root, git-ignored) holds in-flight work only. An item is deleted in the turn
  it is finished.

## Commits

- Never commit or push unless asked. An ask covers the work done up to it, never what comes
  after.
- Commit style is the owner's Wishlist repo's: the public history is `Initial commit`
  (LICENSE, GitHub's AGPL-3.0 text, and a README of just `# trivia`), then one commit titled
  `feat: trivia <version>` (the version in package.json), with no body. Ask the owner how
  to record later work before adding a third commit.
- Never add a Co-Authored-By trailer or any AI attribution to commits or PRs.

## Sources and licenses

- Bean Bash (github.com/GDG-on-Campus-Seneca-Polytechnic/bean-bash) is a reference for
  mechanics only. It has no license, so never copy its code, assets, music or questions.
- Never ship SF Pro, SF Symbols, Apple logos or the Apple name. The look is Apple style; the
  assets are not Apple's.
- Everything bundled must stay compatible with AGPL-3.0-only. Components taken from 21st.dev
  keep their source and license in a header comment (see `src/client/ui/`).
- `API_KEY_21ST` lives only in the owner's shell. Never commit it or write it into any file
  in the repo. There are no runtime secrets.
- Libraries are bundled from npm and pinned. No CDNs at runtime.

## Invariants

- The Room Durable Object (`src/worker/room.ts`) is the only authority on game state. Clients
  only render. Game rules live in `src/shared/rules.ts` as pure functions.
- The correct answer never appears in any message before the reveal.
- Phones never see other players' picks or positions during a question.
- Host commands are honored only from sockets that authenticated with the host key. The key
  is stored in the host laptop's localStorage and never appears in a URL or on the page.
- Every incoming message is validated and clamped. Bad input is dropped silently.

## Cost guardrails (Cloudflare free plan)

- Sockets use the WebSocket Hibernation API (`ctx.acceptWebSocket`, socket attachments), so
  an idle room costs nothing. Never plain `accept()` on a socket that stays open.
- Phase timers are Durable Object alarms. `setTimeout` is allowed only for the 100 ms
  position batch.
- Room state is persisted on every change except raw positions, each player's current zone
  included, and loaded in the constructor under `blockConcurrencyWhile`.
- A phone sends at most 4 `move` messages a second while dragging, none while still, and at
  most 40 per question. The final drop and taps are always sent.
- No client heartbeats. If keepalive is ever needed, use protocol pings or
  `setWebSocketAutoResponse`.
- Each socket is capped at 20 messages a second; a room at 40 players.

## Look

- Everything must look like Apple. BRAND.md is the specification. Run the Apple-look
  checklist below before calling any UI work done.
- Literal colors live in `src/client/common/brand.css` only. Stylesheets use the variables;
  canvases read them through `src/client/common/brand.ts`.
- Every glass piece goes through `src/client/ui/glass.tsx`: it keeps a plain frosted fallback
  (Safari and Firefox have no refraction) and turns solid under
  `prefers-reduced-transparency`.
- A class name must not match a Tailwind utility (`ring`, `shadow`, `border`, `outline`,
  `transition`, `filter`, `container`, `hidden`, `fixed`): Tailwind would style it.

### Apple-look checklist

- Type is Inter set like San Francisco: large titles, tight tracking, 17px body.
- Icons are Framework7 filled glyphs, one weight, no other icon set mixed in. A check or a
  cross is always the filled-circle glyph.
- Every color is a token from BRAND.md; no stray hex values.
- Shapes use continuous corners: squircles for platforms and tiles, capsules for pills.
- Only floating controls are glass (with a fallback); content and phone cards are solid.
- Phone backgrounds, the landing page included, are solid black; the projector backdrop is made only from the board's
  own snapshot (Kawarp), never a fixed palette or colors pinned to corners.
- Avatars follow Apple's contact style: matte bubbles, white initials, no gloss or shading,
  no rings. A token with no name shows the person silhouette, never a question mark.
- A symbol is always a Framework7 glyph, never a typed character standing in for one.
- Layouts follow iOS patterns: large title, grouped inset lists, segmented controls.
- Motion eases like iOS springs; nothing cartoonish or bouncy beyond a pop-in.
- Sounds are short and soft, in the spirit of Apple's system sounds, all original.
- Copy is minimal and in Apple's voice: plain, sentence case, no exclamation marks.
- No Apple logo, name, SF Pro, SF Symbols or other Apple asset files anywhere.

## Testing

- `npm test` runs the rules unit tests and pack validation in Node, and the Room integration
  tests inside workerd (`@cloudflare/vitest-plugin`).
- `npm run test:e2e` runs the Playwright flows in Chromium against the dev server, and
  `npm run test:e2e:browsers` runs the 2D game in WebKit and Firefox. Setting `TRIVIA_URL`
  points them at another copy (`vite preview`, or the deployed site). Test pages with
  Playwright's own browsers, never a system browser.
- Every script that opens a browser imports it from `test/e2e/tidy-browser.cjs`, never
  straight from `playwright`: that file closes the run's browser and deletes its temp
  folder however the run ends (a throw, Ctrl+C, a kill). `playwright.config.ts` imports it
  first, which covers the `test:e2e` specs.
- `npm run shots` (with `npm run dev` running) screenshots every screen into `screenshots/`
  for the Apple-look review. `node test/e2e/shots.mjs crowd` adds a 30-player crowd and
  `settings` the accessibility modes; `SHOTS_BROWSER=webkit` shoots the frosted tier.
- `npm run video` (with a build, and `npm run dev` running) remakes the landing page's
  video in `public/video/` from `test/e2e/video.mjs`. Never replace it with a live screen
  recording: the 3D board renders in software in headless Chromium and drops frames.
- A milestone is done only when its tests pass.

## Checkpoints: stop and ask the owner

- Before every push, and before every commit the owner has not already allowed.
- Before `wrangler deploy`. The owner runs `npx wrangler login` on their own account.
- Before a question pack is final: the owner reviews it.
