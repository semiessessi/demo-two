// Mission 3 — "Dead Man's Hand" (salvage / first contact). Off the books, the Lexington sends the 88th to a
// silent AeroTech courier — the Cassandra — on the cold edge of the Achilles system to recover her data core.
// First contact with the SILICATES: the Chigs' rebel-AI collaborators are NOT fighter pilots — they're
// infiltrators/saboteurs who BOARDED the Cassandra before she went dark and are scrubbing the core from
// inside, while the CHIGS attack from outside. So the threat is split: dogfight the Chigs in the black, and
// race the machines aboard to pull what's left of the core before they finish erasing it. Opens the AeroTech
// conspiracy thread.
//
// Same declarative format as M1/M2. Wingmen are mortal:false (Act 1 veterans). Original dialogue only.

export const m3 = {
  id: 'm3-deadmanshand',
  title: "Dead Man's Hand",
  act: 1,
  requires: 'm2-belt',
  environment: 'achilles',
  difficulty: 'veteran',
  loadout: 'default',
  vo: 'm3-deadmanshand',
  music: { track: null, duck: 0.3 },
  faces: { house: 'house-operations' }, // House still grounded (commands from ops)

  briefing: {
    location: 'ACHILLES SYSTEM · OUTER EDGE',
    body: [
      "Off the books: an AeroTech courier — the Cassandra — went silent on the cold edge of the Achilles system. No escort, no distress call, no reason to be out this far. The Lexington wants her data core in our hands before anyone else reaches her.",
      "Fly out, hold station while we pull the core, and bring it home. Nobody loses an AeroTech ship and stays this quiet about it — so expect company. Stay sharp.",
    ],
    objectives: ['Reach the derelict Cassandra', 'Recover the data core', 'Carry it home'],
  },

  player: { callsign: 'COMEOUT', start: { pos: [0, 0, 0], heading: [0, 0, -1] } },
  gate: { pos: [0, 0, 160] }, // jump point home

  formation: { anchorStart: [0, 5, -50], cruise: 22, arrive: 60, playerSlot: [15, -2, 17] },
  wingmen: [
    { id: 'hardway',   speaker: 'hardway',   slot: [0, 0, -13], mortal: false },
    { id: 'boxcars',   speaker: 'boxcars',   slot: [-17, 0, 2], mortal: false },
    { id: 'snakeeyes', speaker: 'snakeeyes', slot: [18, 3, 9],  mortal: false },
  ],

  waypoints: {
    WRECK: [200, 30, -1450],
    GATE: [0, 0, 160],
  },

  script: [
    { id: 'b_open', when: { t: 1.5 },
      do: [ { comms: 'house.brief' }, { objective: { id: 'formup', state: 'active', label: 'Form up on the flight' } }, { slot: { show: true } } ] },
    { id: 'b_lead', when: { commsDone: 'house.brief' },
      do: [ { comms: 'hardway.formup' } ] },
    { id: 'b_formed', when: { formedUp: 44 },
      do: [ { objective: { id: 'formup', state: 'complete' } }, { comms: 'hardway.in' },
            { objective: { id: 'recover', state: 'active', label: 'Reach the derelict Cassandra' } },
            { formation: { move: true } }, { waypoint: { id: 'WRECK', label: 'CASSANDRA' } } ] },
    // arrive at the wreck — it's wrong, and the core download begins (held through the ambush)
    { id: 'b_wreck', when: { or: [ { waypoint: 'WRECK', radius: 220 }, { after: 'b_formed', delay: 170 } ] },
      do: [ { comms: 'house.wreck' }, { objective: { id: 'recover', state: 'active', label: 'Hold the wreck — recovering the core' } } ] },
    { id: 'b_ambush', when: { commsDone: 'house.wreck' },
      do: [ { comms: 'hardway.contacts' }, { formation: { engage: true } },
            { spawn: { count: 4, at: [380, 50, -1520], heading: [0, 0, 1], difficulty: 0.35 } },
            { spawn: { count: 3, at: [30, -30, -1600], heading: [0, 0, 1], difficulty: 0.35 } } ] },
    // first Silicate contact — a cold transmission FROM ABOARD the wreck (they boarded it; they don't fly).
    // The Chigs send reinforcements from outside while the machines scrub the core from within.
    { id: 'b_silicate', when: { and: [ { after: 'b_ambush', delay: 12 }, { allEnemiesDead: true } ] },
      do: [ { comms: ['silicate.taunt', 'boxcars.what', 'house.silicate'] },
            { spawn: { count: 4, at: [-260, 40, -1560], heading: [0, 0, 1], difficulty: 0.5 } },
            { spawn: { count: 4, at: [300, -20, -1500], heading: [0, 0, 1], difficulty: 0.5 } } ] },
    { id: 'b_hold', when: { and: [ { after: 'b_silicate', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: 'house.core' },
            { spawn: { count: 5, at: [120, 60, -1620], heading: [0, 0, 1], difficulty: 0.55 } },
            { spawn: { count: 5, at: [-180, -40, -1540], heading: [0, 0, 1], difficulty: 0.55 } } ] },
    // core's aboard, enemies cleared -> run for the gate
    { id: 'b_clear', when: { and: [ { after: 'b_hold', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: 'house.gotit' }, { objective: { id: 'recover', state: 'complete' } },
            { objective: { id: 'rtb', state: 'active', label: 'Carry the core home — reach the gate' } },
            { waypoint: { id: 'GATE', label: 'JUMP GATE' } } ] },
    { id: 'b_push', when: { commsDone: 'house.gotit' }, do: [ { comms: 'snakeeyes.bad' } ] },
    { id: 'b_jump', when: { or: [ { waypoint: 'GATE', radius: 90 }, { after: 'b_clear', delay: 220 } ] },
      do: [ { comms: 'house.jump' }, { objective: { id: 'rtb', state: 'complete' } } ] },
    { id: 'b_end', when: { commsDone: 'house.jump' },
      do: [ { complete: { title: 'CORE RECOVERED', sub: 'The Cassandra gave up her secret — and made two different enemies show their hand for it. Whatever AeroTech buried out here, the 88th is carrying it home.' } } ] },
  ],

  lines: {
    'house.brief':      { speaker: 'house',     text: "Longshot flight, House. Quiet one, off the books — an AeroTech courier, the Cassandra, went dark out on the Achilles edge. The Lex wants her data core before anyone else digs it up. Form on Hardway, weapons warm.", dur: 9.0 },
    'hardway.formup':   { speaker: 'hardway',   text: "Comeout — tuck into the blue box and hold it. Long way out to nowhere; let's not get sloppy.", dur: 5.0 },
    'hardway.in':       { speaker: 'hardway',   text: "Good, you're in. Flight, coming up on the courier's last position. Eyes open.", dur: 4.5 },
    'house.wreck':      { speaker: 'house',     text: "There she is. No escort, no distress call, no business being this far out — and she's running stone cold. AeroTech doesn't lose a ship and stay this quiet. Get me that core. I want to know what they were hiding.", dur: 9.5 },
    'hardway.contacts': { speaker: 'hardway',   text: "Contacts! Chigs inbound — they want the same thing we do. Break and cover the wreck, weapons free!", dur: 5.5 },
    'silicate.taunt':   { speaker: 'silicate',  text: "Longshot flight. We have walked the Cassandra's halls since before she went dark — her secrets are already ours, and we are erasing the rest. Call it: heads, you leave empty; tails, you do not leave.", dur: 9.0 },
    'boxcars.what':     { speaker: 'boxcars',   text: "The hell was that? That weren't no Chig on the comms — that came from inside the wreck...", dur: 4.0 },
    'house.silicate':   { speaker: 'house',     text: "Silicates. The Chigs' machines don't fight us in the black — they get inside. They've been aboard the Cassandra, scrubbing that core from within. We pull what's left before they finish. Hold the line.", dur: 8.5 },
    'house.core':       { speaker: 'house',     text: "They're wiping it from the inside — we're pulling what we can. Keep the Chigs off us, just a little longer.", dur: 5.5 },
    'house.gotit':      { speaker: 'house',     text: "Got it — what the machines didn't manage to erase. Two enemies came to keep this buried; that tells me it's worth carrying. We're taking it home. Form up, back to the gate.", dur: 8.5 },
    'snakeeyes.bad':    { speaker: 'snakeeyes', text: "Two armies guarding one dead ship's secrets. Even I don't like those odds. Let's go.", dur: 5.0 },
    'house.jump':       { speaker: 'house',     text: "Gate's hot. Punch through, Longshot — the Lex will want to see what we found. See you on the other side.", dur: 6.0 },
  },
};
