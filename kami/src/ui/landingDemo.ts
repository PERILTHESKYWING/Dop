/**
 * The landing page's example: a real position (34 moves of a game from the engine benchmark set,
 * public/engine/bench-positions.json, game g70dd864b0bcbfc05) and Kiai's real answer to
 * "Why is Q9 good here?", made by `npx tsx scripts/kami-critique.ts --only 10 --thinking high`
 * (Dive, engine text, no language model). The [[v1]] chip markers were removed, and three asides
 * (the opening cheer, a joke and an emoji) cut for the landing; nothing was reworded.
 */
export const DEMO = {
  question: 'Why is Q9 good here?',
  asked: 'Q9',
  last: 'Q11',
  stones: [['Q17', 1], ['D16', 2], ['R14', 1], ['Q11', 2], ['R11', 1], ['R9', 2], ['P8', 1], ['N7', 2], ['B6', 2], ['C6', 1], ['P6', 1], ['R6', 2], ['S6', 2], ['C5', 2], ['D5', 1], ['O5', 2], ['P5', 1], ['Q5', 1], ['R5', 2], ['S5', 1], ['T5', 1], ['C4', 2], ['D4', 1], ['O4', 2], ['P4', 2], ['Q4', 2], ['R4', 1], ['S4', 2], ['C3', 2], ['D3', 1], ['O3', 1], ['Q3', 2], ['R3', 1], ['S3', 1]] as [string, 1 | 2][],
  model: 'Dive',
  teaser: "Q9 is just as good as KataGo's favourite Q10, and you arrive at the same position anyway.",
  answer: ["Q9 is just as good as KataGo's favourite Q10, and you arrive at the same position anyway.", "Q9 trims White's area on the right side while making the black group at P6 safer. And it keeps sente: White has to answer it."],
  footnote: 'Dive’s own words, thinking high, shortened. KataGo read 528 visits over 4 reads with the bundled b10 network.',
};
