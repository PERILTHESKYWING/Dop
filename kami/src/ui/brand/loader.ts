/**
 * The first screen: 気合 writes itself on washi paper, the seal is pressed under it, and the
 * name Kiai appears under it with one line saying what it is; then the sheet fades to the page. vite.config.ts puts this markup straight into index.html, so it shows
 * before any script loads.
 *
 * First visit: the whole word is written (about 2.6 s), then the sheet waits for the page to say
 * it is ready (`markReady`, kami/src/lib/ready.ts). Later visits: nothing shows unless loading
 * takes longer than 450 ms. A click or key finishes the writing at once. After 9 s it goes
 * regardless, so a failed script never leaves a blank sheet.
 */
import { brushMarkup, BRUSH_CSS, timeline } from './brush';
import { TAGLINE, WORDMARK } from './glyphs';
import { sealMarkup } from './seal';

const START = 250;
const HOLD = 420;
const SEAL = 260;
/**
 * The landing's first picture (`.l-sky` in landing.css). It is a CSS background inside a lazy
 * chunk, so the browser would only find it after main.js, Landing.js and its CSS; when this
 * visit will open on the landing (same test as main.tsx), it is fetched at once, at high priority.
 */
const LANDING_STILL = '/kiai/sky-1536.webp';

export function loaderHtml(): string {
  const { done } = timeline(1, START);
  const sealAt = done + 140;
  const finished = sealAt + SEAL + HOLD;
  const css =
    BRUSH_CSS +
    '#kiai-loader{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;' +
    'background:#f1ebe0 url(/kiai/washi.webp);color:#191613;transition:opacity .6s ease,visibility .6s}' +
    '#kiai-loader.kl-out{opacity:0;visibility:hidden;pointer-events:none}' +
    '.kl-lock,.kl-lock body{overflow:hidden}' +
    '.kl-col{position:relative;height:min(62vh,560px,104vw);aspect-ratio:1000/1790}' +
    '.kl-col .kb{width:100%;height:100%}' +
    `.kl-seal{position:absolute;left:-31%;bottom:1%;width:27%;opacity:0;animation:kl-stamp ${SEAL}ms cubic-bezier(.3,0,.2,1) ${sealAt}ms both}` +
    '.kl-seal svg{display:block;width:100%;height:auto}' +
    `.kl-name{position:absolute;left:50%;top:calc(100% + 3.4vh);height:clamp(22px,3.4vh,30px);transform:translateX(-50%);opacity:0;animation:kl-name .5s ease ${sealAt + 120}ms both}` +
    '.kl-name svg{display:block;height:100%;width:auto;margin:0 auto}' +
    '.kl-name .kl-tag{height:clamp(18px,2.4vh,22px);margin-top:clamp(12px,1.8vh,16px);opacity:.86;overflow:visible}' +
    '@keyframes kl-name{to{opacity:1}}' +
    '@keyframes kl-stamp{0%{opacity:0;transform:scale(1.12)}55%{opacity:1;transform:scale(.985)}100%{opacity:1;transform:scale(1)}}' +
    '.kl-repeat #kiai-loader:not(.kl-show){opacity:0;pointer-events:none;transition:none}' +
    '.kl-repeat #kiai-loader:not(.kl-show) .kb-s,.kl-repeat #kiai-loader:not(.kl-show) .kb-all,.kl-repeat #kiai-loader:not(.kl-show) .kl-seal,.kl-repeat #kiai-loader:not(.kl-show) .kl-name{animation-play-state:paused}' +
    '#kiai-loader.kl-skip .kb-s,#kiai-loader.kl-skip .kb-all,#kiai-loader.kl-skip .kl-seal,#kiai-loader.kl-skip .kl-name{animation-delay:0s!important;animation-duration:1ms!important}' +
    '@media (prefers-reduced-motion:reduce){.kl-seal,.kl-name{animation:none;opacity:1}}';
  // Runs before the page's scripts: decides first visit or not, then waits for 'kiai-ready'.
  const script = `(function(){var d=document.documentElement,el=document.getElementById('kiai-loader');if(!el)return;
var seen=false;try{seen=localStorage.getItem('kiai.seen')==='1'}catch(e){}
var h=location.hash,ent=true;try{ent=localStorage.getItem('kiai.entered')==='1'}catch(e){}
if(h==='#welcome'||(!ent&&h!=='#annotate')){var pl=document.createElement('link');pl.rel='preload';pl.as='image';pl.href='${LANDING_STILL}';pl.setAttribute('fetchpriority','high');document.head.appendChild(pl)}
var ready=!!window.__kiaiReady,written=seen,gone=false,shownAt=seen?0:Date.now();
if(seen)d.classList.add('kl-repeat');else d.classList.add('kl-lock');
function hide(){if(gone)return;gone=true;el.classList.add('kl-out');d.classList.remove('kl-lock');try{localStorage.setItem('kiai.seen','1')}catch(e){}setTimeout(function(){el.remove();d.classList.remove('kl-repeat')},700)}
function check(){if(!ready||!written)return;if(seen&&!shownAt)return hide();setTimeout(hide,Math.max(0,500-(Date.now()-shownAt)))}
window.addEventListener('kiai-ready',function(){ready=true;check()});
if(seen)setTimeout(function(){if(!ready){el.classList.add('kl-show');d.classList.add('kl-lock');shownAt=Date.now()}},450);
else setTimeout(function(){written=true;check()},${finished});
function skip(){el.classList.add('kl-skip');written=true;setTimeout(check,${SEAL + 120})}
el.addEventListener('pointerdown',skip);window.addEventListener('keydown',function k(){skip();window.removeEventListener('keydown',k)});
setTimeout(function(){ready=written=true;check()},9000);
})();`;
  return (
    `<style>${css}</style>` +
    `<div id="kiai-loader" role="img" aria-label="気合. Kiai: ask what to play in any Go position">` +
    `<div class="kl-col">${brushMarkup({ id: 'kl', write: true, start: START, ink: '#191613' })}` +
    `<div class="kl-seal">${sealMarkup({ id: 'kls', size: 96 })}</div><div class="kl-name"><svg viewBox="0 200 ${WORDMARK[1]} 710" aria-hidden="true"><path d="${WORDMARK[0]}" fill="currentColor"/></svg>` +
    `<svg class="kl-tag" viewBox="0 330 ${TAGLINE[1]} 860" aria-hidden="true"><path d="${TAGLINE[0]}" fill="currentColor"/></svg></div></div></div>` +
    `<script>${script.replace(/\n/g, '')}</script>`
  );
}
