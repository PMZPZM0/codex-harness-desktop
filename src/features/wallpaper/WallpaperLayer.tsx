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

/** 3D 山景（11-02 用户：「我说的 3d 是动态的，不是这种静态的…风景山川」）。
 *  ⛔ 不是贴图：canvas 逐帧画「天空 + 远近三层山脊 + 流动雾气」，按鼠标位置做纵深视差，
 *     山脊随云缓慢漂移；颜色全部从主题 token 现算（浅色=白昼山景 / 深色=夜色山景）。
 *  ⛔ 减动效偏好只画一帧；主题切换只换调色板重绘，不重建 canvas。 */
function DepthField({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rgbOf = (name: string, fallback: [number, number, number]): [number, number, number] => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const m = /^#([0-9a-f]{6})/i.exec(raw);
      if (!m) return fallback;
      const n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };
    const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
      [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const css = (c: [number, number, number], alpha = 1) =>
      `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${alpha})`;

    let palette: { dark: boolean; skyTop: string; skyBottom: string; glow: string; ridges: string[]; mist: string; ridgeRim: string } ;
    const buildPalette = () => {
      const dark = document.documentElement.dataset.themeMode === "dark";
      const bg = rgbOf("--bg", dark ? [0.04, 0.05, 0.06] : [1, 1, 1]);
      const panel = rgbOf("--panel", dark ? [0.07, 0.08, 0.1] : [0.97, 0.97, 0.96]);
      const accent = rgbOf("--accent", dark ? [0.79, 0.66, 0.42] : [0.18, 0.42, 0.87]);
      const cyan = rgbOf("--ic-cyan", dark ? [0.36, 0.7, 0.77] : [0.04, 0.45, 0.52]);
      palette = dark
        ? {
            dark,
            skyTop: css(bg),
            skyBottom: css(mix(bg, mix(panel, accent, 0.35), 0.55)),
            glow: css(accent, 0.26),
            ridges: [css(mix(bg, accent, 0.24), 0.82), css(mix(bg, cyan, 0.26), 0.9), css(mix(bg, panel, 0.7), 0.96)],
            mist: css(panel, 0.12),
            ridgeRim: css(accent, 0.12),
          }
        : {
            dark,
            skyTop: "#ffffff",
            skyBottom: css(mix([1, 1, 1], mix(accent, cyan, 0.4), 0.16)),
            glow: css(accent, 0.18),
            ridges: [css(mix([1, 1, 1], accent, 0.3), 0.85), css(mix([1, 1, 1], cyan, 0.44), 0.9), css(mix([1, 1, 1], mix(accent, cyan, 0.55), 0.62), 0.95)],
            mist: "rgba(255,255,255,0.6)",
            ridgeRim: css(cyan, 0.22),
          };
    };
    buildPalette();
    const themeObserver = new MutationObserver(() => { buildPalette(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let mx = 0, my = 0, tx = 0, ty = 0, raf = 0, disposed = false, last = 0;
    const onMove = (event: MouseEvent) => {
      tx = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      ty = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    };
    if (!reduced) window.addEventListener("mousemove", onMove, { passive: true });

    const ridge = (width: number, height: number, base: number, amp: number, seed: number, shift: number) => {
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width; x += 6) {
        const u = x / width;
        const y = height * base
          - amp * (Math.sin(u * 6.5 + seed + shift) * 0.6 + Math.sin(u * 13.7 + seed * 2.1 - shift * 0.7) * 0.28 + Math.sin(u * 27.3 + seed * 0.7) * 0.12);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
    };

    const paint = (now: number) => {
      if (reduced || now - last >= 33) {
        last = now;
        const w = canvas.width, h = canvas.height;
        const t = now / 1000;
        mx += (tx - mx) * 0.05;
        my += (ty - my) * 0.05;
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, palette.skyTop);
        sky.addColorStop(1, palette.skyBottom);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);

        /* 天光（日/月的柔光） */
        const glow = ctx.createRadialGradient(w * (0.72 + mx * 0.02), h * (0.2 + my * 0.02), 0, w * 0.72, h * 0.2, h * 0.55);
        glow.addColorStop(0, palette.glow);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        /* 远山 → 近山（三层视差） */
        const shift = t * 0.02;
        const depths = [0.006, 0.012, 0.02];
        const bases = [0.56, 0.7, 0.85];
        const amps = [h * 0.14, h * 0.17, h * 0.2];
        for (let i = 0; i < 3; i++) {
          const dx = mx * 14 * (i + 1) * dpr * depths[i] * 40;
          ctx.save();
          ctx.translate(dx, my * 6 * (i + 1) * dpr * depths[i] * 40);
          ctx.fillStyle = palette.ridges[i];
          ridge(w, h, bases[i], amps[i], 1.7 + i * 2.3, shift * (i + 1));
          ctx.fill();
          ctx.strokeStyle = i === 0 ? palette.ridgeRim : "rgba(0,0,0,0)";
          ctx.lineWidth = Math.max(1, dpr * 1.2);
          ctx.stroke();
          ctx.restore();
        }

        /* 流动雾气（两条横向柔光带） */
        for (let i = 0; i < 2; i++) {
          const y = h * (0.56 + i * 0.12) + Math.sin(t * 0.12 + i) * h * 0.01;
          const mist = ctx.createLinearGradient(0, y - h * 0.03, 0, y + h * 0.05);
          mist.addColorStop(0, "rgba(0,0,0,0)");
          mist.addColorStop(0.5, palette.mist);
          mist.addColorStop(1, "rgba(0,0,0,0)");
          ctx.save();
          ctx.translate(Math.sin(t * 0.06 + i * 2) * w * 0.01, 0);
          ctx.fillStyle = mist;
          ctx.fillRect(-w * 0.05, y - h * 0.04, w * 1.1, h * 0.1);
          ctx.restore();
        }
      }
      if (!reduced && !disposed) raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      themeObserver.disconnect();
      ro.disconnect();
    };
  }, [reduced]);
  return <canvas ref={ref} className="wallpaper-depth" aria-hidden />;
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
      {cfg.mode === "depth" && <DepthField reduced={prefersReducedMotion()} />}
      {cfg.mode === "custom" && preset && (
        <>
          <div className="wallpaper-custom wallpaper-preset wp-sky-day" style={{ backgroundImage: `url("./${preset.day}")` }} />
          <div className="wallpaper-custom wallpaper-preset wp-sky-night" style={{ backgroundImage: `url("./${preset.night}")` }} />
        </>
      )}
      {cfg.mode === "custom" && !preset && cfg.image && (
        <div className="wallpaper-custom" style={{ backgroundImage: `url("${localImageUrl(cfg.image)}")` }} />
      )}
    </div>
  );
}
