/**
 * 外观设置页的「壁纸」段（wallpaper 域，2026-10-05）：自包含（localStorage + 自定义事件），
 * ⛔ 不进 bag —— 只有本页与壁纸层两个消费方（样板 = codex-official-market 的本地 state 口径）。
 */
import { useEffect, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import {
  WALLPAPER_MODES,
  WALLPAPER_PATTERNS,
  WALLPAPER_PRESETS,
  isPresetImage,
  patternMask,
  readWallpaper,
  saveWallpaper,
  subscribeWallpaper,
} from "../../lib/wallpaper.mjs";

const MODE_LABELS: Record<string, string> = {
  off: "关闭",
  pattern: "图案",
  particles: "粒子",
  vanta: "3D 背景",
  custom: "自定义图片",
};

export function WallpaperSettingsSection() {
  const [cfg, setCfg] = useState(() => readWallpaper());
  useEffect(() => subscribeWallpaper(setCfg as (c: ReturnType<typeof readWallpaper>) => void), []);

  const update = (patch: Partial<ReturnType<typeof readWallpaper>>) => setCfg(saveWallpaper({ ...cfg, ...patch }));

  const pickImage = async () => {
    const picked: unknown = await window.codex.chooseImages();
    const first = Array.isArray(picked) ? picked[0] : (picked as string | undefined);
    if (typeof first === "string" && first) update({ mode: "custom", image: first });
  };

  return (
    <>
      <div className="settings-subhead"><ImagePlus size={13} />壁纸<span className="settings-subhead-hint">垫在聊天区下方，面板不受影响；动效在减动效偏好下自动退回图案</span></div>
      <div className="theme-switch five" role="group" aria-label="壁纸模式">
        {WALLPAPER_MODES.map((mode) => (
          <button key={mode} type="button" className={cfg.mode === mode ? "active" : ""} onClick={() => update({ mode })}>
            {MODE_LABELS[mode] ?? mode}
          </button>
        ))}
      </div>
      {cfg.mode === "pattern" && (
        <div className="wallpaper-pattern-grid" role="group" aria-label="图案">
          {WALLPAPER_PATTERNS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`wallpaper-swatch ${cfg.pattern === p.id ? "active" : ""}`}
              aria-pressed={cfg.pattern === p.id}
              title={p.name}
              onClick={() => update({ pattern: p.id })}
            >
              <span className="wallpaper-swatch-face" style={{ WebkitMaskImage: patternMask(p.id), maskImage: patternMask(p.id) }} />
            </button>
          ))}
        </div>
      )}
      {cfg.mode === "custom" && (
        <>
          {/* 内置精选渐变壁纸：点击即用，不需要用户自己找图（10-05 用户「内置几个好看一点的」） */}
          <div className="wallpaper-preset-grid" role="group" aria-label="精选壁纸">
            {WALLPAPER_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`wallpaper-preset-card ${cfg.image === `preset:${p.id}` ? "active" : ""}`}
                aria-pressed={cfg.image === `preset:${p.id}`}
                title={p.name}
                onClick={() => update({ mode: "custom", image: `preset:${p.id}` })}
              >
                <span className="wallpaper-preset-face" style={{ backgroundImage: p.css }} />
                <span className="wallpaper-preset-name">{p.name}</span>
              </button>
            ))}
          </div>
          <div className="wallpaper-custom-row">
            <button type="button" className="btn" onClick={() => { void pickImage(); }}>选择图片…</button>
            {cfg.image && !isPresetImage(cfg.image) && (
              <button type="button" className="btn" onClick={() => update({ image: "" })}><Trash2 size={12} />清除</button>
            )}
            {cfg.image && !isPresetImage(cfg.image) && <span className="wallpaper-custom-path" title={cfg.image}>{cfg.image.split(/[\\/]/).pop()}</span>}
          </div>
        </>
      )}
      {cfg.mode === "pattern" && (
        <label className="wallpaper-opacity">
          <span>浓度</span>
          <input
            type="range"
            min={2}
            max={40}
            step={1}
            value={cfg.opacity}
            onChange={(event) => update({ opacity: Number(event.target.value) })}
          />
          <span className="wallpaper-opacity-value">{cfg.opacity}%</span>
        </label>
      )}
    </>
  );
}
