// Apply a weapon-mount loadout to the ship by showing/hiding the detachable ordnance meshes that
// scripts/cut_ordnance.py separated from the hull (the hull keeps a flush cap-plate at every station,
// so a removed part never leaves a hole). Missile / LR-missile / laser meshes will slot in here the
// same way once they're cut; until then those mounts have no geometry and are simply skipped.

export function applyLoadout(ship, loadout) {
  if (!ship || !ship.ordnance || !loadout) return;
  const o = ship.ordnance;
  if (o.fuelL) o.fuelL.visible = loadout.fuelL === 'fuel';
  if (o.fuelR) o.fuelR.visible = loadout.fuelR === 'fuel';
  // the modelled missile pair sits at its real (outer) station; show it on a wing if any of that wing's
  // outer mounts is set to a missile pair. (Cloning a pair onto EACH distinct mount is a follow-up that
  // needs per-mount hardpoint positions.)
  const left = loadout.L1 === 'missile-pair' || loadout.L2 === 'missile-pair' || loadout.L3 === 'missile-pair';
  const right = loadout.R1 === 'missile-pair' || loadout.R2 === 'missile-pair' || loadout.R3 === 'missile-pair';
  if (o.missileL) o.missileL.visible = left;
  if (o.missileR) o.missileR.visible = right;
}
