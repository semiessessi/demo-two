// Coordinate-bucket spatial hash for fast broad-phase neighbour lookups (collision, proximity). This is
// the "lazily empty/delete empty buckets" design: a sparse Map keyed by quantized cell coords, where
// begin() bumps a GENERATION counter instead of clearing the Map, insert() lazily resets a cell the first
// time it's touched this generation, and query() ignores cells whose generation is stale — so cells the
// melee has drifted away from read as EMPTY without ever being cleared (zero per-frame allocation / GC).
//
// It is a BROAD phase only: query() returns candidates in the overlapping cells; the caller still does the
// precise distance test. The win is replacing "every mover × every ship" with "every mover × a few nearby
// ships". At ~30 ships the absolute saving is tiny (CPU here is sub-millisecond), but it's a clean reusable
// structure that scales as entity counts grow.
//
// Numeric cell key (string keys would churn GC): quantize each axis, offset by +OFF to stay non-negative,
// pack into one integer < 2^53. Cells outside [-OFF, OFF)·cellSize wrap onto each other — harmless for this
// game's bounded play space (a wrap just yields a few extra broad-phase candidates the precise test rejects).

const OFF = 2048;
const SPAN = 4096; // 2*OFF — must exceed the per-axis cell-index range

export function createSpatialGrid(cellSize = 16) {
  const inv = 1 / cellSize;
  const cells = new Map();
  let gen = 0;

  const key = (ix, iy, iz) => ((ix + OFF) * SPAN + (iy + OFF)) * SPAN + (iz + OFF);

  // Start a new frame: bump the generation (does NOT clear the Map). A rare sweep reclaims cells the fight
  // has permanently left so the Map can't grow unbounded if the action roams far.
  function begin() {
    gen++;
    if ((gen & 1023) === 0) for (const [k, c] of cells) if (gen - c.gen > 2) cells.delete(k);
  }

  function insert(x, y, z, item) {
    const k = key(Math.floor(x * inv), Math.floor(y * inv), Math.floor(z * inv));
    let c = cells.get(k);
    if (!c) { cells.set(k, { gen, items: [item] }); return; }
    if (c.gen !== gen) { c.gen = gen; c.items.length = 0; } // first touch this frame -> lazy clear
    c.items.push(item);
  }

  // Call cb(item) for every inserted item in the cells overlapping the sphere (x,y,z,r). Broad phase: the
  // caller filters by the real distance. Stale-generation cells (the melee moved on) are skipped as empty.
  function query(x, y, z, r, cb) {
    const x0 = Math.floor((x - r) * inv), x1 = Math.floor((x + r) * inv);
    const y0 = Math.floor((y - r) * inv), y1 = Math.floor((y + r) * inv);
    const z0 = Math.floor((z - r) * inv), z1 = Math.floor((z + r) * inv);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++)
        for (let iz = z0; iz <= z1; iz++) {
          const c = cells.get(key(ix, iy, iz));
          if (c && c.gen === gen) { const items = c.items; for (let i = 0; i < items.length; i++) cb(items[i]); }
        }
  }

  return { begin, insert, query, get cellSize() { return cellSize; } };
}
