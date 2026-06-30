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
  const DAY = 130; // in-game seconds per EARTH day -> Io ~3.8 min/orbit, Ganymede ~15.5 min (real 1:4 ratio)
  const PLANET_SPIN = (2 * Math.PI) / ((9.925 / 24) * DAY); // Jupiter's real ~9h55m rotation, same time-compression (~54s/turn -> clearly visible in minutes)
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
    planet.rotateY(PLANET_SPIN * dt); // Jupiter's real ~9h55m spin (time-compressed with the moons)
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
export function createBlackHole(bhDir) {
  const group = new THREE.Group();
  group.visible = false;

  // Additive ~5% skybox (cerberus cube map) blended into the environment AND fed to the lensing shader so
  // the hole distorts it. Loaded lazily with the black hole — the only external-texture backdrop.
  const skyTex = new THREE.CubeTextureLoader().setPath('/skyboxes/').load(
    ['cerberus_right.png', 'cerberus_left.png', 'cerberus_up.png', 'cerberus_down.png', 'cerberus_front.png', 'cerberus_back.png'],
  );
  skyTex.colorSpace = THREE.SRGBColorSpace;
  // orient so the "right" (+X) cube face sits roughly BEHIND the hole: rotate a world dir so BH_DIR -> +X
  const _bh = (bhDir ? bhDir.clone() : new THREE.Vector3(0.40, 0.18, -0.90)).normalize();
  const skyRot = new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(_bh, new THREE.Vector3(1, 0, 0))),
  );
  const SKY_AMT = 0.05; // 5% additive
  // Flow map (RG = a 2D flow field per face): animates the skybox so the nebula drifts/swirls, and near the
  // hole it also drags the sample inward (accretion suck). Flow data is LINEAR, not colour.
  const flowTex = new THREE.CubeTextureLoader().setPath('/skyboxes/').load(
    ['cerberus_flow_right.png', 'cerberus_flow_left.png', 'cerberus_flow_up.png', 'cerberus_flow_down.png', 'cerberus_flow_front.png', 'cerberus_flow_back.png'],
  );
  flowTex.colorSpace = THREE.LinearSRGBColorSpace;
  const flowTimeU = { value: 0 }; // shared between the lensing shader + the base sky-sphere layer
  const FLOW_AMT = 0.06;

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
      uSpokeBright: { value: 0.6 }, // brightness of the blue/purple nebula behind the hole (dimmed — it glowed too much)
      uSkybox: { value: skyTex },
      uSkyboxRot: { value: skyRot },
      uSkyboxAmt: { value: SKY_AMT },
      uSkyFlow: { value: flowTex },
      uFlowTime: flowTimeU,
      uFlowAmt: { value: FLOW_AMT },
      uSuck: { value: 0.22 },
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
      uniform samplerCube uSkybox; uniform mat3 uSkyboxRot; uniform float uSkyboxAmt;
      uniform samplerCube uSkyFlow; uniform float uFlowTime, uFlowAmt, uSuck;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }

      // flow-map animated cube sample: the flow field perturbs the sample direction over time (two cross-faded
      // phases), and the suck term drags it toward the hole (holeLocal) -> the nebula drifts AND is pulled inward.
      vec3 flowCube(vec3 dir, float amt, vec3 holeLocal, float suck){
        vec2 fl = (textureCube(uSkyFlow, dir).rg * 2.0 - 1.0) * amt;
        vec3 up = abs(dir.y) < 0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
        vec3 tx = normalize(cross(up, dir)); vec3 bx = cross(dir, tx);
        vec3 off = tx*fl.x + bx*fl.y;
        vec3 inward = holeLocal - dir * dot(holeLocal, dir);  // tangential direction toward the hole
        if (dot(inward, inward) > 1e-6) off += normalize(inward) * suck;
        float p1 = fract(uFlowTime), p2 = fract(uFlowTime + 0.5);
        vec3 c1 = textureCube(uSkybox, normalize(dir + off*p1)).rgb;
        vec3 c2 = textureCube(uSkybox, normalize(dir + off*p2)).rgb;
        return mix(c1, c2, abs(2.0*p1 - 1.0));
      }

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
        vec3 up = abs(axis.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 ux = normalize(cross(axis, up));
        vec3 vx = cross(axis, ux);
        vec2 pp = vec2(dot(dir, ux), dot(dir, vx));             // CONTINUOUS tangential coords -> seamless everywhere
        // continuous nebula CLOUD (layered fbm) — organic, wispy, Milky-Way-ish. NO discrete cos-spokes: those
        // left thin spiral seam-lines between them. Everything samples pp, so there is no azimuth seam at all.
        float cloud = fbm(pp * 2.2 + 5.0) * 0.55 + fbm(pp * 5.5 + 21.0) * 0.3 + fbm(pp * 12.0 + 40.0) * 0.15;
        float body = smoothstep(0.28, 0.86, cloud);             // soft wispy filaments
        float radial = smoothstep(0.0, 0.05, ang) * (1.0 - smoothstep(0.52, 1.15, ang));
        radial *= 0.45 + 0.8 * fbm(pp * 1.4 + 2.0);             // large-scale clumping (seamless)
        return clamp(body * radial, 0.0, 1.0);
      }

      // disk emission at a hit point (in Rs units, disk-plane radius rr), with temperature + turbulence + doppler
      vec3 diskColor(vec3 hit, vec3 N, vec3 dir, float rr){
        // basis in the disk plane
        vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0) + N.zxy * 0.001));
        vec3 Bv = cross(N, T);
        float t = clamp((rr - uDiskIn) / (uDiskOut - uDiskIn), 0.0, 1.0); // 0 inner -> 1 outer
        // swirling turbulence from the CONTINUOUS in-plane position (NOT the atan2 azimuth, which tore a radial
        // seam across the disk): rotate the position by a radius-dependent spin -> differential spiral shear, seamless.
        float spin = uTime * 3.4 / (rr * 0.5 + 1.0); // inner rings whip round faster
        vec2 dp = vec2(dot(hit, T), dot(hit, Bv));
        float cs = cos(spin), sn = sin(spin);
        vec2 dpr = vec2(cs * dp.x - sn * dp.y, sn * dp.x + cs * dp.y);
        float turb = fbm(dpr * 0.9 + vec2(uTime * 0.05, 3.0));
        turb = mix(turb, fbm(dpr * 1.8 + 11.0), 0.4); // finer co-rotating filaments
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
        float neb = spokeNebula(d, axis); // sampled along the bent ray = lensed (over-bending it darkened a ring near the hole)
        // more PURPLE, with a violet<->magenta shimmer varying over the cloud (texture, Milky-Way-ish)
        vec3 nebCol = mix(vec3(0.30, 0.06, 0.62), vec3(0.55, 0.15, 0.80), fbm(vec2(d.x * 6.0 + 3.0, d.y * 6.0 - 2.0)));
        vec3 bg = nebCol * neb * uSpokeBright;                   // nebula
        bg += backgroundSky(d) * zone * (1.0 + 4.0 * smoothstep(0.05, 0.5, bend)); // lensed stars, brightened where the bend is strong -> visible distorted arcs (fills the dark ring)
        acc += bg * (1.0 - alpha);
        // the hole DISTORTS the additive skybox: sample the cube map along the LENSED ray and add the warped
        // extra where the ray is actually bent (the flat 5% everywhere is the sky-sphere layer below).
        vec3 skb = flowCube(uSkyboxRot * d, uFlowAmt, uSkyboxRot * axis, uSuck * zone); // flow + accretion suck (strongest near the hole)
        float skLens = uSkyboxAmt * (0.4 + 2.2 * smoothstep(0.05, 0.5, bend)) * zone;
        acc += skb * skLens * (1.0 - alpha);
        alpha = max(alpha, skLens * 0.6);
        alpha = max(alpha, max(neb * 0.85, smoothstep(0.06, 0.55, bend) * zone));
        // photon ring / lensed arcs — ANIMATED: bright spots orbit the ring + a gentle pulse, so it shimmers
        vec3 upr = abs(axis.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 uxr = normalize(cross(axis, upr)); vec3 vxr = cross(axis, uxr);
        float azr = atan(dot(d, vxr), dot(d, uxr));
        float ring = exp(-pow((minr - 1.5) * 6.0, 2.0));
        ring *= 0.5 + 0.6 * (0.5 + 0.5 * sin(azr * 3.0 - uTime * 2.0)) + 0.16 * sin(uTime * 1.3); // orbiting hot-spots + pulse
        ring = max(ring, 0.0);
        acc += vec3(1.0, 0.92, 0.78) * ring * 0.45; // ~half the glow
        alpha = max(alpha, ring * 0.9 * zone);
        // MANY strongly-LENSED star arcs hugging the hole — tangential bright streaks = the warping signature
        float arcs = 0.0;
        if (minr < 16.0) for (int k = 0; k < 9; k++) {
          float fk = float(k);
          float r0 = 1.6 + fk * 0.85;                                   // staggered impact-parameter radii (Rs)
          float az0 = fk * 1.4 + sin(uTime * 0.08 + fk * 2.1) * 0.7;    // azimuth, slowly drifting
          float da = azr - az0; da = atan(sin(da), cos(da));            // wrap-safe azimuthal offset
          float rg = exp(-pow((minr - r0) * 4.0, 2.0));                 // thin tangential ring at r0
          float ag = exp(-pow(da * 2.0, 2.0));                          // localized in azimuth -> an arc, not a full ring
          arcs += rg * ag;
        }
        acc += mix(vec3(0.92, 0.96, 1.0), nebCol * 2.0, 0.3) * arcs * 2.4 * zone; // bright bluish-white distorted STAR arcs
        alpha = max(alpha, clamp(arcs, 0.0, 1.0) * zone);
        if (alpha < 0.004) discard;                  // nothing here -> let the real scene show through
        gl_FragColor = vec4(acc, clamp(alpha, 0.0, 1.0));
      }`,
  });

  const plane = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 48, 32), mat); // sky-pass sphere (centred on the camera)
  plane.renderOrder = -2;
  plane.frustumCulled = false; // centred on the camera -> always in view, never cull
  group.add(plane);

  // Base additive skybox layer: 5% of the cube map everywhere in the sky (depth-tested so the foreground
  // occludes it). The black-hole pass above adds the LENSED version near the hole on top of this. The group
  // is re-centred on the camera each frame, so the sphere's object-space dir IS the world view dir.
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uSkybox: { value: skyTex }, uSkyboxRot: { value: skyRot }, uAmt: { value: SKY_AMT }, uSkyFlow: { value: flowTex }, uFlowTime: flowTimeU, uFlowAmt: { value: FLOW_AMT } },
    transparent: true, depthWrite: false, depthTest: true, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`precision highp float; uniform samplerCube uSkybox, uSkyFlow; uniform mat3 uSkyboxRot; uniform float uAmt, uFlowTime, uFlowAmt; varying vec3 vDir;
      vec3 flowCube(vec3 dir){
        vec2 fl = (textureCube(uSkyFlow, dir).rg * 2.0 - 1.0) * uFlowAmt;
        vec3 up = abs(dir.y) < 0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
        vec3 tx = normalize(cross(up, dir)); vec3 bx = cross(dir, tx);
        vec3 off = tx*fl.x + bx*fl.y;
        float p1 = fract(uFlowTime), p2 = fract(uFlowTime + 0.5);
        vec3 c1 = textureCube(uSkybox, normalize(dir + off*p1)).rgb;
        vec3 c2 = textureCube(uSkybox, normalize(dir + off*p2)).rgb;
        return mix(c1, c2, abs(2.0*p1 - 1.0));
      }
      void main(){ vec3 c = flowCube(uSkyboxRot * normalize(vDir)); gl_FragColor = vec4(c * uAmt, 1.0); }`,
  });
  const skySphere = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 24), skyMat);
  skySphere.renderOrder = -19; // additive base layer (order-independent); just after the nebula
  skySphere.frustumCulled = false;
  group.add(skySphere);

  return { group, mat, plane, skySphere, radius: DISK_OUT };
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
    const str = (0.07 + 0.15 * h) * (h > 0.5 ? 1 : -1); // very subtle local eddies (was 0.3-0.8 -> too smeary/oily)
    const tight = 3.0 + 5.0 * rng(i * 7.1 + 3.3);
    const spin = (0.02 + 0.08 * rng(i * 13.7 + 9.1)) * (rng(i * 3.3 + 5.5) > 0.5 ? 1 : -1);
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
        vec3 q = swirl(vP);                                       // gentle, localized eddies only (no global smear)
        // a TINY domain-warp for a touch of life — small, not the oily smear it was (w*2.4 -> w*0.35)
        vec3 w = vec3(fbm3(q*3.0 + uTime*0.02), fbm3(q*3.0 + 19.0), fbm3(q*3.0 + 41.0)) - 0.5;
        float clouds = fbm(q*8.5 + w*0.35);                       // mostly clean 3D noise
        float detail = fbm3(q*22.0 + w*0.5);                      // fine high-freq detail
        clouds = clamp(clouds*0.7 + detail*0.3, 0.0, 1.0);
        clouds = clamp((clouds - 0.5) * 1.4 + 0.5, 0.0, 1.0);     // crisp, not smeary
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
    uniforms: {
      uTime: { value: 0 }, uSunDir: { value: SUN.clone() }, uExposure: { value: 0.95 }, uAmbient: { value: 0.05 },
      uPlanetCenter: { value: new THREE.Vector3() }, uRingN: { value: new THREE.Vector3(0, 1, 0) },
      uRingIn: { value: R * 1.18 }, uRingOut: { value: R * 2.30 },
      uRingTex: { value: null }, uRingHasTex: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP; varying vec3 vWorldPos;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec3 vN; varying vec3 vP; varying vec3 vWorldPos;
      uniform float uTime, uExposure, uAmbient, uRingIn, uRingOut, uRingHasTex; uniform vec3 uSunDir, uPlanetCenter, uRingN; uniform sampler2D uRingTex;
      float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.04; a*=0.5; } return v; }
      void main(){
        vec3 q = vP; float lat = q.y;
        float warp = fbm(q*3.0 + uTime*0.01) - 0.5;
        float bands = 0.5 + 0.5*sin(lat*9.0 + warp*4.0);      // FEWER zonal bands
        float mott = fbm(q*7.0 + warp*1.5);
        vec3 darkB = vec3(0.45,0.44,0.42), lightZ = vec3(0.57,0.555,0.52); // LOWER-contrast greys
        vec3 base = mix(darkB, lightZ, clamp(bands*0.65 + mott*0.3, 0.0, 1.0));
        base *= 0.94 + 0.12*fbm(q*16.0);                       // fine mottle (gentler)
        float ndl = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
        // RINGS' shadow cast onto the planet: from this point march toward the sun; if the ray crosses the
        // ring plane within the (textured) annulus, darken it -> the iconic banded Saturn ring shadow.
        vec3 L = normalize(uSunDir);
        vec3 Pp = vWorldPos - uPlanetCenter;
        float denom = dot(L, uRingN);
        float ringSh = 0.0;
        if (abs(denom) > 1e-4) {
          float t = -dot(Pp, uRingN) / denom;                 // distance along L to the ring plane
          if (t > 0.0) {
            vec3 H = Pp + L * t;                               // crossing point, relative to the planet centre
            float rr = length(H - uRingN * dot(H, uRingN));   // its radius in the ring plane
            float inAnn = smoothstep(uRingIn*0.99, uRingIn*1.01, rr) * (1.0 - smoothstep(uRingOut*0.99, uRingOut*1.01, rr));
            float dens = uRingHasTex > 0.5 ? texture2D(uRingTex, vec2(clamp((rr-uRingIn)/(uRingOut-uRingIn), 0.0, 1.0), 0.5)).a : 1.0;
            ringSh = inAnn * dens;
          }
        }
        ndl *= mix(1.0, 0.08, ringSh);                        // ring shadow darkens the direct sun (gaps let light through)
        gl_FragColor = vec4(base * (uAmbient + (1.0-uAmbient)*ndl) * uExposure, 1.0);
      }`,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), planetMat);
  planet.renderOrder = -3;

  // faint grey fresnel limb
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xb8b4ac) }, uSunDir: { value: SUN.clone() }, uPower: { value: 3.2 }, uStrength: { value: 2.1 } }, // denser rim than the original 1.4, but ~50% of the too-bright 4.2
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vWorld; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform vec3 uSunDir; uniform float uPower, uStrength; varying vec3 vN; varying vec3 vWorld;
      void main(){ vec3 V=normalize(cameraPosition-vWorld); float f=pow(1.0-max(dot(normalize(vN),V),0.0),uPower);
        float lit=smoothstep(-0.3,0.5,dot(normalize(vN),normalize(uSunDir))); float a=f*uStrength*mix(0.25,1.0,lit); gl_FragColor=vec4(uColor*a,a); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.03, 96, 64), atmoMat);
  atmo.renderOrder = -2;
  // Axial-tilt frame: the planet BODY now shares the rings' tilt (was: rings tilted, body upright -> the
  // zonal bands didn't line up with the rings). Tilting the whole system also rakes the planet's shadow
  // across the ring face more pleasingly. group only carries the camera-follow position; tilt is internal.
  const tilt = new THREE.Group();
  tilt.rotation.x = 0.42; // axial tilt (matches the old ring angle, now applied to body + rings together)
  tilt.rotation.z = 0.16;
  group.add(tilt);
  tilt.add(planet, atmo);

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
  ring.rotation.x = -Math.PI / 2; // lay the disc flat in the tilted frame (tilt group provides the axial angle)
  ring.renderOrder = -2;
  tilt.add(ring);

  // 1D ring-density strip from stars-clone (copied to public/); missing -> solid grey ring (uColor)
  new THREE.TextureLoader().load('/saturn-rings.png', (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    if (renderer) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    ringMat.uniforms.uTex.value = t; ringMat.uniforms.uHasTex.value = 1;
    planetMat.uniforms.uRingTex.value = t; planetMat.uniforms.uRingHasTex.value = 1; // same strip drives the ring shadow's gaps
  }, undefined, () => {});

  const _rq = new THREE.Quaternion(), _rn = new THREE.Vector3();
  function update(dt) {
    planetMat.uniforms.uTime.value += dt;
    planet.rotation.y += 0.006 * dt;
    ringMat.uniforms.uPlanetCenter.value.copy(group.position); // group is re-centred on the camera each frame
    planetMat.uniforms.uPlanetCenter.value.copy(group.position);
    ring.getWorldQuaternion(_rq); _rn.set(0, 0, 1).applyQuaternion(_rq); // ring's world normal (RingGeometry normal = +Z)
    planetMat.uniforms.uRingN.value.copy(_rn);
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
