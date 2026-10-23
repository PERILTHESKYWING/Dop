/**
 * Whether this browser can draw the 3D board, and whether a graphics card draws it (kept apart
 * from kaya.ts, so asking does not load three.js).
 *
 * Asking means making a WebGL context, which takes 20 to 80 ms with a graphics card and about
 * 200 ms on a CPU-drawn WebGL (SwiftShader), all on the main thread before the first paint. So
 * the answer is kept in localStorage `kiai.gl`: a return visit reads it at once (the 気合 loading
 * sheet waits only 450 ms for the page), and the browser checks again when it is idle, for the
 * next visit. If the 3D board fails anyway, Kaya3D's error boundary falls back to the flat one.
 */
export type GlKind = 'hw' | 'soft' | 'none';

const KEY = 'kiai.gl';
let known: GlKind | null = null;

function probe(): GlKind {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'none';
    let soft = false;
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      soft = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
    } catch {
      /* counted as a graphics card */
    }
    // give the context back at once: browsers allow only a few at a time
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return soft ? 'soft' : 'hw';
  } catch {
    return 'none';
  }
}

function save(k: GlKind) {
  try {
    localStorage.setItem(KEY, k);
  } catch {
    /* blocked: asked again next visit */
  }
}

/** 'hw' (a graphics card draws WebGL), 'soft' (the CPU does) or 'none'. */
export function glKind(): GlKind {
  if (known) return known;
  let had: string | null = null;
  try {
    had = localStorage.getItem(KEY);
  } catch {
    had = null;
  }
  if (had === 'hw' || had === 'soft' || had === 'none') {
    known = had;
    const again = () => save(probe());
    if (typeof requestIdleCallback === 'function') requestIdleCallback(again, { timeout: 10_000 });
    else setTimeout(again, 3000);
    return known;
  }
  known = probe();
  save(known);
  return known;
}

/** Whether this browser can draw the 3D board at all. */
export function webglOk(): boolean {
  return glKind() !== 'none';
}
