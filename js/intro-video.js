/* Real-footage intro (preview): scroll scrubs a stock video of a quarterback's snap,
   drop-back and throw (Mixkit, free license, see assets/video/ATTRIBUTION.md), then a
   3D football spirals out of the release into the lens and a white flash hands over to
   the page. Scroll progress drives everything; nothing autoplays.

   Progress map (p = 0..1 through the tall #introv section):
     0.00-0.74  video time 0 -> end (snap, drop-back, set, close-up release)
     0.70-0.97  3D ball flies from the release point into the camera
     0.94-0.995 white flash (after the ball covers the screen)
   Fallbacks: reduced motion or a failed video -> still photo; no WebGL -> CSS zoom flash. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const section = document.getElementById("introv");
const stage = section && section.querySelector(".introv-stage");
const video = section && section.querySelector("video");
const still = section && section.querySelector(".introv-still");
// AI clip: a still of the release frame snaps on top of the video at the handoff, so the frame under
// the launching ball is always the right one (no dependence on how fast a phone seeks the video)
const hold = section && section.querySelector(".introv-hold");
const copy = section && section.querySelector(".introv-copy");
const flash = section && section.querySelector(".introv-flash");
const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const forced = parseFloat(new URLSearchParams(location.search).get("introP")); // test hook
// ?clip=ai swaps in the AI-generated clip (Wan 2.2) for comparison with the real footage
const AI = new URLSearchParams(location.search).get("clip") === "ai";
const BASE = AI ? "assets/video/qb-ai-" : "assets/video/qb-throw-";
// AI clip: stop on frame 70 (4.375 s at 16 fps), where his arm brings the ball forward and he is still in view;
// the 3D ball takes over from the real ball's spot in that frame (video pixels: centre 255,212, about 180 px wide of 832).
// measured on the release still at phone width: the blurred ball + fingers blob is centred near (271, 232)
// and about 156 x 175 px; the 3D ball starts a little larger (its oval is wider than tall) so it fully covers it
const AI_STOP = 70 / 16, AI_BALL = { u: 271 / 832, v: 232 / 480, w: 260 / 832 };
const BALL_ROLL = 0; // roll of the scanned ball about its long axis (tuned from screenshots)
const VIDEO_END = 0.74, BALL_START = AI ? 0.74 : 0.7, BALL_END = 0.97;
const FLASH_START = 0.94, FLASH_END = 0.995; // the ball fills the screen first, then the flash

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (t) => t * t * (3 - 2 * t);

function pickSource() {
  const small = Math.min(window.innerWidth, window.innerHeight * 16 / 9) < 900;
  const tier = small ? "480" : "720";
  const webm = video.canPlayType('video/webm; codecs="vp9"');
  return BASE + tier + (webm ? ".webm" : ".mp4");
}

// Where the quarterback is across the frame (fraction of the video width) at each edit time,
// read off contact sheets of the footage. On screens narrower than 16:9 the video is cropped
// (object-fit: cover), so the crop pans to keep him in view.
const SUBJECT_X = [[0, 0.54], [0.9, 0.46], [1.15, 0.29], [1.45, 0.2], [1.75, 0.25], [2.0, 0.3], [2.24, 0.32],
                   [2.26, 0.5], [2.9, 0.47], [3.3, 0.42], [3.67, 0.45]];
function subjectX(t) {
  // AI clip: keep the quarterback centred, then pan a little left near the release so the ball in his
  // hand is on screen on narrow (portrait) screens
  if (AI) return t < 3.4 ? 0.5 : 0.5 + (0.40 - 0.5) * clamp((t - 3.4) / (AI_STOP - 3.4), 0, 1);
  for (let i = 1; i < SUBJECT_X.length; i++) {
    const [t1, x1] = SUBJECT_X[i], [t0, x0] = SUBJECT_X[i - 1];
    if (t <= t1) return x0 + (x1 - x0) * clamp((t - t0) / Math.max(t1 - t0, 1e-6), 0, 1);
  }
  return SUBJECT_X[SUBJECT_X.length - 1][1];
}
function panFrac(t) {                                 // object-position x as a 0..1 fraction
  const W = stage.clientWidth, H = stage.clientHeight, vw = 16 / 9;
  if (W / H >= vw) return 0.5;                        // wide screens show the full width
  const v = (W / H) / vw;                             // visible share of the video's width
  const left = clamp(subjectX(t) - v / 2, 0, 1 - v);
  return left / (1 - v);
}
function panFor(t) { return (panFrac(t) * 100).toFixed(1) + "% 50%"; }

function showStill(why) {
  if (still) still.hidden = false;
  if (video) video.hidden = true;
  section.classList.add("introv-static");
  if (why) section.dataset.fallback = why;
}

// ---- 3D football for the finale (transparent canvas over the video) ----
// Same ball as the 3D intro (js/intro3d.js makeFootball): prolate lathe body, pebbled-leather
// normal map, four seams and a lace spine with cross stitches that follow the surface.
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function normalTex(size, drawHeight, strength, repeat) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  drawHeight(g, size);
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
function makeBall() {
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
  const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), 48, 0);
  geo.rotateX(Math.PI / 2); // long axis -> z (nose = +z)
  const leather = new THREE.MeshPhysicalMaterial({ color: 0x6a3316, roughness: 0.6, normalMap: pebble, normalScale: new THREE.Vector2(0.55, 0.55), clearcoat: 0.25, clearcoatRoughness: 0.5 });
  const ball = new THREE.Group();
  ball.add(new THREE.Mesh(geo, leather));
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
  return ball;
}

function startBall() {
  const test = document.createElement("canvas");
  if (!(test.getContext("webgl2") || test.getContext("webgl"))) return null;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = "introv-ball";
  renderer.domElement.setAttribute("aria-hidden", "true");
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
  camera.position.set(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a1a10, 1.4));
  const key = new THREE.DirectionalLight(0xfff2e0, 2.6);   // stadium light from upper left, like the footage
  key.position.set(-1.5, 2.5, 3);   // in front of the ball, upper left
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb8ff, 1.2);
  rim.position.set(2, 1, -2);
  scene.add(rim);
  const ball = makeBall();
  // Photo-scanned real football (Poly Haven, CC0) replaces the code-built ball once it loads.
  // Its long axis is x in the file: turn it to z (the nose axis used below) and scale to 0.284 m.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  new GLTFLoader().load("assets/ball/american_football.gltf", (g) => {
    const m = g.scene;
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    m.position.sub(c);
    const turn = new THREE.Group();
    turn.add(m);
    if (size.x >= size.y && size.x >= size.z) turn.rotation.y = -Math.PI / 2;   // x -> z
    else if (size.y >= size.z) turn.rotation.x = Math.PI / 2;                    // y -> z
    const holder = new THREE.Group();
    holder.add(turn);
    holder.scale.setScalar(0.284 / Math.max(size.x, size.y, size.z));
    holder.rotation.z = BALL_ROLL;                                             // laces toward the viewer's upper side
    m.traverse((o) => { if (o.isMesh) { o.material.envMapIntensity = 1; } });
    ball.clear();
    ball.add(holder);
  }, undefined, () => { /* keep the code-built ball if the model can't load */ });
  scene.add(ball);
  const size = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  size();
  window.addEventListener("resize", size);
  // The ball starts where it leaves the hand in the close-up (a fraction of the frame, ~6 m away)
  // and comes straight at the lens: depth shrinks exponentially (what perspective looks like),
  // while its screen position drifts from the hand to the centre of the frame.
  const origin = new THREE.Vector3(0, 0, 0);
  const easeOut = (x) => 1 - Math.pow(1 - x, 2);
  return {
    draw(p, t, shown) {
      let k = clamp((p - BALL_START) / (BALL_END - BALL_START), 0, 1);
      // AI clip: launch only when the release frame is really painted (phones seek slowly;
      // launching early put a second ball on screen while the real one was still in his hand)
      if (AI && !(hold && !hold.hidden && hold.complete && hold.naturalWidth)) k = 0;
      renderer.domElement.style.opacity = k > 0 ? "1" : "0";
      if (k <= 0) return;
      const W = stage.clientWidth, H = stage.clientHeight;
      const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const EFF = 0.22;                                      // ball's apparent width in metres at this tilt
      const depthFor = (px) => EFF * (H / 2) / (tanH * Math.max(px, 1));
      let sx0, sy0, d0;
      if (AI) {
        // where the real ball sits on screen (the video is object-fit: cover, centred)
        const vw = video.videoWidth || 832, vh = video.videoHeight || 480;
        const sc = Math.max(W / vw, H / vh), dw = vw * sc, dh = vh * sc;
        sx0 = ((W - dw) * panFrac(AI_STOP) + AI_BALL.u * dw) / W;   // same pan as the video
        sy0 = ((H - dh) / 2 + AI_BALL.v * dh) / H;
        d0 = depthFor(AI_BALL.w * dw);                       // start exactly the size of the real ball
      } else {
        sx0 = 0.30; sy0 = 0.26; d0 = 6;                      // release point in the real footage
      }
      const dEnd = 0.14;                                     // right in front of the lens: covers the screen
      const d = d0 * Math.pow(dEnd / d0, ease(k));           // perspective: size grows exponentially
      let sx, sy;
      if (AI) {
        // the ball may only move toward the centre by as much as it has grown, so it always
        // keeps covering the real ball still printed in the paused frame underneath
        const grow = Math.max(0, (d0 / d - 1)) * (EFF * (H / 2) / (tanH * d0)) / 2 * 0.6;
        const dx = (0.5 - sx0) * W, dy = (0.5 - sy0) * H, len = Math.hypot(dx, dy);
        const f = len > 0 ? Math.min(easeOut(k) * len, grow) / len : 0;
        sx = sx0 + (0.5 - sx0) * f; sy = sy0 + (0.5 - sy0) * f;
      } else {
        const drift = easeOut(k);
        sx = sx0 + (0.5 - sx0) * drift; sy = sy0 + (0.5 - sy0) * drift;
      }
      // closest point: the tilted nose (~0.12 m toward the lens) must stay in front of the camera;
      // at 0.14 m the ball is wider than the screen, so it covers the view without clipping open
      const dA = Math.max(d, 0.14);
      const halfH = tanH * dA;
      ball.position.set((sx - 0.5) * 2 * halfH * camera.aspect, (0.5 - sy) * 2 * halfH, -dA);
      ball.lookAt(origin);                 // nose points at the viewer
      // leaves the hand side-on (covering the real ball), then turns point-first within the first
      // quarter of the flight; a slight residual tilt and wobble keep it reading as a 3D spiral
      const turn = ease(clamp(k / 0.25, 0, 1));
      ball.rotateY(0.62 + (0.34 - 0.62) * turn + 0.04 * Math.sin(k * 40));
      ball.rotateX(0.03 * Math.cos(k * 40));
      ball.rotateZ(t * 0.02 + k * 60);     // fast spiral about the long axis (laces circle the tip)
      renderer.render(scene, camera);
    },
  };
}

