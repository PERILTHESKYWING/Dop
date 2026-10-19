/** Whether this browser can draw the 3D board (kept apart from kaya.ts, so asking does not load three.js). */
export function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
