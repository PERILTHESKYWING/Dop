import type { ConceptText } from '../types';

/** Initiative and timing: sente, gote, double and reverse sente, tenuki, miai, forcing moves, probes, aji. */
export const TEMPO: ConceptText[] = [
  {
    id: 'sente',
    name: 'Sente',
    aliases: ['sente', 'initiative', 'forcing move', 'keep sente', 'in sente', '先手', '선수'],
    level: 'intermediate',
    short: 'A move is sente when it threatens something big enough that the opponent should answer, so you keep the initiative and choose the next big point.',
    hover: 'A move the opponent has to answer, so you keep the initiative and choose the next big point.',
    body: [
      {
        title: 'What it is',
        text: 'Sente means "first hand": after your move and the opponent\'s answer, it is your turn again. A move is sente because of its follow-up: if the opponent ignored it, your next move there would gain more than the biggest move elsewhere. "Having sente" also means simply that it is your turn with nothing urgent to answer, so you can play the largest point on the board.',
      },
      {
        title: 'Why it matters',
        text: 'In an even game the side that keeps getting to choose where to play gains a little each time. In the opening a tempo is worth roughly the biggest open point, and in the endgame sente moves come before gote moves of the same size. Joseki and endgame choices are often "a little less locally, but in sente" against "a little more, but gote".',
      },
      {
        title: 'Sente is relative',
        text: 'Whether a move is sente depends on everything else on the board. A threat worth 8 points is sente while every other move is worth less than 8, and becomes something the opponent can ignore when a 20-point move appears. That is why strong players ask "what happens if I don\'t answer?" before answering, and why the same endgame move can be sente in one game and gote in another.',
      },
      {
        title: 'The cost of forcing moves',
        text: 'Playing a sente move is not free. It removes a possibility (aji) you might have used later, uses up a ko threat, and the answer can strengthen the opponent. Strong players keep many sente moves in reserve and play them when they gain something now: before the opponent removes them, when they need a ko threat, or when the answer they force is exactly what helps their next plan.',
      },
      {
        title: 'What KataGo adds',
        text: 'A clean test of sente is the cost of ignoring: compare the lead after the opponent\'s best answer with the lead after their best move elsewhere. If playing elsewhere is clearly worse, your move was sente; if the two are about equal, it was gote.',
      },
    ],
    mistakes: [
      'Answering every move automatically, even when ignoring it costs little.',
      'Playing all your forcing moves early and losing them as ko threats and aji.',
      'Calling a move sente without asking how big its follow-up is compared with the rest of the board.',
      'Choosing a gote result locally when a sente result was only slightly smaller.',
    ],
    related: ['gote', 'double-sente', 'tenuki', 'kikashi', 'endgame', 'move-value', 'big-point'],
  },
  {
    id: 'gote',
    name: 'Gote',
    aliases: ['gote', 'lose sente', 'lost sente', 'gote move', 'in gote', '後手', '后手', '후수'],
    level: 'intermediate',
    short: 'A move is gote when it does not force an answer, so after it the opponent chooses where to play next.',
    body: [
      {
        title: 'What it is',
        text: 'Gote means "later hand". A gote move gains something (points, safety, a capture) but threatens nothing big afterwards, so the opponent can play elsewhere. A local sequence "ends in gote" for the player who makes the last move there.',
      },
      {
        title: 'Gote is not bad',
        text: 'Many of the best moves are gote: making a weak group safe, taking a large point, capturing key stones, the honte (proper move) that removes a weakness. A gote move is right when it is the biggest thing on the board. What hurts is gote that was not needed: an extra move to make sure of life, or capturing stones that were already dead.',
      },
      {
        title: 'Comparing gote and sente',
        text: 'In the endgame, a sente move worth a given amount is roughly twice as good as a gote move of the same amount, because the sente move keeps your turn. In the opening, a joseki ending in gote with a little more territory may be worse than one ending in sente, because the next big point is worth more than the difference.',
      },
      {
        title: 'How strong players think about it',
        text: 'They know which of their moves are gote and play them when they are worth it: often right after the opponent has used their sente, or when the gote move also removes the opponent\'s sente follow-up (reverse sente). They also try to make the opponent end in gote: a sequence that forces the opponent to add a move at the end is worth more than it looks.',
      },
    ],
    mistakes: [
      'Adding gote moves to groups that are already safe.',
      'Fearing gote so much that a big necessary move is skipped.',
      'Comparing a sente and a gote move by local points only.',
    ],
    related: ['sente', 'reverse-sente', 'tenuki', 'endgame', 'move-value', 'thickness'],
  },
  {
    id: 'double-sente',
    name: 'Double sente (ryou-sente)',
    aliases: ['double sente', 'ryou-sente', 'ryousente', 'ryo sente', 'ryosente', 'mutual sente', 'double sente point', '両先手', '双先手', '雙先手', '双先', '雙先', '양선수'],
    level: 'intermediate',
    short: 'A double sente point is sente for whichever side plays it, so either player can take it first and keep the initiative; it should be played as early as possible.',
    hover: 'A large point that either player can take first to gain sente.',
    body: [
      {
        title: 'What it is',
        text: 'A move is double sente (ryou-sente) when it is sente for both players: if Black plays there, White has to answer, and if White plays there, Black has to answer. Typical examples are boundary points where each side\'s hane threatens a follow-up bigger than the next move elsewhere. Whoever plays it first gains there and still keeps the turn.',
      },
      {
        title: 'Why play it early',
        text: 'A double sente move costs no tempo, so there is no reason to wait: every turn you delay is a chance for the opponent to take it first, in sente, and they gain the difference for free. That is why it comes first in the endgame order, ahead of one-sided sente moves and far ahead of gote moves of similar size. Strong players often take double sente points during the middle game, as soon as the boundary is settled enough.',
      },
      {
        title: 'Spotting it',
        text: 'Look at each boundary from both sides. Ask: if I play here, can the opponent ignore it? And if the opponent plays here, can I ignore that? When the answer is no both times, the point is double sente. Its local value may look small, but because neither side loses the turn by playing it, it is worth more than a larger gote move.',
      },
      {
        title: 'When it is not really double sente',
        text: 'Sente is relative. A point is double sente only while both follow-ups are bigger than the largest move elsewhere; when a big fight or a large gote point appears, one side may be able to ignore it, and it becomes one-sided sente or even gote. Also look at the answer you force: if it strengthens the opponent or removes your own aji, the move may be worth less than it seems.',
      },
    ],
    mistakes: [
      'Leaving a double sente point for later, so the opponent takes it first in sente.',
      'Playing a big gote move while a double sente point is still open.',
      'Calling a point double sente without checking that both follow-ups are bigger than the biggest move elsewhere.',
    ],
    related: ['sente', 'reverse-sente', 'gote', 'endgame', 'move-value'],
  },
  {
    id: 'reverse-sente',
    name: 'Reverse sente (gyaku-sente)',
    aliases: ['reverse sente', 'gyaku-sente', 'gyakusente', 'gyaku yose', 'reverse sente move', '逆先手', '逆ヨセ', '逆收', '逆收官子', '역끝내기', '역선수'],
    level: 'intermediate',
    short: 'A reverse sente move is gote for you, but it takes away a point where the opponent\'s move would have been sente, so it is worth more than an ordinary gote move.',
    hover: 'A gote move that takes away a point where the opponent\'s move would have been sente.',
    body: [
      {
        title: 'What it is',
        text: 'Many endgame points are sente for one side only. For that side the move is easy: play it when it is the right size and keep the turn. For the other side, playing there first is gote, because it threatens nothing big, but it stops the opponent\'s sente move. That defensive gote move is called reverse sente (gyaku-sente).',
      },
      {
        title: 'Why it is worth more than it looks',
        text: 'If you leave the point, the opponent can take it whenever they like and still keep the turn, so you lose its value without getting anything back. If you play it yourself, you spend a turn but save that loss. That is why a reverse sente move is usually valued at about twice a gote move of the same local size, and why it often comes before gote moves that look a little bigger.',
      },
      {
        title: 'Where it comes in the order',
        text: 'The usual endgame order is double sente first, then your own sente moves, then reverse sente and gote moves by size, with reverse sente ahead of gote moves of similar value. Keep an eye on the opponent\'s sente moves: when one of their follow-ups has grown big and nothing on the board is more urgent, taking it away is often the best use of a gote turn.',
      },
      {
        title: 'How strong players think about it',
        text: 'They look at each boundary from both sides and ask who is sente there. A point that is sente for the opponent is a liability that will be collected sooner or later, and removing it at the right moment is quiet but valuable. They also remember that reverse sente is still gote: it is right only when nothing bigger or more urgent is left.',
      },
    ],
    mistakes: [
      'Ignoring the opponent\'s sente moves, so they collect them all without losing a turn.',
      'Treating a reverse sente move as an ordinary gote move of the same local size.',
      'Playing reverse sente while a double sente point or an urgent move is still open.',
    ],
    related: ['sente', 'gote', 'double-sente', 'endgame', 'move-value'],
  },
  {
    id: 'tenuki',
    name: 'Tenuki',
    aliases: ['tenuki', 'play elsewhere', 'playing elsewhere', 'ignore', 'ignoring a move', 'ignore the move', 'te nuki', '手抜き', '手を抜く', '脱先', '脫先', '손빼기', '손뺌'],
    level: 'intermediate',
    short: 'Tenuki is playing elsewhere instead of answering the opponent\'s last move locally, because something else on the board is bigger.',
    body: [
      {
        title: 'What it is',
        text: 'Every move asks a question; you do not have to answer it. If the local threat is smaller than the biggest move elsewhere, you play elsewhere and accept the loss locally. A player who never tenukis is "led by the nose": the opponent chooses where every fight happens.',
      },
      {
        title: 'When to tenuki',
        text: 'Ask what the opponent gets if they play there again. If the worst case is a few points, or a group you can still save later, and elsewhere there is a big point or an urgent point, tenuki. If the worst case is a group dying, a big corner lost, or a cut that splits you, answer. In joseki, it is worth knowing which moves can be ignored: some sequences are designed so that one side can tenuki and come back.',
      },
      {
        title: 'Tenuki twice',
        text: 'Sometimes the opponent plays a second move in the same place and you can still ignore it, because their two moves together are still not worth more than yours elsewhere. Professional games are full of these sequences; the result is often a corner that looks lost locally but a game that is even.',
      },
      {
        title: 'What AI changed',
        text: 'Engines ignore local moves more often than traditional play did, especially in the opening and around early approach and 3-3 sequences, because they count every move against the whole board. Many old "must answer" moves turned out to be ignorable. The lesson is not to tenuki more, but to check: the cost of not answering is a number, and it can be compared with the biggest move elsewhere.',
      },
      {
        title: 'What KataGo adds',
        text: 'KataGo makes tenuki measurable: compare the lead after the best local answer with the lead after the best move elsewhere. When the difference is small, tenuki is fine; when it is large, the local move was urgent.',
      },
    ],
    mistakes: [
      'Answering every move locally out of habit.',
      'Tenuki when a group\'s life depended on the answer.',
      'Ignoring a move without knowing what the opponent\'s follow-up would be.',
    ],
    related: ['sente', 'gote', 'urgent', 'big-point', 'miai'],
  },
  {
    id: 'miai',
    name: 'Miai',
    aliases: ['miai', 'mutual alternatives', 'miai points', 'two equal points', '見合い', '见合', '見合', '맞보기', '맞보기 자리'],
    level: 'intermediate',
    // Written by XIAO (2026-10-16), fitted to the entry's shape.
    short: 'Two points that achieve the same goal. If your opponent takes one, you can use the other.',
    hover: 'Two points that achieve the same goal. If your opponent takes one, you can use the other.',
    body: [
      {
        title: 'What is miai?',
        text: 'Imagine you have two ways to connect your stones, but your opponent can block only one. If they block the first, you connect using the second. Your opponent cannot stop both with a single move!\n\nThese two points are miai. They give you alternative ways to achieve the same result, whether that means making eyes, connecting stones, escaping, or securing a strategic advantage.',
      },
      {
        title: 'Why does it matter?',
        text: 'Miai gives you flexibility. When two points can do the same job, you often don\'t need to play either one immediately. Instead, you can play elsewhere and let your opponent commit first.\n\nFor example, in a standard straight-four life-and-death shape, the two vital eye-making points are miai. If the attacker occupies one, the defender can play the other to make two eyes and live.\n\nMiai also appears across the whole board. Two important areas might be miai if taking one allows your opponent to take the other. Recognising this can help you avoid unnecessary defensive moves and spend your turn somewhere more valuable.',
      },
      {
        title: 'Can miai be broken?',
        text: 'Yes! Miai is not invincible.\n\nYour opponent might find a move that threatens both points simultaneously, leaving you unable to secure either one. They might also remove one of the alternatives through a forcing sequence.\n\nWhenever you rely on miai, ask yourself: **Can my opponent threaten both options at once, or will one still work after they play?**',
      },
      {
        title: 'How strong players use miai',
        text: 'Strong players look for miai before committing to a move. They ask whether a group already has two ways to live, whether their stones have two ways to connect, or whether two strategic points provide equivalent opportunities.\n\nRecognising miai helps you distinguish between a move that is genuinely necessary and one you can safely postpone. However, don\'t assume two points are miai just because they look similar. Check that the alternative really achieves the same goal against your opponent\'s best response.',
      },
      {
        title: 'Diagram example: Straight four',
        text: 'In the standard straight-four shape along the edge, the two middle points are miai for the defender. If the attacker takes one vital point, the defender plays the other to make two eyes and live.\n\nThe important lesson is that the defender does not need to occupy both points. Having access to either one is enough.',
      },
      {
        title: 'Remember',
        text: 'Miai is the power of having a second option. You don\'t always need to play the move yourself; sometimes, knowing that your alternative works is already enough.',
      },
    ],
    mistakes: [
      'Playing too early: defending one point when the other already guarantees the same result.',
      'Missing the follow-up: letting your opponent take one point, then failing to secure the other.',
      'Assuming miai without reading: overlooking a sequence that threatens both options or makes the remaining point ineffective.',
    ],
    related: ['bamboo-joint', 'eyes', 'tenuki', 'sente', 'endgame'],
  },
  {
    id: 'kikashi',
    name: 'Kikashi',
    aliases: ['kikashi', 'forcing exchange', 'forcing moves', 'kikasu', '利かし', '利き', '先手便宜', '활용'],
    level: 'advanced',
    short: 'Kikashi is a forcing move that the opponent must answer, played to gain something and then left behind, often to be sacrificed later.',
    body: [
      {
        title: 'What it is',
        text: 'A kikashi is a sente exchange that helps your plan: it makes your group safer, prepares a cut, takes away an eye, or sets up a later ladder or ko. The stone you play is not meant to live by itself: it has done its job once the opponent answers, and it can be given up later.',
      },
      {
        title: 'Good kikashi and bad',
        text: 'A good kikashi gains more than it gives. A bad one (often called aji keshi, erasing your own aji) makes the opponent\'s shape solid, removes a ko threat or a later tesuji you could have used, or gives the opponent a stone that helps them in the coming fight. The same exchange can be good at one moment and bad at another.',
      },
      {
        title: 'Timing',
        text: 'Play a kikashi when it is about to disappear (the opponent will remove it with their next move), when you need its effect right now, or just before a fight in which the answering stone will be in the opponent\'s way. Keep it otherwise: unused forcing moves are ko threats and options.',
      },
      {
        title: 'How strong players think about it',
        text: 'They count forcing moves as resources, like money in the bank. A strong player\'s position often has several kikashi they never play, because playing them would end the uncertainty that the opponent has to respect. When they do play one, the answer usually puts an opponent stone on a useless point.',
      },
    ],
    mistakes: [
      'Playing forcing moves just because they are sente, removing your own aji.',
      'Trying to save a kikashi stone after it has done its job.',
      'Forcing in a way that strengthens the group you want to attack.',
    ],
    related: ['sente', 'aji', 'probe', 'sacrifice', 'ko-threats'],
  },
  {
    id: 'probe',
    name: 'Probe',
    aliases: ['probe', 'probing', 'probing move', 'test the response', 'yosumi', 'yōsumi', 'ヨウスミ', '様子見', '试应手', '試應手', '응수타진'],
    level: 'advanced',
    short: 'A probe asks the opponent a question before you commit: each answer gives you something different, and you choose your plan after seeing it.',
    body: [
      {
        title: 'What it is',
        text: 'Some decisions depend on how the opponent will answer a forcing move. Instead of guessing, you play the forcing move first. If they answer one way, you have gained in one area and choose plan A; if the other way, you have gained something else and choose plan B. A good probe leaves the opponent no answer that is good for them in every follow-up.',
      },
      {
        title: 'Classic situations',
        text: 'Probing at the 3-3 point or another corner point before deciding whether to invade or reduce; asking with a contact move before choosing which side to settle on; a move that the opponent can answer from either side, each side spoiling a different part of their position.',
      },
      {
        title: 'Timing',
        text: 'Probe before you decide, not after. Once you have committed to a plan (for example, by building a wall), the opponent can answer the probe in the way that hurts that plan. Probe while the opponent still has to worry about several things at once.',
      },
      {
        title: 'How strong players think about it',
        text: 'They look for moves that keep their options and narrow the opponent\'s. A probe is the opposite of a heavy move: it creates information and flexibility, and it is often a stone you are happy to sacrifice later.',
      },
    ],
    mistakes: [
      'Probing after committing, so the opponent answers in the way that hurts your plan.',
      'Probing where both answers are good for the opponent.',
      'Probing with a move that was your best ko threat.',
    ],
    related: ['kikashi', 'aji', 'sente', 'light-and-heavy'],
  },
  {
    id: 'aji',
    name: 'Aji',
    aliases: ['aji', 'latent potential', 'bad aji', 'aftertaste', 'aji keshi', 'ajikeshi', '味', '味消し', '余味', '餘味', '消劫', '뒷맛'],
    level: 'advanced',
    short: 'Aji ("taste") is the potential left in a position: weaknesses and possibilities, like a cutting point or dead stones that may come back to life, that can be used later.',
    hover: 'Weaknesses and possibilities left in a position, like a cutting point, that can be used later.',
    body: [
      {
        title: 'What it is',
        text: 'A position is rarely fully settled. A wall with a cutting point, a corner with a 3-3 invasion still possible, dead stones that reduce the liberties of the stones around them: all are aji. Aji can be good for you (possibilities in the opponent\'s area) or bad (weaknesses in your own).',
      },
      {
        title: 'Why it matters',
        text: 'Aji is how small weaknesses become big ones. A cutting point that is harmless now becomes decisive when a fight breaks out nearby. Dead stones inside the opponent\'s area may give ko threats or make an invasion work. Players who leave lots of aji in their own position lose games late, when all those possibilities are used at once.',
      },
      {
        title: 'Keeping and using aji',
        text: 'Do not play out your aji early; resolving it takes away the opponent\'s worry and usually strengthens them (aji keshi, "erasing the aji"). Use it when it gains something concrete: as a ko threat, to support an invasion or a capturing race, or when the opponent is about to remove it. In your own position, fix bad aji when a fight approaches it, not before, unless the fix also does something else.',
      },
      {
        title: 'How strong players think about it',
        text: 'They count aji as part of the score: a "secure" territory with a 3-3 invasion still possible is not secure. They leave their opponent several small problems instead of solving them, so that a later fight can use two of them at once. And they play the honte (proper move) that removes their own bad aji at the moment it is worth the most.',
      },
      {
        title: 'What KataGo adds',
        text: 'Aji shows up in KataGo\'s ownership as values that are not quite settled: dead stones owned by the opponent at 80% rather than 99%, or a territory that is 70% yours. Those uncertain points are where the aji is.',
      },
    ],
    mistakes: [
      'Playing forcing moves early that remove your own aji (aji keshi).',
      'Leaving bad aji in your own position until the opponent uses several weaknesses at once.',
      'Treating a territory with aji as solid points when counting.',
    ],
    related: ['kikashi', 'probe', 'ko-threats', 'dead-group', 'thickness', 'cutting-and-connecting'],
  },
];
