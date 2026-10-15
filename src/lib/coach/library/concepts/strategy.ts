import type { ConceptText } from '../types';

/** Whole-board strategy: strength, frameworks, weak groups, attack and defence. */
export const STRATEGY: ConceptText[] = [
  {
    id: 'thickness',
    name: 'Thickness',
    aliases: ['thickness', 'thick', 'thick shape', 'wall', 'strong wall', 'honte', 'atsumi', 'kabe', '厚み', '厚味', '厚势', '厚勢', '本手', '壁', '두터움', '두텁다'],
    level: 'intermediate',
    short: 'Thickness is a strong group without weaknesses, usually facing outward; it is not territory itself but makes every fight near it go your way.',
    body: [
      {
        title: 'What it is',
        text: 'A group is thick when it is alive (or cannot be attacked) and has no cutting points or weak spots the opponent can use. A wall is only thickness if it is solid: a wall with a cutting point or no eyes is thin, and it becomes a target instead of a weapon. The honte, the proper solid move that removes a weakness, is how thickness is made and kept.',
      },
      {
        title: 'How to use thickness',
        text: 'Two old proverbs say it: "Don\'t use thickness to make territory" and "Stay away from thickness". Placing more stones near your own wall to enclose territory is slow, because the wall already controls that area. Instead, use thickness to attack: drive the opponent\'s weak stones toward your wall, where they cannot make eyes, and gain territory elsewhere while they run. And do not play your own weak stones near the opponent\'s thickness.',
      },
      {
        title: 'When thickness is worth more than territory',
        text: 'Thickness is worth more when there are opponent groups or loose stones within its reach to attack, when the board is still open so its influence can turn into points later, when it works with your other stones (a wall facing your own star point on the side), and when a big fight is coming nearby. Territory is worth more when the game is settling down, when the wall faces the edge or your own territory (it can only make points that were yours anyway), and when the opponent has no weak groups near it. A wall facing nothing is a wall that will never be paid for.',
      },
      {
        title: 'How strong players think about it',
        text: 'They value thickness by what it will do, not by how it looks. A thick position lets them play elsewhere more often, take risks in other fights, and invade the opponent\'s area without fear of a counter-attack. Many strong players prefer a thick, slightly slow position to a fast but thin one, because thinness has to be paid for in the middle game.',
      },
      {
        title: 'What AI changed',
        text: 'Engines showed two things at once. Walls built by classic joseki (for example, the outside wall from an early 3-3 invasion) are often worth less than humans assumed, so taking the corner is more common now. But solid, thick moves that humans called slow, such as a plain connection where a hanging connection looked faster, are often the engine\'s first choice, because they remove weaknesses before a fight. Thickness is valued for its safety more than for its influence.',
      },
    ],
    mistakes: [
      'Calling a wall thick when it has a cutting point or no eyes.',
      'Building territory right next to your own wall (overconcentration).',
      'Pushing the opponent\'s weak group away from your wall instead of toward it.',
      'Approaching the opponent\'s thickness with weak stones.',
    ],
    related: ['influence', 'territory', 'overconcentration', 'attack', 'aji', 'direction-of-play'],
  },
  {
    id: 'territory',
    name: 'Territory',
    aliases: ['territory', 'territories', 'profit', 'jiai', 'secure territory', '地', '地合い', '実利', '实地', '實地', '实利', '집', '실리', '확정지'],
    level: 'beginner',
    short: 'Territory is empty area surrounded by one side\'s living stones; it is what the game is counted in, and the opposite pull from influence.',
    body: [
      {
        title: 'What it is',
        text: 'At the end, each side scores the empty points it surrounds (territory scoring, Japanese and Korean rules) or its stones plus surrounded points (area scoring, Chinese rules and KataGo here). The two methods almost always give the same winner, within a point. During the game, territory means area that is secure, or nearly so: the opponent cannot invade it or reduce it much.',
      },
      {
        title: 'Territory and influence',
        text: 'Every move balances points now against power later. The third line is the line of territory, the fourth the line of influence: stones low on the board take sure points, stones high on the board face the center. A player who takes territory early lets the opponent build influence; the game then depends on whether that influence turns into more than the territory.',
      },
      {
        title: 'How to judge it',
        text: 'Count territory as secure only if an invasion or a large reduction would fail. A corner with an enclosure is secure in a way a big moyo is not. A side area with a weak point (a 3-3 invasion, an open side) is worth less than its size. Corners are cheapest to secure because two edges help; sides need more stones; the center almost never becomes territory directly.',
      },
      {
        title: 'How strong players think about it',
        text: 'They count early and often (see positional judgment), and they take territory when it is big and the opponent\'s resulting influence cannot be used well: for example when the opponent\'s wall would face your own strong stones. They avoid "small territory in gote": crawling along the second line gains a few points and gives the opponent a wall in sente.',
      },
      {
        title: 'What AI changed',
        text: 'Engines take corner territory earlier and more often than classical play, most visibly with the early 3-3 invasion, and they reduce large frameworks early instead of letting them grow. Big-moyo styles still exist, but engines show the moyo must be really big, or come with attacking chances, to beat solid corners.',
      },
    ],
    mistakes: [
      'Counting a framework as territory before it is secure.',
      'Crawling on the second line for small territory while the opponent builds a wall.',
      'Defending territory that was not in danger, losing tempo.',
    ],
    related: ['influence', 'thickness', 'moyo', 'counting', 'invasion', 'reduction'],
  },
  {
    id: 'influence',
    name: 'Influence',
    aliases: ['influence', 'outside influence', 'outward facing', 'seiryoku', '勢力', '势力', '外势', '外勢', '세력'],
    level: 'intermediate',
    short: 'Influence is the power stones project into open areas around them, especially toward the center; it becomes territory or attacking strength later, if it is used.',
    body: [
      {
        title: 'What it is',
        text: 'Stones on the fourth line and above, walls, and well-placed groups make the area in front of them easier for you and harder for the opponent. That is influence: not points yet, but a say over what happens there. Influence is strongest when the stones behind it are thick; influence from weak stones is mostly a liability.',
      },
      {
        title: 'How it becomes points',
        text: 'Influence pays in three ways: as territory when the area in front of it is surrounded later (a moyo), by attacking opponent stones that come near and gaining territory while they run, and by making a whole region of the board too dangerous for the opponent to enter, so they must play smaller moves. The second is usually the biggest.',
      },
      {
        title: 'How to judge it',
        text: 'Look at what the influence faces. Influence toward an open side with a friendly star point is excellent. Influence toward your own territory or your own wall is worth little (overconcentration). Influence toward the opponent\'s thickness is wasted. And influence that the opponent can reduce easily from above is worth less than it looks.',
      },
      {
        title: 'How strong players think about it',
        text: 'They use influence actively and early. Waiting for the opponent to invade a framework often lets them choose a weak spot; strong players make the framework a little bigger and make the opponent come in at a bad time, or use the influence to start a fight somewhere else that drifts toward it.',
      },
    ],
    mistakes: [
      'Treating influence as territory and defending it too early.',
      'Building influence that faces your own territory or strong stones.',
      'Letting a big framework sit unused until the opponent reduces it in comfort.',
    ],
    related: ['thickness', 'moyo', 'territory', 'direction-of-play', 'overconcentration', 'reduction'],
  },
  {
    id: 'overconcentration',
    name: 'Overconcentration',
    aliases: ['overconcentration', 'over-concentration', 'overconcentrated', 'over concentrated', 'inefficient', 'inefficiency', 'duplication', 'korigatachi', '凝り形', '重复', '重複', '效率低', '중복'],
    level: 'advanced',
    short: 'Overconcentration is having too many stones doing the same job in one area, so some of them are wasted while the opponent spends their moves elsewhere.',
    body: [
      {
        title: 'What it is',
        text: 'Go is a game of efficiency: each side gets the same number of moves, so stones that duplicate each other are moves thrown away. A wall with an extension right in front of it, two enclosures facing each other with little space between, a solid group next to an already living group: in each case one stone could have been somewhere else.',
      },
      {
        title: 'How it happens',
        text: 'Usually the opponent causes it. They push you into a wall that faces your own strong stones, settle quickly in a way that leaves your attacking stones on top of your own territory, or let you capture something in a corner you already owned. Simple local "good moves" can be overconcentrated when you look at the whole board.',
      },
      {
        title: 'How to avoid it, and cause it',
        text: 'When choosing a joseki or a fight, look at where your resulting wall or territory will be relative to your other stones; they should spread out, not stack up. When attacking, drive the opponent toward your strength so your stones work twice, and avoid attacks where your attacking stones end up next to your own territory. As the opponent\'s choice, try to make their thickness face their own territory.',
      },
      {
        title: 'What KataGo adds',
        text: 'Overconcentration shows up as a score difference that local reading does not explain: two moves that look equally good locally, one of them several points worse in KataGo\'s lead because its stones duplicate others. Comparing the two reads shows how much the duplication costs.',
      },
    ],
    mistakes: [
      'Extending too close to your own wall.',
      'Choosing a joseki whose wall faces your own strong stones.',
      'Capturing stones in an area you already controlled, in gote.',
    ],
    related: ['thickness', 'direction-of-play', 'influence', 'joseki', 'shape'],
  },
  {
    id: 'direction-of-play',
    name: 'Direction of play',
    aliases: ['direction of play', 'direction', 'wrong direction', 'right direction', 'which side', 'hōkō', '方向', '方向错误', '方向錯誤', '着眼方向', '방향', '방향착오'],
    level: 'intermediate',
    short: 'Direction of play is choosing which side to approach, block, extend or attack from, so that the result fits the rest of the board.',
    body: [
      {
        title: 'What it is',
        text: 'The same local move can be right on one side and wrong on the other. Approach a corner from the side where the opponent\'s extension would be biggest; block on the side where your wall will face open space or your framework; extend toward the open side, away from your own strength; attack so the opponent runs toward your thickness or into an area that is already yours.',
      },
      {
        title: 'Useful questions',
        text: 'Where will my wall face after this sequence? Which side would the opponent like to extend to, and can I take it first? If the opponent escapes, where will their group run, and what does it destroy on the way? Which of my groups is weakest, and does this move help it? Answering these usually decides between two moves that look the same.',
      },
      {
        title: 'Typical errors',
        text: 'Blocking the opponent toward the side where you are already strong, so your wall and your territory overlap. Approaching from the side that lets the opponent\'s answer also attack your other stones. Chasing a weak group into your own area, where it lives and destroys your territory. Pincering from the side where the opponent\'s jump out also reduces your framework.',
      },
      {
        title: 'What KataGo adds',
        text: 'Direction mistakes are among the most common large losses in amateur games: the move is a normal shape move, but on the wrong side. KataGo makes them visible by comparing the same idea played on both sides; a difference of several points between two "standard" moves is almost always about direction.',
      },
    ],
    mistakes: [
      'Blocking so that your wall faces your own strong position.',
      'Extending toward your own strength instead of toward open space.',
      'Driving the opponent\'s weak group into your own territory.',
    ],
    related: ['overconcentration', 'thickness', 'joseki', 'attack', 'opening-principles'],
  },
  {
    id: 'big-point',
    name: 'Big point',
    aliases: ['big point', 'big points', 'biggest point', 'biggest move', 'large point', 'oba', 'ōba', 'ooba', '大場', '大场', '큰 곳', '큰자리', '큰 자리'],
    level: 'intermediate',
    short: 'A big point is a move that claims a large open area (an empty corner, a wide extension on a side) without being needed to save anything; it is valuable but can wait if something is urgent.',
    body: [
      {
        title: 'What it is',
        text: 'In the opening the board has open areas worth many points: empty corners first, then the sides between corners, then extensions from existing groups. A big point stakes out such an area or stops the opponent from doing so. Classic examples: the empty corner, the extension that is a good point for both sides, the point between two frameworks.',
      },
      {
        title: 'Big point against urgent point',
        text: '"Urgent points before big points." A big point gains points but does not decide anything; an urgent point concerns the safety of groups. If a group would come under attack or be sealed in without your move, playing the big point instead usually loses more than the big point gains, because the opponent profits during the whole attack. Once all groups are settled, the biggest point is the right move.',
      },
      {
        title: 'Finding the biggest point',
        text: 'Look for points that are big for both sides: where your move would also stop the opponent\'s best extension. A point that expands your area while reducing the opponent\'s counts twice. Points next to the opponent\'s strong stones are smaller than they look, because the opponent can reduce them in sente.',
      },
      {
        title: 'What KataGo adds',
        text: 'KataGo\'s candidate list makes big points visible: several moves on different parts of the board with almost the same lead are the big points, and they are often miai. If one local move is far ahead of all of them, it is urgent.',
      },
    ],
    mistakes: [
      'Taking a big point while a group is in danger.',
      'Playing a big point that the opponent can reduce in sente.',
      'Choosing an area that is big for you but not for the opponent when a double-purpose point exists.',
    ],
    related: ['urgent', 'opening-principles', 'tenuki', 'miai', 'sente'],
  },
  {
    id: 'urgent',
    name: 'Urgent point',
    aliases: ['urgent point', 'urgent points', 'urgent move', 'urgent', 'kyuba', 'kyūba', 'kyuuba', '急場', '急场', '급한 곳'],
    level: 'intermediate',
    short: 'An urgent point is a move that concerns the life, base or connection of groups; it comes before big points because missing it costs more than any open area.',
    body: [
      {
        title: 'What it is',
        text: 'Urgent points are where groups are decided: the base of a weak group, the move that seals a group in or lets it out, the cut that separates two groups, the point that makes or takes away eyes. They are usually local and look small, but the difference between playing and missing them is a whole group\'s safety.',
      },
      {
        title: 'How to recognise it',
        text: 'Ask, for each group, "what happens if the opponent plays here next?" If the answer is that a group loses its base, gets cut off, or must run without eyes, that point is urgent. Urgent points of both sides often coincide: the point that settles your group is the point that would attack it.',
      },
      {
        title: 'Why it beats big points',
        text: 'A big point gains, say, ten points. A group under attack can cost far more than ten: the opponent builds territory and thickness while chasing it, and every move you spend running is a move not spent elsewhere. So urgent points usually come first, unless the group is light enough to be sacrificed or strong enough to wait.',
      },
      {
        title: 'What KataGo adds',
        text: 'An urgent move stands out in KataGo\'s reads: one local candidate is clearly ahead of all the big points elsewhere, and if you play elsewhere the opponent\'s best reply is right there. Comparing the lead after the urgent move with the lead after the biggest move elsewhere shows how urgent it is.',
      },
    ],
    mistakes: [
      'Taking an empty corner while a group without a base is about to be attacked.',
      'Answering a small local move as if it were urgent.',
      'Missing that the opponent\'s urgent point is also yours.',
    ],
    related: ['big-point', 'weak-group', 'tenuki', 'attack', 'sente'],
  },
  {
    id: 'weak-group',
    name: 'Weak group',
    aliases: ['weak group', 'weak groups', 'weak stones', 'unsettled group', 'floating group', 'running group', 'base', 'no base', 'yowai ishi', '弱い石', '根拠', '弱棋', '孤棋', '浮棋', '根据地', '약한 돌', '미생', '근거'],
    level: 'intermediate',
    short: 'A weak group has no secure eyes, no base and no safe connection; it is a burden that the opponent can attack for profit, and two at once are often fatal.',
    body: [
      {
        title: 'What it is',
        text: 'A group is weak when it cannot yet live by itself in one or two moves and cannot easily connect to a strong group. It may not be in immediate danger, but each opponent move near it is a threat, so it limits where you can play. The opposite is a settled group: alive, or easily alive, with a base on the side.',
      },
      {
        title: 'Why it matters',
        text: 'Weak groups cost tempo. While you defend, the opponent attacks with moves that also build territory or walls. A player with one weak group can usually manage; a player with two weak groups often loses, because the opponent attacks one and gains on the other at the same time. The Chinese proverbs "look after yourself before attacking" (攻彼顾我) and "when the opponent is strong, protect yourself" (彼强自保) are about this.',
      },
      {
        title: 'Handling your weak groups',
        text: 'Settle early with a base (an extension along the side that gives eye space) or move out toward the center with light moves. Keep the group light so you can sacrifice part of it. Do not let the opponent take your base: often the most urgent point on the board is the extension that gives your group room. And do not start a new fight elsewhere while a weak group is still floating.',
      },
      {
        title: 'Attacking weak groups',
        text: 'The aim is profit, not the kill. Take the base from below, then press from above or cap, so the group must run while you build. Attack from the side that drives it toward your strength. Keep your attacking stones safe; a weak group attacking another weak group is a gamble.',
      },
      {
        title: 'What KataGo adds',
        text: 'In KataGo\'s ownership, a weak group\'s stones are not clearly owned by either side: values near zero, or slowly turning to the opponent\'s colour. Watching that number before and after a move shows whether the move settled the group or made it weaker.',
      },
    ],
    mistakes: [
      'Starting a second fight while a group is still weak.',
      'Running without a plan, making the group heavy.',
      'Letting the opponent take your base on the side.',
      'Attacking with stones that are themselves weak.',
    ],
    related: ['attack', 'light-and-heavy', 'sabaki', 'urgent', 'life-and-death', 'dead-group'],
  },
  {
    id: 'attack',
    name: 'Attacking',
    aliases: ['attack', 'attacking', 'how to attack', 'splitting attack', 'leaning attack', 'cap', 'capping', 'boshi', 'take the base', 'seme', '攻め', '帽子', '攻击', '攻擊', '搜根', '缠绕攻击', '镇', '공격', '근거 박탈'],
    level: 'advanced',
    short: 'Attacking means chasing a weak group to gain while it runs: territory, thickness, sente. The aim is profit, not the kill; a group that stays weak keeps paying.',
    body: [
      {
        title: 'The goal of an attack',
        text: 'Most attacked groups live. That is fine: the attack succeeded if you gained more than the defender while they lived. Gains come as territory on the side where you chased them, a wall facing another area, sente to take a big point, or forcing moves that weaken a second group. Trying to kill everything tends to make the attacker overplay and lose the stones that were attacking.',
      },
      {
        title: 'How to attack',
        text: 'First take away the base (eye space on the side), then press from above or cap the group so it must run into the center without eyes. Attack from a distance: a knight\'s move or a cap is better than a contact play, because contact gives the defender something to lean on. Drive the group toward your thickness, or along a side where your chasing stones become territory. And keep the group weak instead of forcing it into good shape: leave it its weaknesses, so the next attack still has something to hit.',
      },
      {
        title: 'Splitting and leaning attacks',
        text: 'When the opponent has two weak groups, play between them so they cannot connect; then you gain on one while attacking the other. A leaning attack presses against a strong-looking group to make a wall, then uses that wall against a weaker group nearby. Both rely on one attacking move doing two jobs.',
      },
      {
        title: 'Before you attack',
        text: '"Look after yourself before attacking the opponent." If your own stones nearby are weak, the defender\'s running moves will also attack them, and the fight turns. Fix your own weakness first, or attack in a direction that strengthens your weak group at the same time.',
      },
      {
        title: 'What KataGo adds',
        text: 'Engine play fits the profit view: KataGo\'s attacking moves tend to build something at the same time, and it switches to a big point as soon as the attack stops gaining. To check an attack, compare the lead after the attacking move with the lead after the biggest move elsewhere.',
      },
    ],
    mistakes: [
      'Attacking to kill, overplaying, and losing your own attacking stones.',
      'Attacking with contact plays that help the defender settle.',
      'Chasing a group toward open space or into your own territory.',
      'Attacking while your own stones nearby are weak.',
    ],
    related: ['weak-group', 'thickness', 'light-and-heavy', 'direction-of-play', 'invasion', 'sabaki'],
  },
  {
    id: 'moyo',
    name: 'Moyo (framework)',
    aliases: ['moyo', 'moyō', 'framework', 'frameworks', 'big framework', 'sphere of influence', 'potential territory', '模様', '模样', '模樣', '大模样', '消长点', '모양', '대모양'],
    level: 'intermediate',
    short: 'A moyo is a large framework of potential territory, outlined loosely by stones on the fourth line and above; it is fast but not yet secure.',
    body: [
      {
        title: 'What it is',
        text: 'A moyo is an area that one side is likely to own but has not closed: stones mark the boundaries from a distance, and the inside is open. It is built quickly (each stone claims a lot), which is its strength, and it can be entered, which is its weakness. Openings like sanrensei (three star points on one side) and the Chinese opening aim at a moyo.',
      },
      {
        title: 'Playing with a moyo',
        text: 'A moyo is useful in three ways: it can grow into territory if the opponent does not enter; if the opponent invades, you attack the invader and gain on the outside; and its threat forces the opponent to play at the edge of it instead of elsewhere. Do not close a moyo completely with defensive moves early; that is slow. Expand it at the key points and keep it a threat.',
      },
      {
        title: 'The key point between frameworks',
        text: 'When both sides have frameworks, the most important point is often where they meet: a move there expands yours and shrinks theirs at the same time (Chinese 消长点, the point of expansion and reduction). Missing this point is a large loss even though no stone is in danger.',
      },
      {
        title: 'Facing a moyo',
        text: 'Decide between invading (going deep to live inside) and reducing (limiting it from the outside). Reduce when the moyo is still loose and an invader would be attacked hard; invade when the moyo is about to become real territory and there is room to live. The right moment is usually just before the moyo is completed.',
      },
      {
        title: 'What AI changed',
        text: 'Engines enter and reduce frameworks early, often with a shoulder hit or an early invasion, rather than letting them grow. Big-framework styles are still playable, but they need either a real attacking chance against the invader or a framework larger than the opponent\'s secure points.',
      },
    ],
    mistakes: [
      'Counting the whole moyo as territory.',
      'Defending the moyo with slow closing moves instead of expanding it.',
      'Letting the opponent take the key point where both frameworks meet.',
      'Attacking an invader in a way that pushes it into your own area.',
    ],
    related: ['influence', 'invasion', 'reduction', 'territory', 'thickness', 'opening-principles'],
  },
  {
    id: 'invasion',
    name: 'Invasion',
    aliases: ['invasion', 'invade', 'invading', 'invasions', 'uchikomi', '打ち込み', '打入', '打进', '침입'],
    level: 'intermediate',
    short: 'An invasion is a stone played deep inside the opponent\'s area, aiming to live there or escape, so the area does not become territory.',
    body: [
      {
        title: 'What it is',
        text: 'Invading means accepting a fight inside the opponent\'s sphere: the invader is weaker than everything around it, so it must live small, escape to the center, or be sacrificed for compensation. Typical invasion points are the 3-3 point under a star point, the third line between two of the opponent\'s stones when the gap is wide, and points next to a weakness in the opponent\'s shape.',
      },
      {
        title: 'When to invade',
        text: 'Invade when the area is large enough to give room for a base (on the third line, about two points on each side), when the opponent\'s surrounding stones have weaknesses, and when the area is about to become secure if you wait. Do not invade where the opponent is thick on all sides: the invasion may live, but the opponent gains outside while you struggle.',
      },
      {
        title: 'How to invade',
        text: 'Enter gently ("enter the opponent\'s sphere slowly", 入界宜缓): keep the invading stones light, use contact plays to make shape, and be ready to give up the first stone if that gives a better second one. Know before you go in whether you aim to live or to escape, and which side you will run toward.',
      },
      {
        title: 'Invasion or reduction',
        text: 'A deep invasion aims to take the whole area away and risks a lot; a reduction from outside takes less and risks little. Invade if you need a lot (you are behind) or if the area will be secure soon; reduce if you are ahead or if the invasion would make the opponent strong elsewhere. Strong players often probe first: a move that can become either an invasion or a reduction depending on the answer.',
      },
    ],
    mistakes: [
      'Invading too early, when the area is still open and you just give the opponent a target.',
      'Invading too late, when the area has become too small to live in.',
      'Making the invading group heavy instead of light.',
      'Invading where the opponent is thick on all sides.',
    ],
    related: ['reduction', 'sabaki', 'three-three-invasion', 'moyo', 'light-and-heavy', 'probe'],
  },
  {
    id: 'reduction',
    name: 'Reduction',
    aliases: ['reduction', 'reduce', 'reducing', 'reduce from outside', 'shoulder hit', 'keshi', '消し', 'カタツキ', '浅消', '浅削', '侵消', '肩冲', '削减', '삭감', '어깨짚기'],
    level: 'intermediate',
    short: 'A reduction limits the opponent\'s framework from the outside, usually with a shoulder hit or a cap on the fourth or fifth line, without trying to live inside.',
    body: [
      {
        title: 'What it is',
        text: 'Instead of going deep, you play at the edge of the opponent\'s area, high enough that your stone can always run to the center. The opponent gets some territory, but less than the full framework, and your stone becomes part of your own center influence. Common tools: the shoulder hit, the cap, the knight\'s move toward the area, and a jump from your own group.',
      },
      {
        title: 'When to reduce',
        text: 'Reduce when the framework is thick (an invasion would be attacked hard), when you are ahead and want to keep the game simple, or when the reduction also helps another of your groups. The best moment is when the framework is about to become solid but before its owner adds a move there.',
      },
      {
        title: 'How deep',
        text: 'Too shallow, and the opponent keeps almost everything while you gain little. Too deep, and the reducing stone becomes a weak group that the opponent attacks from all sides. A good reduction can choose: if the opponent answers softly, it goes a little deeper; if they answer hard, it is light enough to give up a stone and run.',
      },
      {
        title: 'What AI changed',
        text: 'The shoulder hit became one of the most common moves in engine openings. Engines use it early against star points and fourth-line extensions, accepting that the opponent gets territory on the side while they build height.',
      },
    ],
    mistakes: [
      'Reducing so shallowly that nothing is gained.',
      'Reducing so deeply that the stone becomes a weak group.',
      'Reducing in a way that pushes the opponent into a territory they wanted anyway.',
    ],
    related: ['invasion', 'moyo', 'influence', 'light-and-heavy', 'probe'],
  },
  {
    id: 'sabaki',
    name: 'Sabaki',
    aliases: ['sabaki', 'settle lightly', 'settle quickly', 'settling', 'サバキ', '腾挪', '騰挪', '타개'],
    level: 'advanced',
    short: 'Sabaki is settling a group quickly and flexibly in the opponent\'s sphere, usually with contact plays and sacrifices, so that it no longer needs defending.',
    body: [
      {
        title: 'What it is',
        text: 'When you are outnumbered (an invasion, a group under attack), you cannot win a straight fight. Sabaki means playing so that every answer of the opponent lets you settle: a small life, an escape, or a wall in exchange for a few stones. The shape stays light; any part of it can be sacrificed.',
      },
      {
        title: 'Tools',
        text: 'Contact plays are the main tool: "use attachments for sabaki". An attachment forces the opponent to choose a side, and their answer gives you something to lean on. Crosscuts, hane and diagonal attachments create choices for you; a sacrifice of one or two stones turns into forcing moves that make shape on the other side.',
      },
      {
        title: 'Attack and sabaki are opposites',
        text: 'The attacker avoids contact ("don\'t touch the stones you want to attack"); the defender seeks it. The attacker wants the defender heavy; the defender wants to stay light. Knowing both sides of this helps: when you attack, do not give the defender the contact play they need; when you defend, look for it.',
      },
      {
        title: 'How strong players think about it',
        text: 'They decide early which stones are essential and which are bait. A sabaki group that "settles" with a sacrifice of two stones but in sente is often a big success, even though it looks like a loss.',
      },
    ],
    mistakes: [
      'Defending a weak group with solid, one-dimensional moves that make it heavy.',
      'Refusing to give up any stones.',
      'Using contact plays as the attacker, helping the defender settle.',
    ],
    related: ['light-and-heavy', 'weak-group', 'invasion', 'sacrifice', 'attack'],
  },
];
