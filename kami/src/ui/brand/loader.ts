/**
 * The first screen: 気合 writes itself on washi paper, the seal is pressed under it, and the
 * name Kiai appears under it with one line saying what it is; then the sheet fades to the page. vite.config.ts puts this markup straight into index.html, so it shows
 * before any script loads.
 *
 * It is not an intro: nothing shows unless the page takes longer than 450 ms to say it is ready
 * (`markReady`, kami/src/lib/ready.ts), first visit or not. Ready counts from the moment the page's
 * first render is in the document (`__kiaiReady`), not from its paint: the 'kiai-ready' event waits
 * two frames so a sheet already showing never uncovers an unpainted page, but a first frame can
 * be slow (a CPU-drawn compositor took about 390 ms), and a sheet that is not up yet has nothing
 * to uncover. The sheet leaves as soon as it
 * is, without waiting for the word to be finished (if it was still fading in, it fades back out
 * from where it got to, so a page that is just late does not flash). 気合 still writes itself, for free, on the
 * landing's last chapter and on the app's empty board. A click or key finishes the writing at
 * once. After 9 s it goes regardless, so a failed script never leaves a blank sheet.
 *
 * The build passes `assets`: the seal and the tagline (~14 KB of paths, seen only on a slow load)
 * then load as cached /assets SVGs instead of riding in every index.html; the brush and the name,
 * which paint first, stay inline. Without `assets` (dev, tests) all of it is inline.
 */
import { brushMarkup, BRUSH_CSS, timeline } from './brush';
import { TAGLINE, WORDMARK } from './glyphs';
import { sealMarkup } from './seal';

const START = 250;
const SEAL = 260;
/** How long the page may take before the sheet shows at all. */
const GRACE = 450;
const INK = '#191613';
/** The tagline's glyphs reach above its 860-unit-high viewBox (to y 198); the file version takes a taller box. */
const TAG_TOP = 190;
const TAG_H = 1190 - TAG_TOP;

/** URLs of the two SVG files the build emits from `loaderFiles()`. */
export interface LoaderAssets {
  seal: string;
  tagline: string;
}

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';

/** The seal and tagline as standalone SVG files, for `LoaderAssets`. */
export function loaderFiles(): LoaderAssets {
  return {
    seal: sealMarkup({ id: 'kls', size: 96 }).replace('<svg ', `<svg ${SVG_NS} `),
    tagline: `<svg ${SVG_NS} viewBox="0 ${TAG_TOP} ${TAGLINE[1]} ${TAG_H}" width="${TAGLINE[1]}" height="${TAG_H}"><path d="${TAGLINE[0]}" fill="${INK}"/></svg>`,
  };
}

