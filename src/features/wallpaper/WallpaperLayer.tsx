/**
 * 壁纸层（wallpaper 域，2026-10-05；11-02 大改版）。
 *
 * ⛔ 铁律：
 *   ① pointer-events: none + z-index: -1 —— 纯视觉层，永不挡交互；
 *   ② 新壁纸全部是**主题色 + CSS 动效**（无第三方引擎、无 canvas 逐帧）；
 *   ③ 减动效偏好下只停动画/不挂鼠标监听（保留一层静态柔光，不突然变纯黑）。
 *
 * 11-02 用户判「动态壁纸太失望 / 普通壁纸也丑 / 旧的那种线条都还在」⇒ 三类旧壁纸
 * （图案瓷砖 / 粒子连线 / 星空点阵）**整组移除**；只剩：
 *   aurora 极光流带 · ribbon 流光丝带 · halo 呼吸光晕 · custom 静态壁纸（6 款主题色）。
 */
import { useEffect, useRef, useState } from "react";
import { localImageUrl } from "../../lib/image-src.mjs";
import { isPresetImage, presetById, readWallpaper, saveWallpaper, subscribeWallpaper } from "../../lib/wallpaper.mjs";

type WallpaperConfig = { mode: string; image: string };

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 动态光幕（11-02 用户：「多做几套新的，主题色」）：极光流带 / 流光丝带 / 呼吸光晕。
 *  ⛔ 纯 CSS 动效（大块柔光 + blur + GPU transform），不引第三方引擎：比 canvas 逐帧重绘便宜，
 *    也比 tsparticles 安静 —— 这三档要的是氛围，不是粒子。
 *  ⛔ 颜色一律主题 token（color-mix + var(--accent/--ic-*)）⇒ 白天/黑夜/曜石自动换色。 */
function MotionVeil({ variant }: { variant: "aurora" | "ribbon" | "halo" }) {
  const ref = useRef<HTMLDivElement>(null);
  /* 鼠标视差（用户 11-02：「动态壁纸要加上鼠标动态交互效果」）：指针位置缓动追随，
     每团光按 --wp-depth 不同的位移量 ⇒ 有纵深；减动效偏好下不挂监听、不动。 */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    let targetX = 0, targetY = 0, curX = 0, curY = 0, raf = 0;
    const onMove = (event: MouseEvent) => {
      targetX = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      targetY = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    };
    const tick = () => {
      curX += (targetX - curX) * 0.06;
      curY += (targetY - curY) * 0.06;
      el.style.setProperty("--wp-px", curX.toFixed(4));
      el.style.setProperty("--wp-py", curY.toFixed(4));
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousemove", onMove); };
  }, [variant]);
  return (
    <div ref={ref} className={`wallpaper-motion is-${variant}`} aria-hidden>
      <i><b /></i><i><b /></i><i><b /></i>
    </div>
  );
}

/** 3D 深空（11-02 用户：「3d动态壁纸也没有」）：WebGL 体积光。
 *  ⛔ 零第三方库（之前 vanta/three 已退役）：一个全屏 fragment shader 做 fbm 星云 + 三层纵深，
 *     鼠标驱动视差；WebGL 起不来时回退极光（绝不白屏）。减动效偏好只渲染一帧。 */
function DepthField({ reduced, onFail }: { reduced: boolean; onFail: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  /* ⛔ 依赖只留 reduced：onFail 是内联箭头，若进依赖数组，每次渲染都会销毁/重建 WebGL 上下文
     —— 切主题一两次就把上下文额度用光 ⇒ 画布被回退成极光（实测）。 */
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) { failRef.current(); return; }
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }");
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { failRef.current(); return; }
    const prog = gl.createProgram();
    if (!prog) { failRef.current(); return; }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { failRef.current(); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uni = {
      res: gl.getUniformLocation(prog, "uRes"),
      time: gl.getUniformLocation(prog, "uTime"),
      mouse: gl.getUniformLocation(prog, "uMouse"),
      a: gl.getUniformLocation(prog, "uA"),
      b: gl.getUniformLocation(prog, "uB"),
      base: gl.getUniformLocation(prog, "uBase"),
      intensity: gl.getUniformLocation(prog, "uIntensity"),
    };
    const colorOf = (name: string, fallback: [number, number, number]): [number, number, number] => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const m = /^#([0-9a-f]{6})$/i.exec(raw);
      if (!m) return fallback;
      const n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };
    /* 主题色/明暗随时更新（切主题不重建上下文）：颜色与强度都从当前 token 现读。 */
    const applyTheme = () => {
      const dark = document.documentElement.dataset.themeMode === "dark";
      const a = colorOf("--accent", dark ? [0.79, 0.66, 0.42] : [0.18, 0.42, 0.87]);
      const b = colorOf("--ic-cyan", dark ? [0.36, 0.7, 0.77] : [0.04, 0.45, 0.52]);
      const base = colorOf("--bg", dark ? [0.04, 0.05, 0.06] : [1, 1, 1]);
      gl.uniform3f(uni.a, a[0], a[1], a[2]);
      gl.uniform3f(uni.b, b[0], b[1], b[2]);
      gl.uniform3f(uni.base, base[0], base[1], base[2]);
      gl.uniform1f(uni.intensity, dark ? 3.0 : 0.75);
    };
    applyTheme();
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let mx = 0, my = 0, tx = 0, ty = 0, raf = 0, disposed = false;
    const onMove = (event: MouseEvent) => {
      tx = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      ty = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uni.res, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const draw = (now: number) => {
      mx += (tx - mx) * 0.05;
      my += (ty - my) * 0.05;
      gl.uniform1f(uni.time, now / 1000);
      gl.uniform2f(uni.mouse, mx, my);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced && !disposed) raf = requestAnimationFrame(draw);
    };
    if (!reduced) window.addEventListener("mousemove", onMove, { passive: true });
    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      themeObserver.disconnect();
      ro.disconnect();
      try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* 已释放 */ }
    };
  }, [reduced]);
  return <canvas ref={ref} className="wallpaper-depth" aria-hidden />;
}

