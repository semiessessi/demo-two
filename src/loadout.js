// Apply a weapon-mount loadout to the ship by showing/hiding the detachable ordnance meshes that
// scripts/cut_ordnance.py separated from the hull (the hull keeps a flush cap-plate at every station,
// so a removed part never leaves a hole). Missile / LR-missile / laser meshes will slot in here the
// same way once they're cut; until then those mounts have no geometry and are simply skipped.

// mount id -> the loadout value(s) at which its mesh is shown
const SHOW_WHEN = {
  fuelL: (v) => v === 'fuel',
  fuelR: (v) => v === 'fuel',
  // L1/L2/L3/R1/R2/R3 (missiles / lr-missile / laser): added when those meshes exist
};

export function applyLoadout(ship, loadout) {
  if (!ship || !ship.ordnance || !loadout) return;
  for (const [mount, mesh] of Object.entries(ship.ordnance)) {
    const pred = SHOW_WHEN[mount];
    if (mesh) mesh.visible = pred ? pred(loadout[mount]) : false;
  }
}
