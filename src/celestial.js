import * as THREE from 'three';

// Per-environment background bodies that sit at "infinity" (re-centred on the camera each frame, like
// the nebula/sun). Currently: Jupiter (textured sphere + a soft fresnel atmosphere limb, adapted from
// the stars-clone gas-giant limb-glow technique) and a basic Cerberus black hole (event horizon +
// tilted accretion disk + photon ring). Lit by the scene's existing sun direction.

// --- Jupiter -----------------------------------------------------------------
export function createJupiter(renderer, sunDir) {
  const group = new THREE.Group();
  group.visible = false;

  const loader = new THREE.TextureLoader();
  const tex = loader.load('/jupiter.png');
  tex.colorSpace = THREE.NoColorSpace; // raw ShaderMaterial decodes sRGB manually (pow 2.2) below
  if (renderer) tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const R = 180; // smaller (~twice as far + room for the moons' real orbits), placed ~3400 units out
  // Custom-lit so its brightness / terminator / night-side ambient / saturation are independent of the
  // scene's gameplay lighting (otherwise it blows out + the dark side reads too bright). Tunable.
  const planetMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uSunDir: { value: new THREE.Vector3(-55, 30, -30).normalize() },
      uExposure: { value: 0.5 }, // overall brightness
      uAmbient: { value: 0.04 }, // night-side fill (keep low so the dark limb stays dark)
      uSat: { value: 0.6 }, // desaturate the (very saturated) Hubble map
    },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform vec3 uSunDir; uniform float uExposure; uniform float uAmbient; uniform float uSat;
      varying vec2 vUv; varying vec3 vN;
      void main(){
        vec3 base = pow(texture2D(uMap, vUv).rgb, vec3(2.2)); // sRGB -> linear
        float l = dot(base, vec3(0.299, 0.587, 0.114));
        base = mix(vec3(l), base, uSat);
        float ndl = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
        float light = uAmbient + (1.0 - uAmbient) * ndl; // lambert + small ambient
        gl_FragColor = vec4(base * light * uExposure, 1.0); // linear; OutputPass tone-maps + encodes
      }`,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), planetMat);
  planet.renderOrder = -3; // behind the action, in front of stars/nebula

  // Soft atmosphere limb: a slightly larger additive shell glowing at the rim (fresnel), brightest on
  // the sunlit side so the terminator stays believable. No hard edge -> the planet fades into space.
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xcbb187) }, // warm jovian haze
      uSunDir: { value: new THREE.Vector3(-55, 30, -30).normalize() },
      uPower: { value: 3.2 },
      uStrength: { value: 1.15 },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform vec3 uSunDir; uniform float uPower; uniform float uStrength;
      varying vec3 vN; varying vec3 vWorld;
      void main(){
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(normalize(vN), V), 0.0), uPower); // limb glow
        float lit = smoothstep(-0.35, 0.5, dot(normalize(vN), normalize(uSunDir))); // dimmer on the night limb
        float a = fres * uStrength * mix(0.25, 1.0, lit);
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.045, 96, 64), atmoMat);
  atmo.renderOrder = -2;
  group.add(planet, atmo);

  // --- Galilean moons (Io, Ganymede): realistic relative sizes + orbit radii (in Jupiter radii) +
  // period ratio, time-compressed so they're visible. Orbits in Jupiter's ~equatorial plane (low 3.1deg
  // axial tilt). Circular (mean Kepler). ---
  const DAY = 130; // in-game seconds per Jovian "day" -> Io ~3.8 min/orbit, Ganymede ~15.5 min (real 1:4 ratio)
  const moonDefs = [
    { col: 0xd8b24a, rough: 0.9, rr: 6.03, sz: 0.0260, period: 1.769, ang: 0.6 }, // Io (sulfur)
    { col: 0x8f8c83, rough: 1.0, rr: 15.3, sz: 0.0377, period: 7.155, ang: 2.4 }, // Ganymede (grey/icy)
  ];
  const tilt = 3.13 * Math.PI / 180;
  const orbU = new THREE.Vector3(1, 0, 0);
  const orbV = new THREE.Vector3(0, 0, 1).applyAxisAngle(orbU, tilt); // orbital plane, low axial tilt
  const moons = moonDefs.map((m) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(Math.max(m.sz * R, 1.2), 32, 20),
      new THREE.MeshStandardMaterial({ color: m.col, roughness: m.rough, metalness: 0 }));
    mesh.castShadow = mesh.receiveShadow = false;
    group.add(mesh);
    return { mesh, rr: m.rr * R, w: (2 * Math.PI) / (m.period * DAY), ang: m.ang };
  });

  function update(dt) {
    planet.rotateY(0.02 * dt); // Jupiter's fast spin (bands ~horizontal -> low tilt)
    for (const mn of moons) {
      mn.ang += mn.w * dt;
      mn.mesh.position.copy(orbU).multiplyScalar(Math.cos(mn.ang) * mn.rr).addScaledVector(orbV, Math.sin(mn.ang) * mn.rr);
    }
  }

  return { group, planet, planetMat, atmoMat, radius: R, update };
}

// --- Cerberus black hole (raymarched Schwarzschild lensing) ------------------
// A camera-facing billboard whose fragment shader marches photon geodesics around the hole: the
// accretion disk is gravitationally lensed (you see its far side arc over + under the shadow), a
// photon/Einstein ring forms, and the disk is doppler-beamed (approaching side brighter + bluer).
// Where rays escape with no disk hit, alpha = 0 so the real scene background shows through.
export function createBlackHole() {
  const group = new THREE.Group();
  group.visible = false;

  const Rs = 90; // event-horizon (Schwarzschild) radius in world units
  const DISK_IN = 2.2 * Rs;
  const DISK_OUT = 9.0 * Rs; // wider accretion disk
  const SKY_R = 5000; // sky-pass sphere radius (centred on the camera). The raymarch is direction-only, so
  // this is just where the fragments live; rendering on a sphere = no billboard quad edge.

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCamPos: { value: new THREE.Vector3() },
      uCenter: { value: new THREE.Vector3() },
      uDiskN: { value: new THREE.Vector3(0.26, 0.96, -0.11).normalize() }, // disk normal ~68° off the view (BH_DIR) — halfway between edge-on (old) and the open tilt, so it's clearly a disk
      uRs: { value: Rs },
      uDiskIn: { value: DISK_IN / Rs }, // disk radii in Rs units (shader works in Rs units)
      uDiskOut: { value: DISK_OUT / Rs },
      uTime: { value: 0 },
      uSteps: { value: 150 },
      uMwNormal: { value: new THREE.Vector3(0.9101, 0.4020, -0.1002).normalize() }, // galactic pole (lensed Milky Way)
      uSpokeBright: { value: 0.9 }, // brightness of the spoked blue/purple nebula behind the hole
    },
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide, // rendered on the inside of a sky sphere centred on the camera
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vWorld;
      uniform vec3 uCamPos, uCenter, uDiskN, uMwNormal;
      uniform float uRs, uDiskIn, uDiskOut, uTime, uSpokeBright;
      uniform int uSteps;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }

      // procedural sky (nebula tint + Milky Way band + sparse stars) sampled in a (lensed) direction
      vec3 backgroundSky(vec3 dir){
        float gy = dot(dir, uMwNormal);
        float mw = exp(-pow(gy * 4.0, 2.0));
        vec3 col = vec3(0.03, 0.025, 0.06) + vec3(0.22, 0.13, 0.26) * mw; // faint nebula + warm-purple band
        vec3 g = dir * 130.0; vec3 c = floor(g); vec3 f = fract(g) - 0.5;
        float h = fract(sin(dot(c, vec3(12.9, 78.2, 37.7))) * 43758.5);
        col += vec3(0.85, 0.9, 1.0) * step(0.985, h) * smoothstep(0.18, 0.0, length(f)) * 3.6; // stars (denser -> the lensed smear/arcs wrapping the hole actually read)
        return col;
      }

      // Spoked blue/purple nebula radiating from BEHIND the hole. Sampled with the LENSED direction so it
      // warps around the hole; its own radial falloff fades it out before the quad edge (no square).
      float spokeNebula(vec3 dir, vec3 axis){
        float ca = clamp(dot(dir, axis), -1.0, 1.0);
        float ang = acos(ca);                                    // 0 at the hole, grows outward
        if (ang > 1.18) return 0.0;                              // past the spoke reach -> skip the heavy fbm over the wider cone
        vec3 t = dir - axis * ca;                                // tangential component
        vec3 up = abs(axis.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 ux = normalize(cross(axis, up));
        vec3 vx = cross(axis, ux);
        float az = atan(dot(t, vx), dot(t, ux));                 // azimuth — feeds cos() ONLY (periodic, so the +/-pi wrap is seamless)
        az += 0.3 * smoothstep(0.12, 1.0, ang);                  // tips curve toward the same rotational sense
        vec2 pp = vec2(dot(dir, ux), dot(dir, vx));              // CONTINUOUS tangential coords -> the NOISE has no atan2 seam (the old fbm(az) tore here)
        float warp = fbm(pp * 1.7 + 5.0);
        float spk = pow(0.5 + 0.5 * cos(az * 22.0 + warp * 6.2831), 0.2); // VERY fat arms (low exponent); they touch/overlap, which is fine; cos() periodic -> seamless
        float fil = fbm(pp * 5.0 + 21.0);                        // radial filaments (seamless)
        float body = spk * mix(0.48, 1.0, fil);                  // higher floor -> fuller, padded arms
        float lanes = fbm(pp * 11.0 + 40.0);                     // fine dust lanes (seamless)
        body *= mix(0.28, 1.0, smoothstep(0.34, 0.66, lanes));   // carve dark dust lanes (Milky-Way-ish)
        // annular radial profile: starts at the hole, fades before the cone edge (soft -> no square)
        float radial = smoothstep(0.0, 0.05, ang) * (1.0 - smoothstep(0.52, 1.15, ang));
        radial *= 0.5 + 0.7 * fbm(pp * 3.0 + 2.0);              // large-scale clumping (seamless)
        return clamp(body * radial, 0.0, 1.0);
      }

      // disk emission at a hit point (in Rs units, disk-plane radius rr), with temperature + turbulence + doppler
      vec3 diskColor(vec3 hit, vec3 N, vec3 dir, float rr){
        // basis in the disk plane
        vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0) + N.zxy * 0.001));
        vec3 Bv = cross(N, T);
        float ang = atan(dot(hit, Bv), dot(hit, T));
        float t = clamp((rr - uDiskIn) / (uDiskOut - uDiskIn), 0.0, 1.0); // 0 inner -> 1 outer
        // swirling turbulence (spirals: angle shifts with radius + time)
        float spin = uTime * 3.4 / (rr * 0.5 + 1.0); // faster differential orbital shear (inner rings whip round)
        float turb = fbm(vec2(ang * 2.5 + rr * 1.4 - spin, rr * 0.9 + uTime * 0.12));
        turb = mix(turb, fbm(vec2(ang * 5.5 - spin * 1.8, rr * 1.9)), 0.4); // finer co-rotating filaments flowing past
        // temperature ramp: blue-white (inner) -> orange -> deep red (outer)
        vec3 hot = vec3(0.95, 0.55, 1.0);   // hot inner -> violet-white
        vec3 mid = vec3(1.0, 0.32, 0.42);   // red-magenta
        vec3 cool = vec3(0.62, 0.05, 0.24); // deep red-purple outer
        vec3 col = mix(mix(hot, mid, smoothstep(0.0, 0.45, t)), cool, smoothstep(0.45, 1.0, t));
        float bright = (1.7 - 1.2 * t) * (0.55 + 0.9 * turb);
        // relativistic doppler beaming: prograde orbital velocity vs view
        vec3 vel = normalize(cross(N, hit));
        float beta = clamp(0.62 / sqrt(rr), 0.0, 0.72);
        float approach = dot(vel, -normalize(dir));
        float boost = pow(clamp(1.0 / (1.0 - beta * approach), 0.0, 4.0), 2.6);
        col = mix(col, vec3(0.7, 0.85, 1.0), clamp(approach * beta * 0.7, 0.0, 0.6)); // blueshift toward viewer
        // soft inner/outer rims
        float rim = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.85, t);
        return col * bright * boost * rim;
      }

      void main(){
        vec3 N = normalize(uDiskN);
        vec3 p = (uCamPos - uCenter) / uRs;          // ray start, Rs units
        vec3 d = normalize(vWorld - uCamPos);        // view ray
        vec3 rd0 = d;                                // original (un-bent) direction
        vec3 axis = normalize(uCenter - uCamPos);    // direction to the hole
        if (dot(rd0, axis) < 0.30) discard;          // SKY PASS: wider cone toward the hole (the spokes reach farther now); elsewhere the real scene shows -> no billboard edge
        p += d * max(0.0, -dot(p, d) - 45.0);        // skip empty outer space: begin the fine march ~45 Rs out, so the step budget stays fixed as the hole moves farther
        vec3 angm = cross(p, d); float h2 = dot(angm, angm); // ~conserved (geodesic)
        vec3 acc = vec3(0.0); float alpha = 0.0; bool captured = false;
        float minr = 1e9;
        for (int i = 0; i < 220; i++){
          if (i >= uSteps) break;
          float r = length(p);
          minr = min(minr, r);
          if (r < 1.0){ captured = true; break; }     // through the horizon
          if (r > 42.0 && dot(d, p) > 0.0) break;      // escaped
          float dl = clamp(0.16 * (r - 1.0), 0.035, 0.6);
          vec3 prev = p;
          // Schwarzschild photon bend (standard real-time approximation)
          d = normalize(d + (-1.5 * h2 * p / pow(r, 5.0)) * dl);
          p += d * dl;
          // accretion-disk plane crossing between prev and p
          float s0 = dot(prev, N), s1 = dot(p, N);
          if (s0 * s1 < 0.0){
            float tt = s0 / (s0 - s1);
            vec3 hit = mix(prev, p, tt);
            float rr = length(hit);
            if (rr > uDiskIn && rr < uDiskOut){
              vec3 c = diskColor(hit, N, d, rr);
              float a = clamp((1.7 - 1.2 * clamp((rr-uDiskIn)/(uDiskOut-uDiskIn),0.0,1.0)) * 0.5, 0.0, 1.0);
              acc += c * (1.0 - alpha);              // front-to-back over the (thin) disk
              alpha += a * (1.0 - alpha);
            }
          }
        }
        if (captured) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; } // shadow occludes the background
        // escaped: composite the gravitationally-LENSED sky (distorted stars + Milky Way) behind the disk,
        // shown where the ray was significantly bent (fades to the real scene where it wasn't) + the photon ring.
        // zone confines everything to the rays that passed near the hole -> fades to 0 before the quad edge
        // (no visible square). minr = the ray's closest approach in Rs units.
        float zone = 1.0 - smoothstep(11.0, 36.0, minr); // lensed/smeared stars wrap around the hole (extended farther out)
        float bend = length(d - rd0);
        vec3 dn = normalize(rd0 + (d - rd0) * 1.6); // exaggerate the lensing deflection so the nebula visibly warps around the hole
        float neb = spokeNebula(dn, axis);
        // more PURPLE, with a violet<->magenta shimmer varying over the cloud (texture, Milky-Way-ish)
        vec3 nebCol = mix(vec3(0.30, 0.06, 0.62), vec3(0.55, 0.15, 0.80), fbm(vec2(d.x * 6.0 + 3.0, d.y * 6.0 - 2.0)));
        vec3 bg = nebCol * neb * uSpokeBright;                   // nebula
        bg += backgroundSky(d) * zone;                          // + lensed stars/Milky Way (the distortion)
        acc += bg * (1.0 - alpha);
        alpha = max(alpha, max(neb * 0.85, smoothstep(0.06, 0.55, bend) * zone));
        // photon ring / lensed arcs — ANIMATED: bright spots orbit the ring + a gentle pulse, so it shimmers
        vec3 upr = abs(axis.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 uxr = normalize(cross(axis, upr)); vec3 vxr = cross(axis, uxr);
        float azr = atan(dot(d, vxr), dot(d, uxr));
        float ring = exp(-pow((minr - 1.5) * 6.0, 2.0));
        ring *= 0.5 + 0.6 * (0.5 + 0.5 * sin(azr * 3.0 - uTime * 2.0)) + 0.16 * sin(uTime * 1.3); // orbiting hot-spots + pulse
        ring = max(ring, 0.0);
        acc += vec3(1.0, 0.92, 0.78) * ring * 0.9;
        alpha = max(alpha, ring * 0.9 * zone);
        // a few strongly-LENSED star arcs just outside the hole — tangential bright streaks = the warping signature
        float arcs = 0.0;
        if (minr < 14.0) for (int k = 0; k < 5; k++) { // arcs only exist hugging the hole -> skip over the wider cone
          float fk = float(k);
          float r0 = 1.7 + fk * 1.3;                                    // each arc at a different impact-parameter radius (Rs)
          float az0 = fk * 1.2566 + sin(uTime * 0.08 + fk * 2.1) * 0.6; // azimuth, slowly drifting
          float da = azr - az0; da = atan(sin(da), cos(da));            // wrap-safe azimuthal offset
          float rg = exp(-pow((minr - r0) * 4.5, 2.0));                 // thin tangential ring at r0
          float ag = exp(-pow(da * 2.2, 2.0));                          // localized in azimuth -> an arc, not a full ring
          arcs += rg * ag;
        }
        acc += mix(vec3(0.82, 0.9, 1.0), nebCol * 2.4, 0.6) * arcs * 1.8 * zone; // lensed into arcs in the SAME nebula purple (+ star white)
        alpha = max(alpha, clamp(arcs, 0.0, 1.0) * zone);
        if (alpha < 0.004) discard;                  // nothing here -> let the real scene show through
        gl_FragColor = vec4(acc, clamp(alpha, 0.0, 1.0));
      }`,
  });

  const plane = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 48, 32), mat); // sky-pass sphere (centred on the camera)
  plane.renderOrder = -2;
  plane.frustumCulled = false; // centred on the camera -> always in view, never cull
  group.add(plane);
  return { group, mat, plane, radius: DISK_OUT };
}

