# VO recording script — Mission 1: "Shakedown" (recon)

Record each line and save it in **this folder** (`public/vo/m1-shakedown/`) with the **exact filename**
shown (e.g. `house.checkin.mp3`). Reload the game and it just plays — no code changes needed.

- **Format:** mono, 44.1 or 48 kHz. `.mp3` (small) or `.wav` (lossless) both work; `.mp3` wins if both exist.
- **Loudness:** aim ~ -16 LUFS, trim the silence off the ends.
- **Missing a line?** Fine — it shows as a subtitle only until the file exists, so record them one at a time
  and check each in-game.
- The **subtitle text + timing** live in `src/campaign/m1-shakedown.js` (the `lines` map). Match the text
  below; small ad-libs are fine (the game keys off the filename, not the words).

**Mission:** Your first sortie — a recon sweep through the Groombridge gate. Command is nervous the Chigs
might be staging here, so the flight forms up and runs three nav marks. **The system is completely empty —
nothing here at all.** Then **flash traffic breaks in: the 58th "Wild Cards" have been bounced hard at the
Belt and are going under — and the 88th is the closest help.** Recon scrubbed — race back to the wormhole
and jump to the rescue. (Leads straight into Mission 2, "Battle of the Belt.") **Tone: quiet, slightly
anticlimactic recon → the floor drops out when the intel hits → urgent dash for the gate.** No combat here.

---

## HOUSE — squadron CO  (files `house.*`)
British woman, Royal Navy/Marines, seconded to the carrier. Dry, composed, understated — command voice
without shouting. Believes there's no such thing as luck, only odds you didn't read. Businesslike throughout;
the empty system is a non-event to her — she logs it clear and sends you home, with a dry warning that it
won't always be this quiet.

| File | Line | ~len |
|---|---|---|
| `house.checkin.mp3` | "Longshot flight, House. We're through the Groombridge gate — recon sweep. Command thinks the Chigs might be staging here; we go and find out. Form on Hardway, weapons cold." | 7.5s |
| `house.recon1.mp3` | "First mark... clear. Nothing on the scope — no reactors, no traffic, nothing at all." | 5.5s |
| `house.recon3.mp3` | "Last mark's clear too. Whole system's a ghost — no build-up, no Chigs, nothing. That's our recon: there's nothing here." | 7.5s |
| `house.flash.mp3` | "Longshot flight — flash traffic. The 58th just got bounced hard at the Belt; they're going under, and we're the closest thing to help. Recon's scrubbed — back to the gate and jump, now." | 8.5s |
| `house.jump.mp3` | "Gate's hot. Punch through, Longshot — the 58th can't hold much longer. See you on the other side." | 6s |

*(`house.flash` is the turn — calm CO suddenly all business and urgent. `house.jump` is clipped, driving.)*

## HARDWAY — your flight lead  (files `hardway.*`)
By-the-book grinder, the steady moral centre. Calm, patient — talks you through forming up like an instructor.

| File | Line | ~len |
|---|---|---|
| `hardway.formup.mp3` | "Comeout — your slot's the blue box. Slide in nice and easy and hold it. Stay off the gas." | 5.5s |
| `hardway.in.mp3` | "Good, you're in the pocket. Flight, pushing up. Let's see what's out here." | 4.5s |
| `hardway.burn.mp3` | "You heard her — the Wild Cards are out of time. Firewall it for the gate; we jump together." | 5s |

## BOXCARS — hotshot wingman  (files `boxcars.*`)
Cocky glory-hound, itching for a fight — here she's just let down/bored that there's nothing to shoot.

| File | Line | ~len |
|---|---|---|
| `boxcars.empty.mp3` | "Boss, there's nothing out here. Where's this build-up they dragged us out for?" | 4.5s |

## SNAKE-EYES — wingman  (files `snakeeyes.*`)
The unlucky one who never quite dies — a weary fatalist. Dry, flat, deadpan. An empty sky suits him fine.

| File | Line | ~len |
|---|---|---|
| `snakeeyes.quiet.mp3` | "Empty suits me fine. Nobody out here to roll snake-eyes on me." | 4s |

---

## Order the player hears them
1. `house.checkin` — through the gate; recon sweep; form on Hardway
2. `hardway.formup` — slot into the blue box
3. `hardway.in` — you're formed up; "let's see what's out here"  *(after you reach the slot)*
4. `house.recon1` — first mark: clear, nothing on the scope
5. `boxcars.empty` → 6. `snakeeyes.quiet` — nothing out here (back-to-back)
7. `house.recon3` — all clear; the recon's job was to find nothing, and it did
8. `house.flash` — flash traffic: the Chigs are inbound on Earth; scrub the recon, get to the gate
9. `hardway.burn` — firewall it for the wormhole, jump together
10. `house.jump` — punch through the gate (mission ends → leads into M2)

The **player ("Comeout") has no lines** in M1 — you're the silent new arrival.
