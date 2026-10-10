import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import Lenis from "lenis";
import { BlackHoleRenderer, DEFAULT_STATE, type BHState } from "./gl/blackhole";
import { CollapseScene } from "./gl/collapse";
import { Drone } from "./audio";

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector(s) as T;
const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => Array.from(root.querySelectorAll(s)) as T[];
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const isMobile = window.matchMedia("(max-width: 768px)").matches;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ═════════════════════════ smooth scroll ═════════════════════════ */

const lenis = new Lenis({
  lerp: reduced ? 1 : 0.068,
  smoothWheel: !reduced,
  wheelMultiplier: 0.82,
  touchMultiplier: 1.35,
  syncTouch: true,
  syncTouchLerp: 0.085,
});
lenis.stop();
lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
window.scrollTo(0, 0);
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

/* ═════════════════════════ renderers ═════════════════════════ */

const bhCanvas = $<HTMLCanvasElement>("#bh-canvas");
let bh: BlackHoleRenderer | null = null;
try {
  bh = new BlackHoleRenderer(bhCanvas, {
    maxScale: isMobile ? 0.55 : Math.min(window.devicePixelRatio, 1) * 0.85,
    minScale: isMobile ? 0.3 : 0.4,
    steps: isMobile ? 140 : 190,
  });
} catch (e) {
  console.warn(e);
  bhCanvas.style.background =
    "radial-gradient(circle at 50% 50%, #000 9%, #ffb36b 10%, #ff6a3d 13%, rgba(80,20,10,0.4) 22%, #030304 45%)";
}

let collapse: CollapseScene | null = null;
try {
  collapse = new CollapseScene($<HTMLCanvasElement>("#collapse-canvas"), isMobile ? 26000 : 60000);
} catch (e) {
  console.warn(e);
}

const drone = new Drone();

/* ═════════════════════════ input ═════════════════════════ */

const mouse = { x: 0, y: 0, sx: 0, sy: 0, px: innerWidth / 2, py: innerHeight / 2 };
const hold = { v: 0 };
window.addEventListener("pointermove", (e) => {
  mouse.px = e.clientX;
  mouse.py = e.clientY;
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -((e.clientY / innerHeight) * 2 - 1);
  if (collapse) collapse.mouse.set(mouse.x, mouse.y);
});

const ringEl = $("#cursor-ring");
const dotEl = $("#cursor-dot");
const labelEl = $("#cursor-label");
const ringX = gsap.quickTo(ringEl, "x", { duration: 0.55, ease: "power3" });
const ringY = gsap.quickTo(ringEl, "y", { duration: 0.55, ease: "power3" });
const dotX = gsap.quickTo(dotEl, "x", { duration: 0.12, ease: "power3" });
const dotY = gsap.quickTo(dotEl, "y", { duration: 0.12, ease: "power3" });
window.addEventListener("pointermove", (e) => {
  ringX(e.clientX);
  ringY(e.clientY);
  dotX(e.clientX);
  dotY(e.clientY);
});
document.addEventListener("pointerover", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-cursor]");
  ringEl.classList.toggle("is-big", !!t);
  if (t) labelEl.textContent = t.dataset.cursor ?? "";
});

const interactive = "a,button,input,label,[data-cursor]";
window.addEventListener("pointerdown", (e) => {
  if ((e.target as HTMLElement).closest(interactive)) return;
  gsap.to(hold, { v: 1, duration: 2.4, ease: "power2.in", overwrite: true });
  ringEl.classList.add("is-hold");
});
const release = () => {
  gsap.to(hold, { v: 0, duration: 1.6, ease: "power3.out", overwrite: true });
  ringEl.classList.remove("is-hold");
};
window.addEventListener("pointerup", release);
window.addEventListener("pointercancel", release);

/* ═════════════════════════ camera keyframes ═════════════════════════ */

type Key = { st: ScrollTrigger; p: number; s: Partial<BHState> };
const keys: Key[] = [];
const K = (st: ScrollTrigger, p: number, s: Partial<BHState>) => keys.push({ st, p, s });
let resolved: { pos: number; s: BHState }[] = [];

function resolveKeys() {
  let acc: BHState = { ...DEFAULT_STATE };
  resolved = keys.map((k) => {
    acc = { ...acc, ...k.s };
    return { pos: k.st.start + (k.st.end - k.st.start) * k.p, s: acc };
  });
  resolved.sort((a, b) => a.pos - b.pos);
}

const target: BHState = { ...DEFAULT_STATE };
function sample(y: number) {
  if (!resolved.length) return;
  if (y <= resolved[0].pos) return Object.assign(target, resolved[0].s);
  const last = resolved[resolved.length - 1];
  if (y >= last.pos) return Object.assign(target, last.s);
  let i = 0;
  while (i < resolved.length - 1 && resolved[i + 1].pos <= y) i++;
  const a = resolved[i];
  const b = resolved[i + 1];
  const t = smooth(clamp((y - a.pos) / Math.max(1, b.pos - a.pos)));
  for (const k in a.s) {
    const key = k as keyof BHState;
    target[key] = lerp(a.s[key], b.s[key], t);
  }
}

/* ═════════════════════════ scenes (DOM order) ═════════════════════════ */

