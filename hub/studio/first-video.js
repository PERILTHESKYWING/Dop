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
// Crops, re-measured on f2's stills for headSize 1.2: each shot puts her hair top,
// chin and head centre where f2's still for the same moment has them (as shares of
// the frame), and keeps the hair below the caption band (top 13%). zoom = head
// height share x 900 / 125 (her hair-top-to-chin is about 125 stage px).
const cam = (zoom, x, y) => ({ zoom, x, y });
const nami = (x, beats, facing = 1) => [{ who: 'nami', x, facing, beats }];
const shot = (id, duration, narration, actors, more = {}) => ({ id, duration, bg: HOME, narration, actors, ...more });

export const FIRST_VIDEO = {
  title: 'What is happening?! (ref copy)',
  idea: 'Animated vlog: a young artist talks to the camera about her first video blowing up. Shot-for-shot copy of reference f2 with a new character.',
  stage: 'full',
  style: { fps: 12, hold: 2, boil: 0.3, wobble: 0.8, line: 2.6, shade: 0, misregister: 0, grain: 0.1, paper: '#e4f5ff', ink: '#3a2a3f', capPos: 'top', faceCam: true },
  cast: {
    nami: {
      name: 'Nami', height: 1, headSize: 1.2, build: 'petite',
      skin: '#f6e0da', hair: '#2b2d57', hair2: '#3fb8b0', eyeColor: '#2a9d9a',
      top: '#3b3040', bottom: '#3a3f55', shoes: '#2a2340',
      hairStyle: 'shag', eyes: 'anime', jaw: 'v', topStyle: 'sleeveless', bottomStyle: 'skirt',
      extras: ['lashes', 'blush', 'blushlines', 'ahoge'],
    },
  },
  scenes: [
    // 0:00 Hook: "Guys!" on a bust, hand to the cheek, worried (f2 still 0: hair top 16%, chin 64%, head at x 43%).
    shot('guys', 1.1, 'Guys!', nami(0.5, [{ t: 0, move: 'cheek', face: 'worried', roll: 10 }]), { camera: cam(3.45, 0.52, 0.49) }),
    // 0:01.1 A 0.3 s jump cut: same line, a touch closer, the hand settles.
    shot('guys-2', 0.3, 'Guys!', nami(0.5, [{ t: 0, move: 'cheek', face: 'worried', quiet: true }]), { camera: cam(3.6, 0.52, 0.485) }),
    // 0:01.4 Points back at her first video's thumbnail, blank shock (still 4: head at right, x 72%).
    shot('three-days', 2.9, 'It literally has been three days!', nami(0.64, [{ t: 0, move: 'point', face: 'shock' }], -1), {
      camera: cam(3.1, 0.553, 0.473), props: [{ kind: 'thumb', x: 0.38, y: 0.47, scale: 1, text: 'WHERE YOU|GOING?' }],
    }),
    // 0:04.3 The stakes: big head, a hand clawed on her shoulder, SHOCK and the squiggle (still 6).
    shot('subs', 1.5, 'dym I already have like 2k subscribers???', nami(0.5, [{ t: 0, move: 'clasp', face: 'shock' }]), {
      camera: cam(5.5, 0.508, 0.488), marks: [{ kind: 'sfx', text: 'SHOCK', x: 0.82, y: 0.32 }, { kind: 'lines', x: 0.17, y: 0.42 }],
    }),
    // 0:05.8 Her goal sign, the 1 struck out and a 2 written over it; only her hair crown
    // peeks up from the bottom edge (still 11).
    shot('sign', 2.5, 'dym I already have like 2k subscribers???', [], {
      camera: cam(1, 0.5, 0.5), marks: [{ kind: 'board', text: '1000 Follower', x: 0.49, y: 0.245, size: 1.75 }, { kind: 'peek', x: 0.48, y: 0.73, t: 0.3 }, { kind: 'label', text: 'Just woke up', x: 0.8, y: 0.74, to: [0.63, 0.79], t: 0.6 }],
    }),
    // 0:08.3 Big glossy "lens" eyes, a small smile, sweat: "you are scaring me" (still 12: the head fills the middle).
    shot('scaring', 3, 'no frr, you guys are so scaring me rn...', nami(0.5, [{ t: 0, move: 'idle', face: 'lens' }]), {
      camera: cam(4.1, 0.493, 0.47),
    }),
    // 0:11.3 A 0.5 s beat: a tear falls (still 14).
    shot('scaring-2', 0.5, 'no frr, you guys are so scaring me rn...', nami(0.5, [{ t: 0, move: 'fidget', face: 'lens', quiet: true }]), {
      camera: cam(4.25, 0.489, 0.473), marks: [{ kind: 'tear', x: 0.395, y: 0.66, t: 0 }],
    }),
    // 0:11.8 At the desk, hunched over the tablet; the shrimp on its stool is "my posture" (still 15).
    shot('posture', 4.3, 'I was actually in the middle of drawing', nami(0.4, [{ t: 0, move: 'slump', face: 'cat' }]), {
      camera: cam(2.74, 0.429, 0.508),
      marks: [{ kind: 'desk', x: 0.465, y: 0.86, text: 'phone' }, { kind: 'shrimp', text: 'desk', x: 0.73, y: 0.6, size: 0.42, t: 0.6 }, { kind: 'label', text: 'My|posture', x: 0.85, y: 0.45, to: [0.77, 0.53], t: 0.8 }],
    }),
    // 0:16.1 Impact: a 0.3 s colour flash.
    { id: 'flash', duration: 0.3, bg: { kind: 'plain', color: '#6e3346' }, narration: 'when I decided to do this side quest', actors: [] },
    // 0:16.4 Speed lines slash across her at the desk; a "!" and a message pop up (stills 17, 19).
    shot('side-quest', 3.2, 'when I decided to do this side quest', nami(0.4, [{ t: 0, move: 'slump', face: 'cat' }]), {
      camera: cam(2.88, 0.418, 0.517),
      marks: [{ kind: 'desk', x: 0.465, y: 0.86, text: 'phone' }, { kind: 'speed', x: 0.52, y: 0.46 }, { kind: 'exclaim', x: 0.25, y: 0.56, t: 0.2 }, { kind: 'bubble', text: 'Message', x: 0.24, y: 0.83, t: 0.5 }],
    }),
    // 0:19.6 f2 cuts to its stern mascot (white blob, pencil) alone on the home colour (still 20).
    shot('feelings', 5.5, 'to express my feelings, my confusion towards you guys', [], {
      camera: cam(1, 0.5, 0.5), props: [{ kind: 'mascot', x: 0.5, y: 0.59, scale: 1.25 }],
    }),
    // 0:25.1 Front bust down to the chest, nervous grin (still 23).
    shot('confused', 1.2, 'to express my feelings, my confusion towards you guys', nami(0.5, [{ t: 0, move: 'idle', face: 'nervous' }]), { camera: cam(3.31, 0.506, 0.503) }),
    // 0:26.3 The empty home frame for a beat...
    shot('empty', 0.3, 'so here I am!', [], { camera: cam(1, 0.5, 0.5) }),
    // 0:26.6 ...then she pops back in.
    shot('here', 3.6, 'so here I am!', nami(0.5, [{ t: 0, move: 'jump', face: 'joy' }]), { camera: cam(3.46, 0.498, 0.481), marks: [{ kind: 'sparkle', x: 0.72, y: 0.3, t: 0.3 }] }),
    // 0:30.4 The "Gender" dropdown gag at left, finger on chin, HEHEHE (still 27: head at x 70%).
    shot('weird', 3.3, 'Just a weird artist on her art journey', nami(0.7, [{ t: 0, move: 'chin', face: 'cat' }]), {
      camera: cam(3.02, 0.628, 0.481), marks: [{ kind: 'card', text: 'Gender|Female|Male|Artist girl', x: 0.265, y: 0.49, size: 1.2 }, { kind: 'label', text: 'HEHEHE...', x: 0.49, y: 0.62, size: 0.9, t: 0.5 }, { kind: 'curl', x: 0.545, y: 0.25, t: 0.3 }],
    }),
    // 0:33.5 Phone in both hands, amazed; the big head over the phone (still 29).
    shot('comments', 3.9, 'and thank you all for the comments and support', nami(0.5, [{ t: 0, move: 'phone', face: 'surprised' }]), {
      camera: cam(4.46, 0.514, 0.456), marks: [{ kind: 'label', text: 'Woahh!!|So many|comments!!!', x: 0.83, y: 0.46, t: 0.4 }],
    }),
    // 0:37.4 Same, softer, with an "Aww!" cloud (still 30).
    shot('motivation', 2.6, 'it gave me so much motivation', nami(0.5, [{ t: 0, move: 'phone', face: 'happy' }]), {
      camera: cam(4.5, 0.512, 0.468), marks: [{ kind: 'bubble', text: 'Aww!', x: 0.13, y: 0.52, to: [0.25, 0.6], t: 0.1 }, { kind: 'label', text: 'Woahh!!|So many|comments!!!', x: 0.83, y: 0.46 }],
    }),
    // 0:39.1 The long hold: fist up, eyes squeezed shut, head left of centre (still 31).
    shot('cheer', 7.0, 'I started the next video right away, I was so pumped!', nami(0.5, [{ t: 0, move: 'fistup', face: 'joy' }], -1), { camera: cam(3.53, 0.548, 0.473) }),
    // 0:47.0 f2 cuts to a reaction picture: the shocked-cat photo and the apple mascot (still 32).
    shot('shocked', 3.3, 'but then I saw how long animating takes', [], {
      camera: cam(1, 0.5, 0.5), props: [{ kind: 'photo', text: 'cat', x: 0.27, y: 0.5, scale: 1.5 }, { kind: 'mascot', text: 'apple', x: 0.73, y: 0.58, scale: 1.25 }],
    }),
    // 0:50.0 Crash-out: rose break colour, palms over the face, eyes up; the face fills the frame, hair cut by the top (still 33).
    shot('crashout', 1.6, 'and crashed out in the middle of the night,', nami(0.5, [{ t: 0, move: 'cover', face: 'shock' }]), {
      bg: { kind: 'plain', color: '#c4a2a8' }, camera: cam(8.4, 0.515, 0.484),
    }),
    // 0:51.5 "Footage of last night": dusk violet, RAHHH; she lies folded over at the left, head upside down on the floor (still 34), a drawn gag because the rig cannot fold like that.
    shot('last-night', 2, 'and crashed out in the middle of the night,', [], {
      bg: { kind: 'plain', color: '#6f6886' }, camera: cam(1, 0.5, 0.5),
      marks: [{ kind: 'collapse', x: 0.293, y: 0.579 }, { kind: 'sfx', text: 'RAHHH!!!', x: 0.6, y: 0.32, to: [0.75, 0.26], size: 1.4, t: 0.1 }, { kind: 'label', text: '*Footage of|last night', x: 0.75, y: 0.54, size: 1.2, t: 0.4 }],
    }),
    // 0:53.5 Back home, nervous grin, front on (stills 35, 36).
    shot('fine', 0.6, 'but I am totally fine now!', nami(0.5, [{ t: 0, move: 'idle', face: 'forced' }]), { camera: cam(3.6, 0.504, 0.49) }),
    shot('fine-2', 4.3, 'but I am totally fine now!', nami(0.5, [{ t: 0, move: 'talk', face: 'forcedSquint', roll: 12 }]), { camera: cam(3.38, 0.509, 0.498) }),
    // 0:58.4 One finger up: the announcement, tight on the face, the hand at left (still 37).
    shot('cooking', 1.7, 'Anyway, the next video is getting cooked rn!', nami(0.55, [{ t: 0, move: 'oneup', face: 'surprised', roll: 10 }]), { camera: cam(5.84, 0.554, 0.467) }),
    // 1:00.1 The stove gag: a grey cooker, the pan on fire, she leans in at right in
    // sunglasses with a peace sign (still 38).
    shot('stove', 2.4, 'Anyway, the next video is getting cooked rn!', nami(0.72, [{ t: 0, move: 'peace', face: 'smug' }]), {
      camera: cam(2.74, 0.655, 0.472),
      props: [{ kind: 'stove', x: 0.21, y: 0.68, scale: 1 }, { kind: 'pan', x: 0.37, y: 0.62, scale: 0.85, text: 'VIDEO 2|IDEAS' }],
      marks: [{ kind: 'shades', x: 0.68, y: 0.5, size: 0.9 }],
    }),
    // 1:02.5 Lower in the frame, eyes shut, teeth clenched (still 39).
    shot('soon', 1.4, 'It should be out super soon, so stay tuned!', nami(0.5, [{ t: 0, move: 'nod', face: 'grimace' }]), { camera: cam(3.02, 0.517, 0.448) }),
    shot('tuned', 2.2, 'It should be out super soon, so stay tuned!', nami(0.5, [{ t: 0, move: 'fistup', face: 'joy' }], -1), { camera: cam(3.53, 0.545, 0.473) }),
    // 1:05.8 The thanks: hands together, eyes shut content, a little heart tossed off, right of centre (still 43).
    shot('thanks', 5.9, 'Thanks to all who subscribed, commented or just watched!', nami(0.55, [{ t: 0, move: 'palms', face: 'content' }]), {
      camera: cam(3.38, 0.508, 0.494), marks: [{ kind: 'heart', x: 0.3, y: 0.67, size: 0.75, t: 0.4 }],
    }),
    // 1:11.5 The posture PSA: the hunched shrimp, its feeler hooked up off the top, then the one standing tall; the caption at the left middle (stills 44, 46).
    shot('posture-pls', 1.3, 'fix your posture,', [], {
      camera: cam(1, 0.5, 0.5),
      capAt: [0.057, 0.37],
      marks: [{ kind: 'shrimp', text: 'before', x: 0.496, y: 0.44, size: 0.93 }, { kind: 'label', text: 'you|before', x: 0.68, y: 0.31, to: [0.575, 0.36], t: 0.2 }],
    }),
    shot('posture-after', 1.5, 'fix your posture,', [], {
      camera: cam(1, 0.5, 0.5), capAt: [0.057, 0.37],
      marks: [{ kind: 'shrimp', text: 'after', x: 0.47, y: 0.61, size: 1 }, { kind: 'label', text: 'you|after', x: 0.66, y: 0.25, to: [0.57, 0.27], t: 0.1 }],
    }),
    // Bookend: fists under her chin, a wink, a star thrown off (still 47).
    shot('bye', 3, 'See you in the next video! Bye!', nami(0.5, [{ t: 0, move: 'cheeks', face: 'wink', roll: 12 }]), {
      camera: cam(2.95, 0.484, 0.469), marks: [{ kind: 'star', x: 0.31, y: 0.77, to: [0.37, 0.66], size: 0.9, t: 0.4 }],
    }),
  ],
};
