/**
 * Real-time Schwarzschild black hole.
 *
 * Every pixel fires a photon and integrates its path through curved spacetime
 * (units: Schwarzschild radius rs = 1). The acceleration term
 *     a = -1.5 · h² · r̂ / r⁴
 * is the exact photon-orbit equation written in Cartesian coordinates, so the
 * shadow, the photon ring and the "wrapped over the top" accretion disk all
 * fall out of the physics instead of being painted on.
 */

const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCam;      // distance, pitch, yaw
uniform float uRoll;
uniform float uFov;
uniform float uDisk;     // disk brightness
uniform float uLens;     // 0 = flat space, 1 = general relativity
uniform float uExposure;
uniform float uSpin;     // accumulated disk rotation time
uniform vec2  uOffset;   // screen-space offset of the hole
uniform float uTemp;     // colour temperature shift
uniform float uStars;
uniform float uFade;     // to black
uniform float uFlash;    // to white
uniform float uDoppler;  // strength of relativistic beaming
uniform float uHaze;
uniform int   uSteps;

const float RIN  = 2.6;
const float ROUT = 13.0;

float hash13(vec3 p3){
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3){
  p3 = fract(p3 * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float noise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){
  float a = .5, s = 0.;
  for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; }
  return s;
}

vec3 blackbody(float t){
  vec3 c = vec3(0.55, 0.08, 0.02);
  c = mix(c, vec3(1.0, 0.36, 0.08), smoothstep(0.0, 0.25, t));
  c = mix(c, vec3(1.0, 0.66, 0.32), smoothstep(0.25, 0.55, t));
  c = mix(c, vec3(1.0, 0.92, 0.80), smoothstep(0.55, 0.90, t));
  c = mix(c, vec3(0.70, 0.82, 1.0), smoothstep(0.90, 1.50, t));
  return c;
}

vec3 starfield(vec3 d){
  vec3 col = vec3(0.);
  // galactic band
  float band = exp(-pow(dot(d, normalize(vec3(0.35, 1.0, -0.25))) * 2.6, 2.0));
  float n = fbm(d * 3.2);
  float dust = fbm(d * 7.0 + 11.0);
  col += band * smoothstep(0.3, 0.85, n) * vec3(0.42, 0.50, 0.75) * 0.32;
  col += band * smoothstep(0.45, 0.9, fbm(d * 1.6 + 4.0)) * vec3(0.62, 0.32, 0.45) * 0.14;
  col += band * band * vec3(0.9, 0.75, 0.6) * 0.05;
  col *= smoothstep(0.2, 0.62, dust);
  // faint all-sky glow so lensing distortion is always readable
  col += vec3(0.012, 0.014, 0.022) * fbm(d * 2.0 + 7.0);
  for (int L = 0; L < 4; L++){
    float sc = 55.0 + float(L) * 70.0;
    vec3 p = d * sc;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    vec3 h = hash33(id + float(L) * 17.13);
    float dd = length(f - (h - 0.5) * 0.7);
    float br = pow(h.x, 7.0 + float(L) * 5.0) * (L == 0 ? 5.0 : 2.2) * (1.0 + band * 1.5);
    br *= 0.75 + 0.25 * sin(uTime * (1.0 + h.z * 3.0) + h.y * 40.0);
    vec3 tint = mix(vec3(1.0, 0.78, 0.6), vec3(0.65, 0.78, 1.0), h.y);
    col += tint * br * exp(-dd * dd * 900.0);
  }
  return col;
}

vec4 disk(vec3 p, float pr, vec3 rd){
  float ang = atan(p.z, p.x);
  float omega = pow(pr, -1.5) * 3.2;
  float a = ang + uSpin * omega;
  vec2 cs = vec2(cos(a), sin(a));
  float n1 = fbm(vec3(pr * 2.6, cs * 1.4));
  float n2 = fbm(vec3(pr * 8.0, cs * 3.6) + 3.1);
  float n3 = noise(vec3(pr * 22.0, cs * 2.0));
  float dens = n1 * 0.85 + n2 * 0.55 + n3 * 0.15 - 0.35;
  dens = max(dens, 0.0) * 1.6;

  float x = (pr - RIN) / (ROUT - RIN);
  float profile = smoothstep(0.0, 0.05, x) * pow(1.0 - x, 2.2);
  float temp = pow(RIN / pr, 0.9);

  vec3 vdir = normalize(vec3(-p.z, 0.0, p.x));
  float v = min(sqrt(0.5 / pr), 0.7);
  float gam = inversesqrt(1.0 - v * v);
  float cosT = dot(vdir, -rd);
  float D = 1.0 / (gam * (1.0 - v * cosT));
  D = mix(1.0, D, uDoppler);
  float grav = sqrt(max(1.0 - 1.0 / pr, 0.0));
  float g = D * grav;
  float I = pow(g, 3.5);

  vec3 c = blackbody(temp * g * 0.85 + uTemp) * I * dens * profile * temp * 5.5;
  float al = clamp(dens * profile * 2.2, 0.0, 1.0);
  return vec4(c * uDisk, al * min(uDisk, 1.0));
}

