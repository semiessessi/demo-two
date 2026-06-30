# SA-43: Hammerhead — Story Bible (the 88th "Longshots")

*Living design doc for the single-player campaign. We keep this updated as decisions are made.*
*Last updated: 2026-06.*

## Premise & framing

A **non-commercial fan tribute** set in the universe of *Space: Above and Beyond*. The wider war and its
world are the show's; the squadron and characters we play are **our own originals**, running **parallel to
the canon 58th "Wild Cards,"** crossing paths at key moments. Mid-2060s; humanity's first interstellar war
against the Chigs, fought by carrier-based attack squadrons.

**Rules we hold to:** original dialogue only — we never reproduce the show's script lines; strictly
non-commercial; the in-game fan-tribute disclaimer stays up.

## Our squadron — the 88th "Longshots"

Dice / gambling culture: every callsign is craps slang, the squadron motif is luck vs. preparation, "every
sortie is a roll you might not survive."

| Callsign | Role | Notes |
|---|---|---|
| **Comeout** | the player | the new arrival; everything starts on the come-out |
| **House** | CO | British (RN/RM secondment), dry, composed. Creed: *there's no such thing as luck, only odds you failed to read.* |
| **Hardway** | flight lead | by-the-book grinder; moral centre; survives |
| **Boxcars** | wingman | hotshot glory-hound |
| **Snake-Eyes** | wingman | the unlucky fatalist who never quite dies |
| Push / Loaded / Natural | reserve cast | introduce later (Loaded = an In Vitro) |

## The world (canon backdrop we borrow)

- **Chigs** — the alien enemy (our in-game enemy).
- **AeroTech** — the monopolistic defence contractor; the hidden hand that provoked the war. The conspiracy
  spine that surfaces from M3 onward.
- **Silicates** — rebel-AI androids allied to the Chigs. **NOT fighter pilots** — they're infiltrators /
  saboteurs: they crew + board ships, work carrier/cargo systems, and turn up as spies (the "take a chance"
  coin-flippers). First met in M3 aboard the *Cassandra*. Run the Kazbek prison-mine in Act 3.
- **In Vitros** ("tanks") — vat-grown adult humans, a resented underclass. (Loaded is one.)
- **58th "Wild Cards" · Lt. Col. McQueen · USS Saratoga** — the canon squadron we keep rescuing/supporting.
  We are *not* them — we're the unsung 88th alongside them.
- **88th "Longshots" · USS Lexington** — OUR home carrier. A Lexington-class **sister ship of the Saratoga**
  (same hull → the same 3D model serves both). This replaces the earlier "Coral Sea" working name. We fly off
  *the Lex*, running parallel to the 58th on the Saratoga.
- **Kazbek** — our own original prison-moon location (Silicate-run; Act 3 rescue of House).
- **SA-43 Hammerhead** — our jet (canon designation).

## The arc (parallel to the pilot)

- **M1 "Shakedown"** — Groombridge 34 recon sweep; the system is empty; flash traffic: the 58th has been
  bounced hard at the Belt and is going under; scrub the recon, jump to help. *(Built, on master.)*
- **M2 "Battle of the Belt"** — arrive as the **rescuers**: clear the Chig swarm off the Wild Cards before
  they're wiped out. The pilot's climactic battle, from our side. *(Built; reframed as the rescue.)*
- **M3 "Dead Man's Hand"** — salvage on the Achilles outer edge: recover the data core from a silent
  **AeroTech** courier (the *Cassandra*) under a Chig ambush, and meet the **Silicates** for the first time
  (they were there first). Opens the AeroTech conspiracy thread; introduces the `silicate` speaker. *(Built,
  gated `?singleplayer`.)*
- **M4+** — TBD. Beats to draw on: Escort (protect a hauler), the costly Proxima set-piece, a Silicate-run
  prison-mine rescue (Kazbek), a named enemy ace, the AeroTech cover-up reveal.

## Production notes

- **Capital ships** — built from a CC BY-NC-SA Saratoga STL (alpokemon / orig. Katase, Thingiverse
  [#1889381](https://www.thingiverse.com/thing:1889381); **attribution required, non-commercial only**).
  One mesh serves every carrier. Three roles for the same asset:
  - *Set-dressing* — a carrier looming in the attract/skirmish backdrop.
  - *Story combatant* — the **Lexington** fights alongside us in the campaign.
  - *Skirmish refuel/reload point* — its carrier name is randomised from a pool of historic US carriers
    (Saratoga, Lexington, Ranger, Yorktown, Hornet, Belleau Wood, …).
- Campaign is gated behind **`?singleplayer`**.
- Per-mission **VO scripts** live in `public/vo/<missionId>/README.md`; the user records the lines, drops
  them in, and they play (subtitle-only until then).
- Tech: `src/campaign/` (missions + runtime), `src/comms.js`, `src/missionHud.js`, `src/briefing.js`,
  `src/campaignScreen.js`. See the `campaign-singleplayer-status` memory for the build state.

## Open decisions / TODO

- **M4 direction** — after M3 lands (Escort / Proxima / Kazbek candidates above).
- **Missiles are real now** (3s lock + homing, top-down weapon HUD) — the named-ace duel can use them.
- Develop the reserve cast (Push / Loaded / Natural) + the In Vitro / AeroTech threads.
- Optional M2 polish: actual battered 58th ships to escort/protect during the rescue.
