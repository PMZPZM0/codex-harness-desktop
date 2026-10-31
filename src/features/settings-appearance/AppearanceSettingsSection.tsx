/**
 * 设置页 · appearance（09-21 从 App.tsx 内联块搬出；09-24 主题按钮改由注册表渲染）。
 *
 * props = 该块用到的 App 状态与回调。
 * ⛔ 主题按钮由 src/lib/themes.ts 的 THEMES 注册表渲染：新增主题 = 表里加一行
 *    + styles 里加一段 `:root[data-theme="<id>"]` 变量块，这里与 bag 零改动。
 */
import { Brain, FileCode2, List, Sun, ZoomIn } from "lucide-react";
import { flushSync } from "react-dom";
import { CodeAppearanceSection } from "../../components/CodeAppearance";
import { FunctionMenuSettings } from "../function-menu";
import { WallpaperSettingsSection } from "../wallpaper";
import { BootIntroSettingsRow } from "./boot550c";
import { THEMES } from "../../lib/themes";
import { setReasoningDisplayMode, useReasoningDisplayMode } from "../../lib/reasoning-display-mode";
import { setRunProcessMode, useRunProcessMode } from "../../lib/run-process-mode";
import { setDialogFlowMode, useDialogFlowMode } from "../../lib/dialog-flow-mode";
import { runVisualSwitch, themeLabelOf } from "../../lib/visual-switch";
import { SettingsPageHero } from "../../components/SettingsPageHero";

export type AppearanceSettingsSectionProps = { theme: any; setTheme: any; uiFont: any; setUiFont: any; onNotice?: (text: string) => void };

export function AppearanceSettingsSection(props: AppearanceSettingsSectionProps) {
  const { theme, setTheme, uiFont, setUiFont, onNotice } = props;
  const reasoningDisplay = useReasoningDisplayMode();
  const runProcessMode = useRunProcessMode();
  const dialogFlow = useDialogFlowMode();
  return (
    <>
      <section className="settings-section stack appearance-page settings-exp-page">
        <SettingsPageHero icon={<Sun size={20} />} title="外观" subtitle="主题、字号、代码与壁纸都在这里；改完即时生效，不用重启。" hint="点卡片即切换" />
        {/* 10-27 用户令：「你觉得这个界面现在好看嘛，都被隔开了」
            ⇒ 四个显示项不再各占一张卡，**合成一张卡里四行**（细线分隔），像一份设置清单；
            标题行左、胶囊右，说明只留在悬停提示里。 */}
        <div className="settings-exp-card appearance-base-card card-pill-rows">
          <div className="settings-pill-row">
            <span className="settings-pill-row-label"><Sun size={13} />主题</span>
            <div className="segmented-tabs row-pills" role="group" aria-label="主题">
              {THEMES.map((t) => (
                <button key={t.id} type="button" className={theme === t.id ? "active" : ""} aria-pressed={theme === t.id} title={`切换到${t.label}主题`} onClick={() => runVisualSwitch("主题", themeLabelOf(t.id), () => flushSync(() => setTheme(t.id)), onNotice)}>{t.label}</button>
              ))}
            </div>
          </div>
          <div className="settings-pill-row">
            <span className="settings-pill-row-label"><ZoomIn size={13} />消息字号</span>
            <div className="segmented-tabs row-pills" role="group" aria-label="消息字号">
              {[{ v: "compact", t: "紧凑" }, { v: "default", t: "标准" }, { v: "large", t: "大字" }].map((opt) => (
                <button key={opt.v} type="button" className={uiFont === opt.v ? "active" : ""} aria-pressed={uiFont === opt.v} title={`对话正文与过程内容用「${opt.t}」字号`} onClick={() => { if (uiFont === opt.v) return; setUiFont(opt.v); localStorage.setItem("ui-font", opt.v); onNotice?.(`消息字号：${opt.t}`); }}>{opt.t}</button>
              ))}
            </div>
          </div>
          <div className="settings-pill-row">
            <span className="settings-pill-row-label"><Brain size={13} />思考板块</span>
            <div className="segmented-tabs row-pills" role="group" aria-label="思考板块展示">
              <button type="button" className={reasoningDisplay === "auto" ? "active" : ""} aria-pressed={reasoningDisplay === "auto"} title="浮窗跟随输入框宽度，按可用空间自动向上 / 向下展开（默认）" onClick={() => { if (reasoningDisplay === "auto") return; setReasoningDisplayMode("auto"); onNotice?.("思考板块：自适应展开"); }}>自适应展开</button>
              <button type="button" className={reasoningDisplay === "strip" ? "active" : ""} aria-pressed={reasoningDisplay === "strip"} title="消息流内长条按行展示思考内容，点击标题或正文展开全文" onClick={() => { if (reasoningDisplay === "strip") return; setReasoningDisplayMode("strip"); onNotice?.("思考板块：长条按行"); }}>长条按行</button>
            </div>
          </div>
          <div className="settings-pill-row">
            <span className="settings-pill-row-label"><FileCode2 size={13} />运行过程</span>
            <div className="segmented-tabs row-pills" role="group" aria-label="运行过程">
              <button type="button" className={runProcessMode === "simple" ? "active" : ""} aria-pressed={runProcessMode === "simple"} title="只显示文件编辑行与实时 +N -M，不自动展开内容（默认）" onClick={() => { if (runProcessMode === "simple") return; setRunProcessMode("simple"); onNotice?.("运行过程：简洁"); }}>简洁</button>
              <button type="button" className={runProcessMode === "detailed" ? "active" : ""} aria-pressed={runProcessMode === "detailed"} title="文件变化时弹浮窗，跟随最新内容 / diff，静止 3 秒自动收起" onClick={() => { if (runProcessMode === "detailed") return; setRunProcessMode("detailed"); onNotice?.("运行过程：详细"); }}>详细</button>
            </div>
          </div>
          {/* ⛔ 10-31 用户令：「运行过程下面加一个，这个对话流，简洁 详细，默认简洁」——
              与上一行**是两件事**（那个管单条卡片要不要跟着弹内容，这个管正文之间要不要收成一个块）。
              ⛔ 顺序是用户点名的（就压在运行过程下面），别挪到别的卡片里去。 */}
          <div className="settings-pill-row">
            <span className="settings-pill-row-label"><List size={13} />对话流</span>
            <div className="segmented-tabs row-pills" role="group" aria-label="对话流">
              <button type="button" className={dialogFlow === "simple" ? "active" : ""} aria-pressed={dialogFlow === "simple"} title="正文之间只留一个过程块，块头一直显示最新一步（跟着流实时换），点开看全部（默认）" onClick={() => { if (dialogFlow === "simple") return; setDialogFlowMode("simple"); onNotice?.("对话流：简洁"); }}>简洁</button>
              <button type="button" className={dialogFlow === "detailed" ? "active" : ""} aria-pressed={dialogFlow === "detailed"} title="过程逐条展示：正在跑的那一段直接铺在正文之间，工具卡各自可见" onClick={() => { if (dialogFlow === "detailed") return; setDialogFlowMode("detailed"); onNotice?.("对话流：详细"); }}>详细</button>
            </div>
          </div>
        </div>
        <div className="settings-exp-card appearance-function-card"><FunctionMenuSettings onNotice={onNotice} /></div>
        <div className="settings-exp-card appearance-wallpaper-card"><WallpaperSettingsSection /></div>
        <div className="settings-exp-card appearance-boot-card"><BootIntroSettingsRow onNotice={onNotice} /></div>
        <div className="settings-exp-card appearance-code-card"><CodeAppearanceSection onNotice={onNotice} /></div>
      </section>
    </>
  );
}
