// "First video" recreation (thread #425): XIAO's DO reference f2 ("What is
// happening on YouTube") copied shot for shot, with a new character. Same
// structure (hook "Guys!", shock by 4 s, one gag per line, crash-out, cooking
// tease, thanks, bookend wave), same crop changes, same top subtitle and pale
// home background; new lead Nami (navy hair fading to teal, teal eyes,
// sleeveless turtleneck) and our own lines. The page offers it as a demo and
// the tests keep it valid and lint-clean. Rules learned from it: ref-rules.js.
const HOME = { kind: 'plain', color: '#e4f5ff' };
const BUST = (x, extra = {}) => ({ zoom: 3, x, y: 0.49, ...extra }); // head and shoulders fill the frame
const FACE = (x) => ({ zoom: 3.5, x, y: 0.475 }); // extreme close-up for the big emotion beats
const WAIST = (x) => ({ zoom: 2.2, x, y: 0.57 }); // arms in view for gestures
const nami = (x, beats, facing = 1) => [{ who: 'nami', x, facing, beats }];
// Long enough to read the caption (the studio's 14 characters a second, + 0.5 s): no voice carries it here.
const readable = (d, text) => Math.max(d, Math.ceil((text.length / 14 + 0.5) * 10) / 10);
const shot = (id, duration, narration, actors, more = {}) => ({ id, duration: readable(duration, narration), bg: HOME, narration, actors, ...more });

