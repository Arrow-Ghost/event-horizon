import * as React from "react";
import { Activity, Crosshair, Orbit, Radio, Satellite, Telescope } from "lucide-react";
import { ContainerScroll } from "@/components/ui/container-scroll-animation";
import { EHT_FRAG, mountShader } from "@/scripts/gl/shader-canvas";
import { cn } from "@/lib/utils";

const TARGETS = {
  m87: {
    name: "M87*",
    host: "Messier 87 · Virgo",
    date: "Imaged April 2019",
    mass: "6.5 × 10⁹ M☉",
    distance: "55 million ly",
    ring: "42 ± 3 µas",
    shadow: "~ 0.0038 ly",
    ringR: 0.23,
    angle: -1.9,
    blur: 0.055,
  },
  sgr: {
    name: "Sgr A*",
    host: "Milky Way core · Sagittarius",
    date: "Imaged May 2022",
    mass: "4.3 × 10⁶ M☉",
    distance: "26,000 ly",
    ring: "51.8 ± 2.3 µas",
    shadow: "~ 52 million km",
    ringR: 0.25,
    angle: 0.6,
    blur: 0.07,
  },
} as const;

type Key = keyof typeof TARGETS;

const STATIONS = ["ALMA", "APEX", "JCMT", "SMA", "LMT", "IRAM", "SPT", "SMT", "NOEMA", "KP"];

function ObservatoryConsole() {
  const [key, setKey] = React.useState<Key>("m87");
  const t = TARGETS[key];
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const u = React.useRef<Record<"uRing" | "uAngle" | "uBlur" | "uScan", number>>({ uRing: t.ringR, uAngle: t.angle, uBlur: t.blur, uScan: 0 });
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!canvasRef.current) return;
    return mountShader(canvasRef.current, EHT_FRAG, () => u.current, 0.75);
  }, []);

  // retarget + sweep animation
  React.useEffect(() => {
    const from = { ...u.current };
    const start = performance.now();
    let raf = 0;
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / 2200);
      const e = ease(k);
      u.current.uRing = from.uRing + (t.ringR - from.uRing) * e;
      u.current.uAngle = from.uAngle + (t.angle - from.uAngle) * e;
      u.current.uBlur = from.uBlur + (t.blur - from.uBlur) * e;
      u.current.uScan = e;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    u.current.uScan = 0;
    step();
    return () => cancelAnimationFrame(raf);
  }, [key]);

  React.useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 900);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl bg-[#060608] font-mono text-[11px] text-[#cfc6b8] md:flex-row">
      {/* image */}
      <div className="relative flex-1 border-b border-white/5 md:border-b-0 md:border-r">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-[46%] w-px -translate-x-1/2 -translate-y-1/2 bg-gradient-to-b from-transparent via-white/15 to-transparent" />
          <div className="absolute left-1/2 top-1/2 h-px w-[46%] -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          {["left-4 top-4 border-l border-t", "right-4 top-4 border-r border-t", "left-4 bottom-4 border-l border-b", "right-4 bottom-4 border-r border-b"].map((c) => (
            <span key={c} className={cn("absolute h-5 w-5 border-[#ffb36b]/60", c)} />
          ))}
          <div className="absolute left-6 top-6 flex items-center gap-2 text-[#ffb36b]">
            <Crosshair className="h-3.5 w-3.5" /> {t.name} · 230 GHz
          </div>
          <div className="absolute bottom-6 left-6 text-white/40">VLBI RECONSTRUCTION · {t.date.toUpperCase()}</div>
          <div className="absolute bottom-6 right-6 flex items-center gap-2 text-white/40">
            <span className="text-[#ffb36b]">{t.ring}</span>
            <span className="block h-px w-10 bg-white/40" />
          </div>
        </div>
      </div>

      {/* telemetry */}
      <div className="flex w-full flex-col gap-4 p-4 md:w-[38%] md:p-6">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 uppercase tracking-[0.2em] text-white/50">
            <Telescope className="h-3.5 w-3.5" /> Event Horizon Telescope
          </span>
          <span className="flex items-center gap-1.5 text-emerald-400/80">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> LIVE
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(TARGETS) as Key[]).map((k) => (
            <button
              key={k}
              data-cursor="target"
              onClick={() => setKey(k)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-all duration-500",
                k === key
                  ? "border-[#ffb36b]/60 bg-[#ffb36b]/10 text-[#ffd8ae]"
                  : "border-white/10 text-white/50 hover:border-white/30 hover:text-white/80",
              )}
            >
              <div className="text-sm">{TARGETS[k].name}</div>
              <div className="mt-0.5 text-[10px] opacity-60">{TARGETS[k].host}</div>
            </button>
          ))}
        </div>

        <dl className="hidden grid-cols-2 gap-x-4 gap-y-3 border-y border-white/5 py-4 md:grid">
          {[
            ["Mass", t.mass, Orbit],
            ["Distance", t.distance, Satellite],
            ["Ring diameter", t.ring, Radio],
            ["Shadow", t.shadow, Activity],
          ].map(([label, value, Icon]) => {
            const I = Icon as typeof Orbit;
            return (
              <div key={label as string}>
                <dt className="flex items-center gap-1.5 text-white/35">
                  <I className="h-3 w-3" /> {label as string}
                </dt>
                <dd className="mt-1 text-[13px] text-white/90">{value as string}</dd>
              </div>
            );
          })}
        </dl>

        <div className="hidden md:block">
          <div className="mb-2 uppercase tracking-[0.2em] text-white/35">Array · Earth-sized aperture</div>
          <div className="grid grid-cols-5 gap-1.5">
            {STATIONS.map((s, i) => {
              const on = (i * 7 + tick) % 11 !== 0;
              return (
                <div key={s} className="flex items-center gap-1.5 rounded border border-white/5 px-1.5 py-1">
                  <span className={cn("h-1 w-1 rounded-full transition-colors", on ? "bg-[#ffb36b]" : "bg-white/20")} />
                  <span className="text-[9px] text-white/60">{s}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-auto hidden overflow-hidden whitespace-nowrap text-white/30 md:block">
          <span className="inline-block animate-[marquee_18s_linear_infinite]">
            › correlating 3.5 PB of hydrogen-maser-timed data · 8 sites · 4 continents · baseline 10,700 km · resolution ≈ reading a newspaper in New York from a café in Paris ·
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ObservatorySection() {
  return (
    <div className="relative flex flex-col overflow-hidden">
      <ContainerScroll
        titleComponent={
          <>
            <p className="eyebrow mb-5 text-[#ffb36b]">Chapter 05 — The Image</p>
            <h2 className="font-display text-4xl leading-[0.95] text-[#ece6da] md:text-6xl">
              For a century, they were only math.
              <br />
              <span className="mt-2 inline-block text-5xl italic md:text-[6.5rem]">
                Then we <span className="text-gradient">saw one.</span>
              </span>
            </h2>
          </>
        }
      >
        <ObservatoryConsole />
      </ContainerScroll>
    </div>
  );
}
