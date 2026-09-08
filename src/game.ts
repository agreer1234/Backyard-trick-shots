import * as THREE from 'three';
import { CAM, HOOP, METERS_TO_FEET, THROW, TIME, YARD } from './config';
import { sfx } from './audio';
import { Ball, type ShotResult } from './ball';
import { BuildMode } from './build';
import { Hoop } from './hoop';
import { describeShot, Hud } from './hud';
import { Input } from './input';
import { PIECE_BY_ID } from './pieces';
import { buildScenery } from './scenery';
import { Skater } from './skater';
import { World } from './surface';

/**
 * Wiring, camera and the shot lifecycle.
 *
 * Physics runs on a fixed 120 Hz step with an accumulator. That matters more
 * than usual here: the ball can be doing 25 m/s through a 46 cm hoop, and a
 * variable step would let it teleport past the rim on a slow frame, turning a
 * make into a miss for reasons the player cannot see.
 */

const PHYS_STEP = 1 / 120;
/**
 * Frame delta is clamped to 50 ms below, so 6 steps is exactly enough to drain
 * the accumulator on the worst allowed frame. Anything less and a slow device
 * silently runs the whole game in slow motion, because the leftover time gets
 * thrown away every frame rather than caught up.
 */
const MAX_STEPS = 8;

