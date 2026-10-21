// Rules learned from XIAO's two DO reference videos (library f1 "Come Watch My
// First Video", f2 "What is happening on YouTube"; analyses in
// docs/handoff/studio-ref-f1.md and -f2.md, thread #425). They ship with the
// code so every studio team gets them, next to the rules XIAO teaches on the
// page (hub:studio:rules). Keep each line short: agents read all of them.
export const REF_RULES_VERSION = 1;

export const REF_RULES = [
  'Format: an animated talking-head vlog. One narrator character speaks to the viewer; each spoken line is its own short scene (shot) with its own caption.',
  'Hook: the first shot is under 1.5 s and is a reaction or a direct address ("Guys!", "Huh.") on a face close-up. The stakes (a shock, a question) land by 4 s.',
  'Cut rhythm: most shots 1.2-4 s (average about 2.5 s). Allow one or two long holds (5-8 s) for a big line, and a burst of 3-4 short shots (0.4-1.5 s) at the emotional peak. Contrast between slow and fast keeps attention.',
  'One focus point per shot: the face (or one prop) is the subject; at most one small secondary element (a handwritten label, an SFX word, a prop) sits on the opposite third. Everything else is empty background.',
  'Crop is the camera: change the framing on every new beat (bust close-up, extreme close-up for shock, waist-up for gestures, small full body for intros). Never use the same crop and pose in two neighbouring shots. The camera itself stays locked; at most a slow push-in on a held close-up.',
  'Default framing is a bust close-up: head and shoulders fill the frame, eyes about one third from the top, character slightly off-centre with room for a label on the other side.',
  'The lead is a beautiful young woman, on purpose: big eyes with lashes, iris colour and two catch lights, small nose and mouth, blush, soft messy layered hair with loose strands over the forehead, a hair colour that fades to a second colour at the tips, bare shoulders or a simple sleeveless top. Design polish on the face and hair matters more than anything else.',
  'One outline colour for everything (a dark plum or maroon, never pure black), shared with label and SFX text, so the frame reads as one pen. Flat colour fills, little or no shading; line art only (no fills) is also on-model.',
  'Home background: one flat pale colour (sky blue #e4f5ff or white) that returns after every gag. Use a break colour only to mark a mood change (dark flash, dusk violet for "last night").',
  'Each line gets one drawn gag: a new expression and pose, plus a handwritten label with an arrow, an SFX word (SHOCK, RAHHH), sweat drops, sparkles or shock lines that pop in on the beat. The joke is drawn, not explained.',
  'Motion is smooth and clean: held poses with small loops (blinks, breathing, a hand wiggle, hair sway), one clear pose change per beat with ease in and out. Big motion only at shock or peak beats. No jitter, no popping features.',
  'Captions: one style and one place for the whole video (top centre or bottom centre), white with a dark outline, one or two lines, changing with each phrase, never covering the face.',
  'Bookend: end in the same outfit and crop family as the start, on a cute or waving pose and a goodbye line ("See you in the next video! Bye!").',
];

export const REF_RULES_TEXT = REF_RULES.map((r) => `- ${r}`).join('\n');
