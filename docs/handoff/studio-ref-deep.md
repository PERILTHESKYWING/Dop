# Deep pass on the two reference videos (sound, script, motion)

Companion to `studio-ref-f2.md` (and Alt 2's `studio-ref-f1.md`, on its own branch; this file is separate to avoid merge conflicts). f1 = "Come Watch My First Video" (1:54), f2 = "What is happening on YouTube" (1:15.8).

What could and could not be measured:
- f1: Gemini watched it with sound (saved in the library, `lib_get f1`). Its notes are used below; timings come from the code timeline where they disagree.
- f2: `lib_watch` failed three times (Gemini 503 / timeout). So f2 has NO verified voice, music or SFX notes. Only loudness (3-7 of 9, never silent, ~2 hits per second), hit times and the on-screen subtitles are known. Re-run `lib_watch f2` when Gemini is up and append the result here.
- Stills from `lib_get from/to` are sampled around cuts, not every frame. Drawing rate is therefore read from how different neighbouring stills are, not counted frame by frame. Treat the numbers as estimates.

## Sound (f1, from Gemini)
- Voice: female, energetic, conversational, close-mic, clean, throughout. Subtitles pop in and out per word group, bottom centre, plain sans, in sync with speech.
- Music: gentle upbeat acoustic/lo-fi bed under the voice, never competing with it.
- SFX: a "pop" on every text or graphic reveal (0:04.5, 0:08.8, 1:02.5); comedic slide-whistle/whoosh on fast moves and the final run (1:51.5).
- Cuts land on voice pauses: 0:08.6, 0:47.4, 1:11.4, 1:15.0, 1:15.8, 1:18.2. The picture changes when the sentence changes.
- f2 equivalent (measured only): 12 of 29 cuts within 0.1 s of a sound hit; the rest sit between words. No steady beat, so the rhythm is the speech.

## Motion: how drawings change (from stills)
**Held pose with line boil.** f1 1:15.1-1:15.7 (four stills 0.3 s apart, flags beside the girl, "I ♥ ANIME and BAKA" shirt): same pose and framing, but hair strands and shirt lettering differ slightly in every still. That is a redraw per hold: the pose does not move, the lines shimmer. Rule: a "still" shot is never a frozen image; redraw the lines every 2-3 frames with small wobble (the studio already has `boil` and `hold`).

**Burst after a hold (f1 1:15.9-1:16.3, "especially BL.").** Stills 0.1 s apart show a different drawing each time: extreme close-up, heart glasses, eyes squeezed shut, then a smirk, then an open grin, with hair locks changing shape. So the burst runs at roughly 8-12 different drawings per second ("on ones/twos"), against about 4-6 per second ("on twos/threes") in the held shots around it. The speed-up is the joke: calm hold, then a fast change that peaks on the punchline word.
- Anticipation: before the burst the character holds a neutral, slightly annoyed pose (1:15.1-1:15.7), so the burst reads as a reaction.
- Scale jump: the cut goes from waist-up to extreme close-up (face fills the frame, eyes at the upper third, mouth in the lower third), a 2.5-3x change.
- Expression chain inside one shot: smug closed-eye, eyes narrowed, closed-mouth smile, grin. Four mouth shapes in 0.4 s.

**Soft landing (f1 1:41.5).** After the long middle, a shoulder-shrug pose with closed happy eyes, tongue out, a heart speech bubble and a hand on the shoulder, two-line subtitle. A cute held pose gives the viewer a rest before the goodbye.

**f1 opening (1:01-1:03 in the brief, actually 0:01.5).** First still at 0:01.5: extreme close-up, eyes wide, small round "o" mouth, blush ticks, no colour at all, just the burgundy line, subtitle "What??". Face fills the frame and the first spoken beat is a reaction, not an explanation.

**f2 key moments (stills at cuts only).**
- Wind smear 0:16.1-16.4: three frames. 0:16.1 calm desk pose with "!" bubble and "Message" label; 0:16.3 one full-frame maroon colour frame (a 0.1-0.3 s flash that acts as impact frame); 0:16.4 same pose crossed by long diagonal smear strokes in the outline colour, hair blown. Total time 0.3 s: anticipation (calm), impact (flash), result (smear). The sudden event is shown in one frame and is gone before the viewer can study it.
- Wave 0:39.2: the full-frame "cheer" pose, one arm up with a round hand (drawn as a simple circle on a limb), eyes as `>` `<` marks, wide open mouth with teeth, blush. The pose is held for 7.8 s (0:39.1-0:47.0) while the voice talks; the movement inside is small loops. The same pose returns at 1:03.7-1:05.8 to bookend "stay tuned".
- Crashout 0:50-0:54: three different drawings in 3.5 s. 0:50.0 polished close-up, hands over nose, rendered with cel shadows on a beige/mauve background; 0:51.5 flat doodle of the girl face-down in a heap on a dusk violet ground with "RAHHH!!!" and "* Footage of last night" written beside her; 0:53.6 back on the blue home colour in a nervous half-grin with a tear line and sweat drop. The rendering style changes with the mood (clean cel -> rough doodle -> clean flat), and each change has a handwritten label that tells the viewer what they are seeing.

## What moves during holds (both videos)
- Line boil on every held drawing (above).
- Blinks and tiny mouth changes on speech, not constant.
- Hair sway on hair locks (separate locks are drawn so a few can differ between drawings).
- Props (floating icon, bubbles, sparkle glyphs) bob or twitch a little.
- The body rarely translates; poses are swapped, not tweened. f1 swaps poses with no crossfade, "snap" in about 150-300 ms (Gemini's estimate); f2 the same.
- Popped text/graphics ease with a small overshoot (scale 0.8 -> 1.0 in about 200 ms) in f1, per Gemini.

## Script and per-line table: f2 (partial, from visible subtitles)
Only lines whose subtitle was readable are given. Times are shot starts from the timeline. Voice tone unverified.

| Time | Words (subtitle) | Expression | Pose | Gag / prop | Crop |
|---|---|---|---|---|---|
| 0:00 | "Guys!" | uneasy, mouth slightly open | hand at cheek | none | head and shoulders |
| 0:01.4 | "It literally has been three days!" | anxious, teeth-grit | arm pointing at a card (a thumbnail "WATCH YOU GO NUT") | meme card on left | waist-up, character at right |
| 0:04.3 | "And wdym I already have like 2k subscribers???" | shock, white eyes, sweat | hand on shoulder | "SHOCK" label, zigzag scribbles | close head and shoulders, centred |
| 0:05.9 | (same line) | none (hair only) | hair peeking from bottom | "1000 Follower" sign, "Just woke up" arrow | sign large, character tiny at bottom |
| 0:08.3 | "...you guys are so scaring me rn..." | red-faced, sweat, tiny smile | still bust | none | tight close, face fills frame |
| 0:11.8 | "I was actually in the middle of" | relaxed, sleepy smile | at desk | desk lamp-chair labelled "My posture", tablet, shrimp-shaped chair | small, wide, character left |
| 0:16.1 | "I decided to do this side quest" | focused smile | drawing, pen in hand | "!" bubble, "Message" label, wind smear | head and shoulders over desk |
| 0:19.6 | "because I wanted to express my feelings," | deadpan | white ghost blob with pencil | chibi substitute | tiny centre figure, lots of blue |
| 0:25.0 | "...my confusion towards you guys" | nervous grin with teeth | hands down | none | waist-up |
| 0:26.3 | "so here I am!" | (empty blue frame) | none | beat of silence/space before the reveal | empty |
| 0:30.4 | "...weird fujoshi on her art journey" | sly, finger on chin | head tilt | "Gender" dropdown: Female / Male / Fujoshi highlighted, "HEHEHE..." | character right, UI left |
| 0:33.5 | "...so many comments and support" | wide-eyed delight | holds a phone | "Woahh!! So many comments!!!" | bust close |
| 0:37.4 | "...so much motivation" | soft smile | same | speech bubble "Aww!" | bust close |
| 0:39.1 | (line about being happy) | `>` `<` eyes, open grin | arm raised | none | big, cropped, arm up at right |
| 0:47.0 | "...cracked" | (none) | cat meme + red apple mascot | reaction image | two small items |
| 0:50.0 | "Uhm, I was having a crashout" | wide eyes over hands | hands on nose | cel-shaded style change | extreme close |
| 0:51.5 | "in the middle of the night," | eyes closed | face-down heap | "RAHHH!!!", "* Footage of last night" | wide, small figure, dusk colour |
| 0:53.6 | (apologetic line) | nervous grin, tear, sweat | hands down | none | waist-up |
| 0:54.2 | (same) | grin | still | none | waist-up |
| 0:58.4 | "...getting cooked rn!" | pleased, finger up | one finger raised | cooking pan on fire, sunglasses | head and shoulders |
| 1:02.5 | "...coming out super soon!" | happy squint | head tilt | none | bust |
| 1:03.7 | "sooo stay tuned for that!" | `>` `<`, grin | arm up (same pose as 0:39) | none | big |
| 1:11.5 | "...subscribed, left a comment or even just watched!" | blushing, content | clapping hands near cheek | floating heart | waist-up |
| 1:11.6 | "fix your posture," | n/a | shrimp "you before" curled, then "you after" straight | joke diagram | object only |
| 1:15.8 | "...will see you in the next video! Bye!" | wink, tongue out | hands under chin | star sparkle | waist-up |

## Per-line table: f1 (from Gemini and stills, summarised)
| Time | Words | Expression | Pose | Gag / prop | Crop |
|---|---|---|---|---|---|
| 0:00 | "Huh." / "What??" | puzzled, wide eyes, "o" mouth | frontal, line art only | handwritten bubble | extreme close, face fills frame |
| 0:01.4 | greeting | excited | zoom in, then wide | bubble text "PEGI" left | wide |
| 0:08.6 | intro to channel | pointing | finger up | YouTube icon floats left | medium |
| 0:13.4 | inspirations | smug | three bust sketches | none | three small busts |
| 0:16.6-0:40.6 | storytelling, "yapping" | many: anxious, thinking, pen in hand | fast pose swaps every 1-3 s | chef outfit, "STORYTELLING" with sparkles, "* YAPPING *" | mixed |
| 0:40.6 | (blushing reaction) | cheeky blush | close | none | close |
| 0:44.2 | poking the viewer | teasing | rapid arm thrust | two characters | medium |
| 1:02.2 | name checklist | mild | tapping a tick | "Name [x] / ??? [ ] / ??? [ ]" | bust, UI at right |
| 1:05.4 | "I love anime and baka" | proud | hands on hips | German and Korean flags, "I ♥ ANIME BAKA" shirt | waist-up, flags left |
| 1:11.4 | manga montage | screaming | bottom-right corner | covers collage | collage with small figure |
| 1:15.0 | "especially BL." | smug, heart glasses | burst of 4 mouths | scale jump | extreme close |
| 1:18.2 | embarrassed | blush | chibi with bandage marks | none | bust |
| 1:41.4 | "So, if that sounds like something you would enjoy" | happy, tongue out | hand on shoulder | heart speech bubble | bust |
| 1:41-1:54 | goodbye | wave | empty white frame, then a crawling run off-screen | slide-whistle | wide, empty |

## Rules this suggests (feeds `studio-rules.md`)
1. Silence the picture on a held line by redrawing, not freezing. Hold 2-3 frames, boil on.
2. Run a fast drawing burst (every 1-2 frames) only on the punchline word; otherwise 4-6 drawings per second.
3. Put a calm "anticipation" hold before every burst, a flash or smear impact frame (0.1-0.3 s), then the result.
4. Change the rendering style (clean cel / rough doodle / flat) to change the mood, and write a handwritten label saying what the footage is.
5. Cut on a speech pause; the picture changes when the sentence changes. Pop SFX on each text reveal.
6. Open on a face with a reaction line (f1 "What??", f2 "Guys!" then shock), never an explanation.
7. Give the viewer a held cute pose before the sign-off, and reuse an earlier pose for the bookend.
8. Use empty blue/white frames for silence beats: a gag like "so here I am!" (f2 0:26) works because the frame is empty before the character appears.
