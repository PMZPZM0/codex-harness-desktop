/**
 * 实时语音舞台：彩色波浪 + 中英字幕，挂在输入框（composer）正上方。
 *
 * 波形：canvas 绘制的镜像柱状波，高度跟「电平」走（采集时跟麦克风、播报时跟 TTS 输出），
 * 颜色是横向多段渐变（青 → 蓝 → 紫 → 粉），柱子各自带一点相位差，静止时也有轻微呼吸感。
 *
 * 字幕：用户说话（识别文本）和 Codex 说话（正在合成/朗读的文本）各一行，
 * 用 DOM 渲染（不是画在 canvas 上）——中英混排、换行、字体都交给浏览器，最省心也最清晰。
 */
import { useEffect, useRef, useState } from "react";
import { requestVoiceStop, subscribeVoiceStage, type VoiceWaveMode } from "../voice/wave-level";

const BAR_COUNT = 44;

const MODE_LABEL: Record<VoiceWaveMode, string> = {
  idle: "待机",
  listening: "正在聆听…",
  thinking: "思考中…",
  speaking: "播报中…",
};

export default function VoiceWaveform() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef(0);
  const modeRef = useRef<VoiceWaveMode>("idle");
  const [stage, setStage] = useState({ mode: "idle" as VoiceWaveMode, userText: "", agentText: "", active: false, dictating: false });
  const rafRef = useRef(0);

  useEffect(() => subscribeVoiceStage((s) => {
    levelRef.current = s.level;
    modeRef.current = s.mode;
    setStage((prev) => (
      prev.mode === s.mode && prev.userText === s.userText && prev.agentText === s.agentText && prev.active === s.active && prev.dictating === s.dictating
        ? prev
        : { mode: s.mode, userText: s.userText, agentText: s.agentText, active: s.active, dictating: s.dictating }
    ));
  }), []);

  useEffect(() => {
    // 依赖 active：未激活时组件返回 null、canvas 还不存在，若用 [] 会在挂载那次
    // 提前 return 且之后再也不启动 —— 必须等 canvas 真正出现后再建绘制循环。
    if (!stage.active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let t = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 56;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const level = levelRef.current;
      const m = modeRef.current;
      t += 0.045;

      // 横向渐变：青 → 蓝 → 紫 → 粉（"彩色波浪"）
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#22d3ee");
      grad.addColorStop(0.32, "#3b82f6");
      grad.addColorStop(0.62, "#8b5cf6");
      grad.addColorStop(1, "#f472b6");

      const gap = 3;
      const barW = Math.max(2, (w - gap * (BAR_COUNT - 1)) / BAR_COUNT);
      const mid = h / 2;
      // 待机/思考时给一个很低的底噪，让波形微微呼吸而不是完全躺平
      const base = m === "idle" ? 0.06 : m === "thinking" ? 0.1 : Math.max(0.08, level);

      ctx.fillStyle = grad;
      for (let i = 0; i < BAR_COUNT; i++) {
        // 相位差 + 中心高两边低的包络，看起来更像"波"而不是随机柱
        const phase = t + i * 0.32;
        const wobble = 0.55 + 0.45 * Math.sin(phase) * Math.cos(phase * 0.6);
        const envelope = 0.45 + 0.55 * Math.sin((i / (BAR_COUNT - 1)) * Math.PI);
        const amp = base * wobble * envelope;
        const barH = Math.max(2, amp * (h * 0.46));
        const x = i * (barW + gap);
        const r = Math.min(barW / 2, 3);
        // 圆角柱（上下镜像）
        ctx.beginPath();
        roundRect(ctx, x, mid - barH, barW, barH * 2, r);
        ctx.fill();
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [stage.active]);

  const mode = stage.mode;
  // 播报时优先显示 Codex 的字幕；聆听/思考时显示用户侧
  const agentLine = stage.agentText?.trim() ?? "";
  const userLine = stage.userText?.trim() ?? "";
  const subtitle = mode === "speaking" ? (agentLine || userLine) : (userLine || agentLine);
  const who = mode === "speaking" && agentLine ? "Codex" : "你";
  const showSubtitle = Boolean(subtitle);

  if (!stage.active) return null;

  return (
    <div className={`voice-stage voice-stage-${mode}`}>
      <div className="voice-stage-head">
        <span className="voice-stage-mode">{stage.dictating ? "语音输入中…" : MODE_LABEL[mode]}</span>
        <button
          type="button"
          className="voice-stage-stop"
          onClick={() => requestVoiceStop()}
        >
          {stage.dictating ? "结束输入" : "结束通话"}
        </button>
      </div>
      <canvas ref={canvasRef} className="voice-wave-canvas" aria-hidden="true" />
      {showSubtitle && (
        <div className={`voice-subtitle ${who === "Codex" ? "agent" : "user"}`} lang="zh-CN">
          <span className="voice-subtitle-who">{who}</span>
          <span className="voice-subtitle-text">{subtitle}</span>
        </div>
      )}
    </div>
  );
}

/** 画布圆角矩形（不依赖 ctx.roundRect，Electron 老 Chromium 也稳） */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
