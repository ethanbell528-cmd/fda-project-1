/* Real-footage intro (preview): scroll scrubs a stock video of a quarterback's snap,
   drop-back and throw (Mixkit, free license, see assets/video/ATTRIBUTION.md), then a
   3D football spirals out of the release into the lens and a white flash hands over to
   the page. Scroll progress drives everything; nothing autoplays.

   Progress map (p = 0..1 through the tall #introv section):
     0.00-0.74  video time 0 -> end (snap, drop-back, set, close-up release)
     0.70-0.97  3D ball flies from the release point into the camera
     0.90-0.98  white flash
   Fallbacks: reduced motion or a failed video -> still photo; no WebGL -> CSS zoom flash. */
import * as THREE from "three";

const section = document.getElementById("introv");
const stage = section && section.querySelector(".introv-stage");
const video = section && section.querySelector("video");
const still = section && section.querySelector(".introv-still");
const copy = section && section.querySelector(".introv-copy");
const flash = section && section.querySelector(".introv-flash");
const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const forced = parseFloat(new URLSearchParams(location.search).get("introP")); // test hook
const VIDEO_END = 0.74, BALL_START = 0.7, BALL_END = 0.97;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (t) => t * t * (3 - 2 * t);

function pickSource() {
  const small = Math.min(window.innerWidth, window.innerHeight * 16 / 9) < 900;
  const tier = small ? "480" : "720";
  const webm = video.canPlayType('video/webm; codecs="vp9"');
  return "assets/video/qb-throw-" + tier + (webm ? ".webm" : ".mp4");
}

// Where the quarterback is across the frame (fraction of the video width) at each edit time,
// read off contact sheets of the footage. On screens narrower than 16:9 the video is cropped
// (object-fit: cover), so the crop pans to keep him in view.
const SUBJECT_X = [[0, 0.54], [0.9, 0.46], [1.15, 0.29], [1.45, 0.2], [1.75, 0.25], [2.0, 0.3], [2.24, 0.32],
                   [2.26, 0.5], [2.9, 0.47], [3.3, 0.42], [3.67, 0.45]];
function subjectX(t) {
  for (let i = 1; i < SUBJECT_X.length; i++) {
    const [t1, x1] = SUBJECT_X[i], [t0, x0] = SUBJECT_X[i - 1];
    if (t <= t1) return x0 + (x1 - x0) * clamp((t - t0) / Math.max(t1 - t0, 1e-6), 0, 1);
  }
  return SUBJECT_X[SUBJECT_X.length - 1][1];
}
function panFor(t) {
  const W = stage.clientWidth, H = stage.clientHeight, vw = 16 / 9;
  if (W / H >= vw) return "50% 50%";                 // wide screens show the full width
  const v = (W / H) / vw;                             // visible share of the video's width
  const left = clamp(subjectX(t) - v / 2, 0, 1 - v);
  return (left / (1 - v) * 100).toFixed(1) + "% 50%";
}

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
    draw(p, t) {
      const k = clamp((p - BALL_START) / (BALL_END - BALL_START), 0, 1);
      renderer.domElement.style.opacity = k > 0 ? "1" : "0";
      if (k <= 0) return;
      const d = 6 * Math.pow(0.36 / 6, ease(k));
      const sx = 0.30 + (0.5 - 0.30) * easeOut(k), sy = 0.26 + (0.5 - 0.26) * easeOut(k);
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d;
      ball.position.set((sx - 0.5) * 2 * halfH * camera.aspect, (0.5 - sy) * 2 * halfH, -d);
      ball.lookAt(origin);                 // nose points at the viewer
      ball.rotateY(0.62);                  // tilt so the oblong shape reads
      ball.rotateZ(t * 0.012 + k * 30);    // spiral about the long axis
      renderer.render(scene, camera);
    },
  };
}

function start() {
  section.classList.add("ready");
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
    target = clamp(p / VIDEO_END, 0, 1) * Math.max(duration - 0.02, 0);
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
    if (flash) flash.style.opacity = String(clamp((p - 0.9) / 0.08, 0, 1));
    if (ball) ball.draw(p, now || 0);
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