const intro = { dist: 60, exposure: 0, roll: 0.9 };
const pulse = { v: 0 };
const lensCtl = { mass: 1, weight: 0 };

const track = (trigger: string, start = "top bottom", end = "bottom top") =>
  ScrollTrigger.create({ trigger, start, end });

function buildScenes() {
  /* HERO ------------------------------------------------------------ */
  const hero = track("#hero", "top top", "bottom top");
  K(hero, 0, { dist: 24, pitch: 0.1, yaw: 0, roll: -0.14, fov: 0.95, offsetX: 0 });
  K(hero, 1, { dist: 17, pitch: 0.2, yaw: 0.3, roll: -0.05 });
  gsap.to(".hero-title", {
    yPercent: -22,
    scale: 1.12,
    opacity: 0,
    ease: "power1.in",
    scrollTrigger: { trigger: "#hero", start: "top top", end: "bottom top", scrub: 1.2 },
  });
  gsap.to([".hero-sub", ".hero-eyebrow", ".hero-cue"], {
    opacity: 0,
    y: -40,
    ease: "none",
    scrollTrigger: { trigger: "#hero", start: "top top", end: "60% top", scrub: 1.2 },
  });

  /* 01 PROLOGUE ----------------------------------------------------- */
  const prologueSplit = new SplitText(".prologue-text", { type: "words" });
  const prologue = ScrollTrigger.create({ trigger: "#prologue", start: "top top", end: "+=170%", pin: true });
  gsap.fromTo(
    prologueSplit.words,
    { opacity: 0.07, y: 14 },
    {
      opacity: 1,
      y: 0,
      stagger: 0.1,
      ease: "power1.out",
      scrollTrigger: { trigger: "#prologue", start: "top 60%", end: () => `+=${innerHeight * 1.6}`, scrub: 1.4 },
    },
  );
  K(prologue, 0, { dist: 19, pitch: 0.26, yaw: 0.45, offsetX: isMobile ? 0 : 0.42, offsetY: isMobile ? -0.3 : 0, exposure: 0.5 });
  K(prologue, 0.7, { dist: 17, pitch: 0.34, yaw: 0.8, offsetX: isMobile ? 0 : 0.5, exposure: 0.4 });
  K(prologue, 1, { dist: 34, exposure: 0, stars: 0.55, disk: 0.4, offsetX: 0, offsetY: 0 });

  /* 02 COLLAPSE ----------------------------------------------------- */
  const phases = $$(".collapse-phase");
  let phase = 0;
  const showPhase = (n: number) => {
    if (n === phase) return;
    gsap.to(phases[phase], { opacity: 0, y: -40, duration: 0.6, ease: "power2.in", overwrite: true });
    gsap.fromTo(phases[n], { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 1.3, delay: 0.3, ease: "expo.out", overwrite: true });
    phase = n;
  };
  const flash = $("#flash");
  const cRadius = $("#c-radius"), cTemp = $("#c-temp"), cEsc = $("#c-esc");
  const cRadiusBar = $("#c-radius-bar"), cTempBar = $("#c-temp-bar"), cEscBar = $("#c-esc-bar");
  const collapseCanvas = $("#collapse-canvas");
  let prevCollapse = 0;
  const collapseSt = ScrollTrigger.create({
    trigger: "#collapse",
    start: "top top",
    end: "+=420%",
    pin: true,
    onToggle: (self) => collapse && (collapse.active = self.isActive),
    onUpdate: (self) => {
      const p = self.progress;
      if (collapse) collapse.progress = p;
      if (self.direction > 0 && prevCollapse < 0.48 && p >= 0.48) {
        drone.supernova();
        gsap.fromTo(pulse, { v: 1.6 }, { v: 0, duration: 3, ease: "expo.out", overwrite: true });
      }
      prevCollapse = p;
      showPhase(p < 0.34 ? 0 : p < 0.49 ? 1 : p < 0.74 ? 2 : 3);
      flash.style.opacity = String(Math.max(0, 1 - Math.abs(p - 0.49) / 0.035) * 0.92);
      collapseCanvas.style.opacity = String(1 - smooth(clamp((p - 0.86) / 0.14)));
      const fall = clamp((p - 0.34) / 0.14);
      const radius = p < 0.34 ? 6000 : lerp(6000, 30, Math.pow(fall, 2));
      cRadius.textContent = `${Math.round(radius).toLocaleString()} km`;
      cRadiusBar.style.transform = `scaleX(${radius / 6000})`;
      const temp = 3e9 * Math.pow(10, fall * 2.2);
      const exp = Math.floor(Math.log10(temp));
      cTemp.textContent = `${(temp / Math.pow(10, exp)).toFixed(1)} × 10${toSup(exp)} K`;
      cTempBar.style.transform = `scaleX(${clamp((Math.log10(temp) - 9) / 2.4)})`;
      const esc = p < 0.34 ? 0.02 : Math.min(1, 0.02 + fall * fall * 1.05);
      cEsc.textContent = esc >= 1 ? "> c" : `${esc.toFixed(2)} c`;
      cEscBar.style.transform = `scaleX(${Math.min(1, esc)})`;
    },
  });
  K(collapseSt, 0, { exposure: 0, disk: 0.4, stars: 0.5, dist: 34, pitch: 0.5, yaw: 1.2 });
  K(collapseSt, 0.82, { exposure: 0, disk: 0.6, stars: 0.5, dist: 30 });
  K(collapseSt, 1, { exposure: 1, disk: 1, stars: 1, dist: 18, pitch: 0.5, yaw: 1.2 });

  /* 03 LENSING ------------------------------------------------------ */
  const lensing = ScrollTrigger.create({
    trigger: "#lensing",
    start: "top top",
    end: "+=200%",
    pin: true,
    onToggle: (self) => gsap.to(lensCtl, { weight: self.isActive ? 1 : 0, duration: 1.2 }),
  });
  const lensTl = gsap.timeline({ scrollTrigger: { trigger: "#lensing", start: "top 70%", end: "top top", scrub: 1 } });
  lensTl
    .from("#lensing .reveal-title .split-line > span", { yPercent: 110, stagger: 0.15, ease: "power3.out" }, 0)
    .from("#lensing .reveal", { opacity: 0, y: 50, filter: "blur(8px)", stagger: 0.12 }, 0.1);
  K(lensing, 0, { disk: 0.12, lens: 1, dist: 21, pitch: 0.05, yaw: 1.6, offsetX: isMobile ? 0 : 0.42, offsetY: isMobile ? 0.25 : 0, exposure: 1.3, stars: 2.6, roll: 0 });
  K(lensing, 1, { dist: 15, pitch: 0.12, yaw: 2.6, disk: 0.2 });

  const massInput = $<HTMLInputElement>("#mass");
  const setMass = () => {
    const m = Number(massInput.value) / 100;
    lensCtl.mass = m;
    massInput.style.setProperty("--fill", `${(m / 1.6) * 100}%`);
    $("#mass-readout").textContent = `${Math.round(m * 100)}%`;
    $("#lens-shadow").textContent = m < 0.01 ? "2.00 rₛ" : `${Math.max(2, 5.196 * Math.sqrt(m)).toFixed(2)} rₛ`;
    $("#lens-ring").textContent = m < 0.01 ? "—" : `${(1.5 * Math.min(1, m) + (m > 1 ? (m - 1) * 0.5 : 0)).toFixed(2)} rₛ`;
    $("#lens-defl").textContent = m < 0.01 ? "0°" : m < 0.4 ? `${Math.round(180 * m * 2)}°` : "∞";
  };
  massInput.addEventListener("input", setMass);
  setMass();

  /* 04 ACCRETION DISK — horizontal ---------------------------------- */
  const trackEl = $(".disk-track");
  const travel = () => Math.max(0, trackEl.scrollWidth - innerWidth + (isMobile ? 24 : innerWidth * 0.08));
  const diskIdx = $("#disk-idx");
  const diskTween = gsap.to(trackEl, {
    x: () => -travel(),
    ease: "none",
    scrollTrigger: {
      trigger: "#disk",
      start: "top top",
      end: () => `+=${travel() * 1.4}`,
      pin: true,
      scrub: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => (diskIdx.textContent = String(Math.min(5, Math.floor(self.progress * 5) + 1)).padStart(2, "0")),
    },
  });
  const diskSt = diskTween.scrollTrigger!;
  $$(".disk-card").forEach((card, i) => {
    gsap.from(card, {
      opacity: 0,
      rotateY: -25,
      z: -200,
      transformPerspective: 1200,
      ease: "power2.out",
      scrollTrigger: {
        trigger: card,
        containerAnimation: diskTween,
        start: "left 100%",
        end: "left 65%",
        scrub: true,
      },
    });
    const rx = gsap.quickTo(card, "rotateX", { duration: 0.6, ease: "power3" });
    const ry = gsap.quickTo(card, "rotateY", { duration: 0.6, ease: "power3" });
    gsap.set(card, { transformPerspective: 1000 });
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      rx(((e.clientY - r.top) / r.height - 0.5) * -10);
      ry(((e.clientX - r.left) / r.width - 0.5) * 12);
    });
    card.addEventListener("pointerleave", () => {
      rx(0);
      ry(0);
    });
    void i;
  });
  K(diskSt, 0, { disk: 1, lens: 1, dist: 14, stars: 1.2, pitch: 0.06, yaw: 2.6, offsetX: 0, offsetY: isMobile ? 0.12 : 0.06, exposure: 1, doppler: 1.5, temp: 0 });
  K(diskSt, 0.25, { dist: 12, pitch: 0.025, yaw: 2.9, doppler: 1.1 });
  K(diskSt, 0.48, { dist: 6.5, pitch: 0.16, yaw: 3.3, doppler: 1 });
  K(diskSt, 0.72, { dist: 9, pitch: 1.05, yaw: 3.6 });
  K(diskSt, 1, { dist: 15, pitch: 0.22, yaw: 4.1, temp: 0.38, disk: 1.7, exposure: 1.25 });

  /* 05 OBSERVATORY -------------------------------------------------- */
  const obs = track("#observatory");
  K(obs, 0.15, { dist: 20, pitch: 0.3, yaw: 4.4, exposure: 0.32, disk: 1, temp: 0, offsetY: 0, doppler: 1 });
  K(obs, 0.85, { dist: 16, pitch: 0.18, yaw: 4.9, exposure: 0.32 });

  /* 06 SPAGHETTIFICATION -------------------------------------------- */
  const spSplit = new SplitText(".spaghetti-word", { type: "chars" });
  const spTl = gsap.timeline({
    scrollTrigger: { trigger: "#spaghetti", start: "top top", end: "+=260%", pin: true, scrub: 1 },
  });
  const spSt = spTl.scrollTrigger!;
  spTl
    .from(spSplit.chars, { yPercent: 120, opacity: 0, stagger: 0.02, duration: 0.25, ease: "power3.out" }, 0)
    .from(".spaghetti-copy, #spaghetti .grid > div", { opacity: 0, y: 40, stagger: 0.05, duration: 0.2 }, 0.1)
    .to(
      spSplit.chars,
      {
        scaleY: (i: number) => 2.4 + ((i * 37) % 11) / 2.2,
        scaleX: 0.62,
        y: (i: number) => ((i * 53) % 7) * 14 + 40,
        transformOrigin: "50% 0%",
        color: "#ffb36b",
        stagger: { each: 0.015, from: "center" },
        duration: 0.6,
        ease: "power2.in",
      },
      0.35,
    )
    .to(".tide-body", { scaleY: 2.4, scaleX: 0.35, duration: 0.6, ease: "power2.in" }, 0.35)
    .to(".spaghetti-copy", { opacity: 0, y: 30, duration: 0.2 }, 0.42);
  const tideG = $("#tide-g");
  ScrollTrigger.create({
    trigger: "#spaghetti",
    start: () => spSt.start,
    end: () => spSt.end,
    onUpdate: (s) => {
      const g = Math.pow(10, clamp((s.progress - 0.35) / 0.6) * 9);
      tideG.textContent = g < 10 ? `${g.toFixed(1)} g` : `10${toSup(Math.floor(Math.log10(g)))} g`;
    },
  });
  K(spSt, 0, { dist: 13, pitch: 0.14, yaw: 5.2, exposure: 0.5, roll: 0, fov: 0.95, offsetY: -0.08 });
  K(spSt, 1, { dist: 6, pitch: 0.04, yaw: 5.6, exposure: 0.6, roll: 0.35, fov: 1.2, offsetY: 0 });

  /* 07 TIME --------------------------------------------------------- */
  const timeSt = ScrollTrigger.create({ trigger: "#time", start: "top top", end: "+=300%", pin: true });
  gsap.from("#time .chapter-title, #time svg", {
    opacity: 0,
    y: 60,
    scale: 0.94,
    stagger: 0.1,
    scrollTrigger: { trigger: "#time", start: "top 75%", end: "top 10%", scrub: 1 },
  });
  K(timeSt, 0, { dist: 10, pitch: 0.22, yaw: 6, exposure: 0.42, roll: -0.1, fov: 0.95 });
  K(timeSt, 1, { dist: 2.6, pitch: 0.06, yaw: 6.5, exposure: 0.5, roll: 0.15, fov: 1.35 });
  timeScene(timeSt);

  /* 08 SCALE -------------------------------------------------------- */
  const scaleSt = ScrollTrigger.create({ trigger: "#scale", start: "top top", end: "+=420%", pin: true });
  K(scaleSt, 0, { dist: 60, pitch: 0.3, yaw: 7, exposure: 0.08, stars: 0.7, roll: 0, fov: 0.9, disk: 0.2 });
  K(scaleSt, 1, { dist: 70, exposure: 0.08 });
  scaleScene(scaleSt);

  /* 09 POCKET ------------------------------------------------------- */
  const pocket = track("#pocket");
  K(pocket, 0.2, { dist: 30, pitch: 0.2, yaw: 7.6, exposure: 0.2, stars: 1, disk: 0.8 });
  K(pocket, 0.9, { dist: 20, pitch: 0.24, yaw: 8, exposure: 0.3 });

  /* 10 DIVE --------------------------------------------------------- */
  const lines = $$(".dive-line");
  let prevDive = 0;
  const diveTl = gsap.timeline({
    scrollTrigger: {
      trigger: "#dive",
      start: "top top",
      end: "+=520%",
      pin: true,
      scrub: 1,
      onToggle: (s) => document.body.style.setProperty("--lb", s.isActive ? (isMobile ? "6vh" : "10vh") : "0px"),
      onUpdate: (s) => {
        if (s.direction > 0 && prevDive < 0.765 && s.progress >= 0.765) {
          drone.horizon();
          gsap.fromTo(pulse, { v: 1.1 }, { v: 0, duration: 2.2, ease: "expo.out", overwrite: true });
        }
        prevDive = s.progress;
      },
    },
  });
  const diveSt = diveTl.scrollTrigger!;
  lines.forEach((l, i) => {
    const at = i * 0.19;
    diveTl.fromTo(l, { opacity: 0, scale: 1.08, filter: "blur(14px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.05 }, at + 0.01);
    if (i < lines.length - 1) diveTl.to(l, { opacity: 0, scale: 0.94, filter: "blur(10px)", duration: 0.04 }, at + 0.15);
  });
  diveTl.to({}, { duration: 0.05 }, 0.95);
  K(diveSt, 0, { dist: 12, pitch: 0.26, yaw: 8.4, exposure: 1, disk: 1.2, stars: 1, fov: 1, roll: 0, fade: 0, temp: 0, haze: 1 });
  K(diveSt, 0.3, { dist: 6, pitch: 0.13, yaw: 8.9, roll: 0.1 });
  K(diveSt, 0.58, { dist: 2.6, pitch: 0.06, yaw: 9.6, fov: 1.5, roll: 0.45, haze: 1.6, temp: 0.15, offsetY: -0.42 });
  K(diveSt, 0.74, { dist: 1.3, pitch: 0.03, yaw: 10.1, fov: 1.9, roll: 0.8, fade: 0, offsetY: -0.72 });
  K(diveSt, 0.8, { dist: 1.16, fade: 1, offsetY: -0.9 });
  K(diveSt, 1, { dist: 60, fade: 1, roll: 0, fov: 0.9, pitch: 0.3, disk: 0, haze: 1, offsetY: 0.18 });

  /* 11 HAWKING ------------------------------------------------------ */
  let prevHawk = 0;
  const hawkSt = ScrollTrigger.create({
    trigger: "#hawking",
    start: "top top",
    end: "+=260%",
    pin: true,
    onUpdate: (s) => {
      if (s.direction > 0 && prevHawk < 0.86 && s.progress >= 0.86) drone.light();
      prevHawk = s.progress;
    },
  });
  gsap.from(".hawking-in", {
    opacity: 0,
    y: 50,
    stagger: 0.15,
    scrollTrigger: { trigger: "#hawking", start: () => hawkSt.start, end: () => hawkSt.start + innerHeight * 0.8, scrub: 1 },
  });
  gsap.to(".hawking-in", {
    opacity: 0,
    scrollTrigger: { trigger: "#hawking", start: () => hawkSt.start + (hawkSt.end - hawkSt.start) * 0.72, end: () => hawkSt.end, scrub: 1 },
  });
  K(hawkSt, 0, { dist: 60, fade: 1, disk: 0, stars: 0.4, exposure: 1, flash: 0 });
  K(hawkSt, 0.25, { fade: 0.15, dist: 70 });
  K(hawkSt, 0.8, { fade: 0.25, dist: 110, stars: 0.2, flash: 0 });
  K(hawkSt, 1, { flash: 1, fade: 0 });
  hawkingScene(hawkSt);

  /* CODA ------------------------------------------------------------ */
  const coda = track("#coda", "top bottom", "bottom bottom");
  K(coda, 0, { flash: 1 });
  ScrollTrigger.create({
    trigger: "#coda",
    start: "top 60%",
    onToggle: (s) => document.body.classList.toggle("is-light", s.isActive),
  });
  gsap.from(".coda-in", {
    opacity: 0,
    y: 60,
    stagger: 0.12,
    scrollTrigger: { trigger: "#coda", start: "top 70%", end: "top 10%", scrub: 1 },
  });

  /* chapters HUD ---------------------------------------------------- */
  const hudChapter = $("#hud-chapter");
  const navItems = $$<HTMLAnchorElement>(".nav-item");
  $$("[data-chapter-section]").forEach((sec, i) => {
    const el = sec.parentElement?.classList.contains("pin-spacer") ? sec.parentElement : sec;
    ScrollTrigger.create({
      trigger: el,
      start: "top 55%",
      end: "bottom 55%",
      onToggle: (s) => {
        if (!s.isActive) return;
        if (started) drone.chapter();
        const label = navItems[i]?.querySelector(".eyebrow")?.textContent?.trim() ?? "";
        gsap.to(hudChapter, { duration: 0.9, scrambleText: { text: label.replace(/^(\d+)\s/, "$1 — "), chars: "01▪▫◦·", speed: 0.6 } });
        navItems.forEach((n, j) => {
          const on = j === i;
          (n.querySelector(".nav-line") as HTMLElement).style.width = on ? "2.5rem" : "1rem";
          (n.querySelector(".nav-line") as HTMLElement).style.background = on ? "#ffb36b" : "";
        });
      },
    });
  });
  navItems.forEach((n) =>
    n.addEventListener("click", (e) => {
      e.preventDefault();
      const sec = $(`#${n.dataset.chapter}`);
      lenis.scrollTo(sec, { duration: 2.4 });
    }),
  );
  $("[data-scrollto]").addEventListener("click", (e) => {
    e.preventDefault();
    lenis.scrollTo(0, { duration: 3 });
  });
  $("#restart").addEventListener("click", () => lenis.scrollTo(0, { duration: 5, easing: (t) => 1 - Math.pow(1 - t, 4) }));

  $$("[data-reveal]").forEach((el) => {
    SplitText.create(el, {
      type: "lines",
      mask: "lines",
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, {
          yPercent: 108,
          rotate: 2,
          duration: 1.6,
          stagger: 0.1,
          ease: "expo.out",
          scrollTrigger: { trigger: el, start: "top 88%", toggleActions: "play none none reverse" },
        }),
    });
  });
  $$("main p.eyebrow")
    .filter((e) => /^Chapter/.test(e.textContent ?? "") && !e.closest("astro-island") && !e.closest(".collapse-phase"))
    .forEach((e) => {
      const text = e.textContent ?? "";
      ScrollTrigger.create({
        trigger: e,
        start: "top 90%",
        onEnter: () => gsap.to(e, { duration: 1.4, scrambleText: { text, chars: "▪▫◦·01", revealDelay: 0.2, speed: 0.5 } }),
      });
    });

  ScrollTrigger.addEventListener("refresh", resolveKeys);
  ScrollTrigger.refresh();
  resolveKeys();
}

