# VO recording script — Mission 5: "All In"

Record each line and save it in **this folder** (`public/vo/m5-allin/`) with the **exact filename** shown
(e.g. `house.brief.mp3`). Reload and it just plays — no code changes. Mono, ~-16 LUFS, `.mp3`/`.ogg`/`.wav`;
missing files fall back to subtitle-only.

**Mission:** The act climax — the Proxima gut-punch. The Chigs throw everything at the fleet at **Proxima
Centauri**; the 88th flies the screen over the carriers with the **USS Lexington** — home — behind them. You
fight a wall of enemies and a strike group that breaks for the Lex; and despite holding the line, **the
Lexington is mortally hit and lost** with most of her crew. A Pyrrhic survival: you do everything right and
it still isn't enough. **Tone:** grim resolve → the worst fight of the war → a desperate scramble to stop the
strike → House's composure shattering as his ship burns → quiet, gutted survival. The emotional nadir of
Act 1 — don't undersell `house.lex` and `house.gone`.

---

## HOUSE — squadron CO  (files `house.*`)
The British, never-rattled CO — **broken open** here. `house.lex` is the moment his composure fails (his
ship, his home); `house.gone` is him putting himself back together for his people, hollow and quiet. This is
the big performance of the campaign so far.

| File | Line | ~len |
|---|---|---|
| `house.brief.mp3` | "Longshot flight, House. This is the line — Proxima. The Chigs are throwing everything they have at the fleet, and we are the screen over the carriers. The Lex is behind us. We hold. Whatever it costs, we hold." | 9.5s |
| `house.wall.mp3` | "That's not a wave — that's a wall. Pick your targets, keep moving, and do not let one of them past you to the carriers. Break!" | 6.5s |
| `house.lex.mp3` | "...No. No — the Lex is hit. She's hit bad, they came in under the screen. She's... oh, God. She's burning." | 7.5s |
| `house.evac.mp3` | "Lifeboats away — cover them! Every soul that made it off that ship is the only thing that matters now. Keep the Chigs off the boats!" | 7.5s |
| `house.gone.mp3` | "The Lexington is gone. We held the line — we held it, and it still wasn't enough to save her. Form up on me, what's left of us. Tonight we just get the living home." | 9.5s |

## HARDWAY — your flight lead  (files `hardway.*`)
Steady, then driving hard. `hardway.bombers` is pure urgency — the moment everything's on the line.

| File | Line | ~len |
|---|---|---|
| `hardway.in.mp3` | "Forming up — tight as you've ever flown it, Comeout. This is the big one. Here they come..." | 5.5s |
| `hardway.bombers.mp3` | "Strike group — heavy birds, breaking low for the Lexington! They get through and she is done. Get on them — now, now, NOW!" | 6.5s |

## SNAKE-EYES — wingman  (files `snakeeyes.*`)
The fatalist, for once not joking. `snakeeyes.quiet` is two words, barely voiced — let it land.

| File | Line | ~len |
|---|---|---|
| `snakeeyes.many.mp3` | "Always said the odds would catch up to me. Didn't figure they'd bring the whole house with 'em." | 5s |
| `snakeeyes.quiet.mp3` | "...all those people." | 2.5s |

*(Boxcars has no line this mission — he's silent here, which says enough.)*

---

## Order the player hears them
1. `house.brief` — the stand at Proxima; hold the line
2. `hardway.in` → 3. `house.wall` — the wall hits (wave 1)
4. `snakeeyes.many` — heavier (wave 2)
5. `hardway.bombers` — strike group breaks for the Lexington (intercept wave)
6. `house.lex` → 7. `house.evac` — the gut-punch: she's hit; cover the lifeboats (final wave)
8. `snakeeyes.quiet` → 9. `house.gone` — the Lex is lost; get the living home
→ jump out (mission complete → act break / leads to M6)

The player ("Comeout") is silent.
