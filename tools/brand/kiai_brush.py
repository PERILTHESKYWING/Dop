"""
気合 for Kiai: the brush outlines of 気 and 合 from Yuji Syuku (SIL OFL 1.1, a kaisho brush font),
plus one hand-traced centre line per stroke in stroke order. The site fills the outline and
reveals it along the centre lines, so the word writes itself stroke by stroke (no hand shown).

    pip install fonttools brotli
    npm pack @fontsource/yuji-syuku && tar xzf fontsource-yuji-syuku-*.tgz
    python3 tools/brand/kiai_brush.py package/files/yuji-syuku-japanese-400-normal.woff2 \
        node_modules/@fontsource/alegreya-sans/files/alegreya-sans-latin-700-normal.woff2 \
        node_modules/@fontsource/alegreya-sans/files/alegreya-sans-latin-500-normal.woff2

Writes kami/src/ui/brand/glyphs.ts. Centre lines were traced on a 50-unit grid over each glyph
(font units, y down, baseline at 1160); `w` is how wide the reveal brush is, `t` how long the
stroke takes in ms and `ease` how the brush moves (a press then a sweep, or a stop).
"""
import json
import re
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

# Traced in screen pixels of a 1:1 render as points the brush passes through (the script draws a
# smooth curve through them): glyph x = px + ox, glyph y = px + 320.
KI_OX, AI_OX = 80, -20
SWEEP = 'sweep'  # harai: starts with a press, ends fast and thin
STOP = 'stop'    # tome / hane: steady, slows at the end

KI = [
    # 1 ノ: press at the top, sweep down-left
    ([(132, 44), (200, 48), (258, 72), (250, 105), (212, 135), (165, 200), (128, 262), (90, 300), (48, 318)], 85, 330, SWEEP),
    # 2 一
    ([(215, 198), (300, 188), (400, 178), (530, 160), (620, 155), (668, 168), (684, 176)], 80, 300, STOP),
    # 3 一
    ([(165, 305), (250, 316), (400, 295), (520, 272), (600, 280), (622, 288)], 75, 280, STOP),
    # 4 乛乚: long horizontal, turn, curve down, swing right, flick up
    ([(60, 412), (200, 432), (400, 411), (550, 392), (690, 392), (630, 445), (568, 520), (551, 650), (567, 750),
      (600, 805), (650, 840), (705, 858), (775, 862), (820, 838), (805, 790), (772, 738), (752, 675), (738, 618)], 118, 860, STOP),
    # 5 ノ of メ
    ([(318, 483), (385, 490), (428, 512), (364, 570), (306, 650), (252, 715), (185, 785), (110, 840), (50, 838)], 90, 330, SWEEP),
    # 6 ㇏ of メ
    ([(138, 537), (190, 565), (245, 600), (302, 650), (347, 715), (391, 780), (415, 828)], 85, 300, STOP),
]
AI = [
    # 1 ノ from the apex
    ([(410, 52), (450, 45), (520, 62), (500, 110), (465, 155), (420, 220), (362, 300), (310, 380), (250, 440), (205, 500),
      (140, 580), (70, 640)], 100, 400, SWEEP),
    # 2 ㇏ with its heavy foot
    ([(555, 100), (600, 168), (650, 238), (750, 372), (835, 490), (900, 535), (950, 565), (995, 585)], 150, 430, SWEEP),
    # 3 一
    ([(325, 420), (370, 428), (460, 421), (565, 406), (650, 402), (700, 410)], 78, 260, STOP),
    # 4 | left side of 口
    ([(255, 578), (310, 610), (350, 660), (356, 750), (355, 850), (372, 905)], 88, 280, STOP),
    # 5 ㇕ top and right side of 口
    ([(268, 575), (400, 580), (550, 571), (650, 562), (720, 570), (768, 600), (690, 640), (665, 700), (650, 780),
      (640, 845)], 100, 480, STOP),
    # 6 一 bottom of 口
    ([(398, 862), (500, 860), (600, 855), (690, 868), (706, 875)], 75, 240, STOP),
]


def smooth(pts: list[tuple[float, float]], dx: float, dy: float) -> str:
    """Catmull-Rom through the points, as cubic Beziers, moved by dx, dy."""
    p = [(x + dx, y + dy) for x, y in pts]
    p = [p[0]] + p + [p[-1]]
    d = [f'M{p[1][0]:.0f} {p[1][1]:.0f}']
    for i in range(1, len(p) - 2):
        (x0, y0), (x1, y1), (x2, y2), (x3, y3) = p[i - 1], p[i], p[i + 1], p[i + 2]
        c1 = (x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6)
        c2 = (x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6)
        d.append(f'C{c1[0]:.0f} {c1[1]:.0f} {c2[0]:.0f} {c2[1]:.0f} {x2:.0f} {y2:.0f}')
    return ' '.join(d)


