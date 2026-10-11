/**
 * 壁纸层（wallpaper 域，2026-10-05）：铺满全应用、聊天区透出的程序化背景。
 * ⛔ 三条铁律：
 *   ① pointer-events: none + z-index: -1 —— 纯视觉层，永不挡交互（守卫钉住）；
 *   ② 动效引擎**整块懒加载**（tsparticles ~1MB）—— 首次选对应模式才拉 chunk，主包零开销；
 *   ③ 动效引擎失败必须静默降级（炸了就退回无背景，不许白屏/弹错）。
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { localImageUrl } from "../../lib/image-src.mjs";
import { isPresetImage, patternMask, presetById, readWallpaper, saveWallpaper, subscribeWallpaper } from "../../lib/wallpaper.mjs";

type WallpaperConfig = { mode: string; pattern: string; opacity: number; image: string };

// ⛔ tsparticles 必须是 lazy chunk（引擎+插件 ~1MB），不许静态进主包
const ParticlesPane = lazy(() => import("./ParticlesPane"));

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 主题 token 转 hex（canvas 只吃具体色值，不吃 CSS 变量）。 */
function readHex(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
}

/** 星野（点阵）—— 替代原 vanta「3D 背景」。
 *
 *  ⛔ 用户 10-11 定稿：「**黑夜→星空；白天→动态点；点之间不要连线**」，紧接着追加
 *    「**都要动态星空、跟着鼠标动，不是静态的**」。而 vanta NET 的形态就是"点 + 连线"（网），
 *    只调参调不出"无连线的点阵" ⇒ **vanta/three 整体退役**，改这里自绘 2D canvas：
 *    零依赖、零连线，点/星的大小、明灭与**鼠标视差**完全可控。
 *
 *  两档同一套点阵，只换配色与明灭：深色主题 = 浅色星（带缓慢明灭），浅色主题 = 深色点（稳定可见）；
 *  颜色取 `--text`，并监听 `data-theme` 重绘。
 *  运动 = **鼠标视差（近层位移大、远层位移小 ⇒ 纵深）+ 缓速自主漂移**，鼠标不动时也不静止。 */
function StarfieldPane() {
  const ref = useRef<HTMLCanvasElement>(null);
  // 主题变化 ⇒ 递增 key 重绘（canvas 已按旧主题着色，重画是唯一可靠的跟随方式）
  const [themeKey, setThemeKey] = useState(0);
  useEffect(() => {
    const ob = new MutationObserver(() => setThemeKey((n) => n + 1));
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => ob.disconnect();
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let disposed = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dark = document.documentElement.dataset.theme === "dark";
    const color = readHex("--text", dark ? "#ececea" : "#1b1b1a");
    const motion = !prefersReducedMotion();
    // 鼠标视差：目标值来自指针位置（归一化 −1..1），实际值缓动追随 —— 直接跟随会"跳"
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    const onMove = (e: MouseEvent) => {
      targetX = (e.clientX / window.innerWidth) * 2 - 1;
      targetY = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (motion) window.addEventListener("mousemove", onMove, { passive: true });
    let stars: { x: number; y: number; r: number; a: number; p: number; d: number }[] = [];
    const seed = () => {
      const n = Math.max(28, Math.min(240, Math.round((canvas.width * canvas.height) / (dark ? 13000 : 20000))));
      stars = Array.from({ length: n }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: dark ? 0.5 + Math.random() * 1.3 : 0.7 + Math.random() * 1.0,
        a: dark ? 0.35 + Math.random() * 0.6 : 0.16 + Math.random() * 0.24,
        p: Math.random() * Math.PI * 2,
        // 纵深：越"近"的点视差位移越大（0.35 远层 ~ 1 近层）
        d: 0.35 + Math.random() * 0.65,
      }));
    };
    const resize = () => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      seed();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const paint = (t: number) => {
      const w = canvas.width;
      const h = canvas.height;
      curX += (targetX - curX) * 0.06;
      curY += (targetY - curY) * 0.06;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      for (const s of stars) {
        // 深色 = 星：亮度缓慢明灭；浅色 = 点：稳定可见
        const alpha = dark ? s.a * (0.6 + 0.4 * Math.sin(t / 900 + s.p)) : s.a;
        ctx.globalAlpha = Math.max(0.05, Math.min(1, alpha));
        const px = (Math.sin(t / 2600 + s.p) * 3 + curX * 30 * s.d) * dpr;
        const py = (Math.cos(t / 3100 + s.p) * 3 + curY * 30 * s.d) * dpr;
        ctx.beginPath();
        ctx.arc(s.x * w + px, s.y * h + py, s.r * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (motion && !disposed) raf = requestAnimationFrame(paint);
    };
    paint(0);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("mousemove", onMove);
    };
  }, [themeKey]);
  return <canvas ref={ref} className="wallpaper-stars" aria-hidden />;
}

export function WallpaperLayer() {
  const [cfg, setCfg] = useState<WallpaperConfig>(() => readWallpaper());
  useEffect(() => subscribeWallpaper(setCfg as (c: ReturnType<typeof readWallpaper>) => void), []);
  /* 拓展接口（10-06）：引擎 harness_tools wallpaper_set → 主进程推送 → 这里落 localStorage
     （与设置页同一条 saveWallpaper 链路）。 */
  useEffect(() => window.codex.onWallpaperApply((event) => {
    if (event?.mode) saveWallpaper(event);
  }), []);
  /* ⛔ 铺满全应用（10-06 用户定稿）：层挂在 .app-shell 首子元素（fixed 定位铺满视口），
     app-shell 有 isolation ⇒ 负 z 层透出在所有表面之下、内容之上；
     data-wallpaper 属性驱动 CSS 把 app-shell/composer 表面变透明 —— 关掉时属性摘除、一切还原。 */
  useEffect(() => {
    if (cfg.mode === "off") delete document.documentElement.dataset.wallpaper;
    else document.documentElement.dataset.wallpaper = "on";
  }, [cfg.mode]);
  useEffect(() => () => { delete document.documentElement.dataset.wallpaper; }, []);
  if (cfg.mode === "off") return null;
  // ⛔ 减动效偏好下，粒子/星野一律退回静态图案（accessibility 基本盘）
  const mode = (cfg.mode === "particles" || cfg.mode === "stars") && prefersReducedMotion() ? "pattern" : cfg.mode;
  /* ⛔ 浓度只作用于图案（装饰层）：粒子/星野有自己的强度语义；自定义图/精选渐变是完整壁纸
     —— 被 12% 层透明度压住 = 全部隐身（10-05 用户实测「切了全没反应」的真凶之二）。 */
  const opacity = mode === "pattern" ? cfg.opacity / 100 : 1;
  const preset = isPresetImage(cfg.image) ? presetById(cfg.image.slice("preset:".length)) : null;
  return (
    <div className="wallpaper-layer" data-mode={mode} aria-hidden style={{ opacity }}>
      {mode === "pattern" && (
        <div
          className="wallpaper-pattern"
          style={{ WebkitMaskImage: patternMask(cfg.pattern), maskImage: patternMask(cfg.pattern) }}
        />
      )}
      {mode === "particles" && <Suspense fallback={null}><ParticlesPane /></Suspense>}
      {mode === "stars" && <StarfieldPane />}
      {mode === "custom" && preset && <div className="wallpaper-custom wallpaper-preset" style={{ backgroundImage: preset.css }} />}
      {mode === "custom" && !preset && cfg.image && (
        <div className="wallpaper-custom" style={{ backgroundImage: `url("${localImageUrl(cfg.image)}")` }} />
      )}
    </div>
  );
}
