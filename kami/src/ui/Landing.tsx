import { useEffect, useState } from 'react';
import { CtaDemo } from './landing/Cta';
import { Dive } from './landing/Dive';
import { Hero } from './landing/Hero';
import { useSeen } from './landing/live';
import { Logo } from './Logo';
import './landing.css';

/**
 * Kiai's front door. The hero is a path-traced sky and table with the live 3D board on it,
 * answering questions about a real position; below, one board stays on screen while the page
 * dives (Skim, Dive, Abyss) through what Kiai does, every number and answer recorded from the
 * real engine (landing/data.ts).
 */
export default function Landing({ onEnter }: { onEnter: () => void }) {
  const [solid, setSolid] = useState(false);
  const [dark, setDark] = useState(false);
  const [cta, ctaSeen] = useSeen<HTMLElement>();

  useEffect(() => {
    document.documentElement.classList.add('kiai-landing');
    const meta = document.querySelector('meta[name="theme-color"]');
    const was = meta?.getAttribute('content');
    meta?.setAttribute('content', '#f4f8fc');
    return () => {
      document.documentElement.classList.remove('kiai-landing');
      if (meta && was) meta.setAttribute('content', was);
    };
  }, []);
  // the bar turns solid once the page scrolls, and takes the tone of the section under it (the
  // dive darkens as it goes deeper and says so with a 'kiai-tone' event)
  useEffect(() => {
    let raf = 0;
    const on = () => {
      raf = 0;
      setSolid(window.scrollY > 24);
      let tone = 'light';
      for (const el of document.querySelectorAll<HTMLElement>('.landing [data-tone]')) {
        const r = el.getBoundingClientRect();
        if (r.top <= 40 && r.bottom > 40) tone = el.dataset.tone ?? 'light';
      }
      setDark(tone === 'dark');
    };
    const req = () => {
      if (!raf) raf = requestAnimationFrame(on);
    };
    on();
    window.addEventListener('scroll', req, { passive: true });
    window.addEventListener('resize', req);
    window.addEventListener('kiai-tone', req);
    return () => {
      window.removeEventListener('scroll', req);
      window.removeEventListener('resize', req);
      window.removeEventListener('kiai-tone', req);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const go = (e?: React.MouseEvent) => {
    e?.preventDefault();
    onEnter();
  };

  return (
    <div className="landing">
      <header className={`l-nav${solid ? ' solid' : ''}${dark ? ' dark' : ''}`}>
        <a className="l-brand" href="#welcome" aria-label="Kiai">
          <Logo size={30} tile />
          <span>Kiai</span>
        </a>
        <nav className="l-links" aria-label="Sections">
          <a href="#dive">Watch it read</a>
          <a href="#depths">Depths</a>
          <a href="#review">Game review</a>
          <a href="#device">On your device</a>
        </nav>
        <a className="l-btn small" href="/" onClick={go}>
          Open Kiai
        </a>
      </header>

      <Hero onEnter={go} />
      <Dive />

      <section ref={cta} className={`l-cta${ctaSeen ? ' seen' : ''}`} data-tone="dark" aria-labelledby="l-cta">
        <div className="l-cta-copy">
          <h2 id="l-cta">Set up a position. Ask.</h2>
          <p>Click stones onto the board, paste an SGF or open a file, then ask in your own words.</p>
          <a className="l-btn light" href="/" onClick={go}>
            Ask about a position
          </a>
        </div>
        <CtaDemo />
      </section>

      <footer className="l-footer" data-tone="dark">
        <span>Kiai. Analysis by KataGo, in your browser. The sky and table are path-traced renders; the board is live.</span>
        <span>
          <a href="https://github.com/lightvector/KataGo" target="_blank" rel="noreferrer">
            KataGo
          </a>
          <a href="https://github.com/PERILTHESKYWING/Dop/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">
            Notices
          </a>
          <a href="https://github.com/PERILTHESKYWING/Dop" target="_blank" rel="noreferrer">
            Source
          </a>
        </span>
      </footer>
    </div>
  );
}
