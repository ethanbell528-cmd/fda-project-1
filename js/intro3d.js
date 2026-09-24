/* Report-page intro: a dual-threat quarterback (generic #8, purple and black) takes the snap in a
   night-game stadium, drops back, and throws a spiral straight at the viewer as they scroll.
   Scroll progress through the tall #intro3d section scrubs the whole sequence. Everything is built
   in code (stadium, textures, crowd, helmet); the body is a CC0 rigged human base mesh
   (assets/male_base_mesh.glb) posed by a code-built IK driver. No real people, names or team marks.
   Decorative only: the report never depends on it. If WebGL or the three.js CDN fails, the
   section removes itself (see the inline fallback in index.html). Test hook: ?introP=0..1. */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const section = document.getElementById("intro3d");
const stage = section && section.querySelector(".intro-stage");
const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const forced = parseFloat(new URLSearchParams(location.search).get("introP")); // test hook

// ---------------------------------------------------------------- small helpers
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const PURPLE = 0x2a1b72, PURPLE_HEX = "#2a1b72", GOLD_HEX = "#c9a227";

function canvas(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  return c;
}
function colorTex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
// normal map from a procedurally drawn height field
function normalTex(size, drawHeight, strength, repeat) {
  const c = canvas(size, size, drawHeight);
  const g = c.getContext("2d");
  const src = g.getImageData(0, 0, size, size).data;
  const out = g.createImageData(size, size);
  const H = (x, y) => src[((((y % size) + size) % size) * size + (((x % size) + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    out.data[i] = (dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}
// lathe from [radius, y] pairs listed bottom -> top; phiStart = PI puts u = 0.5 at the front (+z)
function lathe(pts, seg = 24, phiStart = Math.PI, phiLength = Math.PI * 2, steps = 0) {
  let P = pts;
  if (steps) { // resample at even heights so texture v is proportional to height (numbers, stripes land where drawn)
    const y0 = pts[0][1], y1 = pts[pts.length - 1][1];
    P = [];
    for (let i = 0; i <= steps; i++) {
      const y = y0 + ((y1 - y0) * i) / steps;
      let k = 0;
      while (k < pts.length - 2 && pts[k + 1][1] < y) k++;
      const [ra, ya] = pts[k], [rb, yb] = pts[k + 1];
      const t = yb === ya ? 0 : (y - ya) / (yb - ya);
      P.push([lerp(ra, rb, clamp(t, 0, 1)), y]);
    }
  }
  return new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), seg, phiStart, phiLength);
}
function drawNumber(g, text, x, y, h, sx, fill, stroke) {
  g.save(); g.translate(x, y); g.scale(sx, 1);
  g.font = `900 ${h}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  if (stroke) { g.lineWidth = h * 0.07; g.strokeStyle = stroke; g.strokeText(text, 0, 0); }
  g.fillStyle = fill; g.fillText(text, 0, 0);
  g.restore();
}

// ---------------------------------------------------------------- textures
function makeTextures(num) {
  const jersey = colorTex(canvas(1024, 1024, (g, w, h) => {
    g.fillStyle = PURPLE_HEX; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, "rgba(255,255,255,0.05)"); grd.addColorStop(1, "rgba(0,0,0,0.18)");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = "#101014"; g.fillRect(0, 0, w, 34);                                               // collar
    g.fillRect(w * 0.23, 0, 26, h); g.fillRect(w * 0.77 - 26, 0, 26, h);                           // side panels
    for (const x of [w * 0.5, 0, w]) drawNumber(g, num, x, 318, 330, 0.72, "#ffffff", GOLD_HEX);  // front + back
  }));
  const sleeve = colorTex(canvas(256, 256, (g, w) => {
    g.fillStyle = PURPLE_HEX; g.fillRect(0, 0, w, w);
    g.fillStyle = "#ffffff"; g.fillRect(0, 196, w, 12); g.fillRect(0, 226, w, 12);
    g.fillStyle = GOLD_HEX; g.fillRect(0, 212, w, 10);
    for (const x of [w * 0.25, w * 0.75]) drawNumber(g, num, x, 100, 110, 0.55, "#ffffff", GOLD_HEX);
  }));
  const pants = colorTex(canvas(256, 512, (g, w, h) => {
    g.fillStyle = "#ececec"; g.fillRect(0, 0, w, h);
    for (const x of [w * 0.25, w * 0.75]) {
      g.fillStyle = PURPLE_HEX; g.fillRect(x - 13, 0, 8, h); g.fillRect(x + 5, 0, 8, h);
      g.fillStyle = GOLD_HEX; g.fillRect(x - 3, 0, 6, h);
    }
  }));
  const shin = colorTex(canvas(128, 256, (g, w, h) => {
    g.fillStyle = "#16121f"; g.fillRect(0, 0, w, h);   // sock
    g.fillStyle = "#ececec"; g.fillRect(0, 0, w, 50);  // pants hem
    g.fillStyle = "#0b0b0b"; g.fillRect(0, 50, w, 5);
    g.fillStyle = PURPLE_HEX; g.fillRect(0, 96, w, 10); g.fillRect(0, 114, w, 10);
  }));
  return { jersey, sleeve, pants, shin };
}

// ---------------------------------------------------------------- player
const ARM_A = 0.30, ARM_B = 0.27, LEG_A = 0.47, LEG_B = 0.46, ANKLE_H = 0.095;
function makePlayer({ num = "8", sleeveArm = "R", skin = 0x4a2e20 }) {
  const tx = makeTextures(num);
  const sheen = new THREE.Color(0x6a5cd6);
  const mJersey = new THREE.MeshPhysicalMaterial({ map: tx.jersey, roughness: 0.72, sheen: 0.6, sheenRoughness: 0.7, sheenColor: sheen });
  const mPads = new THREE.MeshPhysicalMaterial({ color: PURPLE, roughness: 0.7, sheen: 0.6, sheenRoughness: 0.7, sheenColor: sheen });
  const mSleeve = new THREE.MeshPhysicalMaterial({ map: tx.sleeve, roughness: 0.72, sheen: 0.5, sheenColor: sheen });
  const mPants = new THREE.MeshStandardMaterial({ map: tx.pants, roughness: 0.65, color: 0xd9d9d9 });
  const mShin = new THREE.MeshStandardMaterial({ map: tx.shin, roughness: 0.65 });
  const mSkin = new THREE.MeshPhysicalMaterial({ color: skin, roughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(0x8a5a40) });
  const mCompress = new THREE.MeshStandardMaterial({ color: 0x121216, roughness: 0.38, metalness: 0.05 });
  const mGlove = new THREE.MeshStandardMaterial({ color: 0x1a1236, roughness: 0.45 });
  const mBlack = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.35 });
  const mSole = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.5 });
  const mHelmet = new THREE.MeshPhysicalMaterial({ color: 0x241665, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.09, side: THREE.DoubleSide });
  const mMask = new THREE.MeshStandardMaterial({ color: 0x1b1b20, metalness: 0.6, roughness: 0.35 });
  const mVisor = new THREE.MeshPhysicalMaterial({ color: 0x07070b, metalness: 0.9, roughness: 0.06, clearcoat: 1 });
  const mGold = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.5, roughness: 0.35 });
  const mWhite = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });

  const root = new THREE.Group();
  const hips = new THREE.Group(); root.add(hips);
  const spine = new THREE.Group(); spine.position.set(0, 0.10, 0); hips.add(spine);
  const chest = new THREE.Group(); chest.position.set(0, 0.28, 0); spine.add(chest);
  const add = (parent, geo, mat, pos, rot, scl) => {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    if (scl) m.scale.set(...scl);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m); return m;
  };

  // pelvis (pants) + belt
  add(hips, lathe([[0.12, -0.13], [0.155, -0.08], [0.168, -0.01], [0.165, 0.06], [0.155, 0.11]]), mPants, null, null, [1.2, 1, 0.86]);
  add(hips, new THREE.TorusGeometry(0.158, 0.013, 8, 40), mBlack, [0, 0.1, 0], [Math.PI / 2, 0, 0], [1.2, 0.86, 1]);
  // torso (jersey) from waist to collar, chest-space
  add(chest, lathe([[0.135, -0.36], [0.147, -0.28], [0.152, -0.18], [0.16, -0.08], [0.174, 0.0], [0.186, 0.08], [0.19, 0.14], [0.172, 0.2], [0.115, 0.235], [0.06, 0.245]], 32, Math.PI, Math.PI * 2, 40), mJersey, null, null, [1.22, 1, 0.8]);
  // shoulder pads under the jersey + shoulder numbers
  add(chest, new THREE.SphereGeometry(0.2, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), mPads, [0, 0.16, -0.005], null, [1.62, 0.55, 1.02]);
  add(chest, new THREE.TorusGeometry(0.068, 0.014, 8, 24), mBlack, [0, 0.235, 0.005], [Math.PI / 2, 0, 0]);

  // neck + head + helmet
  const neck = new THREE.Group(); neck.position.set(0, 0.235, 0); chest.add(neck);
  add(neck, new THREE.CylinderGeometry(0.055, 0.062, 0.14, 18), mSkin, [0, 0.05, 0]);
  const head = new THREE.Group(); head.position.set(0, 0.155, 0.012); neck.add(head);
  add(head, new THREE.SphereGeometry(0.098, 24, 16), mSkin, [0, -0.02, 0.012], null, [0.95, 1.08, 1.02]);
  const prof = [[0.118, -0.105], [0.132, -0.07], [0.140, -0.03], [0.142, 0.01], [0.139, 0.045], [0.126, 0.09], [0.10, 0.12], [0.065, 0.14], [0.001, 0.149]];
  const shellLow = prof.filter(([, y]) => y <= 0.045), shellTop = prof.filter(([, y]) => y >= 0.045);
  add(head, lathe(shellTop, 40, 0, Math.PI * 2), mHelmet, null, null, [1, 1, 1.14]);
  add(head, lathe(shellLow, 40, 0.82, Math.PI * 2 - 1.64), mHelmet, null, null, [1, 1, 1.14]); // face opening at the front
  add(head, new THREE.SphereGeometry(0.133, 32, 12, Math.PI / 2 - 0.84, 1.68, 1.2, 0.55), mVisor, null, null, [1, 1, 1.13]); // tinted visor
  // center stripe over the crown, front to back
  const stripePts = prof.slice(3).map(([r, y]) => V(0, y + 0.003, r * 1.14 + 0.002)).concat(prof.slice(3, 8).reverse().map(([r, y]) => V(0, y + 0.003, -r * 1.14 - 0.002)));
  add(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stripePts), 60, 0.011, 6, false), mGold);
  // facemask cage (tube bars) and chinstrap
  const bar = (pts, r = 0.0068) => add(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r, 6, false), mMask);
  for (const y of [-0.022, -0.06, -0.097]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const a = -1.12 + (2.24 * i) / 8; pts.push(V(Math.sin(a) * 0.148, y + Math.cos(a) * 0.006, Math.cos(a) * 0.206)); }
    bar(pts);
  }
  bar([V(0, 0.012, 0.2), V(0, -0.05, 0.212), V(0, -0.105, 0.2)]);
  for (const sx of [-1, 1]) bar([V(sx * 0.07, -0.02, 0.198), V(sx * 0.075, -0.06, 0.202), V(sx * 0.07, -0.1, 0.19)]);
  add(head, new RoundedBoxGeometry(0.075, 0.036, 0.03, 2, 0.01), mWhite, [0, -0.127, 0.128]);
  for (const sx of [-1, 1]) bar([V(sx * 0.03, -0.128, 0.13), V(sx * 0.09, -0.11, 0.09), V(sx * 0.12, -0.07, 0.03)], 0.004);

  // arms: shoulder -> elbow -> wrist groups, each segment hangs along local -y
  const arms = {};
  for (const side of ["R", "L"]) {
    const sx = side === "R" ? -1 : 1;
    const sh = new THREE.Group(); sh.position.set(sx * 0.205, 0.185, -0.01); chest.add(sh);
    const armMat = side === sleeveArm ? mCompress : mSkin;
    add(sh, lathe([[0.041, -0.30], [0.047, -0.24], [0.055, -0.15], [0.059, -0.08], [0.056, 0.0]]), armMat);
    add(sh, lathe([[0.071, -0.155], [0.073, -0.10], [0.075, -0.03], [0.07, 0.03]], 24, Math.PI, Math.PI * 2, 12), mSleeve);
    add(sh, new THREE.SphereGeometry(0.068, 20, 12), mPads, [0, 0, 0], null, [1.1, 0.9, 1]);
    const el = new THREE.Group(); el.position.set(0, -ARM_A, 0); sh.add(el);
    add(el, new THREE.SphereGeometry(0.042, 16, 10), armMat);
    add(el, lathe([[0.029, -0.27], [0.034, -0.2], [0.044, -0.08], [0.042, 0.0]]), armMat);
    const wr = new THREE.Group(); wr.position.set(0, -ARM_B, 0); el.add(wr);
    add(wr, new THREE.SphereGeometry(0.031, 12, 8), mGlove);
    add(wr, new RoundedBoxGeometry(0.084, 0.095, 0.032, 2, 0.012), mGlove, [0, -0.055, 0.004]);
    add(wr, new RoundedBoxGeometry(0.08, 0.075, 0.026, 2, 0.011), mGlove, [0, -0.128, 0.018], [0.45, 0, 0]);
    add(wr, new THREE.CapsuleGeometry(0.012, 0.045, 4, 8), mGlove, [sx * -0.047, -0.058, 0.022], [0.5, 0, sx * -0.6]);
    const hold = new THREE.Group(); hold.position.set(0, -0.105, 0.075); wr.add(hold);
    arms[side] = { sh, el, wr, hold, S: V(sx * 0.205, 0.185, -0.01) };
  }
  // legs: hip -> knee -> ankle
  const legs = {};
  for (const side of ["R", "L"]) {
    const sx = side === "R" ? -1 : 1;
    const hp = new THREE.Group(); hp.position.set(sx * 0.098, -0.03, 0); hips.add(hp);
    add(hp, lathe([[0.058, -0.47], [0.066, -0.41], [0.079, -0.30], [0.089, -0.16], [0.094, -0.06], [0.09, 0.0]], 28, Math.PI, Math.PI * 2, 16), mPants);
    add(hp, new THREE.SphereGeometry(0.058, 16, 10), mPants, [0, -0.445, 0.03], null, [1, 1.25, 0.85]); // knee pad
    const kn = new THREE.Group(); kn.position.set(0, -LEG_A, 0); hp.add(kn);
    add(kn, new THREE.SphereGeometry(0.055, 14, 10), mPants);
    add(kn, lathe([[0.033, -0.46], [0.038, -0.39], [0.051, -0.23], [0.058, -0.12], [0.055, -0.03], [0.057, 0.0]], 24, Math.PI, Math.PI * 2, 18), mShin);
    const an = new THREE.Group(); an.position.set(0, -LEG_B, 0); kn.add(an);
    add(an, new RoundedBoxGeometry(0.105, 0.085, 0.30, 3, 0.035), mBlack, [0, -0.045, 0.062]);
    add(an, new RoundedBoxGeometry(0.11, 0.022, 0.305, 2, 0.01), mSole, [0, -0.086, 0.062]);
    legs[side] = { hp, kn, an, S: V(sx * 0.098, -0.03, 0) };
  }
  return { root, hips, spine, chest, neck, head, arms, legs };
}

// ---------------------------------------------------------------- human body (CC0 rigged base mesh)
// assets/male_base_mesh.glb: "Male Base Mesh" by orange-juice-games, CC0 1.0 (public domain),
// via github.com/BoQsc/Godot-3D-Male-Base-Mesh. The code-built player above stays as an invisible
// "driver": its IK solves the throw, and every frame the human skeleton copies the driver's limb
// directions (swing-only, keeping each bone's rest twist) and its torso rotations.
const HUMAN_URL = "assets/male_base_mesh.glb?v=1";
const HUMAN_SCALE = 1.044; // matches the driver's hip-to-sole length (1.025 m)
function loadHuman() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    new GLTFLoader().load(HUMAN_URL, (g) => { clearTimeout(timer); resolve(g); }, undefined, () => { clearTimeout(timer); resolve(null); });
  });
}
function regionOf(name, t, sleeveArm) {
  const side = name.endsWith("L") ? "L" : name.endsWith("R") ? "R" : "";
  if (/^(spine|pelvis[LR])$/.test(name)) return "pants";
  if (/^spine00[123]$/.test(name) || /^shoulder/.test(name)) return "jersey";
  if (/^spine00[45]$/.test(name)) return "skin";
  if (/^upper_arm/.test(name)) return t < 0.5 ? "jersey" : side === sleeveArm ? "sleeve" : "skin";
  if (/^forearm/.test(name)) return side === sleeveArm ? "sleeve" : "skin";
  if (/^(hand|f_|thumb)/.test(name)) return "glove";
  if (/^thigh/.test(name)) return "pants";
  if (/^shin/.test(name)) return t < 0.42 ? "pants" : "sock";
  return "cleat"; // foot, toe, heel
}
// extra volume per region (metres, before scaling): a football build under pads and pants
const BULK = { jersey: 0.034, pants: 0.02, sleeve: 0.008, skin: 0.006, sock: 0.006, glove: 0.004, cleat: 0.012 };

function makeHuman(gltf, D, { num = "8", skin = 0x4a2e20, sleeveArm = "R", bulk = 1 }) {
  const src = SkeletonUtils.clone(gltf.scene);
  const holder = new THREE.Group();
  holder.rotation.y = -Math.PI / 2; // the base mesh faces +X; the driver faces +Z
  holder.scale.setScalar(HUMAN_SCALE);
  holder.add(src);
  let mesh = null;
  const bones = {};
  src.traverse((o) => { if (o.isSkinnedMesh) mesh = o; if (o.isBone) bones[o.name] = o; });
  holder.updateMatrixWorld(true);

  // ---- per-vertex region from the dominant bone, then per-triangle material groups
  const geo = mesh.geometry.clone();
  const pos = geo.attributes.position, sIdx = geo.attributes.skinIndex, sW = geo.attributes.skinWeight;
  const skel = mesh.skeleton;
  const boneHead = skel.boneInverses.map((m) => V().setFromMatrixPosition(m.clone().invert()));
  const boneTail = skel.bones.map((b, i) => {
    const c = b.children.find((k) => k.isBone);
    if (c) return boneHead[skel.bones.indexOf(c)];
    const rot = new THREE.Matrix4().extractRotation(skel.boneInverses[i].clone().invert());
    return boneHead[i].clone().add(V(0, 0.12, 0).applyMatrix4(rot));
  });
  const vRegion = new Array(pos.count);
  const aF = new Float32Array(pos.count), aArm = new Float32Array(pos.count), aSide = new Float32Array(pos.count);
  const p = V();
  // body cuts at fractions of standing height, placed in gaps between the mesh's edge loops
  // so the collar, waistband, pant hem and cleat lines come out straight
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
  const CUT = { neck: 0.862, waist: 0.536, hem: 0.251, cleat: 0.0667 };
  for (let i = 0; i < pos.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sW.getComponent(i, k); if (w > bw) { bw = w; best = sIdx.getComponent(i, k); } }
    p.fromBufferAttribute(pos, i);
    const name = skel.bones[best].name;
    const f = (p.y - yMin) / (yMax - yMin);
    aF[i] = f;
    aSide[i] = name.endsWith("R") ? 1 : -1;
    if (/^(upper_arm|forearm|hand|f_|thumb)/.test(name)) {
      const h = boneHead[best], tl = boneTail[best], d = tl.clone().sub(h);
      const t = clamp(p.clone().sub(h).dot(d) / Math.max(d.lengthSq(), 1e-6), 0, 1);
      vRegion[i] = regionOf(name, t, sleeveArm);
      // distance along the arm from the shoulder, normalised (upper 0.328, forearm 0.24, hand+fingers ~0.2)
      aArm[i] = /^upper_arm/.test(name) ? t * 0.328 / 0.77 : /^forearm/.test(name) ? (0.328 + t * 0.24) / 0.77 : 0.75 + t * 0.2;
    } else {
      aArm[i] = -1;
      vRegion[i] = f > CUT.neck ? "skin" : f > CUT.waist ? "jersey" : f > CUT.hem ? "pants" : f > CUT.cleat ? "sock" : "cleat";
    }
  }
  // inflate along seam-welded normals so the silhouette reads as an athlete in pads
  const key = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => Math.round(v * 1e4)).join(",");
  const weldNormals = () => {
    const acc = new Map();
    const nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const k = key(i), n = V().fromBufferAttribute(nrm, i), a = acc.get(k);
      if (a) a.add(n); else acc.set(k, n);
    }
    return acc;
  };
  geo.computeVertexNormals();
  const acc = weldNormals();
  const moved = [];
  for (let i = 0; i < pos.count; i++) {
    const n = acc.get(key(i)).clone().normalize();
    const b = (BULK[vRegion[i]] || 0) * bulk;
    moved.push([pos.getX(i) + n.x * b, pos.getY(i) + n.y * b, pos.getZ(i) + n.z * b]);
  }
  moved.forEach((m, i) => pos.setXYZ(i, m[0], m[1], m[2]));
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const acc2 = weldNormals(); // smooth shading across UV seams
  for (let i = 0; i < pos.count; i++) { const n = acc2.get(key(i)).clone().normalize(); geo.attributes.normal.setXYZ(i, n.x, n.y, n.z); }

  geo.setAttribute("aF", new THREE.BufferAttribute(aF, 1));
  geo.setAttribute("aArm", new THREE.BufferAttribute(aArm, 1));
  geo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
  // one material; the uniform is painted per pixel from interpolated height / arm position,
  // so collar, waistband, hem, sleeve and glove lines are straight regardless of triangle layout
  const col = (h) => new THREE.Color(h);
  const U = {
    uJersey: { value: col(PURPLE) }, uSleeve: { value: col(sleeveArm === "none" ? PURPLE : 0x121216) },
    uSkin: { value: col(skin) }, uGlove: { value: col(0x1a1236) }, uPants: { value: col(0xe9e9e9) },
    uSock: { value: col(0x16121f) }, uCleat: { value: col(0x0b0b0d) }, uGold: { value: col(0xc9a227) }, uWhite: { value: col(0xf2f2f2) },
    uCut: { value: new THREE.Vector4(CUT.neck, CUT.waist, CUT.hem, CUT.cleat) },
    uSleeveSide: { value: sleeveArm === "R" ? 1 : sleeveArm === "L" ? -1 : 0 },
    uNum: { value: null }, uNumBox: { value: new THREE.Vector4(0.11, 0.13, 0, 0.03) },
  };
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x5a4cb6) });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aF; attribute float aArm; attribute float aSide; attribute vec3 aP;\nvarying float vF; varying float vArm; varying float vSide; varying vec3 vP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvF = aF; vArm = aArm; vSide = aSide; vP = aP;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying float vF; varying float vArm; varying float vSide;
uniform vec3 uJersey, uSleeve, uSkin, uGlove, uPants, uSock, uCleat, uGold, uWhite;
uniform vec4 uCut; uniform float uSleeveSide;
uniform sampler2D uNum; uniform vec4 uNumBox;
varying vec3 vP;
float regionRough;
vec3 withNumber(vec3 c) {
  // uNumBox: front half-size, back half-size, front centre y, back centre y (bind space, chest-relative)
  vec2 uv = vP.z > 0.0 ? vec2(vP.x / (2.0 * uNumBox.x) + 0.5, (vP.y - uNumBox.z) / (2.0 * uNumBox.x) + 0.5)
                       : vec2(-vP.x / (2.0 * uNumBox.y) + 0.5, (vP.y - uNumBox.w) / (2.0 * uNumBox.y) + 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return c;
  vec4 n = texture2D(uNum, uv);
  return mix(c, n.rgb, n.a);
}
vec3 uniformColor() {
  if (vArm > -0.5) {
    if (vArm < 0.205) return uJersey;                                   // jersey sleeve over the pads
    if (vArm < 0.225) return uWhite;                                    // sleeve stripes
    if (vArm < 0.235) return uGold;
    if (vArm < 0.738) { regionRough = 0.5; return (uSleeveSide != 0.0 && vSide * uSleeveSide > 0.0) ? uSleeve : uSkin; }
    regionRough = 0.45; return uGlove;
  }
  if (vF > uCut.x) { regionRough = 0.5; return uSkin; }
  if (vF > uCut.y) return withNumber(uJersey);
  if (vF > uCut.z) { regionRough = 0.62; return uPants; }
  if (vF > uCut.w) { regionRough = 0.7; float b = step(0.15, vF) * step(vF, 0.165) + step(0.175, vF) * step(vF, 0.19); return mix(uSock, uJersey, b); }
  regionRough = 0.32; return uCleat;
}`)
      .replace("#include <color_fragment>", "#include <color_fragment>\nregionRough = 0.72;\ndiffuseColor.rgb *= uniformColor();")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = regionRough;");
  };
  const mats = [mat];
  mesh.geometry = geo;
  mesh.material = mat;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  // ---- attachments: frames that are upright and facing +Z in the bind pose, following a bone
  holder.updateMatrixWorld(true);
  const attach = (boneName, worldPos) => {
    const bone = bones[boneName];
    const want = new THREE.Matrix4().compose(worldPos, new THREE.Quaternion(), V(1, 1, 1));
    const a = new THREE.Object3D();
    new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(want).decompose(a.position, a.quaternion, a.scale);
    bone.add(a);
    return a;
  };
  // rendered (skinned) position of a vertex in world space; the mesh node itself is offset from the skin
  const bindWorld = (i) => mesh.getVertexPosition(i, V()).applyMatrix4(mesh.matrixWorld);
  const headW = bones.spine005.getWorldPosition(V());
  // helmet, facemask, visor, chinstrap: move the driver's helmet parts onto the human head
  const helmet = attach("spine005", headW.clone().add(V(0, HELMET_UP, HELMET_FWD)));
  const headKids = D.head.children.slice();
  headKids.forEach((m, k) => { if (k === 0) return; helmet.add(m); m.visible = true; }); // [0] is the driver's bare head sphere
  helmet.scale.setScalar(HELMET_SCALE);
  // chest: shoulder pads (under the jersey) and the numbers
  const chestW = bones.spine003.getWorldPosition(V());
  const chest = attach("spine003", chestW.clone());
  let zF = -1, zB = 1, halfW = 0;
  for (let i = 0; i < pos.count; i++) {
    if (vRegion[i] !== "jersey") continue;
    const w = bindWorld(i);
    if (Math.abs(w.y - (chestW.y + 0.03)) < 0.05 && Math.abs(w.x - chestW.x) < 0.06) { zF = Math.max(zF, w.z); zB = Math.min(zB, w.z); }
  }
  for (let i = 0; i < pos.count; i++) {
    if (vRegion[i] !== "jersey") continue;
    const w = bindWorld(i);
    if (Math.abs(w.y - (chestW.y + 0.1)) < 0.04) halfW = Math.max(halfW, Math.abs(w.x - chestW.x));
  }
  if (zF < -0.5) { zF = chestW.z + 0.13; zB = chestW.z - 0.13; }
  halfW = clamp(halfW, 0.17, 0.26);
  const padMat = new THREE.MeshPhysicalMaterial({ color: PURPLE, roughness: 0.72, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x6a5cd6) });
  const pad = new THREE.Mesh(new THREE.SphereGeometry(0.2, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), padMat);
  pad.position.set(0, PAD_UP, (zF + zB) / 2 - chestW.z);
  pad.scale.set((halfW + 0.07) / 0.2, 0.6, (zF - zB + 0.06) / 0.4);
  pad.castShadow = true; pad.receiveShadow = true;
  chest.add(pad);
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 14), padMat);
    cap.position.set(sx * (halfW + 0.03), PAD_UP, (zF + zB) / 2 - chestW.z);
    cap.scale.set(0.95, 0.75, 1.05); cap.castShadow = true;
    chest.add(cap);
  }
  // numbers: painted by the uniform shader, projected front/back from bind-space positions
  const numTex = colorTex(canvas(256, 256, (g, w, h) => { drawNumber(g, num, w / 2, h / 2 + 8, 200, 0.8, "#ffffff", GOLD_HEX); }));
  const midZ = (zF + zB) / 2;
  const aP = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const w = bindWorld(i);
    aP[i * 3] = w.x - chestW.x; aP[i * 3 + 1] = w.y - chestW.y; aP[i * 3 + 2] = w.z - midZ;
  }
  geo.setAttribute("aP", new THREE.BufferAttribute(aP, 3));
  U.uNum.value = numTex;
  U.uNumBox.value.set(0.125, 0.15, NUM_UP, NUM_UP + 0.02);

  const restLocal = {}, restWorld = {};
  for (const n of Object.keys(bones)) { restLocal[n] = bones[n].quaternion.clone(); restWorld[n] = bones[n].getWorldQuaternion(new THREE.Quaternion()); }
  return { holder, mesh, bones, restLocal, restWorld, debug: { zF, zB, halfW, chestY: chestW.y, headY: headW.y } };
}
const HELMET_UP = 0.1, HELMET_FWD = 0.015, HELMET_SCALE = 1.0, PAD_UP = 0.1, NUM_UP = -0.02;

