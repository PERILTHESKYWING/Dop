/**
 * Decode SGF bytes into text. Many SGF files are not UTF-8: Chinese servers and
 * editors write GB2312/GBK, Japanese ones Shift_JIS, Korean ones EUC-KR, and the CA[]
 * property is often missing or wrong. Valid UTF-8 wins; otherwise the declared charset
 * if it decodes cleanly; otherwise the legacy encoding whose result looks most like
 * real text.
 */

const LEGACY = ['gb18030', 'big5', 'shift_jis', 'euc-kr', 'euc-jp', 'windows-1252'];

const ALIASES: Record<string, string> = {
  utf8: 'utf-8',
  'utf-8': 'utf-8',
  gb2312: 'gbk',
  gbk: 'gbk',
  gb18030: 'gb18030',
  'euc-cn': 'gbk',
  cp936: 'gbk',
  big5: 'big5',
  'big5-hkscs': 'big5',
  sjis: 'shift_jis',
  'shift-jis': 'shift_jis',
  shift_jis: 'shift_jis',
  'x-sjis': 'shift_jis',
  cp932: 'shift_jis',
  'windows-31j': 'shift_jis',
  'euc-jp': 'euc-jp',
  'euc-kr': 'euc-kr',
  cp949: 'euc-kr',
  'ks_c_5601-1987': 'euc-kr',
  'iso-8859-1': 'windows-1252',
  latin1: 'windows-1252',
};

function tryDecode(bytes: Uint8Array, label: string, fatal = false): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

/** The CA[] property, read from the ASCII bytes of the file head. */
export function declaredCharset(bytes: Uint8Array): string | null {
  let head = '';
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) head += bytes[i] < 0x80 ? String.fromCharCode(bytes[i]) : ' ';
  const m = /CA\s*\[\s*([^\]\s]+)\s*\]/i.exec(head);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  return ALIASES[raw] ?? raw;
}

/*
 * Characters that are common in real text (and in Go records), per script. A wrong
 * legacy decoding still produces valid CJK characters, but mostly rare ones, so
 * counting common characters tells the encodings apart.
 */
const COMMON_HANZI =
  '的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父强步完革深区即求品士转量空甚众技轻程告江语英基派满式李息写呢识极令黄德收脸钱党倒未持取设始版双历越史商千片容研像找友孩站广改议形委早房音火际则首单据导影失拿网香似斯专石若兵弟谁校读志飞观争究包组造落视济喜离虽坐集编宝谈府拉黑且随格尽讲布杀微怕母调局根曾准团段终乐切级克精哪官示冷域胜负棋盘贴劫围赛杯届冠亚优势率输赢让番' +
  '這個們來會說時對國學後麼為開發經動現還過長將與體當實點間問題應無頭見門車話從機業義電樣氣東關戰論黨區級盤勝負圍賽屆優勢輸贏讓' +
  '黒碁勝番局段目手打終盤布石定石置先後半中押';
const COMMON_HANGUL =
  '이다는의에가을를하고지서기로으한대사도리자수어나게주아인일해적들시정상부여전만과제있것보소구성요우장경면국동라원되내거않없할그러학오조신연비때와문생야개계선모식실방세마공저금관화간업발위무물중행용단결음영치까등속체분운불좋했았었겠습니요네흑백승패집급돌판진박환김최민준호현재석훈명철기덤반초종';

let commonSet: Set<number> | null = null;
function common() {
  if (!commonSet) {
    commonSet = new Set<number>();
    for (const ch of COMMON_HANZI + COMMON_HANGUL) commonSet.add(ch.codePointAt(0)!);
  }
  return commonSet;
}

/** Higher is more plausible: common CJK/Hangul characters and kana score, mojibake costs. */
export function textScore(s: string): number {
  const set = common();
  let score = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) continue; // ASCII is neutral: every candidate decodes it the same way
    if (c === 0xfffd) score -= 30;
    else if (set.has(c)) score += 4;
    else if (c >= 0x3041 && c <= 0x309f) score += 4; // hiragana: only real Japanese has lots of it
    else if (c >= 0x30a0 && c <= 0x30ff) score += 2; // katakana
    else if (c >= 0x4e00 && c <= 0x9fff) score += 0.5; // other CJK ideographs
    else if (c >= 0xac00 && c <= 0xd7af) score += 0.5; // other Hangul syllables
    else if (c >= 0x3000 && c <= 0x303f) score += 1; // CJK punctuation (incl. the ideographic space)
    else if (c >= 0xff01 && c <= 0xff5e) score += 1; // full-width ASCII
    else if (c >= 0xff61 && c <= 0xff9f) score -= 3; // half-width katakana: classic mojibake
    else if (c >= 0xe000 && c <= 0xf8ff) score -= 5; // private use area
    else if (c <= 0x24f) score -= 2; // Latin-1/Latin Extended in a CJK file
    else if (c >= 0x2500 && c <= 0x25ff) score -= 2; // box drawing and shapes
    else score -= 1;
  }
  return score;
}

export function decodeSgfBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return tryDecode(bytes.subarray(3), 'utf-8') ?? '';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return tryDecode(bytes.subarray(2), 'utf-16le') ?? '';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return tryDecode(bytes.subarray(2), 'utf-16be') ?? '';
  const utf8 = tryDecode(bytes, 'utf-8', true);
  if (utf8 !== null) return utf8;
  const declared = declaredCharset(bytes);
  if (declared && declared !== 'utf-8') {
    const t = tryDecode(bytes, declared, true);
    if (t !== null) return t;
  }
  let best = tryDecode(bytes, 'utf-8') ?? '';
  let bestScore = textScore(best);
  const seen = new Set<string>();
  for (const label of [declared, ...LEGACY]) {
    if (!label || label === 'utf-8' || seen.has(label)) continue;
    seen.add(label);
    const t = tryDecode(bytes, label);
    if (t === null) continue;
    // The declared charset gets a small head start on ties.
    const sc = textScore(t) + (label === declared ? 5 : 0);
    if (sc > bestScore) {
      best = t;
      bestScore = sc;
    }
  }
  return best;
}
