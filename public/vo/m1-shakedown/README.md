# VO recording script — Mission 1: "Shakedown" (recon)

Record each line and save it in **this folder** (`public/vo/m1-shakedown/`) with the **exact filename**
shown (e.g. `house.checkin.mp3`). Reload the game and it just plays — no code changes needed.

- **Format:** mono, 44.1 or 48 kHz. `.mp3` (small) or `.wav` (lossless) both work; `.mp3` wins if both exist.
- **Loudness:** aim ~ -16 LUFS, trim the silence off the ends.
- **Missing a line?** Fine — it shows as a subtitle only until the file exists, so record them one at a time
  and check each in-game.
- The **subtitle text + timing** live in `src/campaign/m1-shakedown.js` (the `lines` map). Match the text
  below; small ad-libs are fine (the game keys off the filename, not the words).

**Mission + twist:** Command expects a Chig build-up massing at Groombridge 34. The flight forms up and runs
three recon marks — and finds **the system completely empty**. The build-up was here and *pulled out*. That's
worse than finding it: if they're not here, they're hitting somewhere undefended. The flight burns for home.
**Tone: tense recon → growing unease at the emptiness → urgency to get the warning home.** No combat.

---

## HOUSE — squadron CO  (files `house.*`)
British woman, Royal Navy/Marines, seconded to the carrier. Dry, composed, understated — command voice
without shouting. Believes there's no such thing as luck, only odds you didn't read. Starts businesslike;
the empty system visibly unsettles her by the end, but she stays controlled — and decisive about getting home.

| File | Line | ~len |
|---|---|---|
| `house.checkin.mp3` | "Longshot flight, House. Command's flagged a Chig build-up at Groombridge — your job is to confirm it. Form on Hardway, weapons cold. Eyes open." | 7s |
| `house.recon1.mp3` | "First mark logged. ...Nothing. Scope's stone cold — no reactors, no traffic. Keep going." | 6s |
| `house.recon3.mp3` | "Last mark. Staging grids are stripped — they were here, and they've pulled out. That's the whole system. Nothing left to find." | 7.5s |
| `house.rtb.mp3` | "If they're not here, they're hitting somewhere that is. Get this home now, Longshot — burn for the carrier. House out." | 7s |

## HARDWAY — your flight lead  (files `hardway.*`)
By-the-book grinder, the steady moral centre. Calm, patient — talks you through forming up like an instructor.
"Let's go count Chigs" is a light line that the empty system will make ironic.

| File | Line | ~len |
|---|---|---|
| `hardway.formup.mp3` | "Comeout — your slot's the blue box. Slide in nice and easy and hold it. Stay off the gas." | 5.5s |
| `hardway.in.mp3` | "Good, you're in the pocket. Flight, pushing up. Let's go count Chigs." | 4.5s |

## BOXCARS — hotshot wingman  (files `boxcars.*`)
Cocky glory-hound — here the swagger curdles into unease as his scope stays empty. A bit thrown.

| File | Line | ~len |
|---|---|---|
| `boxcars.empty.mp3` | "Boss, I've got a whole lotta empty out here. Where is everybody?" | 4.5s |

## SNAKE-EYES — wingman  (files `snakeeyes.*`)
The unlucky one who never quite dies — a weary fatalist. Dry, flat, deadpan. He's the one who names the dread.

| File | Line | ~len |
|---|---|---|
| `snakeeyes.quiet.mp3` | "Don't like it. A build-up doesn't just pack up and vanish." | 4s |

---

## Order the player hears them
1. `house.checkin` — confirm a suspected build-up; form on Hardway
2. `hardway.formup` — slot into the blue box
3. `hardway.in` — you're formed up; "let's go count Chigs"  *(after you reach the slot)*
4. `house.recon1` — first mark: nothing, scope's cold
5. `boxcars.empty` → 6. `snakeeyes.quiet` — the unsettling emptiness (back-to-back)
7. `house.recon3` — they were here and pulled out; nothing left
8. `house.rtb` — burn for home (mission ends at the carrier)

The **player ("Comeout") has no lines** in M1 — you're the silent new arrival.
