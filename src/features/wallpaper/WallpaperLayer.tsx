/**
 * 壁纸层（wallpaper 域，2026-10-05）：挂在 `.timeline-wrap` 内、聊天区透出的程序化背景。
 * ⛔ 三条铁律：
 *   ① pointer-events: none + z-index: -1 —— 纯视觉层，永不挡交互（守卫钉住）；
 *   ② 动效库（tsparticles / vanta）**整块懒加载** —— 首次选对应模式才拉 chunk，主包零开销；
 *   ③ 动效引擎失败必须静默降级（vanta 对 three 版本敏感，炸了就退回无背景，不许白屏/弹错）。
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { localImageUrl } from "../../lib/image-src.mjs";
import { isPresetImage, patternMask, presetById, readWallpaper, saveWallpaper, subscribeWallpaper } from "../../lib/wallpaper.mjs";

type WallpaperConfig = { mode: string; pattern: string; opacity: number; image: string };

// ⛔ 两个动效引擎都必须是 lazy chunk：tsparticles（引擎+插件 ~1MB）、vanta+three（~700KB）
const ParticlesPane = lazy(() => import("./ParticlesPane"));

/** vanta（MIT，tengbao/vanta）：NET 效果；⛔ vanta 对 three 版本敏感 ——
 *  整个初始化包 try/catch，失败静默降级成空层（宁可没壁纸不许白屏/报错弹窗）。 */
function VantaPane() {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let effect: { destroy: () => void } | null = null;
    void (async () => {
      try {
        const THREE = await import("three");
        (window as unknown as { THREE: unknown }).THREE = THREE;
        const net = (await import("vanta/dist/vanta.net.min.js")).default;
        if (disposed || !ref.current) return;
        effect = net({
          el: ref.current,
          THREE,
          mouseControls: { touch: false, mouse: true },
          // 主题主色转 hex（vanta 只吃具体色值）；ponytail: 挂载时取一次，运行中换主题不跟随
          color: (getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().match(/^#[0-9a-fA-F]{3,8}$/) ?? ["#7a9e7e"])[0],
          // ⛔ vanta 不支持透明背景（实测渲染成黑底、跟浅色主题打架）—— 背景色取主题 --bg
          backgroundColor: (getComputedStyle(document.documentElement).getPropertyValue("--bg").trim().match(/^#[0-9a-fA-F]{3,8}$/) ?? ["#f6f6f4"])[0],
          maxDistance: 22,
          spacing: 18,
        }) as { destroy: () => void };
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => {
      disposed = true;
      try { effect?.destroy(); } catch { /* 已销毁 */ }
    };
  }, []);
  if (failed) return null;
  return <div ref={ref} className="wallpaper-vanta" />;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  // ⛔ 减动效偏好下，粒子/3D 一律退回静态图案（accessibility 基本盘）
  const mode = (cfg.mode === "particles" || cfg.mode === "vanta") && prefersReducedMotion() ? "pattern" : cfg.mode;
  /* ⛔ 浓度只作用于图案（装饰层）：粒子/3D 有自己的强度语义；自定义图/精选渐变是完整壁纸
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
      {mode === "vanta" && <VantaPane />}
      {mode === "custom" && preset && <div className="wallpaper-custom wallpaper-preset" style={{ backgroundImage: preset.css }} />}
      {mode === "custom" && !preset && cfg.image && (
        <div className="wallpaper-custom" style={{ backgroundImage: `url("${localImageUrl(cfg.image)}")` }} />
      )}
    </div>
  );
}
