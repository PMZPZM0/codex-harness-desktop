/**
 * 壁纸层（wallpaper 域，2026-10-05；11-02 大改版）。
 *
 * ⛔ 铁律：
 *   ① pointer-events: none + z-index: -1 —— 纯视觉层，永不挡交互；
 *   ② 动态档 = CSS 柔光 / canvas 2D 星空，颜色全部读主题 token；减动效按**应用策略**
 *      （见 shouldReduceMotion），⛔ 不直接读系统媒体查询（mac「减少动态效果」会单独冻住星空/视差）；
 *   ③ 减动效下只停动画/不挂鼠标监听（保留一层静态柔光，不突然变纯黑）。
 *
 * 11-02 用户判「动态壁纸太失望 / 普通壁纸也丑 / 旧的那种线条都还在」⇒ 三类旧壁纸
 * （图案瓷砖 / 粒子连线 / 星空点阵）**整组移除**；只剩：
 *   aurora 极光流带 · ribbon 流光丝带 · halo 呼吸光晕 · depth 3D 星空 · custom 静态壁纸（5 组日夜风景）。
 */
import { useEffect, useRef, useState } from "react";
import { localImageUrl } from "../../lib/image-src.mjs";
import { isPresetImage, presetById, readWallpaper, saveWallpaper, subscribeWallpaper } from "../../lib/wallpaper.mjs";

type WallpaperConfig = { mode: string; image: string };

/** 减动效策略（11-02 mac 反馈：「3D 星空没有适配 mac」）。
 *  ⛔ 与全站同一条策略：应用默认 `data-motion="force"` = **无视系统「减少动态效果」**
 *    （mac 用户实测这个系统开关会把动画全冻住；CSS 侧已用 `html:not([data-motion="force"])` 前缀）。
 *    壁纸的 JS 动效也必须走这个判断 —— 直接读媒体查询会出现「其它都在动，只有星空/视差冻住」。
 *  ⛔ 属性缺失按默认 force 处理：首帧 effect 可能早于设置 `data-motion` 的那条 effect。 */
