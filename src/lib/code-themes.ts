import { oneDark, oneLight, dracula, nord, vscDarkPlus, vs, tomorrow, materialOceanic, gruvboxDark, solarizedlight } from "react-syntax-highlighter/dist/esm/styles/prism";

export type CodeThemeId =
  | "one-dark" | "one-light" | "vscode-dark" | "vscode-light" | "dracula"
  | "nord" | "gruvbox-dark" | "material-oceanic" | "tomorrow" | "solarized-light";

type CodeThemeEntry = {
  id: CodeThemeId;
  label: string;
  /** 明暗倾向，用于随界面主题给出默认值 */
  tone: "dark" | "light";
  style: Record<string, React.CSSProperties>;
  /** 预览卡的背景与前景，避免为了取色去加载高亮器 */
  background: string;
  foreground: string;
};

export const codeThemes: CodeThemeEntry[] = [
  { id: "one-dark", label: "One Dark", tone: "dark", style: oneDark as any, background: "#282c34", foreground: "#abb2bf" },
  { id: "vscode-dark", label: "VS Code 深色", tone: "dark", style: vscDarkPlus as any, background: "#1e1e1e", foreground: "#d4d4d4" },
  { id: "dracula", label: "Dracula", tone: "dark", style: dracula as any, background: "#282a36", foreground: "#f8f8f2" },
  { id: "nord", label: "Nord", tone: "dark", style: nord as any, background: "#2e3440", foreground: "#d8dee9" },
  { id: "gruvbox-dark", label: "Gruvbox", tone: "dark", style: gruvboxDark as any, background: "#282828", foreground: "#ebdbb2" },
  { id: "material-oceanic", label: "Material Ocean", tone: "dark", style: materialOceanic as any, background: "#0f111a", foreground: "#8f93a2" },
  { id: "one-light", label: "One Light", tone: "light", style: oneLight as any, background: "#fafafa", foreground: "#383a42" },
  { id: "vscode-light", label: "VS Code 浅色", tone: "light", style: vs as any, background: "#ffffff", foreground: "#1f1f1f" },
  { id: "tomorrow", label: "Tomorrow", tone: "light", style: tomorrow as any, background: "#ffffff", foreground: "#4d4d4c" },
  { id: "solarized-light", label: "Solarized", tone: "light", style: solarizedlight as any, background: "#fdf6e3", foreground: "#657b83" },
];

const themeMap = new Map(codeThemes.map((entry) => [entry.id, entry]));

export function codeThemeStyle(id: string | undefined, fallback: CodeThemeId = "one-dark") {
  return (themeMap.get(id as CodeThemeId) ?? themeMap.get(fallback)!).style;
}

export type CodeFontId = "system" | "jetbrains" | "fira" | "cascadia" | "source";

export const codeFonts: { id: CodeFontId; label: string; stack: string; sample: string }[] = [
  { id: "system", label: "跟随系统", stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace', sample: "Aa" },
  { id: "jetbrains", label: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace', sample: "Aa" },
  { id: "fira", label: "Fira Code", stack: '"Fira Code", ui-monospace, Menlo, Consolas, monospace', sample: "Aa" },
  { id: "cascadia", label: "Cascadia Code", stack: '"Cascadia Code", ui-monospace, Consolas, monospace', sample: "Aa" },
  { id: "source", label: "Source Code Pro", stack: '"Source Code Pro", ui-monospace, Menlo, monospace', sample: "Aa" },
];

export function codeFontStack(id: string | undefined) {
  return (codeFonts.find((entry) => entry.id === id) ?? codeFonts[0]).stack;
}

/** 预览片段：主题卡与字体卡共用，保证对比的是同一段代码 */
export const codePreviewSnippet = `const answer = await codex.ask({
  theme: "one-dark",
  stream: true,
});`;
