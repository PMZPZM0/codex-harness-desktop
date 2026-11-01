/**
 * 外观设置页的「壁纸」段（wallpaper 域，10-05 立；11-02 重做）。
 *
 * 11-02 用户：「把旧的壁纸删了，多做几套新的…你生成一些好看的壁纸，静态动态，你全部重新做」
 *   ⇒ 只剩 5 档：关 / 极光 / 流光 / 光晕 / 静态壁纸（6 张生成图）。
 * ⛔ 旧图案/粒子/星空与滑杆全部删除 —— 不要再加回来（守卫 14 有负向断言）。
 */
import { useEffect, useState } from "react";
import { BookOpen, Copy, ImagePlus, Trash2 } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import { WALLPAPER_MODES, WALLPAPER_PRESETS, isPresetImage, readWallpaper, saveWallpaper, subscribeWallpaper } from "../../lib/wallpaper.mjs";

const MODE_LABELS: Record<string, string> = {
  off: "关闭",
  aurora: "极光",
  ribbon: "流光",
  halo: "光晕",
  custom: "静态壁纸",
};

/** 制作教程提示词（可整段复制发给 Codex）。⛔ 提到的清单必须与本文件注册表一致。 */
const GUIDE_PROMPTS: { id: string; title: string; prompt: string }[] = [
  {
    id: "preset",
    title: "再加一张静态壁纸（生图 → 落 public/wallpapers → 注册）",
    prompt: "请给应用加一张静态壁纸：用 image-generation 技能生成一张 1792×1024 的高级感底图（抽象材质、低对比、大面积留白、无文字无水印无主体），保存为 public/wallpapers/<英文id>.jpg；然后在 src/lib/wallpaper.mjs 的 WALLPAPER_PRESETS 里加一行 { id: \"<英文id>\", name: \"<中文名>\", src: \"wallpapers/<英文id>.jpg\" }；跑 npm run build:vite 后设置页缩略图会自动出现。",
  },
  {
    id: "image",
    title: "做一张图片壁纸并直接设置（不改代码）",
    prompt: "请帮我做一张应用壁纸并直接设置：用生图工具按下面的要求出图——低对比度、大面积留白、无文字无水印、适合垫在聊天文字下方；把图保存到当前工作区（如 assets/wallpaper.png），然后调用 harness_tools 工具（name=\"wallpaper_set\"），参数 { \"mode\": \"custom\", \"image\": \"<图片绝对路径>\" }，让壁纸立刻生效。以后想换图，重复这个流程即可。",
  },
  {
    id: "motion",
    title: "调动态壁纸的观感（极光 / 流光 / 光晕）",
    prompt: "请调整应用动态壁纸：编辑 src/styles/28-wallpaper.css 里 .wallpaper-motion 的三档（is-aurora 三团柔光的 `color-mix(... N%, transparent)` 透明度、blur 半径、animation 时长；is-ribbon 光带的高度/角度/速度；is-halo 光晕大小与呼吸周期），以及 src/features/wallpaper/WallpaperLayer.tsx 里 MotionVeil 的鼠标视差幅度 --wp-depth。改完跑 npm run build:vite 重启生效。颜色一律用主题 token（var(--accent) / var(--ic-*)），不要写死色值。",
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
        <ImagePlus size={13} />壁纸<span className="settings-subhead-hint">铺满应用（侧栏/聊天/输入框半透明透出）；动态档在减动效偏好下自动静帧</span>
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
      <div className="theme-switch wallpaper-modes" role="group" aria-label="壁纸模式">
        {WALLPAPER_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={cfg.mode === mode ? "active" : ""}
            onClick={() => {
              /* 切到「静态壁纸」但还没选图时，自动用第一张 —— 否则是"选了模式却什么都没有"的空白态。 */
              if (mode === "custom" && !cfg.image) update({ mode, image: `preset:${WALLPAPER_PRESETS[0].id}` });
              else update({ mode });
            }}
          >
            {MODE_LABELS[mode] ?? mode}
          </button>
        ))}
      </div>
      {/* 6 张静态壁纸**常驻展示**（不再藏在「静态壁纸」按钮后面 —— 用户实测「那里啊」，根本找不到） */}
      <div className="wallpaper-preset-hint">静态壁纸<span>点图即用；也可以选本机图片</span></div>
      <div className="wallpaper-preset-grid" role="group" aria-label="静态壁纸">
        {WALLPAPER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`wallpaper-preset-card ${cfg.mode === "custom" && cfg.image === `preset:${p.id}` ? "active" : ""}`}
            aria-pressed={cfg.mode === "custom" && cfg.image === `preset:${p.id}`}
            title={p.name}
            onClick={() => update({ mode: "custom", image: `preset:${p.id}` })}
          >
            <span className="wallpaper-preset-face" style={{ backgroundImage: `url("./${p.src}")` }} />
            <span className="wallpaper-preset-name">{p.name}</span>
          </button>
        ))}
      </div>
      <div className="wallpaper-custom-row">
        <button type="button" className="btn" onClick={() => { void pickImage(); }}>选择本机图片…</button>
        {cfg.mode === "custom" && cfg.image && !isPresetImage(cfg.image) && (
          <button type="button" className="btn" onClick={() => update({ image: "" })}><Trash2 size={12} />清除</button>
        )}
        {cfg.mode === "custom" && cfg.image && !isPresetImage(cfg.image) && <span className="wallpaper-custom-path" title={cfg.image}>{cfg.image.split(/[\\/]/).pop()}</span>}
      </div>
    </>
  );
}