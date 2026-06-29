// Mission 2 — "Battle of the Belt". First combat. Jumping out of Groombridge, the Longshots arrive in the
// Trojan asteroid fields at Jupiter's Lagrange point to find the Chigs punching through toward the inner
// system. Hold the line: form up, break, and fight three escalating waves. Teaches the core dogfight —
// the Chigs are faster and climb better, but you turn tighter and hit harder, so out-manoeuvre, don't chase.
//
// Wingmen are mortal:false here (your veterans survive their first scrap with you). Enemy bolts now reach
// the player too (combat.js fall-through), so you can be hit / killed -> fail -> Retry.

export const m2 = {
  id: 'm2-belt',
  title: 'Battle of the Belt',
  act: 1,
  requires: 'm1-shakedown',
  environment: 'jupiterTrojans',
  difficulty: 'veteran',
  loadout: 'default',
  vo: 'm2-belt',
  music: { track: null, duck: 0.3 },

  briefing: {
    location: 'JUPITER TROJANS · THE BELT',
    body: [
      "You came out of the gate into someone else's disaster. The 58th — the Wild Cards, off the Saratoga — got bounced in the Belt and they're being torn apart. The 88th is the only flight close enough to reach them.",
      "Form up, then break and pull the Chigs off them. Their fighters are faster and climb harder, but you turn tighter and hit heavier — out-fly them, don't chase. Get the Wild Cards out alive.",
    ],
    objectives: ['Reach the Wild Cards', 'Clear the Chigs off the 58th'],
  },

  player: { callsign: 'COMEOUT', start: { pos: [0, 0, 0], heading: [0, 0, -1] } },
  formation: { anchorStart: [0, 4, -42], cruise: 20, arrive: 50, playerSlot: [14, -2, 16] },
  wingmen: [
    { id: 'hardway',   speaker: 'hardway',   slot: [0, 0, -12], mortal: false },
    { id: 'boxcars',   speaker: 'boxcars',   slot: [-16, 0, 2], mortal: false },
    { id: 'snakeeyes', speaker: 'snakeeyes', slot: [18, 2, 9],  mortal: false },
  ],

  script: [
    { id: 'b_open', when: { t: 1.0 },
      do: [ { comms: 'house.arrive' }, { objective: { id: 'hold', state: 'active', label: 'Reach the Wild Cards' } }, { formation: { move: true } } ] },
    { id: 'b_engage', when: { commsDone: 'house.arrive' },
      do: [ { comms: 'hardway.break' }, { objective: { id: 'kill', state: 'active', label: 'Clear the Chigs off the 58th' } }, { formation: { engage: true } },
            { spawn: { count: 4, at: [180, 20, -520], heading: [0, 0, 1], difficulty: 0.3 } },
            { spawn: { count: 3, at: [-220, -10, -560], heading: [0, 0, 1], difficulty: 0.3 } } ] },
    { id: 'b_w2', when: { and: [ { after: 'b_engage', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: 'boxcars.splash' },
            { spawn: { count: 4, at: [260, 40, -600], heading: [0, 0, 1], difficulty: 0.45 } },
            { spawn: { count: 4, at: [-180, 30, -640], heading: [0, 0, 1], difficulty: 0.45 } } ] },
    { id: 'b_w3', when: { and: [ { after: 'b_w2', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: ['house.push', 'snakeeyes.odds'] },
            { spawn: { count: 5, at: [120, -30, -700], heading: [0, 0, 1], difficulty: 0.6 } },
            { spawn: { count: 5, at: [-260, 50, -700], heading: [0, 0, 1], difficulty: 0.6 } } ] },
    { id: 'b_clear', when: { and: [ { after: 'b_w3', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: 'house.holds' }, { objective: { id: 'kill', state: 'complete' } }, { objective: { id: 'hold', state: 'complete' } } ] },
    { id: 'b_end', when: { commsDone: 'house.holds' },
      do: [ { complete: { title: 'WILD CARDS CLEAR', sub: 'The 58th lives to fight another day — and no one up the chain will ever know the 88th was the reason.' } } ] },
  ],

  lines: {
    'house.arrive':  { speaker: 'house',     text: "Longshot flight, House. The Wild Cards are down in the rocks, swarmed — Saratoga's lost contact. We are the rescue. Form on Hardway, then we go in.", dur: 7.5 },
    'hardway.break': { speaker: 'hardway',   text: "There they are — 58th, taking a beating. Break and engage, weapons free! Pull the Chigs off them; don't chase the runners.", dur: 6.0 },
    'boxcars.splash':{ speaker: 'boxcars',   text: "Splash one! Hold on, Wild Cards — the Longshots are buying you out.", dur: 4.5 },
    'house.push':    { speaker: 'house',     text: "More inbound — they want the 58th dead. Keep your spacing, stay between them and the Wild Cards.", dur: 5.5 },
    'snakeeyes.odds':{ speaker: 'snakeeyes', text: "Whole sky full of teeth. Just the odds I like — terrible.", dur: 4.0 },
    'house.holds':   { speaker: 'house',     text: "That's the last of them. The Wild Cards are clear — they'll make the Saratoga. Good flying, Comeout. Form up, we're going home.", dur: 7.0 },
  },
};
