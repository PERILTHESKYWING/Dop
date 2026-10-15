import type { ConceptText } from '../types';

/** Capturing, eyes, life and death, races, seki and ko. */
export const BASICS: ConceptText[] = [
  {
    id: 'liberties',
    name: 'Liberties and atari',
    aliases: ['liberty', 'liberties', 'atari', 'in atari', 'double atari', 'counting liberties', 'qi', '气', '氣', '气数', '紧气', '长气', '叫吃', '打吃', '双打吃', 'アタリ', '呼吸点', '両アタリ', '단수', '활로', '양단수'],
    level: 'beginner',
    short: 'A liberty is an empty point next to a chain of stones; a chain with no liberties left is captured, and a chain with one liberty left is in atari.',
    body: [
      {
        title: 'What it is',
        text: 'Stones that touch along the lines (not diagonally) form one chain and share their liberties: the empty points directly next to any stone of the chain. When the opponent fills the last liberty, the whole chain is removed at once. "Atari" means a chain is down to one liberty, so it can be captured on the next move. Under almost all rules, a move that leaves your own chain with no liberty is not allowed unless it captures something first.',
      },
      {
        title: 'Why it matters',
        text: 'Every fight in Go is, underneath, a count of liberties. Whether a cutting stone can be captured, whether a group wins a capturing race, whether a ladder works, whether a move is self-atari: all of it comes down to who runs out first. Strong players count liberties all the time without saying so, the way a chess player counts attackers and defenders.',
      },
      {
        title: 'How to use it',
        text: 'Before you play a contact move, look at how many liberties each chain in the fight will have afterwards. Extending a chain usually adds liberties; playing into a narrow space often removes them. A chain with two liberties is in danger of being laddered or netted; with three or more it can usually run. A double atari (one move that puts two separate chains in atari) wins a stone because the opponent can only save one. Remember that liberties on the outside count, but filling the opponent\'s liberty can also fill one of your own: that is called shortage of liberties.',
      },
      {
        title: 'How strong players think about it',
        text: 'They give atari only when it gains something. An atari forces a reply, but the reply usually makes the opponent\'s chain stronger (more liberties, better shape) and removes your own options for later. "Atari for its own sake" is a classic beginner habit; a strong player keeps the atari in reserve as a forcing move or a ko threat. They also look at liberties in the direction the stones will run: an atari that drives the opponent toward your strength is good, one that drives them toward open space is often just helping.',
      },
    ],
    mistakes: [
      'Giving atari at every chance: the opponent connects with better shape and you lose a later forcing move.',
      'Escaping from atari into a shape that has only two liberties, which then dies in a ladder anyway.',
      'Forgetting shortage of liberties: filling the opponent\'s outside liberty can put your own stones in atari.',
      'Counting liberties of single stones instead of the whole connected chain.',
    ],
    related: ['ladder', 'net', 'capturing-race', 'snapback', 'cutting-and-connecting'],
  },
  {
    id: 'eyes',
    name: 'Eyes',
    aliases: ['eye', 'eyes', 'two eyes', 'real eye', 'false eye', 'eye shape', 'eye space', 'make eyes', '眼', '眼位', '做眼', '真眼', '假眼', '眼形', '欠け眼', '옥집', '궁도', '두 집'],
    level: 'beginner',
    short: 'An eye is an empty point (or space) surrounded by one side\'s stones that the opponent cannot fill; a group with two separate real eyes can never be captured.',
    body: [
      {
        title: 'What it is',
        text: 'The opponent may not play a stone with no liberties unless it captures. So an empty point completely enclosed by your connected stones can only be filled when it is your group\'s very last liberty. With two separate eyes the group always has at least two liberties the opponent cannot fill one at a time, so it lives forever. One eye, however large, is not enough on its own: the opponent can fill around and then inside it.',
      },
      {
        title: 'Real and false eyes',
        text: 'An eye is false when the stones around it are not really connected, so the owner will have to fill the eye to save part of the wall. Look at the diagonal points: in the middle of the board, if the opponent holds two of the four diagonals, the eye is false; on the edge, one of the two diagonals is enough; in the corner, the single diagonal decides. A group with one real eye and one false eye is dead. When you count eyes, count only the real ones.',
      },
      {
        title: 'Eye space',
        text: 'Before the eyes are finished, what matters is eye space: the area the group can still enclose. A bigger space usually gives two eyes, but shape matters more than size. Three points in a row, a bent three, a "pyramid" four and the bulky and flower fives each have one vital point; whoever plays there decides whether the space becomes two eyes or one. A square four is only one eye whoever moves. Straight four and bent four (away from the corner) are alive by themselves, because their two middle points are miai.',
      },
      {
        title: 'How strong players think about it',
        text: 'They count eyes long before the group is attacked: base on the side, possible eye on the edge, room to make a second one. A group with one eye and room to run is fine; a group with no eye and nowhere to go is a liability. When attacking, they take away eye space from the outside (the edge, the base) rather than poking at the inside, and they look for moves that make an eye false. When defending, they make the eye that the opponent cannot take away first.',
      },
    ],
    mistakes: [
      'Counting a false eye as a second eye.',
      'Thinking a big single eye is safe: a large eye space can still be reduced to one eye with a placement.',
      'Making eyes inside your own territory one by one (slow, gote) instead of securing eye space with one big move.',
      'Filling your own eye to save a stone that was not worth saving.',
    ],
    related: ['life-and-death', 'dead-group', 'capturing-race', 'seki', 'miai'],
  },
  {
    id: 'life-and-death',
    name: 'Life and death',
    aliases: ['life and death', 'tsumego', 'living', 'alive', 'kill', 'killing', 'vital point', 'nakade', 'placement', 'shikatsu', '死活', '詰碁', '活棋', '净活', '点眼', '要点', '中手', '急所', '사활', '치중', '급소', '묘수풀이'],
    level: 'beginner',
    short: 'Life and death is reading whether a group can make two eyes; the vital point of the eye space usually decides, and it is the same point for both sides.',
    body: [
      {
        title: 'What it is',
        text: 'A group is alive when it has, or can always make, two real eyes; dead when it cannot, even if it moves first. Between the two are groups whose fate depends on who plays first, and groups that end in ko or seki. Life-and-death problems (tsumego) train exactly this: find the move that lives or kills, and read every answer the opponent has.',
      },
      {
        title: 'The vital point',
        text: '"The opponent\'s vital point is your vital point." In a three-point space it is the middle; in a bent three, the corner of the bend; in pyramid four, bulky five and flower five, the center of the shape. If the defender takes it, the space splits into two eyes; if the attacker places a stone there (nakade), the space can only become one eye. On the second line the old rule is "six die, eight live": a row of six stones is dead even if it moves first, eight are alive even if the attacker moves first, seven depends on who moves first.',
      },
      {
        title: 'Attacking and defending',
        text: 'To kill, first shrink the space from outside (hane on the edge, take the base), then play the vital point inside. To live, widen the space first or take the vital point. Hane on the first line, the throw-in that makes an eye false, and the placement at the 2-1 point are the attacker\'s main tools. The corner is special: the 2-1 point, shortage of liberties and ko appear there all the time, so corner shapes deserve to be learned by heart.',
      },
      {
        title: 'How strong players think about it',
        text: 'They know the common corner and side shapes as facts, so they do not need to read them in a game, and they know which shapes become ko. They also judge timing: a group that is alive "in principle" may need one more move later (a gote move) when the opponent threatens it, and that move has a value they count. And they do not try to kill everything: making a group live small while you build outside is often the better result.',
      },
      {
        title: 'What KataGo adds',
        text: 'KataGo\'s ownership map shows life and death at a glance: stones of a dead group are owned by the opponent (close to -1 for their colour), a living group is close to +1, and an unsettled one sits near zero. When a read says one move turns a group from about 0 to about 1, that move was the vital point.',
      },
    ],
    mistakes: [
      'Attacking from inside first, which helps the defender build eye shape around your stone.',
      'Answering a placement by capturing it straight away when the capture leaves only one eye.',
      'Forgetting shortage of liberties in the corner: the defender cannot always play the point it needs.',
      'Spending a move to "make sure" a group that is already alive, or saving one that is already dead.',
    ],
    related: ['eyes', 'dead-group', 'weak-group', 'capturing-race', 'seki', 'ko'],
  },
  {
    id: 'dead-group',
    name: 'Dead stones',
    aliases: ['dead group', 'dead stones', 'dead stone', 'already dead', 'shini ishi', '死に石', '死子', '死棋', '죽은 돌'],
    level: 'intermediate',
    short: 'Stones are dead when they cannot avoid capture whatever their owner does; they do not need to be captured now, and adding stones to them usually throws points away.',
    body: [
      {
        title: 'What it is',
        text: 'A dead group still sits on the board, but it cannot make two eyes, cannot connect out and cannot win a capturing race. At the end of the game dead stones are removed and counted as captured. The opponent does not need to spend a move capturing them; they are already part of the opponent\'s area.',
      },
      {
        title: 'Why it matters',
        text: 'Two common losses come from misjudging dead stones. One is adding moves to stones that cannot be saved: under Japanese rules each extra stone is one more prisoner, and under any rules a move that saves nothing is a move not played somewhere useful. The other is the opposite: capturing dead stones that were no threat, which is a wasted move (gote) while the opponent plays a big point. Knowing exactly what is dead tells you where you do not need to play.',
      },
      {
        title: 'Dead is not the same as useless',
        text: 'Dead stones keep aji. They can reduce the liberties of the stones around them, give ko threats, help a later invasion, or become alive again if the surrounding wall gets weak. A strong player leaves dead stones on the board and uses them as forcing moves at the right moment, instead of moving them out or abandoning the area completely in their mind.',
      },
      {
        title: 'What KataGo adds',
        text: 'In KataGo\'s ownership, dead stones belong to the opponent: their points show the opponent\'s colour, often at more than 90%. If you are not sure whether your stones are dead, look at that number before playing another stone there; if it does not change after your candidate move, the move did not help.',
      },
    ],
    mistakes: [
      'Playing more stones to rescue a dead group, making the loss bigger.',
      'Capturing dead stones in gote when the opponent then takes a big point.',
      'Forgetting the aji of dead stones: a later ko or a weak surrounding wall can bring them back.',
      'Calling a weak group dead too early and giving up the fight it could still win.',
    ],
    related: ['life-and-death', 'weak-group', 'aji', 'sacrifice', 'counting'],
  },
  {
    id: 'capturing-race',
    name: 'Capturing race',
    aliases: ['capturing race', 'semeai', 'liberty race', 'race to capture', 'liberty count', 'one eye beats no eye', 'big eye', 'big eye small eye', '攻め合い', '对杀', '對殺', '大眼杀小眼', '有眼杀瞎', '수상전'],
    level: 'beginner',
    short: 'A capturing race is two adjacent groups that cannot both live, each trying to capture the other first; it is decided by counting liberties.',
    body: [
      {
        title: 'What it is',
        text: 'When two groups touch and neither can make two eyes or escape, whoever fills the other\'s liberties first captures. Count three kinds of liberties: outside liberties (only your opponent\'s), shared liberties (inside, touching both groups) and eyes. You fill the opponent\'s outside liberties first, because filling a shared one also takes away one of yours.',
      },
      {
        title: 'The counting rules',
        text: 'With no eyes on either side: the group with more liberties wins; with equal counts, the side to move wins. If there are two or more shared liberties and the outside counts are close, the result is often seki. With one eye against no eye, the shared liberties count only for the side with the eye: "one eye beats no eye" unless the eyeless group has many more outside liberties. From four points up, a big eye is worth more liberties than its size: a three-point eye gives 3, four gives 5, five gives 8, six gives 12. That is why "big eye beats small eye".',
      },
      {
        title: 'How to win races',
        text: 'Fill from the outside in, and approach liberties that need an approach move early. Before filling, look for moves that add a liberty to your own group, make an eye, or take away the opponent\'s eye: one tempo changes the whole count. Do not fill a shared liberty while outside ones remain. If you are behind by one liberty, look for a ko or a tesuji on the opponent\'s liberties, not for more filling moves.',
      },
      {
        title: 'How strong players think about it',
        text: 'They count before the race starts, not during it, and they decide the timing: a race you win by two liberties does not need a move now; it becomes urgent only when the opponent can gain a liberty in sente. They also keep the race as a threat: a group that wins a race can be left alone while you play elsewhere, and the opponent\'s moves near it may be gote for them.',
      },
    ],
    mistakes: [
      'Filling shared liberties first and losing a race you were winning.',
      'Counting a big eye as only as many liberties as its points.',
      'Starting the race without counting, when the opponent was a liberty ahead.',
      'Answering every move in a race you win comfortably, losing tempo elsewhere.',
    ],
    related: ['liberties', 'eyes', 'seki', 'ko', 'tesuji'],
  },
  {
    id: 'seki',
    name: 'Seki',
    aliases: ['seki', 'mutual life', 'coexistence', 'セキ', '双活', '雙活', '빅'],
    level: 'intermediate',
    short: 'Seki is mutual life: neighbouring groups that share liberties so that neither side can approach without putting itself in atari, so both stay on the board.',
    body: [
      {
        title: 'What it is',
        text: 'Usually two groups without two eyes share liberties in a capturing race. If the shared liberties are such that whoever fills one puts their own group in atari, nobody fills them, and both groups live without two eyes. Typical forms: two shared liberties and no eyes; one eye each and one shared liberty. Seki also appears in larger shapes, for example when an attacker\'s stones inside an eye space can neither be captured nor capture.',
      },
      {
        title: 'Scoring',
        text: 'Under Japanese rules, groups in seki get no territory, even an eye surrounded by their own stones. Under area scoring (Chinese, and KataGo here) the stones in seki and any eye fully surrounded by one side count for that side; the shared liberties count for nobody. So a seki is usually a small result for the defender, but much better than death.',
      },
      {
        title: 'When to aim for it',
        text: 'Defending inside a strong opponent area, seki is often the best you can get: alive, no points, but the opponent\'s area loses all the points your group occupies. Attacking, accepting seki is sometimes better than a ko you might lose. In a race that you cannot win, look for the move that turns it into seki rather than losing everything.',
      },
      {
        title: 'What KataGo adds',
        text: 'KataGo shows seki in its ownership map: each group\'s stones keep their own colour while the shared liberties sit near zero. If you fill a shared liberty in a seki, the read after your move will show your group turning to the opponent\'s colour.',
      },
    ],
    mistakes: [
      'Filling a shared liberty "to tidy up" and getting captured.',
      'Counting territory inside a seki under Japanese rules.',
      'Not seeing that a race is seki and wasting moves on it.',
    ],
    related: ['capturing-race', 'eyes', 'life-and-death', 'counting'],
  },
  {
    id: 'ko',
    name: 'Ko',
    aliases: ['ko', 'ko fight', 'ko rule', 'superko', 'approach ko', 'double ko', 'ten thousand year ko', 'picnic ko', 'kou', 'コウ', '劫', '打劫', '劫争', '劫爭', '缓气劫', '万年劫', '连环劫', '循环劫', '패', '패싸움', '만년패'],
    level: 'beginner',
    short: 'A ko is a shape where one stone can be captured and immediately recaptured forever; the ko rule forbids retaking at once, so the other side must play elsewhere first.',
    body: [
      {
        title: 'What it is',
        text: 'When a single stone captures a single stone and could itself be captured back at once by recapturing that stone, the position would repeat forever. The ko rule says you may not retake immediately; you must play somewhere else first. Most players use simple ko as above; Chinese rules, AGA rules and KataGo also forbid any repeat of a whole-board position (superko).',
      },
      {
        title: 'How a ko fight goes',
        text: 'One side takes the ko. The other cannot retake, so it plays a ko threat: a move elsewhere that threatens something bigger than the ko. If the first player answers the threat, the second retakes the ko, and now the first player needs a threat. The fight ends when one side ignores a threat to resolve the ko (connect or capture), accepting the loss from the threat because winning the ko is bigger.',
      },
      {
        title: 'Kinds of ko',
        text: 'In a direct ko each side is one move away from winning it. An approach ko needs one or more extra moves by one side, so that side is effectively behind by those moves. A "picnic" or flower-viewing ko is one where one side risks almost nothing and the other risks a lot. A ten-thousand-year ko is one nobody wants to start. Double ko gives a group endless ko threats, which can make it live.',
      },
      {
        title: 'How strong players think about it',
        text: 'They weigh two things: how big the ko is (the difference between winning and losing it) and who has more and bigger ko threats. Early in the game few ko threats exist and most are small, so the player with the stronger position usually wins a ko. They start kos on purpose when they have threats and avoid kos when they do not, and they resolve a ko as soon as it is safe to do so, because an open ko is a permanent weakness.',
      },
      {
        title: 'What KataGo adds',
        text: 'KataGo judges a ko by the same score as everything else, so a read can tell you how big a ko is: compare the lead after you win it with the lead after you lose it. That difference is what a ko threat has to beat: a threat that risks less can be ignored by ending the ko.',
      },
    ],
    mistakes: [
      'Retaking the ko at once (illegal) or forgetting that superko also forbids longer repeats.',
      'Starting a ko without counting ko threats.',
      'Using a ko threat that the opponent can safely ignore, or one that only removes your own aji.',
      'Leaving a ko open when you could connect, so the opponent can restart it later with a free threat.',
    ],
    related: ['ko-threats', 'life-and-death', 'capturing-race', 'aji', 'snapback'],
  },
  {
    id: 'ko-threats',
    name: 'Ko threats',
    aliases: ['ko threat', 'ko threats', 'kodate', 'kou threat', 'コウダテ', 'コウ材', '劫材', '找劫', '팻감'],
    level: 'intermediate',
    short: 'A ko threat is a move elsewhere that threatens more than the ko is worth, so the opponent should answer it, letting you retake the ko.',
    body: [
      {
        title: 'What it is',
        text: 'Because you cannot retake a ko at once, you play a forcing move first. If the opponent answers, you retake; if they ignore it to win the ko, you carry out the threat and gain its value instead. A threat works only if what it threatens is bigger than the ko for the opponent.',
      },
      {
        title: 'Good and bad threats',
        text: 'The best threats cost nothing: the move and the answer would have been played anyway, or they even gain a little. Bad threats lose points even when answered (for example, playing into the opponent\'s area and being captured), destroy your own aji, or strengthen the opponent\'s weak group. Threats that are local to the ko are especially strong, because answering them can change the ko itself.',
      },
      {
        title: 'Counting threats',
        text: 'Before you start a ko, count your threats and the opponent\'s. Look at weak groups (threats against them are big), cutting points, and stones that are dead but not yet captured. Threats are worth keeping: playing out forcing moves early "to tidy up" throws away threats you might need later.',
      },
      {
        title: 'How strong players think about it',
        text: 'They know the size of the ko and use their smallest adequate threats first, keeping the big ones. They also notice when the opponent\'s answer to a threat is itself useful for the opponent; such threats give the opponent a free move. When a ko is worth only a few points, they often stop fighting and resolve it, playing the biggest move elsewhere instead of a threat.',
      },
    ],
    mistakes: [
      'Using a threat the opponent can ignore because it is smaller than the ko.',
      'Making threats that lose points even when answered.',
      'Answering a small threat when ending the ko was worth more.',
      'Wasting forcing moves early in the game that would have been ko threats later.',
    ],
    related: ['ko', 'aji', 'sente', 'kikashi', 'dead-group'],
  },
];
