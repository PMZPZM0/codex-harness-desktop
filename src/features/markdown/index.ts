export { Markdown, MD_COMPONENTS, MdCode, MdBlock, FilePreviewCode } from "./Markdown";
/* 11-09：提及渲染作用域（群聊提供、Markdown 消费）。类型也一起导出，调用方不必再碰实现文件。 */
export { MentionScopeContext } from "./Markdown";
export type { MentionScope } from "./Markdown";
