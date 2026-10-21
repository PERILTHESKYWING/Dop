// "First video" recreation (threads #425, #490): XIAO's DO reference f2
// ("What is happening on YouTube") copied shot for shot, with a new character.
// Same 30 shots at f2's cut times (76 s), same crops, the same pose and gag in
// each shot, the same top caption that carries a phrase across cuts, the same
// pale home background with break colours for the flash, crash-out and "last
// night". She talks to the viewer, so the project is faceCam: square to the
// camera and looking into the lens in every shot. The lead is Nami (navy hair
// fading to teal, teal eyes, sleeveless turtleneck); the lines are ours, close
// to f2's. Rules learned from it: ref-rules.js.
const HOME = { kind: 'plain', color: '#e4f5ff' };
// Crops, measured on f2's stills (her height 1, headSize 1.4):
const BUST = (x, extra = {}) => ({ zoom: 4.2, x, y: 0.475, ...extra }); // head and shoulders, cut at the chest
const CLOSE = (x, extra = {}) => ({ zoom: 5.2, x, y: 0.465, ...extra }); // the face fills the frame (shock, crash-out)
const CHEST = (x, extra = {}) => ({ zoom: 3.4, x, y: 0.5, ...extra }); // head to the waist: hands in view
const DESK = (x) => ({ zoom: 2.9, x, y: 0.53 }); // sitting at the desk, the table across the bottom
const nami = (x, beats, facing = 1) => [{ who: 'nami', x, facing, beats }];
const shot = (id, duration, narration, actors, more = {}) => ({ id, duration, bg: HOME, narration, actors, ...more });