export function loaderHtml(assets?: LoaderAssets): string {
  const { done } = timeline(1, START);
  const sealAt = done + 140;
  const css =
    BRUSH_CSS +
    '#kiai-loader{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;' +
    `background:#f1ebe0 url(/kiai/washi.webp);color:${INK};transition:opacity .6s ease,visibility .6s}` +
    '#kiai-loader.kl-out{opacity:0;visibility:hidden;pointer-events:none}' +
    '.kl-lock,.kl-lock body{overflow:hidden}' +
    '.kl-col{position:relative;height:min(62vh,560px,104vw);aspect-ratio:1000/1790}' +
    '.kl-col .kb{width:100%;height:100%}' +
    `.kl-seal{position:absolute;left:-31%;bottom:1%;width:27%;opacity:0;animation:kl-stamp ${SEAL}ms cubic-bezier(.3,0,.2,1) ${sealAt}ms both}` +
    '.kl-seal svg,.kl-seal img{display:block;width:100%;height:auto}' +
    `.kl-name{position:absolute;left:50%;top:calc(100% + 3.4vh);height:clamp(22px,3.4vh,30px);transform:translateX(-50%);opacity:0;animation:kl-name .5s ease ${sealAt + 120}ms both}` +
    '.kl-name svg{display:block;height:100%;width:auto;margin:0 auto}' +
    '.kl-name .kl-tag{height:clamp(18px,2.4vh,22px);margin-top:clamp(12px,1.8vh,16px);opacity:.86;overflow:visible}' +
    // the file version: a taller box, raised by the extra height, so the words sit exactly where the inline ones do
    `.kl-name img.kl-tag{display:block;width:auto;margin-left:auto;margin-right:auto;height:calc(clamp(18px,2.4vh,22px)*${TAG_H}/860);margin-top:calc(clamp(12px,1.8vh,16px) - clamp(18px,2.4vh,22px)*${330 - TAG_TOP}/860)}` +
    '@keyframes kl-name{to{opacity:1}}' +
    '@keyframes kl-stamp{0%{opacity:0;transform:scale(1.12)}55%{opacity:1;transform:scale(.985)}100%{opacity:1;transform:scale(1)}}' +
    '.kl-repeat #kiai-loader:not(.kl-show){opacity:0;pointer-events:none;transition:none}' +
    '.kl-repeat #kiai-loader:not(.kl-show) .kb-s,.kl-repeat #kiai-loader:not(.kl-show) .kb-all,.kl-repeat #kiai-loader:not(.kl-show) .kl-seal,.kl-repeat #kiai-loader:not(.kl-show) .kl-name{animation-play-state:paused}' +
    '#kiai-loader.kl-skip .kb-s,#kiai-loader.kl-skip .kb-all,#kiai-loader.kl-skip .kl-seal,#kiai-loader.kl-skip .kl-name{animation-delay:0s!important;animation-duration:1ms!important}' +
    '@media (prefers-reduced-motion:reduce){.kl-seal,.kl-name{animation:none;opacity:1}}';
  // Runs before the page's scripts: hidden at first; shows only if 'kiai-ready' is late.
  const script = `(function(){var d=document.documentElement,el=document.getElementById('kiai-loader');if(!el)return;
var ready=!!window.__kiaiReady,gone=false,shownAt=0;
d.classList.add('kl-repeat');
function hide(){if(gone)return;gone=true;el.classList.add('kl-out');d.classList.remove('kl-lock');setTimeout(function(){el.remove();d.classList.remove('kl-repeat')},shownAt?700:0)}
function check(){if(ready)hide()}
window.addEventListener('kiai-ready',function(){ready=true;check()});
setTimeout(function(){if(!ready&&!window.__kiaiReady&&!gone){el.classList.add('kl-show');d.classList.add('kl-lock');shownAt=Date.now()}},${GRACE});
function skip(){el.classList.add('kl-skip')}
el.addEventListener('pointerdown',skip);window.addEventListener('keydown',function k(){skip();window.removeEventListener('keydown',k)});
setTimeout(function(){ready=true;check()},9000);
check();
})();`;
  return (
    `<style>${css}</style>` +
    `<div id="kiai-loader" role="img" aria-label="気合. Kiai: ask what to play in any Go position">` +
    `<div class="kl-col">${brushMarkup({ id: 'kl', write: true, start: START, ink: INK })}` +
    `<div class="kl-seal">${assets ? `<img src="${assets.seal}" width="96" height="96" alt="">` : sealMarkup({ id: 'kls', size: 96 })}</div>` +
    `<div class="kl-name"><svg viewBox="0 200 ${WORDMARK[1]} 710" aria-hidden="true"><path d="${WORDMARK[0]}" fill="currentColor"/></svg>` +
    (assets
      ? `<img class="kl-tag" src="${assets.tagline}" width="${TAGLINE[1]}" height="${TAG_H}" alt="">`
      : `<svg class="kl-tag" viewBox="0 330 ${TAGLINE[1]} 860" aria-hidden="true"><path d="${TAGLINE[0]}" fill="currentColor"/></svg>`) +
    `</div></div></div>` +
    `<script>${script.replace(/\n/g, '')}</script>`
  );
}