function shouldReduceMotion(): boolean {
  const policy = document.documentElement.dataset.motion;
  if (!policy || policy === "force") return false;
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
    if (shouldReduceMotion()) return;
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

/** 3D 星空（11-02 用户：「3d 山泉这个好丑，我要星空那种，也是白天黑夜主题色两段适配」）。
 *  ⛔ canvas 逐帧星空：三层深度星点（鼠标视差 + 缓慢漂移 + 闪烁）、星云柔光、夜间偶发流星；
 *     浅色主题 = 白昼淡星（冷灰蓝、细而少），深色主题 = 深空星野（亮星 + 主题色星云）。
 *  ⛔ 颜色全部从主题 token 现算；切主题只换调色板重绘，不重建 canvas；减动效只画一帧。 */
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

    type Palette = {
      dark: boolean;
      skyTop: string;
      skyBottom: string;
      nebulaA: string;
      nebulaB: string;
      sun: string;
      star: [number, number, number];
      starAlpha: number;
      starCount: number;
      cloud: string;
    };
    let palette: Palette;
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
            skyBottom: css(mix(bg, panel, 0.7)),
            nebulaA: css(accent, 0.32),
            nebulaB: css(cyan, 0.26),
            sun: css(accent, 0.22),
            star: [1, 1, 1],
            starAlpha: 1,
            starCount: 1.65,
            cloud: "rgba(0,0,0,0)",
          }
        : {
            dark,
            skyTop: "#e8f0fb",
            skyBottom: "#ffffff",
            nebulaA: css(accent, 0.1),
            nebulaB: css(cyan, 0.1),
            sun: css(accent, 0.2),
            star: mix([0.24, 0.34, 0.52], accent, 0.25),
            starAlpha: 0.45,
            starCount: 0.6,
            cloud: "rgba(255,255,255,0.6)",
          };
    };
    buildPalette();
    const themeObserver = new MutationObserver(() => { buildPalette(); seedStars(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    };
    resize();
    const ro = new ResizeObserver(() => { resize(); seedStars(); });
    ro.observe(canvas);

    type Star = { x: number; y: number; r: number; depth: number; phase: number; speed: number };
    let stars: Star[] = [];
    const seedStars = () => {
      const count = Math.round((canvas.width * canvas.height) / 5200 * palette.starCount);
      stars = Array.from({ length: Math.max(40, Math.min(1400, count)) }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: 0.4 + Math.random() * 1.9,
        depth: 0.25 + Math.random() * 0.75,
        phase: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.8,
      }));
    };
    seedStars();

    let mx = 0, my = 0, tx = 0, ty = 0, raf = 0, disposed = false, last = 0;
    const onMove = (event: MouseEvent) => {
      tx = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      ty = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    };
    if (!reduced) window.addEventListener("mousemove", onMove, { passive: true });

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

        /* 星云柔光（主题色，缓慢漂移） */
        for (let i = 0; i < 2; i++) {
          const cx = w * (0.28 + i * 0.44 + Math.sin(t * 0.05 + i * 2) * 0.05 + mx * 0.05);
          const cy = h * (0.3 + i * 0.28 + Math.cos(t * 0.04 + i) * 0.04 + my * 0.05);
          const radius = h * (0.55 + i * 0.12);
          const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          glow.addColorStop(0, i === 0 ? palette.nebulaA : palette.nebulaB);
          glow.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = glow;
          ctx.fillRect(0, 0, w, h);
        }

        /* 日/月：一团柔和光晕 */
        const sunX = w * (0.74 + mx * 0.035);
        const sunY = h * (0.18 + my * 0.03);
        const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.42);
        sun.addColorStop(0, palette.sun);
        sun.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sun;
        ctx.fillRect(0, 0, w, h);

        /* 白昼：缓慢漂移的柔云（跟随鼠标轻微偏移） */
        if (!palette.dark) {
          for (let i = 0; i < 3; i++) {
            const drift = ((t * 0.006 * (i + 1) + mx * 0.03) % 1 + 1) % 1;
            const cx2 = (drift * 1.4 - 0.2) * w;
            const cy2 = h * (0.22 + i * 0.18) + Math.sin(t * 0.08 + i) * h * 0.02 + my * 6;
            const cloud = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, w * 0.36);
            cloud.addColorStop(0, palette.cloud);
            cloud.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = cloud;
            ctx.fillRect(0, 0, w, h);
          }
        }

        /* 鼠标跟随的柔光（指针处一团主题色光晕 —— 让鼠标交互看得见） */
        const pointerX = (0.5 + mx / 2) * w;
        const pointerY = (0.5 + my / 2) * h;
        const follow = ctx.createRadialGradient(pointerX, pointerY, 0, pointerX, pointerY, h * 0.3);
        follow.addColorStop(0, palette.dark ? palette.nebulaA : "rgba(255,255,255,0.35)");
        follow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = follow;
        ctx.fillRect(0, 0, w, h);

        /* 三层星点：深度视差 + 缓慢漂移 + 闪烁 */
        for (const star of stars) {
          const drift = ((star.x + t * 0.004 * star.speed) % 1 + 1) % 1;
          const px = ((drift * 1.04 - 0.02) + mx * 0.055 * star.depth) * w;
          const py = ((star.y + my * 0.035 * star.depth) % 1) * h;
          const twinkle = palette.dark ? 0.55 + 0.45 * Math.sin(t * 1.6 * star.speed + star.phase) : 1;
          ctx.fillStyle = css(palette.star, palette.starAlpha * twinkle * (0.45 + star.depth * 0.55));
          ctx.beginPath();
          ctx.arc(px, py, star.r * dpr * (0.8 + star.depth * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }

        /* 夜间偶发流星（每 ~7s 一次，1s 内划过） */
        if (palette.dark) {
          const cycle = t % 7;
          if (cycle < 1) {
            const k = cycle / 1;
            const sx = w * (0.15 + (Math.floor(t / 7) % 3) * 0.25) + k * w * 0.25;
            const sy = h * (0.12 + (Math.floor(t / 7) % 2) * 0.12) + k * h * 0.18;
            const tail = ctx.createLinearGradient(sx - w * 0.12, sy - h * 0.09, sx, sy);
            tail.addColorStop(0, "rgba(255,255,255,0)");
            tail.addColorStop(1, "rgba(255,255,255,0.55)");
            ctx.strokeStyle = tail;
            ctx.lineWidth = Math.max(1, dpr * 1.4);
            ctx.beginPath();
            ctx.moveTo(sx - w * 0.12, sy - h * 0.09);
            ctx.lineTo(sx, sy);
            ctx.stroke();
          }
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
      {cfg.mode === "depth" && <DepthField reduced={shouldReduceMotion()} />}
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