/* ═════════════════════════ scene helpers ═════════════════════════ */

function toSup(n: number) {
  const m: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };
  return String(n).split("").map((c) => m[c] ?? c).join("");
}

function timeScene(st: ScrollTrigger) {
  const els = {
    minE: $("#min-earth"), secE: $("#sec-earth"), minY: $("#min-you"), secY: $("#sec-you"),
    ringE: $("#ring-earth"), ringY: $("#ring-you"),
    elE: $("#elapsed-earth"), elY: $("#elapsed-you"),
    r: $("#time-r"), rate: $("#time-rate"), hour: $("#time-hour"),
  };
  let tE = 0, tY = 0, rate = 1;
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
  };
  const human = (hours: number) => {
    if (!isFinite(hours) || hours > 1e9) return "forever";
    if (hours < 48) return `${hours.toFixed(2)} h`;
    if (hours < 24 * 365) return `${(hours / 24).toFixed(1)} days`;
    const y = hours / (24 * 365);
    return y < 1000 ? `${y.toFixed(1)} yrs` : `${Math.round(y).toLocaleString()} yrs`;
  };
  gsap.ticker.add((_, dtMs) => {
    if (!st.isActive) return;
    const p = st.progress;
    const r = 1 + 9 * Math.pow(1 - p, 2.4) + 1e-9;
    rate = Math.sqrt(1 - 1 / r);
    const speed = 40;
    const dt = Math.min(0.1, dtMs / 1000);
    tE += dt * speed;
    tY += dt * speed * rate;
    const set = (el: HTMLElement, deg: number) => el.setAttribute("transform", `rotate(${deg} 100 100)`);
    set(els.secE, (tE % 60) * 6);
    set(els.minE, ((tE / 60) % 60) * 6);
    set(els.secY, (tY % 60) * 6);
    set(els.minY, ((tY / 60) % 60) * 6);
    els.ringE.setAttribute("stroke-dashoffset", "0");
    els.ringY.setAttribute("stroke-dashoffset", String(578 * (1 - rate)));
    els.elE.textContent = fmt(tE);
    els.elY.textContent = fmt(tY);
    els.r.textContent = `${r.toFixed(r < 1.01 ? 4 : 2)} rₛ`;
    els.rate.textContent = `${rate.toFixed(rate < 0.01 ? 5 : 3)}×`;
    els.hour.textContent = human(1 / Math.max(rate, 1e-12));
  });
}

