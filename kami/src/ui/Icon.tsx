/** Kami's line icons: 24px grid, round joins, currentColor, one stroke weight throughout. */

/** A gear with rounded teeth, drawn once from numbers rather than copied from an icon set. */
function gearPath(): string {
  const teeth = 8;
  const rOut = 9.6;
  const rIn = 7.4;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const w = (Math.PI * 2) / teeth;
    // Tooth top spans 30% of the pitch, flanks 15% each, root 40%.
    const at = (r: number, t: number) => `${(12 + r * Math.cos(a + t * w)).toFixed(2)} ${(12 + r * Math.sin(a + t * w)).toFixed(2)}`;
    pts.push(`${i ? 'L' : 'M'}${at(rIn, -0.35)}`, `L${at(rOut, -0.17)}`, `A${rOut} ${rOut} 0 0 1 ${at(rOut, 0.17)}`, `L${at(rIn, 0.35)}`, `A${rIn} ${rIn} 0 0 1 ${at(rIn, 0.65)}`);
  }
  return `${pts.join('')}Z M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0`;
}

const PATHS: Record<string, string> = {
  menu: 'M4 7h16M4 12h16M4 17h10',
  sidebar: 'M4.5 5.5h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM9.5 5.5v13',
  board: 'M5.5 4.5h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM4.5 9.5h15M4.5 14.5h15M9.5 4.5v15M14.5 4.5v15',
  plus: 'M12 5v14M5 12h14',
  send: 'M12 19V5M6 11l6-6 6 6',
  stop: 'M8.5 7.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  copy: 'M9.5 8.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM15.5 8.5v-3a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3',
  redo: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  edit: 'M4.5 19.5h4l10-10a2.1 2.1 0 0 0-4-4l-10 10v4zM13.5 7.5l3 3',
  trash: 'M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 11.6a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7',
  down: 'M7 10l5 5 5-5',
  right: 'M10 7l5 5-5 5',
  updown: 'M8 9.5l4-4 4 4M8 14.5l4 4 4-4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  upload: 'M12 15V4.5M7.5 9l4.5-4.5L16.5 9M4.5 15v3.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V15',
  folder: 'M3.5 7.5v10a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-7.6L10 6.5H4.5a1 1 0 0 0-1 1z',
  paste: 'M9 4.5h6v2.5H9zM15 5.5h2.5a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1H9M9 12h6M9 15.5h4',
  undo: 'M9 13.5L4.5 9 9 4.5M4.5 9h10a5 5 0 0 1 0 10h-3',
  pass: 'M5 12h11M12.5 7.5l4.5 4.5-4.5 4.5M19.5 6v12',
  first: 'M7 6.5v11M17 6.5L11 12l6 5.5',
  prev: 'M14.5 6.5L9 12l5.5 5.5',
  next: 'M9.5 6.5L15 12l-5.5 5.5',
  last: 'M17 6.5v11M7 6.5l6 5.5-6 5.5',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  spark: 'M12 4v3.5M12 16.5V20M4 12h3.5M16.5 12H20M6.4 6.4l2.5 2.5M15.1 15.1l2.5 2.5M6.4 17.6l2.5-2.5M15.1 8.9l2.5-2.5',
  gear: gearPath(),
  target: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  territory: 'M4.5 4.5h7v7h-7zM12.5 12.5h7v7h-7zM14.5 4.5h5v5M4.5 14.5v5h5',
  // Report tabs: a line through points, a warning mark, three bars on a base line.
  trend: 'M4 18.5l5-6 4 3.5 7-9M4 4v15.5h16.5',
  blunder: 'M12 4.5l8.5 15h-17zM12 10v4M12 17h.01',
  performance: 'M4 20h16M7 20v-6M12 20V7M17 20v-9',
  // Account menu
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  usage: 'M4.5 16a7.5 7.5 0 1 1 15 0M12 16l3.5-4.5M4.5 19.5h15',
  help: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM9.6 9.6a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 16.8h.01',
  info: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 11v5M12 8h.01',
  external: 'M14 4.5h5.5V10M19.5 4.5L11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10',
  stones: 'M9 15.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM14.5 19.5a4.5 4.5 0 1 0 0-9',
  download: 'M12 4.5V15M7.5 10.5L12 15l4.5-4.5M4.5 15v3.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V15',
  chat: 'M5.5 5h13a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5V16a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      className={`icon icon-${name}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
