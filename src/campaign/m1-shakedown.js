// Mission 1 — "Shakedown". The bible's opener: a quiet nav-patrol with NO combat that ends on a distress
// signal the flight arrives too late to help. It exists to teach the flight model + comms + objectives and
// to set the tone (House's no-luck creed, the dice motif) before the war turns ugly. This is also the
// vertical slice that proves the whole campaign pipeline.
//
// Authoring note: this file is plain data. Beats fire in order when their `when` trigger is met; `do`
// actions run the effect. VO drops into public/vo/m1-shakedown/<lineId>.<mp3|ogg|wav>; absent = subtitle
// only. Nav legs OR a generous timeout so a wandering player can never soft-lock the mission.

export const m1 = {
  id: 'm1-shakedown',
  title: 'Shakedown',
  act: 1,
  requires: null,                 // first mission — always unlocked
  environment: 'groombridge34',   // key into ENVIRONMENT (settings.js)
  difficulty: 'veteran',          // no combat in M1, so this is cosmetic here
  loadout: 'default',
  vo: 'm1-shakedown',             // -> public/vo/m1-shakedown/<lineId>.<ext>
  music: { track: null, duck: 0.35 },

  briefing: {
    location: 'GROOMBRIDGE 34 · NAV PATROL',
    body: [
      'Three days out of the academy and they hand you a milk run. Good — keep it that way.',
      'Form on the Longshots, fly the patrol arc past the relay buoy, and bring everyone home. House is on the net: do what she says and you might make a habit of surviving.',
    ],
    objectives: ['Form up on Longshot flight', 'Fly the nav-patrol route', 'Log the relay buoy'],
  },

  player: { callsign: 'COMEOUT', start: { pos: [0, 0, 0], heading: [0, 0, -1] } },

  // Wingmen formate on the player's wing the whole sortie (no combat in M1).
  wingmen: [
    { id: 'hardway',   speaker: 'hardway',   slot: [-14, 1, -10], mode: 'formate', mortal: true },
    { id: 'boxcars',   speaker: 'boxcars',   slot: [16, 0, 8],    mode: 'formate', mortal: true },
    { id: 'snakeeyes', speaker: 'snakeeyes', slot: [-18, -1, 12], mode: 'formate', mortal: true },
  ],

  // World positions for the patrol arc (player starts at origin facing -Z).
  waypoints: {
    NAV1:     [0, 40, -900],
    NAV2:     [620, 10, -1650],
    DISTRESS: [200, -70, -2350],
  },

  script: [
    { id: 'b_checkin', when: { t: 1.5 },
      do: [ { comms: 'house.checkin' }, { objective: { id: 'formup', state: 'active', label: 'Form up on Longshot flight' } } ] },
    { id: 'b_lead', when: { commsDone: 'house.checkin' },
      do: [ { comms: 'hardway.formup' } ] },
    { id: 'b_underway', when: { commsDone: 'hardway.formup' },
      do: [ { objective: { id: 'formup', state: 'complete' } },
            { objective: { id: 'patrol', state: 'active', label: 'Fly the nav-patrol route' } },
            { waypoint: { id: 'NAV1' } } ] },
    { id: 'b_banter', when: { after: 'b_underway', delay: 6 },
      do: [ { comms: ['boxcars.banter', 'snakeeyes.banter'] } ] },
    { id: 'b_nav1', when: { or: [ { waypoint: 'NAV1', radius: 220 }, { after: 'b_underway', delay: 80 } ] },
      do: [ { comms: 'house.nav1' }, { waypoint: { id: 'NAV2' } } ] },
    { id: 'b_nav2', when: { or: [ { waypoint: 'NAV2', radius: 220 }, { after: 'b_nav1', delay: 80 } ] },
      do: [ { comms: 'house.distress' },
            { objective: { id: 'patrol', state: 'complete' } },
            { objective: { id: 'investigate', state: 'active', label: 'Investigate the distress signal' } },
            { waypoint: { id: 'DISTRESS' } } ] },
    { id: 'b_arrive', when: { or: [ { waypoint: 'DISTRESS', radius: 240 }, { after: 'b_nav2', delay: 80 } ] },
      do: [ { comms: 'hardway.toolate' }, { waypoint: { hide: true } } ] },
    { id: 'b_climax', when: { commsDone: 'hardway.toolate' },
      do: [ { comms: 'house.rtb' }, { objective: { id: 'investigate', state: 'complete' } } ] },
    { id: 'b_end', when: { commsDone: 'house.rtb' },
      do: [ { complete: { title: 'PATROL COMPLETE', sub: 'They will not be the last. Return to base.' } } ] },
  ],

  // Subtitle text + fallback timing. `dur` is the minimum on-screen time + the no-VO duration; real audio
  // length wins when a file is present.
  lines: {
    'house.checkin':   { speaker: 'house',     text: "Longshot flight, this is House. Cleared for the nav arc. Comeout — you're the new dice in the cup. Try not to roll low.", dur: 6.0 },
    'hardway.formup':  { speaker: 'hardway',   text: 'Comeout, Hardway. Tuck in on my wing and fly the arc by the numbers. No heroics out here.', dur: 5.5 },
    'boxcars.banter':  { speaker: 'boxcars',   text: "Rookie's first patrol. Twenty creds says he white-knuckles the whole arc.", dur: 4.5 },
    'snakeeyes.banter':{ speaker: 'snakeeyes', text: "No bet. Quiet's how it always starts, Box.", dur: 3.5 },
    'house.nav1':      { speaker: 'house',     text: 'Mark NAV-1. Come right for the relay buoy, steady as she goes.', dur: 4.5 },
    'house.distress':  { speaker: 'house',     text: "Flight, House — the buoy's squawking a distress code. Go and look.", dur: 4.5 },
    'hardway.toolate': { speaker: 'hardway',   text: "...Contact. It's a hauler. Or it was. No squawk. No survivors. We're too late.", dur: 6.0 },
    'house.rtb':       { speaker: 'house',     text: 'Log it and bring them home, Longshot. No such thing as luck out here — only who got there first. House out.', dur: 6.5 },
  },
};
