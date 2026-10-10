import * as React from "react";
import { BatteryFull, Compass, Gauge, Home, Orbit, Signal, Sparkles, Wifi } from "lucide-react";
import { PhoneScrollHero } from "@/components/ui/phone-scroll-hero";
import { BlackHoleRenderer, type BHState } from "@/scripts/gl/blackhole";
import { cn } from "@/lib/utils";

const PRESETS: Record<string, { label: string; sub: string; state: Partial<BHState>; stats: [string, string][] }> = {
  sgr: {
    label: "Sgr A*",
    sub: "Our galaxy's heart",
    state: { dist: 18, pitch: 0.16, temp: 0, disk: 0.9 },
    stats: [["Mass", "4.3M M☉"], ["Spin", "0.9"], ["Dist.", "26k ly"]],
  },
  m87: {
    label: "M87*",
    sub: "The first portrait",
    state: { dist: 14, pitch: 0.42, temp: -0.12, disk: 1.2 },
    stats: [["Mass", "6.5B M☉"], ["Jet", "5k ly"], ["Dist.", "55M ly"]],
  },
  ton: {
    label: "TON 618",
    sub: "A monster quasar",
    state: { dist: 11, pitch: 0.06, temp: 0.35, disk: 1.6 },
    stats: [["Mass", "40B M☉"], ["Lum.", "10⁴⁰ W"], ["Dist.", "18B ly"]],
  },
};

function PocketApp() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const bhRef = React.useRef<BlackHoleRenderer | null>(null);
  const [key, setKey] = React.useState<keyof typeof PRESETS>("sgr");
  const target = React.useRef<Partial<BHState>>(PRESETS.sgr.state);
  const [clock, setClock] = React.useState("9:41");

  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let bh: BlackHoleRenderer;
    try {
      bh = new BlackHoleRenderer(c, { maxScale: 1, minScale: 1, steps: 130, adaptive: false });
    } catch {
      return;
    }
    bhRef.current = bh;
    Object.assign(bh.state, { dist: 18, fov: 1.05, roll: 0, haze: 1.3 });
    let raf = 0;
    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(c);
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible) return;
      const s = bh.state as unknown as Record<string, number>;
      for (const [k, v] of Object.entries(target.current)) s[k] += ((v as number) - s[k]) * 0.04;
      bh.state.yaw += dt * 0.12;
      bh.resize();
      bh.render(now / 1000, dt);
    };
    raf = requestAnimationFrame(loop);
    const tid = setInterval(() => {
      const d = new Date();
      setClock(`${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      clearInterval(tid);
    };
  }, []);

  React.useEffect(() => {
    target.current = PRESETS[key].state;
  }, [key]);

  const p = PRESETS[key];

  return (
    <div className="relative flex h-full w-full flex-col bg-[#050507] font-sans text-[#ece6da]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/90" />

      <div className="relative z-[1] flex items-center justify-between px-5 pt-2.5 text-[9px] font-semibold">
        <span>{clock}</span>
        <span className="flex items-center gap-1">
          <Signal className="h-2.5 w-2.5" /> <Wifi className="h-2.5 w-2.5" /> <BatteryFull className="h-3 w-3" />
        </span>
      </div>

      <div className="relative z-[1] mt-5 px-4">
        <div className="flex items-center gap-1.5 text-[8px] uppercase tracking-[0.3em] text-[#ffb36b]">
          <Sparkles className="h-2.5 w-2.5" /> Horizon · live
        </div>
        <div className="mt-1 font-display text-[1.6rem] italic leading-none">{p.label}</div>
        <div className="text-[9px] text-white/55">{p.sub}</div>
      </div>

      <div className="relative z-[1] mt-auto space-y-2.5 px-3 pb-3">
        <div className="grid grid-cols-3 gap-1.5">
          {p.stats.map(([k, v]) => (
            <div key={k} className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 backdrop-blur-md">
              <div className="text-[7px] uppercase tracking-wider text-white/45">{k}</div>
              <div className="text-[10px] font-medium">{v}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-1 rounded-full border border-white/10 bg-white/[0.05] p-1 backdrop-blur-md">
          {Object.entries(PRESETS).map(([k, v]) => (
            <button
              key={k}
              data-cursor="tap"
              onClick={() => setKey(k as keyof typeof PRESETS)}
              className={cn(
                "flex-1 rounded-full py-1.5 text-[9px] font-medium transition-all duration-500",
                k === key ? "bg-[#ece6da] text-black" : "text-white/60",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-around pt-1 text-white/45">
          <Home className="h-3.5 w-3.5 text-[#ffb36b]" />
          <Compass className="h-3.5 w-3.5" />
          <Orbit className="h-3.5 w-3.5" />
          <Gauge className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}

export default function PocketSection() {
  return (
    <PhoneScrollHero
      className="md:h-[95rem]"
      overlap={24}
      tilt={26}
      titleComponent={
        <>
          <p className="eyebrow text-[#ffb36b]">Chapter 09 — Closer than you think</p>
          <h2 className="mt-4 font-display text-4xl text-[#ece6da] md:text-5xl">
            Twenty-six thousand light-years away,
            <br />
            <span className="mt-2 block text-6xl italic leading-[0.9] tracking-tight md:text-[7.5rem]">
              in your <span className="text-gradient">pocket</span>
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-md text-sm text-[#ece6da]/55">
            The same light-bending engine running this page, shrunk to a screen. Tap a target.
          </p>
        </>
      }
    >
      <PocketApp />
    </PhoneScrollHero>
  );
}
