// Mission 1 — "Shakedown" (recon). Groombridge 34 has gone dark and Command suspects the Chigs are
// massing for a push. The flight runs a silent recon: form up, fly three nav marks, return to the
// carrier. No combat (weapons cold) — it teaches the flight model, formation-keeping, nav + comms, and
// sets the tone before the war turns ugly. Also the vertical slice that proves the campaign pipeline.
//
// Data only. Beats fire in order when `when` is met; `do` runs the effect. The wingmen fly a moving
// formation (anchor + slots); the player must line up into `formation.playerSlot` (the blue HUD box) to
// "form up". VO drops into public/vo/m1-shakedown/<lineId>.<mp3|ogg|wav>; absent = subtitle only.

export const m1 = {
  id: 'm1-shakedown',
  title: 'Shakedown',
  act: 1,
  requires: null,
  environment: 'groombridge34',
  difficulty: 'veteran',
  loadout: 'default',
  vo: 'm1-shakedown',
  music: { track: null, duck: 0.35 },

  briefing: {
    location: 'GROOMBRIDGE 34 · RECON',
    body: [
      'Groombridge 34 has gone silent — no traffic, no chatter. Command thinks the Chigs are massing here for a push, and they need eyes on it.',
      'Form up on the flight, run the three recon marks, and bring the data home. Weapons stay cold: if they spot us, the whole system lights up. We look, we leave.',
    ],
    objectives: ['Form up on the flight', 'Recon the three nav points', 'Return to the carrier'],
  },

  player: { callsign: 'COMEOUT', start: { pos: [0, 0, 0], heading: [0, 0, -1] } },
  home: { pos: [0, 0, 160] }, // the carrier you launched from / return to (placeholder cube)

  // The wingmen hold station on this moving anchor; you must fly into playerSlot to form up.
  formation: { anchorStart: [0, 6, -55], cruise: 22, arrive: 60, playerSlot: [16, -2, 18] },
  wingmen: [
    { id: 'hardway',   speaker: 'hardway',   slot: [0, 0, -14] }, // lead, ahead of the anchor
    { id: 'boxcars',   speaker: 'boxcars',   slot: [-18, 0, 2] },
    { id: 'snakeeyes', speaker: 'snakeeyes', slot: [18, 3, 9] },
  ],

  waypoints: {
    RECON1: [250, 40, -1000],
    RECON2: [-350, -30, -1900],
    RECON3: [450, 70, -2800],
    HOME: [0, 0, 160],
  },

  script: [
    { id: 'b_open', when: { t: 1.0 },
      do: [ { comms: 'house.checkin' }, { objective: { id: 'formup', state: 'active', label: 'Form up — slot into the flight' } }, { slot: { show: true } } ] },
    { id: 'b_lead', when: { commsDone: 'house.checkin' },
      do: [ { comms: 'hardway.formup' } ] },
    { id: 'b_formed', when: { formedUp: 44 },
      do: [ { objective: { id: 'formup', state: 'complete' } }, { comms: 'hardway.in' },
            { objective: { id: 'recon', state: 'active', label: 'Recon the three nav points' } },
            { formation: { move: true } }, { waypoint: { id: 'RECON1', label: 'RECON 1' } } ] },
    { id: 'b_r1', when: { or: [ { waypoint: 'RECON1', radius: 200 }, { after: 'b_formed', delay: 150 } ] },
      do: [ { comms: 'house.recon1' }, { waypoint: { id: 'RECON2', label: 'RECON 2' } } ] },
    { id: 'b_r2', when: { or: [ { waypoint: 'RECON2', radius: 200 }, { after: 'b_r1', delay: 150 } ] },
      do: [ { comms: ['boxcars.contacts', 'snakeeyes.quiet'] }, { waypoint: { id: 'RECON3', label: 'RECON 3' } } ] },
    { id: 'b_r3', when: { or: [ { waypoint: 'RECON3', radius: 200 }, { after: 'b_r2', delay: 150 } ] },
      do: [ { comms: 'house.recon3' }, { objective: { id: 'recon', state: 'complete' } },
            { objective: { id: 'rtb', state: 'active', label: 'Return to the carrier' } },
            { waypoint: { id: 'HOME', label: 'CARRIER' } } ] },
    { id: 'b_home', when: { or: [ { waypoint: 'HOME', radius: 110 }, { after: 'b_r3', delay: 220 } ] },
      do: [ { comms: 'house.rtb' }, { objective: { id: 'rtb', state: 'complete' } } ] },
    { id: 'b_end', when: { commsDone: 'house.rtb' },
      do: [ { complete: { title: 'RECON COMPLETE', sub: 'Intel logged. The build-up is real — and it is big.' } } ] },
  ],

  lines: {
    'house.checkin':  { speaker: 'house',     text: "Longshot flight, House. Recon only — Groombridge's gone dark and Command thinks the Chigs are massing. Form on Hardway's wing, weapons cold. We look, we leave.", dur: 7.5 },
    'hardway.formup': { speaker: 'hardway',   text: "Comeout — your slot's the blue box. Slide in nice and easy and hold it. Stay off the gas.", dur: 5.5 },
    'hardway.in':     { speaker: 'hardway',   text: "That's it, you're in the pocket. Flight, pushing up. Eyes on the scopes.", dur: 4.5 },
    'house.recon1':   { speaker: 'house',     text: 'First mark logged. Reactor bloom out there — something big is warming up.', dur: 5.0 },
    'boxcars.contacts':{ speaker: 'boxcars',  text: "Boss, my scope's lit — hard contacts all along the far edge. That's a wall of Chigs.", dur: 5.5 },
    'snakeeyes.quiet':{ speaker: 'snakeeyes', text: 'Always the way. Quiet system, full of teeth.', dur: 3.5 },
    'house.recon3':   { speaker: 'house',     text: "Third mark. It's a staging yard — they're building for a push. Get it all and get gone. Do not engage.", dur: 6.5 },
    'house.rtb':      { speaker: 'house',     text: "That's the package. Bring it home, Longshot — we were never here. House out.", dur: 5.5 },
  },
};
