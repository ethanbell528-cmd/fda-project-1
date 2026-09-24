/* Report-page intro: a quarterback throws a spiral at the viewer as they scroll.
   Scroll progress through the tall #intro3d section drives the whole animation
   (wind-up, release, ball flying at the camera). Decorative only: the report below
   never depends on it. If WebGL or the three.js CDN is unavailable the section is removed. */
import * as THREE from "three";

const section = document.getElementById("intro3d");
const stage = section && section.querySelector(".intro-stage");
const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);
  scene.fog = new THREE.Fog(0x0b1220, 40, 120);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 300);
  camera.position.set(0, 2.0, 6.2);
  camera.lookAt(0, 1.75, -3);

  // ---- lights: stadium look ----
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1b3a1b, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(8, 16, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -10; key.shadow.camera.right = 10; key.shadow.camera.top = 10; key.shadow.camera.bottom = -10;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 1.0);
  rim.position.set(-10, 8, -20);
  scene.add(rim);

  // ---- field with yard lines ----
  const fieldTex = (() => {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 1024;
    const g = c.getContext("2d");
    for (let i = 0; i < 20; i++) { g.fillStyle = i % 2 ? "#2f7a34" : "#34853a"; g.fillRect(0, i * 51.2, 512, 51.2); }
    g.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i <= 20; i++) g.fillRect(0, i * 51.2 - 2, 512, 4);
    for (let i = 0; i < 100; i++) { g.fillRect(150, i * 10.24, 14, 2); g.fillRect(348, i * 10.24, 14, 2); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  })();
  const field = new THREE.Mesh(new THREE.PlaneGeometry(50, 110), new THREE.MeshStandardMaterial({ map: fieldTex, roughness: 0.95 }));
  field.rotation.x = -Math.PI / 2;
  field.position.z = -40;
  field.receiveShadow = true;
  scene.add(field);

  // stadium light banks: soft glowing sprites far down the field
  const glowTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,250,230,1)"); gr.addColorStop(0.25, "rgba(255,240,200,0.6)"); gr.addColorStop(1, "rgba(255,240,200,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false });
  [[-24, 20, -70], [24, 20, -70], [-30, 17, -30], [30, 17, -30]].forEach(([x, y, z]) => {
    for (let i = -1; i <= 1; i++) {
      const sp = new THREE.Sprite(glowMat);
      sp.position.set(x + i * 1.6, y, z);
      sp.scale.set(4, 4, 1);
      scene.add(sp);
    }
  });

  // ---- quarterback built from simple shapes ----
  const jersey = new THREE.Color(cssVar("--nfl", "#2a78d6"));
  const matJersey = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.6 });
  const matPants = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 });
  const matSkin = new THREE.MeshStandardMaterial({ color: 0x8d5a3b, roughness: 0.8 });
  const matHelmet = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.25, metalness: 0.3 });
  const matMask = new THREE.MeshStandardMaterial({ color: 0xdadada, roughness: 0.4, metalness: 0.6 });
  const matShoe = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });

  const qb = new THREE.Group();
  qb.position.set(0.25, 0, -1.6);
  qb.rotation.y = -0.35; // slightly turned, throwing arm toward camera side
  scene.add(qb);
  const shadowAll = (o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });

  const cap = (r, h, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 6, 12), mat);

  // legs
  const legL = cap(0.17, 0.95, matPants); legL.position.set(-0.2, 0.75, 0.05); legL.rotation.z = 0.06;
  const legR = cap(0.17, 0.95, matPants); legR.position.set(0.22, 0.75, -0.1); legR.rotation.z = -0.08;
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.42), matShoe); shoeL.position.set(-0.22, 0.07, 0.12);
  const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.42), matShoe); shoeR.position.set(0.26, 0.07, -0.03);
  qb.add(legL, legR, shoeL, shoeR);

  // torso with shoulder pads and a number on the chest
  const torso = cap(0.42, 0.75, matJersey); torso.position.set(0, 1.85, 0); torso.scale.set(1.15, 1, 0.8);
  const pads = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), matJersey);
  pads.position.set(0, 2.2, 0); pads.scale.set(1.25, 0.55, 0.85);
  const numTex = (() => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.font = "bold 170px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("12", 128, 138);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const number = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ map: numTex, transparent: true }));
  number.position.set(0, 1.9, 0.345);
  qb.add(torso, pads, number);

  // head + helmet + facemask
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.33, 24, 18), matHelmet);
  helmet.position.set(0, 2.72, 0); helmet.scale.set(1, 1.05, 1.1);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.72), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  stripe.position.set(0, 3.06, 0); stripe.rotation.x = 0.05;
  const mask = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.018, 6, 20, Math.PI), matMask);
    bar.position.set(0, 2.62 - i * 0.07, 0.2); bar.rotation.set(Math.PI / 2, 0, 0); bar.scale.set(1, 1, 0.7);
    mask.add(bar);
  }
  qb.add(helmet, stripe, mask);

  // non-throwing (left) arm points at the target, like a real throwing motion
  const armL = new THREE.Group(); armL.position.set(-0.55, 2.2, 0);
  const upL = cap(0.12, 0.45, matJersey); upL.position.y = -0.3;
  const foreL = cap(0.1, 0.42, matSkin); foreL.position.set(0, -0.78, 0.08);
  armL.add(upL, foreL);
  qb.add(armL);

  // throwing (right) arm: shoulder pivot -> elbow pivot -> hand holding the ball
  const shoulder = new THREE.Group(); shoulder.position.set(0.55, 2.2, 0);
  const upper = cap(0.12, 0.45, matJersey); upper.position.y = 0.32;
  const elbow = new THREE.Group(); elbow.position.y = 0.62;
  const fore = cap(0.1, 0.42, matSkin); fore.position.y = 0.3;
  const hand = new THREE.Group(); hand.position.y = 0.6;
  elbow.add(fore, hand); shoulder.add(upper, elbow);
  qb.add(shoulder);
  shadowAll(qb);

  // ---- the football: prolate spheroid with laces ----
  const ball = new THREE.Group();
  const leather = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 20), new THREE.MeshStandardMaterial({ color: 0x6b3a1f, roughness: 0.55 }));
  leather.scale.set(1, 1, 1.75);
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.2), white); seam.position.set(0, 0.148, 0);
  ball.add(leather, seam);
  for (let i = -3; i <= 3; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.008, 0.012), white); l.position.set(0, 0.15, i * 0.028); ball.add(l); }
  ball.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  hand.add(ball);
  ball.position.set(0, 0.05, 0.05);
  ball.rotation.set(Math.PI / 2, 0, 0);

  // ---- animation driven by scroll progress ----
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const forced = parseFloat(new URLSearchParams(location.search).get("introP")); // test hook: freeze at a scroll point
  let progress = Number.isFinite(forced) ? forced : reduce ? 0.42 : 0;
  let released = false;
  const releaseAt = 0.38;
  const worldBall = new THREE.Vector3();
  let releasePos = null;
  const flash = section.querySelector(".intro-flash");
  const copy = section.querySelector(".intro-copy");

  function pose(p) {
    // wind-up 0..0.28: arm cocks back; 0.28..releaseAt: forward whip
    const wind = ease(clamp(p / 0.28, 0, 1));
    const whip = ease(clamp((p - 0.28) / (releaseAt - 0.28), 0, 1));
    shoulder.rotation.x = lerp(lerp(0.2, 1.15, wind), -1.1, whip); // back, then over the top
    shoulder.rotation.z = lerp(-0.25, -0.45, wind) + whip * 0.35;
    elbow.rotation.x = lerp(lerp(-0.4, -1.5, wind), -0.1, whip);
    armL.rotation.x = lerp(0, -1.3, wind) + whip * 0.9;
    qb.rotation.y = lerp(-0.35, -0.75, wind) + whip * 0.75;
    torso.rotation.y = whip * 0.2;
    legR.rotation.x = lerp(0, 0.25, whip);
  }

  function frame(time) {
    const p = progress;
    pose(p);
    if (p < releaseAt) {
      if (released) { hand.add(ball); ball.position.set(0, 0.05, 0.05); ball.rotation.set(Math.PI / 2, 0, 0); ball.scale.setScalar(1); released = false; }
      ball.rotation.z = 0;
    } else {
      if (!released) {
        ball.getWorldPosition(worldBall);
        releasePos = worldBall.clone();
        scene.attach(ball);
        released = true;
      }
      // flight from the release point to just in front of the camera, with a gentle arc
      const t = ease(clamp((p - releaseAt) / (0.97 - releaseAt), 0, 1));
      const end = new THREE.Vector3(camera.position.x, camera.position.y - 0.05, camera.position.z - 0.35);
      ball.position.set(lerp(releasePos.x, end.x, t), lerp(releasePos.y, end.y, t) + Math.sin(t * Math.PI) * 1.1, lerp(releasePos.z, end.z, t));
      ball.lookAt(camera.position);          // nose points at the viewer
      ball.rotateY(0.85);                    // tilt so the football shape shows
      ball.rotateZ(time * 0.012 + t * 40);   // spiral about its long axis
    }
    // ball fills the screen at the end: white flash, then the report takes over
    if (flash) flash.style.opacity = String(clamp((p - 0.9) / 0.08, 0, 1));
    if (copy) copy.style.opacity = String(1 - clamp((p - 0.12) / 0.15, 0, 1));
    renderer.render(scene, camera);
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 640 ? 58 : 45;
    camera.updateProjectionMatrix();
  }
  function onScroll() {
    if (reduce || Number.isFinite(forced)) return;
    const r = section.getBoundingClientRect();
    const total = section.offsetHeight - window.innerHeight;
    progress = clamp(-r.top / Math.max(total, 1), 0, 1);
  }

  let visible = true;
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(section);
  window.addEventListener("resize", resize);
  window.addEventListener("scroll", onScroll, { passive: true });
  resize(); onScroll();
  (function loop(t) {
    if (visible) frame(t || 0);
    requestAnimationFrame(loop);
  })();
  section.classList.add("ready");
}

try {
  if (!section || !stage) throw new Error("no intro section");
  const test = document.createElement("canvas");
  if (!(test.getContext("webgl2") || test.getContext("webgl"))) throw new Error("no WebGL");
  start();
} catch (e) {
  if (section) section.remove();
}