function scaleScene(st: ScrollTrigger) {
  const objs = $$(".scale-obj").map((el) => ({
    el,
    rs: Number(el.dataset.rs),
    label: el.querySelector<HTMLElement>(".scale-label, .eyebrow"),
  }));
  const fov = $("#scale-fov");
  const stops = objs
    .map((o) => o.rs)
    .sort((a, b) => a - b)
    .map((rs) => Math.log10((2 * rs) / 0.32));
  const unit = (km: number) => {
    if (km < 1e-3) return `${(km * 1e5).toFixed(km < 1e-4 ? 1 : 0)} cm`;
    if (km < 1) return `${Math.round(km * 1000)} m`;
    if (km < 1e6) return `${Math.round(km).toLocaleString()} km`;
    const au = km / 1.496e8;
    if (au < 0.1) return `${(km / 1e6).toFixed(1)} million km`;
    if (au < 63000) return `${au < 10 ? au.toFixed(1) : Math.round(au).toLocaleString()} AU`;
    return `${(au / 63241).toFixed(2)} ly`;
  };
  let first = true;
  gsap.ticker.add(() => {
    if (!st.isActive && !first) return;
    first = false;
    const p = st.progress;
    const n = stops.length - 1;
    const f = clamp(p * 1.08 - 0.04) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const local = f - i;
    // hold on each object, then whip through the empty decades between
    const e = local < 0.35 ? 0 : local > 0.75 ? 1 : smooth((local - 0.35) / 0.4);
    const logView = lerp(stops[i], stops[i + 1], e);
    const view = Math.pow(10, logView);
    const vmin = Math.min(innerWidth, innerHeight);
    fov.textContent = unit(view);
    for (const o of objs) {
      const d = ((2 * o.rs) / view) * vmin;
      const show = clamp((d - 1) / 8) * (1 - clamp((d - vmin * 0.75) / (vmin * 0.9)));
      const size = Math.min(d, vmin * 4);
      o.el.style.width = `${size}px`;
      o.el.style.height = `${size}px`;
      o.el.style.transform = `translate(-50%, -50%)`;
      o.el.style.opacity = String(show);
      o.el.style.visibility = show < 0.01 ? "hidden" : "visible";
      if (o.label) o.label.style.opacity = String(clamp(1 - Math.abs(Math.log10(d / (vmin * 0.32))) * 1.6));
    }
  });
}