// Copy the driver's pose onto the human skeleton (driver rest pose = identity, facing +Z).
const _qs = new THREE.Quaternion();
function retarget(H, D) {
  const B = H.bones;
  H.holder.position.set(0, 0, 0);
  H.holder.updateMatrixWorld(true);
  const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
  const wp = (o) => o.getWorldPosition(V());
  const setWorld = (name, q) => {
    const b = B[name];
    b.quaternion.copy(wq(b.parent).invert().multiply(q));
    b.updateMatrixWorld(true);
  };
  const delta = (name, g) => setWorld(name, wq(g).multiply(H.restWorld[name])); // same rest pose on both
  const keep = (name) => { B[name].quaternion.copy(H.restLocal[name]); B[name].updateMatrixWorld(true); };
  const swing = (name, dir) => {
    keep(name);
    const q0 = wq(B[name]);
    const d0 = V(0, 1, 0).applyQuaternion(q0).normalize();
    _qs.setFromUnitVectors(d0, dir.clone().normalize());
    setWorld(name, _qs.clone().multiply(q0));
  };
  delta("spine", D.hips);
  delta("spine001", D.spine);
  delta("spine002", D.spine);
  delta("spine003", D.chest);
  for (const s of ["L", "R"]) {
    const A = D.arms[s];
    keep("shoulder" + s);
    swing("upper_arm" + s, wp(A.el).sub(wp(A.sh)));
    swing("forearm" + s, wp(A.wr).sub(wp(A.el)));
    swing("hand" + s, V(0, -1, 0).applyQuaternion(wq(A.wr)));
  }
  delta("spine004", D.neck);
  delta("spine005", D.head);
  for (const s of ["L", "R"]) {
    const L = D.legs[s];
    keep("pelvis" + s);
    swing("thigh" + s, wp(L.kn).sub(wp(L.hp)));
    swing("shin" + s, wp(L.an).sub(wp(L.kn)));
    delta("foot" + s, L.an);
  }
  // translate so the hip joints sit where the driver's are
  const hipD = wp(D.legs.L.hp).add(wp(D.legs.R.hp)).multiplyScalar(0.5);
  const hipH = wp(B.thighL).add(wp(B.thighR)).multiplyScalar(0.5);
  H.holder.position.copy(hipD.sub(hipH));
  H.holder.updateMatrixWorld(true);
}
function hideDriver(D) { D.root.traverse((o) => { if (o.isMesh) o.visible = false; }); }

