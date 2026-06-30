# VO recording script — Mission 4: "Cold Deck"

Record each line and save it in **this folder** (`public/vo/m4-colddeck/`) with the **exact filename** shown
(e.g. `house.brief.mp3`). Reload and it just plays — no code changes. Mono, ~-16 LUFS, `.mp3`/`.ogg`/`.wav`;
missing files fall back to subtitle-only.

**Mission:** The betrayal. The Cassandra's data core (M3) decrypted into coordinates — an **AeroTech relay**
running deep past the line at Tartarus. Command can't be seen ordering a look, so the 88th goes off the
books. It's a **trap**: the relay is bait, a Chig ambush is sitting dark waiting, and **AeroTech flagged its
own pilots to the enemy** to bury what the core proved — the contractor is dealing with the things humanity
is dying to fight. **Tone:** wary approach → the wrongness of an undefended relay → the jaws close →
cold-rage realisation of the betrayal → fight out and carry the truth home. (A "cold deck" = a pre-stacked
deck swapped in to cheat you.)

---

## HOUSE — squadron CO  (files `house.*`)
Dry, composed — but this one lands personal. The betrayal hardens him; `house.betrayed` is the emotional
centre: quiet, controlled fury, a CO holding his people together.

| File | Line | ~len |
|---|---|---|
| `house.brief.mp3` | "Longshot flight, House. That core we pulled off the Cassandra cracked open — coordinates, past the line. AeroTech's running a relay out where nothing human belongs. Command can't be seen ordering this, so it's just us. Form up. Let's see what they're hiding." | 10s |
| `house.relay.mp3` | "There it is. AeroTech beacon, live and broadcasting — and no traffic, no guns, no welcome. A relay this far out, left wide open? That's not a secret, Longshot. That's bait." | 9s |
| `house.betrayed.mp3` | "AeroTech set this. Our own contractor flagged us to the Chigs to bury what we know. Remember this, all of you — the war out front isn't the only one we're in. Hold together; we burn our way out." | 9.5s |
| `house.push.mp3` | "More inbound — they want this thorough. Keep your spacing, watch each other's backs." | 5s |
| `house.clear.mp3` | "That's the last of them. We're alive — and we know what they didn't want us to. Form up, back to the gate, before AeroTech sends the next surprise." | 8s |
| `house.jump.mp3` | "Gate's hot. Punch through, Longshot — the Lex needs to hear this, all of it. See you on the other side." | 6s |

## HARDWAY — your flight lead  (files `hardway.*`)
Steady. `hardway.trap` is the jaws closing — sharp, fast, no panic but real urgency.

| File | Line | ~len |
|---|---|---|
| `hardway.formup.mp3` | "Comeout — in the box, hold it. Eyes peeled; we're a long way past friendly space out here." | 5s |
| `hardway.in.mp3` | "You're in. Flight, vectoring to the relay's coordinates. Stay tight." | 4.5s |
| `hardway.trap.mp3` | "Contacts — a lot of them! They were sitting dark, waiting on us. Break, weapons free — it's an ambush!" | 5.5s |

## BOXCARS — hotshot wingman  (files `boxcars.*`)
The betrayal makes him furious — bravado cracking into real anger, then he channels it into the fight.

| File | Line | ~len |
|---|---|---|
| `boxcars.mad.mp3` | "They sold us out! When we get home I'm gonna— ahh, just point me at the next one." | 4.5s |

## SNAKE-EYES — wingman  (files `snakeeyes.*`)
Fatalist, vindicated and grim. He called it the moment he heard "off the books." Dry, flat.

| File | Line | ~len |
|---|---|---|
| `snakeeyes.knew.mp3` | "A cold deck. I knew the game was rigged the second they said 'off the books.'" | 4.5s |

## SILICATE — Chig-allied android  (files `silicate.*`)
**Not one of yours.** The relay's voice — cold, synthetic, amused, speaking *for* AeroTech. Unhurried menace;
the "house" line is a sly twist on the squadron's own motto. Never shouty.

| File | Line | ~len |
|---|---|---|
| `silicate.intercept.mp3` | "AeroTech sends its regards, little gamblers. You were always meant to find this place — and never to leave it. The house does not suffer loose threads." | 8.5s |

---

## Order the player hears them
1. `house.brief` — the tasking (off the books); form up
2. `hardway.formup` → 3. `hardway.in` — slot in, push to the relay
4. `house.relay` — the relay is bait
5. `hardway.trap` → 6. `snakeeyes.knew` — the ambush springs (wave 1)
7. `silicate.intercept` → 8. `house.betrayed` — AeroTech's hand revealed (heavier wave)
9. `house.push` → 10. `boxcars.mad` — final wave
11. `house.clear` — survived; run for the gate
12. `house.jump` — jump out (mission complete → leads to M5)

The player ("Comeout") is silent.