function hawkingScene(st: ScrollTrigger) {
  const c = $<HTMLCanvasElement>("#hawking-canvas");
  const ctx = c.getContext("2d")!;
  type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number };
  const ps: P[] = [];
  let w = 0, h = 0;
  const dpr = Math.min(devicePixelRatio, 2);
  const resize = () => {
    w = c.clientWidth;
    h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
  };
  resize();
  window.addEventListener("resize", resize);
  gsap.ticker.add((_, dtMs) => {
    if (!st.isActive) {
      if (ps.length) ps.length = 0, ctx.clearRect(0, 0, c.width, c.height);
      return;
    }
    const dt = Math.min(0.05, dtMs / 1000);
    const p = st.progress;
    const rate = lerp(30, 900, Math.pow(p, 2.2)) * dt;
    const cx = w / 2, cy = h * 0.34;
    for (let i = 0; i < rate; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = 6 + Math.random() * 4;
      const sp = 20 + Math.random() * 120 * (1 + p * 3);
      ps.push({ x: cx + Math.cos(a) * r0, y: cy + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 2 + Math.random() * 4, hue: Math.random() });
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i];
      const dx = q.x - mouse.px, dy = q.y - mouse.py;
      const d2 = dx * dx + dy * dy;
      if (d2 < 22000) {
        const f = (1 - d2 / 22000) * 900 * dt;
        const d = Math.sqrt(d2) + 0.001;
        q.vx += (dx / d) * f;
        q.vy += (dy / d) * f;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life += dt;
      const k = 1 - q.life / q.max;
      if (k <= 0) {
        ps.splice(i, 1);
        continue;
      }
      ctx.fillStyle = q.hue > 0.7 ? `rgba(160,200,255,${k * 0.8})` : `rgba(255,${190 + q.hue * 60},${140 + q.hue * 80},${k * 0.8})`;
      const s = 0.6 + k * 1.4;
      ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    }
    // the shrinking hole
    const R = lerp(9, 1, p);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 6);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.16, "rgba(255,200,150,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - R * 6, cy - R * 6, R * 12, R * 12);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
  });
}