// ---- joint-based posing with two-bone IK
const _m4 = new THREE.Matrix4();
function quatFromDir(dir, hint, out) {
  const y = dir.clone().normalize().negate();
  let z = hint.clone().sub(y.clone().multiplyScalar(hint.dot(y)));
  if (z.lengthSq() < 1e-8) { z = Math.abs(y.x) < 0.9 ? V(1, 0, 0) : V(0, 0, 1); z.sub(y.clone().multiplyScalar(z.dot(y))); }
  z.normalize();
  const x = V().crossVectors(y, z);
  _m4.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m4);
}
function solveTwoBone(S, T, a, b, pole) {
  const d = T.clone().sub(S);
  const dir = d.clone().normalize();
  const dist = clamp(d.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const bend = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1);
  bend.normalize();
  const E = S.clone().addScaledVector(dir, a * cosA).addScaledVector(bend, a * sinA);
  const Tc = S.clone().addScaledVector(dir, dist);
  return { E, T: Tc, bend };
}
function setLimb(j, S, T, a, b, pole, handDir, handHint) {
  const { E, T: Tc, bend } = solveTwoBone(S, T, a, b, pole);
  const qU = quatFromDir(E.clone().sub(S), bend, new THREE.Quaternion());
  const qL = quatFromDir(Tc.clone().sub(E), bend, new THREE.Quaternion());
  j[0].quaternion.copy(qU);
  j[1].quaternion.copy(qU.clone().invert().multiply(qL));
  if (j[2] && handDir) {
    const qH = quatFromDir(handDir, handHint || bend, new THREE.Quaternion());
    j[2].quaternion.copy(qL.clone().invert().multiply(qH));
  } else if (j[2]) j[2].quaternion.identity();
  return qL;
}
const vec = (a) => V(a[0], a[1], a[2]);
function applyPose(P, pose, lookAt) {
  P.root.position.set(pose.root[0], 0, pose.root[1]);
  P.root.rotation.set(0, pose.yaw, 0);
  P.hips.position.set(0, pose.hipH, 0);
  P.hips.rotation.set(pose.hip[0], pose.hip[1], pose.hip[2], "YXZ");
  P.spine.rotation.set(pose.chest[0] * 0.45, pose.chest[1] * 0.45, pose.chest[2] * 0.45, "YXZ");
  P.chest.rotation.set(pose.chest[0] * 0.55, pose.chest[1] * 0.55, pose.chest[2] * 0.55, "YXZ");
  P.root.updateMatrixWorld(true);
  // arms (chest space)
  for (const side of ["R", "L"]) {
    const s = pose[side], A = P.arms[side];
    const hd = s.dir && Math.hypot(s.dir[0], s.dir[1], s.dir[2]) > 0.2 ? vec(s.dir) : null;
    setLimb([A.sh, A.el, A.wr], A.S, vec(s.t), ARM_A, ARM_B, vec(s.pole), hd, s.hint ? vec(s.hint) : null);
  }
  // legs: world ankle targets -> hips space, knees point where the foot points
  const qHipsW = P.hips.getWorldQuaternion(new THREE.Quaternion());
  const qHipsInv = qHipsW.clone().invert();
  for (const side of ["R", "L"]) {
    const f = pose["f" + side], L = P.legs[side];
    const target = P.hips.worldToLocal(V(f[0], ANKLE_H + (f[3] || 0), f[1]));
    const fwd = V(0, 0, 1).applyEuler(new THREE.Euler(0, f[2], 0)).applyQuaternion(qHipsInv);
    const pole = fwd.add(V(side === "R" ? -0.15 : 0.15, 0, 0));
    const qShin = setLimb([L.hp, L.kn, null], L.S, target, LEG_A, LEG_B, pole, null);
    const qFootW = new THREE.Quaternion().setFromEuler(new THREE.Euler(f[4] || 0, f[2], 0, "YXZ"));
    L.an.quaternion.copy(qShin.clone().invert().multiply(qHipsInv.clone().multiply(qFootW)));
  }
  // head keeps the eyes level and on the target
  P.root.updateMatrixWorld(true);
  const hp = P.head.getWorldPosition(V());
  const d = lookAt.clone().sub(hp).normalize().applyQuaternion(P.chest.getWorldQuaternion(new THREE.Quaternion()).invert());
  P.neck.rotation.set(clamp(-Math.asin(clamp(d.y, -1, 1)), -0.5, 0.5), clamp(Math.atan2(d.x, d.z), -1.35, 1.35), 0, "YXZ");
}
// keyframe interpolation (numbers / arrays / nested objects)
function mix(a, b, t) {
  if (typeof a === "number") return lerp(a, b, t);
  if (Array.isArray(a)) return a.map((v, i) => lerp(v, b[i], t));
  const o = {};
  for (const k of Object.keys(a)) o[k] = k === "p" ? a[k] : mix(a[k], b[k], t);
  return o;
}
function merge(base, over) {
  const o = { ...base };
  for (const k of Object.keys(over)) {
    const v = over[k];
    o[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(base[k] || {}, v) : v;
  }
  return o;
}
function track(base, keys) {
  let prev = base;
  return keys.map(([p, over]) => (prev = { ...merge(prev, over), p }));
}
function sample(K, p) {
  if (p <= K[0].p) return { pose: K[0], a: K[0], b: K[0], t: 0 };
  for (let i = 0; i < K.length - 1; i++) {
    if (p <= K[i + 1].p) {
      const t = smooth((p - K[i].p) / (K[i + 1].p - K[i].p));
      return { pose: mix(K[i], K[i + 1], t), a: K[i], b: K[i + 1], t };
    }
  }
  const last = K[K.length - 1];
  return { pose: last, a: last, b: last, t: 0 };
}
// feet lift and point their toes while they travel between keys
function withSteps(s) {
  const pose = { ...s.pose };
  for (const f of ["fR", "fL"]) {
    const a = s.a[f], b = s.b[f];
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (dist > 0.05) {
      const bump = Math.sin(Math.PI * s.t);
      pose[f] = pose[f].slice();
      pose[f][3] = bump * Math.min(0.16, 0.05 + dist * 0.07);
      pose[f][4] = -bump * 0.35;
    }
  }
  return pose;
}

// ---- the throw. Feet: [x, z, yaw, lift, pitch] in world; hands: targets in chest space (R = throwing hand)
const RELEASE = 0.43;
const QB_BASE = {
  root: [0, -0.95], yaw: 0, hipH: 0.80, hip: [0.42, 0, 0], chest: [0.28, 0, 0],
  R: { t: [-0.08, -0.29, 0.30], pole: [-1, 0.1, -0.4], dir: [0, 0, 0], hint: [0, 0, 1] },
  L: { t: [0.07, -0.31, 0.29], pole: [1, 0.1, -0.4], dir: [0, 0, 0], hint: [0, 0, 1] },
  fR: [-0.24, -1.02, -0.12, 0, 0], fL: [0.24, -0.96, 0.12, 0, 0],
};
const QB = track(QB_BASE, [
  [0.00, {}],
  [0.05, {}],
  // step 1: open to the right, right foot drops back, ball to the chest
  [0.10, { root: [0.0, -1.5], yaw: -0.95, hipH: 0.92, hip: [0.14, 0, 0], chest: [0.06, 0, 0],
    R: { t: [-0.08, -0.03, 0.25], pole: [-1, -0.6, 0], dir: [0.3, -0.2, 1] }, L: { t: [0.07, -0.05, 0.25], pole: [1, -0.6, 0], dir: [-0.3, -0.2, 1] },
    fR: [-0.32, -1.95, -1.25, 0, 0], fL: [0.22, -0.98, -0.5, 0, 0] }],
  // step 2: left foot crosses back
  [0.155, { root: [0.0, -2.45], yaw: -1.25, hipH: 0.93, fL: [0.04, -3.0, -1.3, 0, 0] }],
  // step 3: right foot plants deep
  [0.21, { root: [-0.04, -3.75], yaw: -1.45, hipH: 0.9, hip: [-0.04, 0, 0], fR: [-0.34, -4.4, -1.45, 0, 0] }],
  // set: weight on the back foot, ball up by the ear, front arm points at the target
  [0.265, { root: [-0.1, -4.05], yaw: -1.55, hipH: 0.86, hip: [0.02, 0, 0.04], chest: [0.02, 0, -0.06],
    R: { t: [-0.40, 0.43, -0.10], pole: [-1, -0.25, -0.2], dir: [0, 1, -0.15], hint: [1, 0, 0] },
    L: { t: [0.60, 0.17, 0.10], pole: [0, -1, 0.2], dir: [1, 0, 0.1], hint: [0, 0, 1] },
    fL: [0.16, -3.55, -1.15, 0, 0] }],
  // stride: front foot steps at the target, hips open while the shoulders stay closed
  [0.33, { root: [-0.05, -3.62], hipH: 0.87, hip: [0.04, 0.5, 0.0], chest: [0.05, -0.5, -0.08],
    R: { t: [-0.44, 0.43, -0.18], pole: [-1, -0.2, -0.35], dir: [0, 1, -0.3] },
    L: { t: [0.50, 0.08, 0.20], pole: [0.2, -1, 0.3] },
    fL: [0.24, -2.95, -0.55, 0, 0] }],
  // hips fire, elbow leads at shoulder height
  [0.395, { root: [0, -3.42], hipH: 0.9, hip: [0.1, 1.1, 0], chest: [0.14, -0.32, -0.05],
    R: { t: [-0.30, 0.56, 0.02], pole: [-0.9, 0.0, -0.5], dir: [0.1, 1, 0.3] },
    L: { t: [0.26, -0.02, 0.24], pole: [1, -0.8, -0.4], dir: [0, 0, 1] },
    fR: [-0.34, -4.38, -0.95, 0, -0.25] }],
  // release: quick over-the-top snap, wrist flick
  [RELEASE, { root: [0, -3.36], hip: [0.14, 1.42, 0], chest: [0.22, 0.06, 0.02],
    R: { t: [-0.10, 0.68, 0.30], pole: [-0.7, -0.3, -0.3], dir: [0.02, -0.25, 1], hint: [0, 1, 0.2] },
    L: { t: [0.16, 0.0, 0.22], pole: [1, -1, -0.6], dir: [-0.3, 0.2, 1] },
    fR: [-0.3, -4.2, -0.45, 0, -0.35] }],
  // follow-through: hand finishes across the body, back leg comes through
  [0.52, { root: [0.05, -2.9], hipH: 0.88, hip: [0.22, 1.62, -0.04], chest: [0.46, 0.36, 0.05],
    R: { t: [0.12, -0.16, 0.36], pole: [-0.3, -0.5, 0.8], dir: [0.4, -1, 0.3] },
    L: { t: [0.19, -0.14, -0.1], pole: [0.8, -0.6, -0.9], dir: [0, -0.3, 1] },
    fR: [-0.06, -2.45, 0.25, 0, 0] }],
  [0.62, { hipH: 0.9, hip: [0.16, 1.6, -0.02], chest: [0.36, 0.34, 0.03] }],
]);
// the center: crouched over the ball, then pops up to block (steps left, out of the camera's line)
const C_BASE = {
  root: [0, -0.28], yaw: 0, hipH: 0.64, hip: [0.95, 0, 0], chest: [0.25, 0, 0],
  R: { t: [-0.14, -0.50, 0.22], pole: [-1, 0, -0.3], dir: [0, 0, 0], hint: [0, 0, 1] },
  L: { t: [0.14, -0.40, 0.18], pole: [1, 0, -0.3], dir: [0, 0, 0], hint: [0, 0, 1] },
  fR: [-0.36, -0.12, -0.15, 0, 0], fL: [0.36, -0.12, 0.15, 0, 0],
};
const CENTER = track(C_BASE, [
  [0.05, {}],
  [0.12, { root: [-0.9, -0.2], hipH: 0.86, hip: [0.3, 0, 0], chest: [0.12, 0, 0],
    R: { t: [-0.12, 0.02, 0.33], pole: [-1, -0.4, 0] }, L: { t: [0.12, 0.02, 0.33], pole: [1, -0.4, 0] },
    fR: [-1.2, -0.28, -0.2, 0, 0], fL: [-0.6, -0.1, 0.2, 0, 0] }],
  [0.2, { root: [-2.8, -0.45], yaw: -0.3, fR: [-3.1, -0.55, -0.5, 0, 0], fL: [-2.5, -0.35, -0.1, 0, 0] }],
]);
// camera: wide establishing shot behind the offense, push in, swing around, face the QB
const CAM = [
  { p: 0.0, pos: [15, 14, -34], look: [0, 9, 30] },
  { p: 0.11, pos: [6, 3.6, -11], look: [0, 1.3, 5] },
  { p: 0.2, pos: [8.5, 2.6, -3.5], look: [0, 1.35, -3.8] },
  { p: 0.3, pos: [4.2, 2.0, 2.2], look: [-0.1, 1.4, -3.9] },
  { p: 0.38, pos: [1.0, 1.82, 2.75], look: [-0.15, 1.42, -3.6] },
  { p: 1.0, pos: [0.85, 1.78, 2.45], look: [-0.15, 1.5, -3.5] },
];
const camCurve = new THREE.CatmullRomCurve3(CAM.map((c) => vec(c.pos)), false, "centripetal");
let NARROW = false;
function cameraAt(p) {
  let i = 0;
  while (i < CAM.length - 2 && p > CAM[i + 1].p) i++;
  const t = smooth(clamp((p - CAM[i].p) / (CAM[i + 1].p - CAM[i].p), 0, 1));
  const pos = camCurve.getPoint((i + t) / (CAM.length - 1));
  const look = vec(CAM[i].look).lerp(vec(CAM[i + 1].look), t);
  if (NARROW) { const k = smooth(clamp((p - 0.24) / 0.14, 0, 1)); pos.x = lerp(pos.x, pos.x * 0.25, k); look.x = lerp(look.x, 0.05, k); }
  return { pos, look };
}

// ---------------------------------------------------------------- football
function makeFootball(lite) {
  const pebble = normalTex(256, (g, w) => {
    g.fillStyle = "#808080"; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 1700; i++) {
      const x = Math.random() * w, y = Math.random() * w, r = 1.6 + Math.random() * 2.2;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }, 2.2, [3, 2]);
  const L = 0.142, R = 0.085, pts = [];
  for (let i = 0; i <= 32; i++) { const y = -L + (2 * L * i) / 32; pts.push([R * Math.pow(Math.max(0, 1 - (y / L) ** 2), 0.72), y]); }
  const geo = lathe(pts, lite ? 24 : 48, 0);
  geo.rotateX(Math.PI / 2); // long axis -> z (nose = +z)
  const leather = new THREE.MeshPhysicalMaterial({ color: 0x6a3316, roughness: 0.6, normalMap: pebble, normalScale: new THREE.Vector2(0.55, 0.55), clearcoat: 0.25, clearcoatRoughness: 0.5 });
  const ball = new THREE.Group();
  const body = new THREE.Mesh(geo, leather); body.castShadow = true; ball.add(body);
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x3a1c0c, roughness: 0.8 });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4, cp = [];
    for (let i = 1; i < 32; i++) { const [r, y] = pts[i]; cp.push(V(Math.cos(a) * r * 1.004, Math.sin(a) * r * 1.004, y)); }
    ball.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp), 48, 0.0014, 4, false), seamMat));
  }
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.5 });
  const radiusAt = (z) => R * Math.pow(Math.max(0, 1 - (z / L) ** 2), 0.72);
  const spine = [];
  for (let i = 0; i <= 12; i++) { const z = -0.055 + (0.11 * i) / 12; spine.push(V(0, radiusAt(z) + 0.0008, z)); }
  ball.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spine), 24, 0.0022, 5, false), white));
  for (let i = -4; i <= 4; i++) {
    const z = i * 0.012, r = radiusAt(z) + 0.0006, a = 0.17, cp = [];
    for (let k = 0; k <= 6; k++) { const ang = -a + (2 * a * k) / 6; cp.push(V(Math.sin(ang) * r, Math.cos(ang) * r, z)); }
    ball.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp), 8, 0.0018, 4, false), white));
  }
  return { ball, geo };
}

