/**
 * 外观设置页的「壁纸」段（wallpaper 域，2026-10-05）：自包含（localStorage + 自定义事件），
 * ⛔ 不进 bag —— 只有本页与壁纸层两个消费方（样板 = codex-official-market 的本地 state 口径）。
 */
import { useEffect, useState } from "react";
import { BookOpen, Copy, ImagePlus, Trash2 } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
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

/** 制作教程提示词（10-06 用户：「怎么做壁纸几个类型都做好提示词，放 ? 号教程，支持复制」）。
 *  每条都能整段复制后直接发给 Codex 执行；⛔ 提示词里提到的 id 清单必须与本文件注册表一致。 */
const GUIDE_PROMPTS: { id: string; title: string; prompt: string }[] = [
  {
    id: "preset",
    title: "做一款精选渐变壁纸（无需找图，改一款即全局生效）",
    prompt: "请给应用壁纸加一款精选渐变：在 src/lib/wallpaper.mjs 的 WALLPAPER_PRESETS 数组里新增一项 { id: \"<英文id>\", name: \"<中文名>\", css: \"…\" }。css 用 3~4 层 radial-gradient(at x% y%, 颜色 0px, transparent 55%) 叠加、最后一层 linear-gradient 打底；先定一个主色再取邻近色，深色款四角都要压暗。加完跑 npm run build:vite，设置页缩略图会自动出现。",
  },
  {
    id: "pattern",
    title: "做一款平铺图案壁纸（几何纹理，跟主题色）",
    prompt: "请给应用壁纸加一款平铺图案：在 src/lib/wallpaper.mjs 的 WALLPAPER_PATTERNS 里新增 { id, name, tile }。tile 是 48×48 的 SVG data-uri（形状用白色、走 CSS mask，颜色由主题主色自动提供）；先想好几何母题（蜂窝 / 三角 / 十字编织 / 波浪叠层…）再写 path，线条 1.2px 左右。加完跑 npm run build:vite 生效。",
  },
  {
    id: "image",
    title: "做一张图片壁纸并直接设置（不改代码，Codex 全程自助）",
    prompt: "请帮我做一张应用壁纸并直接设置：用生图工具按下面的要求出图——低对比度、大面积留白、无文字无水印、色彩不超过三组、适合垫在聊天文字下方；把图保存到当前工作区（如 assets/wallpaper.png），然后调用 harness_tools 工具（name=\"wallpaper_set\"），参数 { \"mode\": \"custom\", \"image\": \"<图片绝对路径>\" }，让壁纸立刻生效。以后想换图，重复这个流程即可。",
  },
  {
    id: "motion",
    title: "调粒子 / 3D 背景的效果参数",
    prompt: "请调整壁纸粒子效果：编辑 src/features/wallpaper/ParticlesPane.tsx 的 options——数量 number.value、点半径 size.value、连线距离 links.distance 与透明度 links.opacity（数值越大越热闹）。改完跑 npm run build:vite 重启生效。想要 3D 网格背景就选壁纸模式里的「3D 背景」（vanta NET，基于 three.js）。",
  },
];

export function WallpaperSettingsSection() {
  const [cfg, setCfg] = useState(() => readWallpaper());
  useEffect(() => subscribeWallpaper(setCfg as (c: ReturnType<typeof readWallpaper>) => void), []);
  const [guideOpen, setGuideOpen] = useState(false);
  const [copiedId, setCopiedId] = useState("");

  const update = (patch: Partial<ReturnType<typeof readWallpaper>>) => setCfg(saveWallpaper({ ...cfg, ...patch }));

  const copyPrompt = async (id: string, prompt: string) => {
    await copyTextToClipboard(prompt);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? "" : cur)), 1600);
  };

  const pickImage = async () => {
    const picked: unknown = await window.codex.chooseImages();
    const first = Array.isArray(picked) ? picked[0] : (picked as string | undefined);
    if (typeof first === "string" && first) update({ mode: "custom", image: first });
  };

  return (
    <>
      <div className="settings-subhead">
        <ImagePlus size={13} />壁纸<span className="settings-subhead-hint">铺满应用（侧栏/聊天/输入框半透明透出）；动效在减动效偏好下自动退回图案</span>
        <button type="button" className={`wallpaper-guide-toggle ${guideOpen ? "active" : ""}`} title="让 Codex 给你做壁纸——每种类型的提示词，可复制" onClick={() => setGuideOpen((v) => !v)}>
          <BookOpen size={12} />? 制作教程
        </button>
      </div>
      {guideOpen && (
        <div className="wallpaper-guide" role="region" aria-label="壁纸制作教程">
          <p className="wallpaper-guide-intro">把下面的提示词整段复制发给 Codex，它就会按类型做出壁纸并设置好；也可以直接说「给壁纸加一款 XX 风格」让它自己选类型。</p>
          {GUIDE_PROMPTS.map((g) => (
            <div key={g.id} className="wallpaper-guide-card">
              <div className="wallpaper-guide-head">
                <span className="wallpaper-guide-title">{g.title}</span>
                <button type="button" className="wallpaper-guide-copy" onClick={() => { void copyPrompt(g.id, g.prompt); }}>
                  <Copy size={11} />{copiedId === g.id ? "已复制" : "复制提示词"}
                </button>
              </div>
              <pre className="wallpaper-guide-prompt">{g.prompt}</pre>
            </div>
          ))}
        </div>
      )}
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