/* ═════════════════════════ render loop ═════════════════════════ */

const diveDist = $("#dive-dist");
const tR = $("#t-r"), tTau = $("#t-tau"), tV = $("#t-v"), tPct = $("#t-pct"), tBar = $("#t-bar");
const cur: BHState = { ...DEFAULT_STATE };
if (import.meta.env.DEV) Object.assign(window, { __eh: { cur, target, keys, get resolved() { return resolved; } } });
let started = false;
let hudTick = 0;
let velS = 0;
const springV: Partial<Record<keyof BHState, number>> = {};
/** Unity-style SmoothDamp — a critically damped spring toward the target. */
function smoothDamp(key: keyof BHState, current: number, target: number, smoothTime: number, dt: number) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const v = springV[key] ?? 0;
  const temp = (v + omega * change) * dt;
  springV[key] = (v - omega * temp) * exp;
  return target + (change + temp) * exp;
}

gsap.ticker.add((time, dtMs) => {
  const dt = Math.min(0.05, dtMs / 1000);
  sample(lenis.scroll);

  mouse.sx += (mouse.x - mouse.sx) * 0.04;
  mouse.sy += (mouse.y - mouse.sy) * 0.04;

  const t = { ...target };
  t.roll += intro.roll;
  t.dist += Math.sin(time * 0.31) * 0.12 * t.dist * 0.04;
  t.yaw += time * 0.012 + mouse.sx * 0.22;
  t.pitch += mouse.sy * 0.08;
  t.offsetX += mouse.sx * 0.015;
  t.lens *= lerp(1, lensCtl.mass, lensCtl.weight);
  t.dist = t.dist * (1 - hold.v * 0.42) + intro.dist;
  t.fov += hold.v * 0.25;
  t.haze += hold.v * 0.8;
  t.exposure *= intro.exposure * (1 + hold.v * 0.25);
  t.spinRate = 1 + hold.v * 2.5;

  // critically-damped springs: no snapping, no overshoot, eases in *and* out
  for (const key in t) {
    const kk = key as keyof BHState;
    const st = kk === "fade" || kk === "flash" ? 0.2 : kk === "exposure" ? 0.45 : kk === "dist" ? 0.7 : 0.6;
    cur[kk] = smoothDamp(kk, cur[kk], t[kk], st, dt);
  }

  // scroll speed → motion blur, lens breathing, wind
  const vRaw = clamp(Math.abs(lenis.velocity) / 42);
  velS += (vRaw - velS) * (vRaw > velS ? 0.14 : 0.045);
  drone.setVelocity(started ? velS : 0);

  // handheld camera: shake rises near the horizon and on impacts
  const near = clamp((5.5 - cur.dist) / 4.5) * (1 - cur.fade);
  const shake = near * 0.55 + pulse.v + hold.v * 0.3;
  const n1 = Math.sin(time * 13.1) * 0.5 + Math.sin(time * 7.7 + 1.3) * 0.3 + Math.sin(time * 23.3 + 2) * 0.2;
  const n2 = Math.sin(time * 11.3 + 4) * 0.5 + Math.sin(time * 5.9 + 0.7) * 0.3 + Math.sin(time * 19.1) * 0.2;
  const n3 = Math.sin(time * 8.3 + 2.2) * 0.6 + Math.sin(time * 17.9 + 5) * 0.4;

  if (bh) {
    Object.assign(bh.state, cur);
    bh.state.yaw += n1 * 0.01 * shake;
    bh.state.pitch += n2 * 0.008 * shake;
    bh.state.roll += n3 * 0.018 * shake;
    bh.state.fov += velS * 0.1 + pulse.v * 0.06;
    bh.state.bloom = 1 + pulse.v * 0.8 + hold.v * 0.4;
    bh.fx.vel = velS * 0.9;
    bh.fx.scroll = lenis.scroll / innerHeight * 0.35;
    bh.render(time, dt);
  }
  collapse?.render(time);

  const proximity = clamp(1 - (cur.dist - 1) / 25) * (1 - cur.fade);
  drone.setIntensity(clamp(proximity + hold.v * 0.4));

  if (started && ++hudTick % 3 === 0) {
    if (cur.fade < 0.99) diveDist.textContent = `${Math.max(0, cur.dist - 1).toFixed(2)} rₛ`;
    const r = Math.max(1.0001, cur.dist);
    tR.textContent = r.toFixed(2);
    tTau.textContent = Math.sqrt(1 - 1 / r).toFixed(3);
    tV.textContent = Math.sqrt(1 / r).toFixed(3);
    const max = document.documentElement.scrollHeight - innerHeight;
    const pct = clamp(lenis.scroll / Math.max(1, max));
    tPct.textContent = String(Math.round(pct * 100)).padStart(3, "0");
    tBar.style.transform = `scaleY(${pct})`;
  }
});

