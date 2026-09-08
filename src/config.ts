/**
 * Every number that decides how the game *feels* lives here.
 *
 * Units are metres and seconds. The yard is deliberately far bigger than a real
 * backyard: the fantasy is the hundred-yard launch ramp, and that only reads if
 * there is room to build one.
 */

export const YARD = {
  /** Half-extent along X (left/right as the camera sees it). */
  halfWidth: 46,
  /** Half-extent along Z (toward/away from the house). */
  halfDepth: 62,
};

export const PHYS = {
  gravity: 21.5,
  /** Below this speed a grounded skater is treated as stopped. */
  restSpeed: 0.05,
  /** Max angle (radians) a surface can have and still be standable. */
  maxStandSlope: 1.15,
};

export const FOOT = {
  accel: 34,
  topSpeed: 5.4,
  /** Ground drag when there is no input. */
  brake: 20,
  /** How fast the character rotates to face the input direction (rad/s). */
  turnRate: 12,
  jumpSpeed: 6.2,
  /** Steering authority while airborne, as a fraction of ground accel. */
  airControl: 0.32,
  eyeHeight: 1.62,
};

export const BOARD = {
  /** Acceleration from pushing (holding the stick forward). */
  pushAccel: 14,
  topSpeed: 21,
  /** Rolling resistance: low, so momentum carries across the yard. */
  roll: 0.55,
  /** Braking when the stick is pulled back. */
  brake: 13,
  /** Turn rate at low speed (rad/s); tightens as you slow, widens as you fly. */
  turnRateLow: 3.0,
  turnRateHigh: 1.25,
  /** Speed at which turning has fully widened out. */
  turnFalloffSpeed: 15,
  /** Ollie pops along the surface normal, so ramps launch you off their face. */
  ollieSpeed: 7.4,
  /** Extra straight-up component on an ollie, independent of the surface. */
  ollieUpBias: 1.6,
  airControl: 0.18,
  /** Speed lost on a rough landing (per radian of mismatch with the surface). */
  landingBite: 1.9,
  deckHeight: 0.09,
};

export const BALL = {
  radius: 0.121,
  restitution: 0.74,
  /** Restitution against the rim: dead enough that lucky rolls happen. */
  rimRestitution: 0.48,
  backboardRestitution: 0.58,
  /** Air drag coefficient (v * v * k). Basketballs are draggy for their mass. */
  drag: 0.0115,
  /** Magnus-ish lift from backspin. Keeps long shots feeling floaty and pretty. */
  spinLift: 0.55,
  groundFriction: 3.2,
  /** Speed below which a rolling ball is considered dead. */
  sleepSpeed: 0.35,
  /** How long the ball stays live before it resets to your hands. */
  maxFlightTime: 14,
};

export const THROW = {
  /**
   * Fixed release: the ball always leaves at the same angle relative to where
   * you are looking. The player's only lever is *when* they tap, which is the
   * whole design. Do not make this adaptive.
   */
  speed: 13.4,
  /** Launch angle above the horizon, radians (~47°). */
  angle: 0.82,
  /** How much of the skater's own velocity the ball inherits. */
  carry: 0.86,
  /** Vertical velocity inherited is damped less — falling adds to the arc. */
  carryVertical: 0.62,
  /** Backspin imparted, used for the lift term. */
  spin: 1.0,
  /** Seconds before you get another ball after a shot dies. */
  resetDelay: 0.85,
  /** Where the ball sits relative to the skater while carried. */
  holdForward: 0.34,
  holdHeight: 1.34,
};

export const HOOP = {
  /** Regulation: 10 feet. The one measurement that should not be cozy. */
  rimHeight: 3.048,
  rimRadius: 0.2286,
  rimTube: 0.019,
  /** Where the hoop stands. Near the patio, facing out into the yard. */
  x: 0,
  z: -34,
  backboardWidth: 1.05,
  backboardHeight: 0.72,
  /** Distance from rim centre back to the backboard face. */
  backboardOffset: 0.34,
};

export const CAM = {
  /**
   * Fixed isometric-ish angle. The camera never rotates around the player --
   * it only tracks and dollies. Keeping the angle constant is what makes the
   * throw learnable, because "up and to the left" always means the same thing.
   */
  offset: { x: 12.5, y: 10.5, z: 17.5 },
  /** Follow smoothing, higher is snappier. */
  lag: 3.4,
  /** Extra dolly-out per m/s of speed. */
  speedZoom: 0.24,
  maxSpeedZoom: 6.5,
  /** How far ahead of the skater the camera looks. */
  lookAhead: 0.42,
  fov: 52,
  /**
   * Pull the framing this far from the skater toward the hoop. A trick-shot
   * game where you cannot see the target is just a skating game, and on a
   * portrait phone the hoop falls out of frame almost immediately without it.
   */
  hoopBias: 0.28,
  /** Distance from the hoop past which the bias stops growing. */
  hoopBiasRange: 42,
  /**
   * Extra dolly-out per metre of distance to the hoop, and its ceiling. Kept
   * small on purpose: framing the hoop from across the yard turns the skater
   * into a speck, and an off-screen marker does that job far better.
   */
  hoopZoom: 0.014,
  maxHoopZoom: 0.55,
};

export const TIME = {
  /** Time scale while the ball is descending near the rim. The cozy payoff. */
  clutchScale: 0.42,
  /** Horizontal distance from the rim at which clutch time starts. */
  clutchRadius: 3.1,
  /** How fast the time scale eases in and out. */
  clutchEase: 6,
};

/**
 * Shot assist.
 *
 * Without this, the makeable window off a big ramp is under one percent of the
 * shot distance, which reads as random rather than hard -- you never learn
 * anything from a miss because every miss looks the same. This applies a small
 * inward nudge to a ball that is already descending near the rim: enough to
 * turn a genuinely close shot into a rattle or a drop, nowhere near enough to
 * rescue a bad one. Raising `pull` much past 6 starts to feel like the ball is
 * being steered, which kills the whole point of a made shot.
 */
export const ASSIST = {
  /**
   * Hard cap on corrective acceleration, m/s^2, against 21.5 of gravity. The
   * correction needed grows as 1/t^2, so this cap is what quietly refuses to
   * rescue a shot that is both badly off and nearly there.
   */
  maxAccel: 4.5,
  /** Predicted miss distance beyond which nothing is corrected at all. */
  window: 0.78,
  /** Only kicks in once the ball is within this long of reaching rim height. */
  lead: 2.4,
};

export const METERS_TO_FEET = 3.28084;
