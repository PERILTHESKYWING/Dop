import type { ConceptText } from '../types';

/** Capturing techniques and local fighting. */
export const TACTICS: ConceptText[] = [
  {
    id: 'ladder',
    name: 'Ladder',
    aliases: ['ladder', 'ladders', 'ladder breaker', 'ladder break', 'shicho', 'shichou', 'shichō', 'シチョウ', 'シチョウアタリ', '征子', '引征', '扭羊头', '축', '축머리'],
    level: 'beginner',
    short: 'A ladder is a chase in which the stones are kept in atari at every move, zig-zagging across the board until they hit the edge or a friendly stone; a stone on the path (a ladder breaker) decides it.',
    body: [
      {
        title: 'What it is',
        text: 'A chain with two liberties is put in atari; it extends to its last liberty and again has two; the attacker gives atari from the other side, and so on. The chain runs diagonally across the board in a staircase. If the path reaches the edge or one of the attacker\'s stones, the whole chain is captured. If it reaches one of the runner\'s own stones (a ladder breaker), it connects, gets more liberties, and escapes.',
      },
      {
        title: 'Why it matters',
        text: 'A ladder captures a cutting stone without fighting. But a failed ladder is a disaster: the chasing stones are left with cutting points along the whole diagonal, and the opponent gets a double atari almost anywhere. "If you don\'t know ladders, don\'t play Go" is an old Japanese proverb for good reason. Many joseki depend on whether a ladder works, so the stones in the far corner change what is correct in the near one.',
      },
      {
        title: 'How to read it',
        text: 'Follow the diagonal from the chased stone toward where it runs, and look at a band about two lines wide. Any of the runner\'s stones in that band can break the ladder; the attacker\'s stones there help. Stones that touch the path from the side also matter, because the runner may capture a chasing stone in atari on the way. When in doubt, play it out in your head move by move; it is long but simple.',
      },
      {
        title: 'Ladder breakers as strategy',
        text: 'A ladder breaker is often a double-purpose move: it breaks a ladder and also approaches a corner or extends on a side. The opponent then has to answer the ladder threat (usually by capturing the stone another way, which costs a move) or let the cutting stone out. Strong players look for these: one move that makes a ladder fail and does something useful elsewhere is very efficient.',
      },
      {
        title: 'What KataGo adds',
        text: 'KataGo reads ladders well, and its best line plays the chase out to the end. Trust that line more than the ownership map just after the first atari: a chased stone often still looks undecided there, because a later ladder breaker could rescue it. If a joseki you know needs a ladder, ask KataGo for the line before you play it.',
      },
    ],
    mistakes: [
      'Starting a ladder without checking the whole diagonal for breakers.',
      'Running out of a ladder that works, adding more stones to lose.',
      'Forgetting that a chasing stone can itself be in atari during the ladder.',
      'Playing a joseki that relies on a ladder when the ladder is bad.',
    ],
    related: ['liberties', 'net', 'cutting-and-connecting', 'joseki'],
  },
  {
    id: 'net',
    name: 'Net (geta)',
    aliases: ['net', 'geta', 'ゲタ', '枷', '枷吃', '장문'],
    level: 'beginner',
    short: 'A net captures stones with a loose move that blocks every escape route at once, without giving atari; it works whatever stones lie far away.',
    body: [
      {
        title: 'What it is',
        text: 'Instead of chasing with ataris, you play one move a little away from the stones, usually diagonally in front of them, so that every way out runs into your stones. The stones still have two liberties after the net, but whichever way they push, you block and they are in atari with nowhere to go.',
      },
      {
        title: 'Why it matters',
        text: 'A net does not depend on ladder breakers. When the ladder fails, a net is often the only way to capture a cutting stone. It is also quieter: the opponent gets no forcing moves against a long ladder path, and your stones end up compact.',
      },
      {
        title: 'How to use it',
        text: 'Look at the stone\'s liberties and the directions it can run. The net point is usually where those directions meet, one step away. Check every push: after each one you must be able to block, and the blocking stones must not be in atari themselves. A net works best against one or two stones with few liberties; against a larger chain, the pushes often create cutting points in the net.',
      },
      {
        title: 'How strong players think about it',
        text: 'They prefer the net to the ladder when both work, because the net leaves no ladder-breaker tricks and no long diagonal of weaknesses. They also check the cost: a net is a gote move, so if the stone is not important, they may let it run and play bigger moves.',
      },
    ],
    mistakes: [
      'Playing the net too far away, so the stone squeezes out between your stones.',
      'Forgetting that the netted stones can capture a weak netting stone and escape.',
      'Using a net (gote) to capture a stone that did not matter.',
    ],
    related: ['ladder', 'liberties', 'tesuji'],
  },
  {
    id: 'snapback',
    name: 'Snapback',
    aliases: ['snapback', 'snap back', 'snap-back', 'uttegaeshi', 'ウッテガエシ', '打って返し', '倒扑', '倒撲', '환격'],
    level: 'beginner',
    short: 'A snapback is a sacrifice: you let one stone be captured, and the capturing stones are left in atari, so you recapture more stones at the same point.',
    body: [
      {
        title: 'What it is',
        text: 'You play a stone into a spot where it can be captured at once. When the opponent captures it, their capturing chain has only one liberty: the point where your stone was. You play there again and capture the whole chain. It is not a ko because you take back more than one stone, so the ko rule does not apply.',
      },
      {
        title: 'How to see it',
        text: 'Look for opponent chains with two liberties where one liberty is a point that, if they filled it, would leave them with only the other. The throw-in on that point is the snapback. It often appears on the edge and in the corner, where chains have few liberties, and it combines with shortage of liberties.',
      },
      {
        title: 'Defending',
        text: 'If a snapback threatens, do not capture the thrown-in stone; connect or add a liberty in another way, even if it costs a stone or two. Sometimes the right answer is to give up the stones before the snapback takes more.',
      },
      {
        title: 'Related tesuji',
        text: '"Connect and die" (oiotoshi) is a close relative: the opponent\'s stones are in atari, connecting them gives only one liberty again, and you capture the larger chain. Both rely on liberties disappearing as the opponent captures or connects.',
      },
    ],
    mistakes: [
      'Capturing a thrown-in stone without checking how many liberties your capturing chain has left.',
      'Calling a snapback a ko: in a snapback more than one stone comes back.',
    ],
    related: ['sacrifice', 'tesuji', 'liberties', 'ko'],
  },
  {
    id: 'cutting-and-connecting',
    name: 'Cutting and connecting',
    aliases: ['cut', 'cutting', 'cutting point', 'cutting points', 'connect', 'connection', 'connecting', 'peep', 'wedge', 'solid connection', 'cutting stones', 'key stones', 'kiri', 'tsugi', 'nozoki', 'kaname ishi', 'kasu ishi', '切り', '継ぎ', 'ノゾキ', '要石', 'カス石', '断', '切断', '粘', '连接', '連接', '刺', '棋筋', '废子', '끊음', '연결', '이음', '들여다보기'],
    level: 'beginner',
    short: 'A cut separates the opponent\'s stones into groups that must each look after themselves; a connection keeps your stones as one unit. Most fights are about which cuts matter.',
    body: [
      {
        title: 'What it is',
        text: 'Two chains that could be joined by one move have a cutting point. If the opponent plays there, you have two groups to take care of instead of one. Ways to connect: the solid connection (no weakness at all), the hanging connection or tiger\'s mouth (more flexible, can be forced), the bamboo joint (two ways to connect, miai), the diagonal (cut only if the opponent gets both points beside it) and the one-point jump (can be peeped or wedged). Both are usually fine.',
      },
      {
        title: 'When a cut is good',
        text: 'A cut is good when the two pieces it creates are each weaker than your cutting stone. If you can attack both pieces, or capture one, the cut wins. If the opponent can sacrifice one piece and use it to surround your cutting stone, the cut only made them stronger. Before cutting, ask: after the cut, whose stones are the weakest on the board?',
      },
      {
        title: 'Key stones and waste stones',
        text: 'Stones that separate two of the opponent\'s groups are key stones (kaname ishi); losing them reunites the opponent. Stones that are just stuck on the outside are waste stones (kasu ishi) that can be given up. Save key stones; sacrifice waste stones for tempo. Many mistakes in fighting come from saving the wrong stones.',
      },
      {
        title: 'Peeps and how to answer',
        text: 'A peep threatens to cut. "Even a fool connects against a peep" says the proverb, and usually connecting is right. Strong players still check: if the cut would not hurt, they may answer elsewhere or counter-peep. And they peep only when the forced connection does not help the opponent: a peep that makes their shape solid just removes your own aji.',
      },
      {
        title: 'How strong players think about it',
        text: 'They look at the cutting points of both sides at the start of every fight. A move that protects your cut while threatening the opponent\'s is often the best move on the board. They do not connect everything solidly, though: a hanging connection or a jump that leaves a harmless cutting point is faster, and speed matters.',
      },
    ],
    mistakes: [
      'Cutting when both resulting opponent groups are strong, leaving your cutting stone to be swallowed.',
      'Saving waste stones and losing tempo, or abandoning key stones.',
      'Connecting solidly everywhere: slow, and the opponent gets the big points.',
      'Peeping at a point where the connection improves the opponent\'s shape.',
    ],
    related: ['liberties', 'tigers-mouth', 'bamboo-joint', 'sacrifice', 'weak-group', 'aji'],
  },
  {
    id: 'sacrifice',
    name: 'Sacrifice',
    aliases: ['sacrifice', 'sacrifice stones', 'giving up stones', 'throw-in', 'throw in', 'sute ishi', 'horikomi', '捨て石', 'ホウリコミ', '弃子', '棄子', '弃子争先', '舍小就大', '扑', '사석', '먹여치기', '버림돌'],
    level: 'intermediate',
    short: 'A sacrifice gives up stones on purpose to gain something bigger: sente, a wall, a better shape, liberties or eyes for the stones that matter.',
    body: [
      {
        title: 'What it is',
        text: 'Not every stone needs to live. Stones that have done their job (as forcing moves or as bait) can be given away. The opponent spends moves capturing them, and you use those moves elsewhere or use the captured stones\' squeeze to build a wall. The classic Chinese principles say: "sacrifice stones to take sente" (弃子争先), "give up the small to take the big" (舍小就大) and "when in danger, give up stones" (逢危须弃).',
      },
      {
        title: 'Common forms',
        text: 'The throw-in: a stone played inside the opponent\'s shape to be captured, which makes an eye false or shortens liberties. The squeeze: sacrifice a stone or two with atari after atari, so the opponent\'s stones end up in a clumsy lump and you get a wall in sente. Giving up cutting stones that have become waste stones. And the proverb "add a second stone before you sacrifice": two stones given up can squeeze more forcing moves out of the opponent than one.',
      },
      {
        title: 'Deciding what to give up',
        text: 'Ask what each group of stones is worth now: points, cutting power, eyes. Stones that are small and weak are candidates; stones that keep the opponent cut apart are not. A good sacrifice turns a fight you would lose into one where you lose a few points and gain tempo or thickness worth more.',
      },
      {
        title: 'How strong players think about it',
        text: 'Strong players are flexible about which stones are "theirs". When a group is heavy and in trouble, they look first for a way to sacrifice part of it and keep the rest light. Engines push this further than humans did: KataGo gives up cutting stones or a corner readily when the outside result or the tempo is worth more by its count.',
      },
    ],
    mistakes: [
      'Saving every stone, so the group gets heavy and the opponent attacks it for profit.',
      'Sacrificing key cutting stones instead of waste stones.',
      'Giving up stones without getting anything back (no sente, no wall).',
    ],
    related: ['snapback', 'tesuji', 'light-and-heavy', 'kikashi', 'cutting-and-connecting', 'sabaki'],
  },
  {
    id: 'tesuji',
    name: 'Tesuji',
    aliases: ['tesuji', 'skilful move', 'clever move', 'tactic', 'tactics', 'shortage of liberties', 'damezumari', 'connect and die', 'oiotoshi', 'squeeze', 'shibori', 'under the stones', 'ishi no shita', "crane's nest", 'clamp', '手筋', 'ダメヅマリ', '追い落とし', 'シボリ', '石の下', '鶴の巣ごもり', '接不归', '接不歸', '倒脱靴', '乌龟不出头', '金鸡独立', '大头鬼', '맥', '수근', '촉촉수'],
    level: 'intermediate',
    short: 'A tesuji is the sharp local move that makes the most of a position: it captures, saves, connects or cuts in a way ordinary moves cannot.',
    body: [
      {
        title: 'What it is',
        text: 'Tesuji are patterns of efficient play in close fights: the throw-in, the snapback, connect-and-die, the squeeze, the placement, the clamp, the wedge, the hane at the head of two stones, "under the stones" (playing again where stones were just captured) and the crane\'s nest. Each exploits shortage of liberties, a weak connection or a false eye.',
      },
      {
        title: 'Why it matters',
        text: 'One tesuji can be worth more than many good shape moves: it saves a group that looked dead or captures key stones. More important, knowing tesuji changes how you judge positions: you see that a cutting point really is a weakness, that a group with one eye really can live, or that a race really is lost.',
      },
      {
        title: 'How to find them',
        text: 'Look for the weaknesses first: chains with few liberties, cutting points, eyes that could be false, stones near the edge. Then try the forcing moves: atari, throw-in, placement. Tesuji are usually moves that look strange (into self-atari, on the first line, in the middle of the opponent\'s shape) and that the opponent cannot answer well whichever way they reply.',
      },
      {
        title: 'How strong players think about it',
        text: 'They solve problems every day so that the patterns come without reading, and they read the tesuji before the fight, not during it: a tesuji is often the reason a whole-board plan works. They also know the reverse: if the opponent has no weaknesses, no clever move will create one.',
      },
    ],
    mistakes: [
      'Playing a "clever" move when a simple strong move was enough.',
      'Reading only your own tesuji and missing the opponent\'s answer.',
      'Looking for tesuji where there are no weaknesses to work with.',
    ],
    related: ['snapback', 'sacrifice', 'liberties', 'life-and-death', 'capturing-race'],
  },
];