/* ═════════════════════════ sound toggle ═════════════════════════ */

const soundBtn = $("#sound");
const bars = $$(".sound-bar");
let barsTl: gsap.core.Timeline | null = null;
soundBtn.addEventListener("click", () => {
  const on = drone.toggle();
  soundBtn.setAttribute("aria-pressed", String(on));
  gsap.to("#sound-label", { duration: 0.6, scrambleText: { text: on ? "Sound on" : "Sound off", chars: "lowerCase" } });
  barsTl?.kill();
  if (on) {
    barsTl = gsap.timeline({ repeat: -1 });
    bars.forEach((b, i) =>
      barsTl!.to(b, { scaleY: () => 0.3 + Math.random() * 0.7, duration: 0.35, repeat: 7, yoyo: true, ease: "sine.inOut" }, i * 0.08),
    );
  } else gsap.to(bars, { scaleY: 0.3, duration: 0.4 });
});

/* ═════════════════════════ resize ═════════════════════════ */

let rz = 0;
window.addEventListener("resize", () => {
  clearTimeout(rz);
  rz = window.setTimeout(() => {
    bh?.resize();
    collapse?.resize();
    ScrollTrigger.refresh();
  }, 150);
});

/* ═════════════════════════ preloader → intro ═════════════════════════ */

