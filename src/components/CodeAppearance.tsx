import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { Check, ListOrdered, Palette, Type, WrapText } from "lucide-react";
import { codeFonts, codePreviewSnippet, codeThemes } from "../lib/code-themes";
import { setCodeSettings, useCodeSettings, type CodeFontScale } from "../lib/code-settings";

/** 预览用的极简渲染：不引 highlighter 之外的新依赖，10 张卡片同时渲染也够快 */
function ThemePreview({ style, background }: { style: Record<string, React.CSSProperties>; background: string }) {
  return (
    <span className="code-theme-preview" style={{ background }}>
      <SyntaxHighlighter
        language="javascript"
        style={style}
        PreTag="span"
        CodeTag="span"
        useInlineStyles
        customStyle={{ margin: 0, padding: 0, background: "transparent", fontSize: 9, lineHeight: 1.45 }}
        codeTagProps={{ style: { fontFamily: "inherit", fontSize: 9 } }}
      >
        {codePreviewSnippet}
      </SyntaxHighlighter>
    </span>
  );
}

/**
 * 外观页的「代码显示」区块：高亮主题 / 代码字体 / 字号 / 行号 / 换行。
 * 全部走 lib/code-settings 的外部 store，改完对话里已渲染的代码块立即重绘。
 */
export function CodeAppearanceSection() {
  const settings = useCodeSettings();
  const scales: { value: CodeFontScale; label: string }[] = [
    { value: "small", label: "小" },
    { value: "default", label: "标准" },
    { value: "large", label: "大" },
  ];

  return (
    <>
      <div className="settings-subhead">
        <Palette size={13} />代码高亮<span className="settings-subhead-hint">对话、命令与文件差异即时切换</span>
      </div>
      <div className="code-theme-grid" role="group" aria-label="代码高亮主题">
        {codeThemes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={`code-theme-card ${settings.theme === theme.id ? "active" : ""}`}
            aria-pressed={settings.theme === theme.id}
            onClick={() => setCodeSettings({ theme: theme.id })}
          >
            <ThemePreview style={theme.style} background={theme.background} />
            <span className="code-theme-label">
              <span className="code-theme-dot" style={{ background: theme.background, borderColor: theme.foreground }} />
              {theme.label}
              {settings.theme === theme.id ? <em><Check size={11} /></em> : null}
            </span>
          </button>
        ))}
      </div>

      <div className="settings-subhead">
        <Type size={13} />代码字体<span className="settings-subhead-hint">未安装的字体会自动回退到系统等宽字体</span>
      </div>
      <div className="code-font-grid" role="group" aria-label="代码字体">
        {codeFonts.map((font) => (
          <button
            key={font.id}
            type="button"
            className={`code-font-card ${settings.font === font.id ? "active" : ""}`}
            aria-pressed={settings.font === font.id}
            onClick={() => setCodeSettings({ font: font.id })}
          >
            <span className="code-font-sample" style={{ fontFamily: font.stack }}>
              {"fn main() { }"}
            </span>
            <span className="code-font-label">
              {font.label}
              {settings.font === font.id ? <em><Check size={11} /></em> : null}
            </span>
          </button>
        ))}
      </div>

      <div className="settings-subhead"><Type size={13} />代码字号</div>
      <div className="theme-switch three" role="group" aria-label="代码字号">
        {scales.map((scale) => (
          <button
            key={scale.value}
            type="button"
            className={settings.fontScale === scale.value ? "active" : ""}
            onClick={() => setCodeSettings({ fontScale: scale.value })}
          >
            <span className={`fs-demo fs-demo-${scale.value === "small" ? "compact" : scale.value === "large" ? "large" : "default"}`}>{scale.label}</span>
          </button>
        ))}
      </div>

      <div className="settings-subhead"><WrapText size={13} />代码块行为</div>
      <div className="appearance-list">
        <label className="appearance-row">
          <span className="appearance-row-icon"><ListOrdered size={14} /></span>
          <span className="appearance-row-text"><strong>显示行号</strong><small>长代码块更好定位，讨论代码时更方便</small></span>
          <span className="switch"><input type="checkbox" checked={settings.lineNumbers} onChange={(event) => setCodeSettings({ lineNumbers: event.target.checked })} /><i /></span>
        </label>
        <label className="appearance-row">
          <span className="appearance-row-icon"><WrapText size={14} /></span>
          <span className="appearance-row-text"><strong>长行自动换行</strong><small>关闭时超长代码横向滚动，保留原始缩进</small></span>
          <span className="switch"><input type="checkbox" checked={settings.wrap} onChange={(event) => setCodeSettings({ wrap: event.target.checked })} /><i /></span>
        </label>
      </div>
    </>
  );
}
