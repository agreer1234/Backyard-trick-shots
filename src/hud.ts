import { METERS_TO_FEET } from './config';
import type { ShotResult } from './ball';

/**
 * All DOM chrome lives here so the game loop never touches the document.
 */

const feet = (m: number) => Math.round(m * METERS_TO_FEET);

/** Name the shot. This is the reward, so it should be specific, not generic. */
export function describeShot(s: ShotResult, streak: number): { title: string; sub: string } {
  const d = feet(s.distance);
  const parts: string[] = [];
  if (s.swish) parts.push('nothing but net');
  if (s.riding && s.airborne) parts.push('off the board, mid-air');
  else if (s.airborne) parts.push('in the air');
  else if (s.riding) parts.push('rolling');
  if (s.apex > 6) parts.push(`${feet(s.apex)} ft up`);

  let title: string;
  if (d >= 150) title = 'ARE YOU KIDDING';
  else if (d >= 90) title = 'FROM DOWNTOWN';
  else if (d >= 45) title = 'NO WAY';
  else if (s.swish) title = 'SWISH';
  else title = 'GOT IT';

  if (streak >= 3) title = `${title} · ${streak} IN A ROW`;

  const sub = `${d} ft${parts.length ? ' · ' + parts.join(' · ') : ''}`;
  return { title, sub };
}

export class Hud {
  private toast = document.getElementById('toast') as HTMLElement;
  private tracker = document.getElementById('tracker') as HTMLElement;
  private makesEl = document.getElementById('stat-makes') as HTMLElement;
  private attemptsEl = document.getElementById('stat-attempts') as HTMLElement;
  private bestEl = document.getElementById('stat-best') as HTMLElement;
  private modeBtn = document.getElementById('btn-mode') as HTMLButtonElement;
  private boardBtn = document.getElementById('btn-board') as HTMLButtonElement;
  private buildBar = document.getElementById('build-bar') as HTMLElement;
  private playControls = document.getElementById('play-controls') as HTMLElement;
  private hoopMarker = document.getElementById('hoop-marker') as HTMLElement;
  private hoopArrow = document.getElementById('hoop-arrow') as HTMLElement;
  private hoopDist = document.getElementById('hoop-dist') as HTMLElement;
  private toastTimer = 0;

  makes = 0;
  attempts = 0;
  bestFeet = 0;

  setStats(makes: number, attempts: number, bestMeters: number) {
    this.makes = makes;
    this.attempts = attempts;
    this.makesEl.textContent = String(makes);
    this.attemptsEl.textContent = String(attempts);
    this.bestFeet = bestMeters > 0 ? feet(bestMeters) : 0;
    this.bestEl.textContent = this.bestFeet > 0 ? `${this.bestFeet} ft` : '—';
  }

  showToast(title: string, sub: string, made: boolean, holdMs = 2200) {
    this.toast.innerHTML = `${title}<span class="toast-sub">${sub}</span>`;
    this.toast.classList.toggle('make', made);
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), holdMs);
  }

  /** Live distance readout while the ball is in flight. */
  setTracker(text: string | null) {
    if (text === null) {
      this.tracker.classList.remove('on');
      return;
    }
    this.tracker.textContent = text;
    this.tracker.classList.add('on');
  }

  /**
   * Park an arrow at the screen edge pointing at the hoop, with the distance.
   * Pass null when the hoop is comfortably on screen and needs no marker.
   */
  setHoopMarker(px: number, py: number, angleRad: number, meters: number) {
    this.hoopMarker.classList.add('on');
    this.hoopMarker.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    this.hoopArrow.style.transform = `rotate(${angleRad}rad)`;
    this.hoopDist.textContent = `${feet(meters)} ft`;
  }

  hideHoopMarker() {
    this.hoopMarker.classList.remove('on');
  }

  setMode(building: boolean) {
    this.modeBtn.classList.toggle('active', building);
    const icon = this.modeBtn.querySelector('.mode-icon');
    const text = this.modeBtn.querySelector('.mode-text');
    if (icon) icon.textContent = building ? '🛹' : '🔨';
    if (text) text.textContent = building ? 'Skate' : 'Build';
    this.buildBar.hidden = !building;
    this.playControls.style.display = building ? 'none' : '';
  }

  setRiding(riding: boolean) {
    this.boardBtn.classList.toggle('on', riding);
    const label = this.boardBtn.querySelector('.action-label');
    if (label) label.textContent = riding ? 'Hop off' : 'Ride';
  }

  onModeClick(fn: () => void) {
    this.modeBtn.addEventListener('click', fn);
  }
}