const countEl = $("#loader-count");
const arc = $("#loader-arc");
const load = { v: 0 };
const ready = Promise.all([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1700))]);

document.body.style.setProperty("--lb", "12vh");
buildScenes();
gsap.set(".hero-word", { yPercent: 115 });
gsap.set([".hero-eyebrow", ".hero-sub", ".hero-cue"], { opacity: 0, y: 24 });

gsap.to(load, {
  v: 88,
  duration: 1.6,
  ease: "power2.out",
  onUpdate: () => {
    countEl.textContent = String(Math.round(load.v)).padStart(3, "0");
    arc.setAttribute("stroke-dashoffset", String(289 * (1 - load.v / 100)));
  },
});

ready.then(() => {
  ScrollTrigger.refresh();
  resolveKeys();
  const tl = gsap.timeline();
  tl.to(load, {
    v: 100,
    duration: 0.6,
    ease: "power2.inOut",
    onUpdate: () => {
      countEl.textContent = String(Math.round(load.v)).padStart(3, "0");
      arc.setAttribute("stroke-dashoffset", String(289 * (1 - load.v / 100)));
    },
  })
    .to("#loader-label", { duration: 0.5, scrambleText: { text: "Horizon acquired", chars: "upperCase" } }, "<")
    .to("#loader > *", { opacity: 0, scale: 0.92, filter: "blur(8px)", duration: 0.8, stagger: 0.05, ease: "power3.in" }, "+=0.2")
    .to("#loader", { opacity: 0, duration: 1.2, ease: "power2.inOut" }, "-=0.3")
    .set("#loader", { display: "none" })
    .add(() => {
      started = true;
      document.body.style.setProperty("--lb", "0px");
    }, "-=1.2")
    .to(intro, { dist: 0, duration: 4.2, ease: "expo.out" }, "-=1.4")
    .to(intro, { exposure: 1, duration: 3, ease: "power2.out" }, "<")
    .to(intro, { roll: 0, duration: 5, ease: "expo.out" }, "<")
    .to(".hero-word", { yPercent: 0, duration: 1.8, stagger: 0.14, ease: "expo.out" }, "<0.6")
    .to([".hero-eyebrow", ".hero-sub", ".hero-cue"], { opacity: 1, y: 0, duration: 1.4, stagger: 0.12, ease: "expo.out" }, "<0.4")
    .to(["#hud", "#telemetry", "#chapter-nav"], { opacity: 1, duration: 1.2, stagger: 0.1 }, "<0.3")
    .add(() => lenis.start(), "<");
});
