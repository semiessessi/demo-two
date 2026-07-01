// Mission 4 — "Cold Deck" (the betrayal). The data core pulled off the Cassandra in M3 decrypted into
// coordinates: an AeroTech relay running past the line, where nothing human should be. Command can't be seen
// ordering a look, so it's just the 88th, off the books. It's a trap — the relay is bait, the 88th was meant
// to find it and never leave, and a Chig ambush was sitting dark waiting on them. AeroTech flagged its own
// pilots to the enemy to bury what the core proved: the contractor is dealing with the things humanity is
// dying to fight. The war grows a second front — at their backs. (A "cold deck" = a pre-stacked deck swapped
// in to cheat you.)
//
// Same declarative format as M1-M3. Wingmen mortal:false (Act 1 veterans). Original dialogue only.

export const m4 = {
  id: 'm4-colddeck',
  title: 'Cold Deck',
  act: 1,
  requires: 'm3-deadmanshand',
  environment: 'tartarus',
  difficulty: 'veteran',
  loadout: 'default',
  vo: 'm4-colddeck',
  music: { track: null, duck: 0.3 },
  faces: { house: 'house-operations' }, // House still grounded (commands from ops)

  briefing: {
    location: 'TARTARUS · BEYOND THE LINE',
    body: [
      "The Cassandra's core cracked open — and it gave up coordinates. AeroTech is running a relay out past Tartarus, deep beyond the line, where nothing of ours has any business being. Command can't be seen ordering a look at it, so this one's just us. Off the books.",
      "Get out there, see what they're hiding, and get the proof home. We go in quiet and ready — a relay this far out won't be undefended, whatever the charts say. Watch each other.",
    ],
    objectives: ['Reach the AeroTech relay', 'Find what they are hiding', 'Get the proof home'],
  },

  player: { callsign: 'COMEOUT', start: { pos: [0, 0, 0], heading: [0, 0, -1] } },
  gate: { pos: [0, 0, 160] },

  formation: { anchorStart: [0, 5, -50], cruise: 22, arrive: 60, playerSlot: [15, -2, 17] },
  wingmen: [
    { id: 'hardway',   speaker: 'hardway',   slot: [0, 0, -13], mortal: false },
    { id: 'boxcars',   speaker: 'boxcars',   slot: [-17, 0, 2], mortal: false },
    { id: 'snakeeyes', speaker: 'snakeeyes', slot: [18, 3, 9],  mortal: false },
  ],

  waypoints: {
    RELAY: [-180, 40, -1450],
    GATE: [0, 0, 160],
  },

  script: [
    { id: 'b_open', when: { t: 1.5 },
      do: [ { comms: 'house.brief' }, { objective: { id: 'formup', state: 'active', label: 'Form up on the flight' } }, { slot: { show: true } } ] },
    { id: 'b_lead', when: { commsDone: 'house.brief' },
      do: [ { comms: 'hardway.formup' } ] },
    { id: 'b_formed', when: { formedUp: 44 },
      do: [ { objective: { id: 'formup', state: 'complete' } }, { comms: 'hardway.in' },
            { objective: { id: 'strike', state: 'active', label: 'Reach the AeroTech relay' } },
            { formation: { move: true } }, { waypoint: { id: 'RELAY', label: 'AEROTECH RELAY' } } ] },
    // arrive at the relay — wide open, broadcasting, no defenders. It's bait.
    { id: 'b_relay', when: { or: [ { waypoint: 'RELAY', radius: 220 }, { after: 'b_formed', delay: 170 } ] },
      do: [ { comms: 'house.relay' }, { objective: { id: 'strike', state: 'active', label: 'Investigate the relay' } } ] },
    { id: 'b_ambush', when: { commsDone: 'house.relay' },
      do: [ { comms: ['hardway.trap', 'snakeeyes.knew'] }, { formation: { engage: true } },
            { spawn: { count: 4, at: [-360, 50, -1520], heading: [0, 0, 1], difficulty: 0.4 } },
            { spawn: { count: 4, at: [80, -30, -1600], heading: [0, 0, 1], difficulty: 0.4 } } ] },
    // the relay speaks — AeroTech's hand, confirmed
    { id: 'b_reveal', when: { and: [ { after: 'b_ambush', delay: 12 }, { allEnemiesDead: true } ] },
      do: [ { comms: ['silicate.intercept', 'house.betrayed'] },
            { spawn: { count: 5, at: [-260, 40, -1560], heading: [0, 0, 1], difficulty: 0.55 } },
            { spawn: { count: 4, at: [300, -20, -1500], heading: [0, 0, 1], difficulty: 0.55 } } ] },
    { id: 'b_push', when: { and: [ { after: 'b_reveal', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: ['house.push', 'boxcars.mad'] },
            { spawn: { count: 5, at: [120, 60, -1620], heading: [0, 0, 1], difficulty: 0.65 } },
            { spawn: { count: 5, at: [-180, -40, -1540], heading: [0, 0, 1], difficulty: 0.65 } } ] },
    { id: 'b_clear', when: { and: [ { after: 'b_push', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: 'house.clear' }, { objective: { id: 'strike', state: 'complete' } },
            { objective: { id: 'rtb', state: 'active', label: 'Carry the proof home — reach the gate' } },
            { waypoint: { id: 'GATE', label: 'JUMP GATE' } } ] },
    { id: 'b_jump', when: { or: [ { waypoint: 'GATE', radius: 90 }, { after: 'b_clear', delay: 220 } ] },
      do: [ { comms: 'house.jump' }, { objective: { id: 'rtb', state: 'complete' } } ] },
    { id: 'b_end', when: { commsDone: 'house.jump' },
      do: [ { complete: { title: 'WE KNOW NOW', sub: 'AeroTech flagged its own pilots to the enemy to bury what the Cassandra proved — the contractor is dealing with the things we are dying to fight. The war just grew a second front, at our backs.' } } ] },
  ],

  lines: {
    'house.brief':      { speaker: 'house',     text: "Longshot flight, House. That core we pulled off the Cassandra cracked open — coordinates, past the line. AeroTech's running a relay out where nothing human belongs. Command can't be seen ordering this, so it's just us. Form up. Let's see what they're hiding.", dur: 10.0 },
    'hardway.formup':   { speaker: 'hardway',   text: "Comeout — in the box, hold it. Eyes peeled; we're a long way past friendly space out here.", dur: 5.0 },
    'hardway.in':       { speaker: 'hardway',   text: "You're in. Flight, vectoring to the relay's coordinates. Stay tight.", dur: 4.5 },
    'house.relay':      { speaker: 'house',     text: "There it is. AeroTech beacon, live and broadcasting — and no traffic, no guns, no welcome. A relay this far out, left wide open? That's not a secret, Longshot. That's bait.", dur: 9.0 },
    'hardway.trap':     { speaker: 'hardway',   text: "Contacts — a lot of them! They were sitting dark, waiting on us. Break, weapons free — it's an ambush!", dur: 5.5 },
    'snakeeyes.knew':   { speaker: 'snakeeyes', text: "A cold deck. I knew the game was rigged the second they said 'off the books.'", dur: 4.5 },
    'silicate.intercept':{ speaker: 'silicate', text: "AeroTech sends its regards, little gamblers. You were always meant to find this place — and never to leave it. The house does not suffer loose threads.", dur: 8.5 },
    'house.betrayed':   { speaker: 'house',     text: "AeroTech set this. Our own contractor flagged us to the Chigs to bury what we know. Remember this, all of you — the war out front isn't the only one we're in. Hold together; we burn our way out.", dur: 9.5 },
    'house.push':       { speaker: 'house',     text: "More inbound — they want this thorough. Keep your spacing, watch each other's backs.", dur: 5.0 },
    'boxcars.mad':      { speaker: 'boxcars',   text: "They sold us out! When we get home I'm gonna— ahh, just point me at the next one.", dur: 4.5 },
    'house.clear':      { speaker: 'house',     text: "That's the last of them. We're alive — and we know what they didn't want us to. Form up, back to the gate, before AeroTech sends the next surprise.", dur: 8.0 },
    'house.jump':       { speaker: 'house',     text: "Gate's hot. Punch through, Longshot — the Coral Sea needs to hear this, all of it. See you on the other side.", dur: 6.0 },
  },
};
