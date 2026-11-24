/**
 * 生图等待特效（11-24 用户：参考 `owui-fx/preview.html` 的点阵效果 ——
 * 「正在勾勒草图」+ 中心扩散的蓝色点阵 + 右下角百分比）。
 *
 * ⛔ 只画「等待中」的画面，进度数字与文案由调用方给（ImageLabModal 按时间估算）——
 *    这样同一份动画也能被别的等待场景复用，且不必在这里猜接口耗时。
 * ⛔ 点阵用 canvas 而不是 N 个 DOM 节点：300px 宽约 500 个点，DOM 版会把主线程打满。
 * ⛔ 尊重 prefers-reduced-motion：不跑 raf，直接画一帧静态点阵（缺了动画仍是"有画面在等"）。
 */
import { useEffect, useRef } from "react";

/**
 * 点阵等待画面：以中心为圆心向外扩散的呼吸波，边缘渐隐。
 *
 * 参数只暴露颜色强度（`tone`），尺寸完全由容器决定 —— 调用方给一个定高容器即可。
 */
export function ImageGenFx({ tone = "accent" }: { tone?: "accent" }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /* 主色：与 DESIGN 的 accent 同族的蓝紫（GPT 官网那种冷蓝点阵看着最"在计算"）。 */
    const base = tone === "accent" ? [86, 116, 208] : [120, 120, 120];

    const draw = (stamp: number) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.clearRect(0, 0, w, h);

      const gap = 11 * dpr;
      const dot = 1.8 * dpr;
      const half = dot / 2;
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(cx, cy) || 1;
      const time = stamp / 1000;

      for (let y = gap / 2; y < h; y += gap) {
        for (let x = gap / 2; x < w; x += gap) {
          const d = Math.hypot(x - cx, y - cy) / maxR;
          const wave = (Math.sin(time * 1.6 - d * 5.2) + 1) / 2;
          const breathe = ((Math.sin(time * 0.9 + d * 2.1) + 1) / 2) * 0.18;
          const alpha = (0.1 + 0.62 * wave) * (1 - d * 0.62) + breathe;
          if (alpha <= 0.02) continue;
          ctx.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},${alpha.toFixed(3)})`;
          ctx.fillRect(x - half, y - half, dot, dot);
        }
      }
    };

    if (reduced) { draw(0); return; }
    const loop = (stamp: number) => {
      rafRef.current = window.requestAnimationFrame(loop);
      draw(stamp);
    };
    rafRef.current = window.requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [tone]);

  return <canvas ref={canvasRef} className="image-lab-fx-canvas" aria-hidden="true" />;
}
