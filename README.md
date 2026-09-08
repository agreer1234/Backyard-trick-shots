# Backyard Trick Shots

A cozy mobile game about building something ridiculous in your backyard,
skating off it, and letting a basketball go at exactly the right moment.

Most shots miss. That is the point. The ones that drop are supposed to feel
like you earned them.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build and a local preview of it:

```bash
npm run build
npm run preview
```

It is a plain web app, so it runs in a phone browser today. Wrapping it as a
real installable app is a Capacitor shell around `dist/` when we want one — no
rewrite required.

### Controls

|              | Touch                       | Keyboard          |
| ------------ | --------------------------- | ----------------- |
| Move         | Left half of the screen     | `WASD` / arrows   |
| Ride/hop off | 🛹 button                   | `E`               |
| Ollie        | ⤴ button                    | `Space`           |
| Shoot        | 🏀 button, or tap the world | `J` / `Enter`     |
| Build        | 🔨 top right                | —                 |

You can shoot on foot or on the board. Walk up and lay one in, or drop off the
Mega Ramp from across the yard — the ball leaves your hands the instant you
tap, so *when* you tap is the entire skill.

### Build mode

Pick a piece from the tray, tap the ground to drop it. Tap a placed piece to
select it, then Rotate / Raise / Lower / Remove. Drag a selected piece to move
it. Drag empty space to pan the yard, pinch or scroll to zoom. Dropping a piece
onto another one stacks it at that height, which is how you get a roll-in
feeding a deck feeding a launch ramp.

Your yard saves to `localStorage` automatically.

---

## How it is put together

```
src/
  config.ts     Every number that decides how the game feels. Start here.
  pieces.ts     The buildable catalogue + mesh generation
  surface.ts    Placed pieces, surface sampling, wall resolution
  skater.ts     The character: on foot, on the board, and the ramp physics
  ball.ts       Flight, bounces, rim/backboard contact, scoring
  hoop.ts       Pole, backboard, rim, and the net simulation
  scenery.ts    The yard: lawn, fence, house, trees, light
  textures.ts   Every texture, drawn procedurally at boot
  build.ts      Build mode: placing, stacking, panning, persistence
  input.ts      Touch stick + keyboard, unified
  hud.ts        All DOM chrome
  game.ts       Wiring, camera, shot lifecycle
```

Three ideas do most of the work:

**One profile function per piece.** A buildable piece is defined by a curve
`profile(t)` giving normalised height along its length. That single function
generates the mesh *and* answers the physics query, so the ramp you see and the
ramp you ride can never drift apart. Adding a new piece is a few lines in
`PIECES`.

**Velocity is 3D and gets projected onto the surface.** Nothing in the code
"launches" you off a ramp. While grounded, velocity is projected onto the
tangent plane of whatever is underfoot, so riding up a face naturally trades
forward speed for upward speed; at the lip the surface simply stops supporting
you and you keep the velocity you had. Ollies push along the surface normal,
which is why popping off a transition throws you differently than popping off
flat ground.

**Fixed release, variable timing.** The throw is always the same speed and
angle relative to where you are looking, plus whatever momentum you brought.
There is no aiming. This is deliberate — it is what makes the release a timing
problem rather than a joystick problem, and it is why building the right ramp
in the right place is the real puzzle.

No binary assets. Every texture and sound is generated at runtime, so the repo
stays small and the whole look and feel is editable as numbers.

---

## Tuning

Almost everything worth changing lives in `src/config.ts`, commented with what
it does and where the edges are. The ones that change the game most:

- `THROW.speed` / `THROW.angle` — sets the range of a standing shot. Currently
  a flat-footed shot drops from about 5.0–5.5 m (17–18 ft).
- `ASSIST` — how forgiving a near-miss is. Turn it off and the makeable window
  off a big ramp is under 1% of the shot distance, which reads as random rather
  than hard.
- `BOARD` — push, top speed, turn rate, ollie power.
- `TIME.clutchScale` — the slow-motion that kicks in as a descending ball nears
  the rim.

### Playtests

Two scripts drive a real browser and measure the things that are hard to eyeball:

```bash
npm run build && npm run preview   # in one terminal
npm run playtest:range             # sweeps shot distance, reports makes and miss margins
npm run playtest:physics           # checks walls block, ramps launch
```

`playtest:range` is the one to re-run after touching `THROW` or `ASSIST`.

Note: under a software renderer these run at a few frames a second, and the
game deliberately clamps frame delta to 50 ms rather than tunnel through the
rim — so wall-clock waits in the scripts buy much less game time than you would
expect. That is a property of the test environment, not the game.

---

## State of things

Working: build mode with 11 pieces and stacking, on-foot and on-board movement
with mount/dismount, ramp launches, ollies, ball flight with rim/backboard/pole
contact, scoring with swish detection, a net that reacts, clutch slow-motion,
shot naming, streaks, persistence.

Not there yet — see `DESIGN.md` for the open questions.
