#!/usr/bin/env node
// Draws the hub's Look backgrounds (scenes, stones, wood grain) as data-URI SVGs. The pictures
// (~113 KB) go to hub/walls.css, which the page reads only when a background needs them and then
// keeps on the device; the small rules that pick a picture go into hub/index.html between the
// walls:start and walls:end markers.
// Run after changing a scene: node hub/walls.mjs
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const r = (a, b) => a + rnd() * (b - a);
const n = (x) => Math.round(x);
import { readFileSync, writeFileSync } from 'node:fs';

const W = 1600, H = 1000;
const uri = (svg) => `url("data:image/svg+xml,${svg.replace(/\s+/g, ' ').replace(/> </g, '><').replace(/%/g, '%25').replace(/#/g, '%23').replace(/"/g, "'")}")`;
const scene = (body, defs = '') => uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMidYMid slice'><defs>${defs}</defs>${body}</svg>`);
const lg = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id='${id}' x1='0' y1='0' x2='${x2}' y2='${y2}'>${stops.map(([o, c, a = 1]) => `<stop offset='${o}' stop-color='${c}' stop-opacity='${a}'/>`).join('')}</linearGradient>`;
const rg = (id, stops, cx = .5, cy = .5, rr = .5) => `<radialGradient id='${id}' cx='${cx}' cy='${cy}' r='${rr}'>${stops.map(([o, c, a = 1]) => `<stop offset='${o}' stop-color='${c}' stop-opacity='${a}'/>`).join('')}</radialGradient>`;

// A smooth ridge line as a closed path down to the bottom.
function ridge(base, amp, step, s) {
  seed = s; let d = `M0 ${H}L0 ${n(base)}`; let y = base;
  for (let x = 0; x <= W + step; x += step) { const ny = base + r(-amp, amp); d += `Q${n(x - step / 2)} ${n(y)} ${n(x)} ${n((y + ny) / 2)}`; y = ny; }
  return d + `L${W} ${H}Z`;
}
// A row of pines standing on a gently rolling line.
function pines(base, hMin, hMax, gap, s) {
  seed = s; let d = '';
  for (let x = -20; x < W + 40; x += r(gap * .6, gap * 1.3)) {
    const h = r(hMin, hMax), w = h * r(.32, .42), b = base + Math.sin(x / 210 + s) * 18;
    const tiers = 4; let pts = [[x, b - h]];
    for (let k = 1; k <= tiers; k++) { const yy = b - h + (h * .9 * k) / tiers, ww = (w / 2) * (k / tiers); pts.push([x + ww, yy], [x + ww * .45, yy - h * .03]); }
    pts = [...pts, [x + w * .06, b - h * .08], [x + w * .06, b], [x - w * .06, b], [x - w * .06, b - h * .08]];
    const left = []; for (let k = tiers; k >= 1; k--) { const yy = b - h + (h * .9 * k) / tiers, ww = (w / 2) * (k / tiers); left.push([x - ww * .45, yy - h * .03], [x - ww, yy]); }
    pts = [...pts, ...left];
    d += 'M' + pts.map(([a, c]) => `${n(a)} ${n(c)}`).join('L') + 'Z';
  }
  return d + `M0 ${H}L0 ${base}L${W} ${base}L${W} ${H}Z`;
}
function stars(count, s, maxR = 1.5, top = 0.75) {
  seed = s; let o = '';
  for (let i = 0; i < count; i++) { const rr = rnd() < .08 ? r(1.3, maxR + .6) : r(.4, 1.1); o += `<circle cx='${n(r(0, W))}' cy='${n(Math.pow(rnd(), 1.4) * H * top)}' r='${rr.toFixed(1)}' fill='white' opacity='${r(.35, .95).toFixed(2)}'/>`; }
  return o;
}
const mist = (id, y, h, c, a) => `<rect x='0' y='${y}' width='${W}' height='${h}' fill='url(#${id})'/>`;

// ---- Dawn (light) / Dusk (dark): layered hills under a rising sun.
const dawn = (dark) => {
  const sky = dark ? [[0, '#121831'], [.45, '#2c2747'], [.72, '#5b3a52'], [.86, '#8a5257']] : [[0, '#a9bfdc'], [.4, '#d9c9d9'], [.68, '#f4d2bd'], [.82, '#fbe3c7']];
  const hills = dark ? ['#3a2d44', '#2a2236', '#1d1828', '#141120'] : ['#d7bfc6', '#bea6b6', '#9f8aa0', '#7f6f86'];
  const sun = dark ? '#f2a77a' : '#fff4dd';
  const defs = lg('s', sky) + rg('g', [[0, sun, .95], [.25, sun, .45], [1, sun, 0]]) + lg('m', [[0, dark ? '#5b3a52' : '#fbe3c7', 0], [.5, dark ? '#5b3a52' : '#fbe3c7', .55], [1, dark ? '#5b3a52' : '#fbe3c7', 0]]);
  return scene(`<rect width='${W}' height='${H}' fill='url(#s)'/>${dark ? stars(60, 3, 1.2, .4) : ''}<circle cx='1060' cy='640' r='420' fill='url(#g)'/><circle cx='1060' cy='640' r='${dark ? 46 : 58}' fill='${sun}' opacity='.95'/>
    <path d='${ridge(600, 40, 160, 11)}' fill='${hills[0]}'/>${mist('m', 590, 90)}<path d='${ridge(680, 45, 200, 12)}' fill='${hills[1]}'/>${mist('m', 670, 80)}<path d='${ridge(770, 40, 240, 13)}' fill='${hills[2]}'/><path d='${ridge(870, 35, 280, 14)}' fill='${hills[3]}'/>`, defs);
};

function glitter(mx, c, dark) {
  seed = 41; let o = '';
  for (let i = 0; i < 150; i++) { const t = Math.pow(rnd(), 1.3), y = 562 + t * 438, spread = 26 + t * 230, x = mx + (rnd() + rnd() - 1) * spread, w = r(6, 26) * (0.5 + t);
    o += `<rect x='${n(x - w / 2)}' y='${n(y)}' width='${n(w)}' height='${(1 + t * 2).toFixed(1)}' rx='1' fill='${c}' opacity='${((dark ? .35 : .6) * (1 - Math.abs(x - mx) / (spread * 1.1)) * (1 - t * .5)).toFixed(2)}'/>`; }
  return o;
}
// ---- Sea: open water to the horizon, glitter from a sun (or moon) out of frame, wave texture. No disc, no glow.
const sea = (dark) => {
  const sky = dark ? [[0, '#0b1420'], [.6, '#16283a'], [1, '#26405a']] : [[0, '#b9d3e3'], [.6, '#dbe8ee'], [1, '#eef2f0']];
  const water = dark ? [[0, '#1d3448'], [.4, '#122435'], [1, '#08131d']] : [[0, '#a9c9d3'], [.35, '#7fa9b9'], [1, '#4f7f94']];
  const light = dark ? '#e9eef7' : '#fffaf0';
  const defs = lg('s', sky) + lg('w', water) + lg('h', [[0, light, 0], [.5, light, dark ? .25 : .5], [1, light, 0]], 1, 0)
    + `<filter id='t' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.0012 0.035' numOctaves='3' seed='4'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.6 -0.75'/></filter>`
    + `<clipPath id='c'><rect y='560' width='${W}' height='440'/></clipPath>`;
  const mx = 1150;
  return scene(`<rect width='${W}' height='560' fill='url(#s)'/>
    <rect y='560' width='${W}' height='440' fill='url(#w)'/><g clip-path='url(#c)'><rect y='560' width='${W}' height='440' filter='url(#t)' opacity='${dark ? .22 : .45}'/>${glitter(mx, light, dark)}</g><rect y='556' width='${W}' height='8' fill='${light}' opacity='${dark ? .12 : .35}'/>`, defs);
};

// ---- Forest: misty pine ranges, far to near.
const forest = (dark) => {
  const sky = dark ? [[0, '#0e1714'], [1, '#22312a']] : [[0, '#dfe8de'], [1, '#eef1e6']];
  const layers = dark ? ['#25352d', '#1c2a23', '#14201a', '#0d1611'] : ['#bccdbd', '#9db49f', '#7b9781', '#5a7862'];
  const fog = dark ? '#22312a' : '#eef1e6';
  const defs = lg('s', sky) + lg('m', [[0, fog, 0], [.55, fog, .7], [1, fog, 0]]);
  return scene(`<rect width='${W}' height='${H}' fill='url(#s)'/>${dark ? `<circle cx='300' cy='180' r='26' fill='#dfe6dc' opacity='.8'/>` : ''}
    <path d='${pines(520, 70, 130, 34, 21)}' fill='${layers[0]}'/>${mist('m', 420, 140)}<path d='${pines(640, 90, 170, 44, 22)}' fill='${layers[1]}'/>${mist('m', 540, 140)}<path d='${pines(780, 120, 230, 56, 23)}' fill='${layers[2]}'/>${mist('m', 690, 120)}<path d='${pines(950, 170, 320, 76, 24)}' fill='${layers[3]}'/>`, defs);
};

// ---- Night sky (always dark): stars, a faint Milky Way, mountains.
const night = () => {
  const defs = lg('s', [[0, '#070b1c'], [.55, '#121a3d'], [.85, '#2a2752'], [1, '#3b2f5c']])
    + `<filter id='mw' x='-20%' y='-20%' width='140%' height='140%'><feTurbulence type='fractalNoise' baseFrequency='0.006 0.02' numOctaves='4' seed='9'/><feColorMatrix values='0 0 0 0 .85  0 0 0 0 .85  0 0 0 0 1  0 0 0 1.4 -0.55'/><feGaussianBlur stdDeviation='2'/></filter>`
    + `<mask id='band'><rect width='${W}' height='${H}' fill='black'/><ellipse cx='800' cy='380' rx='950' ry='190' transform='rotate(-24 800 380)' fill='url(#bd)'/></mask>` + rg('bd', [[0, 'white', 1], [.5, 'white', .55], [1, 'white', 0]]) + ``;
  return scene(`<rect width='${W}' height='${H}' fill='url(#s)'/><rect width='${W}' height='${H}' filter='url(#mw)' mask='url(#band)' opacity='.5'/>${stars(260, 5)}
    <path d='${ridge(840, 60, 220, 31)}' fill='#141533'/><path d='${ridge(910, 40, 260, 32)}' fill='#0a0b1e'/>`, defs);
};

// ---- Stones: real-looking Go stones scattered (tile).
const stone = (x, y, black) => black
  ? `<g><ellipse cx='${x + 3}' cy='${y + 5}' rx='14' ry='13' fill='black' opacity='.28' filter='url(#sh)'/><circle cx='${x}' cy='${y}' r='14' fill='url(#bk)'/></g>`
  : `<g><ellipse cx='${x + 3}' cy='${y + 5}' rx='14' ry='13' fill='black' opacity='.22' filter='url(#sh)'/><circle cx='${x}' cy='${y}' r='14' fill='url(#wh)'/></g>`;
const stonesTile = () => uri(`<svg xmlns='http://www.w3.org/2000/svg' width='420' height='420' viewBox='0 0 420 420'><defs>${rg('bk', [[0, '#6b6b6b'], [.35, '#2a2a2a'], [1, '#0a0a0a']], .35, .3, .75)}${rg('wh', [[0, '#ffffff'], [.55, '#f1efe9'], [1, '#c9c4b8']], .35, .3, .8)}<filter id='sh' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='2.5'/></filter></defs>
  <g opacity='.7'>${stone(60, 80, true)}${stone(290, 50, false)}${stone(170, 250, false)}${stone(370, 300, true)}${stone(60, 370, false)}</g></svg>`);

// ---- Go board: kaya-like wood grain under the lines (tile).
const grain = (dark) => uri(`<svg xmlns='http://www.w3.org/2000/svg' width='700' height='700'><filter id='g' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.0035 0.11' numOctaves='4' seed='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${dark ? '.12  0 0 0 0 .07  0 0 0 0 .02' : '.45  0 0 0 0 .25  0 0 0 0 .05'}  0 0 0 ${dark ? '1.1 -0.3' : '1.3 -0.45'}'/></filter><rect width='700' height='700' filter='url(#g)'/></svg>`);

const w = { dawn: dawn(false), dusk: dawn(true), sea: sea(false), seaDark: sea(true), forest: forest(false), forestDark: forest(true), night: night(), stones: stonesTile(), grain: grain(false), grainDark: grain(true) };
const lines = (c) => `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`;
// Each picture is written once as a variable; the light and dark rules only point at it.
const v = (k) => `var(--w-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())})`;
const dark = {
  board: `--wall-bg: #4a3420; --wall: ${lines('rgba(240, 205, 150, .16)')}, ${v('grainDark')}; --wall-size: 44px 44px, 44px 44px, 700px 700px;`,
  dawn: `--wall-bg: #2a2236; --wall: ${v('dusk')};`,
  sea: `--wall-bg: #122435; --wall: ${v('seaDark')};`,
  forest: `--wall-bg: #14201a; --wall: ${v('forestDark')};`,
};
const sel = (k, pre) => `${pre}[data-bg="${k}"], ${pre} [data-bg-demo="${k}"]`;
const css = `/* walls:start (written by node hub/walls.mjs) */
/* Backgrounds (Look › Background): painted behind the whole app and the sign-in page. Dots, Grid and Stones are tinted from the theme; the scenes have their own light and dark versions. */
:root, [data-bg-demo=""] { --wall: none; --wall-size: auto; --wall-bg: var(--bg); --tint: color-mix(in srgb, var(--ink) 9%, transparent); }
:root[data-bg="dots"], [data-bg-demo="dots"] { --wall: radial-gradient(var(--tint) 1.2px, transparent 1.6px); --wall-size: 18px 18px; }
:root[data-bg="grid"], [data-bg-demo="grid"] { --wall: ${lines('var(--tint)')}; --wall-size: 26px 26px; }
:root[data-bg="board"], [data-bg-demo="board"] { --wall-bg: #d9ad66; --wall: ${lines('rgba(50, 30, 5, .3)')}, ${v('grain')}; --wall-size: 44px 44px, 44px 44px, 700px 700px; }
:root[data-bg="stones"], [data-bg-demo="stones"] { --wall: ${v('stones')}; --wall-size: 420px 420px; }
:root[data-bg="dawn"], [data-bg-demo="dawn"] { --wall-bg: #bea6b6; --wall: ${v('dawn')}; --wall-size: cover; }
:root[data-bg="sea"], [data-bg-demo="sea"] { --wall-bg: #7fa9b9; --wall: ${v('sea')}; --wall-size: cover; }
:root[data-bg="forest"], [data-bg-demo="forest"] { --wall-bg: #9db49f; --wall: ${v('forest')}; --wall-size: cover; }
:root[data-bg="night"], [data-bg-demo="night"] { --wall-bg: #121a3d; --wall: ${v('night')}; --wall-size: cover; }
@media (prefers-color-scheme: dark) {
${Object.entries(dark).map(([k, v]) => `  ${sel(k, ':root:not([data-theme="light"])')} { ${v} }`).join('\n')}
}
${Object.entries(dark).map(([k, v]) => `${sel(k, ':root[data-theme="dark"]')} { ${v} }`).join('\n')}
/* walls:end */`;
const pics = `/* Written by node hub/walls.mjs: the Look background pictures, read by hub/index.html only when a background needs them. */
:root {
${Object.entries(w).map(([k, u]) => `  ${v(k).slice(4, -1)}: ${u};`).join('\n')} }
`;
writeFileSync(new URL('./walls.css', import.meta.url), pics);
const file = new URL('./index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const a = html.indexOf('/* walls:start'), b = html.indexOf('/* walls:end */');
if (a < 0 || b < 0) throw new Error('walls markers not found in hub/index.html');
writeFileSync(file, html.slice(0, a) + css + html.slice(b + '/* walls:end */'.length));
console.log(`Backgrounds written (rules ${Math.round(css.length / 1024)} KB in index.html, pictures ${Math.round(pics.length / 1024)} KB in walls.css).`);
