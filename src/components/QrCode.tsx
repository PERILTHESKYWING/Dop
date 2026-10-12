import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** A QR code as an SVG (black on white with a quiet zone, so phone cameras read it in every theme). */
export function QrCode({ text, size = 184, label }: { text: string; size?: number; label: string }) {
  const { n, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n, path };
  }, [text]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n + 8} ${n + 8}`} shapeRendering="crispEdges" style={{ display: 'block', borderRadius: 8 }}>
      <rect width={n + 8} height={n + 8} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
