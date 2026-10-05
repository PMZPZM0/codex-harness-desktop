/**
 * 壁纸层（wallpaper 域，2026-10-05）：挂在 `.timeline-wrap` 内、聊天区透出的程序化背景。
 * ⛔ 三条铁律：
 *   ① pointer-events: none + z-index: -1 —— 纯视觉层，永不挡交互（守卫钉住）；
 *   ② 动效库（tsparticles / vanta）**整块懒加载** —— 首次选对应模式才拉 chunk，主包零开销；
 *   ③ 动效引擎失败必须静默降级（vanta 对 three 版本敏感，炸了就退回无背景，不许白屏/弹错）。
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { localImageUrl } from "../../lib/image-src.mjs";
import { patternMask, readWallpaper, subscribeWallpaper } from "../../lib/wallpaper.mjs";

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
          backgroundColor: "rgba(0,0,0,0)",
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
  if (cfg.mode === "off") return null;
  // ⛔ 减动效偏好下，粒子/3D 一律退回静态图案（accessibility 基本盘）
  const mode = (cfg.mode === "particles" || cfg.mode === "vanta") && prefersReducedMotion() ? "pattern" : cfg.mode;
  return (
    <div className="wallpaper-layer" data-mode={mode} aria-hidden style={{ opacity: cfg.opacity / 100 }}>
      {mode === "pattern" && (
        <div
          className="wallpaper-pattern"
          style={{ WebkitMaskImage: patternMask(cfg.pattern), maskImage: patternMask(cfg.pattern) }}
        />
      )}
      {mode === "particles" && <Suspense fallback={null}><ParticlesPane /></Suspense>}
      {mode === "vanta" && <VantaPane />}
      {mode === "custom" && cfg.image && (
        <div className="wallpaper-custom" style={{ backgroundImage: `url("${localImageUrl(cfg.image)}")` }} />
      )}
    </div>
  );
}
