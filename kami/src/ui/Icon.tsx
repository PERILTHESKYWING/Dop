/** Small line icons (24px grid, currentColor). */
const PATHS: Record<string, string> = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  board: 'M5 5h14v14H5zM5 9.7h14M5 14.3h14M9.7 5v14M14.3 5v14',
  plus: 'M12 5v14M5 12h14',
  send: 'M12 19V5M6 11l6-6 6 6',
  stop: 'M8 8h8v8H8z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  redo: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  down: 'M7 10l5 5 5-5',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  paste: 'M9 4h6v3H9zM7 6H5v14h14V6h-2',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  first: 'M7 6v12M18 6l-7 6 7 6',
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  last: 'M17 6v12M6 6l7 6-7 6',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