const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uBase; uniform float uIntensity;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0; float amp = 0.5;
  for (int i = 0; i < 4; i++) { v += amp * noise(p); p = p * 2.02 + 17.0; amp *= 0.5; }
  return v;
}
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * 0.05;
  vec3 col = uBase;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float depth = 0.65 + 0.3 * fi;
    vec2 q = p * depth + uMouse * 0.09 * depth + vec2(sin(t * 1.2 + fi * 1.7), cos(t * 0.9 + fi * 2.1)) * 0.22;
    float n = fbm(q * 1.7 + vec2(t * 0.4, -t * 0.3));
    float glow = pow(smoothstep(0.30, 0.92, n), 1.35);
    vec3 tint = mix(uA, uB, clamp(0.2 + 0.55 * n + 0.12 * fi, 0.0, 1.0));
    col += tint * glow * (1.0 / (fi + 0.8)) * uIntensity;
  }
  col *= 1.0 - smoothstep(0.62, 1.45, length(p * vec2(0.85, 1.0))) * 0.72;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function WallpaperLayer() {
  const [cfg, setCfg] = useState<WallpaperConfig>(() => readWallpaper());
  const [depthFailed, setDepthFailed] = useState(false);
  useEffect(() => subscribeWallpaper(setCfg as (c: ReturnType<typeof readWallpaper>) => void), []);
  /* 拓展接口（10-06）：引擎 harness_tools wallpaper_set → 主进程推送 → 这里落 localStorage
     （与设置页同一条 saveWallpaper 链路）。 */
  useEffect(() => window.codex.onWallpaperApply((event) => {
    if (event?.mode) saveWallpaper(event);
  }), []);
  /* ⛔ 铺满全应用：层挂在 .app-shell 首子元素（fixed 铺满视口），app-shell isolation 让负 z 层
     画在表面之下、内容之上；data-wallpaper 驱动表面令牌半透明（见 28-wallpaper.css）。 */
  useEffect(() => {
    if (cfg.mode === "off") delete document.documentElement.dataset.wallpaper;
    else document.documentElement.dataset.wallpaper = "on";
  }, [cfg.mode]);
  useEffect(() => () => { delete document.documentElement.dataset.wallpaper; }, []);
  if (cfg.mode === "off") return null;
  const preset = isPresetImage(cfg.image) ? presetById(cfg.image.slice("preset:".length)) : null;
  return (
    <div className="wallpaper-layer" data-mode={cfg.mode} aria-hidden>
      {(cfg.mode === "aurora" || cfg.mode === "ribbon" || cfg.mode === "halo") && (
        <MotionVeil variant={cfg.mode as "aurora" | "ribbon" | "halo"} />
      )}
      {cfg.mode === "depth" && (depthFailed
        ? <MotionVeil variant="aurora" />
        : <DepthField reduced={prefersReducedMotion()} onFail={() => setDepthFailed(true)} />)}
      {cfg.mode === "custom" && preset && <div className="wallpaper-custom wallpaper-preset" style={{ backgroundImage: `url("./${preset.src}")` }} />}
      {cfg.mode === "custom" && !preset && cfg.image && (
        <div className="wallpaper-custom" style={{ backgroundImage: `url("${localImageUrl(cfg.image)}")` }} />
      )}
    </div>
  );
}
