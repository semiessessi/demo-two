import * as THREE from 'three';

// Maps audio (amplitude + bass/mid/treble bands) and flight throttle onto the visuals: bloom
// strength, a returned thruster intensity, the nebula brightness "breath", and star twinkle.
// A small bass-rise envelope gives a punchy beat kick on top of the steady amplitude.

export function createReactive() {
  let beat = 0;
  let prevBass = 0;

  function update({ amp = 0, bands = null, throttle = 0, boosting = false }, targets, dt) {
    const { bloom, nebula, starUniforms } = targets;
    const bass = bands ? bands[0] : 0;
    const mid = bands ? bands[1] : 0;
    const treble = bands ? bands[2] : 0;

    // beat = decaying envelope retriggered by rising bass
    const rise = Math.max(0, bass - prevBass);
    prevBass = bass;
    beat = Math.max(beat * Math.exp(-4 * dt), rise * 3.2);

    const energy = amp + beat * 0.5;

    if (bloom) bloom.strength = 0.5 + energy * 1.5 + (boosting ? 0.35 : 0);

    if (nebula) {
      const targetPulse = (mid + treble) * 0.5 + beat * 0.7;
      nebula.uPulse.value += (targetPulse - nebula.uPulse.value) * (1 - Math.exp(-5 * dt));
    }

    // (stars do not twinkle — it's space)

    // thruster intensity: throttle is the floor, music adds flare
    const thrust = THREE.MathUtils.clamp(throttle * 0.9 + energy * 0.8 + beat * 0.6, 0, 1.7);
    return { thrust, beat, energy };
  }

  return { update };
}
