# Design notes

Working document. Records what we decided, why, and what is still open.

## The pitch

You are a kid in a big backyard with an old pole-mounted hoop, a skateboard,
and an unreasonable amount of plywood. You build ramps, you skate off them, and
you throw a basketball at the hoop mid-air. Almost everything misses. When one
drops, it should feel like a small event.

## Pillars

1. **Cozy, not competitive.** Golden hour, mown lawn, a net that swishes. No
   timers, no fail states, no punishment for missing. Missing is the normal
   outcome and should never feel like a rebuke.
2. **The setup is the puzzle; the release is the skill.** Where you put the
   ramp, how fast you hit it, and when you let go. That is the whole loop.
3. **Low percentage, high payoff.** A make should be rare enough to be worth
   telling someone about, and legible enough that you understand why it went in.

## Decisions made

| Question | Decision | Why |
| --- | --- | --- |
| Camera | Fixed 3D angle, on rails behind the skater | Depth and physicality without asking a phone player to manage a camera. The fixed angle also means "push up" always maps to the same world direction, which is what makes the throw learnable. |
| Movement | Free-roam on foot, mount/dismount the board at will | Your call. You can walk up and lay one in, or commit to the board for the ridiculous ones. |
| Board handling | Carried under the arm when not riding | Considered leaving it where you dismount, but that strands you across the yard from your board. Carrying is forgiving and always available. |
| Release | Single timing tap, fixed speed and angle | Your call, and it is the right one — it keeps the skill in the timing rather than in a joystick, and it makes the ramp placement matter. |
| Stack | Three.js + TypeScript, wrapped for mobile later | Ships as a real app via Capacitor, and it is the only option where the feel can be iterated on directly. |

## Things I decided on my own, flag any you disagree with

- **Shot assist exists, and it is predictive.** Without it, the makeable window
  off a big ramp is under 1% of the shot distance — misses become
  indistinguishable from each other and you never learn anything. The assist
  projects where the ball will cross rim height and, if it is nearly in, applies
  a capped corrective nudge. A 0.4 m miss still misses. Tunable in `ASSIST`;
  set `maxAccel` to 0 to feel the raw version.
- **Clutch slow-motion.** Time eases to 42% when a descending ball is near the
  rim. Costs nothing, buys a longer look at the only moment that matters.
- **An off-screen hoop marker** instead of a camera wide enough to always frame
  the hoop. Framing both a 1.7 m character and a hoop 30 m away makes the
  character a speck; an edge arrow with a distance readout does the job better.
- **The yard is much bigger than a real backyard** (92 × 124 m). The fantasy is
  the hundred-yard ramp, and that only reads if there is room to build one.
- **Shots get named** — "FROM DOWNTOWN", "SWISH", "ARE YOU KIDDING" — with the
  distance and how you were moving. The reward needs to be specific about what
  you just did, or it stops landing after the fifth time.

## Open questions

**1. Is there progression, or is it purely a sandbox?**
Right now it is a pure sandbox with a running makes/attempts count and a best
distance. Options: leave it (most cozy), add gentle unlockable pieces, or add
optional "shot challenges" you can pick up and ignore. My instinct is a
sandbox plus a personal record book — no unlocks, no gating.

**2. How much should a made shot be shareable?**
The trail and the replay-worthy camera are already there. A "save the last
make as a clip" button is a natural fit for a game whose whole genre is trick
shot videos, and it is probably the single biggest growth lever. Worth building?

**3. Tricks — in or out?**
You did not ask for a trick system, and I have not built one. Kickflips etc.
would deepen the skating but risk swamping the shooting. A middle option: air
rotation only, where spinning changes which way you are facing and therefore
where the ball goes. That stays in service of the shot rather than competing
with it.

**4. Is one hoop enough?**
Currently one, in a fixed spot. Movable hoops, or a second one, would multiply
the sandbox — but "the hoop is where the hoop is" is also part of the charm.

**5. How hard is too hard?**
The current numbers: a flat-footed shot drops from about 5.5 m. Off a big ramp
at 36 m the makeable window is roughly 1.2 m of distance, which at speed is
about a 45 ms release window. That is tight. It wants real hands-on play to
judge — it is one number in `ASSIST` if it is wrong.

## Known rough edges

- No aim aid at all before release. The arc trail teaches you after the fact,
  which may or may not be enough for a new player.
- Pieces can overlap and intersect freely. Deliberate for now — precarious
  nonsense is fun — but it does allow visually broken builds.
- The character rig is placeholder-blocky. Charming at this scale, but it is
  not a considered art direction yet.
- No sound mix, no music. The SFX are synthesised and unmastered.
- Frame delta is clamped at 50 ms, so a device rendering below ~20 fps runs in
  slow motion rather than tunnelling the ball through the rim. Correct
  trade-off, but worth knowing.