export const FIRST_VIDEO = {
  title: 'What is happening?! (ref copy)',
  idea: 'Animated vlog: a young artist talks to the camera about her first video blowing up. Shot-for-shot copy of reference f2 with a new character.',
  stage: 'full',
  style: { fps: 12, hold: 2, boil: 0.3, wobble: 0.8, line: 2.6, shade: 0, misregister: 0, grain: 0.1, paper: '#e4f5ff', ink: '#3a2a3f', capPos: 'top', faceCam: true },
  cast: {
    nami: {
      name: 'Nami', height: 1, headSize: 1.4, build: 'petite',
      skin: '#f6e0da', hair: '#2b2d57', hair2: '#3fb8b0', eyeColor: '#2a9d9a',
      top: '#3b3040', bottom: '#3a3f55', shoes: '#2a2340',
      hairStyle: 'shag', eyes: 'anime', jaw: 'v', topStyle: 'sleeveless', bottomStyle: 'skirt',
      extras: ['lashes', 'blush', 'blushlines', 'ahoge'],
    },
  },
  scenes: [
    // 0:00 Hook: "Guys!" on a bust, hand to the cheek, worried.
    shot('guys', 1.1, 'Guys!', nami(0.5, [{ t: 0, move: 'cheek', face: 'worried' }]), { camera: BUST(0.47) }),
    // 0:01.1 A 0.3 s jump cut: same line, a touch closer, the hand settles.
    shot('guys-2', 0.3, 'Guys!', nami(0.5, [{ t: 0, move: 'cheek', face: 'worried', quiet: true }]), { camera: BUST(0.47, { zoom: 4.5 }) }),
    // 0:01.4 Points back at her first video's thumbnail, blank shock.
    shot('three-days', 2.9, 'It literally has been three days!', nami(0.64, [{ t: 0, move: 'point', face: 'shock' }], -1), {
      camera: CHEST(0.58), props: [{ kind: 'thumb', x: 0.2, y: 0.34, scale: 1, text: 'MY 1ST VIDEO' }],
    }),
    // 0:04.3 The stakes: extreme close-up, hands clasped, SHOCK and shock lines.
    shot('subs', 1.5, 'dym I already have like 2k subscribers???', nami(0.5, [{ t: 0, move: 'clasp', face: 'shock' }]), {
      camera: { zoom: 3.6, x: 0.48, y: 0.5 }, marks: [{ kind: 'sfx', text: 'SHOCK', x: 0.86, y: 0.24 }, { kind: 'lines', x: 0.16, y: 0.4 }, { kind: 'sweat', x: 0.6, y: 0.4, t: 0.3 }],
    }),
    // 0:05.8 Her goal sign, the 1 struck out; she peeks up from the bottom edge.
    shot('sign', 2.5, 'dym I already have like 2k subscribers???', [], {
      camera: { zoom: 1, x: 0.5, y: 0.5 }, marks: [{ kind: 'board', text: '1000 Follower', x: 0.5, y: 0.2, size: 1.6 }, { kind: 'peek', x: 0.62, y: 0.78, t: 0.3 }, { kind: 'label', text: 'Just woke up', x: 0.84, y: 0.72, to: [0.72, 0.84], t: 0.6 }],
    }),
    // 0:08.3 Teary eyes, cat mouth, sweat: "you are scaring me".
    shot('scaring', 3, 'no frr, you guys are so scaring me rn...', nami(0.5, [{ t: 0, move: 'idle', face: 'teary' }]), {
      camera: BUST(0.5), marks: [{ kind: 'sweat', x: 0.4, y: 0.42, t: 0.2 }, { kind: 'sweat', x: 0.6, y: 0.38, t: 0.5 }],
    }),
    // 0:11.3 A 0.5 s beat: a sweat drop falls.
    shot('scaring-2', 0.5, 'no frr, you guys are so scaring me rn...', nami(0.5, [{ t: 0, move: 'fidget', face: 'teary', quiet: true }]), {
      camera: BUST(0.5, { zoom: 4.5 }), marks: [{ kind: 'sweat', x: 0.42, y: 0.6, t: 0 }],
    }),
    // 0:11.8 At the desk, hunched over the tablet, "my posture".
    shot('posture', 4.3, 'I was actually in the middle of drawing', nami(0.4, [{ t: 0, move: 'slump', face: 'cat' }]), {
      camera: DESK(0.5), marks: [{ kind: 'desk', x: 0.5, y: 0.72 }, { kind: 'shrimp', x: 0.76, y: 0.56, size: 0.5, t: 0.6 }, { kind: 'label', text: 'My posture', x: 0.88, y: 0.32, to: [0.8, 0.44], t: 0.8 }],
    }),
    // 0:16.1 Impact: a 0.3 s colour flash.
    { id: 'flash', duration: 0.3, bg: { kind: 'plain', color: '#6e3346' }, narration: 'when I decided to do this side quest', actors: [] },
    // 0:16.4 Speed lines over the desk, a message pops up.
    shot('side-quest', 3.2, 'when I decided to do this side quest', nami(0.4, [{ t: 0, move: 'slump', face: 'cat' }]), {
      camera: DESK(0.48), marks: [{ kind: 'desk', x: 0.5, y: 0.72, text: 'phone' }, { kind: 'speed', x: 0.5, y: 0.4 }, { kind: 'exclaim', x: 0.18, y: 0.45, t: 0.2 }, { kind: 'label', text: 'message', x: 0.16, y: 0.62, to: [0.2, 0.74], t: 0.5 }],
    }),
    // 0:19.6 f2 cuts to its stern mascot (white blob, pencil) alone on the home colour.
    shot('feelings', 5.5, 'because I wanted to express my feelings, my confusion towards you guys', [], {
      camera: { zoom: 1, x: 0.5, y: 0.5 }, props: [{ kind: 'mascot', x: 0.5, y: 0.56, scale: 2.6 }],
    }),
    // 0:25.1 Front bust, nervous grin.
    shot('confused', 1.2, 'because I wanted to express my feelings, my confusion towards you guys', nami(0.5, [{ t: 0, move: 'idle', face: 'nervous' }]), {
      camera: CHEST(0.5), marks: [{ kind: 'lines', x: 0.66, y: 0.36 }],
    }),
    // 0:26.3 The empty home frame for a beat...
    shot('empty', 0.3, 'so here I am!', [], { camera: { zoom: 1, x: 0.5, y: 0.5 } }),
    // 0:26.6 ...then she pops back in.
    shot('here', 3.6, 'so here I am!', nami(0.5, [{ t: 0, move: 'jump', face: 'joy' }]), { camera: BUST(0.5), marks: [{ kind: 'sparkle', x: 0.72, y: 0.3, t: 0.3 }] }),
    // 0:30.4 The "Gender" dropdown gag, finger on chin, HEHEHE.
    shot('weird', 3.3, 'Just a weird artist on her art journey', nami(0.7, [{ t: 0, move: 'chin', face: 'cat' }]), {
      camera: BUST(0.62), marks: [{ kind: 'card', text: 'Gender|Female|Male|Artist girl', x: 0.2, y: 0.42, size: 0.8 }, { kind: 'label', text: 'HEHEHE...', x: 0.46, y: 0.62, t: 0.5 }],
    }),
    // 0:33.5 Phone in both hands, amazed.
    shot('comments', 3.9, 'and thank you all for the comments and support', nami(0.5, [{ t: 0, move: 'phone', face: 'surprised' }]), {
      camera: BUST(0.5), marks: [{ kind: 'label', text: 'Woahh!! So many comments!!!', x: 0.86, y: 0.4, t: 0.4 }],
    }),
    // 0:37.4 Same, softer, with an "Aww!" bubble.
    shot('motivation', 2.6, 'it gave me so much motivation', nami(0.5, [{ t: 0, move: 'phone', face: 'shy' }]), {
      camera: BUST(0.5, { zoom: 4.5 }), marks: [{ kind: 'label', text: 'Aww!', x: 0.16, y: 0.4, t: 0.1 }, { kind: 'label', text: 'Woahh!! So many comments!!!', x: 0.86, y: 0.4 }],
    }),
    // 0:39.1 The long hold: fist up, eyes squeezed shut.
    shot('cheer', 7.0, 'I even started the next video right away because I was so pumped!', nami(0.5, [{ t: 0, move: 'fistup', face: 'joy' }], -1), {
      camera: CHEST(0.52), marks: [{ kind: 'sparkle', x: 0.24, y: 0.3, t: 0.5 }],
    }),
    // 0:47.0 (f2 cuts to a reaction picture) The blank white-eyed shock, shock lines both sides.
    shot('shocked', 3.3, 'but then I saw how long animating takes', nami(0.5, [{ t: 0, move: 'clasp', face: 'yell' }]), {
      camera: BUST(0.5), marks: [{ kind: 'lines', x: 0.2, y: 0.4 }, { kind: 'lines', x: 0.8, y: 0.4, t: 0.15 }],
    }),
    // 0:50.0 Crash-out: rose break colour, palms over the face, eyes up.
    shot('crashout', 1.6, 'and crashed out in the middle of the night,', nami(0.5, [{ t: 0, move: 'cover', face: 'shock' }]), {
      bg: { kind: 'plain', color: '#c4a2a8' }, camera: CLOSE(0.5),
    }),
    // 0:51.5 "Footage of last night": dusk violet, collapsed, RAHHH.
    shot('last-night', 2, 'and crashed out in the middle of the night,', nami(0.55, [{ t: 0, move: 'slump', face: 'panic' }]), {
      bg: { kind: 'plain', color: '#6f6886' }, camera: CHEST(0.55),
      marks: [{ kind: 'sfx', text: 'RAHHH!!!', x: 0.3, y: 0.3, t: 0.1 }, { kind: 'label', text: '*Footage of last night', x: 0.84, y: 0.8, t: 0.4 }],
    }),
    // 0:53.5 Back home, nervous grin, front on.
    shot('fine', 0.6, 'but I am totally fine now!', nami(0.5, [{ t: 0, move: 'idle', face: 'nervous' }]), { camera: BUST(0.5) }),
    shot('fine-2', 4.3, 'but I am totally fine now!', nami(0.5, [{ t: 0, move: 'talk', face: 'nervous' }]), { camera: CHEST(0.5) }),
    // 0:58.4 One finger up: the announcement.
    shot('cooking', 1.7, 'Anyway, the next video is getting cooked rn!', nami(0.55, [{ t: 0, move: 'oneup', face: 'surprised' }]), {
      camera: CLOSE(0.55, { zoom: 4.8 }),
    }),
    // 1:00.1 The stove gag: the pan on fire, peace sign.
    shot('stove', 2.4, 'Anyway, the next video is getting cooked rn!', nami(0.72, [{ t: 0, move: 'peace', face: 'smug' }]), {
      bg: { kind: 'kitchen' }, camera: CHEST(0.6), marks: [{ kind: 'pan', x: 0.3, y: 0.66, size: 1.1 }, { kind: 'label', text: 'next video', x: 0.3, y: 0.86, to: [0.3, 0.74], t: 0.4 }],
    }),
    shot('soon', 1.4, 'It should be out super soon, so stay tuned!', nami(0.5, [{ t: 0, move: 'nod', face: 'nervous' }]), { camera: BUST(0.5, { zoom: 4.6 }) }),
    shot('tuned', 2.2, 'It should be out super soon, so stay tuned!', nami(0.5, [{ t: 0, move: 'fistup', face: 'joy' }], -1), { camera: CHEST(0.52) }),
    // 1:05.8 The thanks: hands together, blushing, a heart.
    shot('thanks', 5.9, 'Thank you to everyone who subscribed, left a comment or even just watched!', nami(0.55, [{ t: 0, move: 'palms', face: 'shy' }]), {
      camera: { zoom: 3.8, x: 0.55, y: 0.5 }, marks: [{ kind: 'heart', x: 0.28, y: 0.45, t: 0.4 }],
    }),
    // 1:11.5 The posture PSA, shrimp before and after.
    shot('posture-pls', 1.3, 'fix your posture,', [], {
      camera: { zoom: 1, x: 0.5, y: 0.5 },
      marks: [{ kind: 'shrimp', text: 'before', x: 0.45, y: 0.55, size: 1.3 }, { kind: 'label', text: 'you before', x: 0.74, y: 0.42, to: [0.62, 0.5], t: 0.2 }],
    }),
    shot('posture-after', 1.5, 'fix your posture,', [], {
      camera: { zoom: 1, x: 0.5, y: 0.5 },
      marks: [{ kind: 'shrimp', text: 'after', x: 0.45, y: 0.5, size: 1.3 }, { kind: 'label', text: 'you after', x: 0.68, y: 0.3, to: [0.56, 0.36], t: 0.1 }],
    }),
    // Bookend: hands on her cheeks, a wink, a star.
    shot('bye', 3, 'See you in the next video! Bye!', nami(0.5, [{ t: 0, move: 'cheeks', face: 'wink' }]), {
      camera: BUST(0.5), marks: [{ kind: 'sparkle', x: 0.3, y: 0.62, t: 0.4 }],
    }),
  ],
};