// ---------------------------------------------------------------- field
const FIELD_W = 48.77, FIELD_L = 109.73, Z_BACK = -41.15, FZ = Z_BACK + FIELD_L / 2;
function makeField(scene) {
  const PX = 16, W = Math.round(53.33 * PX), H = 120 * PX;
  const tex = colorTex(canvas(W, H, (g) => {
    g.fillStyle = "#2d7a33"; g.fillRect(0, 0, W, H);
    for (let yd = 10; yd < 110; yd += 5) { g.fillStyle = (yd / 5) % 2 ? "#2a7230" : "#318237"; g.fillRect(0, yd * PX, W, 5 * PX); }
    // end zones with the site name
    for (const y0 of [0, 110 * PX]) {
      g.fillStyle = PURPLE_HEX; g.fillRect(0, y0, W, 10 * PX);
      for (let i = 0; i < W; i += 28) { g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(i, y0, 14, 10 * PX); }
      g.save(); g.translate(W / 2, y0 + 5 * PX);
      if (y0 > 0) g.rotate(Math.PI);
      g.font = `900 ${Math.round(PX * 4.6)}px "Arial Black", Impact, Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = 5; g.strokeStyle = GOLD_HEX; g.strokeText("THE CLOSING LINE", 0, 0);
      g.fillStyle = "#ffffff"; g.fillText("THE CLOSING LINE", 0, 0); g.restore();
    }
    g.fillStyle = "#f7f7f2";
    g.fillRect(0, 0, W, 5); g.fillRect(0, H - 5, W, 5); g.fillRect(0, 0, 5, H); g.fillRect(W - 5, 0, 5, H);
    for (let yd = 10; yd <= 110; yd += 5) g.fillRect(0, yd * PX - 1.5, W, yd === 10 || yd === 110 ? 5 : 3);
    const hash = 23.58 * PX;
    for (let yd = 11; yd < 110; yd++) {
      if ((yd - 10) % 5 === 0) continue;
      const y = yd * PX;
      g.fillRect(hash - 5, y - 1, 11, 2); g.fillRect(W - hash - 6, y - 1, 11, 2);
      g.fillRect(8, y - 1, 11, 2); g.fillRect(W - 19, y - 1, 11, 2);
    }
    g.font = `700 ${PX * 2}px "Arial Black", Impact, Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    for (let yd = 20; yd <= 100; yd += 10) {
      const n = String(yd <= 60 ? yd - 10 : 110 - yd);
      for (const [x, rot] of [[12 * PX, Math.PI / 2], [W - 12 * PX, -Math.PI / 2]]) {
        g.save(); g.translate(x, yd * PX); g.rotate(rot); g.fillText(n.split("").join(" "), 0, 0); g.restore();
      }
    }
  }));
  const grass = normalTex(256, (g, w) => {
    const img = g.createImageData(w, w);
    for (let i = 0; i < img.data.length; i += 4) { const v = 90 + Math.random() * 90; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, 1.5, [60, 140]);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W, FIELD_L), new THREE.MeshStandardMaterial({ map: tex, normalMap: grass, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92 }));
  field.rotation.x = -Math.PI / 2; field.position.set(0, 0, FZ); field.receiveShadow = true;
  scene.add(field);
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(90, 150), new THREE.MeshStandardMaterial({ color: 0x28692e, roughness: 0.95, normalMap: grass, normalScale: new THREE.Vector2(0.5, 0.5) }));
  surround.rotation.x = -Math.PI / 2; surround.position.set(0, -0.01, FZ); surround.receiveShadow = true;
  scene.add(surround);
  // gooseneck goal posts at both end lines
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.4, emissive: 0x3a2a00 });
  for (const [z, s] of [[Z_BACK, -1], [Z_BACK + FIELD_L, 1]]) {
    const gp = new THREE.Group();
    const cyl = (r, h, pos, rot) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), yellow); m.position.set(...pos); if (rot) m.rotation.set(...rot); m.castShadow = true; gp.add(m); };
    cyl(0.17, 3.05, [0, 1.52, s * 1.8]);
    cyl(0.12, 1.8, [0, 3.05, s * 0.9], [Math.PI / 2, 0, 0]);
    cyl(0.1, 5.64, [0, 3.05, 0], [0, 0, Math.PI / 2]);
    cyl(0.06, 10.7, [-2.82, 3.05 + 5.35, 0]); cyl(0.06, 10.7, [2.82, 3.05 + 5.35, 0]);
    gp.position.set(0, 0, z); scene.add(gp);
  }
}

