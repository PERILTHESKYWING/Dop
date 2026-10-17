/** How deep a model reads, as a little depth sounding: one, two or three marks down a line. */
export function Depth({ id, size = 16 }: { id: string; size?: number }) {
  const n = id === 'hane' ? 1 : id === 'myoshu' ? 3 : 2;
  return (
    <svg className="depth" width={(size * 12) / 16} height={size} viewBox="0 0 12 16" aria-hidden="true">
      <path d="M6 1.5V14.5" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.2" strokeLinecap="round" />
      {[4, 8.5, 13].slice(0, n).map((y) => (
        <circle key={y} cx="6" cy={y} r="2.2" fill="currentColor" />
      ))}
    </svg>
  );
}
