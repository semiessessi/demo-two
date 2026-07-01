// Speaker table for campaign comms: display name + subtitle colour, keyed by the `speaker` field on a
// dialogue line. The 88th "Longshots" run on a dice/gambling motif; House (the CO) is the moral anchor
// who insists there's no such thing as luck — only odds you didn't read.

export const CHARACTERS = {
  house:     { name: 'HOUSE',      color: '#9ec7ff' }, // CO, British, dry — "the house always wins"
  hardway:   { name: 'HARDWAY',    color: '#7fd08a' }, // by-the-book lead element; moral centre
  boxcars:   { name: 'BOXCARS',    color: '#e7c14a' }, // hotshot glory-hound
  snakeeyes: { name: 'SNAKE-EYES', color: '#e78a4a' }, // the unlucky one who never quite dies
  push:      { name: 'PUSH',       color: '#b6a8e0' }, // quiet survivor
  loaded:    { name: 'LOADED',     color: '#e08aa8' }, // a "Chip" (engineered underclass)
  natural:   { name: 'NATURAL',    color: '#8ad0c8' }, // effortless prodigy
  // extra 88th "Longshots" pilots — portraits added (public/faces/); assign roles as dialogue needs them
  gambler:   { name: 'GAMBLER',    color: '#e0766a' }, // scarred veteran
  dice:      { name: 'DICE',       color: '#b8b0c8' }, // older woman, senior hand
  pips:      { name: 'PIPS',       color: '#d8a860' },
  luckyseven:{ name: 'LUCKY SEVEN',color: '#c0d060' },
  sixshooter:{ name: 'SIX-SHOOTER',color: '#e590b8' }, // young pilot
  silicate:  { name: 'SILICATE',   color: '#9fe8e0' }, // Chig-allied rebel-AI android — cold, synthetic
  wildcards: { name: '58TH',       color: '#a0b8d8' }, // the canon 58th "Wild Cards" (overheard radio, episode samples)
  player:    { name: 'COMEOUT',    color: '#cdd6ea' }, // the player — the new arrival
};
