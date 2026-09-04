// ═══ WorkBuddy generative-widget 纯函数解析层（1:1 复刻 conversation-render）═══
// 本模块不依赖 React / DOM：输入 AI 消息文本，输出「已完成 widget 段 + 流式中 widget + 普通文本段」。
// 触发语法：正文里输出 ```show_widget {json} ``` 或 ```show-widget {json} ``` 或 ```widget {html} ```。
// 对齐 WorkBuddy：show_widget/show-widget 是 JSON fence（含 title/widget_code/loading_messages），
// widget/visualizer_widget 是裸 HTML fence（widget_code 直接是内容）。

export type ShowWidgetData = {
  title?: string;
  widget_code: string;
  loading_messages?: string[];
};

export type WidgetSegment =
  | { type: "text"; content: string }
  | { type: "widget"; data: ShowWidgetData };

export type WidgetParseResult = {
  segments: WidgetSegment[];
  /** 流式中尚未闭合的 widget（fence 已开未闭合），供渲染层做 loading 占位 */
  streamingWidget?: ShowWidgetData;
};

const FENCE_START_REGEX = /```(show_widget|show-widget|widget|visualizer_widget)\s*\n?/gi;
const FENCE_END = "```";

/** 判断围栏类型是否为 JSON 格式（show_widget / show-widget） */
function isJsonFence(fenceType: string) {
  const lower = fenceType.toLowerCase();
  return lower === "show_widget" || lower === "show-widget";
}

/** 流式阶段：<script> 标签尚未闭合时截断到上一个完整 <script> 前，避免 iframe 半截崩溃 */
export function trimUnclosedScriptBlock(code: string): string {
  if (!code) return code;
  const lastScriptOpen = code.lastIndexOf("<script");
  if (lastScriptOpen === -1) return code;
  const lastScriptClose = code.lastIndexOf("</script>");
  if (lastScriptClose === -1 || lastScriptClose < lastScriptOpen) return code.substring(0, lastScriptOpen);
  return code;
}

/** 尝试部分解析 JSON（流式阶段），拿 title + widget_code 的当前片段 */
export function parsePartialJson(content: string): ShowWidgetData | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  const result: Partial<ShowWidgetData> = {};
  const titleMatch = trimmed.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
  if (titleMatch) {
    try { result.title = JSON.parse(`"${titleMatch[1]}"`); } catch { result.title = titleMatch[1]; }
  }
  const widgetCodeStart = trimmed.indexOf('"widget_code"');
  if (widgetCodeStart !== -1) {
    const colonPos = trimmed.indexOf(":", widgetCodeStart);
    if (colonPos !== -1) {
      const valueStart = trimmed.indexOf('"', colonPos);
      if (valueStart !== -1) {
        let valueEnd = -1;
        let escape = false;
        for (let i = valueStart + 1; i < trimmed.length; i++) {
          if (escape) { escape = false; continue; }
          if (trimmed[i] === "\\") { escape = true; continue; }
          if (trimmed[i] === '"') { valueEnd = i; break; }
        }
        if (valueEnd !== -1) {
          try { result.widget_code = JSON.parse(trimmed.slice(valueStart, valueEnd + 1)); } catch { /* partial */ }
        }
      }
    }
  }
  return result.widget_code || result.title ? { widget_code: result.widget_code ?? "", title: result.title } : null;
}

/** 尝试解析完整 JSON 围栏内容，成功返回 ShowWidgetData，失败返回 null */
function parseJsonFenceContent(content: string): ShowWidgetData | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      if (typeof parsed.widget_code === "string") {
        return {
          title: typeof parsed.title === "string" ? parsed.title : undefined,
          widget_code: parsed.widget_code,
          loading_messages: Array.isArray(parsed.loading_messages) ? parsed.loading_messages.filter((m: unknown) => typeof m === "string") : undefined,
        };
      }
    }
  } catch { /* 不完整 JSON 返回 null */ }
  return null;
}

/** 裸 HTML fence：widget_code 直接是围栏内容 */
function parseRawFenceContent(content: string): ShowWidgetData {
  return { widget_code: content.trim() };
}

/**
 * 流式阶段解析：提取已完成的 widget 段 + 正在流式的部分 widget。
 * 与 WorkBuddy extractStreamingWidget 对齐：
 * - 完整 fence（```…``` 闭合）→ 解析成 widget 段
 * - 未闭合 fence → 作为 streamingWidget 返回（渲染层做 loading 占位）
 * - 围栏之间的文本 → 普通 text 段
 */
export function extractStreamingWidget(text: string): WidgetParseResult {
  const segments: WidgetSegment[] = [];
  let streamingWidget: ShowWidgetData | undefined;
  let lastIndex = 0;
  FENCE_START_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_START_REGEX.exec(text)) !== null) {
    const fenceStart = match.index;
    const fenceType = match[1];
    const contentStart = fenceStart + match[0].length;
    if (fenceStart > lastIndex) {
      const textContent = text.substring(lastIndex, fenceStart);
      if (textContent.trim()) segments.push({ type: "text", content: textContent });
    }
    const fenceEndPos = text.indexOf(FENCE_END, contentStart);
    if (fenceEndPos !== -1) {
      const content = text.substring(contentStart, fenceEndPos);
      if (isJsonFence(fenceType)) {
        const parsed = parseJsonFenceContent(content);
        if (parsed) segments.push({ type: "widget", data: parsed });
      } else {
        segments.push({ type: "widget", data: parseRawFenceContent(content) });
      }
      lastIndex = fenceEndPos + 3;
      if (text[lastIndex] === "\n") lastIndex++;
    } else {
      const partialContent = text.substring(contentStart);
      if (isJsonFence(fenceType)) streamingWidget = parsePartialJson(partialContent) || undefined;
      else streamingWidget = { widget_code: trimUnclosedScriptBlock(partialContent.trim()) };
      lastIndex = text.length;
      break;
    }
  }
  if (lastIndex < text.length) {
    const textContent = text.substring(lastIndex);
    if (textContent.trim()) segments.push({ type: "text", content: textContent });
  }
  return { segments, streamingWidget };
}

/** 文本是否含 widget fence（用于快速短路判断是否走 widget 解析路径） */
export function hasWidgetFence(text: string): boolean {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return lowerText.includes("```show_widget") || lowerText.includes("```show-widget") || lowerText.includes("```widget") || lowerText.includes("```visualizer_widget");
}
