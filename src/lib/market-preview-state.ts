/** MarketPreviewState（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export type MarketPreviewState = {
  kind: "skill" | "plugin" | "mcp";
  title: string;
  subtitle?: string;
  icon?: string;
  iconChar?: string;
  description: string;
  meta: string[];
  installed: boolean;
  installLabel: string;
  onInstall?: () => void;
  externalLabel?: string;
  externalUrl?: string;
  note?: string;
  note2?: string;
};
