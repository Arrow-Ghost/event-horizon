import * as THREE from "three";

/**
 * The death of a massive star, driven entirely on the GPU by one progress
 * uniform (0 → 1):
 *   0.00–0.34  red supergiant swelling, convective boiling
 *   0.34–0.48  core collapse — everything falls to a point
 *   0.48–0.72  supernova — a shock shell tears outwards
 *   0.72–1.00  fallback — debris spirals into a newborn accretion disk
 */

const vert = /* glsl */ `
uniform float uP;
uniform float uTime;
uniform float uPx;
uniform vec2  uMouse;
attribute vec4 aSeed;
attribute vec3 aDir;
varying vec3 vColor;
varying float vAlpha;

float ease(float x){ return x * x * (3.0 - 2.0 * x); }
float seg(float a, float b){ return clamp((uP - a) / (b - a), 0.0, 1.0); }

vec3 curl(vec3 p, float t){
  return vec3(sin(p.y * 3.1 + t) + sin(p.z * 2.3 - t * 0.7),
              sin(p.z * 2.7 + t * 0.9) + sin(p.x * 3.3 + t),
              sin(p.x * 2.9 - t) + sin(p.y * 2.1 + t * 1.1)) * 0.5;
}

void main(){
  float swell = ease(seg(0.0, 0.32));
  float fall  = seg(0.34, 0.48);
  float boom  = seg(0.48, 0.72);
  float settle= ease(seg(0.70, 1.0));

  // --- star body ---
  float R = mix(1.0, 1.55, swell);
  float rr = pow(aSeed.x, 0.45) * R;
  vec3 star = aDir * rr;
  star += curl(star * 2.2 + aSeed.yzw * 3.0, uTime * 0.6) * 0.06 * (0.4 + swell);

  // --- collapse (accelerating free fall) ---
  float f = fall * fall * fall;
  vec3 collapsed = mix(star, aDir * 0.025 * aSeed.y, f);

  // --- supernova shell ---
  // thin, filamentary blast wave with a few fast streamers
  float front = 1.0 - pow(1.0 - boom, 3.0);
  float shellR = (0.85 + aSeed.y * 0.35 + pow(aSeed.z, 6.0) * 1.4) * front * 3.6;
  vec3 fil = curl(aDir * 4.0 + aSeed.w * 2.0, uTime * 0.3);
  vec3 shell = aDir * shellR * (1.0 + 0.18 * fil.x) + fil * boom * 0.35;
  vec3 pos = boom > 0.0 ? mix(collapsed, shell, smoothstep(0.0, 0.06, boom)) : collapsed;

  // --- fallback disk ---
  float dr = 1.15 + pow(aSeed.x, 1.6) * 4.2;
  float ang = atan(aDir.z, aDir.x) + uTime * 1.6 / pow(dr, 1.5) + aSeed.w * 6.2831;
  vec3 diskP = vec3(cos(ang) * dr, (aSeed.z - 0.5) * 0.08 * dr, sin(ang) * dr);
  // a third of the debris escapes forever as nebula
  float escapes = step(0.68, aSeed.z);
  pos = mix(pos, mix(diskP, shell * 1.25, escapes), settle);

  pos.xy += uMouse * 0.15 * length(pos.xy) * 0.2;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  // --- colour story ---
  vec3 hot = vec3(1.0, 0.92, 0.75);
  vec3 giant = mix(vec3(1.0, 0.55, 0.22), vec3(1.0, 0.26, 0.10), aSeed.x);
  vec3 c = mix(mix(hot, vec3(1.0, 0.7, 0.35), aSeed.x), giant, swell);
  c = mix(c, vec3(1.0, 0.95, 0.9), smoothstep(0.7, 1.0, fall));
  vec3 nova = mix(vec3(0.55, 0.75, 1.0), mix(vec3(0.95, 0.35, 0.65), vec3(0.3, 0.85, 0.9), aSeed.y), smoothstep(0.05, 0.6, boom));
  c = mix(c, nova, smoothstep(0.0, 0.1, boom));
  vec3 diskC = mix(vec3(1.0, 0.85, 0.6), vec3(1.0, 0.38, 0.1), pow(aSeed.x, 0.7));
  c = mix(c, mix(diskC, nova * 0.6, escapes), settle);
  vColor = c;

  float size = mix(1.6, 3.0, aSeed.w);
  size *= 1.0 + fall * 1.5 - step(0.001, boom) * 0.35;
  vAlpha = mix(0.7, 1.2, aSeed.y) * mix(1.0, 0.42, step(0.001, boom) * (1.0 - settle));
  vAlpha *= 1.0 + (1.0 - swell) * 0.6 * (1.0 - rr);
  vAlpha *= mix(1.0, 0.45, escapes * settle);
  gl_PointSize = size * uPx * (7.0 / -mv.z);
}`;

