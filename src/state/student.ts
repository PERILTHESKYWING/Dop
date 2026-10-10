import { engineEvaluator, type LeafEvaluator } from '../lib/engine/mcts';
import type { EngineBackend } from '../lib/engine/types';
import { isCool } from '../lib/engine/governor';
import { StudentEngine } from '../lib/student/engine';
import type { StudentManifest } from '../lib/student/manifest';
import { parseDopnet } from '../lib/student/runtime';
import { get, set } from './store';

/**
 * The student network (lib/student, scripts/student/README.md): a small network taught by
 * KataGo's big ones, fast enough to search on a phone. When it is on, it does the searching
 * ("small brain below") and the KataGo network already running here judges the top of
 * every search ("big brain at the top", brain.ts anchorFor).
 *
 * Auto uses it only when the nightly training's gate found it better than the built-in
 * network at equal time (public/student/manifest.json `enabled`).
 */

let manifest: Promise<StudentManifest | null> | null = null;
let starting: Promise<StudentEngine | null> | null = null;
let student: StudentEngine | null = null;

export function studentManifest(): Promise<StudentManifest | null> {
  manifest ??= fetch('/student/manifest.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<StudentManifest>) : null))
    .then((m) => (m && m.version === 1 && m.file ? m : null))
    .catch(() => null);
  return manifest;
}

/** Whether the settings and the manifest call for the student (before it is loaded). */
async function wanted(): Promise<StudentManifest | null> {
  const mode = get().settings.student;
  if (mode === 'off') return null;
  const m = await studentManifest();
  if (!m) return null;
  return mode === 'on' || m.enabled ? m : null;
}

/** Start (once) the student network when it is wanted; resolves null otherwise. */
export function startStudent(lanes: () => number): Promise<StudentEngine | null> {
  if (student && !student.dead) return Promise.resolve(student);
  starting ??= (async () => {
    const m = await wanted();
    if (!m) {
      const known = await studentManifest();
      set({ student: { status: 'off', name: known?.name, enabled: known?.enabled, gate: known?.gate } });
      return null;
    }
    set({ student: { status: 'loading', name: m.name, enabled: m.enabled, gate: m.gate } });
    try {
      const [wasm, net] = await Promise.all(
        [`/student/dopnet.wasm?v=${encodeURIComponent(m.updated)}`, `/student/${m.file}?v=${encodeURIComponent(m.updated)}`].map(async (u) => {
          const r = await fetch(u);
          if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
          return r.arrayBuffer();
        }),
      );
      const { header } = parseDopnet(net);
      const eng = await StudentEngine.load(wasm, net, header, Math.max(1, lanes()));
      eng.lanesNow = lanes;
      student = eng;
      set({ student: { status: 'ready', name: m.name, enabled: m.enabled, gate: m.gate } });
      return eng;
    } catch (e) {
      set({ student: { status: 'error', name: m.name, note: (e as Error).message } });
      return null;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

export function stopStudent() {
  student?.terminate();
  student = null;
  starting = null;
  set({ student: { status: 'off' } });
}

/** The running student network, or null. */
export const runningStudent = () => (student && !student.dead ? student : null);

/** Whether searches on this board size use the student now. */
export const studentSearches = (size: number) => size === 19 && !!runningStudent();

/**
 * The evaluator for a search on the main engine: the student when it runs (19x19), else
 * the main engine itself.
 */
export function searchEvaluator(main: EngineBackend, size: number): LeafEvaluator {
  const s = runningStudent();
  return s && size === 19 ? engineEvaluator(s) : engineEvaluator(main);
}

/**
 * Visits for a search with the student instead of the main engine, so it takes about the
 * same time (it is several times faster per position). Cool mode keeps the visits and
 * saves the time (and the battery) instead.
 */
export function studentVisits(visits: number, size: number): number {
  if (!studentSearches(size) || isCool()) return visits;
  const k = get().student.gate?.speedup ?? 1;
  return Math.round(visits * Math.max(1, Math.min(8, k)));
}
