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
  they're wiped out. Set-piece behind the furball: **TWO Chig battleships** push through the asteroids and are
  held off by the **58th's ACMs** before the 88th can arrive; as it turns, the **Coral Sea** (a task-force
  carrier — *not* the Lexington) picks off the last Chig fighter on **Vansen's** tail. The pilot's climactic
  battle, from our side. *(Built; reframed as the rescue. Capital-ship set-piece TBD.)*
- **M3 "Dead Man's Hand"** — salvage on the Achilles outer edge: recover the data core from a silent
  **AeroTech** courier (the *Cassandra*) under a Chig ambush, and meet the **Silicates** for the first time
  (they were there first). Opens the AeroTech conspiracy thread; introduces the `silicate` speaker. *(Built,
  gated `?singleplayer`.)*
- **M4 "Cold Deck"** — the betrayal. The Cassandra's core decrypts to an AeroTech relay past the line
  (Tartarus); the off-the-books strike is a **trap** — AeroTech flagged the 88th to a waiting Chig ambush to
  bury what they know. Confirms the contractor is dealing with the enemy; the war grows a second front, at
  our backs. *(Built, gated `?singleplayer`.)*
- **M5 "All In"** — the Proxima gut-punch (act climax). The fleet's stand at Proxima; the 88th flies the
  screen over the carriers, and despite holding the line the **USS Lexington is lost** with most of her crew
  — a Pyrrhic survival. Emotional nadir of Act 1. New **`proxima`** env: red-dwarf primary + two distant
  companions (white + yellow, Alpha-Centauri-like), an Earth-like world (atmosphere + normal map) with a
  moon. *(Built, gated `?singleplayer`.)*
- **M6+** — TBD. Escort (protect a hauler), a Silicate-run prison-mine rescue (Kazbek), a named enemy ace,
  the AeroTech cover-up going public.

## Production notes

- **Capital ships** — two assets, both shaded procedurally in-engine (no textures); the look is dialled in
  the **ship-preview** dev tool (`/ship-preview`):
  - *Human carriers* — a CC BY-NC-SA Saratoga STL (alpokemon / orig. Katase, Thingiverse
    [#1889381](https://www.thingiverse.com/thing:1889381); **attribution required, non-commercial only**).
    One mesh serves every carrier. Roles: set-dressing; story combatant (the **Lexington**); and a skirmish
    refuel/reload point whose name is randomised from historic US carriers (Saratoga, Lexington, Ranger,
    Yorktown, Hornet, Belleau Wood, …).
  - *Chig battleship* — `assets-src/source/chig-battleship.fbx`; dark-green hull + a glowing hex/triangle
    grid (hexagons split into six triangles) with recessed seams + a cyan noise core band that tilts up at
    the angled front. **In-game scale: ~30× the Chig fighter's height** (capital-ship presence — apply when
    integrating). Roles: the **Battle of the Belt** set-piece (TWO of them, missiled to death by FOUR
    human carriers while the 88th saves the 58th); a **fighter source** in later missions; and in
    **skirmish** — one warps in at **wave 3**, a second at **wave 5**, then keep **two alive** (a destroyed
    one is replaced); battleship kills don't touch the wave count, and once one is up the **fighter waves
    spawn from it**. Attract shows one as looming set-dressing. *(In-game NOW: `src/chigBattleship.js` +
    `src/battleships.js`; capital-ship damage/destruction still TODO.)*
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
