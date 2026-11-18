# Trivia brand

Trivia looks like an Apple product in dark mode: system colors, frosted glass, continuous
corners, a typeface close to San Francisco. The look is Apple style. The assets are not
Apple's: no Apple logo or name, no SF Pro, no SF Symbols.

Two rules for all writing: no em dashes, and every text and background pair keeps a contrast
of at least 4.5:1.

## Tokens

Literal colors live in `src/client/common/brand.css` and nowhere else. Apple publishes no
fixed values and says they shift between OS releases, so these long-standing iOS dark-mode
values are Trivia's own from now on. Do not re-measure them from a newer iOS.

| Token | Apple name | Hex | Use |
|---|---|---|---|
| `bg` | systemBackground | #000000 | page background, phone screens |
| `surface` | secondarySystemBackground | #1C1C1E | grouped cells on phones |
| `surface2` | tertiarySystemBackground | #2C2C2E | raised surfaces |
| `line` | systemGray4 | #3A3A3C | the dock the tokens wait on |
| `text` | label | #FFFFFF | text |
| `muted` | secondaryLabel, flattened on black | #98989F | secondary text |
| `live` | systemMint | #63E6E2 | the timer, the right-answer ring, Join |
| `stakes` | systemPink | #FF375F | lives hearts |
| `right` | systemGreen | #30D158 | Safe |
| `wrong` | systemRed | #FF453A | Lost a life |
| `ink` | | #000000 | text on any colored fill |

Platforms and answer zones, in bracket order:

| Bracket | Apple name | Hex |
|---|---|---|
| `( )` | systemBlue | #0A84FF |
| `[ ]` | systemPurple | #BF5AF2 |
| `{ }` | systemOrange | #FF9F0A |
| `< >` | systemGreen | #30D158 |

These four are the 1977 rainbow logo's stripes minus the red and yellow that Google's set
also uses, so the board reads as Apple and not as Google. Never draw the six stripes as a
motif.

Player colors are the eight Mac accent colors, in System Settings order: Blue #1D97FF, Purple
#CC76CF, Pink #FF72C2, Red #FF453A, Orange #FF932C, Yellow #FFDC18, Green #72CA57, Graphite
#989898. All take a white initial, as Contacts draws a monogram.

Contrast: black text on every platform is 5.7:1 or better (blue is the lowest). Muted text
is 7.4:1 on black and 6.0:1 on a grouped cell.

Green is both a platform and the color of Safe, so right and wrong never rely on color
alone: each comes with a symbol in a filled circle (check or cross) and a word.

## Type

Inter (OFL), self-hosted through `@fontsource-variable/inter` with optical sizing on. It is
the closest free match to San Francisco. Headlines are weight 700 to 800 with tight tracking
(about -0.025em). Body is 17px. Numbers that change use tabular figures.

Inside the game the name is the word "Trivia" in Inter 700, with no icon.

## Icons

Framework7 Icons 5.0.5 (MIT), filled variants, as SVGs from the package. One set, one
weight. The host dock uses `play_fill`, `forward_end_fill`, `pause_fill`, `heart_fill`,
`house_fill`, `speaker_2_fill` or `speaker_slash_fill`, and
`arrow_up_left_arrow_down_right`. Lives are `heart_fill`. Results are
`checkmark_circle_fill` and `xmark_circle_fill`: the mark knocked out of a filled circle,
the way the system draws them. A bare check or cross is not used. The landing page's join
button is `arrow_right_circle_fill`, drawn the same way.

The app icon appears only as the favicon. It is the board from above: a dark home-screen
squircle (`surface`) holding the four platforms as squircles in their colors. It is flat:
solid fills only, with no glow, no rim light, no sheen and no gradient.

## Glass

Glass is only for controls and chrome that float over content: the projector's progress
pill, question card, lobby panel, corner pills, winner card and host dock. Phone cards,
platforms and answer zones are solid.

The recipe: a translucent dark fill, `backdrop-filter: blur(18px) saturate(170%)`, a
hairline light border and a top inner highlight. Three tiers, chosen in
`src/client/ui/glass.tsx`:

- Chromium refracts the backdrop through an SVG displacement filter. Pills and buttons are
  liquid glass with squircle corners; panels are a glass card, a frosted pane with a
  refractive rim.
- Safari (so every iPhone) and Firefox get the plain frosted recipe above.
- Under `prefers-reduced-transparency` glass turns solid.

At most four glass panels show over the board at once: the progress pill, the question or
winner card, the host dock and one corner pill. The room code pill steps aside at the reveal
to make room for "5 left". Never a glowing ring around the screen edge: that is Siri's own
signal.

## Shapes

Platforms are true superellipses: continuous corners, like an app icon, not plain arcs.
Glass panels get the same squircle outline where the browser refracts. Cards and cells are
rounded rectangles. Pills, buttons and tokens are capsules and circles.

Do not use CSS `corner-shape` for this: with it, Chromium hung while capturing the 2D
screen at the reveal.

## Backgrounds

