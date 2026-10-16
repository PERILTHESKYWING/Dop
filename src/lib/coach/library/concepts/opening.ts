import type { ConceptText } from '../types';

/** The opening: principles, the 3-3 invasion, joseki. */
export const OPENING: ConceptText[] = [
  {
    id: 'opening-principles',
    name: 'Opening principles',
    aliases: ['opening', 'opening principles', 'fuseki', 'the opening', 'corners first', 'corner side center', 'enclosure', 'approach move', 'extension', 'shimari', 'kakari', 'hiraki', 'AI opening', 'AI openings', '布石', '布局', 'シマリ', 'カカリ', 'ヒラキ', '守角', '挂角', '拆边', '拆二', '立二拆三', '金角银边草肚皮', '포석', '굳힘', '걸침', '벌림'],
    level: 'beginner',
    short: 'In the opening, take corners first, then sides, then the center, because the edges help you make territory and eyes cheaply; AI has kept this order but changed many of the details.',
    body: [
      {
        title: 'Why corners, sides, center',
        text: 'Two edges help you in the corner, one on the side, none in the center. So the same number of stones makes the most secure territory and the easiest life in a corner. The Chinese saying is "golden corners, silver sides, grass belly" (金角银边草肚皮). That is why openings start on the 4-4, 3-4 and 3-3 points, then add enclosures, approaches and extensions along the sides.',
      },
      {
        title: 'The basic moves',
        text: 'An enclosure (shimari) makes a corner secure with a second stone. An approach (kakari) stops the opponent from enclosing and starts a joseki. An extension (hiraki) gives a group a base on the side: "stand two, extend three; stand three, extend four" (立二拆三, 立三拆四) gives the safe distance from a wall of two or three stones. A pincer attacks an approach stone while extending.',
      },
      {
        title: 'Principles that still hold',
        text: 'Play where the board is biggest for both sides. Settle weak groups before taking big points ("urgent before big"). Choose joseki that fit the whole board: a wall should face open space or your framework. Third line for territory, fourth line for influence; keep a balance between them. Do not play too close to strong stones, yours or the opponent\'s.',
      },
      {
        title: 'What AI changed',
        text: 'The order corner, side, center survived. Many details did not. The 3-3 invasion under a lone star point became a normal move early in the game. Approaches are often answered by playing elsewhere. Shoulder hits and early contact plays are common. Big-framework openings are still played but are judged more strictly, and the star point and 3-4 point dominate first moves. Openings on the 5-5 point, tengen or other unusual points are playable but measurably worse by the engine\'s count.',
      },
      {
        title: 'How to study it',
        text: 'Memorising AI openings move by move helps less than understanding why each move is big: what it threatens, what it prevents, which side it builds. When KataGo\'s choice differs from yours, compare both reads: often the engine move is bigger for both sides, or it handles a weakness before taking a big point.',
      },
    ],
    mistakes: [
      'Playing in the center or on the side while corners are still empty.',
      'Copying AI sequences without knowing what each move is for.',
      'Taking a big point while a group without a base is about to be attacked.',
      'Extending too close to your own strong stones, or too far from your own weak ones.',
    ],
    related: ['big-point', 'urgent', 'three-three-invasion', 'joseki', 'direction-of-play', 'territory', 'influence'],
  },
  {
    id: 'three-three-invasion',
    name: 'The 3-3 invasion',
    aliases: ['3-3 invasion', '3-3', '33 invasion', 'three three', 'three-three', 'three-three invasion', 'san san', 'sansan', 'san-san', '3-3 point', 'early 3-3', '三々', '三三', '点三三', '點三三', '삼삼', '삼삼 침입'],
    level: 'intermediate',
    short: 'The 3-3 invasion is a move at the 3-3 point under a lone star-point stone; it takes the corner and lives, giving the outside to the opponent. AI made it a normal move from the very start of the game.',
    hover: 'A move at the 3-3 point under a lone star-point stone; it takes the corner and lets the opponent build outside.',
    body: [
      {
        title: 'What it is',
        text: 'A star-point (4-4) stone does not secure the corner: a stone at 3-3 underneath it can live there. After the invasion, the corner owner blocks from one side, and a standard sequence follows in which the invader gets the corner territory and the owner gets a wall on the outside, usually in sente.',
      },
      {
        title: 'The old view and the new',
        text: 'Before AI, the early 3-3 invasion was considered a bad trade: the corner was small and the outside wall large, so it was kept for later, after the outside had been reduced. Engines showed that the invader\'s corner is real profit and the wall is often less useful than it looks, especially when the wall faces stones that can make it overconcentrated or when the invader can play elsewhere at the right moment. Now the invasion is played early, even at move five or six.',
      },
      {
        title: 'Choosing the block',
        text: 'The corner owner chooses which side to block from, and that choice is the whole-board decision: block so that the wall faces open space, your other stones or the side where you want to build, not toward your own territory or the opponent\'s strength. In modern sequences the owner often does not finish the joseki and plays elsewhere after a few moves, or the invader stops early and saves the follow-up.',
      },
      {
        title: 'When not to invade',
        text: 'If the corner owner already has stones along both sides (an extension or an enclosure nearby), the wall will work so well with them that the invasion is small or even dies. And if the outside is already the owner\'s strong area, giving them a wall there makes their framework real. Check what the wall will face before you invade.',
      },
    ],
    mistakes: [
      'Blocking from the side where your wall faces your own territory.',
      'Invading when the corner owner already has supporting stones on both sides.',
      'Playing the full old sequence automatically instead of leaving it at the right moment.',
    ],
    related: ['opening-principles', 'joseki', 'invasion', 'thickness', 'direction-of-play', 'territory'],
  },
  {
    id: 'joseki',
    name: 'Joseki',
    aliases: ['joseki', 'josekis', 'jōseki', 'corner sequence', 'standard sequence', 'standard corner sequence', 'trick play', 'hamete', '定石', 'ハメ手', '定式', '定式选择', '정석', '정석 선택'],
    level: 'intermediate',
    short: 'A joseki is a standard corner sequence that is fair to both sides locally; choosing which joseki to play, given the rest of the board, matters more than knowing the moves.',
    hover: 'A standard corner sequence that is fair to both sides locally; choosing the one that fits the whole board matters most.',
    body: [
      {
        title: 'What it is',
        text: 'Joseki are sequences that strong players agree give an even local result: one side gets territory, the other influence, or one gets sente and the other a slightly better shape. "Even" is only local; on a real board, the stones elsewhere make one joseki better than another.',
      },
      {
        title: 'Choosing a joseki',
        text: 'Ask: which direction will my wall face, and does it work with my other stones? Does a ladder in this joseki work for me? Do I want sente to take a big point, or is local profit enough? Will the opponent\'s resulting group be weak, and can I attack it? A joseki that gives you a wall facing your own enclosure is a bad choice even if every move in it is "correct".',
      },
      {
        title: 'When the opponent leaves the joseki',
        text: 'Deviations are either mistakes to punish or trick plays (hamete) that work only if you answer the "natural" way. Read the deviation as a local fight: count liberties, look at weaknesses, and check whether the "obvious" answer leaves a cutting point. When in doubt, a solid honte is usually safer than the sharpest reply.',
      },
      {
        title: 'How strong players think about it',
        text: '"Learn joseki and lose two stones in strength," says a Japanese proverb: memorising without understanding makes you play the sequence even when the board says otherwise. Strong players know why each move is played, which moves can be left out, and when to stop and play elsewhere.',
      },
      {
        title: 'What AI changed',
        text: 'Engines pruned many classical joseki (some popular lines turned out to lose a few points) and made others standard, for example the early 3-3 invasion and several attach-and-draw-back sequences against approaches to the star point. They also leave joseki more often: the move that ends a sequence in a classic book is frequently replaced by tenuki. Modern joseki references carry engine evaluations.',
      },
    ],
    mistakes: [
      'Playing a joseki whose result faces your own strength.',
      'Relying on a ladder in the joseki without checking it.',
      'Answering a trick play the natural way without reading.',
      'Finishing a sequence by memory when tenuki was bigger.',
    ],
    related: ['opening-principles', 'three-three-invasion', 'direction-of-play', 'ladder', 'overconcentration', 'tenuki'],
  },
];
