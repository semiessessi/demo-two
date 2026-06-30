# VO recording script — Mission 3: "Dead Man's Hand"

Record each line and save it in **this folder** (`public/vo/m3-deadmanshand/`) with the **exact filename**
shown (e.g. `house.brief.mp3`). Reload and it just plays — no code changes. Mono, ~-16 LUFS,
`.mp3`/`.ogg`/`.wav`; missing files fall back to subtitle-only.

**Mission:** Salvage + first contact. The Lexington sends the 88th, off the books, to a silent **AeroTech
courier (the *Cassandra*)** on the cold edge of the Achilles system to recover her **data core** before
anyone else. The Chigs want it too — and for the first time the Longshots meet the **Silicates** (the Chigs'
rebel-AI collaborators), who were there first. Hold the wreck through the ambush while the core downloads,
then run it home. Opens the AeroTech conspiracy. **Tone:** quiet dread on arrival → ambush → a cold,
skin-crawling Silicate transmission → grind it out → leave with a bad feeling and a secret.

---

## HOUSE — squadron CO  (files `house.*`)
Dry, composed, in command. Suspicious of AeroTech; the closing lines carry a quiet weight — they're carrying
something dangerous home.

| File | Line | ~len |
|---|---|---|
| `house.brief.mp3` | "Longshot flight, House. Quiet one, off the books — an AeroTech courier, the Cassandra, went dark out on the Achilles edge. The Lex wants her data core before anyone else digs it up. Form on Hardway, weapons warm." | 9s |
| `house.wreck.mp3` | "There she is. No escort, no distress call, no business being this far out — and she's running stone cold. AeroTech doesn't lose a ship and stay this quiet. Get me that core. I want to know what they were hiding." | 9.5s |
| `house.silicate.mp3` | "Silicates. The Chigs' pet machines. If they want this core too, that's all the more reason we leave with it. Hold the line." | 6.5s |
| `house.core.mp3` | "Core's almost across — keep them off the Cassandra, just a little longer." | 4.5s |
| `house.gotit.mp3` | "Got it — core's aboard. Two different enemies came to keep this buried; that tells me it's worth carrying. We're taking it home. Form up, back to the gate." | 8.5s |
| `house.jump.mp3` | "Gate's hot. Punch through, Longshot — the Lex will want to see what we found. See you on the other side." | 6s |

## HARDWAY — your flight lead  (files `hardway.*`)
Steady pro. The form-up coaching is calm; "Contacts!" is the mission turning hot — sharpen it.

| File | Line | ~len |
|---|---|---|
| `hardway.formup.mp3` | "Comeout — tuck into the blue box and hold it. Long way out to nowhere; let's not get sloppy." | 5s |
| `hardway.in.mp3` | "Good, you're in. Flight, coming up on the courier's last position. Eyes open." | 4.5s |
| `hardway.contacts.mp3` | "Contacts! Chigs inbound — they want the same thing we do. Break and cover the wreck, weapons free!" | 5.5s |

## BOXCARS — hotshot wingman  (files `boxcars.*`)
The cocky one rattled for once — the Silicate voice unsettles even him.

| File | Line | ~len |
|---|---|---|
| `boxcars.what.mp3` | "The hell was that? That weren't no Chig on the comms..." | 3.5s |

## SNAKE-EYES — wingman  (files `snakeeyes.*`)
Fatalist. The closing line is gallows-dry — he names the bad odds and shrugs.

| File | Line | ~len |
|---|---|---|
| `snakeeyes.bad.mp3` | "Two armies guarding one dead ship's secrets. Even I don't like those odds. Let's go." | 5s |

## SILICATE — Chig-allied android  (files `silicate.*`)
**Not one of yours.** Cold, synthetic, unhurried — a machine that finds the gambling motif amusing. Flat
affect, maybe a faint processing/digital edge if you can fake one. Genuinely unsettling, never shouty.

| File | Line | ~len |
|---|---|---|
| `silicate.taunt.mp3` | "Longshot flight. We were here first; the Cassandra's secrets are spoken for. Call it — heads, you turn back; tails, you burn. We always win the toss." | 8.5s |

---

## Order the player hears them
1. `house.brief` — the tasking; form up
2. `hardway.formup` → 3. `hardway.in` — slot in, push to the wreck
4. `house.wreck` — the cold derelict; start the recovery
5. `hardway.contacts` — Chig ambush (waves 1)
6. `silicate.taunt` → 7. `boxcars.what` → 8. `house.silicate` — first Silicate contact (heavier wave)
9. `house.core` — almost there (final wave)
10. `house.gotit` — core aboard, run for the gate
11. `snakeeyes.bad` — the bad feeling
12. `house.jump` — jump out (mission complete → leads to M4)

The player ("Comeout") is silent.