function start() {
  section.classList.add("ready");
  if (AI) { video.poster = BASE + "poster.jpg"; if (still) still.src = BASE + "still.jpg"; if (hold) hold.src = BASE + "release.jpg"; }
  if (reduce) { showStill("reduced-motion"); return; }
  let ball = null;
  try { ball = startBall(); } catch (e) { ball = null; }

  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = pickSource();
  video.load();
  let ready = false, duration = 3.67, target = 0, lastSet = -1, seeking = false, seekAt = 0;
  video.addEventListener("loadeddata", () => { ready = true; duration = video.duration || duration; video.pause(); });
  video.addEventListener("seeked", () => { seeking = false; });
  // pan with the frame actually on screen (currentTime can lead the painted frame while seeking)
  let shownT = 0;
  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    const onFrame = (_now, meta) => { shownT = meta.mediaTime; video.requestVideoFrameCallback(onFrame); };
    video.requestVideoFrameCallback(onFrame);
  } else video.addEventListener("seeked", () => { shownT = video.currentTime; });
  video.addEventListener("error", () => showStill("video-error"));
  setTimeout(() => { if (!ready) showStill("slow-network"); }, 9000);

  let progress = Number.isFinite(forced) ? forced : 0;
  const onScroll = () => {
    if (Number.isFinite(forced)) return;
    const r = section.getBoundingClientRect();
    const total = section.offsetHeight - window.innerHeight;
    progress = clamp(-r.top / Math.max(total, 1), 0, 1);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  (function loop(now) {
    const p = progress;
    target = clamp(p / VIDEO_END, 0, 1) * (AI ? Math.min(AI_STOP, duration - 0.02) : Math.max(duration - 0.02, 0));
    if (seeking && (now || 0) - seekAt > 400) seeking = false; // a seek to the same frame fires no "seeked"
    if (ready && !seeking && Math.abs(target - lastSet) > 1 / 60) {
      seeking = true;
      seekAt = now || 0;
      lastSet = target;
      if (typeof video.fastSeek === "function" && Math.abs(target - video.currentTime) > 1) video.fastSeek(target);
      else video.currentTime = target;
    }
    if (ready) video.style.objectPosition = panFor(shownT);
    if (copy) copy.style.opacity = String(1 - clamp((p - 0.05) / 0.12, 0, 1));
    if (flash) flash.style.opacity = String(clamp((p - FLASH_START) / (FLASH_END - FLASH_START), 0, 1));
    if (AI && hold) {
      const on = p >= VIDEO_END - 0.004;                 // from the release frame on, show the still
      if (hold.hidden === on) hold.hidden = !on;
      if (on) hold.style.objectPosition = panFor(AI_STOP);
    }
    if (ball) ball.draw(p, now || 0, shownT);
    else if (stage) stage.style.transform = p > 0.8 ? "scale(" + (1 + (p - 0.8) * 1.5) + ")" : "";
    requestAnimationFrame(loop);
  })();
}

try {
  if (!section || !stage || !video) throw new Error("no intro section");
  start();
} catch (e) {
  if (section) showStill("error");
}
