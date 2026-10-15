import type { ConceptText } from '../types';

/** The endgame: kinds of moves, how to value them, how to count the game. */
export const ENDGAME: ConceptText[] = [
  {
    id: 'endgame',
    name: 'Endgame',
    aliases: ['endgame', 'end game', 'yose', 'boundary plays', 'double sente', 'reverse sente', 'one-sided sente', 'single sente', 'gote endgame', 'first line hane', 'dame', 'filling dame', 'ヨセ', '両先手', '逆ヨセ', '片先手', 'ダメ', '官子', '收官', '双先', '單先', '单先', '逆收', '逆收官子', '끝내기', '양선수', '역끝내기', '공배'],
    level: 'intermediate',
    short: 'The endgame is fixing the boundaries between territories; play double sente first, then sente moves, then reverse sente and gote moves, each in order of size.',
    body: [
      {
        title: 'Kinds of endgame moves',
        text: 'Double sente: sente for whichever side plays it, so it should be played as soon as possible. One-sided sente: sente for one side only; for the other side, playing there is gote and is called reverse sente, because it takes away the opponent\'s sente move. Gote: neither side keeps sente afterwards. Dame: neutral points worth nothing under territory scoring (and decided by parity under area scoring), filled last.',
      },
      {
        title: 'The order',
        text: 'Double sente first, because whoever gets it gains without losing tempo. Then your one-sided sente moves, as long as their follow-up is bigger than what the opponent would get by ignoring them. Reverse sente is worth about twice a gote move of the same local count, so a reverse sente of a few points comes before a gote move of slightly more. Among gote moves, the largest first.',
      },
      {
        title: 'Typical moves',
        text: 'Hane and connect on the first or second line, the descent that threatens to go further, the monkey jump along the first line under a second-line group, and the moves that capture or rescue cutting stones. Many of these are sente for one side only; recognising which side gets sente is half of the endgame.',
      },
      {
        title: 'How strong players think about it',
        text: 'They count each candidate (see move value) and keep a mental list of the largest moves. They also look for endgame tesuji: a throw-in or placement that turns a gote boundary move into sente, or makes a group need an extra move inside. And they know that a few points of endgame is often the margin in close games: a 1-point mistake decides many games.',
      },
      {
        title: 'What KataGo adds',
        text: 'KataGo\'s score lead makes endgame values measurable: the value of a move is the difference between the lead after you play it and the lead after the opponent plays there. The same reads show whether ignoring a move is costly (sente) or not (gote): compare the lead after the best answer with the lead after the best move elsewhere.',
      },
    ],
    mistakes: [
      'Playing a big gote move while a double sente or sente move is still open.',
      'Answering the opponent\'s gote endgame move as if it were sente.',
      'Comparing sente and gote moves by their local count only.',
      'Filling dame while real moves are left.',
    ],
    related: ['move-value', 'sente', 'gote', 'counting', 'miai'],
  },
  {
    id: 'move-value',
    name: 'Counting move values',
    aliases: ['move value', 'value of a move', 'how big is this move', 'how many points', 'deiri', 'miai counting', 'swing', 'counting endgame', 'endgame value', '出入り', '出入计算', '出入計算', '官子价值', '目数计算', '끝내기 계산'],
    level: 'advanced',
    short: 'A move\'s value is the difference between the result if you play there and the result if the opponent plays there; sente moves keep their full value, gote moves are compared at about half.',
    body: [
      {
        title: 'The swing (deiri)',
        text: 'Count the local result twice: once after your best move there (and the natural answers), once after the opponent\'s best move there. The difference is the swing, called deiri in Japanese counting (出入り). If Black gets 5 points more locally by playing first and White gets 3 more by playing first, the swing is 8 points.',
      },
      {
        title: 'Gote and sente values',
        text: 'Traditional counting gives a gote move its full swing ("an 8-point gote move") and a sente move its gain (what the sente sequence gains compared with the opponent playing there first). Because the sente move keeps your turn, a sente move counted as N is worth about as much as a gote move counted as 2N. "Miai counting" divides gote values by two so that sente and gote can be compared directly; both systems give the same order of play.',
      },
      {
        title: 'Follow-ups and probabilities',
        text: 'When the local result after a move is not final (for example, there is a further sente hane for the same side), count the position after the most likely continuation, and give half value to a gote follow-up that either side might get. Kos count at about a third of their swing per move. These rules are approximations, but they rank moves correctly in almost all practical endgames.',
      },
      {
        title: 'How strong players think about it',
        text: 'They do not count everything precisely; they count the four or five largest candidates and play the biggest, re-checking as the board changes. They also remember that sente is relative: a move is sente only while its follow-up is bigger than the biggest gote move left.',
      },
      {
        title: 'What KataGo adds',
        text: 'KataGo measures the swing directly: the lead after your move there against the lead after the opponent\'s move there. That number includes follow-ups and the tempo, so it is a good check on hand counting. When hand counting and KataGo disagree a lot, there is usually a hidden follow-up or a weakness that one side can use.',
      },
    ],
    mistakes: [
      'Mixing the two counting conventions and comparing a gote swing with a miai value.',
      'Forgetting the follow-up: a move that threatens a further sente move is bigger than its immediate gain.',
      'Counting only your own gain and not what the opponent would get by playing there first.',
    ],
    related: ['endgame', 'sente', 'gote', 'counting', 'ko'],
  },
  {
    id: 'counting',
    name: 'Counting and positional judgment',
    aliases: ['counting', 'count', 'count the score', 'counting the score', 'positional judgment', 'positional judgement', 'who is ahead', 'am i ahead', 'am i winning', 'score estimate', 'keisei handan', 'area scoring', 'territory scoring', 'komi', '形勢判断', '形势判断', '形勢判斷', '数目', '數目', '点目', '数子', '贴目', '형세판단', '계가', '덤'],
    level: 'intermediate',
    short: 'Counting means estimating both sides\' territory plus komi during the game, so you know whether to play safe or take risks.',
    body: [
      {
        title: 'Why count',
        text: 'The right move depends on the score. If you are ahead, simple safe moves win: settle weak groups, avoid kos, reduce instead of invading. If you are behind, you need complications: invade, start fights, keep aji alive. Players who never count play the same way in both situations, and lose won games and miss chances in lost ones.',
      },
      {
        title: 'How to count during a game',
        text: 'Count secure territory for each side, region by region. Give half credit to areas that are likely but not sure, and nothing to open areas. Subtract dead stones as the opponent\'s. Add komi to White. Under territory scoring also count captured stones; under area scoring count stones on the board plus territory. The two methods almost always agree within a point, so pick one and use it consistently.',
      },
      {
        title: 'When to count',
        text: 'At natural pauses: after the opening when the corners are settled, after a big fight ends, before choosing between a safe and a risky plan, and when the endgame starts. A quick count takes a minute and saves many games.',
      },
      {
        title: 'How strong players think about it',
        text: 'They count roughly but often, and they count the opponent\'s potential too: an open framework is worth something, a weak group is a liability. They know their count is only a guide, and they look for "who has more weaknesses" alongside "who has more points".',
      },
      {
        title: 'What KataGo adds',
        text: 'KataGo\'s score lead is a positional judgment from the whole board, including weaknesses and potential that a simple count misses. Comparing your own count with KataGo\'s lead shows what you misjudged: usually a group you thought safe, or a framework you counted as territory.',
      },
    ],
    mistakes: [
      'Never counting, and playing the same style whether ahead or behind.',
      'Counting frameworks as territory.',
      'Forgetting komi.',
      'Taking risks when ahead because the position "feels" close.',
    ],
    related: ['territory', 'endgame', 'move-value', 'dead-group', 'seki'],
  },
];
