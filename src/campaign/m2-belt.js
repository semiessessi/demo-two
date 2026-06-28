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
      "You came through the gate into a fight. The Chigs that skipped Groombridge are pushing through the Belt — the Trojan fields at Jupiter's Lagrange point — driving for the inner system.",
      "This is where the line gets drawn. Hold formation, then break and engage. The tale of the tape: their fighters are faster and climb harder, but you turn tighter and hit heavier. Don't chase them — make them come to you.",
    ],
    objectives: ['Hold the line', 'Destroy the raiders'],
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
      do: [ { comms: 'house.arrive' }, { objective: { id: 'hold', state: 'active', label: 'Hold the line' } }, { formation: { move: true } } ] },
    { id: 'b_engage', when: { commsDone: 'house.arrive' },
      do: [ { comms: 'hardway.break' }, { objective: { id: 'kill', state: 'active', label: 'Destroy the raiders' } }, { formation: { engage: true } },
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
      do: [ { complete: { title: 'THE LINE HOLDS', sub: 'The Belt is yours — for now. But the Chigs are still driving on Earth, and the 88th is going in after them.' } } ] },
  ],

  lines: {
    'house.arrive':  { speaker: 'house',     text: "Longshot flight, House. Welcome to the Belt — the Chigs are pushing through the Trojans for the inner system. This is the line. Hold formation till they commit.", dur: 7.5 },
    'hardway.break': { speaker: 'hardway',   text: "Here they come. Break and engage — weapons free! Turn with them, don't chase. Pick your shots.", dur: 5.5 },
    'boxcars.splash':{ speaker: 'boxcars',   text: "Splash one! Hah — told you I'd open the book. Who's next?", dur: 4.5 },
    'house.push':    { speaker: 'house',     text: "Second wave, heavier. Hold your spacing and keep the line, Longshot.", dur: 5.0 },
    'snakeeyes.odds':{ speaker: 'snakeeyes', text: "Count's climbing. Just the odds I like — terrible.", dur: 4.0 },
    'house.holds':   { speaker: 'house',     text: "That's the last of them. The line holds. Good flying, Comeout — maybe you'll last after all.", dur: 6.5 },
  },
};
