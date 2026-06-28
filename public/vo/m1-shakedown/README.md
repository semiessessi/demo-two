# VO recording script — Mission 1: "Shakedown"

Record each line below and save it in **this folder** (`public/vo/m1-shakedown/`) as the **exact filename**
shown (e.g. `house.checkin.mp3`). Reload the game and it just plays — no code changes needed.

- **Format:** mono, 44.1 or 48 kHz. `.mp3` (small) or `.wav` (lossless) — both work; `.mp3` wins if both exist.
- **Loudness:** aim ~ -16 LUFS, trim silence off the ends.
- **Missing a line?** No problem — it shows as a subtitle only until the file exists, so you can record them
  one at a time and check each in-game.
- The **subtitle text + on-screen timing** live in `src/campaign/m1-shakedown.js` (the `lines` map). The
  text here is what the player reads; match it (small ad-libs are fine — gameplay keys off the filename,
  not the words).

Mission tone: a quiet first patrol that turns grim. Starts light/banter, ends on a wreck with no survivors.

---

## HOUSE — squadron CO  (file prefix `house.`)
British woman, Royal Navy/Marines officer seconded to the carrier. Dry, composed, understated — command
voice without shouting. Her creed: there's no such thing as luck, only odds you didn't read. Gallows wit
underneath. (Think calm authority that only cracks at the worst moment.)

| File | Line | ~len |
|---|---|---|
| `house.checkin.mp3` | "Longshot flight, this is House. Cleared for the nav arc. Comeout — you're the new dice in the cup. Try not to roll low." | 6s |
| `house.nav1.mp3` | "Mark NAV-1. Come right for the relay buoy, steady as she goes." | 4.5s |
| `house.distress.mp3` | "Flight, House — the buoy's squawking a distress code. Go and look." | 4.5s |
| `house.rtb.mp3` | "Log it and bring them home, Longshot. No such thing as luck out here — only who got there first. House out." | 6.5s |

## HARDWAY — your flight lead  (file prefix `hardway.`)
By-the-book grinder, the moral centre of the squadron. Steady, disciplined, unflappable. Plays it straight.
The "too late" line should land heavy and quiet — the moment the mission's mood drops.

| File | Line | ~len |
|---|---|---|
| `hardway.formup.mp3` | "Comeout, Hardway. Tuck in on my wing and fly the arc by the numbers. No heroics out here." | 5.5s |
| `hardway.toolate.mp3` | "...Contact. It's a hauler. Or it was. No squawk. No survivors. We're too late." | 6s |

## BOXCARS — hotshot wingman  (file prefix `boxcars.`)
Cocky glory-hound, always grinning, always gambling. Here he's ribbing the rookie. Light, fast, a little
too pleased with himself.

| File | Line | ~len |
|---|---|---|
| `boxcars.banter.mp3` | "Rookie's first patrol. Twenty creds says he white-knuckles the whole arc." | 4.5s |

## SNAKE-EYES — wingman  (file prefix `snakeeyes.`)
The unlucky one who somehow never dies — a weary fatalist. Dry, flat, seen-it-all. Deadpan delivery.

| File | Line | ~len |
|---|---|---|
| `snakeeyes.banter.mp3` | "No bet. Quiet's how it always starts, Box." | 3.5s |

---

## Order the player hears them (for context)
1. `house.checkin` — cleared for patrol, ribs the rookie ("Comeout")
2. `hardway.formup` — your lead tells you to form up
3. `boxcars.banter` → 4. `snakeeyes.banter` — wingmen bicker (back-to-back)
5. `house.nav1` — turn for the relay buoy (at NAV-1)
6. `house.distress` — the buoy is squawking a distress code (at NAV-2)
7. `hardway.toolate` — you reach the wreck; no survivors
8. `house.rtb` — log it, come home (mission ends)

The **player ("Comeout") has no lines** in M1 — you're the silent new arrival.
