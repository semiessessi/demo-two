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
  faces: { house: 'house-operations' }, // House still grounded — directs from the Coral Sea's ops

  briefing: {
    location: 'JUPITER TROJANS · THE BELT',
    body: [
      "After Groombridge turned up empty, the picture came clear fast: the Chigs bypassed the staging system and drove for the inner worlds — for Earth. The 58th 'Wild Cards', off the Saratoga, were thrown into the Belt — the Jupiter Trojans — to blunt that push and buy Earth time.",
      "They bought it. But they're being torn apart out there, and the 88th is the closest flight that can reach them. You go in on radio silence — no chatter on the run-in, just the 58th's traffic over the net as you close. Form up, then break and pull the Chigs off them. They're faster and climb harder, but you turn tighter and hit heavier — out-fly them, don't chase. Get the Wild Cards out alive.",
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

  // the fleet the screen is protecting: human carriers standing off behind the furball
  ships: [
    { type: 'carrier', pos: [-520, -70, 780], scale: 170, rotY: 0.4 },
    { type: 'carrier', pos: [340, -100, 980], scale: 170, rotY: -0.3 },
    { type: 'carrier', pos: [-140, -50, 1180], scale: 170, rotY: 0.1 },
    { type: 'carrier', pos: [560, -80, 860], scale: 170, rotY: -0.6 },
  ],

  script: [
    // Radio silence on the run-in: no 88th chatter — we drop into the battle hearing only the 58th's traffic
    // over the net (episode samples ep.* -> public/vo/m2-belt/, user-supplied). Silence breaks at contact.
    { id: 'b_open', when: { t: 1.0 },
      do: [ { comms: 'ep.belt1' }, { objective: { id: 'hold', state: 'active', label: 'Close on the Wild Cards — radio silence' } }, { formation: { move: true } } ] },
    { id: 'b_overheard', when: { after: 'b_open', delay: 9 }, do: [ { comms: 'ep.belt2' } ] },
    { id: 'b_engage', when: { after: 'b_open', delay: 17 },
      do: [ { comms: 'hardway.break' }, { objective: { id: 'kill', state: 'active', label: 'Clear the Chigs off the 58th' } }, { formation: { engage: true } },
            { spawn: { count: 4, at: [180, 20, -520], heading: [0, 0, 1], difficulty: 0.3 } },
            { spawn: { count: 3, at: [-220, -10, -560], heading: [0, 0, 1], difficulty: 0.3 } } ] },
    { id: 'b_w2', when: { and: [ { after: 'b_engage', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: ['boxcars.splash', 'sixshooter.two'] },
            { spawn: { count: 4, at: [260, 40, -600], heading: [0, 0, 1], difficulty: 0.45 } },
            { spawn: { count: 4, at: [-180, 30, -640], heading: [0, 0, 1], difficulty: 0.45 } } ] },
    { id: 'b_w3', when: { and: [ { after: 'b_w2', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: ['house.push', 'pips.highside', 'snakeeyes.odds'] },
            { spawn: { count: 5, at: [120, -30, -700], heading: [0, 0, 1], difficulty: 0.6 } },
            { spawn: { count: 5, at: [-260, 50, -700], heading: [0, 0, 1], difficulty: 0.6 } } ] },
    { id: 'b_clear', when: { and: [ { after: 'b_w3', delay: 2 }, { allEnemiesDead: true } ] },
      do: [ { comms: 'house.holds' }, { objective: { id: 'kill', state: 'complete' } }, { objective: { id: 'hold', state: 'complete' } } ] },
    { id: 'b_end', when: { commsDone: 'house.holds' },
      do: [ { complete: { title: 'WILD CARDS CLEAR', sub: 'The 58th lives to fight another day — and no one up the chain will ever know the 88th was the reason.' } } ] },
  ],

  lines: {
    // Episode samples (user-supplied audio -> public/vo/m2-belt/ep.belt1.<mp3|ogg|wav>). The `text` is a
    // neutral on-screen description only — NOT a transcript of the show. Absent audio -> just the caption.
    'ep.belt1':      { speaker: 'wildcards', text: "[ Saratoga's 58th — the Wild Cards, under fire in the Belt ]", dur: 7.0 },
    'ep.belt2':      { speaker: 'wildcards', text: "[ 58th over the net — the fight turning against them ]", dur: 6.0 },
    'hardway.break': { speaker: 'hardway',   text: "Radio silence is blown — they've made us. Break and engage, weapons free! Pull the Chigs off the Wild Cards.", dur: 6.0 },
    'boxcars.splash':{ speaker: 'boxcars',   text: "Splash one! Hold on, Wild Cards — the Longshots are buying you out.", dur: 4.5 },
    'house.push':    { speaker: 'house',     text: "More inbound — they want the 58th dead. Keep your spacing, stay between them and the Wild Cards.", dur: 5.5 },
    'snakeeyes.odds':{ speaker: 'snakeeyes', text: "Whole sky full of teeth. Just the odds I like — terrible.", dur: 4.0 },
    'sixshooter.two':{ speaker: 'sixshooter',text: "Six-Shooter — two for two! Keep 'em coming, I'm just warming up.", dur: 4.0 },
    'pips.highside': { speaker: 'pips',      text: "Pips has the high side. Boxcars, break right — I'll clean up behind you.", dur: 4.5 },
    'house.holds':   { speaker: 'house',     text: "That's the last of them. The Wild Cards are clear — they'll make the Saratoga. Good flying, Comeout. Form up and bring my flight home.", dur: 7.0 },
  },
};