Phones are solid black, like Settings, Contacts and Game Center in dark mode. Content sits
in solid grouped cells (#1C1C1E, separator rgba(84, 84, 88, 0.6)).

The projector follows Apple Music's method: the backdrop is made from what is on screen,
never from a fixed palette or colors pinned to corners. A small top-down snapshot of the
board is blurred, slowly warped and crossfaded (Kawarp), on its own canvas behind the board:

- Lobby: the newest player's token face, at most one change every 3 seconds. Black until
  the first player joins.
- Question: the four platforms with their labels, taken once when the question starts.
- Reveal: 0.6 seconds in, the right platform alone, so the whole screen takes the answer's
  color like a song change.

The backdrop is a 256 pixel buffer stretched to a square 1.16 times the stage width, turned
once every 90 seconds, at 50% opacity over black with saturation 1.3. A dark scrim, heavier
at the top and bottom, sits between it and the board; the board itself is never dimmed.
Reduced motion stops the turn and the warp and makes crossfades instant. `prefers-contrast:
more` shows no backdrop. If WebGL fails, the background is solid black.

## Player tokens

A token is round, like a contact's monogram bubble: the player's color, matte, with their
initial in white. No gloss, no highlight and no shading on the bubble, only a faint
top-to-bottom tone. On the projector it carries its hearts above and a name pill across the
foot. No rings on avatars anywhere; where a token sits on a platform or zone of its own
color, a soft shadow under it keeps the two apart. The one ring in the game is the selection ring around the chosen
swatch in the join screen's color picker.

Before a name is typed, the join screen's token shows a white person silhouette in place of
the initial (head and shoulders, the shoulders cropped by the bubble's edge), the way Contacts
draws a contact with no name. Never a question mark or other stand-in character.

Out of lives, a token fades to about 30% opacity in its own color. Never gray: graphite is
a player color.

## Platforms

Each platform is a squircle (a superellipse with exponent 5), the continuous-corner shape of
an app icon, in one solid color with black text. In 3D it is extruded as one matte piece
with a soft rounded edge: roughness about 0.58, no clearcoat, no self-glow, soft studio
light. No darker base and no lighter inset tile.

Each platform carries its bracket as a mark: big, in the middle, and quiet enough to sit
under the tokens. The bracket only says which platform is which, so it is never written
next to an answer. The answer is its own text, on the back half; tokens stand on the front
half so they never cover it. With no question on screen a platform shows its mark alone.

The 2D screen looks straight down from above, so its platforms are square squircles, like
app icons on a home screen, and a platform that drops falls away from the viewer.

The right answer gets a thin, steady mint ring that hugs the platform with an even gap: the
platform's outline pushed outward along its normals. No pulse and no second halo.

Phone zones mirror the platforms: same color, the same bracket big in the middle, the
answer as its own text, a faint top sheen. Never triangle, diamond, circle and square.

## Lobby

A glass panel on the left: a large QR code, the room code, the address, "6 joined", and
the roster. The host clicks a name once to arm it and again to remove that player. Tokens
pop onto the dock as people join. The dock is a bar with squircle ends: straight long
edges and true corners, never one squircle stretched to fit.

## Host dock

A glass dock along the bottom of both projector pages, like the Dock on a Mac: one round
glass button per action with its key letter under it, and a gentle magnification under the
pointer. The action that matters now is lit (Start in the lobby, Pause while paused, the
lobby button once armed). No tooltips and no bounce.

## Phone controller

Large title, grouped inset cells, a mint capsule for Join. During a question: the question
in a grouped cell with the countdown ring (the number dead center, in the same grid cell as
the ring), four zones, your token and your hearts in the top bar. No line of text under the
zones and no tips in the lobby: where your token sits and the ring say it all. Safe and Lost
a life share one layout, anchored from the top, so nothing moves between them.

## Landing

What `/` shows a visitor with no room code and no game to rejoin. It is a phone page, so it
is solid black, with no backdrop and no cards. A room code in the address, or a saved game,
never sees it.

- It holds the title "Trivia", one line ("Live elimination trivia for in-person events."),
  the video and two actions. Nothing else: no footer and no links out.
- On a laptop everything is centered and shares one screen: title, line, actions, video.
  "Host a game" comes first, as a white capsule.
- On a phone it is laid out like a welcome screen: title, line and video as one centered
  group, the actions at the bottom in reach of a thumb. Joining comes first there, and
  "Host a game" is the quiet gray capsule under it.
- Joining is one capsule: the room code field with a round arrow inside its trailing end,
  the way a sign-in field or a message field holds its button. The arrow is mint once the
  code is complete, and leads to the join form. A word button inside a field is not used.
- The video is one round of a real game: the 3D projector and one player's phone side by
  side, on black, so the two float on the page with no card round them. It plays muted and
  loops; its last frames fade into its first. Under reduced motion it rests on its first
  frame with a glass play button over it, the page's only glass.
- The video is remade with `npm run video`, never screen recorded: a recorded game is
  replayed one frame at a time, so it cannot stutter.

## Words

As few as possible, in a plain voice, sentence case, no exclamation marks. Projector: the
title, "4 of 15", the question, the room code, "6 joined", "5 left". Phone: the title, the
room code, field labels and one-word results. If a symbol or a layout already says it, drop
the words.

## Motion

Motion eases like iOS springs. Nothing bounces beyond a pop-in.

- Hop: a token moves between spots on a short spring.
- Drop: at the reveal, wrong platforms fall away under gravity.
- Fall: the tokens on them fall and spin.
- Respawn: a fallen token pops back onto the dock with a life gone.
- Confetti: paper in the platform colors, once, for the winner.

Everything respects `prefers-reduced-motion`.

## Sound

Short and soft, in the spirit of system sounds, and all original: synthesized in the
browser from sine and triangle tones and filtered noise, with no audio files. A two-note
blip for a join, three rising notes when a question starts, a tick for each of the last five
seconds (the last one higher), a low rumble when platforms drop, a rising arpeggio for the
winner. The lobby has slow open chords; questions have a quiet pulse that keeps time
without pulling focus. Only the projector makes sound. Phones never do.
