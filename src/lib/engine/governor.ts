import { create } from 'zustand';

/**
 * Keeps KataGo's sustained load in check on phones and laptops.
 *
 * Heat: every network call reports how long the network took per position. A device that
 * heats up slows down (thermal throttling), so when the recent time per position stays
 * well above what the same device managed while cool, background analysis runs on fewer
 * workers and pauses between positions until the times recover.
 *
 * Battery: where the browser reports it (Chrome and Edge; Safari and Firefox do not),
 * background analysis slows down on battery, stops when the battery is low, and live
 * analysis stops at a visit limit instead of reading forever.
 *
 * The board you are looking at is never paused, only background analysis; it does run on
 * fewer workers while the device is hot or the battery is under half.
 */

export type PowerMode = 'full' | 'battery' | 'low-battery' | 'hot';

export interface PowerState {
  mode: PowerMode;
  /** Engine workers in use / available. */
  lanes: number;
  maxLanes: number;
  /** Network milliseconds per position: recent, and while the device was cool. */
  recentMs: number;
  coolMs: number;
  charging: boolean | null;
  battery: number | null;
}

export const usePower = create<PowerState>(() => ({
  mode: 'full',
  lanes: 1,
  maxLanes: 1,
  recentMs: 0,
  coolMs: 0,
  charging: null,
  battery: null,
}));

export interface GovernedEngine {
  laneCount: number;
  activeLanes: number;
  setActiveLanes(n: number): void;
  onCompute?: (positions: number, ms: number) => void;
  dead: string | null;
}

/** Recent time per position this much slower than the cool time means throttling. */
export const HOT_RATIO = 1.4;
const COOL_RATIO = 1.15;
/** Samples (network calls) the cool reference is taken from. */
const COOL_SAMPLES = 24;

/** Pure part of the heat logic, so it can be tested. */
export class HeatTracker {
  private early: number[] = [];
  cool = 0;
  recent = 0;
  private hotSince = 0;
  private coolSince = 0;

  /** Feed one call's milliseconds per position; returns 'hot', 'cool' or null (no change). */
  add(msPerPos: number, t: number): 'hot' | 'cool' | null {
    if (!(msPerPos > 0) || !Number.isFinite(msPerPos)) return null;
    if (this.early.length < COOL_SAMPLES) {
      this.early.push(msPerPos);
      if (this.early.length === COOL_SAMPLES) {
        const sorted = [...this.early].sort((a, b) => a - b);
        this.cool = sorted[Math.floor(sorted.length * 0.25)];
      }
      this.recent = this.recent ? this.recent * 0.8 + msPerPos * 0.2 : msPerPos;
      return null;
    }
    // About the last 20 calls.
    this.recent = this.recent * 0.95 + msPerPos * 0.05;
    // A faster time than the reference just means the reference was taken while busy.
    if (msPerPos < this.cool) this.cool = this.cool * 0.9 + msPerPos * 0.1;
    const ratio = this.recent / this.cool;
    if (ratio > HOT_RATIO) {
      this.coolSince = 0;
      if (!this.hotSince) this.hotSince = t;
      if (t - this.hotSince > 20_000) {
        this.hotSince = t;
        return 'hot';
      }
    } else if (ratio < COOL_RATIO) {
      this.hotSince = 0;
      if (!this.coolSince) this.coolSince = t;
      if (t - this.coolSince > 60_000) {
        this.coolSince = t;
        return 'cool';
      }
    } else {
      this.hotSince = 0;
      this.coolSince = 0;
    }
    return null;
  }
}

let engine: GovernedEngine | null = null;
let heat = new HeatTracker();
let hotLevel = 0;
let battery: { charging: boolean; level: number } | null = null;

function update() {
  const s = usePower.getState();
  const maxLanes = engine?.laneCount ?? 1;
  let mode: PowerMode = 'full';
  if (battery && !battery.charging && battery.level <= 0.2) mode = 'low-battery';
  else if (hotLevel > 0) mode = 'hot';
  else if (battery && !battery.charging && battery.level < 0.5) mode = 'battery';
  let lanes = maxLanes - hotLevel;
  if (mode === 'battery' || mode === 'low-battery') lanes = Math.min(lanes, Math.ceil(maxLanes / 2));
  lanes = Math.max(1, lanes);
  if (engine && !engine.dead && engine.activeLanes !== lanes) engine.setActiveLanes(lanes);
  usePower.setState({
    ...s,
    mode,
    lanes,
    maxLanes,
    recentMs: Math.round(heat.recent),
    coolMs: Math.round(heat.cool),
    charging: battery ? battery.charging : null,
    battery: battery ? battery.level : null,
  });
}

let lastUi = 0;

/** Watch this engine (the main one). */
export function governEngine(e: GovernedEngine) {
  engine = e;
  heat = new HeatTracker();
  hotLevel = 0;
  e.onCompute = (positions, ms) => {
    const now = Date.now();
    const change = heat.add(ms / Math.max(1, positions), now);
    if (change === 'hot') hotLevel = Math.min(hotLevel + 1, Math.max(1, (engine?.laneCount ?? 1) - 1));
    else if (change === 'cool' && hotLevel > 0) hotLevel--;
    if (change || now - lastUi > 2000) {
      lastUi = now;
      update();
    }
  };
  update();
}

type BatteryLike = EventTarget & { charging: boolean; level: number };
let batteryWatch = false;
function watchBattery() {
  if (batteryWatch || typeof navigator === 'undefined') return;
  batteryWatch = true;
  const get = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery;
  if (!get) return;
  get
    .call(navigator)
    .then((b) => {
      const read = () => {
        battery = { charging: b.charging, level: b.level };
        update();
      };
      read();
      b.addEventListener('chargingchange', read);
      b.addEventListener('levelchange', read);
    })
    .catch(() => {});
}
if (typeof window !== 'undefined') watchBattery();

/**
 * Share of wall time background analysis may keep the engine busy: all of it normally,
 * less when hot or on battery, none on a low battery.
 */
export function backgroundDuty(): number {
  const m = usePower.getState().mode;
  return m === 'low-battery' ? 0 : m === 'hot' ? 0.6 : m === 'battery' ? 0.5 : 1;
}

let workStart = 0;

/**
 * Called by background analysis between positions: waits long enough that the engine is
 * busy only `backgroundDuty()` of the time, and holds while the battery is low.
 */
export async function pace(shouldStop: () => boolean = () => false): Promise<void> {
  const now = Date.now();
  const worked = workStart ? now - workStart : 0;
  let duty = backgroundDuty();
  while (duty === 0 && !shouldStop()) {
    await sleep(5000);
    duty = backgroundDuty();
  }
  if (duty < 1 && worked > 0) {
    const rest = Math.min(10_000, worked * (1 / duty - 1));
    const end = Date.now() + rest;
    while (Date.now() < end && !shouldStop()) await sleep(Math.min(250, end - Date.now()));
  }
  workStart = Date.now();
}

/** Live analysis: a visit limit on battery instead of reading forever. */
export function ponderCap(): number {
  const m = usePower.getState().mode;
  return m === 'low-battery' ? 1000 : m === 'battery' || (battery && !battery.charging) ? 5000 : Infinity;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