vec3 aces(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 uv0 = uv;
  uv -= uOffset;
  float cr = cos(uRoll), sr = sin(uRoll);
  uv = mat2(cr, -sr, sr, cr) * uv;

  float dist = uCam.x, pitch = uCam.y, yaw = uCam.z;
  vec3 ro = dist * vec3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw));
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  float fl = 1.0 / tan(uFov * 0.5);
  vec3 rd = normalize(fw * fl + uv.x * rt + uv.y * up);

  vec3 pos = ro;
  vec3 vel = rd;
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.);
  vec3 glow = vec3(0.);
  float alpha = 0.;
  bool hit = false;

  for (int i = 0; i < 260; i++){
    if (i >= uSteps) break;
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    if (r < 1.0){ hit = true; break; }
    float dt = clamp(0.055 * r, 0.012, 2.5);
    vec3 acc = -1.5 * h2 * pos / (r2 * r2 * r) * uLens;
    vec3 prev = pos;
    vel += acc * dt;
    pos += vel * dt;

    // soft volumetric haze hugging the disk plane — acts as in-shader bloom
    float pr0 = length(pos.xz);
    float haze = exp(-abs(pos.y) * 2.2) * smoothstep(RIN * 0.7, RIN * 1.4, pr0) * exp(-(pr0 - RIN) * 0.28);
    glow += (1.0 - alpha) * haze * dt * blackbody(0.55 + uTemp) * 0.018 * uHaze * uDisk;
    // photon-sphere shimmer
    glow += (1.0 - alpha) * exp(-pow((r - 1.5) * 5.0, 2.0)) * dt * vec3(1.0, 0.75, 0.5) * 0.03 * uDisk * uLens;

    if (prev.y * pos.y < 0.0){
      float t = prev.y / (prev.y - pos.y);
      vec3 p = mix(prev, pos, t);
      float pr = length(p.xz);
      if (pr > RIN && pr < ROUT){
        vec4 d = disk(p, pr, normalize(vel));
        col += (1.0 - alpha) * d.rgb * d.a;
        alpha += (1.0 - alpha) * d.a;
        if (alpha > 0.985) break;
      }
    }
    if (r > 90.0 && dot(pos, vel) > 0.0) break;
  }

  vec3 bg = hit ? vec3(0.) : starfield(normalize(vel)) * uStars;
  col += (1.0 - alpha) * bg;
  col = col * uExposure + glow * uExposure;
  // linear HDR out — tone mapping, bloom and lens effects happen in post
  outColor = vec4(max(col, 0.0) * 1.15, 1.0);
}`;

export interface BHState {
  dist: number;
  pitch: number;
  yaw: number;
  roll: number;
  fov: number;
  disk: number;
  lens: number;
  exposure: number;
  temp: number;
  stars: number;
  fade: number;
  flash: number;
  doppler: number;
  haze: number;
  spinRate: number;
  offsetX: number;
  offsetY: number;
  bloom: number;
}

export const DEFAULT_STATE: BHState = {
  dist: 26,
  pitch: 0.12,
  yaw: 0,
  roll: -0.08,
  fov: 0.9,
  disk: 1,
  lens: 1,
  exposure: 1,
  temp: 0,
  stars: 1,
  fade: 0,
  flash: 0,
  doppler: 1,
  haze: 1,
  spinRate: 1,
  offsetX: 0,
  offsetY: 0,
  bloom: 1,
};

/* ── post-processing ────────────────────────────────────────────── */

const POST_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** Dual-filter downsample; the first pass also isolates the highlights. */
const DOWN_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uHalf;
uniform float uPrefilter;
uniform float uThreshold;
vec3 pre(vec3 c){
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.6;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * w;
}
void main(){
  vec3 s = texture(uSrc, vUv).rgb * 4.0;
  s += texture(uSrc, vUv - uHalf).rgb;
  s += texture(uSrc, vUv + uHalf).rgb;
  s += texture(uSrc, vUv + vec2(uHalf.x, -uHalf.y)).rgb;
  s += texture(uSrc, vUv - vec2(uHalf.x, -uHalf.y)).rgb;
  s /= 8.0;
  if (uPrefilter > 0.5) s = pre(s);
  o = vec4(min(s, vec3(60.0)), 1.0);
}`;