const frag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  a = a * a;
  float k = a * vAlpha;
  gl_FragColor = vec4(vColor * k, min(1.0, k));
}`;

export class CollapseScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  material: THREE.ShaderMaterial;
  points: THREE.Points;
  progress = 0;
  mouse = new THREE.Vector2();
  private mouseS = new THREE.Vector2();
  private canvas: HTMLCanvasElement;
  active = false;

  constructor(canvas: HTMLCanvasElement, count = 60000) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0.6, 7);

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    const dir = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      dir[i * 3] = s * Math.cos(t);
      dir[i * 3 + 1] = u;
      dir[i * 3 + 2] = s * Math.sin(t);
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    geo.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);

    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      uniforms: {
        uP: { value: 0 },
        uTime: { value: 0 },
        uPx: { value: this.renderer.getPixelRatio() },
        uMouse: { value: this.mouseS },
      },
    });
    this.points = new THREE.Points(geo, this.material);
    this.scene.add(this.points);

    // soft photosphere / blast glow, billboarded
    const g = document.createElement("canvas");
    g.width = g.height = 256;
    const ctx = g.getContext("2d")!;
    const grd = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.18, "rgba(255,220,170,0.75)");
    grd.addColorStop(0.45, "rgba(255,130,60,0.22)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(g), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.scene.add(this.glow);
    this.resize();
  }

  private glow: THREE.Sprite;

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.fov = this.camera.aspect < 1 ? 62 : 45;
    this.camera.updateProjectionMatrix();
  }

  render(time: number) {
    if (!this.active) return;
    this.mouseS.lerp(this.mouse, 0.05);
    const p = this.progress;
    this.material.uniforms.uP.value = p;
    this.material.uniforms.uTime.value = time;
    // camera drifts around the star, then lifts to look down on the new disk
    const a = time * 0.05 + p * 1.4;
    const lift = THREE.MathUtils.smoothstep(p, 0.7, 1) * 2.4;
    const dist = 7 + THREE.MathUtils.smoothstep(p, 0.48, 0.72) * 4 - THREE.MathUtils.smoothstep(p, 0.75, 1) * 2.5;
    this.camera.position.set(Math.sin(a) * dist + this.mouseS.x * 0.6, 0.6 + lift + this.mouseS.y * 0.4, Math.cos(a) * dist);
    const side = this.camera.aspect > 1.2 ? -1.6 : 0;
    this.camera.lookAt(new THREE.Vector3(side, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), a));
    this.points.rotation.y = time * 0.03;

    const S = THREE.MathUtils.smoothstep;
    const swell = S(p, 0, 0.32);
    const fall = S(p, 0.34, 0.48);
    const boom = S(p, 0.48, 0.72);
    const settle = S(p, 0.72, 1);
    let size = THREE.MathUtils.lerp(4.2, 6, swell) * (1 - fall * 0.92);
    let op = 0.55 + fall * 0.45;
    if (p > 0.48) {
      size = 1.5 + boom * 12;
      op = (1 - boom) * 1.2;
    }
    if (p > 0.72) {
      size = 2.2;
      op = 0.35 * settle;
    }
    const m = this.glow.material as THREE.SpriteMaterial;
    m.opacity = op;
    m.color.setRGB(1, THREE.MathUtils.lerp(0.85, 0.55, swell) + boom * 0.3, THREE.MathUtils.lerp(0.7, 0.35, swell) + boom * 0.6);
    this.glow.scale.setScalar(size);
    this.renderer.render(this.scene, this.camera);
  }
}
