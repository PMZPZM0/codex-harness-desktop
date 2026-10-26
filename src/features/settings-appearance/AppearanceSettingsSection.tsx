/**
 * 设置页 · appearance（09-21 从 App.tsx 内联块搬出；09-24 主题按钮改由注册表渲染）。
 *
 * props = 该块用到的 App 状态与回调。
 * ⛔ 主题按钮由 src/lib/themes.ts 的 THEMES 注册表渲染：新增主题 = 表里加一行
 *    + styles 里加一段 `:root[data-theme="<id>"]` 变量块，这里与 bag 零改动。
 */
import { Brain, Check, FileCode2, Moon, Sun, ZoomIn } from "lucide-react";
import { CodeAppearanceSection } from "../../components/CodeAppearance";
import { FunctionMenuSettings } from "../function-menu";
import { WallpaperSettingsSection } from "../wallpaper";
import { BootIntroSettingsRow } from "./boot550c";
import { THEMES } from "../../lib/themes";
import { setReasoningDisplayMode, useReasoningDisplayMode } from "../../lib/reasoning-display-mode";
import { setRunProcessMode, useRunProcessMode } from "../../lib/run-process-mode";
import { runVisualSwitch, themeLabelOf } from "../../lib/visual-switch";
import { SettingsPageHero } from "../../components/SettingsPageHero";

export type AppearanceSettingsSectionProps = { theme: any; setTheme: any; uiFont: any; setUiFont: any; onNotice?: (text: string) => void };

export function AppearanceSettingsSection(props: AppearanceSettingsSectionProps) {
  const { theme, setTheme, uiFont, setUiFont, onNotice } = props;
  const reasoningDisplay = useReasoningDisplayMode();
  const runProcessMode = useRunProcessMode();
  return (
    <>
      <section className="settings-section stack appearance-page settings-exp-page">
        <SettingsPageHero icon={<Sun size={20} />} title="外观" subtitle="主题、字号、代码与壁纸都在这里；改完即时生效，不用重启。" hint="点卡片即切换" />
        <div className="settings-exp-card appearance-base-card">
        <div className="settings-subhead"><Sun size={13} />主题<span className="settings-subhead-hint">点击预览卡片即时切换</span></div>
        <div className="theme-preview-grid" role="group" aria-label="主题">
          {/* 10-07 用户要求：切换加过渡 + 切换完成后给回执。
              ⛔ 走 src/lib/visual-switch 的统一入口（挂过渡 → 应用 → 摘过渡 + 发回执），
                 不在这里各写一份 —— 侧栏的快捷明暗钮用的是同一条链，两处观感必须一致。 */}
          {THEMES.map((t) => (
            <button key={t.id} type="button" className={`theme-preview ${theme === t.id ? "active" : ""}`} aria-pressed={theme === t.id} onClick={() => runVisualSwitch("主题", themeLabelOf(t.id), () => setTheme(t.id), onNotice)}>
              <span className={`theme-preview-window ${t.preview}`}>
                <span className="tpw-titlebar"><i /><i /><i /><b /></span>
                <span className="tpw-body">
                  <span className="tpw-side"><i /><i /><i /></span>
                  <span className="tpw-main"><i /><i /><i className="short" /></span>
                </span>
              </span>
              <span className="theme-preview-label">{t.id === "light" ? <Sun size={13} /> : <Moon size={13} />}{t.label}{theme === t.id ? <em><Check size={11} /></em> : null}</span>
            </button>
          ))}
        </div>
        <div className="settings-subhead"><ZoomIn size={13} />消息字号<span className="settings-subhead-hint">影响对话正文与过程内容</span></div>
        <div className="theme-switch three" role="group" aria-label="字号">
          <button type="button" className={uiFont === "compact" ? "active" : ""} onClick={() => { setUiFont("compact"); localStorage.setItem("ui-font", "compact"); }}><span className="fs-demo fs-demo-compact">紧凑</span></button>
          <button type="button" className={uiFont === "default" ? "active" : ""} onClick={() => { setUiFont("default"); localStorage.setItem("ui-font", "default"); }}><span className="fs-demo fs-demo-default">标准</span></button>
          <button type="button" className={uiFont === "large" ? "active" : ""} onClick={() => { setUiFont("large"); localStorage.setItem("ui-font", "large"); }}><span className="fs-demo fs-demo-large">大字</span></button>
        </div>
        </div>
        <div className="settings-card card-reasoning">
          <div className="settings-card-head"><Brain size={15} /><strong>思考板块展示</strong><span className="settings-subhead-hint">立即生效，无需重启</span></div>
          <div className="settings-card-body">
            <div className="perm-seg reasoning-mode-seg">
              <button type="button" className={`perm-seg-btn ${reasoningDisplay === "auto" ? "on" : ""}`} onClick={() => setReasoningDisplayMode("auto")}>
                <strong>自适应展开</strong>
                <small>浮窗跟随输入框宽度，按可用空间自动向上/向下展开（默认）</small>
                {reasoningDisplay === "auto" && <em>当前</em>}
              </button>
              <button type="button" className={`perm-seg-btn ${reasoningDisplay === "strip" ? "on" : ""}`} onClick={() => setReasoningDisplayMode("strip")}>
                <strong>长条按行</strong>
                <small>消息流内长条按行展示思考内容，点击标题或正文展开全文</small>
                {reasoningDisplay === "strip" && <em>当前</em>}
              </button>
            </div>
            <p className="settings-card-hint">只影响思考内容的呈现方式，不会改变模型思考本身或历史记录。长条模式收起时与过程行同款，只显示最新一行（自动横向滚动）；当前正在直播的思考内联显示，已经结束的思考与其他过程在直播末段超过 8 条会自动收起，回合结束后统一收进「耗时」大折叠。点击长条展开全文，最高 50vh 内部滚动。</p>
          </div>
        </div>
        <div className="settings-card card-run-process">
          <div className="settings-card-head"><FileCode2 size={15} /><strong>运行过程</strong><span className="settings-subhead-hint">立即生效，无需重启</span></div>
          <div className="settings-card-body">
            <div className="perm-seg reasoning-mode-seg">
              <button type="button" className={`perm-seg-btn ${runProcessMode === "simple" ? "on" : ""}`} onClick={() => setRunProcessMode("simple")}>
                <strong>简洁</strong>
                <small>只显示文件编辑行与实时 +N -M，不自动展开内容（默认）</small>
                {runProcessMode === "simple" && <em>当前</em>}
              </button>
              <button type="button" className={`perm-seg-btn ${runProcessMode === "detailed" ? "on" : ""}`} onClick={() => setRunProcessMode("detailed")}>
                <strong>详细</strong>
                <small>文件变化时弹浮窗，跟随最新内容 / diff，静止 3 秒自动收起（只浮最近变化的那个）</small>
                {runProcessMode === "detailed" && <em>当前</em>}
              </button>
            </div>
            <p className="settings-card-hint">只影响运行过程中的文件展示，不改变生成/修改本身。详细模式在文件变化时弹出浮窗并自动滚到最新：新文件显示内容，修改 / 删除显示 diff；停止变化 3 秒后自动收起，多个文件同时改时只浮最近变化的那个。文件行最多列 8 个，其余收进「还有 N 个文件」。</p>
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