// --- Tartarus cloud planet (procedural white/cyan swirling clouds) ------------
export function createCloudPlanet() {
  const group = new THREE.Group();
  group.visible = false;
  const R = 1300; // huge: placed close (~1500 out) so it DOMINATES the sky
  // 8 swirl vortices: centres on a Fibonacci sphere + per-swirl twist / tightness / spin, PRECOMPUTED on the
  // CPU and passed as uniforms. (Recomputing the Fibonacci + hashes per pixel ×8 stalled hard.)
  const centers = [], swirls = [];
  const fr = (x) => x - Math.floor(x);
  const rng = (s) => fr(Math.sin(s) * 43758.5453);
  for (let i = 0; i < 8; i++) {
    const y = 1 - (i + 0.5) / 8 * 2, rr = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.39996323;
    centers.push(new THREE.Vector3(rr * Math.cos(th), y, rr * Math.sin(th)));
    const h = rng(i * 17.3 + 1.7);
    const str = (0.3 + 0.5 * h) * (h > 0.5 ? 1 : -1); // much gentler twist (was 1.3-2.7 -> way too extreme)
    const tight = 3.0 + 5.0 * rng(i * 7.1 + 3.3);
    const spin = (0.04 + 0.14 * rng(i * 13.7 + 9.1)) * (rng(i * 3.3 + 5.5) > 0.5 ? 1 : -1);
    swirls.push(new THREE.Vector4(str, tight, spin, 0));
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(-55, 30, -30).normalize() },
      uExposure: { value: 0.85 },
      uAmbient: { value: 0.07 },
      uCenters: { value: centers },
      uSwirl: { value: swirls },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vN; varying vec3 vP;
      uniform float uTime, uExposure, uAmbient; uniform vec3 uSunDir;
      uniform vec3 uCenters[8]; uniform vec4 uSwirl[8]; // x=twist y=tightness z=spin (precomputed on the CPU)
      float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.04; a*=0.5; } return v; }
      float fbm3(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<3;i++){ v+=a*noise(p); p*=2.04; a*=0.5; } return v; }
      // 8 overlapping VORTICES: each rotates the sample around its OWN radial axis (a cylinder perpendicular
      // to the surface, i.e. around the normal there), strongest at its centre and fading out, with a per-
      // swirl twist / tightness / time-spin. Centres + params come in as uniforms (cheap) and the falloff is
      // a rational (no per-pixel exp). Pure 3D -> runs through both sides, no facing logic. Deforming the
      // SAMPLE position (not the colour) is what curls the noise into storms.
      vec3 swirl(vec3 p){
        for(int i=0;i<8;i++){
          vec3 c=uCenters[i]; vec4 sp=uSwirl[i];
          // distance of p from the NORMAL LINE through the planet in direction c (the cylinder radius):
          float a=dot(p,c);
          float r=sqrt(max(0.0,1.0-a*a));                         // 0 on the axis line, 1 at c's equator
          // rotation scales UP then DOWN with that line distance (a tight eyewall ring), per sp.y tightness:
          float ring=4.0*r*(1.0-r); ring=ring*ring; ring=ring*ring; // tight, SMALL eyewall ring (4th power; no per-pixel pow/exp)
          float ang=(sp.x+uTime*sp.z)*ring;
          float s=sin(ang), co=cos(ang);
          p = p*co + cross(c,p)*s + c*dot(c,p)*(1.0-co);          // Rodrigues rotation about axis c
        }
        return p;
      }
      void main(){
        vec3 q = swirl(vP);                                       // 8 vortices deform the sample direction
        // turbulent domain-warp on top of the swirls for fine curl
        vec3 w = vec3(fbm3(q*3.0 + uTime*0.02), fbm3(q*3.0 + 19.0), fbm3(q*3.0 + 41.0)) - 0.5;
        float clouds = fbm(q*8.5 + w*2.4);                        // main cloud structure (higher frequency)
        float detail = fbm3(q*22.0 + w*3.2);                      // finer high-freq detail
        clouds = clamp(clouds*0.7 + detail*0.3, 0.0, 1.0);
        clouds = clamp((clouds - 0.5) * 1.5 + 0.5, 0.0, 1.0);     // more contrast
        // 3-tone: deep cyan shadow -> cyan -> white tops
        vec3 trough = vec3(0.08, 0.28, 0.44);
        vec3 deep   = vec3(0.20, 0.56, 0.72);
        vec3 pale   = vec3(0.95, 0.99, 1.0);
        vec3 base = mix(trough, deep, smoothstep(0.12, 0.42, clouds));
        base = mix(base, pale, smoothstep(0.46, 0.86, clouds));
        float ndl = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
        float light = uAmbient + (1.0 - uAmbient) * ndl;
        gl_FragColor = vec4(base * light * uExposure, 1.0);
      }`,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), mat); // more segments (it fills the sky)
  planet.renderOrder = -3;

  // cyan-white atmosphere limb (same fresnel idea as Jupiter) — a THIN but DENSE rim (shell only ~1% out,
  // strength way up) so it reads as a substantial atmosphere hugging the planet, not a wide soft haze.
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xbfeaff) }, uSunDir: { value: new THREE.Vector3(-55, 30, -30).normalize() }, uPower: { value: 2.2 }, uStrength: { value: 2.4 } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vWorld; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform vec3 uSunDir; uniform float uPower, uStrength; varying vec3 vN; varying vec3 vWorld;
      void main(){ vec3 V=normalize(cameraPosition-vWorld); float f=pow(1.0-max(dot(normalize(vN),V),0.0),uPower);
        float lit=smoothstep(-0.3,0.5,dot(normalize(vN),normalize(uSunDir))); float a=f*uStrength*mix(0.3,1.0,lit); gl_FragColor=vec4(uColor*a,a); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.011, 128, 96), atmoMat); // ~10% of the old shell depth -> a thin rim
  atmo.renderOrder = -2;

  group.add(planet, atmo);
  return { group, mat, planet, atmoMat, radius: R };
}

// --- Big grey ringed gas giant (Saturn-like) ---------------------------------
// A grey banded gas-giant body + a tilted RING built with the stars-clone technique: a flat RingGeometry
// with radial UVs sampling a 1D ring-density strip (public/saturn-rings.png), a DoubleSide shader that
// sun-front-lights the rings, warm-transmits through their thin parts on the back face, casts the PLANET'S
// own shadow across them (ray-sphere), and softens the inner/outer edges. Plus a faint grey fresnel limb.
export function createRingedPlanet(renderer, sunDir) {
  const group = new THREE.Group();
  group.visible = false;
  const R = 650; // big — a prominent ringed world on the far side of the sky
  const SUN = (sunDir ? sunDir.clone() : new THREE.Vector3(-55, 30, -30)).normalize();

  // grey banded body (subtle Saturn-like zonal banding, a faint sandy-grey tint), custom-lit like the others
  const planetMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSunDir: { value: SUN.clone() }, uExposure: { value: 0.95 }, uAmbient: { value: 0.05 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec3 vN; varying vec3 vP; uniform float uTime, uExposure, uAmbient; uniform vec3 uSunDir;
      float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.04; a*=0.5; } return v; }
      void main(){
        vec3 q = vP; float lat = q.y;
        float warp = fbm(q*3.0 + uTime*0.01) - 0.5;
        float bands = 0.5 + 0.5*sin(lat*20.0 + warp*5.0);     // soft zonal banding
        float mott = fbm(q*7.0 + warp*1.5);
        vec3 darkB = vec3(0.34,0.33,0.31), lightZ = vec3(0.66,0.64,0.59); // greys, faint warm tint
        vec3 base = mix(darkB, lightZ, clamp(bands*0.7 + mott*0.35, 0.0, 1.0));
        base *= 0.9 + 0.2*fbm(q*16.0);                         // fine mottle
        float ndl = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
        gl_FragColor = vec4(base * (uAmbient + (1.0-uAmbient)*ndl) * uExposure, 1.0);
      }`,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), planetMat);
  planet.renderOrder = -3;

  // faint grey fresnel limb
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xb8b4ac) }, uSunDir: { value: SUN.clone() }, uPower: { value: 3.2 }, uStrength: { value: 0.7 } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vWorld; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform vec3 uSunDir; uniform float uPower, uStrength; varying vec3 vN; varying vec3 vWorld;
      void main(){ vec3 V=normalize(cameraPosition-vWorld); float f=pow(1.0-max(dot(normalize(vN),V),0.0),uPower);
        float lit=smoothstep(-0.3,0.5,dot(normalize(vN),normalize(uSunDir))); float a=f*uStrength*mix(0.25,1.0,lit); gl_FragColor=vec4(uColor*a,a); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.03, 96, 64), atmoMat);
  atmo.renderOrder = -2;
  group.add(planet, atmo);

  // --- ring (RingGeometry + radial UV strip + lit/shadowed shader) ---
  const RING_IN = R * 1.18, RING_OUT = R * 2.30;
  const ringGeo = new THREE.RingGeometry(RING_IN, RING_OUT, 256, 1);
  { // radial UV: u = (r-in)/(out-in) so the 1D strip texture spans the ring width
    const uv = ringGeo.attributes.uv, pos = ringGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); uv.setXY(i, (Math.sqrt(x*x+y*y) - RING_IN) / (RING_OUT - RING_IN), 0.5); }
    uv.needsUpdate = true;
  }
  const ringMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null }, uHasTex: { value: 0 }, uColor: { value: new THREE.Color(0.80, 0.77, 0.72) }, uOpacity: { value: 0.62 },
      uSunDir: { value: SUN.clone() }, uPlanetR: { value: R }, uPlanetCenter: { value: new THREE.Vector3() }, uTint: { value: new THREE.Color(0.95, 0.88, 0.74) },
    },
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vWorldPos; varying vec3 vWorldN;
      void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.0); vWorldPos=wp.xyz; vWorldN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; varying vec3 vWorldPos; varying vec3 vWorldN;
      uniform sampler2D uTex; uniform float uHasTex, uOpacity, uPlanetR; uniform vec3 uColor, uSunDir, uPlanetCenter, uTint;
      void main(){
        vec4 tex = uHasTex > 0.5 ? texture2D(uTex, vUv) : vec4(1.0);
        vec3 baseCol = uColor * (uHasTex > 0.5 ? tex.rgb : vec3(1.0));
        float dens = uHasTex > 0.5 ? tex.a : 1.0;            // strip alpha = ring density (gaps -> low)
        float edge = pow(1.0 - abs(2.0*vUv.x - 1.0), 1.0/32.0); // soft inner/outer fade
        vec3 N = normalize(vWorldN); if (!gl_FrontFacing) N = -N;
        vec3 L = normalize(uSunDir); float ndl = dot(N, L);
        vec3 frontLit = step(0.0, ndl) * baseCol;             // sun-facing face: flat lit ring colour
        vec3 backLit = clamp(-ndl,0.0,1.0) * uTint * (1.0-baseCol) * pow(1.0-dens, 0.6) * edge; // warm transmission
        vec3 lit = frontLit + backLit;
        // planet's shadow across the rings: ray from the ring point toward the sun hits the planet sphere?
        vec3 ro = vWorldPos - uPlanetCenter; float b = dot(ro, L); float c = dot(ro,ro) - uPlanetR*uPlanetR; float disc = b*b - c;
        float inShadow = (b < 0.0) ? smoothstep(0.0, uPlanetR*uPlanetR*0.06, disc) : 0.0; // soft penumbra
        lit *= mix(1.0, 0.12, inShadow);
        lit += baseCol * 0.05;                                // ambient floor so the shadow side isn't pure black
        gl_FragColor = vec4(lit, dens * uOpacity * edge);
      }`,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2 + 0.42; // lay the disc flat, then tilt for a nice ring angle
  ring.rotation.z = 0.16;
  ring.renderOrder = -2;
  group.add(ring);

  // 1D ring-density strip from stars-clone (copied to public/); missing -> solid grey ring (uColor)
  new THREE.TextureLoader().load('/saturn-rings.png', (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    if (renderer) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    ringMat.uniforms.uTex.value = t; ringMat.uniforms.uHasTex.value = 1;
  }, undefined, () => {});

  function update(dt) {
    planetMat.uniforms.uTime.value += dt;
    planet.rotation.y += 0.006 * dt;
    ringMat.uniforms.uPlanetCenter.value.copy(group.position); // group is re-centred on the camera each frame
  }

  return { group, planet, planetMat, atmoMat, ring, ringMat, radius: R, update };
}

// --- Ixion: an inhabited, Earth-like world (procedural) -----------------------
// Oceans + continents + ice caps + drifting clouds + warm night-side city lights + a blue atmosphere
// limb. Day/night terminator from the sun direction (cities glow on the dark side). stars-clone style.
export function createHabitablePlanet() {
  const group = new THREE.Group();
  group.visible = false;
  const R = 900; // large -> fills a good chunk of the sky (positioned close, ~2500 out)
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(-55, 30, -30).normalize() },
      uExposure: { value: 0.95 },
      uAmbient: { value: 0.05 },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP; varying vec3 vW;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vN; varying vec3 vP; varying vec3 vW;
      uniform float uTime, uExposure, uAmbient; uniform vec3 uSunDir;
      float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<7;i++){ v+=a*noise(p); p=p*2.05+1.3; a*=0.5; } return v; }
      // domain-warped continent height field -> natural, ragged coastlines
      float height(vec3 p){
        vec3 w = vec3(fbm(p*1.6), fbm(p*1.6+9.2), fbm(p*1.6+21.7));
        return fbm(p*2.4 + w*0.85);
      }
      void main(){
        vec3 p = vP;
        float h = height(p);
        float sea = 0.50;
        float coast = fwidth(h) + 0.004;
        float land = smoothstep(sea - coast, sea + coast, h);   // crisp, anti-aliased coastline
        float elev = clamp((h - sea) / (1.0 - sea), 0.0, 1.0);   // 0 shore -> 1 peak
        float lat = abs(p.y);

        // ocean: depth gradient + a little large-scale variation
        vec3 ocean = mix(vec3(0.05,0.28,0.45), vec3(0.005,0.04,0.14), smoothstep(sea, sea-0.30, h));
        // land biomes by aridity (noise), elevation + latitude
        float arid = fbm(p*4.3 + 31.0);
        vec3 forest = vec3(0.07,0.24,0.09), grass = vec3(0.28,0.39,0.15), desert = vec3(0.62,0.50,0.29), rock = vec3(0.40,0.36,0.31);
        vec3 low = mix(forest, mix(grass, desert, smoothstep(0.45,0.72,arid)), smoothstep(0.18,0.55,arid));
        low = mix(low, vec3(0.34,0.42,0.30), smoothstep(0.82,0.6, lat)); // greener mid-latitudes
        vec3 land3 = mix(low, rock, smoothstep(0.45,0.82,elev));
        land3 *= 0.82 + 0.34 * fbm(p*16.0);                      // fine terrain mottling (the "detail")
        float snow = clamp(smoothstep(0.80,0.92, lat) + smoothstep(0.74,0.97, elev), 0.0, 1.0);
        land3 = mix(land3, vec3(0.92,0.95,1.0), snow);
        vec3 surf = mix(ocean, land3, land);

        // lighting
        vec3 N = normalize(vN), L = normalize(uSunDir), V = normalize(cameraPosition - vW);
        float ndl = dot(N, L);
        float day = smoothstep(-0.06, 0.30, ndl);
        float diff = max(ndl, 0.0);
        // ocean sun-glint (specular highlight on water only)
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 160.0) * (1.0 - land) * day;
        vec3 col = surf * (uAmbient + (1.0 - uAmbient) * diff) + vec3(1.0,0.96,0.85) * spec * 2.2;

        // drifting clouds (two scales), lit by the sun + casting a soft darkening on what's below
        float cl = fbm(p*3.2 + vec3(uTime*0.012,0.0,uTime*0.005)) * 0.65 + fbm(p*7.5 - vec3(0.0,uTime*0.006,0.0)) * 0.35;
        float clouds = smoothstep(0.52, 0.80, cl);
        col *= 1.0 - 0.25 * clouds;                              // cloud shadow
        col = mix(col, vec3(1.0) * (uAmbient + (1.0 - uAmbient) * diff), clouds * 0.85);

        // night-side city lights (clustered on habitable land)
        float pop = smoothstep(0.58, 0.80, fbm(p*12.0));
        float cities = land * (1.0 - snow) * (1.0 - clouds) * pop * smoothstep(0.55, 0.82, noise(p*85.0));
        col += vec3(1.0, 0.72, 0.36) * cities * 2.4 * (1.0 - day);

        gl_FragColor = vec4(col * uExposure, 1.0);
      }`,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 80), mat);
  planet.renderOrder = -3;

  // blue atmosphere limb (Earth-like rim)
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x6fa8ff) }, uSunDir: { value: new THREE.Vector3(-55, 30, -30).normalize() }, uPower: { value: 2.8 }, uStrength: { value: 1.25 } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vWorld; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform vec3 uSunDir; uniform float uPower, uStrength; varying vec3 vN; varying vec3 vWorld;
      void main(){ vec3 V=normalize(cameraPosition-vWorld); float f=pow(1.0-max(dot(normalize(vN),V),0.0),uPower);
        float lit=smoothstep(-0.25,0.55,dot(normalize(vN),normalize(uSunDir))); float a=f*uStrength*mix(0.22,1.0,lit); gl_FragColor=vec4(uColor*a,a); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.045, 128, 80), atmoMat);
  atmo.renderOrder = -2;

  group.add(planet, atmo);
  return { group, mat, planet, atmoMat, radius: R };
}