export const FIRST_VIDEO = {
  title: 'What is happening?! (ref copy)',
  idea: 'Animated vlog: a young artist reacts to her first video blowing up. Shot-for-shot copy of reference f2 with a new character.',
  stage: 'full',
  style: { fps: 12, hold: 2, boil: 0.35, wobble: 1, line: 3.5, shade: 0, misregister: 0.15, grain: 0.15, paper: '#e4f5ff', ink: '#2a2340', capPos: 'top' },
  cast: {
    nami: {
      name: 'Nami', height: 1, headSize: 1.4, build: 'petite',
      skin: '#f7dfd6', hair: '#262b55', hair2: '#3fb8b0', eyeColor: '#2a9d9a',
      top: '#2b3440', bottom: '#3a3f55', shoes: '#2a2340',
      hairStyle: 'shag', eyes: 'anime', jaw: 'v', topStyle: 'sleeveless', bottomStyle: 'skirt',
      extras: ['lashes', 'lips', 'blush', 'blushlines', 'ahoge'],
    },
  },
  scenes: [
    // Hook under 1.5 s: direct address on a face close-up.
    shot('guys', 1.2, 'Guys!', nami(0.5, [{ t: 0, move: 'gasp', face: 'surprised' }]), { camera: BUST(0.5) }),
    shot('three-days', 3, 'It has literally been three days!', nami(0.62, [{ t: 0, move: 'point', face: 'worried' }]), {
      camera: WAIST(0.5), props: [{ kind: 'sign', x: 0.3, scale: 0.8, text: 'my 1st video' }],
    }),
    // The stakes by 4 s: shock close-up, SFX word and shock lines on the other third.
    shot('subs', 2.4, 'Why do I already have 2k subscribers???', nami(0.42, [{ t: 0, move: 'gasp', face: 'shock' }]), {
      camera: FACE(0.42), marks: [{ kind: 'sfx', text: 'SHOCK', x: 0.8, y: 0.3, t: 0.2 }, { kind: 'lines', x: 0.14, y: 0.45, t: 0.2 }, { kind: 'sweat', x: 0.62, y: 0.42, t: 0.4 }],
    }),
    shot('sign', 2.5, 'I was aiming for 1000 by next year...', nami(0.66, [{ t: 0, move: 'idle', face: 'tired' }]), {
      camera: { zoom: 1.5, x: 0.5, y: 0.5 }, props: [{ kind: 'sign', x: 0.38, scale: 1.3, text: '1000 followers' }],
      marks: [{ kind: 'label', text: 'just woke up', x: 0.86, y: 0.3, to: [0.74, 0.42], t: 0.5 }],
    }),
    shot('scaring', 3, 'No for real, you guys are scaring me rn...', nami(0.5, [{ t: 0, move: 'fidget', face: 'panic' }]), {
      camera: BUST(0.5), marks: [{ kind: 'sweat', x: 0.66, y: 0.36, t: 0.3 }],
    }),
    shot('posture', 4, 'I was literally in the middle of drawing', nami(0.38, [{ t: 0, move: 'slump', face: 'cat' }]), {
      camera: WAIST(0.45), props: [{ kind: 'table', x: 0.38 }],
      marks: [{ kind: 'label', text: 'my posture', x: 0.75, y: 0.3, to: [0.5, 0.42], t: 1 }],
    }),
    // A 0.3 s colour flash as the transition into the gag (no caption: too short to read).
    { id: 'flash', duration: 0.3, bg: { kind: 'plain', color: '#2a2340' }, narration: '', actors: [] },
    shot('side-quest', 3, 'when I decided to do this side quest', nami(0.4, [{ t: 0, move: 'lookaround', face: 'smug' }]), {
      camera: WAIST(0.45), props: [{ kind: 'phone', x: 0.72 }],
      marks: [{ kind: 'exclaim', x: 0.78, y: 0.35, t: 0.3 }, { kind: 'label', text: 'message', x: 0.82, y: 0.6, to: [0.74, 0.7], t: 0.6 }],
    }),
    shot('feelings', 5, 'because I wanted to express my feelings... my confusion towards you guys', nami(0.5, [{ t: 0, move: 'think', face: 'neutral' }, { t: 2.6, move: 'crossarms', face: 'worried' }]), {
      camera: BUST(0.5, { to: { zoom: 3.4, x: 0.5, y: 0.48 } }),
    }),
    shot('here', 1.3, 'so here I am!', nami(0.5, [{ t: 0, move: 'hips', face: 'joy' }]), { camera: WAIST(0.5) }),
    shot('weird', 3.5, 'Just a weird artist girl on her art journey', nami(0.66, [{ t: 0, move: 'think', face: 'cat' }]), {
      camera: BUST(0.6), marks: [{ kind: 'label', text: 'HEHEHE...', x: 0.3, y: 0.62, t: 0.4 }, { kind: 'sparkle', x: 0.82, y: 0.25, t: 0.8 }],
    }),
    shot('comments', 3.5, 'and thank you SO much for all the comments and support', nami(0.5, [{ t: 0, move: 'idle', face: 'shock' }]), {
      camera: BUST(0.5), props: [{ kind: 'phone', x: 0.5 }],
      marks: [{ kind: 'label', text: 'Woahh!! So many comments!!!', x: 0.8, y: 0.3, t: 0.5 }],
    }),
    shot('motivation', 2, 'it gave me so much motivation', nami(0.5, [{ t: 0, move: 'talk', face: 'shy' }]), {
      camera: BUST(0.5), marks: [{ kind: 'heart', x: 0.25, y: 0.35, t: 0.3 }],
    }),
    // One long hold for the big line, on a cheer.
    shot('cheer', 6, 'I even started the next video right away! I was so pumped!', nami(0.5, [{ t: 0, move: 'cheer', face: 'joy' }]), {
      camera: WAIST(0.5), marks: [{ kind: 'sparkle', x: 0.25, y: 0.25, t: 0.4 }, { kind: 'sparkle', x: 0.78, y: 0.2, t: 1 }],
    }),
    shot('shocked', 2.5, 'but then I saw how long animating takes', nami(0.5, [{ t: 0, move: 'gasp', face: 'shock' }]), {
      camera: BUST(0.5), marks: [{ kind: 'lines', x: 0.2, y: 0.4 }, { kind: 'lines', x: 0.8, y: 0.4 }],
    }),
    // Peak burst: break colours, short shots.
    shot('crashout', 1.5, 'and had a little crashout', nami(0.5, [{ t: 0, move: 'facepalm', face: 'panic' }]), {
      bg: { kind: 'plain', color: '#c9a9b0' }, camera: FACE(0.5),
    }),
    shot('last-night', 2, 'in the middle of the night,', nami(0.5, [{ t: 0, move: 'slump', face: 'sad' }]), {
      bg: { kind: 'night', color: '#746b85' }, camera: WAIST(0.5),
      marks: [{ kind: 'sfx', text: 'RAHHH!!!', x: 0.3, y: 0.28, t: 0.2 }, { kind: 'label', text: '*footage of last night', x: 0.75, y: 0.75, t: 0.6 }],
    }),
    shot('fine', 1, 'but I am fine now!', nami(0.5, [{ t: 0, move: 'idle', face: 'joy' }]), { camera: BUST(0.5) }),
    shot('cooking', 4, 'Anyway, the next video is getting cooked rn!', nami(0.62, [{ t: 0, move: 'point', face: 'smug' }]), {
      bg: { kind: 'kitchen' }, camera: WAIST(0.55), props: [{ kind: 'box', x: 0.3, text: 'NEXT VIDEO' }],
      marks: [{ kind: 'sfx', text: 'sizzle', x: 0.3, y: 0.35, t: 0.5 }],
    }),
    shot('soon', 2.4, 'It should be out super soon,', nami(0.5, [{ t: 0, move: 'nod', face: 'happy' }]), { camera: BUST(0.5) }),
    shot('tuned', 2.2, 'sooo stay tuned for that!', nami(0.5, [{ t: 0, move: 'wave', face: 'joy' }]), { camera: WAIST(0.5) }),
    shot('thanks', 5.5, 'Thank you to everyone who subscribed, left a comment or even just watched!', nami(0.55, [{ t: 0, move: 'bow', face: 'shy' }, { t: 2.5, move: 'talk', face: 'happy' }]), {
      camera: BUST(0.55), marks: [{ kind: 'heart', x: 0.25, y: 0.4, t: 0.5 }],
    }),
    shot('posture-pls', 2.5, 'Fix your posture,', nami(0.5, [{ t: 0, move: 'slump', face: 'tired' }, { t: 1.3, move: 'idle', face: 'smug' }]), {
      camera: WAIST(0.5), marks: [{ kind: 'label', text: 'you before', x: 0.78, y: 0.4, to: [0.6, 0.5], t: 0.2 }, { kind: 'label', text: 'you after', x: 0.22, y: 0.3, to: [0.4, 0.4], t: 1.3 }],
    }),
    // Bookend: same outfit and crop family as the start, cute pose, goodbye.
    shot('bye', 3, 'and I will see you in the next video! Bye!', nami(0.5, [{ t: 0, move: 'wave', face: 'joy' }]), {
      camera: BUST(0.5), marks: [{ kind: 'sparkle', x: 0.3, y: 0.45, t: 0.3 }, { kind: 'heart', x: 0.75, y: 0.3, t: 0.9 }],
    }),
  ],
};