// ---------------------------------------------------------------- stadium bowl
// rounded-rectangle bowl path (4 straights + 4 corner arcs). Rows are offset copies, so a point at the
// same segment + fraction lines up radially from row to row (aisles, stairs, treads).
const BOWL = { X0: 31.2, Z0: 60.6, R0: 10 };
function bowlSegments(o) {
  const hx = BOWL.X0 + o, hz = BOWL.Z0 + o, r = BOWL.R0 + o, ax = BOWL.X0 - BOWL.R0, az = BOWL.Z0 - BOWL.R0;
  const arc = (cx, cz, a0) => (t) => { const a = a0 + t * Math.PI / 2; return [cx + r * Math.cos(a), cz + r * Math.sin(a), Math.cos(a), Math.sin(a)]; };
  const q = (Math.PI / 2) * r;
  return [
    { kind: "side", f: (t) => [hx, lerp(-az, az, t), 1, 0], len: 2 * az },
    { kind: "corner", f: arc(ax, az, 0), len: q },
    { kind: "end", f: (t) => [lerp(ax, -ax, t), hz, 0, 1], len: 2 * ax },
    { kind: "corner", f: arc(-ax, az, Math.PI / 2), len: q },
    { kind: "side", f: (t) => [-hx, lerp(az, -az, t), -1, 0], len: 2 * az },
    { kind: "corner", f: arc(-ax, -az, Math.PI), len: q },
    { kind: "end", f: (t) => [lerp(-ax, ax, t), -hz, 0, -1], len: 2 * ax },
    { kind: "corner", f: arc(ax, -az, 1.5 * Math.PI), len: q },
  ];
}
const SEG_SAMPLES = [34, 10, 16, 10, 34, 10, 16, 10];
// stepped seating surface (treads + risers) for one tier
function tierGeometry(tier, filter) {
  const pos = [];
  const push = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let r = 0; r < tier.rows; r++) {
    const o0 = tier.o + r * tier.tread, o1 = o0 + tier.tread, y = tier.y + r * tier.rise;
    const s0 = bowlSegments(o0), s1 = bowlSegments(o1);
    s0.forEach((seg, si) => {
      if (filter && !filter(seg.kind)) return;
      const n = SEG_SAMPLES[si];
      for (let i = 0; i < n; i++) {
        const [ax, az] = seg.f(i / n), [bx, bz] = seg.f((i + 1) / n);
        const [cx, cz] = s1[si].f(i / n), [dx, dz] = s1[si].f((i + 1) / n);
        const A = [ax, y, az + FZ], B = [bx, y, bz + FZ], C = [cx, y, cz + FZ], D = [dx, y, dz + FZ];
        push(A, C, B); push(B, C, D);
        const C2 = [cx, y + tier.rise, cz + FZ], D2 = [dx, y + tier.rise, dz + FZ];
        push(C, C2, D); push(D, C2, D2);
      }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
// vertical band following the bowl path at offset o (suites, fascia, walls)
function bandGeometry(o, y0, y1, filter, uScale) {
  const pos = [], uv = [];
  let u = 0;
  bowlSegments(o).forEach((seg, si) => {
    if (filter && !filter(seg.kind)) return;
    const n = SEG_SAMPLES[si];
    for (let i = 0; i < n; i++) {
      const [ax, az] = seg.f(i / n), [bx, bz] = seg.f((i + 1) / n);
      const du = Math.hypot(bx - ax, bz - az) / uScale;
      pos.push(ax, y0, az + FZ, bx, y0, bz + FZ, ax, y1, az + FZ, bx, y0, bz + FZ, bx, y1, bz + FZ, ax, y1, az + FZ);
      uv.push(u, 0, u + du, 0, u, 1, u + du, 0, u + du, 1, u, 1);
      u += du;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
function ribbonTexture(text, w, h, bg, fg) {
  const t = colorTex(canvas(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.font = `900 ${Math.round(h * 0.62)}px "Arial Black", Impact, Arial, sans-serif`; g.textBaseline = "middle";
    let x = 10;
    while (x < w) {
      g.fillStyle = fg; g.fillText(text, x, h / 2 + 2);
      x += g.measureText(text).width + 40;
      g.fillStyle = GOLD_HEX; g.fillText("•", x - 30, h / 2);
    }
  }));
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function makeStadium(scene, lite) {
  const LOWER = { o: 0, y: 1.7, rows: 26, tread: 0.86, rise: 0.5 };            // ~30 degrees
  const lowerTop = { o: LOWER.rows * LOWER.tread, y: LOWER.y + LOWER.rows * LOWER.rise };
  const SUITE_H = 5.2;
  const UPPER = { o: lowerTop.o - 2.6, y: lowerTop.y + SUITE_H + 1.1, rows: 21, tread: 0.8, rise: 0.58 }; // ~36 degrees, overhangs the lower bowl
  const upperTop = { o: UPPER.o + UPPER.rows * UPPER.tread, y: UPPER.y + UPPER.rows * UPPER.rise };
  const noCorners = (k) => k !== "corner";
  scene.add(new THREE.Mesh(tierGeometry(LOWER), new THREE.MeshStandardMaterial({ color: 0x1d1a24, roughness: 0.9 })));
  scene.add(new THREE.Mesh(tierGeometry(UPPER, noCorners), new THREE.MeshStandardMaterial({ color: 0x2a2535, roughness: 0.9 })));
  const dark = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(bandGeometry(lowerTop.o, lowerTop.y, lowerTop.y + 2.2, (k) => k === "corner", 10), dark(0x14121a))); // open corners
  scene.add(new THREE.Mesh(bandGeometry(UPPER.o, UPPER.y - 1.1, UPPER.y, noCorners, 10), dark(0x0f0d14)));                         // upper-deck lip
  scene.add(new THREE.Mesh(bandGeometry(upperTop.o, upperTop.y, upperTop.y + 3.5, noCorners, 10), dark(0x19161f)));               // back wall

  // field wall with a field-level LED strip; tunnels at the end-zone corners
  scene.add(new THREE.Mesh(bandGeometry(-0.02, 0, LOWER.y, null, 10), new THREE.MeshStandardMaterial({ color: 0x15121d, roughness: 0.8, side: THREE.DoubleSide })));
  const led = ribbonTexture("THE CLOSING LINE", 2048, 64, "#1a1050", "#ffffff");
  scene.add(new THREE.Mesh(bandGeometry(-0.05, 0.55, 1.25, null, 64), new THREE.MeshBasicMaterial({ map: led, color: new THREE.Color(1.0, 1.0, 1.0), side: THREE.DoubleSide })));
  const TUNNELS = [[-14, 1], [14, 1], [-14, -1], [14, -1]];
  const tunnelMat = new THREE.MeshStandardMaterial({ color: 0x050407, roughness: 1 });
  const portalMat = new THREE.MeshStandardMaterial({ color: PURPLE, roughness: 0.6 });
  for (const [x, s] of TUNNELS) {
    const g = new THREE.Group();
    const inner = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.2, 6), tunnelMat); inner.position.set(0, 1.6, s * 3.05);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.7, 0.5), portalMat); lintel.position.set(0, 3.55, s * 0.2);
    const side1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.9, 0.5), portalMat); side1.position.set(-2.85, 1.95, s * 0.2);
    const side2 = side1.clone(); side2.position.x = 2.85;
    g.add(inner, lintel, side1, side2);
    g.position.set(x, 0, FZ + s * BOWL.Z0); scene.add(g);
  }
  const inTunnel = (x, zRel, y) => y < 4.2 && TUNNELS.some(([tx, s]) => Math.abs(x - tx) < 3.3 && Math.sign(zRel) === s && Math.abs(zRel) > BOWL.Z0 - 1);

  // suite band: lit glass between the tiers
  const suiteTex = colorTex(canvas(512, 128, (g, w, h) => {
    g.fillStyle = "#0b0a12"; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) for (const [y0, y1] of [[12, 58], [70, 116]]) {
      const warm = Math.random() < 0.8;
      const gr = g.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, warm ? "#ffe2a8" : "#6b7a99"); gr.addColorStop(1, warm ? "#b8824a" : "#2b3246");
      g.fillStyle = gr; g.fillRect(x + 3, y0, 26, y1 - y0);
    }
  }));
  suiteTex.wrapS = THREE.RepeatWrapping;
  scene.add(new THREE.Mesh(bandGeometry(lowerTop.o + 0.3, lowerTop.y, lowerTop.y + SUITE_H, noCorners, 16), new THREE.MeshBasicMaterial({ map: suiteTex, color: new THREE.Color(1.15, 1.15, 1.15), side: THREE.DoubleSide })));
  // upper-deck fascia ribbon boards (generic text, scrolls)
  const ribbon = ribbonTexture("THE CLOSING LINE   3RD & 7   NFL · NBA · MLB · NHL · EPL", 4096, 96, "#140c3c", "#ffffff");
  scene.add(new THREE.Mesh(bandGeometry(UPPER.o - 0.05, UPPER.y - 2.3, UPPER.y - 1.1, noCorners, 90), new THREE.MeshBasicMaterial({ map: ribbon, color: new THREE.Color(1.6, 1.6, 1.6), side: THREE.DoubleSide })));

  // ---- crowd and empty seats (instanced), aisles every ~15 m
  const seatW = lite ? 1.05 : 0.62;
  const people = [], seats = [];
  const aisleAt = (seg, u) => {
    if (seg.kind === "corner") return Math.abs(u - 0.5) * seg.len < 0.7;
    const step = seg.len / Math.max(1, Math.round(seg.len / 15));
    const m = (u * seg.len) % step;
    return m < 0.7 || step - m < 0.7;
  };
  const place = (tier, filter, fill) => {
    const base = bowlSegments(tier.o);
    for (let r = 0; r < tier.rows; r++) {
      if (lite && r % 2) continue;
      const o = tier.o + r * tier.tread + tier.tread * 0.45, y = tier.y + r * tier.rise;
      bowlSegments(o).forEach((seg, si) => {
        if (filter && !filter(seg.kind)) return;
        const n = Math.floor(seg.len / seatW);
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n;
          if (aisleAt(base[si], u)) continue;
          const [x, z, nx, nz] = seg.f(u);
          if (inTunnel(x, z, y)) continue;
          (Math.random() < fill ? people : seats).push({ x, y, z: z + FZ, ry: Math.atan2(-nx, -nz) });
        }
      });
    }
  };
  place(LOWER, null, 0.93);
  place(UPPER, noCorners, 0.78);
  // aisle stairs
  const stairs = [];
  const addStairs = (tier, filter) => {
    bowlSegments(tier.o).forEach((seg, si) => {
      if (filter && !filter(seg.kind)) return;
      const us = [];
      if (seg.kind === "corner") us.push(0.5);
      else { const k = Math.max(1, Math.round(seg.len / 15)); for (let j = 0; j <= k; j++) us.push(j / k); }
      for (const u of us) for (let r = 0; r < tier.rows; r++) {
        const o = tier.o + (r + 0.5) * tier.tread, y = tier.y + r * tier.rise;
        const [x, z, nx, nz] = bowlSegments(o)[si].f(u);
        stairs.push(new THREE.BoxGeometry(1.2, 0.04, tier.tread * 0.96).rotateY(Math.atan2(nx, nz)).translate(x, y + 0.02, z + FZ));
      }
    });
  };
  addStairs(LOWER); addStairs(UPPER, noCorners);
  scene.add(new THREE.Mesh(mergeGeometries(stairs), new THREE.MeshStandardMaterial({ color: 0x57536a, roughness: 0.85 })));

  const personGeo = mergeGeometries([
    new THREE.BoxGeometry(0.42, 0.5, 0.26).translate(0, 0.62, -0.05),  // torso
    new THREE.BoxGeometry(0.2, 0.22, 0.2).translate(0, 1.0, -0.03),    // head
    new THREE.BoxGeometry(0.36, 0.16, 0.42).translate(0, 0.36, 0.14),  // lap
  ]);
  const crowd = new THREE.InstancedMesh(personGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), people.length);
  const palette = [0x3b2a92, 0x2a1d6e, 0x4b3aa8, 0x2a1d6e, 0x3b2a92, 0x111114, 0x1a1a1f, 0xdedede, 0xb8931f, 0x6c1f1f, 0x2d4b7a, 0x4a3a2a];
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  people.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.ry + (Math.random() - 0.5) * 0.4, 0);
    const s = 0.88 + Math.random() * 0.22, stand = Math.random() < 0.28 ? 1.25 : 1;
    dummy.scale.set(s, s * stand, s);
    dummy.updateMatrix();
    crowd.setMatrixAt(i, dummy.matrix);
    crowd.setColorAt(i, col.setHex(palette[(Math.random() * palette.length) | 0]).multiplyScalar(0.7 + Math.random() * 0.5));
  });
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  scene.add(crowd);
  const seatGeo = mergeGeometries([new THREE.BoxGeometry(0.46, 0.08, 0.42).translate(0, 0.42, 0.05), new THREE.BoxGeometry(0.46, 0.42, 0.06).translate(0, 0.62, -0.16)]);
  const seatMesh = new THREE.InstancedMesh(seatGeo, new THREE.MeshLambertMaterial({ color: 0x3d2c96 }), seats.length);
  seats.forEach((p, i) => { dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(0, p.ry, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); seatMesh.setMatrixAt(i, dummy.matrix); });
  seatMesh.instanceMatrix.needsUpdate = true;
  scene.add(seatMesh);

  // sideline team areas: benches, players and staff standing, painted team box
  const whiteLine = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  const bench = [], sideline = [];
  for (const sx of [-1, 1]) {
    const xb = sx * (FIELD_W / 2 + 4.6);
    for (let z = FZ - 16.5; z < FZ + 16.5; z += 4.2) {
      bench.push(new THREE.BoxGeometry(0.5, 0.45, 3.8).translate(xb, 0.23, z + 2));
      bench.push(new THREE.BoxGeometry(0.08, 0.45, 3.8).translate(xb + sx * 0.25, 0.68, z + 2));
    }
    for (const [w, d, x, z] of [[0.12, 36.6, sx * (FIELD_W / 2 + 1.83), FZ], [0.12, 36.6, sx * (FIELD_W / 2 + 5.5), FZ], [3.7, 0.12, sx * (FIELD_W / 2 + 3.67), FZ - 18.3], [3.7, 0.12, sx * (FIELD_W / 2 + 3.67), FZ + 18.3]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), whiteLine); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.005, z); scene.add(m);
    }
    for (let i = 0; i < (lite ? 30 : 60); i++) sideline.push({ x: sx * (FIELD_W / 2 + 2.6 + Math.random() * 2.2), z: FZ + (Math.random() - 0.5) * 34, ry: sx > 0 ? -Math.PI / 2 : Math.PI / 2, home: sx < 0 });
  }
  scene.add(new THREE.Mesh(mergeGeometries(bench), new THREE.MeshStandardMaterial({ color: 0x202028, roughness: 0.6 })));
  const standGeo = mergeGeometries([
    new THREE.BoxGeometry(0.5, 0.75, 0.3).translate(0, 1.3, 0), new THREE.BoxGeometry(0.42, 0.9, 0.26).translate(0, 0.45, 0),
    new THREE.SphereGeometry(0.15, 8, 6).translate(0, 1.82, 0),
  ]);
  const sidelineMesh = new THREE.InstancedMesh(standGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), sideline.length);
  sideline.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z); dummy.rotation.set(0, p.ry + (Math.random() - 0.5) * 1.2, 0); dummy.scale.setScalar(0.95 + Math.random() * 0.12); dummy.updateMatrix();
    sidelineMesh.setMatrixAt(i, dummy.matrix);
    sidelineMesh.setColorAt(i, col.setHex(p.home ? (Math.random() < 0.8 ? 0x2a1b72 : 0x151518) : (Math.random() < 0.8 ? 0xe6e6e6 : 0x333338)));
  });
  sidelineMesh.instanceMatrix.needsUpdate = true;
  if (sidelineMesh.instanceColor) sidelineMesh.instanceColor.needsUpdate = true;
  scene.add(sidelineMesh);

  // end-zone video boards on light trusses (generic score bug)
  const boardTex = colorTex(canvas(1536, 512, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, "#1c1258"); bg.addColorStop(1, "#07051a");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = "#ffffff"; g.font = `900 120px "Arial Black", Impact, Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("THE CLOSING LINE", w / 2, 150);
    g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(90, 290, w - 180, 150);
    g.font = `800 84px "Arial Black", Impact, Arial, sans-serif`;
    g.fillStyle = "#b9a6ff"; g.fillText("HOME 17", 330, 366); g.fillStyle = "#ffffff"; g.fillText("AWAY 14", 760, 366);
    g.fillStyle = GOLD_HEX; g.fillText("3RD & 7", 1190, 366);
  }));
  const trussMat = new THREE.MeshStandardMaterial({ color: 0xd8d8de, roughness: 0.5, metalness: 0.6 });
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const bw = 40, bh = 13.5, by = upperTop.y + 3 + bh / 2;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: boardTex, color: new THREE.Color(1.25, 1.25, 1.25) }));
    screen.position.set(0, by, 0);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(bw + 1.2, bh + 1.2, 1.6), new THREE.MeshStandardMaterial({ color: 0x0d0d12, roughness: 0.6 }));
    frame.position.set(0, by, -0.85);
    g.add(frame, screen);
    const truss = [];
    for (const x of [-bw / 2 + 3, bw / 2 - 3]) for (const dx of [-0.9, 0.9]) truss.push(new THREE.CylinderGeometry(0.18, 0.18, by, 8).translate(x + dx, by / 2 - bh / 2 + 1, -2));
    for (let y = 3; y < by - bh / 2; y += 3.2) for (const x of [-bw / 2 + 3, bw / 2 - 3]) truss.push(new THREE.CylinderGeometry(0.07, 0.07, 2.3, 6).rotateZ(0.9).translate(x, y, -2));
    g.add(new THREE.Mesh(mergeGeometries(truss), trussMat));
    g.position.set(0, 0, FZ + s * (BOWL.Z0 + upperTop.o + 1.2));
    g.rotation.y = s > 0 ? Math.PI : 0;
    scene.add(g);
  }

  // rooftop light-bank rows along both upper rims
  const bankTex = colorTex(canvas(256, 96, (g, w, h) => {
    g.fillStyle = "#101014"; g.fillRect(0, 0, w, h);
    for (let x = 12; x < w; x += 24) for (let y = 14; y < h; y += 24) {
      const gr = g.createRadialGradient(x, y, 0, x, y, 11); gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.5, "#fff3d6"); gr.addColorStop(1, "#554c3a");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill();
    }
  }));
  const bankMat = new THREE.MeshBasicMaterial({ map: bankTex, color: new THREE.Color(6, 5.8, 5.2), side: THREE.DoubleSide });
  const glowTex = colorTex(canvas(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,250,235,0.9)"); gr.addColorStop(0.3, "rgba(255,240,210,0.35)"); gr.addColorStop(1, "rgba(255,240,210,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }));
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false, color: 0xfff1d8 });
  const beams = [];
  const run = 2 * (BOWL.Z0 - BOWL.R0);
  for (const sx of [-1, 1]) {
    const x = sx * (BOWL.X0 + upperTop.o + 1.5), y = upperTop.y + 5.5;
    beams.push(new THREE.BoxGeometry(1.2, 1.2, run + 4).translate(x, y - 1.6, FZ));
    for (let i = 0; i < 16; i++) {
      const z = FZ - run / 2 + ((i + 0.5) * run) / 16;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.0), bankMat);
      panel.position.set(x, y, z); panel.lookAt(0, 0, z);
      scene.add(panel);
      if (!lite && i % 2 === 0) { const sp = new THREE.Sprite(glowMat); sp.position.set(x - sx * 0.8, y, z); sp.scale.set(9, 9, 1); scene.add(sp); }
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(beams), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6, metalness: 0.4 })));
  return { ribbon, led, counts: { people: people.length, seats: seats.length } };
}

function makeSky(scene) {
  const tex = colorTex(canvas(8, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#02040b"); gr.addColorStop(0.42, "#08102a"); gr.addColorStop(0.5, "#1b2244"); gr.addColorStop(0.53, "#3a3150"); gr.addColorStop(0.56, "#0c0f1c"); gr.addColorStop(1, "#050608");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })));
  const p = [];
  for (let i = 0; i < 700; i++) { const a = Math.random() * Math.PI * 2, e = 0.25 + Math.random() * 1.2; p.push(Math.cos(a) * Math.cos(e) * 850, Math.sin(e) * 850, Math.sin(a) * Math.cos(e) * 850); }
  const stars = new THREE.BufferGeometry();
  stars.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xaab4d8, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 })));
}

// ---------------------------------------------------------------- main
async function start() {
  const humanGltf = await loadHuman();
  const w0 = stage.clientWidth;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  const lite = w0 < 700 || !renderer.capabilities.isWebGL2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x151a2c, 0.0042);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 2000);

  // stadium lighting: key from the light rows (shadow on the QB), fill and rim
  scene.add(new THREE.HemisphereLight(0x9fb0ff, 0x183018, 0.32));
  const key = new THREE.DirectionalLight(0xfff4e2, 2.1);
  key.position.set(22, 34, 26); key.target.position.set(0, 1, -3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 20, far: 80 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xdfe6ff, 0.8); fill.position.set(-30, 26, -10); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xc7d2ff, 1.8); rim.position.set(-6, 22, -40); scene.add(rim);

  makeSky(scene);
  makeField(scene);
  const stadium = makeStadium(scene, lite);

  const qb = makePlayer({ num: "8", sleeveArm: "R" });
  scene.add(qb.root);
  const center = makePlayer({ num: "66", sleeveArm: "none", skin: 0x6b4630 });
  scene.add(center.root);
  // human bodies (if the model loaded): the code-built players become invisible IK drivers
  let qbH = null, centerH = null;
  if (humanGltf) {
    try {
      hideDriver(qb); hideDriver(center);
      qbH = makeHuman(humanGltf, qb, { num: "8", sleeveArm: "R", skin: 0x4a2e20, bulk: 1 });
      centerH = makeHuman(humanGltf, center, { num: "66", sleeveArm: "none", skin: 0x6b4630, bulk: 1.45 });
      scene.add(qbH.holder, centerH.holder);
      section.dataset.body = "human";
    } catch (err) {
      console.warn("human body unavailable, using the built figure:", err);
      qbH = centerH = null;
      [qb, center].forEach((D) => D.root.traverse((o) => { if (o.isMesh) o.visible = true; }));
    }
  }
  // ball offset so it sits in the human hand rather than the driver hand
  const handOffset = () => {
    if (!qbH) return V();
    const d = qbH.bones.handR.getWorldPosition(V()).sub(qb.arms.R.wr.getWorldPosition(V()));
    return d.applyQuaternion(qb.arms.R.hold.getWorldQuaternion(new THREE.Quaternion()).invert());
  };
  const pose = (P, H, key, look, p) => { applyPose(P, withSteps(sample(key, p)), look); if (H) retarget(H, P); };
  const { ball, geo: ballGeo } = makeFootball(lite);
  const BALL_IN_HAND = [0.25, -1.35, 0.1];
  qb.arms.R.hold.add(ball);
  ball.rotation.set(...BALL_IN_HAND);
  const ghosts = [];
  for (let k = 0; k < 5; k++) {
    const g = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0x5a2a12, transparent: true, opacity: 0.2 * (1 - k / 5), depthWrite: false }));
    g.visible = false; scene.add(g); ghosts.push(g);
  }

  // post-processing: bloom on the stadium lights, subtle vignette; skipped in lite mode
  let composer = null;
  if (!lite) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w0, stage.clientHeight), 0.55, 0.45, 1.35));
    const vig = new ShaderPass(VignetteShader); vig.uniforms.offset.value = 1.0; vig.uniforms.darkness.value = 1.15;
    composer.addPass(vig);
    composer.addPass(new OutputPass());
  }

  // release point and the ball's final spot just in front of the lens
  const lookTarget = V(0, 1.7, 30);
  pose(qb, qbH, QB, lookTarget, RELEASE);
  ball.position.copy(handOffset());
  const releasePos = ball.getWorldPosition(V());
  let endPos = V();
  const aimFlight = () => { const e = cameraAt(0.965); endPos = e.pos.clone().addScaledVector(e.look.clone().sub(e.pos).normalize(), 0.2).add(V(0, -0.02, 0)); };
  const flightAt = (t) => releasePos.clone().lerp(endPos, t).add(V(0, Math.sin(Math.PI * t) * 0.32, 0));

  let progress = Number.isFinite(forced) ? clamp(forced, 0, 1) : reduce ? 0.37 : 0;
  let released = false, dirty = true, visible = true;
  const flash = section.querySelector(".intro-flash");
  const copy = section.querySelector(".intro-copy");
  const clock = new THREE.Clock();

  function frame() {
    const p = progress, time = clock.getElapsedTime();
    pose(qb, qbH, QB, lookTarget, p);
    pose(center, centerH, CENTER, V(0, 1.2, 30), p);
    const cam = cameraAt(p);
    camera.position.copy(cam.pos); camera.lookAt(cam.look);
    if (p < RELEASE) {
      if (released) { qb.arms.R.hold.add(ball); ball.rotation.set(...BALL_IN_HAND); released = false; }
      ball.position.copy(handOffset());
      ghosts.forEach((g) => (g.visible = false));
    } else {
      if (!released) { scene.attach(ball); released = true; }
      const t = Math.pow(clamp((p - RELEASE) / (0.965 - RELEASE), 0, 1), 1.12);
      ball.position.copy(flightAt(t));
      ball.lookAt(camera.position); ball.rotateX(-0.72); ball.rotateZ(time * 9 + t * 60); // nose-first spiral, tilted so the shape reads
      ghosts.forEach((g, k) => {
        const tk = t - (k + 1) * 0.02;
        g.visible = tk > 0.02 && t < 0.985;
        if (g.visible) { g.position.copy(flightAt(tk)); g.quaternion.copy(ball.quaternion); g.scale.setScalar(0.97); }
      });
    }
    stadium.ribbon.offset.x = (time * 0.012) % 1;
    stadium.led.offset.x = (time * 0.02) % 1;
    if (flash) flash.style.opacity = String(clamp((p - 0.93) / 0.05, 0, 1));
    if (copy) copy.style.opacity = String(1 - clamp((p - 0.04) / 0.1, 0, 1));
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
    camera.aspect = w / h;
    NARROW = w / h < 0.9;
    aimFlight();
    camera.fov = w < 640 ? 56 : w / h < 1.2 ? 50 : 40;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  function onScroll() {
    if (reduce || Number.isFinite(forced)) return;
    const r = section.getBoundingClientRect();
    const total = section.offsetHeight - window.innerHeight;
    const np = clamp(-r.top / Math.max(total, 1), 0, 1);
    if (np !== progress) { progress = np; dirty = true; }
  }

  new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) dirty = true; }).observe(section);
  window.addEventListener("resize", resize);
  window.addEventListener("scroll", onScroll, { passive: true });
  resize(); onScroll();
  frame();
  section.classList.add("ready");
  section.dataset.crowd = String(stadium.counts.people);
  section.dataset.stats = [renderer.info.render.calls, renderer.info.render.triangles, lite ? "lite" : "full"].join(",");
  let last = 0;
  (function loop(now) {
    requestAnimationFrame(loop);
    if (!visible) return;
    const inFlight = progress > RELEASE && progress < 0.99;
    // render on scroll, while the ball is in flight, and a few times a second for the scrolling boards
    if (dirty || inFlight || now - last > 250) { frame(); dirty = false; last = now; }
  })(0);
}

try {
  if (!section || !stage) throw new Error("no intro section");
  const test = document.createElement("canvas");
  if (!(test.getContext("webgl2") || test.getContext("webgl"))) throw new Error("no WebGL");
  start().catch((e) => { console.warn("intro disabled:", e); if (section) section.remove(); });
} catch (e) {
  console.warn("intro disabled:", e);
  if (section) section.remove();
}