const _v = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _desired = new THREE.Vector3();

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private world = new World(YARD);
  private hoop = new Hoop();
  private skater = new Skater();
  private ball: Ball;
  private hud = new Hud();
  private input: Input;
  private build: BuildMode;
  private sun: THREE.DirectionalLight;

  private clock = new THREE.Clock();
  private accumulator = 0;
  private timeScale = 1;
  private building = false;

  private makes = 0;
  private attempts = 0;
  private bestDistance = 0;
  private streak = 0;
  private resetTimer = 0;
  private awaitingReset = false;

  private confetti!: THREE.Points;
  private confettiVel: Float32Array;
  private confettiLife: Float32Array;
  private camShake = 0;
  private camDistScale = 1;
  private ballFocus = 0;
  private aspectBoost = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.5, 700);
    this.scene.fog = new THREE.Fog(0xcfe0ea, 150, 420);

    const scenery = buildScenery();
    this.sun = scenery.sun;
    this.scene.add(scenery.group);
    this.scene.add(this.world.group);
    this.scene.add(this.hoop.group);
    this.scene.add(this.skater.root);

    this.ball = new Ball({
      onSurface: (i) => sfx.bounce(i),
      onRim: (i) => sfx.rim(i),
      onBackboard: (i) => sfx.backboard(i),
      onScore: (s) => this.onScore(s),
      onDead: () => this.onBallDead(),
    });
    this.scene.add(this.ball.mesh);
    this.scene.add(this.ball.trail);

    const { points, vel, life } = makeConfetti();
    this.confetti = points;
    this.confettiVel = vel;
    this.confettiLife = life;
    this.scene.add(this.confetti);

    this.input = new Input(canvas, () => sfx.unlock());
    this.build = new BuildMode(canvas, this.camera, this.world, this.scene);

    if (!this.build.load()) this.starterYard();

    // Spawn with a run-up behind the starter launch ramp, facing the hoop.
    this.skater.pos.set(6, 0, -4);
    this.skater.yaw = Math.atan2(HOOP.x - 6, HOOP.z + 4);
    this.skater.handPoint(_hand);
    this.ball.hold(_hand);

    this.hud.setStats(0, 0, 0);
    this.hud.setMode(false);
    this.hud.setRiding(false);
    this.hud.onModeClick(() => this.toggleMode());

    // Handle for automated playtests and for poking at tuning from the console.
    (window as unknown as { bts: unknown }).bts = {
      skater: this.skater,
      ball: this.ball,
      world: this.world,
      hoop: this.hoop,
      camera: this.camera,
      pieceDefs: PIECE_BY_ID,
      stats: () => ({ makes: this.makes, attempts: this.attempts, streak: this.streak }),
    };

    this.bindIntro();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // iOS fires resize late on rotate; a second pass settles the layout.
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
  }

  // ------------------------------------------------------------- setup ---

  /** A small starter park, so the very first tap can already make something. */
  private starterYard() {
    const aim = (x: number, z: number) => Math.atan2(HOOP.x - x, HOOP.z - z);
    const put = (id: string, x: number, z: number, yaw?: number, baseY = 0) => {
      const def = PIECE_BY_ID.get(id);
      if (def) this.world.place(def, x, z, yaw ?? aim(x, z), baseY);
    };
    put('launch', 2, -18);
    put('kicker', -7, -24);
    put('quarter', 11, -26, aim(11, -26) + 0.35);
    put('rail', -4, -12, Math.PI / 2);
    put('funbox', 9, -6);
    put('mega', -3, 22);
    this.build.save();
  }

  private bindIntro() {
    const intro = document.getElementById('intro');
    const go = document.getElementById('intro-go');
    const dismiss = () => {
      sfx.unlock();
      intro?.classList.add('gone');
      this.input.clearEdges();
    };
    go?.addEventListener('click', dismiss);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Three's FOV is vertical, so a tall phone shows far less of the yard
    // side to side than a laptop does. Dolly back to compensate, otherwise
    // portrait players lose the hoop off the edge of the screen.
    this.aspectBoost = Math.max(1, Math.min(1.28, 0.9 / this.camera.aspect));
  }

  private toggleMode() {
    this.building = !this.building;
    this.input.enabled = !this.building;
    this.input.clearEdges();
    this.hud.setMode(this.building);
    this.build.setActive(this.building, this.skater.pos);

    // Either direction, put the ball back in the skater's hands. Leaving a
    // shot frozen mid-air with its trail hanging over the yard looks broken,
    // and coming back from building with a dead ball leaves you unable to shoot.
    this.skater.handPoint(_hand);
    this.ball.hold(_hand);
    this.awaitingReset = false;
    this.hud.setTracker(null);
    this.hud.hideHoopMarker();
    sfx.unlock();
  }

  // -------------------------------------------------------------- loop ---

  start() {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    const raw = Math.min(0.05, this.clock.getDelta());

    if (this.building) {
      this.stepBuild(raw);
    } else {
      this.stepPlay(raw);
    }

    this.renderer.render(this.scene, this.camera);
  }

  private stepBuild(dt: number) {
    this.hoop.update(dt);
    this.updateConfetti(dt);
    // Overhead-ish framing centred on wherever the player has panned to.
    _camTarget.copy(this.build.panTarget).setY(1.5);
    const z = this.build.zoom * this.aspectBoost;
    _desired.set(
      _camTarget.x + CAM.offset.x * z,
      _camTarget.y + CAM.offset.y * z,
      _camTarget.z + CAM.offset.z * z,
    );
    this.camera.position.lerp(_desired, Math.min(1, dt * 8));
    this.camera.lookAt(_camTarget);
    this.followSun(_camTarget);
  }

  private stepPlay(dt: number) {
    this.input.sample();

    // Clutch time: ease into slow motion when a live ball is dropping in on
    // the rim. Input is unaffected -- the shot is already gone -- so this only
    // ever buys the player a longer look at the moment that matters.
    this.updateTimeScale(dt);

    const scaled = dt * this.timeScale;
    this.accumulator += scaled;
    let steps = 0;
    // Edge-triggered actions must fire on exactly one physics step.
    let jump = this.input.takeJump();
    let board = this.input.takeBoard();
    const shoot = this.input.takeShoot();

    while (this.accumulator >= PHYS_STEP && steps < MAX_STEPS) {
      this.skater.update(PHYS_STEP, {
        x: this.input.x,
        z: this.input.z,
        jump,
        toggleBoard: board,
      }, this.world);
      jump = false;
      board = false;
      this.ball.update(PHYS_STEP, this.world, this.hoop);
      this.accumulator -= PHYS_STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;

    this.hud.setRiding(this.skater.riding);

    if (shoot) this.tryShoot();

    if (this.ball.state === 'held') {
      this.skater.handPoint(_hand);
      this.ball.carry(_hand, dt);
    }

    if (this.awaitingReset) {
      this.resetTimer -= dt;
      if (this.resetTimer <= 0) {
        this.awaitingReset = false;
        this.skater.handPoint(_hand);
        this.ball.hold(_hand);
        this.hud.setTracker(null);
      }
    }

    this.hoop.update(scaled);
    this.updateConfetti(dt);
    this.updateCamera(dt);
  }

  private updateTimeScale(dt: number) {
    let target = 1;
    if (this.ball.state === 'live' && this.ball.vel.y < 0) {
      const d = this.ball.distanceToRim();
      const dy = this.ball.pos.y - HOOP.rimHeight;
      if (d < TIME.clutchRadius && dy > -1.2 && dy < 7) target = TIME.clutchScale;
    }
    this.timeScale += (target - this.timeScale) * Math.min(1, dt * TIME.clutchEase);
  }

  private tryShoot() {
    if (this.ball.state !== 'held') return;

    this.skater.handPoint(_hand);
    this.skater.throwDirection(_dir);

    // Fixed release: constant speed and angle relative to facing, plus whatever
    // momentum the skater brought. Timing is the only variable, by design.
    _v.copy(_dir).multiplyScalar(THROW.speed);
    _v.x += this.skater.vel.x * THROW.carry;
    _v.z += this.skater.vel.z * THROW.carry;
    _v.y += this.skater.vel.y * THROW.carryVertical;

    this.ball.launch(_hand, _v, {
      airborne: !this.skater.grounded,
      riding: this.skater.riding,
    });

    this.attempts++;
    this.hud.setStats(this.makes, this.attempts, this.bestDistance);
    const ft = Math.round(this.ball.currentShot.distance * METERS_TO_FEET);
    this.hud.setTracker(`${ft} ft out`);
    this.ballFocus = 0;
    sfx.pop();
  }

  private onScore(shot: ShotResult) {
    this.makes++;
    this.streak++;
    this.bestDistance = Math.max(this.bestDistance, shot.distance);
    this.hud.setStats(this.makes, this.attempts, this.bestDistance);
    const { title, sub } = describeShot(shot, this.streak);
    this.hud.showToast(title, sub, true, 2800);
    this.burstConfetti();
    this.camShake = Math.min(0.55, 0.22 + shot.distance * 0.004);
    if (shot.swish) sfx.swish();
    sfx.make(this.streak);
  }

  private onBallDead() {
    const shot = this.ball.currentShot;
    if (!shot.made) {
      this.streak = 0;
      // Only comment on the genuinely close ones; silence is kinder otherwise.
      if (!shot.swish) {
        this.hud.showToast('SO CLOSE', 'off the iron', false, 1500);
      }
    }
    this.awaitingReset = true;
    this.resetTimer = THROW.resetDelay;
  }

  // ------------------------------------------------------------ camera ---

  private updateCamera(dt: number) {
    // Base target: the skater, nudged along their velocity so you can see
    // where you are going rather than where you have been.
    _camTarget.set(
      this.skater.pos.x + this.skater.vel.x * CAM.lookAhead,
      // Aimed above the skater's head, which tips the camera up and buys back
      // the band of empty lawn that otherwise fills the bottom of the frame.
      this.skater.pos.y + 2.6,
      this.skater.pos.z + this.skater.vel.z * CAM.lookAhead,
    );

    let distScale = 1 + Math.min(CAM.maxSpeedZoom, this.skater.speed * CAM.speedZoom) * 0.06;

    // Lean the framing toward the hoop, more so the further away you are, so
    // the target stays on screen while you are lining a shot up.
    const toHoop = Math.hypot(_camTarget.x - HOOP.x, _camTarget.z - HOOP.z);
    const bias = CAM.hoopBias * Math.min(1, toHoop / CAM.hoopBiasRange);
    _camTarget.x += (HOOP.x - _camTarget.x) * bias;
    _camTarget.z += (HOOP.z - _camTarget.z) * bias;
    _camTarget.y += (HOOP.rimHeight - _camTarget.y) * bias * 0.5;
    distScale += Math.min(CAM.maxHoopZoom, toHoop * CAM.hoopZoom);

    if (this.ball.state === 'live') {
      // Once the shot is away, the ball is the story. Slide focus onto the
      // midpoint of ball and rim and pull back far enough to hold both.
      this.ballFocus = Math.min(1, this.ballFocus + dt * 2.6);
      _v.set(
        (this.ball.pos.x + HOOP.x) / 2,
        (this.ball.pos.y + HOOP.rimHeight) / 2 + 0.8,
        (this.ball.pos.z + HOOP.z) / 2,
      );
      _camTarget.lerp(_v, this.ballFocus * 0.85);
      const spread = this.ball.pos.distanceTo(this.hoop.rimCentre);
      distScale += Math.min(2.1, spread * 0.035) * this.ballFocus;
    } else {
      this.ballFocus = Math.max(0, this.ballFocus - dt * 1.6);
    }

    this.camDistScale += (distScale - this.camDistScale) * Math.min(1, dt * 2.2);
    const d = this.camDistScale * this.aspectBoost;

    _desired.set(
      _camTarget.x + CAM.offset.x * d,
      _camTarget.y + CAM.offset.y * d,
      _camTarget.z + CAM.offset.z * d,
    );

    const lag = Math.min(1, dt * CAM.lag);
    this.camera.position.lerp(_desired, lag);

    if (this.camShake > 0) {
      this.camShake = Math.max(0, this.camShake - dt * 1.6);
      const a = this.camShake * this.camShake;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }

    this.camera.lookAt(_camTarget);
    this.followSun(_camTarget);
    this.updateHoopMarker();
  }

  /**
   * Project the rim to screen space. If it lands outside a comfortable margin
   * (or behind the camera), pin an arrow to the edge pointing at it. This is
   * what lets the camera stay tight on the skater without the player losing
   * track of what they are aiming at.
   */
  private updateHoopMarker() {
    if (this.ball.state === 'live') {
      this.hud.hideHoopMarker();
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;

    _v.copy(this.hoop.rimCentre).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = _v.z > 0;
    _v.copy(this.hoop.rimCentre).project(this.camera);
    // A point behind the camera projects mirrored; flip it back so the arrow
    // points the way you actually need to turn.
    if (behind) {
      _v.x = -_v.x;
      _v.y = -_v.y;
    }

    const margin = 0.82;
    const onScreen = !behind && Math.abs(_v.x) < margin && Math.abs(_v.y) < margin;
    if (onScreen) {
      this.hud.hideHoopMarker();
      return;
    }

    // Clamp to the edge along the direction of the hoop.
    let nx = _v.x;
    let ny = _v.y;
    const m = Math.max(Math.abs(nx), Math.abs(ny)) || 1;
    nx = (nx / m) * margin;
    ny = (ny / m) * margin;

    const px = (nx * 0.5 + 0.5) * w;
    const py = (-ny * 0.5 + 0.5) * h;
    // The glyph points right at 0 rad; screen y is inverted relative to NDC.
    const angle = Math.atan2(-ny, nx);
    const dist = Math.hypot(
      this.skater.pos.x - HOOP.x,
      this.skater.pos.z - HOOP.z,
    );
    this.hud.setHoopMarker(px, py, angle, dist);
  }

  /** Keep the shadow frustum around the action instead of the whole yard. */
  private followSun(focus: THREE.Vector3) {
    this.sun.position.set(focus.x + 28, 34, focus.z + 26);
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.sun.target.updateMatrixWorld();
  }

  // ---------------------------------------------------------- confetti ---

  private burstConfetti() {
    const attr = this.confetti.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const n = this.confettiLife.length;
    for (let i = 0; i < n; i++) {
      arr[i * 3] = HOOP.x + (Math.random() - 0.5) * 0.4;
      arr[i * 3 + 1] = HOOP.rimHeight - 0.35;
      arr[i * 3 + 2] = HOOP.z + (Math.random() - 0.5) * 0.4;
      const a = Math.random() * Math.PI * 2;
      const s = 1.4 + Math.random() * 3.4;
      this.confettiVel[i * 3] = Math.cos(a) * s;
      this.confettiVel[i * 3 + 1] = 1.2 + Math.random() * 4.2;
      this.confettiVel[i * 3 + 2] = Math.sin(a) * s;
      this.confettiLife[i] = 1.1 + Math.random() * 1.1;
    }
    attr.needsUpdate = true;
    this.confetti.visible = true;
  }

  private updateConfetti(dt: number) {
    if (!this.confetti.visible) return;
    const attr = this.confetti.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    let alive = 0;
    for (let i = 0; i < this.confettiLife.length; i++) {
      if (this.confettiLife[i]! <= 0) continue;
      alive++;
      this.confettiLife[i]! -= dt;
      this.confettiVel[i * 3 + 1]! -= 7.5 * dt;
      arr[i * 3]! += this.confettiVel[i * 3]! * dt;
      arr[i * 3 + 1]! += this.confettiVel[i * 3 + 1]! * dt;
      arr[i * 3 + 2]! += this.confettiVel[i * 3 + 2]! * dt;
      if (arr[i * 3 + 1]! < 0.02) {
        arr[i * 3 + 1] = 0.02;
        this.confettiVel[i * 3 + 1] = 0;
        this.confettiVel[i * 3] = 0;
        this.confettiVel[i * 3 + 2] = 0;
      }
    }
    attr.needsUpdate = true;
    const mat = this.confetti.material as THREE.PointsMaterial;
    mat.opacity = Math.min(1, alive / 8);
    if (alive === 0) this.confetti.visible = false;
  }
}

function makeConfetti(): { points: THREE.Points; vel: Float32Array; life: Float32Array } {
  const COUNT = 90;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const palette = [0xffd98a, 0xf2a03c, 0xe2673b, 0xfdf6e8, 0x8fbf74];
  const c = new THREE.Color();
  for (let i = 0; i < COUNT; i++) {
    c.setHex(palette[i % palette.length]!);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.11,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    }),
  );
  points.frustumCulled = false;
  points.visible = false;
  return { points, vel: new Float32Array(COUNT * 3), life: new Float32Array(COUNT) };
}