def shift(d: str, dx: float, dy: float) -> str:
    """Move an absolute path (M L Q C H V Z) by dx, dy and round to whole units."""
    out, cmd, k = [], '', 0
    for tok in re.findall(r'[A-Za-z]|-?\d*\.?\d+', d):
        if tok.isalpha():
            out.append(tok)
            cmd, k = tok, 0
            continue
        axis = 'x' if cmd == 'H' else 'y' if cmd == 'V' else 'xy'[k % 2]
        out.append(f'{float(tok) + (dx if axis == "x" else dy):.0f}')
        k += 1
    return ' '.join(out).replace(' Z', 'Z')


TAGLINE = 'Ask what to play in any Go position'

# 気's hook ends in dry-brush flecks: two small gaps and a loose fleck that read as a glitch at
# screen sizes. They are dropped and the hook is filled to a clean tapered flick (glyph units).
KI_DROP = {4, 5, 6}  # contour indices: the gap in メ's tail, the gap and fleck in the hook
KI_HOOK = [(807, 930), (848, 962), (893, 1036), (917, 1086), (931, 1134), (890, 1168), (812, 1112),
           (816, 1030), (808, 968)]


def closed(pts: list[tuple[float, float]]) -> str:
    """A smooth closed curve through the points (Catmull-Rom)."""
    n = len(pts)
    d = [f'M{pts[0][0]:.0f} {pts[0][1]:.0f}']
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(f'C{c1[0]:.0f} {c1[1]:.0f} {c2[0]:.0f} {c2[1]:.0f} {p2[0]:.0f} {p2[1]:.0f}')
    return ' '.join(d) + 'Z'


def glyph(font: TTFont, ch: str) -> str:
    gs = font.getGlyphSet()
    name = font.getBestCmap()[ord(ch)]
    pen = SVGPathPen(gs, ntos=lambda v: f'{v:.0f}')
    gs[name].draw(TransformPen(pen, (1, 0, 0, -1, 0, font['hhea'].ascent)))
    return shift(pen.getCommands(), 0, 0)


def wordmark(path: str, text: str = 'Kiai') -> tuple[str, int]:
    """The name as outlines (Alegreya Sans 700), so the loader shows it before any font loads."""
    font = TTFont(path)
    gs, cmap, asc = font.getGlyphSet(), font.getBestCmap(), font['hhea'].ascent
    out, x = [], 0
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=lambda v: f'{v:.0f}')
        gs[name].draw(TransformPen(pen, (1, 0, 0, -1, x, asc)))
        out.append(pen.getCommands())
        x += gs[name].width
    return shift(' '.join(out), 0, 0), x


def main() -> None:
    font = TTFont(sys.argv[1])
    ki, ai = glyph(font, '気'), glyph(font, '合')
    parts = [p for p in re.split(r'(?=M)', ki) if p.strip()]
    ki = ' '.join(p.strip() for i, p in enumerate(parts) if i not in KI_DROP) + ' ' + closed(KI_HOOK)
    strokes = [(smooth(p, KI_OX, 320), w, t, e, 0) for p, w, t, e in KI] + [
        (smooth(p, AI_OX, 320), w, t, e, 1) for p, w, t, e in AI
    ]
    data = {
        'glyphs': [ki, ai],
        'strokes': [{'d': d, 'w': w, 't': t, 'ease': e, 'glyph': g} for d, w, t, e, g in strokes],
    }
    out = Path(__file__).resolve().parents[2] / 'kami/src/ui/brand/glyphs.ts'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        '/* Generated by tools/brand/kiai_brush.py from Yuji Syuku (SIL OFL 1.1). Do not edit by hand. */\n'
        "export type Ease = 'sweep' | 'stop';\n"
        'export interface Stroke { d: string; w: number; t: number; ease: Ease; glyph: 0 | 1 }\n'
        '/** 気 then 合, each in its own font units (y down, baseline 1160); brush.ts places them. */\n'
        f"export const GLYPHS: [string, string] = {json.dumps(data['glyphs'])};\n"
        '/** Stroke order: centre line, reveal width, duration ms, brush movement. */\n'
        f"export const STROKES: Stroke[] = {json.dumps(data['strokes'], ensure_ascii=False)};\n"
        + (f"/** 'Kiai' in Alegreya Sans 700 as outlines: path, advance width (em 1000, y down). */\n"
           f"export const WORDMARK = {json.dumps(list(wordmark(sys.argv[2])))} as const;\n" if len(sys.argv) > 2 else '')
        + (f"/** The loader's one line, in Alegreya Sans 500 as outlines. */\n"
           f"export const TAGLINE = {json.dumps(list(wordmark(sys.argv[3], TAGLINE)))} as const;\n" if len(sys.argv) > 3 else '')
    )
    print('wrote', out, sum(len(g) for g in data['glyphs']), 'path chars')


if __name__ == '__main__':
    main()
