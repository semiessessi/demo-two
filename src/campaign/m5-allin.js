// Mission 5 — "All In" (the Proxima gut-punch). The act climax. The Chigs throw everything at the fleet at
// Proxima and the 88th flies cover over the carriers — the Lexington, home, behind them. They fight a wall of
// enemies and a strike group that breaks for the Lex; and despite holding the line, the Lexington is mortally
// hit and lost with most of her crew. A Pyrrhic survival: you do everything right and it still isn't enough.
// The squadron covers the lifeboats and limps home a smaller, harder thing. The emotional nadir of Act 1.
//
// The Lexington's loss is SCRIPTED (no capital-ship set-piece in the mission framework yet — conveyed by
// comms + a nav marker, like M3's wreck / M4's relay). Wire the rendered carrier + its death in when the
// capital-ship asset is mission-ready (the other agent is building it). Wingmen mortal:false — the loss here
// is the ship + her unnamed crew, not the named cast. Original dialogue only.

export const m5 = {
  id: 'm5-allin',
  title: 'All In',
  act: 1,
  requires: 'm4-colddeck',
  environment: 'proxima', // red-dwarf primary + two distant companions, an Earth-like world + moon
  difficulty: 'veteran',
  loadout: 'default',
  vo: 'm5-allin',
  music: { track: null, duck: 0.3 },

  briefing: {
    location: 'PROXIMA CENTAURI · THE LINE',
    body: [
      "This is the line. The Chigs are throwing everything they have at the fleet at Proxima, and the 88th is part of the screen flying cover over the carriers. The Lexington — home — is behind us.",
      "Hold. Keep them off the carriers, whatever it costs. It's going to be the worst fight you've ever flown. Stay on someone's wing and do not let them past you.",
    ],
    objectives: ['Hold the line over the fleet', 'Keep the Chigs off the carriers', 'Bring the survivors home'],
  },

  player: { callsign: 'COMEOUT', start: { pos: [0, 0, 0], heading: [0, 0, -1] } },
  gate: { pos: [0, -10, 250] }, // the fleet's jump point, back past the carriers

  formation: { anchorStart: [0, 5, -46], cruise: 20, arrive: 55, playerSlot: [14, -2, 16] },
  wingmen: [
    { id: 'hardway',   speaker: 'hardway',   slot: [0, 0, -12], mortal: false },
    { id: 'boxcars',   speaker: 'boxcars',   slot: [-16, 0, 2], mortal: false },
    { id: 'snakeeyes', speaker: 'snakeeyes', slot: [18, 2, 9],  mortal: false },
  ],

  waypoints: {
    LEX: [0, 18, 240], // the USS Lexington, behind the screen — what you're dying to protect
    GATE: [0, -10, 250],
  },

  script: [
    { id: 'b_open', when: { t: 1.5 },
      do: [ { comms: 'house.brief' }, { objective: { id: 'hold', state: 'active', label: 'Hold the line over the fleet' } },
            { formation: { move: true } }, { waypoint: { id: 'LEX', label: 'USS LEXINGTON' } } ] },
    // the wall hits — straight into the worst fight of the war
    { id: 'b_engage', when: { commsDone: 'house.brief' },
      do: [ { comms: ['hardway.in', 'house.wall'] }, { formation: { engage: true } },
            { spawn: { count: 5, at: [220, 30, -560], heading: [0, 0, 1], difficulty: 0.45 } },
            { spawn: { count: 5, at: [-240, -20, -600], heading: [0, 0, 1], difficulty: 0.45 } } ] },
    { id: 'b_w2', when: { and: [ { after: 'b_engage', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: 'snakeeyes.many' },
            { spawn: { count: 6, at: [300, 50, -640], heading: [0, 0, 1], difficulty: 0.55 } },
            { spawn: { count: 5, at: [-200, 30, -660], heading: [0, 0, 1], difficulty: 0.55 } } ] },
    // strike group breaks for the Lexington
    { id: 'b_bombers', when: { and: [ { after: 'b_w2', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: 'hardway.bombers' }, { objective: { id: 'lex', state: 'active', label: 'Stop the strike on the Lexington' } },
            { spawn: { count: 6, at: [60, -30, -720], heading: [0, 0, 1], difficulty: 0.65 } },
            { spawn: { count: 4, at: [-160, 60, -700], heading: [0, 0, 1], difficulty: 0.6 } } ] },
    // the gut-punch — held the line, still lost her
    { id: 'b_lex', when: { and: [ { after: 'b_bombers', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: ['house.lex', 'house.evac'] }, { objective: { id: 'lex', state: 'failed', label: 'The Lexington is hit' } },
            { objective: { id: 'evac', state: 'active', label: 'Cover the lifeboats' } },
            { spawn: { count: 5, at: [180, 20, -640], heading: [0, 0, 1], difficulty: 0.6 } },
            { spawn: { count: 5, at: [-220, -30, -620], heading: [0, 0, 1], difficulty: 0.6 } } ] },
    { id: 'b_gone', when: { and: [ { after: 'b_lex', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: ['snakeeyes.quiet', 'house.gone'] },
            { objective: { id: 'evac', state: 'complete' } },
            { objective: { id: 'hold', state: 'complete' } },
            { objective: { id: 'rtb', state: 'active', label: 'Get the survivors home — reach the gate' } },
            { waypoint: { id: 'GATE', label: 'JUMP GATE' } } ] },
    { id: 'b_jump', when: { or: [ { waypoint: 'GATE', radius: 90 }, { after: 'b_gone', delay: 220 } ] },
      do: [ { objective: { id: 'rtb', state: 'complete' } },
            { complete: { title: 'THE LEXINGTON IS LOST', sub: 'Proxima held. The line did not break. But the Lex — home, and everyone who never reached a boat — is gone with her. The 88th flies home a smaller, harder thing than it left.' } } ] },
  ],

  lines: {
    'house.brief':    { speaker: 'house',     text: "Longshot flight, House. This is the line — Proxima. The Chigs are throwing everything they have at the fleet, and we are the screen over the carriers. The Lex is behind us. We hold. Whatever it costs, we hold.", dur: 9.5 },
    'hardway.in':     { speaker: 'hardway',   text: "Forming up — tight as you've ever flown it, Comeout. This is the big one. Here they come...", dur: 5.5 },
    'house.wall':     { speaker: 'house',     text: "That's not a wave — that's a wall. Pick your targets, keep moving, and do not let one of them past you to the carriers. Break!", dur: 6.5 },
    'snakeeyes.many': { speaker: 'snakeeyes', text: "Always said the odds would catch up to me. Didn't figure they'd bring the whole house with 'em.", dur: 5.0 },
    'hardway.bombers':{ speaker: 'hardway',   text: "Strike group — heavy birds, breaking low for the Lexington! They get through and she is done. Get on them — now, now, NOW!", dur: 6.5 },
    'house.lex':      { speaker: 'house',     text: "...No. No — the Lex is hit. She's hit bad, they came in under the screen. She's... oh, God. She's burning.", dur: 7.5 },
    'house.evac':     { speaker: 'house',     text: "Lifeboats away — cover them! Every soul that made it off that ship is the only thing that matters now. Keep the Chigs off the boats!", dur: 7.5 },
    'snakeeyes.quiet':{ speaker: 'snakeeyes', text: "...all those people.", dur: 2.5 },
    'house.gone':     { speaker: 'house',     text: "The Lexington is gone. We held the line — we held it, and it still wasn't enough to save her. Form up on me, what's left of us. Tonight we just get the living home.", dur: 9.5 },
  },
};
