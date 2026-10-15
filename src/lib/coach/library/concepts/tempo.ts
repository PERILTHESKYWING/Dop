import type { ConceptText } from '../types';

/** Initiative and timing: sente, gote, tenuki, miai, forcing moves, probes, aji. */
export const TEMPO: ConceptText[] = [
  {
    id: 'sente',
    name: 'Sente',
    aliases: ['sente', 'initiative', 'forcing move', 'keep sente', 'in sente', '先手', '선수'],
    level: 'intermediate',
    short: 'A move is sente when it threatens something big enough that the opponent should answer, so you keep the initiative and choose the next big point.',
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
        text: 'A clean test of sente is the cost of ignoring: compare the lead when the opponent answers your move with the lead when they play elsewhere instead. If ignoring costs more than the biggest move elsewhere is worth, the move was sente. Kami runs exactly this comparison when it says a move is sente.',
      },
    ],
    mistakes: [
      'Answering every move automatically, even when ignoring it costs little.',
      'Playing all your forcing moves early and losing them as ko threats and aji.',
      'Calling a move sente without asking how big its follow-up is compared with the rest of the board.',
      'Choosing a gote result locally when a sente result was only slightly smaller.',
    ],
    related: ['gote', 'tenuki', 'kikashi', 'endgame', 'move-value', 'big-point'],
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
    related: ['sente', 'tenuki', 'endgame', 'move-value', 'thickness'],
  },
  {
    id: 'tenuki',
    name: 'Tenuki',
    aliases: ['tenuki', 'play elsewhere', 'playing elsewhere', 'ignoring a move', 'ignore the move', 'te nuki', '手抜き', '手を抜く', '脱先', '脫先', '손빼기', '손뺌'],
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
        text: 'Kami measures tenuki directly: it compares the lead after the local answer with the lead after the best move elsewhere. When the difference is small, tenuki was fine; when it is large, the local move was urgent.',
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
    short: 'Two points are miai when they do the same job, so if the opponent takes one you take the other; neither needs to be played until the opponent touches one.',
    body: [
      {
        title: 'What it is',
        text: 'Miai means "seeing each other". A group with two ways to make its second eye, two ways to connect, or two points to extend to has miai: the opponent cannot stop both with one move. So you do not need to play either now; you keep the move for elsewhere and answer only when the opponent takes one of the two.',
      },
      {
        title: 'Why it matters',
        text: 'Miai saves tempo. Recognising that your group has two ways to live, or that your two stones have two ways to connect (the bamboo joint is miai in its simplest form), lets you play the biggest point elsewhere instead of a safety move. Many endgame calculations rely on it too: two moves of equal value are miai, so each side gets one.',
      },
      {
        title: 'Breaking miai',
        text: 'The way to beat miai is a move that threatens both points at once, or a forcing move that removes one of them in sente. Examples: an atari that also threatens the second connecting point, a move that reduces eye space and makes the other eye point too small. When you rely on miai, check that no single move threatens both.',
      },
      {
        title: 'How strong players think about it',
        text: 'They use miai to judge whole-board positions: "these two groups are miai to live", "these two big points are miai, so I can play the third". When the opponent takes one of a miai pair, they take the other at once unless something bigger appeared; letting them have both is a two-move loss.',
      },
    ],
    mistakes: [
      'Playing one point of a miai pair when the opponent has not touched the other: a wasted move.',
      'Not answering when the opponent takes one point, so they get both.',
      'Missing the move that threatens both points at once.',
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
