# VO recording script — Mission 2: "Battle of the Belt"

Record each line and save it in **this folder** (`public/vo/m2-belt/`) with the **exact filename** shown
(e.g. `house.arrive.mp3`). Reload and it just plays — no code changes. Same rules as M1: mono, ~-16 LUFS,
`.mp3`/`.ogg`/`.wav`; missing files fall back to subtitle-only.

**Mission:** First combat. Jumping out of Groombridge, the flight arrives in **the Belt** (the Trojan
asteroid fields at Jupiter) to find the Chigs driving for the inner system. Hold formation, then break and
fight **three escalating waves**. Tone: adrenaline, the squad finding its teeth — Boxcars loving it,
Snake-Eyes dreading the count, House steady. Ends on a hard-won "the line holds."

---

## HOUSE — squadron CO  (files `house.*`)
Dry, composed, in command. Steady under fire; a rare warm beat at the end ("maybe you'll last after all").

| File | Line | ~len |
|---|---|---|
| `house.arrive.mp3` | "Longshot flight, House. Welcome to the Belt — the Chigs are pushing through the Trojans for the inner system. This is the line. Hold formation till they commit." | 7.5s |
| `house.push.mp3` | "Second wave, heavier. Hold your spacing and keep the line, Longshot." | 5s |
| `house.holds.mp3` | "That's the last of them. The line holds. Good flying, Comeout — maybe you'll last after all." | 6.5s |

## HARDWAY — your flight lead  (files `hardway.*`)
Calm pro turning into a fighting lead — the "break and engage" call is the mission kicking off; deliver it
with authority and the tactical tip baked in.

| File | Line | ~len |
|---|---|---|
| `hardway.break.mp3` | "Here they come. Break and engage — weapons free! Turn with them, don't chase. Pick your shots." | 5.5s |

## BOXCARS — hotshot wingman  (files `boxcars.*`)
In his element at last — cocky, gleeful, first to score and bragging about it.

| File | Line | ~len |
|---|---|---|
| `boxcars.splash.mp3` | "Splash one! Hah — told you I'd open the book. Who's next?" | 4.5s |

## SNAKE-EYES — wingman  (files `snakeeyes.*`)
Fatalist gallows humour as the odds get worse. Dry, deadpan, unbothered-but-grim.

| File | Line | ~len |
|---|---|---|
| `snakeeyes.odds.mp3` | "Count's climbing. Just the odds I like — terrible." | 4s |

---

## Order the player hears them
1. `house.arrive` — welcome to the Belt; hold formation
2. `hardway.break` — break and engage (wave 1 spawns; the flight breaks to fight)
3. `boxcars.splash` — first kill (wave 2 spawns)
4. `house.push` → 5. `snakeeyes.odds` — heavier wave (wave 3 spawns)
6. `house.holds` — the line holds (mission complete → leads into M3)

The player ("Comeout") is silent.