const UP_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uHalf;
void main(){
  vec2 h = uHalf;
  vec3 s = texture(uSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture(uSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture(uSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture(uSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture(uSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  o = vec4(s / 12.0, 1.0);
}`;

/** Horizontal-only blur → the anamorphic lens streak. */
const STREAK_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uStep;
void main(){
  vec3 s = vec3(0.0);
  float wsum = 0.0;
  for (int i = -7; i <= 7; i++){
    float x = float(i);
    float w = exp(-x * x / 22.0);
    s += texture(uSrc, vUv + vec2(x * uStep * uTexel.x, 0.0)).rgb * w;
    wsum += w;
  }
  o = vec4(s / wsum, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uStreak;
uniform vec2  uRes;
uniform float uTime;
uniform float uVel;      // scroll speed 0..1 → zoom blur, aberration
uniform float uScroll;   // parallax for the dust
uniform float uBloomStr;
uniform float uFade;
uniform float uFlash;
uniform float uDust;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), f.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), f.x), f.y); }

vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

vec3 sceneCA(vec2 uv, vec2 off){
  return vec3(texture(uScene, uv - off).r, texture(uScene, uv).g, texture(uScene, uv + off).b);
}

void main(){
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  vec2 ca = c * (0.004 + r2 * 0.012 + uVel * 0.018);

  vec3 col;
  if (uVel > 0.02){
    // radial zoom blur while you're moving fast through the scene
    col = vec3(0.0);
    for (int i = 0; i < 8; i++){
      float t = float(i) / 7.0;
      col += sceneCA(uv - c * t * uVel * 0.07, ca);
    }
    col /= 8.0;
  } else {
    col = sceneCA(uv, ca);
  }

  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 streak = texture(uStreak, uv).rgb;

  // procedural lens dirt — smudges that only show where bloom lights them
  float dirt = smoothstep(0.55, 0.95, vnoise(uv * vec2(5.0, 3.2) + 3.7)) * 0.9
             + smoothstep(0.7, 1.0, vnoise(uv * vec2(13.0, 9.0) + 11.0)) * 0.6;

  vec3 hdr = col + bloom * uBloomStr * (0.85 + dirt * 1.4) + streak * vec3(0.45, 0.62, 1.0) * 0.55 * uBloomStr;

  // floating dust in front of the lens, lit by the disk
  float lit = dot(bloom, vec3(0.3, 0.5, 0.2));
  float aspect = uRes.x / uRes.y;
  for (int l = 0; l < 2; l++){
    float sc = 7.0 + float(l) * 6.0;
    vec2 p = vec2(c.x * aspect, c.y) * sc + vec2(uTime * 0.015 * (1.0 + float(l)), uScroll * (0.9 + float(l) * 0.8));
    vec2 id = floor(p);
    vec2 f = fract(p) - 0.5;
    vec3 h = hash32(id + float(l) * 31.0);
    float d = length(f - (h.xy - 0.5) * 0.8);
    float rad = 0.015 + h.z * 0.035 + float(l) * 0.02;
    float m = smoothstep(rad, 0.0, d) * step(0.86, h.z);
    hdr += m * (0.015 + lit * 1.6) * vec3(1.0, 0.86, 0.7) * uDust;
  }

  vec3 outc = aces(hdr * 1.05);
  outc = pow(outc, vec3(0.93));
  // teal-shadow / amber-highlight grade
  float lum = dot(outc, vec3(0.2126, 0.7152, 0.0722));
  outc = mix(outc, outc * vec3(0.92, 1.0, 1.08), (1.0 - smoothstep(0.0, 0.35, lum)) * 0.35);
  outc = mix(outc, outc * vec3(1.06, 0.99, 0.9), smoothstep(0.45, 1.0, lum) * 0.4);
  outc += vec3(0.003, 0.004, 0.008);

  float vig = smoothstep(0.95, 0.18, length(c * vec2(aspect * 0.78, 1.0)));
  outc *= mix(0.5, 1.0, vig);

  outc += (hash12(gl_FragCoord.xy + fract(uTime * 7.3) * 391.0) - 0.5) * 0.04;

  outc = mix(outc, vec3(0.0), uFade);
  outc = mix(outc, vec3(1.0, 0.97, 0.92), uFlash);
  o = vec4(outc, 1.0);
}`;

/* ── renderer ───────────────────────────────────────────────────── */

export interface RendererOptions {
  /** fraction of CSS pixels to render (adaptive between min and max) */
  maxScale?: number;
  minScale?: number;
  steps?: number;
  adaptive?: boolean;
  dust?: boolean;
}

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

export class BlackHoleRenderer {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  state: BHState = { ...DEFAULT_STATE };
  /** per-frame camera FX fed by the page */
  fx = { vel: 0, scroll: 0 };
  ok = true;

  private progs: Record<"scene" | "down" | "up" | "streak" | "comp", { p: WebGLProgram; u: Uniforms }>;
  private vao: WebGLVertexArrayObject;
  private scale: number;
  private opts: Required<RendererOptions>;
  private spin = 0;
  private frameTimes: number[] = [];
  private lastAdapt = 0;
  private hdr: boolean;
  private scene!: Target;
  private levels: Target[] = [];
  private streakA!: Target;
  private streakB!: Target;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    this.canvas = canvas;
    this.opts = { maxScale: 0.8, minScale: 0.35, steps: 180, adaptive: true, dust: true, ...opts };
    this.scale = this.opts.maxScale;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
    if (!gl) {
      this.ok = false;
      throw new Error("WebGL2 not supported");
    }
    this.gl = gl;
    this.hdr = !!gl.getExtension("EXT_color_buffer_float");

    this.progs = {
      scene: this.program(VERT, FRAG, [
        "uRes", "uTime", "uCam", "uRoll", "uFov", "uDisk", "uLens", "uExposure", "uSpin", "uOffset",
        "uTemp", "uStars", "uDoppler", "uHaze", "uSteps",
      ]),
      down: this.program(POST_VERT, DOWN_FRAG, ["uSrc", "uHalf", "uPrefilter", "uThreshold"]),
      up: this.program(POST_VERT, UP_FRAG, ["uSrc", "uHalf"]),
      streak: this.program(POST_VERT, STREAK_FRAG, ["uSrc", "uTexel", "uStep"]),
      comp: this.program(POST_VERT, COMPOSITE_FRAG, [
        "uScene", "uBloom", "uStreak", "uRes", "uTime", "uVel", "uScroll", "uBloomStr", "uFade", "uFlash", "uDust",
      ]),
    };
    gl.useProgram(this.progs.comp.p);
    gl.uniform1i(this.progs.comp.u.uScene, 0);
    gl.uniform1i(this.progs.comp.u.uBloom, 1);
    gl.uniform1i(this.progs.comp.u.uStreak, 2);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.resize();
  }

  private program(vs: string, fs: string, names: string[]) {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    const u: Uniforms = {};
    for (const n of names) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  }

  private target(w: number, h: number, old?: Target): Target {
    const gl = this.gl;
    if (old) {
      gl.deleteTexture(old.tex);
      gl.deleteFramebuffer(old.fb);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(8, Math.round(r.width * this.scale));
    const h = Math.max(8, Math.round(r.height * this.scale));
    if (this.scene && this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.scene = this.target(w, h, this.scene);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const d = 2 ** (i + 1);
      this.levels[i] = this.target(Math.max(1, Math.floor(w / d)), Math.max(1, Math.floor(h / d)), this.levels[i]);
    }
    const s = this.levels[1];
    this.streakA = this.target(s.w, s.h, this.streakA);
    this.streakB = this.target(s.w, s.h, this.streakB);
  }

  private pass(t: Target | null, prog: { p: WebGLProgram }) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, t ? t.w : this.canvas.width, t ? t.h : this.canvas.height);
    gl.useProgram(prog.p);
  }

  private bindTex(unit: number, t: Target) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
  }

  render(time: number, dt: number) {
    const gl = this.gl;
    const s = this.state;
    this.spin += dt * s.spinRate;
    gl.bindVertexArray(this.vao);

    if (s.fade >= 0.999 && s.flash <= 0.001) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    /* 1 — ray-march the hole */
    const sc = this.progs.scene;
    this.pass(this.scene, sc);
    const u = sc.u;
    gl.uniform2f(u.uRes, this.scene.w, this.scene.h);
    gl.uniform1f(u.uTime, time);
    gl.uniform3f(u.uCam, Math.max(1.12, s.dist), s.pitch, s.yaw);
    gl.uniform1f(u.uRoll, s.roll);
    gl.uniform1f(u.uFov, s.fov);
    gl.uniform1f(u.uDisk, s.disk);
    gl.uniform1f(u.uLens, s.lens);
    gl.uniform1f(u.uExposure, s.exposure);
    gl.uniform1f(u.uSpin, this.spin);
    gl.uniform2f(u.uOffset, s.offsetX, s.offsetY);
    gl.uniform1f(u.uTemp, s.temp);
    gl.uniform1f(u.uStars, s.stars);
    gl.uniform1f(u.uDoppler, s.doppler);
    gl.uniform1f(u.uHaze, s.haze);
    gl.uniform1i(u.uSteps, this.opts.steps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* 2 — bloom: downsample chain (first pass thresholds) */
    const down = this.progs.down;
    let src = this.scene;
    for (let i = 0; i < this.levels.length; i++) {
      const dst = this.levels[i];
      this.pass(dst, down);
      this.bindTex(0, src);
      gl.uniform1i(down.u.uSrc, 0);
      gl.uniform2f(down.u.uHalf, 0.5 / src.w, 0.5 / src.h);
      gl.uniform1f(down.u.uPrefilter, i === 0 ? 1 : 0);
      gl.uniform1f(down.u.uThreshold, this.hdr ? 0.85 : 0.6);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = dst;
    }

    /* 3 — anamorphic streak from the quarter-res highlights */
    const st = this.progs.streak;
    const chain: [Target, Target, number][] = [
      [this.levels[1], this.streakA, 1.6],
      [this.streakA, this.streakB, 5],
      [this.streakB, this.streakA, 15],
    ];
    for (const [a, b, step] of chain) {
      this.pass(b, st);
      this.bindTex(0, a);
      gl.uniform1i(st.u.uSrc, 0);
      gl.uniform2f(st.u.uTexel, 1 / a.w, 1 / a.h);
      gl.uniform1f(st.u.uStep, step);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* 4 — upsample, accumulating every level into the half-res one */
    const up = this.progs.up;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.levels.length - 1; i > 0; i--) {
      const from = this.levels[i];
      this.pass(this.levels[i - 1], up);
      this.bindTex(0, from);
      gl.uniform1i(up.u.uSrc, 0);
      gl.uniform2f(up.u.uHalf, 0.5 / from.w, 0.5 / from.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    /* 5 — lens composite to screen */
    const cp = this.progs.comp;
    this.pass(null, cp);
    this.bindTex(0, this.scene);
    this.bindTex(1, this.levels[0]);
    this.bindTex(2, this.streakA);
    gl.uniform2f(cp.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(cp.u.uTime, time);
    gl.uniform1f(cp.u.uVel, this.fx.vel);
    gl.uniform1f(cp.u.uScroll, this.fx.scroll);
    gl.uniform1f(cp.u.uBloomStr, s.bloom * 0.46);
    gl.uniform1f(cp.u.uFade, s.fade);
    gl.uniform1f(cp.u.uFlash, s.flash);
    gl.uniform1f(cp.u.uDust, this.opts.dust ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (this.opts.adaptive) this.adapt(dt, time);
  }

  /** Keep the frame rate silky by trading resolution for time. */
  private adapt(dt: number, time: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 50) this.frameTimes.shift();
    if (time - this.lastAdapt < 1.5 || this.frameTimes.length < 40) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    let next = this.scale;
    if (p80 > 1 / 50) next = Math.max(this.opts.minScale, this.scale - 0.07);
    else if (p80 < 1 / 58) next = Math.min(this.opts.maxScale, this.scale + 0.035);
    if (Math.abs(next - this.scale) > 1e-3) {
      this.scale = next;
      this.resize();
      this.frameTimes = [];
    }
    this.lastAdapt = time;
  }
}
