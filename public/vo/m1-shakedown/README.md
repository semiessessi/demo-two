# VO recording script — Mission 1: "Shakedown" (recon)

Record each line and save it in **this folder** (`public/vo/m1-shakedown/`) with the **exact filename**
shown (e.g. `house.checkin.mp3`). Reload the game and it just plays — no code changes needed.

- **Format:** mono, 44.1 or 48 kHz. `.mp3` (small) or `.wav` (lossless) both work; `.mp3` wins if both exist.
- **Loudness:** aim ~ -16 LUFS, trim the silence off the ends.
- **Missing a line?** Fine — it shows as a subtitle only until the file exists, so record them one at a time
  and check each in-game.
- The **subtitle text + on-screen timing** live in `src/campaign/m1-shakedown.js` (the `lines` map). Match the
  text below; small ad-libs are fine (the game keys off the filename, not the words).

**Mission:** a silent recon of Groombridge 34 — Command thinks the Chigs are massing for a push. Form up,
fly three nav marks, return to the carrier. Weapons cold, no combat. Tone: tense and hushed, not a milk run.

---

## HOUSE — squadron CO  (files `house.*`)
British woman, Royal Navy/Marines, seconded to the carrier. Dry, composed, understated — command voice
without shouting. Believes there's no such thing as luck, only odds you didn't read. This run she's tense
but controlled; the stakes are real.

| File | Line | ~len |
|---|---|---|
| `house.checkin.mp3` | "Longshot flight, House. Recon only — Groombridge's gone dark and Command thinks the Chigs are massing. Form on Hardway's wing, weapons cold. We look, we leave." | 7.5s |
| `house.recon1.mp3` | "First mark logged. Reactor bloom out there — something big is warming up." | 5s |
| `house.recon3.mp3` | "Third mark. It's a staging yard — they're building for a push. Get it all and get gone. Do not engage." | 6.5s |
| `house.rtb.mp3` | "That's the package. Bring it home, Longshot — we were never here. House out." | 5.5s |

## HARDWAY — your flight lead  (files `hardway.*`)
By-the-book grinder, the steady moral centre. Calm, patient, talks you through forming up like an instructor.

| File | Line | ~len |
|---|---|---|
| `hardway.formup.mp3` | "Comeout — your slot's the blue box. Slide in nice and easy and hold it. Stay off the gas." | 5.5s |
| `hardway.in.mp3` | "That's it, you're in the pocket. Flight, pushing up. Eyes on the scopes." | 4.5s |

## BOXCARS — hotshot wingman  (files `boxcars.*`)
Cocky glory-hound, but this is the moment his grin drops — he's the one who calls the wall of contacts.
Play it a little rattled under the swagger.

| File | Line | ~len |
|---|---|---|
| `boxcars.contacts.mp3` | "Boss, my scope's lit — hard contacts all along the far edge. That's a wall of Chigs." | 5.5s |

## SNAKE-EYES — wingman  (files `snakeeyes.*`)
The unlucky one who never quite dies — a weary fatalist. Dry, flat, deadpan.

| File | Line | ~len |
|---|---|---|
| `snakeeyes.quiet.mp3` | "Always the way. Quiet system, full of teeth." | 3.5s |

---

## Order the player hears them
1. `house.checkin` — the brief on the net; form on Hardway
2. `hardway.formup` — slot into the blue box
3. `hardway.in` — you're formed up; the flight pushes off  *(after you reach the slot)*
4. `house.recon1` — first mark logged; reactor bloom
5. `boxcars.contacts` → 6. `snakeeyes.quiet` — the wall of Chigs (back-to-back)
7. `house.recon3` — staging yard; get out, do not engage
8. `house.rtb` — bring it home (mission ends at the carrier)

The **player ("Comeout") has no lines** in M1 — you're the silent new arrival.
