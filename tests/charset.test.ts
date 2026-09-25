import { describe, expect, it } from 'vitest';
import { decodeSgfBytes, declaredCharset } from '../src/lib/util/charset';

const hex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));

// SGF snippets encoded with Python's codecs (see the test names for the encoding).
const SAMPLES = {
  gbk: '283b474d5b315d46465b345d535a5b31395d50425bbfc2bde05d50575bd2bbd7d3b5c0b3a4c7e05d42525bbec5b6ce5d435bbadac6e5caa4c2ca20343725a3acb0d7c6e5d3c5cac65d3b425b70645d3b575b64705d29',
  gb2312Declared: '283b474d5b315d46465b345d43415b6762323331325d535a5b31395d50425bb9c5c1a65d50575bb3a3eabb5d435bd6d0c5ccd5bdb6b75d3b425b70645d29',
  shiftJis: '283b474d5b315d46465b345d535a5b31395d50425b88e48e52975491be5d50575b88ea97cd97c95d435b8d9594d482cc8f9f82bf814282b182b182cd91c582bf82b782ac82c582b582bd5d52455b422b525d3b425b70645d29',
  eucKr: '283b474d5b315d46465b345d535a5b31395d50425bbdc5c1f8bcad5d50575bb9dac1a4c8af5d435bc8e620bad2b0e8bdc220b9e9c0cc20c1c1bed2b4d95d3b425b70645d29',
  big5: '283b474d5b315d46465b345d535a5b31395d50425ba950ab54beb15d50575baa4caefcae705d435bb6c2b4d1a4a4bd4cb3d3a141b36fa4e2b4d1abdcadabad6e5d3b425b70645d29',
  gbkWithWrongUtf8Declaration: '283b474d5b315d46465b345d43415b5554462d385d535a5b31395d50425bbfc2bde05d50575bd8c2eac5cda25d435bbadac6e5d6d0c5cccaa4a3acd5e2c0efcfc2b5c3ccabbcb1c1cb5d3b425b70645d29',
};

describe('SGF charset detection', () => {
  it('keeps UTF-8 (with or without a BOM)', () => {
    const text = '(;GM[1]PB[陳　奕航]PW[横塚　力];B[pd])';
    expect(decodeSgfBytes(new TextEncoder().encode(text))).toBe(text);
    expect(decodeSgfBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]))).toBe(text);
  });

  it('reads undeclared GBK Chinese', () => {
    const t = decodeSgfBytes(hex(SAMPLES.gbk));
    expect(t).toContain('PB[柯洁]');
    expect(t).toContain('PW[一子道长青]');
    expect(t).toContain('黑棋胜率');
  });

  it('honours CA[gb2312]', () => {
    expect(declaredCharset(hex(SAMPLES.gb2312Declared))).toBe('gbk');
    expect(decodeSgfBytes(hex(SAMPLES.gb2312Declared))).toContain('PB[古力]PW[常昊]');
  });

  it('reads undeclared Shift_JIS Japanese', () => {
    const t = decodeSgfBytes(hex(SAMPLES.shiftJis));
    expect(t).toContain('PB[井山裕太]PW[一力遼]');
  });

  it('reads undeclared EUC-KR Korean', () => {
    expect(decodeSgfBytes(hex(SAMPLES.eucKr))).toContain('PB[신진서]PW[박정환]');
  });

  it('reads undeclared Big5 Traditional Chinese', () => {
    expect(decodeSgfBytes(hex(SAMPLES.big5))).toContain('PB[周俊勳]PW[林海峰]');
  });

  it('ignores a CA[UTF-8] that is wrong', () => {
    expect(decodeSgfBytes(hex(SAMPLES.gbkWithWrongUtf8Declaration))).toContain('PB[柯洁]PW[芈昱廷]');
  });
});
