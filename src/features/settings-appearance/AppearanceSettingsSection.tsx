/**
 * 设置页 · appearance（09-21 从 App.tsx 内联块搬出；09-24 主题按钮改由注册表渲染）。
 *
 * props = 该块用到的 App 状态与回调。
 * ⛔ 主题按钮由 src/lib/themes.ts 的 THEMES 注册表渲染：新增主题 = 表里加一行
 *    + styles 里加一段 `:root[data-theme="<id>"]` 变量块，这里与 bag 零改动。
 */
import { Check, Moon, Sun, ZoomIn } from "lucide-react";
import { CodeAppearanceSection } from "../../components/CodeAppearance";
import { THEMES } from "../../lib/themes";

export type AppearanceSettingsSectionProps = { theme: any; setTheme: any; uiFont: any; setUiFont: any };

export function AppearanceSettingsSection(props: AppearanceSettingsSectionProps) {
  const { theme, setTheme, uiFont, setUiFont } = props;
  return (
    <>
      <section className="settings-section stack appearance-page">
        <div className="settings-copy"><h2>外观</h2><p>主题、字号与代码显示，即时生效并保存在本机。</p></div>
        <div className="settings-subhead"><Sun size={13} />主题<span className="settings-subhead-hint">点击预览卡片即时切换</span></div>
        <div className="theme-preview-grid" role="group" aria-label="主题">
          {THEMES.map((t) => (
            <button key={t.id} type="button" className={`theme-preview ${theme === t.id ? "active" : ""}`} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
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
        <CodeAppearanceSection />
      </section>
    </>
  );
}
