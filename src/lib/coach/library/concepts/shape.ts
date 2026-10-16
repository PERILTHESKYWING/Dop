import type { ConceptText } from '../types';

/** Shape: how efficiently stones work together. */
export const SHAPE: ConceptText[] = [
  {
    id: 'shape',
    name: 'Good and bad shape',
    aliases: ['good shape', 'bad shape', 'shape', 'katachi', 'shape point', 'vital point of shape', 'hane at the head of two stones', 'ponnuki', 'dumpling', 'dango', '形', '好形', '愚形', 'ポン抜き', '団子', '二子の頭', '棋形', '团子', '开花', '우형'],
    level: 'intermediate',
    short: 'Shape is how efficiently a group of stones works: good shape gets the most liberties, eye potential and connection out of the fewest stones; bad shape wastes stones.',
    body: [
      {
        title: 'What it is',
        text: 'Each stone should add something: liberties, territory, eye space, a connection, or pressure on the opponent. Good shapes do several of these at once: the tiger\'s mouth, the bamboo joint, the one-point jump, the knight\'s move, the ponnuki (four stones around a captured one, so strong that "a ponnuki is worth thirty points"). Bad shapes put stones where they do the same job twice: the empty triangle, the dumpling (a solid clump of stones), stones crawling on the second line.',
      },
      {
        title: 'Why it matters',
        text: 'Groups in good shape need fewer moves to live and are hard to attack, so you can play elsewhere. Groups in bad shape are heavy: they have few eyes for many stones, every attack against them gains the opponent something, and saving them costs moves you needed elsewhere. Over a game, these lost moves add up to more than most tactical mistakes.',
      },
      {
        title: 'Shape proverbs that hold up',
        text: '"Hane at the head of two stones": when two of your stones face two of the opponent\'s, the hane in front of theirs is severe. "The opponent\'s vital point is your vital point": the point that would give them good shape is often the one you should take. "Don\'t make empty triangles." "Strike at the waist of the knight\'s move" (the cut through a knight\'s move is often strong). Each one is a summary of the same idea: put your stone where it does the most work and leaves the opponent the least.',
      },
      {
        title: 'How strong players think about it',
        text: 'Shape is their first filter: they barely consider moves with bad shape, which saves reading time. But they treat it as a guide, not a law. When reading shows that an ugly move is the only one that works (the empty triangle that connects, the clumsy move that makes an eye), they play it. "Good shape" also depends on the surroundings: the same shape is efficient on the third line and slow on the second.',
      },
      {
        title: 'What KataGo adds',
        text: 'KataGo often plays shape moves that look unusual to humans, like solid connections and early contact plays, because its count includes everything the shape protects later. When its best move looks "ugly", compare the ownership after it with the "nice" move; usually the ugly move keeps a group safer or keeps a cutting point closed.',
      },
    ],
    mistakes: [
      'Following shape rules when reading shows the "bad" move is the only one that works.',
      'Playing solid shape everywhere and falling behind in speed.',
      'Making a clump of stones that have few liberties and no eyes.',
      'Ignoring the opponent\'s vital point of shape when it is also yours.',
    ],
    related: ['empty-triangle', 'tigers-mouth', 'bamboo-joint', 'light-and-heavy', 'cutting-and-connecting'],
  },
  {
    id: 'empty-triangle',
    name: 'Empty triangle',
    aliases: ['empty triangle', 'empty triangles', 'aki sankaku', 'aki-sankaku', '空き三角', '空三角', '빈삼각'],
    level: 'beginner',
    short: 'An empty triangle is three stones in an L with the fourth point of the square empty; it has fewer liberties and covers less ground than other three-stone shapes, so it is usually bad.',
    hover: 'Three stones in an L with the fourth point of the square empty: an inefficient shape with few liberties.',
    body: [
      {
        title: 'What it is',
        text: 'Put three stones in an L: two along a line and one turning the corner, so they occupy three points of a 2x2 square and the fourth point is empty (not filled by the opponent). Three stones in a straight line have eight liberties in open space; the empty triangle has seven, and its stones crowd each other instead of spreading out.',
      },
      {
        title: 'Why it is bad',
        text: 'The third stone adds almost nothing: the first two were already nearly connected, so it neither gains ground nor many liberties. A group built of empty triangles is slow, heavy and short of eye space, and it is easy to attack. When you feel forced into an empty triangle, it usually means the earlier moves went wrong.',
      },
      {
        title: 'When it is right',
        text: 'Sometimes the empty triangle is the only way to connect, the only way to stop a cut that would kill a group, or the vital point for eye shape. Then it is a good move, and strong players play it without hesitation. If the fourth point is occupied by the opponent, the shape is not an empty triangle at all; it may be perfectly good.',
      },
      {
        title: 'How strong players think about it',
        text: 'They avoid it as a reflex but check whether the alternatives really work. Often the better move is a hane, a diagonal or a jump that does the same job with more room. And they try to make the opponent play empty triangles, for example by pushing so that the only way to connect is clumsy.',
      },
    ],
    mistakes: [
      'Playing an empty triangle to connect when a jump or a diagonal would connect too.',
      'Refusing a necessary empty triangle and losing the group.',
      'Calling a shape an empty triangle when the opponent already fills the fourth point.',
    ],
    related: ['shape', 'light-and-heavy', 'cutting-and-connecting'],
  },
  {
    id: 'tigers-mouth',
    name: "Tiger's mouth",
    aliases: ["tiger's mouth", 'tigers mouth', 'tiger mouth', 'hanging connection', 'kaketsugi', 'kake tsugi', 'tora no kuchi', 'カケツギ', '虎の口', '虎口', '호구'],
    level: 'beginner',
    short: 'A tiger\'s mouth is three stones around an empty point, open on one side; the opponent cannot play inside without being captured, so it connects lightly.',
    hover: 'Three stones around an empty point, open on one side; the opponent cannot play inside without being captured.',
    body: [
      {
        title: 'What it is',
        text: 'Three of your stones surround a point on three sides. If the opponent plays in that point, the stone has one liberty and you capture it at once. So the shape works as a connection (a "hanging connection") without filling the point, and the stones face outward with more room and more eye potential than a solid connection.',
      },
      {
        title: 'Strengths and weaknesses',
        text: 'Compared with a solid connection, the tiger\'s mouth is faster, wider and helps make eyes. Its weakness is the open side: the opponent can play atari at the mouth in sente (a forcing move or ko threat), and if a ko is possible at that point, the connection is not solid. Next to the edge or in a capturing race, the tiger\'s mouth can also lose a liberty that a solid connection would keep.',
      },
      {
        title: 'How to use it',
        text: 'Use the hanging connection when you want speed and eye shape and the opponent has no good forcing move into the mouth. Use the solid connection when the fight nearby is tight, when ko threats matter, or when the atari into the mouth would help the opponent. In joseki both are common; which is better usually depends on which direction your stones should face.',
      },
    ],
    mistakes: [
      'Using a tiger\'s mouth where a ko at the mouth would cut you.',
      'Forgetting that the opponent can atari into the mouth as a free ko threat.',
    ],
    related: ['shape', 'cutting-and-connecting', 'bamboo-joint', 'ko-threats'],
  },
  {
    id: 'bamboo-joint',
    name: 'Bamboo joint',
    aliases: ['bamboo joint', 'bamboo connection', 'takefu', 'タケフ', '竹節', '竹节', '쌍립'],
    level: 'beginner',
    short: 'A bamboo joint is two pairs of stones side by side with one gap between them; the two connecting points are miai, so it cannot be cut.',
    body: [
      {
        title: 'What it is',
        text: 'Two of your stones stand next to each other, and two more stand parallel to them two lines over, so one empty line of two points lies between the pairs. If the opponent wedges into one of the points, you connect at the other. The shape is as safe as a solid connection against cuts but covers more ground.',
      },
      {
        title: 'Its limits',
        text: 'The bamboo joint can fail when one connecting point is self-atari for you (shortage of liberties) or when the opponent\'s wedge comes with atari. In a capturing race it also has fewer liberties than it looks. Check those two things before relying on it.',
      },
      {
        title: 'How to use it',
        text: 'It is a good way to connect along the edge, to link a group to its base, or to answer a peep with a move that also extends. It is miai in its simplest form: don\'t play either point until the opponent plays the other.',
      },
    ],
    mistakes: [
      'Adding a move to a bamboo joint "to be safe" when it was already connected.',
      'Trusting a bamboo joint in a tight liberty fight where one connecting point is self-atari.',
    ],
    related: ['miai', 'cutting-and-connecting', 'shape', 'tigers-mouth'],
  },
  {
    id: 'light-and-heavy',
    name: 'Light and heavy',
    aliases: ['light', 'heavy', 'light play', 'heavy group', 'heavy stones', 'light vs heavy', 'light and heavy', 'play lightly', 'karui', 'omoi', '軽い', '重い', '軽く', '轻灵', '가볍다', '무겁다', '가볍게', '무거운'],
    level: 'advanced',
    short: 'Light stones can be partly given up, so they are hard to attack for profit; heavy stones are too many to give up and too weak to be safe, so every attack against them gains something.',
    body: [
      {
        title: 'What it is',
        text: 'A group is heavy when it has many stones, little eye space and no easy way to live or escape, so its owner must keep saving it. A group is light when its owner can sacrifice part of it, change direction, or settle quickly in more than one way. Light is not the same as thin, and heavy is not the same as thick: thick stones are strong, heavy stones are weak but valuable.',
      },
      {
        title: 'Why it matters',
        text: 'The whole point of attacking is to gain while the opponent defends. Against a heavy group, each attacking move builds your territory or wall and the defender gets nothing. Against a light group, the attacker swings at stones the defender is happy to give up, and the defender gets forcing moves and shape from the sacrifice.',
      },
      {
        title: 'How to play lightly',
        text: 'In the opponent\'s sphere, prefer moves that create choices: attachments that ask the opponent a question, shoulder hits, a stone that can be sacrificed for a wall. Don\'t add a stone to a group that is already in trouble just because it is in trouble; ask whether the stones are key stones or waste stones. When you cannot settle, move out with jumps rather than crawling with solid stones.',
      },
      {
        title: 'How strong players think about it',
        text: 'They think in terms of what each group must achieve, not how many stones it has. A light group needs only to "get by" (a small life, or a few stones that become a ko threat), so its owner plays elsewhere often. Many middle-game losses come from one heavy group that eats all of a player\'s tempo. As the attacker, they want the opponent heavy: they avoid contact moves that let the defender settle lightly, and they make the defender add stones instead.',
      },
    ],
    mistakes: [
      'Saving every stone of a weak group, making it heavier.',
      'Confusing light (flexible) with thin (full of weaknesses).',
      'Attacking with contact plays that help the opponent make light shape.',
    ],
    related: ['sabaki', 'sacrifice', 'weak-group', 'shape', 'attack', 'invasion'],
  },
];
