/** runtime:list 的可选展示字段；旧版桌面壳可能不返回安装提示词。 */
export type RuntimeRow = DevRuntimeEntry & {
  bundled?: boolean;
  hidden?: boolean;
  fallbackPrompt?: string;
};
