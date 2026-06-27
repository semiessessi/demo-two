import * as THREE from 'three';

// Per-environment background bodies that sit at "infinity" (re-centred on the camera each frame, like
// the nebula/sun). Currently: Jupiter (textured sphere + a soft fresnel atmosphere limb, adapted from
// the stars-clone gas-giant limb-glow technique) and a basic Cerberus black hole (event horizon +
// tilted accretion disk + photon ring). Lit by the scene's existing sun direction.

// --- Jupiter -----------------------------------------------------------------
export function createJupiter(renderer) {
  const group = new THREE.Group();
  group.visible = false;

  const loader = new THREE.TextureLoader();
  const tex = loader.load('/jupiter.png');
  tex.colorSpace = THREE.NoColorSpace; // raw ShaderMaterial decodes sRGB manually (pow 2.2) below
  if (renderer) tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const R = 520; // apparent size; placed ~3400 units out (in front of the stars) -> a big sky planet
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

  return { group, planet, planetMat, atmoMat, radius: R };
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
  const DISK_IN = 2.4 * Rs;
  const DISK_OUT = 6.5 * Rs;
  const SIZE = DISK_OUT * 3.0; // billboard half-extent — covers the disk + lensing halo

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCamPos: { value: new THREE.Vector3() },
      uCenter: { value: new THREE.Vector3() },
      uDiskN: { value: new THREE.Vector3(0.32, 0.92, 0.18).normalize() }, // tilted disk normal
      uRs: { value: Rs },
      uDiskIn: { value: DISK_IN / Rs }, // disk radii in Rs units (shader works in Rs units)
      uDiskOut: { value: DISK_OUT / Rs },
      uTime: { value: 0 },
      uSteps: { value: 150 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vWorld;
      uniform vec3 uCamPos, uCenter, uDiskN;
      uniform float uRs, uDiskIn, uDiskOut, uTime;
      uniform int uSteps;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }

      // disk emission at a hit point (in Rs units, disk-plane radius rr), with temperature + turbulence + doppler
      vec3 diskColor(vec3 hit, vec3 N, vec3 dir, float rr){
        // basis in the disk plane
        vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0) + N.zxy * 0.001));
        vec3 Bv = cross(N, T);
        float ang = atan(dot(hit, Bv), dot(hit, T));
        float t = clamp((rr - uDiskIn) / (uDiskOut - uDiskIn), 0.0, 1.0); // 0 inner -> 1 outer
        // swirling turbulence (spirals: angle shifts with radius + time)
        float spin = uTime * 1.6 / (rr * 0.5 + 1.0);
        float turb = fbm(vec2(ang * 2.5 + rr * 1.4 - spin, rr * 0.9));
        // temperature ramp: blue-white (inner) -> orange -> deep red (outer)
        vec3 hot = vec3(0.75, 0.85, 1.0);
        vec3 mid = vec3(1.0, 0.6, 0.25);
        vec3 cool = vec3(0.5, 0.08, 0.02);
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
        // photon ring: rays that grazed the photon sphere (~1.5 Rs) without falling in
        if (!captured){
          float ring = exp(-pow((minr - 1.5) * 6.0, 2.0));
          acc += vec3(1.0, 0.92, 0.78) * ring * 0.9;
          alpha = max(alpha, ring * 0.9);
        }
        if (captured) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; } // shadow occludes the background
        if (alpha < 0.003) discard;                  // empty -> let the real scene show through
        gl_FragColor = vec4(acc, clamp(alpha, 0.0, 1.0));
      }`,
  });

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 2.0, SIZE * 2.0), mat);
  plane.renderOrder = -2;
  group.add(plane);
  return { group, mat, plane, radius: DISK_OUT };
}

// --- Tartarus cloud planet (procedural white/cyan swirling clouds) ------------
export function createCloudPlanet() {
  const group = new THREE.Group();
  group.visible = false;
  const R = 480;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(-55, 30, -30).normalize() },
      uExposure: { value: 0.85 },
      uAmbient: { value: 0.07 },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vN; varying vec3 vP;
      uniform float uTime, uExposure, uAmbient; uniform vec3 uSunDir;
      float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.04; a*=0.5; } return v; }
      void main(){
        vec3 q = vP;
        // banded latitude swirl: rotate sampling by latitude + time (zonal flow), then domain-warp for cloud curls
        float lat = q.y;
        float ang = uTime * 0.04 * (0.6 + 0.8 * (1.0 - abs(lat)));
        float ca = cos(ang), sa = sin(ang);
        vec3 r = vec3(ca*q.x - sa*q.z, q.y, sa*q.x + ca*q.z);
        float warp = fbm(r * 3.0 + uTime * 0.02);
        float clouds = fbm(r * 5.0 + vec3(warp * 1.6) + vec3(0.0, lat * 4.0, 0.0));
        float bands = 0.5 + 0.5 * sin(lat * 16.0 + warp * 3.0); // faint zonal banding
        clouds = clamp(clouds * 0.8 + bands * 0.2, 0.0, 1.0);
        vec3 deep = vec3(0.20, 0.55, 0.7);   // cyan
        vec3 pale = vec3(0.92, 0.98, 1.0);   // white
        vec3 base = mix(deep, pale, smoothstep(0.35, 0.85, clouds));
        float ndl = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
        float light = uAmbient + (1.0 - uAmbient) * ndl;
        gl_FragColor = vec4(base * light * uExposure, 1.0);
      }`,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), mat);
  planet.renderOrder = -3;

  // cyan-white atmosphere limb (same fresnel idea as Jupiter)
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xbfeaff) }, uSunDir: { value: new THREE.Vector3(-55, 30, -30).normalize() }, uPower: { value: 3.0 }, uStrength: { value: 1.2 } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vWorld; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform vec3 uSunDir; uniform float uPower, uStrength; varying vec3 vN; varying vec3 vWorld;
      void main(){ vec3 V=normalize(cameraPosition-vWorld); float f=pow(1.0-max(dot(normalize(vN),V),0.0),uPower);
        float lit=smoothstep(-0.3,0.5,dot(normalize(vN),normalize(uSunDir))); float a=f*uStrength*mix(0.3,1.0,lit); gl_FragColor=vec4(uColor*a,a); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 96, 64), atmoMat);
  atmo.renderOrder = -2;

  group.add(planet, atmo);
  return { group, mat, planet, atmoMat, radius: R };
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
      varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vN; varying vec3 vP;
      uniform float uTime, uExposure, uAmbient; uniform vec3 uSunDir;
      float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<6;i++){ v+=a*noise(p); p*=2.04; a*=0.5; } return v; }
      void main(){
        vec3 p = vP;
        float cont = fbm(p * 2.1);
        float land = smoothstep(0.46, 0.54, cont);           // 0 ocean -> 1 land
        float elev = fbm(p * 4.6 + 1.3);
        float lat = abs(p.y);
        vec3 ocean = mix(vec3(0.015, 0.07, 0.22), vec3(0.04, 0.22, 0.40), fbm(p * 6.0)); // deep -> shallow
        vec3 veg = mix(vec3(0.10, 0.30, 0.11), vec3(0.45, 0.40, 0.22), smoothstep(0.40, 0.70, elev)); // green -> arid
        vec3 land3 = mix(veg, vec3(0.52, 0.47, 0.40), smoothstep(0.72, 0.95, elev)); // bare mountains
        float ice = smoothstep(0.74, 0.86, lat + cont * 0.08);
        vec3 surf = mix(ocean, land3, land);
        surf = mix(surf, vec3(0.92, 0.96, 1.0), ice);
        // drifting clouds
        float cl = fbm(p * 3.4 + vec3(uTime * 0.012, 0.0, uTime * 0.004));
        float clouds = smoothstep(0.55, 0.82, cl);
        surf = mix(surf, vec3(1.0), clouds * 0.65);
        // lighting + night side
        float ndl = dot(normalize(vN), normalize(uSunDir));
        float day = smoothstep(-0.08, 0.28, ndl);
        float lit = uAmbient + (1.0 - uAmbient) * max(ndl, 0.0);
        // warm city lights: on land (not ocean/ice/cloud), clustered, only on the night side
        float pop = smoothstep(0.62, 0.78, fbm(p * 14.0)); // habitation density
        float cities = land * (1.0 - ice) * (1.0 - clouds) * pop * smoothstep(0.6, 0.85, noise(p * 60.0));
        vec3 night = vec3(1.0, 0.72, 0.36) * cities * 2.2 * (1.0 - day);
        gl_FragColor = vec4(surf * lit * uExposure + night, 1.0);
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
