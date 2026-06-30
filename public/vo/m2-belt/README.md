# VO recording script — Mission 2: "Battle of the Belt"

Record each line and save it in **this folder** (`public/vo/m2-belt/`) with the **exact filename** shown
(e.g. `hardway.break.mp3`). Reload and it just plays — no code changes. Mono, ~-16 LUFS, `.mp3`/`.ogg`/`.wav`;
missing files fall back to subtitle-only.

**Mission:** First combat — a rescue, flown in on **radio silence**. Jumping out of Groombridge, the 88th
runs in **dark** toward **the Belt** (the Trojan asteroid fields at Jupiter), hearing only the **58th "Wild
Cards"** (off the Saratoga) on the net as they're swarmed and torn apart. At contact the silence breaks —
form up, break, and clear the Chigs off them across **three escalating waves**. Tone: tense, held-breath
run-in → the net full of the 58th's fight → silence shattered → adrenaline. Boxcars loving it, Snake-Eyes
dreading the count, House steady. Ends on a hard-won save.

---

## EPISODE SAMPLES — the 58th on the net  (files `ep.belt1.*`, `ep.belt2.*`)
These two slots play **your audio clips** during the silent run-in (the Wild Cards' battle traffic we
overhear). Drop your files at `public/vo/m2-belt/ep.belt1.mp3` and `ep.belt2.mp3` and they play; absent, the
neutral caption shows instead. The on-screen captions are **descriptions, not transcripts** — I won't write
the show's lines into the game.

> ⚠️ **Heads-up:** these are meant for actual episode audio, which is copyrighted. Putting it on a public
> deploy (d2) is an infringement risk even for a non-commercial fan tribute. Your call as the owner — keeping
> clips short helps, or we re-voice the gist with our own cast instead.

| File | Plays during | Caption shown if no file |
|---|---|---|
| `ep.belt1.*` | start of the run-in | "[ Saratoga's 58th — the Wild Cards, under fire in the Belt ]" |
| `ep.belt2.*` | ~9s later, still closing | "[ 58th over the net — the fight turning against them ]" |

---

## HOUSE — squadron CO  (files `house.*`)
Dry, composed. (No run-in line now — we're silent inbound.) Steady mid-fight; the closing line is quietly
proud — the 88th made the difference and no one will ever know.

| File | Line | ~len |
|---|---|---|
| `house.push.mp3` | "More inbound — they want the 58th dead. Keep your spacing, stay between them and the Wild Cards." | 5.5s |
| `house.holds.mp3` | "That's the last of them. The Wild Cards are clear — they'll make the Saratoga. Good flying, Comeout. Form up, we're going home." | 7s |

## HARDWAY — your flight lead  (files `hardway.*`)
The line that **breaks radio silence** at contact — it's the mission kicking off. Sharp, urgent.

| File | Line | ~len |
|---|---|---|
| `hardway.break.mp3` | "Radio silence is blown — they've made us. Break and engage, weapons free! Pull the Chigs off the Wild Cards." | 6s |

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
1. `ep.belt1` — overheard 58th, run-in begins (radio silence, our flight quiet)
2. `ep.belt2` — more 58th traffic as we close
3. `hardway.break` — silence breaks at contact (wave 1 spawns; the flight breaks to fight)
4. `boxcars.splash` — first kill (wave 2 spawns)
5. `house.push` → 6. `snakeeyes.odds` — heavier wave (wave 3 spawns)
7. `house.holds` — the Wild Cards are clear (mission complete)

The player ("Comeout") is silent.
