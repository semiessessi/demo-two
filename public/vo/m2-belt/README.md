# VO recording script — Mission 2: "Battle of the Belt"

Record each line and save it in **this folder** (`public/vo/m2-belt/`) with the **exact filename** shown
(e.g. `house.arrive.mp3`). Reload and it just plays — no code changes. Same rules as M1: mono, ~-16 LUFS,
`.mp3`/`.ogg`/`.wav`; missing files fall back to subtitle-only.

**Mission:** First combat — and a rescue. Jumping out of Groombridge, the 88th arrives in **the Belt** (the
Trojan asteroid fields at Jupiter) to find the **58th "Wild Cards"** (off the Saratoga) swarmed and being
torn apart. Form up, break, and clear the Chigs off them — **three escalating waves**. Tone: adrenaline +
stakes (people are dying); Boxcars loving it, Snake-Eyes dreading the count, House steady. Ends on a
hard-won save of the Wild Cards.

---

## HOUSE — squadron CO  (files `house.*`)
Dry, composed, in command. Steady under fire; the closing line is quietly proud — the 88th made the
difference and no one will ever know.

| File | Line | ~len |
|---|---|---|
| `house.arrive.mp3` | "Longshot flight, House. The Wild Cards are down in the rocks, swarmed — Saratoga's lost contact. We are the rescue. Form on Hardway, then we go in." | 7.5s |
| `house.push.mp3` | "More inbound — they want the 58th dead. Keep your spacing, stay between them and the Wild Cards." | 5.5s |
| `house.holds.mp3` | "That's the last of them. The Wild Cards are clear — they'll make the Saratoga. Good flying, Comeout. Form up, we're going home." | 7s |

## HARDWAY — your flight lead  (files `hardway.*`)
Calm pro turning into a fighting lead — "break and engage" is the mission kicking off; authority + the
tactical tip baked in.

| File | Line | ~len |
|---|---|---|
| `hardway.break.mp3` | "There they are — 58th, taking a beating. Break and engage, weapons free! Pull the Chigs off them; don't chase the runners." | 6s |

## BOXCARS — hotshot wingman  (files `boxcars.*`)
Cocky, gleeful — first to score and bragging, but it's also reassurance to the people he's saving.

| File | Line | ~len |
|---|---|---|
| `boxcars.splash.mp3` | "Splash one! Hold on, Wild Cards — the Longshots are buying you out." | 4.5s |

## SNAKE-EYES — wingman  (files `snakeeyes.*`)
Fatalist gallows humour as the odds get worse. Dry, deadpan, unbothered-but-grim.

| File | Line | ~len |
|---|---|---|
| `snakeeyes.odds.mp3` | "Whole sky full of teeth. Just the odds I like — terrible." | 4s |

---

## Order the player hears them
1. `house.arrive` — the Wild Cards are swarmed; we're the rescue; form up
2. `hardway.break` — break and engage (wave 1 spawns; the flight breaks to fight)
3. `boxcars.splash` — first kill (wave 2 spawns)
4. `house.push` → 5. `snakeeyes.odds` — heavier wave (wave 3 spawns)
6. `house.holds` — the Wild Cards are clear (mission complete)

The player ("Comeout") is silent.
