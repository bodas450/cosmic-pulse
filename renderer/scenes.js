// Every scene is a pure function of time: update(t, p) where t = seconds into the
// scene and p = 0..1 progress. No Math.random, no clocks — the same episode JSON
// always renders the same frames, so renders can be retried, split and parallelised.
import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (r) => {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};

const col = (c) => new THREE.Color(c);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.min(1, Math.max(0, k));
const seg = (p, a, b) => clamp01((p - a) / (b - a));

// ---------- shared GLSL ----------
const NOISE = /* glsl */ `
vec3 hash3(vec3 p){p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));return -1.0+2.0*fract(sin(p)*43758.5453123);}
float noise(vec3 p){vec3 i=floor(p);vec3 f=fract(p);vec3 u=f*f*(3.0-2.0*f);
return mix(mix(mix(dot(hash3(i),f),dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)),dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)),dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)),dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z);}
float fbm(vec3 p){float v=0.0;float a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.02;a*=0.5;}return v;}
`;

// Particle material: positions are computed on the GPU from uTime/uProgress,
// so 100k particles cost nothing on the CPU and stay deterministic.
function particles({ count, seed, attrs, vertex, size = 2, blending = THREE.AdditiveBlending }) {
  const r = rng(seed);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const a1 = new Float32Array(count * 4);
  const a2 = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) attrs(r, i, pos, a1, a2);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aA', new THREE.BufferAttribute(a1, 4));
  geo.setAttribute('aB', new THREE.BufferAttribute(a2, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uProgress: { value: 0 }, uSize: { value: size }, uPix: { value: 1 }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uProgress; uniform float uSize; uniform float uPix;
      attribute vec4 aA; attribute vec4 aB; varying vec3 vColor; varying float vAlpha;
      ${NOISE}
      ${vertex}
      void main(){
        vec3 p = position; vec3 c = vec3(1.0); float s = 1.0; float a = 1.0;
        shape(p, c, s, a);
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * s * uPix * (300.0 / max(-mv.z, 0.1));
        vColor = c; vAlpha = a;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; varying vec3 vColor; varying float vAlpha;
      void main(){ float d = length(gl_PointCoord - 0.5); if(d>0.5) discard;
        float k = pow(1.0 - d*2.0, 1.8); gl_FragColor = vec4(vColor * k, k * vAlpha * uOpacity); }`,
    transparent: true, depthWrite: false, blending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,255,255,0.6)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.15)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
let GLOW;
function glow(color, scale) {
  GLOW ??= glowTexture();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: col(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(scale);
  return s;
}

// Star surface: animated granulation, limb darkening, temperature colour.
function starSphere(color) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: col(color) }, uHeat: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uHeat; varying vec3 vN; varying vec3 vP; ${NOISE}
      void main(){ float n = fbm(normalize(vP)*4.0 + vec3(0.0, uTime*0.08, uTime*0.05));
        float n2 = fbm(normalize(vP)*14.0 - uTime*0.15);
        float limb = pow(max(dot(vN, vec3(0,0,1)),0.0), 0.45);
        vec3 c = uColor * (0.75 + 0.6*n + 0.25*n2) * uHeat;
        gl_FragColor = vec4(c * (0.35 + 0.85*limb), 1.0); }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), mat);
}

// Procedural planet: rocky or banded gas giant.
function planetSphere(kind, seed, colorA, colorB) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uA: { value: col(colorA) }, uB: { value: col(colorB) }, uSeed: { value: seed % 1000 }, uGas: { value: kind === 'gas' ? 1 : 0 }, uMolten: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uSeed; uniform float uGas; uniform float uMolten; varying vec3 vN; varying vec3 vP; ${NOISE}
      void main(){ vec3 p = normalize(vP);
        float rocky = fbm(p*3.0 + uSeed);
        float bands = sin(p.y*18.0 + fbm(p*3.0+uSeed+uTime*0.03)*4.0);
        float k = mix(smoothstep(-0.1,0.25,rocky), 0.5+0.5*bands, uGas);
        vec3 c = mix(uA, uB, k);
        vec3 lava = mix(vec3(0.15,0.02,0.0), vec3(1.0,0.45,0.05), smoothstep(0.0,0.4,fbm(p*6.0+uTime*0.2)));
        c = mix(c, lava, uMolten);
        float light = max(dot(vN, normalize(vec3(-1.0,0.4,0.6))), 0.0);
        gl_FragColor = vec4(c*(0.08+1.1*light) + lava*uMolten*0.6, 1.0); }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), mat);
}

// ---------- scene builders ----------
// Each returns { objects: Object3D[], update(t, p) }.
export const SCENES = {
  // Hot expanding universe cooling into matter.
  bigbang({ seed }) {
    const pts = particles({
      count: 60000, seed, size: 1.6,
      attrs(r, i, pos, a) {
        const d = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize();
        const sp = Math.pow(r(), 0.5);
        pos.set([d.x, d.y, d.z], i * 3);
        a.set([sp, r(), r(), r()], i * 4);
      },
      vertex: `void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){
        float e = pow(uProgress, 0.6);
        float r = aA.x * (0.5 + 140.0 * e);
        vec3 q = p * r;
        q += vec3(fbm(p*3.0+aA.y), fbm(p*3.0+aA.z), fbm(p*3.0+aA.w)) * r * 0.6 * e;
        p = q;
        vec3 hot = vec3(1.0, 0.95, 0.85); vec3 cool = mix(vec3(0.35,0.5,1.0), vec3(1.0,0.55,0.3), aA.y);
        c = mix(hot*2.0, cool, smoothstep(0.0, 0.6, uProgress));
        s = mix(3.0, 1.0, uProgress); a = mix(1.0, 0.8, uProgress);
      }`,
    });
    const flash = glow('#fff6e0', 30);
    return {
      objects: [pts, flash],
      update(t, p) {
        pts.material.uniforms.uTime.value = t;
        pts.material.uniforms.uProgress.value = p;
        flash.scale.setScalar(lerp(10, 220, smooth(seg(p, 0, 0.4))));
        flash.material.opacity = 1 - seg(p, 0.05, 0.5);
        pts.rotation.y = t * 0.03;
      },
    };
  },

  // Cold molecular cloud; optional collapse = 0..1 pulls it into clumps.
  nebula({ seed, palette = ['#ff4f8b', '#4f7dff', '#ffb04f'], collapse = 0 }) {
    const blobs = [];
    const r0 = rng(seed + 7);
    for (let b = 0; b < 9; b++) blobs.push([gauss(r0) * 30, gauss(r0) * 14, gauss(r0) * 30, 8 + r0() * 18]);
    const cols = palette.map(col);
    const pts = particles({
      count: 90000, seed, size: 2.4,
      attrs(r, i, pos, a, b) {
        const bl = blobs[Math.floor(r() * blobs.length)];
        pos.set([bl[0] + gauss(r) * bl[3], bl[1] + gauss(r) * bl[3] * 0.6, bl[2] + gauss(r) * bl[3]], i * 3);
        const c = cols[Math.floor(r() * cols.length)];
        a.set([c.r, c.g, c.b, r()], i * 4);
        b.set([r(), r(), r(), r()], i * 4);
      },
      vertex: `uniform float uCollapse; void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){
        vec3 w = vec3(fbm(p*0.03+uTime*0.02), fbm(p*0.03+7.0+uTime*0.02), fbm(p*0.03+13.0)) * 18.0;
        p += w;
        float k = uCollapse * uProgress;
        vec3 core = vec3(floor(aB.x*4.0)*10.0-15.0, (aB.y-0.5)*6.0, floor(aB.z*3.0)*12.0-12.0) * (1.0-k);
        p = mix(p, core + (p-core)*0.12, smoothstep(0.0,1.0,k));
        c = aA.rgb * (0.35 + 0.65*aA.w) * (1.0 + k*1.5); s = 0.6 + aB.w*1.6; a = 0.35;
      }`,
    });
    pts.material.uniforms.uCollapse = { value: collapse };
    const dust = particles({
      count: 20000, seed: seed + 1, size: 3, blending: THREE.NormalBlending,
      attrs(r, i, pos) { const bl = blobs[Math.floor(r() * blobs.length)]; pos.set([bl[0] + gauss(r) * bl[3] * 0.7, bl[1] + gauss(r) * 4, bl[2] + gauss(r) * bl[3] * 0.7], i * 3); },
      vertex: `void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){ c = vec3(0.02,0.01,0.02); s = 2.0; a = 0.5; }`,
    });
    const sparks = [];
    if (collapse > 0) for (let i = 0; i < 6; i++) { const g = glow('#bfe3ff', 0); sparks.push(g); }
    return {
      objects: [pts, dust, ...sparks],
      update(t, p) {
        for (const m of [pts, dust]) { m.material.uniforms.uTime.value = t; m.material.uniforms.uProgress.value = p; m.rotation.y = t * 0.02; }
        sparks.forEach((g, i) => {
          const k = smooth(seg(p * collapse, 0.5 + i * 0.06, 0.9));
          g.position.set((i % 4) * 10 - 15, 0, Math.floor(i / 4) * 12 - 12).multiplyScalar(1 - collapse * p).applyAxisAngle(new THREE.Vector3(0, 1, 0), t * 0.02);
          g.scale.setScalar(k * 14);
        });
      },
    };
  },

  // Gas spiralling into a newborn star, flattening into a disk with jets.
  protostar({ seed, color = '#ffd27a' }) {
    const pts = particles({
      count: 70000, seed, size: 1.8,
      attrs(r, i, pos, a) {
        const rad = 4 + Math.pow(r(), 0.7) * 60;
        const th = r() * Math.PI * 2;
        pos.set([rad, (r() - 0.5) * 2, th], i * 3);
        a.set([r(), r(), r(), r()], i * 4);
      },
      vertex: `void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){
        float rad = p.x; float h = p.y; float th = p.z;
        float r = mix(rad, 3.0 + rad*0.45, smoothstep(0.0,1.0,uProgress));
        float ang = th + uTime * 6.0 / pow(r, 1.2);
        float thick = mix(rad*0.6, 0.6 + r*0.06, smoothstep(0.0,0.8,uProgress));
        p = vec3(cos(ang)*r, h*thick + fbm(vec3(ang, r*0.1, uTime*0.1))*2.0, sin(ang)*r);
        float heat = 1.0 - smoothstep(3.0, 40.0, r);
        c = mix(vec3(0.6,0.25,0.15), vec3(1.0,0.8,0.5), heat) * (0.6+0.8*aA.x); s = 0.7+aA.y; a = 0.45;
      }`,
    });
    const jets = particles({
      count: 8000, seed: seed + 3, size: 1.6,
      attrs(r, i, pos, a) { pos.set([gauss(r) * 0.4, r() < 0.5 ? -1 : 1, gauss(r) * 0.4], i * 3); a.set([r(), r(), r(), r()], i * 4); },
      vertex: `void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){
        float L = fract(aA.x + uTime*0.25) * 45.0 * smoothstep(0.4,0.8,uProgress);
        p = vec3(p.x*(1.0+L*0.12), p.y*L, p.z*(1.0+L*0.12));
        c = vec3(0.55,0.75,1.0); a = 0.6*(1.0 - fract(aA.x + uTime*0.25)); s = 1.2;
      }`,
    });
    const core = glow(color, 1);
    return {
      objects: [pts, jets, core],
      update(t, p) {
        for (const m of [pts, jets]) { m.material.uniforms.uTime.value = t; m.material.uniforms.uProgress.value = p; }
        core.scale.setScalar(lerp(2, 22, smooth(p)));
      },
    };
  },

  // Main-sequence star (also used for Sun-like stars, blue giants etc.).
  star({ seed, color = '#ffcc66', radius = 6, growTo, colorTo, flares = true }) {
    const sphere = starSphere(color);
    const halo = glow(color, radius * 6);
    const corona = glow(color, radius * 14);
    corona.material.opacity = 0.35;
    const prom = flares ? particles({
      count: 20000, seed, size: 1.2,
      attrs(r, i, pos, a) { const d = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize(); pos.set([d.x, d.y, d.z], i * 3); a.set([r(), r(), r(), r()], i * 4); },
      vertex: `uniform float uR; uniform vec3 uC; void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){
        float life = fract(aA.x + uTime*0.15*(0.5+aA.y));
        float lift = 1.0 + life * 0.35 * smoothstep(0.55, 0.9, fbm(p*3.0));
        p *= uR * lift; c = uC*1.4; a = (1.0-life)*0.5*smoothstep(0.55,0.9,fbm(p/uR*3.0)); s = 1.0;
      }`,
    }) : null;
    if (prom) Object.assign(prom.material.uniforms, { uR: { value: radius }, uC: { value: col(color) } });
    const c0 = col(color); const c1 = col(colorTo ?? color);
    return {
      objects: [sphere, halo, corona, ...(prom ? [prom] : [])],
      update(t, p) {
        const k = smooth(p);
        const R = growTo ? lerp(radius, growTo, k) : radius;
        const c = c0.clone().lerp(c1, k);
        sphere.scale.setScalar(R);
        sphere.material.uniforms.uTime.value = t;
        sphere.material.uniforms.uColor.value.copy(c);
        sphere.rotation.y = t * 0.05;
        halo.scale.setScalar(R * 5); halo.material.color.copy(c);
        corona.scale.setScalar(R * 12); corona.material.color.copy(c);
        if (prom) { prom.material.uniforms.uTime.value = t; prom.material.uniforms.uR.value = R; prom.material.uniforms.uC.value.copy(c); }
      },
    };
  },

  // Protoplanetary disk where dust clumps into planets.
  planetformation({ seed, color = '#ffd27a', planets = 5 }) {
    const r0 = rng(seed + 11);
    const orbits = Array.from({ length: planets }, (_, i) => ({ R: 12 + i * 9 + r0() * 3, phase: r0() * 6.28, size: 0.6 + r0() * (i > 2 ? 2.2 : 1.0), gas: i > 2 }));
    const pts = particles({
      count: 90000, seed, size: 1.4,
      attrs(r, i, pos, a) {
        const o = r() < 0.55 ? orbits[Math.floor(r() * orbits.length)] : null;
        const R = o ? o.R + gauss(r) * 2.5 : 6 + r() * 60;
        pos.set([R, gauss(r) * 0.5, r() * Math.PI * 2], i * 3);
        a.set([o ? o.R : -1, o ? o.phase : 0, r(), r()], i * 4);
      },
      vertex: `void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){
        float R = p.x; float th = p.z;
        float w = 9.0 / pow(R, 1.5);
        float ang = th + uTime * w;
        if (aA.x > 0.0) {
          float pw = 9.0 / pow(aA.x, 1.5);
          float pang = aA.y + uTime * pw;
          float k = smoothstep(0.0, 1.0, uProgress) * (0.4 + 0.6*aA.w);
          float d = mod(ang - pang + 3.14159, 6.28318) - 3.14159;
          ang = pang + d * (1.0 - k);
          R = mix(R, aA.x, k);
        }
        p = vec3(cos(ang)*R, p.y*(1.0+R*0.05), sin(ang)*R);
        float heat = 1.0 - smoothstep(6.0, 35.0, R);
        c = mix(vec3(0.45,0.3,0.25), vec3(1.0,0.75,0.45), heat) * (0.5+aA.z);
        s = 0.6 + aA.z; a = mix(0.5, 0.25, uProgress*step(0.0,aA.x));
      }`,
    });
    const sun = starSphere(color); sun.scale.setScalar(3.5);
    const halo = glow(color, 22);
    const bodies = orbits.map((o, i) => {
      const m = planetSphere(o.gas ? 'gas' : 'rock', seed + i, o.gas ? '#c9a27a' : '#6b4a3a', o.gas ? '#f1dcb8' : '#a07a5a');
      m.userData = o; return m;
    });
    return {
      objects: [pts, sun, halo, ...bodies],
      update(t, p) {
        pts.material.uniforms.uTime.value = t; pts.material.uniforms.uProgress.value = p;
        sun.material.uniforms.uTime.value = t;
        bodies.forEach((b) => {
          const o = b.userData; const ang = o.phase + t * 9 / Math.pow(o.R, 1.5);
          b.position.set(Math.cos(ang) * o.R, 0, Math.sin(ang) * o.R);
          b.scale.setScalar(o.size * smooth(seg(p, 0.35, 1)));
          b.material.uniforms.uTime.value = t;
          b.material.uniforms.uMolten.value = o.gas ? 0 : 1 - seg(p, 0.6, 1);
          b.rotation.y = t * 0.3;
        });
      },
    };
  },

  // A single planet close-up (Earth-like, Mars-like, gas giant, molten young world).
  planet({ seed, kind = 'rock', colorA = '#1d4f8a', colorB = '#3f7a3a', molten = 0, ring = false }) {
    const m = planetSphere(kind, seed, colorA, colorB);
    m.scale.setScalar(8);
    const atm = glow(kind === 'gas' ? '#ffe2b0' : '#7fb6ff', 22);
    atm.material.opacity = 0.35;
    const objs = [m, atm];
    let rings = null;
    if (ring) {
      rings = particles({
        count: 40000, seed: seed + 5, size: 0.9,
        attrs(r, i, pos, a) { pos.set([11 + r() * 8 * (r() < 0.15 ? 0.3 : 1), gauss(r) * 0.05, r() * 6.283], i * 3); a.set([r(), r(), r(), r()], i * 4); },
        vertex: `void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){ float ang = p.z + uTime*0.6/pow(p.x/10.0,1.5); p = vec3(cos(ang)*p.x, p.y, sin(ang)*p.x); c = vec3(0.85,0.78,0.65)*(0.5+aA.x*0.7); s = 0.8; a = 0.6; }`,
      });
      rings.rotation.x = 0.35;
      objs.push(rings);
    }
    return {
      objects: objs,
      update(t, p) {
        m.material.uniforms.uTime.value = t;
        m.material.uniforms.uMolten.value = molten * (1 - p);
        m.rotation.y = t * 0.12;
        if (rings) rings.material.uniforms.uTime.value = t;
      },
    };
  },

  // Dying low-mass star: puffs off shells, leaves a white dwarf.
  planetarynebula({ seed, palette = ['#46e0c8', '#ff5a7a', '#6a8dff'] }) {
    const cols = palette.map(col);
    const shell = particles({
      count: 80000, seed, size: 1.8,
      attrs(r, i, pos, a) {
        const d = new THREE.Vector3(gauss(r), gauss(r) * 1.6, gauss(r)).normalize();
        pos.set([d.x, d.y, d.z], i * 3);
        const c = cols[Math.floor(r() * cols.length)];
        a.set([c.r, c.g, c.b, r()], i * 4);
      },
      vertex: `void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){
        float R = (4.0 + 34.0*smoothstep(0.0,1.0,uProgress)) * (0.85 + 0.3*fbm(p*2.5)) * (0.8+0.4*aA.w);
        p = p * R; c = aA.rgb * 1.2; s = 1.0 + aA.w; a = 0.35 * smoothstep(0.0, 0.15, uProgress);
      }`,
    });
    const wd = glow('#dfe8ff', 6);
    const core = starSphere('#e8eeff'); core.scale.setScalar(1);
    return {
      objects: [shell, wd, core],
      update(t, p) {
        shell.material.uniforms.uTime.value = t; shell.material.uniforms.uProgress.value = p;
        shell.rotation.y = t * 0.03;
        core.material.uniforms.uTime.value = t;
        core.scale.setScalar(lerp(5, 0.8, smooth(seg(p, 0, 0.5))));
        wd.scale.setScalar(lerp(30, 8, smooth(p)));
      },
    };
  },

  // Core collapse: flash, expanding debris, remnant.
  // flashAt: progress (0..1) at which the core collapses and the star explodes.
  // flashLen: how long (in progress units) the white flash takes to fade.
  supernova({ seed, remnant = 'neutron', flashAt = 0.1, flashLen = 0.35 }) {
    const debris = particles({
      count: 100000, seed, size: 1.6,
      attrs(r, i, pos, a) { const d = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize(); pos.set([d.x, d.y, d.z], i * 3); a.set([r(), r(), r(), r()], i * 4); },
      vertex: `uniform float uFlash; void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){
        float e = smoothstep(uFlash, 1.0, uProgress);
        float R = (0.5 + 70.0*pow(e,0.55)) * (0.7 + 0.6*fbm(p*3.0 + aA.x));
        p *= R;
        vec3 hot = vec3(1.0,0.95,0.8); vec3 cool = mix(vec3(1.0,0.35,0.15), vec3(0.3,0.55,1.0), step(0.5, aA.y));
        c = mix(hot*1.3, cool, smoothstep(uFlash, uFlash + 0.35, uProgress)); s = 1.0 + aA.z; a = 0.4 * mix(0.03, 1.0, smoothstep(0.0, 0.45, e)) * smoothstep(uFlash - 0.02, uFlash + 0.01, uProgress);
      }`,
    });
    const star = starSphere('#ff8040');
    const flash = glow('#ffffff', 1);
    const rem = glow(remnant === 'blackhole' ? '#000000' : '#a8c8ff', 3);
    debris.material.uniforms.uFlash = { value: flashAt };
    return {
      objects: [debris, star, flash, rem],
      update(t, p) {
        debris.material.uniforms.uTime.value = t; debris.material.uniforms.uProgress.value = p;
        star.material.uniforms.uTime.value = t;
        const F = flashAt;
        const pre = seg(p, 0, F);
        star.scale.setScalar(p < F ? lerp(10, 2, pre * pre) : 0.001);
        const f = seg(p, F - 0.01, F + 0.01) * Math.pow(1 - seg(p, F + 0.01, F + flashLen), 2);
        flash.scale.setScalar(f * 260 + 0.01);
        rem.scale.setScalar(seg(p, F + 0.2, F + 0.5) * 5 + 0.01);
        debris.rotation.y = t * 0.02;
      },
    };
  },

  // Black hole with Keplerian accretion disk and photon ring.
  blackhole({ seed, color = '#ff9a3c' }) {
    const disk = particles({
      count: 90000, seed, size: 1.3,
      attrs(r, i, pos, a) { const R = 6 + Math.pow(r(), 1.8) * 40; pos.set([R, gauss(r) * 0.25, r() * 6.283], i * 3); a.set([r(), r(), r(), r()], i * 4); },
      vertex: `uniform vec3 uC; void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){
        float R = p.x; float ang = p.z + uTime * 20.0 / pow(R, 1.5);
        p = vec3(cos(ang)*R, p.y*(1.0+R*0.05), sin(ang)*R);
        float heat = 1.0 - smoothstep(6.0, 40.0, R);
        float dop = 1.0 + 0.6*cos(ang);
        c = mix(uC*0.5, vec3(1.0,0.95,0.85), heat) * dop * (0.6 + 0.8*fbm(vec3(R*0.3, ang*2.0, uTime*0.3)));
        s = 0.7 + aA.x; a = 0.6;
      }`,
    });
    disk.material.uniforms.uC = { value: col(color) };
    disk.rotation.x = 0.18;
    const hole = new THREE.Mesh(new THREE.SphereGeometry(5, 64, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    const ringGlow = glow(color, 20); ringGlow.material.opacity = 0.7;
    const lensed = disk.clone(); lensed.material = disk.material.clone(); lensed.material.uniforms.uC = { value: col(color) };
    lensed.rotation.x = Math.PI / 2 - 0.1; lensed.scale.setScalar(0.42);
    return {
      objects: [ringGlow, disk, lensed, hole],
      update(t, p) {
        for (const m of [disk, lensed]) { m.material.uniforms.uTime.value = t; m.material.uniforms.uProgress.value = p; }
      },
    };
  },

  // Spiral galaxy; `form` 0..1 animates a clumpy disk settling into arms.
  galaxy({ seed, arms = 2, twist = 3.2, palette = ['#9ec1ff', '#ffd9a8', '#ff8fb1'], form = 0 }) {
    const cols = palette.map(col);
    const pts = particles({
      count: 140000, seed, size: 1.2,
      attrs(r, i, pos, a) {
        const R = Math.pow(r(), 1.6) * 70 + 1;
        const arm = Math.floor(r() * arms) * (Math.PI * 2 / arms);
        const spread = gauss(r) * (0.25 + 8 / (R + 4));
        pos.set([R, gauss(r) * (1.5 + 8 / (R + 2)) * 0.6, arm + spread], i * 3);
        const c = R < 12 ? col('#ffe7c2') : cols[Math.floor(r() * cols.length)];
        a.set([c.r, c.g, c.b, r()], i * 4);
      },
      vertex: `uniform float uTwist; uniform float uForm; void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){
        float R = p.x;
        float spiral = p.z + log(R) * uTwist;
        float chaos = p.z * 3.0 + aA.w * 12.0;
        float f = mix(1.0, smoothstep(0.0,1.0,uProgress), uForm);
        float ang = mix(chaos, spiral, f) + uTime * 0.9 / sqrt(R + 2.0);
        p = vec3(cos(ang)*R, p.y * mix(4.0, 1.0, f), sin(ang)*R);
        c = aA.rgb * (0.5 + aA.w); s = 0.6 + aA.w * 1.5; a = 0.55;
      }`,
    });
    pts.material.uniforms.uTwist = { value: twist };
    pts.material.uniforms.uForm = { value: form };
    const bulge = glow('#ffe1b0', 40);
    return {
      objects: [pts, bulge],
      update(t, p) { pts.material.uniforms.uTime.value = t; pts.material.uniforms.uProgress.value = p; pts.rotation.x = 0; },
    };
  },
};

// Always-on background so every frame has depth.
export function starfield(seed) {
  return particles({
    count: 9000, seed, size: 1.1,
    attrs(r, i, pos, a) { const d = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize().multiplyScalar(600 + r() * 300); pos.set([d.x, d.y, d.z], i * 3); a.set([r(), r(), r(), r()], i * 4); },
    vertex: `void shape(inout vec3 p, inout vec3 c, inout float s, inout float a){ c = mix(vec3(0.7,0.8,1.0), vec3(1.0,0.85,0.7), aA.x); s = 0.4 + aA.y*aA.y*2.5; a = 0.5 + 0.5*sin(uTime*(0.5+aA.z*2.0) + aA.w*30.0); }`,
  });
}
