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
    location: 'GROOMBRIDGE 34 · RECON SWEEP',
    body: [
      'Your first sortie: a recon sweep on the far side of the Groombridge gate. Command is nervous the Chigs are staging here for a push and wants eyes on it.',
      'Form up on the flight, run the three nav marks, and report what is out there. Weapons stay cold — this is look-and-leave, not a fight.',
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
      do: [ { comms: ['boxcars.empty', 'snakeeyes.quiet'] }, { waypoint: { id: 'RECON3', label: 'RECON 3' } } ] },
    { id: 'b_r3', when: { or: [ { waypoint: 'RECON3', radius: 200 }, { after: 'b_r2', delay: 150 } ] },
      do: [ { comms: 'house.recon3' }, { objective: { id: 'recon', state: 'complete' } },
            { objective: { id: 'rtb', state: 'active', label: 'Return to the carrier' } },
            { waypoint: { id: 'HOME', label: 'CARRIER' } } ] },
    { id: 'b_home', when: { or: [ { waypoint: 'HOME', radius: 110 }, { after: 'b_r3', delay: 220 } ] },
      do: [ { comms: 'house.rtb' }, { objective: { id: 'rtb', state: 'complete' } } ] },
    { id: 'b_end', when: { commsDone: 'house.rtb' },
      do: [ { complete: { title: 'RECON COMPLETE', sub: 'Groombridge is clear — no build-up, no contact. A quiet first run. They will not all be.' } } ] },
  ],

  lines: {
    'house.checkin':  { speaker: 'house',     text: "Longshot flight, House. We're through the Groombridge gate — recon sweep. Command thinks the Chigs might be staging here; we go and find out. Form on Hardway, weapons cold.", dur: 7.5 },
    'hardway.formup': { speaker: 'hardway',   text: "Comeout — your slot's the blue box. Slide in nice and easy and hold it. Stay off the gas.", dur: 5.5 },
    'hardway.in':     { speaker: 'hardway',   text: "Good, you're in the pocket. Flight, pushing up. Let's see what's out here.", dur: 4.5 },
    'house.recon1':   { speaker: 'house',     text: "First mark... clear. Nothing on the scope — no reactors, no traffic, nothing at all.", dur: 5.5 },
    'boxcars.empty':  { speaker: 'boxcars',   text: "Boss, there's nothing out here. Where's this build-up they dragged us out for?", dur: 4.5 },
    'snakeeyes.quiet':{ speaker: 'snakeeyes', text: "Empty suits me fine. Nobody out here to roll snake-eyes on me.", dur: 4.0 },
    'house.recon3':   { speaker: 'house',     text: "Last mark's clear too. Whole system's a ghost — no build-up, no Chigs, nothing. That's our recon: there's nothing here.", dur: 7.5 },
    'house.rtb':      { speaker: 'house',     text: "Good. Log it clear and take it home, Longshot. A quiet one — don't get used to them. House out.", dur: 6.0 },
  },
};
