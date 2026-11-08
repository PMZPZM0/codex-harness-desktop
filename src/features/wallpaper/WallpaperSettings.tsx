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
  depth: "3D 星空",
  custom: "静态壁纸",
};

/** 制作教程提示词（可整段复制发给 Codex）。⛔ 提到的清单必须与本文件注册表一致。 */
const GUIDE_PROMPTS: { id: string; title: string; prompt: string }[] = [
  {
    id: "theme",
    title: "做一套「明暗两段」主题（新增主题的全流程）",
    prompt: "请给应用加一套主题：① 在 src/lib/themes.ts 的 THEMES 里加一行 { id: \"<英文id>\", label: \"<中文名>\", preview: \"tpw-<英文id>\" }，并把 isDarkTheme() 纳入新 id（若为深色）；② 在 src/styles/01-base-and-chrome.css 里照 :root[data-theme=\"obsidian\"] 复制一段变量块改成新配色（bg/panel/panel-2/line/field/text/muted/accent/green/--ic-* 一套都要）；③ 深色专属规则只写 :root[data-theme-mode=\"dark\"]，不要再给新主题复制分支；④ electron/main.ts 的 DARK_THEME_IDS 加新 id，窗口底色按新主题取色；⑤ 在 src/styles/07-settings-mcp-connectors.css 补 .tpw-<英文id> 预览卡；⑥ 跑 npm run build:vite + 守卫 01，并同步 DESIGN.md。",
  },
  {
    id: "preset",
    title: "加一组风景壁纸（日/夜成对，自动跟随主题）",
    prompt: "请给应用加一组风景壁纸：用 image-generation 技能生成同一场景的**两张** 1792×1024 底图（一张白昼、一张夜晚，低对比、无文字无水印），分别存为 public/wallpapers/<id>-day.jpg 与 <id>-night.jpg；然后在 src/lib/wallpaper.mjs 的 WALLPAPER_PRESETS 里加一行 { id: \"<id>\", name: \"<中文名>\", day: \"wallpapers/<id>-day.jpg\", night: \"wallpapers/<id>-night.jpg\" }。浅色主题会自动显示 day、深色显示 night（.wp-sky-day/.wp-sky-night 由 data-theme-mode 切换），不用写 JS 判明暗；跑 npm run build:vite + 守卫 14。",
  },
  {
    id: "image",
    title: "做一张图片壁纸并直接设置（不改代码）",
    prompt: "请帮我做一张应用壁纸并直接设置：用生图工具按下面的要求出图——低对比度、大面积留白、无文字无水印、适合垫在聊天文字下方；把图保存到当前工作区（如 assets/wallpaper.png），然后调用 harness_tools 工具（name=\"wallpaper_set\"），参数 { \"mode\": \"custom\", \"image\": \"<图片绝对路径>\" }，让壁纸立刻生效。以后想换图，重复这个流程即可。",
  },
  {
    id: "sky",
    title: "调 3D 星空动态壁纸（白天/黑夜两套 + 鼠标交互）",
    prompt: "请调整应用 3D 星空动态壁纸：编辑 src/features/wallpaper/WallpaperLayer.tsx 的 DepthField —— ① 白天/黑夜两套调色板在 buildPalette() 里（浅色=日间天空+流云+淡星，深色=深空+星云+亮星），颜色一律从 CSS token 现读；② 鼠标交互：星点按 star.depth 做视差、指针处跟一团主题色柔光，nebulae/sun 也随 mx/my 偏移；③ 夜间流星节奏在 cycle = t % 7；④ 减动效偏好只画一帧。改完跑 npm run build:vite，切「3D 星空」档、白天/黑夜各看一遍。",
  },
  {
    id: "motion",
    title: "调极光 / 流光 / 光晕三档动态壁纸",
    prompt: "请调整应用动态光幕：编辑 src/styles/28-wallpaper.css 里 .wallpaper-motion 的三档（is-aurora 三团柔光的 color-mix 透明度、blur 半径、animation 时长；is-ribbon 光带高度/角度/速度；is-halo 光晕大小与呼吸周期），以及 WallpaperLayer.tsx 里 MotionVeil 的鼠标视差幅度 --wp-depth。颜色一律用主题 token（var(--accent) / var(--ic-*)），不要写死色值。改完跑 npm run build:vite 生效。",
  },
];

/** 壁纸设置：选图/纯色/动效，可当场预览。 */
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
            <span className="wallpaper-preset-face">
              <i className="wp-thumb-day" style={{ backgroundImage: `url("./${p.day}")` }} />
              <i className="wp-thumb-night" style={{ backgroundImage: `url("./${p.night}")` }} />
            </span>
            <span className="wallpaper-preset-name">{p.name}</span>
          </button>
        ))}
      </div>
      <div className="wallpaper-custom-row">
        <button type="button" className="secondary-setting" onClick={() => { void pickImage(); }}>选择本机图片…</button>
        {cfg.mode === "custom" && cfg.image && !isPresetImage(cfg.image) && (
          <button type="button" className="secondary-setting" onClick={() => update({ image: "" })}><Trash2 size={12} />清除</button>
        )}
        {cfg.mode === "custom" && cfg.image && !isPresetImage(cfg.image) && <span className="wallpaper-custom-path" title={cfg.image}>{cfg.image.split(/[\\/]/).pop()}</span>}
      </div>
    </>
  );
}