/** Minimal fullscreen-fragment-shader canvas. Returns a disposer. */
export function mountShader(
  canvas: HTMLCanvasElement,
  frag: string,
  uniforms: () => Record<string, number | [number, number]>,
  scale = 1,
) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: false });
  if (!gl) return () => {};
  const vs = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos,0.,1.); }`;
  const compile = (t: number, s: string) => {
    const sh = gl.createShader(t)!;
    gl.shaderSource(sh, s);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  gl.useProgram(p);
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const locs = new Map<string, WebGLUniformLocation | null>();
  const L = (n: string) => {
    if (!locs.has(n)) locs.set(n, gl.getUniformLocation(p, n));
    return locs.get(n)!;
  };

  let raf = 0;
  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(canvas);
  const t0 = performance.now();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!visible) return;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2) * scale;
    const w = Math.max(2, Math.round(r.width * dpr));
    const h = Math.max(2, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(L("uRes"), w, h);
    gl.uniform1f(L("uTime"), (performance.now() - t0) / 1000);
    for (const [k, v] of Object.entries(uniforms())) {
      if (Array.isArray(v)) gl.uniform2f(L(k), v[0], v[1]);
      else gl.uniform1f(L(k), v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  loop();
  return () => {
    cancelAnimationFrame(raf);
    io.disconnect();
  };
}

/** Event Horizon Telescope style reconstruction: blurred, lopsided, inferno-mapped ring. */
export const EHT_FRAG = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes;
uniform float uTime;
uniform float uRing;     // ring radius
uniform float uAngle;    // brightest side
uniform float uBlur;
uniform float uScan;     // 0..1 reveal sweep

float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
vec3 inferno(float t){
  t = clamp(t, 0., 1.);
  vec3 a = vec3(0.0, 0.0, 0.02);
  vec3 b = vec3(0.35, 0.03, 0.03);
  vec3 c = vec3(0.85, 0.27, 0.04);
  vec3 d = vec3(1.0, 0.68, 0.18);
  vec3 e = vec3(1.0, 0.96, 0.78);
  if (t < .25) return mix(a, b, t / .25);
  if (t < .5)  return mix(b, c, (t - .25) / .25);
  if (t < .75) return mix(c, d, (t - .5) / .25);
  return mix(d, e, (t - .75) / .25);
}
void main(){
  vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float ring = exp(-pow((r - uRing) / uBlur, 2.0));
  float lop = 0.45 + 0.55 * pow(0.5 + 0.5 * cos(a - uAngle), 1.6);
  float knots = 0.8 + 0.35 * n(vec2(a * 3.0 + uTime * 0.15, r * 8.0));
  float v = ring * lop * knots;
  v += 0.08 * exp(-pow((r - uRing * 1.6) / (uBlur * 3.0), 2.0)) * n(uv * 6.0 + uTime * 0.05);
  v *= 0.92 + 0.08 * sin(uTime * 1.7);
  vec3 col = inferno(v * 1.15);
  float sweep = smoothstep(uScan - 0.02, uScan, (uv.x / (uRes.x / uRes.y)) + 0.5);
  col = mix(col, vec3(0.0), sweep);
  col += vec3(1.0, 0.5, 0.2) * 0.25 * exp(-abs((uv.x / (uRes.x / uRes.y)) + 0.5 - uScan) * 140.0) * step(uScan, 0.999);
  // grain
  col += (h(gl_FragCoord.xy + uTime) - .5) * 0.04;
  o = vec4(col, 1.0);
}`;
