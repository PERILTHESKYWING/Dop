/**
 * The sky, still, while three.js is on its way: the same panorama the live picture uses, drawn
 * through the same camera (landing/camera.ts) with a few lines of plain WebGL, so when the live
 * board fades in over it the sky does not move. It follows the scroll until then.
 *
 * Matches three.js's equirectangular background (WebGLBackground): world direction, turned by
 * -SKY_TURN about y, to (atan(z, x) / 2π + 0.5, asin(y) / π + 0.5), the image flipped in y; an
 * sRGB background is not tone mapped, so its pixels show as they are.
 */
import { useEffect, useRef } from 'react';
import { camAt, orbitAxes, pixelRatio, SKY_TURN, skyUrl, type Box } from './camera';

const VS = `attribute vec2 p;varying vec2 n;void main(){n=p;gl_Position=vec4(p,0.,1.);}`;
const FS = `precision highp float;varying vec2 n;uniform sampler2D s;uniform vec3 ax,ay,az;uniform vec2 k,o;uniform float c,si;
void main(){vec3 d=normalize(ax*((n.x-o.x)*k.x)+ay*((n.y-o.y)*k.y)-az);
vec3 r=vec3(c*d.x+si*d.z,d.y,-si*d.x+c*d.z);
gl_FragColor=texture2D(s,vec2(atan(r.z,r.x)*.15915494+.5,asin(clamp(r.y,-1.,1.))*.31830989+.5));}`;

/** A WebGL drawn on the CPU (SwiftShader, llvmpipe): the live board would block the page for seconds. */
function softwareGl(gl: WebGLRenderingContext): boolean {
  // ?kiai3d keeps the live board anyway (for testing it on such a machine)
  if (/[?&]kiai3d\b/.test(location.search)) return false;
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(r);
  } catch {
    return false;
  }
}

export default function Poster({ at, drawRef, boxRef, onDrawn, onFail }: { at: React.MutableRefObject<number>; drawRef: React.MutableRefObject<((p: number) => void) | null>; boxRef: React.MutableRefObject<(i: number, tall: boolean) => Box>; onDrawn: () => void; onFail: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current!;
    const gl = (cv.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false }) ?? null) as WebGLRenderingContext | null;
    if (!gl || softwareGl(gl)) {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      onFail();
      return;
    }
    let gone = false;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      onFail();
      return;
    }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    const turn = (-SKY_TURN * Math.PI) / 180;
    gl.uniform1f(u('c'), Math.cos(turn));
    gl.uniform1f(u('si'), Math.sin(turn));
    let ready = false;
    let drawn = false;

    const draw = (p: number) => {
      if (!ready || gone) return;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (w < 2 || h < 2) return;
      const pr = pixelRatio();
      const W = Math.round(w * pr), H = Math.round(h * pr);
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
      }
      gl.viewport(0, 0, W, H);
      const aspect = w / h;
      const tall = aspect < 0.9;
      const cam = camAt(p, aspect, (i) => boxRef.current(i, tall));
      // the camera looks from target + dist·dir at the target; only its turn matters for the sky
      const { x, y, z } = orbitAxes(cam.elev, cam.azim);
      const t = Math.tan((cam.fov * Math.PI) / 360);
      gl.uniform3fv(u('ax'), x);
      gl.uniform3fv(u('ay'), y);
      gl.uniform3fv(u('az'), z);
      gl.uniform2f(u('k'), t * aspect, t);
      gl.uniform2f(u('o'), 2 * cam.shift, 2 * cam.shiftY);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!drawn) {
        drawn = true;
        requestAnimationFrame(() => !gone && onDrawn());
      }
    };

    const img = new Image();
    img.decoding = 'async';
    (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'high';
    img.src = skyUrl();
    img
      .decode()
      .then(() => {
        if (gone) return;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        ready = true;
        draw(at.current);
      })
      .catch(() => !gone && onFail());

    let raf = 0;
    drawRef.current = (p) => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), draw(p)));
    };
    const ro = new ResizeObserver(() => drawRef.current?.(at.current));
    ro.observe(cv);
    // the words' size (and so the room left for the board) changes when their font arrives
    document.fonts?.ready.then(() => drawRef.current?.(at.current), () => undefined);
    return () => {
      gone = true;
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      drawRef.current = null;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <canvas ref={canvas} className="l-poster" aria-hidden="true" />;
}
