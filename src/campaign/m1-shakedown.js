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
  faces: { house: 'house-operations' }, // House is GROUNDED early — she commands from the Lex's ops, not a cockpit

  briefing: {
    location: 'GROOMBRIDGE 34 · RECON SWEEP',
    body: [
      'Your first sortie: a recon sweep on the far side of the Groombridge gate. Command is nervous the Chigs are staging here for a push and wants eyes on it.',
      'Form up on the flight, run the three nav marks, and report what is out there. Weapons stay cold — this is look-and-leave, not a fight.',
    ],
    objectives: ['Form up on the flight', 'Recon the three nav points', 'Return to the carrier'],
  },

  player: { callsign: 'COMEOUT', start: { pos: [0, 0, 0], heading: [0, 0, -1] } },
  gate: { pos: [0, 0, 160] }, // the wormhole you came through / jump back out of (placeholder ring)

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
    GATE: [0, 0, 160],
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
      do: [ { comms: 'house.recon3' }, { objective: { id: 'recon', state: 'complete' } } ] },
    // the recon is CLEAN — and the emptiness itself is the alarm: they never massed here, so they've gone for Earth.
    { id: 'b_flash', when: { commsDone: 'house.recon3' },
      do: [ { comms: 'house.flash' },
            { objective: { id: 'rtb', state: 'active', label: 'Get back to the wormhole' } },
            { waypoint: { id: 'GATE', label: 'WORMHOLE' } } ] },
    { id: 'b_push', when: { commsDone: 'house.flash' }, do: [ { comms: 'hardway.burn' } ] },
    { id: 'b_jump', when: { or: [ { waypoint: 'GATE', radius: 90 }, { after: 'b_flash', delay: 240 } ] },
      do: [ { comms: 'house.jump' }, { objective: { id: 'rtb', state: 'complete' } } ] },
    { id: 'b_end', when: { commsDone: 'house.jump' },
      do: [ { complete: { title: 'JUMPING OUT', sub: 'Groombridge was empty — and empty means the Chigs never came here. They are already driving on the inner worlds. The Longshots race home a step behind a war.' } } ] },
  ],

  lines: {
    'house.checkin':  { speaker: 'house',     text: "Longshot flight, this is House, on the Lex. You're through the Groombridge gate — recon sweep. Command reckons the Chigs are massing out there for a push; you go confirm it. Form on Hardway, weapons cold.", dur: 8.5 },
    'hardway.formup': { speaker: 'hardway',   text: "Comeout — your slot's the blue box. Slide in nice and easy and hold it. Stay off the gas.", dur: 5.5 },
    'hardway.in':     { speaker: 'hardway',   text: "Good, you're in the pocket. Flight, pushing up. Let's see what's out here.", dur: 4.5 },
    'house.recon1':   { speaker: 'house',     text: "First mark's clear — I've got your take up here. Nothing on the scope: no reactors, no traffic, nothing at all.", dur: 5.5 },
    'boxcars.empty':  { speaker: 'boxcars',   text: "Boss, there's nothing out here. Where's this build-up they dragged us out for?", dur: 4.5 },
    'snakeeyes.quiet':{ speaker: 'snakeeyes', text: "Empty suits me fine. Nobody out here to roll snake-eyes on me.", dur: 4.0 },
    'house.recon3':   { speaker: 'house',     text: "Last mark's clear too. Whole system reads a ghost from up here — no build-up, no Chigs, nothing. That's your recon, Longshot: there's nothing there.", dur: 7.5 },
    'house.flash':    { speaker: 'house',     text: "Longshot flight, House — and 'nothing' is the problem. Command staged for a war here and the system's empty; they never came. If they're not massing at Groombridge, they've already slipped past us for the inner worlds. For Earth. Scrub the recon — back to the gate and jump. Now.", dur: 11.0 },
    'hardway.burn':   { speaker: 'hardway',   text: "You heard her — if they're driving on Earth, we're already behind. Firewall it for the gate; form on me, we jump together.", dur: 5.5 },
    'house.jump':     { speaker: 'house',     text: "Gate's hot. Punch through, Longshot — every second's Earth's now. I'll have Command lit before you're through. Go.", dur: 6.0 },
  },
};
