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

export function WallpaperLayer() {
  const [cfg, setCfg] = useState<WallpaperConfig>(() => readWallpaper());
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
      {cfg.mode === "custom" && preset && <div className="wallpaper-custom wallpaper-preset" style={{ backgroundImage: `url("./${preset.src}")` }} />}
      {cfg.mode === "custom" && !preset && cfg.image && (
        <div className="wallpaper-custom" style={{ backgroundImage: `url("${localImageUrl(cfg.image)}")` }} />
      )}
    </div>
  );
}
