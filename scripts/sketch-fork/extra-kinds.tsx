/**
 * extra-kinds —— Codex Harness 给上游 m3e-canvas 打的**组件补丁层**（10-06 用户：
 * 「3800个组件你从中调一些常用的组件做成图里面这些组件啊，现在默认组件太少」）。
 *
 * 八个常用组件（与现有 36 种同级的 kind：可拖放、可连导航、进提示词、进校验）：
 *   avatar 头像 / skeleton 骨架屏 / rating 评分 / tooltip 提示气泡 /
 *   expansionPanel 展开面板 / segmentedButton 分段按钮 / stepper 步骤条 / timeline 时间线
 *
 * 施工方式：`scripts/sketch-fork/build.mjs` 在钉死的上游提交上把本文件复制到 `lib/extra-kinds.tsx`，
 * 再对 tokens/i18n/prompt/M3Node/PartInspector 做定点插入（锚点唯一性由构建脚本断言），
 * 然后 `next build` 出新的静态导出 → `build-sketch-bundle.mjs --from` 覆盖随包产物。
 *
 * ⛔ 硬约束（保可编译、防循环依赖）：本文件**只允许 type-import** 上游的 `./tokens`
 *    （运行时零依赖它）；运行时只依赖 react 与 `./i18n` 的 `getLang`。
 */
import type { ReactElement } from "react";
import type { IconSlot, Item, Kind, KindSpec, Palette } from "./tokens";
import type { Lang } from "./i18n";

/* ---------------------------------------------------------------- 名单 / 判定 */

export const EXTRA_KINDS = [
  "avatar",
  "skeleton",
  "rating",
  "tooltip",
  "expansionPanel",
  "segmentedButton",
  "stepper",
  "timeline",
] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];
export const isExtraKind = (k: Kind): k is ExtraKind => (EXTRA_KINDS as readonly string[]).includes(k);

/* 检视器分节判据（PartInspector 的补丁点用）。 */
export const isExtraTextKind = (k: Kind) => k === "avatar" || k === "tooltip" || k === "expansionPanel";
export const isExtraEntriesKind = (k: Kind) => k === "segmentedButton" || k === "stepper" || k === "timeline";
export const isExtraValueKind = (k: Kind) => k === "rating" || k === "stepper";

/* ---------------------------------------------------------------- 组件规格（KIND_SPEC 同型） */

export const EXTRA_KIND_SPECS: Record<ExtraKind, KindSpec> = {
  avatar: {
    label: "Avatar",
    noun: "アバター",
    category: "content",
    paletteIcon: "account_circle",
    w: 56,
    h: 56,
    radius: 28,
    hasVariant: true,
    hasLabel: true,
    hasSupporting: false,
    hasIcon: true,
    size: { min: 40, max: 96, step: 4, icon: "width", presets: [40, 56, 72, 96] },
    defLabel: "",
    defIcon: null,
    defSize: 56,
    defVariant: "filled",
  },
  skeleton: {
    label: "Skeleton",
    noun: "スケルトン",
    category: "content",
    paletteIcon: "view_stream",
    w: 380,
    h: 96,
    radius: 12,
    hasVariant: false,
    hasLabel: false,
    hasSupporting: false,
    hasIcon: false,
    size: { min: 120, max: 412, step: 4, icon: "width", presets: [182, 380, 412] },
    size2: { min: 24, max: 320, step: 4, icon: "height", presets: [48, 96, 160] },
    defLabel: "",
    defIcon: null,
    defSize: 380,
  },
  rating: {
    label: "Rating",
    noun: "評価",
    category: "inputs",
    paletteIcon: "star",
    w: 176,
    h: 40,
    radius: 0,
    hasVariant: false,
    hasLabel: false,
    hasSupporting: false,
    hasIcon: false,
    hasValue: true,
    size: { min: 20, max: 48, step: 4, icon: "star", presets: [24, 32, 40] },
    defLabel: "",
    defIcon: null,
    defSize: 32,
  },
  tooltip: {
    label: "Tooltip",
    noun: "ツールチップ",
    category: "containment",
    paletteIcon: "info",
    w: 180,
    h: 36,
    radius: 8,
    hasVariant: false,
    hasLabel: true,
    hasSupporting: false,
    hasIcon: false,
    size: { min: 96, max: 412, step: 4, icon: "width", presets: [140, 180, 240] },
    defLabel: "",
    defIcon: null,
    defSize: 180,
  },
  expansionPanel: {
    label: "Expansion panel",
    noun: "展開パネル",
    category: "containment",
    paletteIcon: "expand_circle_down",
    w: 380,
    h: 56,
    radius: 16,
    hasVariant: false,
    hasLabel: true,
    hasSupporting: true,
    hasIcon: true,
    hasChecked: true,
    size: { min: 96, max: 412, step: 4, icon: "width", presets: [182, 380, 412] },
    defLabel: "",
    defIcon: null,
    defSize: 380,
  },
  segmentedButton: {
    label: "Segmented button",
    noun: "セグメントボタン",
    category: "actions",
    paletteIcon: "view_week",
    w: 380,
    h: 40,
    radius: 20,
    hasVariant: true,
    hasLabel: false,
    hasSupporting: false,
    hasIcon: false,
    hasTabs: true,
    size: { min: 160, max: 412, step: 4, icon: "width", presets: [240, 380, 412] },
    defLabel: "",
    defIcon: null,
    defSize: 380,
    defVariant: "filled",
  },
  stepper: {
    label: "Stepper",
    noun: "ステッパー",
    category: "navigation",
    paletteIcon: "linear_scale",
    w: 380,
    h: 64,
    radius: 0,
    hasVariant: false,
    hasLabel: false,
    hasSupporting: false,
    hasIcon: false,
    hasTabs: true,
    hasValue: true,
    size: { min: 160, max: 412, step: 4, icon: "width", presets: [280, 380, 412] },
    defLabel: "",
    defIcon: null,
    defSize: 380,
  },
  timeline: {
    label: "Timeline",
    noun: "タイムライン",
    category: "content",
    paletteIcon: "timeline",
    w: 380,
    h: 168,
    radius: 0,
    hasVariant: false,
    hasLabel: false,
    hasSupporting: false,
    hasIcon: false,
    hasTabs: true,
    size2: { min: 44, max: 96, step: 4, icon: "height", presets: [48, 56, 72] },
    defLabel: "",
    defIcon: null,
    defSize: 380,
  },
};

/* ---------------------------------------------------------------- 建件默认值与尺寸 */

/** 每语言的分段/步骤/时间线默认条目（建件时按当前界面语言取）。 */
const DEFAULT_TABS: Record<Lang, { segments: string[]; steps: string[]; moments: string[] }> = {
  zh: { segments: ["概览", "详情", "设置"], steps: ["购物车", "地址", "支付", "完成"], moments: ["今天 10:00", "昨天 16:30", "9 月 28 日"] },
  en: { segments: ["Overview", "Details", "Settings"], steps: ["Cart", "Address", "Payment", "Done"], moments: ["Today 10:00", "Yesterday 16:30", "Sep 28"] },
  ja: { segments: ["概要", "詳細", "設定"], steps: ["カート", "住所", "支払い", "完了"], moments: ["今日 10:00", "昨日 16:30", "9月28日"] },
  ko: { segments: ["개요", "세부 정보", "설정"], steps: ["장바구니", "주소", "결제", "완료"], moments: ["오늘 10:00", "어제 16:30", "9월 28일"] },
};
const tabsFrom = (labels: string[]) => labels.map((label) => ({ icon: "", label }));

/** makeItem 的补丁：本层新增 kind 的建件默认（外观字段与 label/supporting 仍走
 *  KIND_TEXT + spec 的 def*；lang 由调用方传入，避免本文件运行时依赖 i18n）。 */
export function extraItemDefaults(it: Item, lang: Lang): void {
  const d = DEFAULT_TABS[lang];
  switch (it.kind as ExtraKind) {
    case "avatar":
      it.size = 56;
      break;
    case "skeleton":
      it.size = 380;
      it.size2 = 96;
      break;
    case "rating":
      it.value = 4;
      break;
    case "tooltip":
      it.size = 180;
      break;
    case "expansionPanel":
      it.checked = false;
      break;
    case "segmentedButton":
      it.tabs = tabsFrom(d.segments);
      it.selected = 0;
      break;
    case "stepper":
      it.tabs = tabsFrom(d.steps);
      it.value = 1;
      break;
    case "timeline":
      it.tabs = tabsFrom(d.moments);
      it.size2 = 56;
      break;
  }
}

/** 尺寸补丁：接在 sizeOf 的 default 之前。 */
export function extraSizeOf(it: Item, s: KindSpec): { w: number; h: number } {
  const n = it.size ?? s.w;
  switch (it.kind as ExtraKind) {
    case "avatar":
      return { w: n, h: n };
    case "skeleton":
      return { w: n, h: it.size2 ?? s.h };
    case "rating":
      return { w: n * 5 + 16, h: n + 8 };
    case "tooltip":
      return { w: n, h: s.h };
    case "expansionPanel":
      return { w: n, h: it.checked ? 148 : 56 };
    case "segmentedButton":
      return { w: n, h: 40 };
    case "stepper":
      return { w: n, h: 64 };
    case "timeline":
      return { w: n, h: (it.tabs?.length ?? 3) * (it.size2 ?? 56) };
  }
}

/** 图标槽补丁：头像的前导图标、分段/步骤/时间线的逐段图标、展开面板的前导图标。 */
export function extraIconSlotsOf(it: Item): IconSlot[] {
  switch (it.kind as ExtraKind) {
    case "avatar":
    case "expansionPanel":
      return [{ key: "icon", label: "icon", value: it.icon }];
    case "segmentedButton":
    case "stepper":
    case "timeline":
      return (it.tabs ?? []).map((t, i) => ({ key: `tab:${i}`, label: `${i + 1}`, value: t.icon || null }));
    default:
      return [];
  }
}

/* ---------------------------------------------------------------- 提示词：逐件描述 + 实现说明 */

const quo = (lang: Lang, s: string) => (lang === "en" ? `“${s}”` : `「${s}」`);

/** 接在 itemJa/itemEn/itemZh/itemKo 的 `default: return noun;` 之前。 */
export function extraDescribe(it: Item, lang: Lang): string {
  const q = (s: string) => quo(lang, s);
  const tabLabels = (it.tabs ?? []).map((t) => t.label || "—");
  switch (it.kind as ExtraKind) {
    case "avatar": {
      const what = it.icon ? (lang === "zh" ? `图标 ${it.icon}` : `icon ${it.icon}`) : q(it.label || "—");
      if (lang === "zh") return `${q(it.label || "—")}头像（${what}，${it.size ?? 56}dp 圆形）`;
      if (lang === "ja") return `${q(it.label || "—")}のアバター（${what}、${it.size ?? 56}dp の円）`;
      if (lang === "ko") return `${q(it.label || "—")} 아바타(${what}, ${it.size ?? 56}dp 원형)`;
      return `${q(it.label || "—")} avatar (${what}, ${it.size ?? 56}dp circle)`;
    }
    case "skeleton":
      if (lang === "zh") return `骨架屏占位块（${it.size ?? 380} × ${it.size2 ?? 96}dp，微光扫过）`;
      if (lang === "ja") return `スケルトンのプレースホルダー（${it.size ?? 380} × ${it.size2 ?? 96}dp、シマー）`;
      if (lang === "ko") return `스켈레톤 자리 표시자(${it.size ?? 380} × ${it.size2 ?? 96}dp, 시머)`;
      return `skeleton placeholder (${it.size ?? 380} × ${it.size2 ?? 96}dp, shimmering)`;
    case "rating":
      if (lang === "zh") return `评分控件（5 颗星，当前 ${it.value ?? 0} 分，星宽 ${it.size ?? 32}dp）`;
      if (lang === "ja") return `評価コントロール（星 5 つ、現在 ${it.value ?? 0}、星 ${it.size ?? 32}dp）`;
      if (lang === "ko") return `평점 컨트롤(별 5개, 현재 ${it.value ?? 0}점, 별 ${it.size ?? 32}dp)`;
      return `rating control (5 stars, currently ${it.value ?? 0}, ${it.size ?? 32}dp stars)`;
    case "tooltip":
      if (lang === "zh") return `提示气泡，文案${q(it.label || "—")}`;
      if (lang === "ja") return `ツールチップ、文言${q(it.label || "—")}`;
      if (lang === "ko") return `툴팁, 문구 ${q(it.label || "—")}`;
      return `tooltip saying ${q(it.label || "—")}`;
    case "expansionPanel":
      if (lang === "zh") return `展开面板${q(it.label || "—")}（${it.checked ? `已展开，正文：${q(it.supporting || "—")}` : "折叠状态"}）`;
      if (lang === "ja") return `展開パネル${q(it.label || "—")}（${it.checked ? `展開中、本文：${q(it.supporting || "—")}` : "折りたたみ状態"}）`;
      if (lang === "ko") return `확장 패널 ${q(it.label || "—")}(${it.checked ? `펼침, 본문: ${q(it.supporting || "—")}` : "접힌 상태"})`;
      return `expansion panel ${q(it.label || "—")} (${it.checked ? `expanded, body: ${q(it.supporting || "—")}` : "collapsed"})`;
    case "segmentedButton":
      if (lang === "zh") return `分段按钮（${tabLabels.length} 段：${tabLabels.join("、")}，选中第 ${(it.selected ?? 0) + 1} 段）`;
      if (lang === "ja") return `セグメントボタン（${tabLabels.length} 段：${tabLabels.join("、")}、${(it.selected ?? 0) + 1} 番目を選択）`;
      if (lang === "ko") return `세그먼트 버튼(${tabLabels.length}개: ${tabLabels.join(", ")}, ${(it.selected ?? 0) + 1}번째 선택)`;
      return `segmented button (${tabLabels.length} segments: ${tabLabels.join(", ")}; segment ${(it.selected ?? 0) + 1} selected)`;
    case "stepper":
      if (lang === "zh") return `步骤条（${tabLabels.length} 步：${tabLabels.join(" → ")}，已进行到「${tabLabels[Math.min(it.value ?? 0, tabLabels.length - 1)] ?? "—"}」）`;
      if (lang === "ja") return `ステッパー（${tabLabels.length} 段階：${tabLabels.join(" → ")}、現在「${tabLabels[Math.min(it.value ?? 0, tabLabels.length - 1)] ?? "—"}」）`;
      if (lang === "ko") return `스테퍼(${tabLabels.length}단계: ${tabLabels.join(" → ")}, 현재 "${tabLabels[Math.min(it.value ?? 0, tabLabels.length - 1)] ?? "—"}")`;
      return `stepper (${tabLabels.length} steps: ${tabLabels.join(" → ")}; currently at “${tabLabels[Math.min(it.value ?? 0, tabLabels.length - 1)] ?? "—"}”)`;
    case "timeline":
      if (lang === "zh") return `时间线（${tabLabels.length} 条：${tabLabels.join("、")}）`;
      if (lang === "ja") return `タイムライン（${tabLabels.length} 件：${tabLabels.join("、")}）`;
      if (lang === "ko") return `타임라인(${tabLabels.length}개: ${tabLabels.join(", ")})`;
      return `timeline (${tabLabels.length} entries: ${tabLabels.join(", ")})`;
  }
}

/** 实现说明（接在 STYLE_NOTES / STYLE_NOTES_WEB 之后并入；ja/ko 允许缺省）。 */
export const EXTRA_STYLE_NOTES: Record<Lang, Partial<Record<Kind, string>>> = {
  zh: {
    avatar: "头像：给定直径的圆形；有图时用图片圆形裁剪，否则用主色容器底色 + 首字（headlineSmall）。",
    skeleton: "骨架屏：占位块用 surfaceContainerHighest、圆角 8dp，内部横条 14dp 高，1.2 秒微光循环；文本类骨架放 3 条（100% / 80% / 60% 宽）。",
    rating: "评分：五颗 Material 星，实心用 primary、空心用 outlineVariant；可点击改分（0.5 步长可选），间距 4dp。",
    tooltip: "提示气泡：inverseSurface 底 + inverseOnSurface 字，圆角 8dp，内边距 8×12，labelSmall；出现在锚点上方 8dp、水平居中。",
    expansionPanel: "展开面板：圆角 16dp；标题行 56dp（前导图标 24dp + 标题 bodyLarge + 尾部箭头，展开时箭头旋转 180°，过渡 200ms）；展开区加顶部分隔线，正文 bodyMedium、内边距 16dp。",
    segmentedButton: "分段按钮：高 40dp、外层全圆角（两端的段外角为全圆），段间 1dp outline 分隔线，等宽；选中段填 secondaryContainer 并在有图标时换成勾选图标，未选中透明。",
    stepper: "步骤条：圆 28dp——已完成填 primary + 白色对勾，当前 primaryContainer 描边 primary 显示序号，未开始 outlineVariant 描边；连接线 2dp（已完成段 primary）；步骤名 labelMedium 居中放在圆下 8dp。",
    timeline: "时间线：左侧 24dp 列——圆点 10dp（首条 primary，其余 outlineVariant）+ 2dp 竖线（最后一条不画）；右侧文案 bodyMedium 与圆点垂直居中，行高默认 56dp。",
  },
  en: {
    avatar: "Avatar: a circle of the given diameter; crop a photo into it, or use a primary container with initials (headlineSmall).",
    skeleton: "Skeleton: surfaceContainerHighest blocks, 8dp corners; text skeletons stack three 14dp-tall bars (100% / 80% / 60% wide) with a 1.2s shimmer.",
    rating: "Rating: five Material stars — filled in primary, empty in outlineVariant, 4dp apart; tap to set (0.5 steps optional).",
    tooltip: "Tooltip: inverseSurface on inverseOnSurface, 8dp corners, 8×12 padding, labelSmall; sits 8dp above its anchor, centered.",
    expansionPanel: "Expansion panel: 16dp corners; a 56dp header (24dp leading icon, bodyLarge title, trailing chevron rotating 180° in 200ms); the expanded body gets a top divider, bodyMedium text, 16dp padding.",
    segmentedButton: "Segmented button: 40dp tall, fully rounded outer ends, 1dp outline separators, equal widths; the selected segment fills with secondaryContainer (and swaps its icon for a check), the rest stay transparent.",
    stepper: "Stepper: 28dp circles — done ones filled primary with a white check, the current one primaryContainer with a primary outline and its number, upcoming ones outlined; 2dp connectors (primary once done); labels in labelMedium 8dp under the circles.",
    timeline: "Timeline: a 24dp rail — 10dp dots (first one primary, the rest outlineVariant) joined by a 2dp line (none after the last); entries in bodyMedium, vertically centered, 56dp rows by default.",
  },
  ja: {},
  ko: {},
};
export const EXTRA_STYLE_NOTES_WEB: Record<Lang, Partial<Record<Kind, string>>> = {
  zh: { stepper: "（网页形态）步骤条按 24dp 圆、labelMedium 实现；桌面宽度下步骤名可放圆右侧。" },
  en: { stepper: "(web) build the stepper with 24dp circles; on wide viewports the labels may sit beside the circles." },
  ja: {},
  ko: {},
};

/* ---------------------------------------------------------------- 渲染器 */

/** 与 M3Node 的 Icon 同款的最简图标（本文件不引 M3Node，避免循环依赖）。 */
function MiniIcon({ name, size, color, fill }: { name: string; size: number; color?: string; fill?: boolean }) {
  return (
    <span
      aria-hidden
      className="msr"
      style={{ fontSize: size, color, fontVariationSettings: fill ? '"FILL" 1, "GRAD" 0, "opsz" 24' : undefined }}
    >
      {name}
    </span>
  );
}

let shimmerInjected = false;
function ensureShimmer() {
  if (shimmerInjected || typeof document === "undefined") return;
  shimmerInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-m3e-extra", "shimmer");
  style.textContent = "@keyframes m3e-extra-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}";
  document.head.appendChild(style);
}

const FILL_TOKENS = new Set(["filled", "tonal", "outlined", "elevated", "text"]);

/** 头像：圆形，首字或图标；filled/tonal/outlined 三态。 */
function AvatarBody({ item, p }: { item: Item; p: Palette }) {
  const s = item.size ?? 56;
  const variant = FILL_TOKENS.has(item.variant) ? item.variant : "filled";
  const bg = variant === "tonal" ? p.secondaryContainer : variant === "outlined" ? "transparent" : p.primaryContainer;
  const fg = variant === "tonal" ? p.onSecondaryContainer : variant === "outlined" ? p.onSurfaceVariant : p.onPrimaryContainer;
  const ink = variant === "filled" ? p.onPrimary : p.primary;
  return (
    <div
      style={{
        width: s,
        height: s,
        borderRadius: "50%",
        background: variant === "filled" ? p.primary : bg,
        color: variant === "filled" ? ink : fg,
        border: variant === "outlined" ? `1.5px solid ${p.outline}` : "none",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        fontSize: Math.round(s * 0.42),
        fontWeight: 600,
        boxSizing: "border-box",
      }}
    >
      {item.icon ? (
        <MiniIcon name={item.icon} size={Math.round(s * 0.52)} />
      ) : (
        <span style={{ lineHeight: 1 }}>{item.label.trim().slice(0, 2) || "?"}</span>
      )}
    </div>
  );
}

/** 骨架屏：占位块 + 微光；高块时画三条文本骨架。 */
function SkeletonBody({ item, p }: { item: Item; p: Palette }) {
  ensureShimmer();
  const w = item.size ?? 380;
  const h = item.size2 ?? 96;
  const shimmer = `linear-gradient(90deg, ${p.surfaceContainerHighest} 20%, ${p.surfaceContainerHigh} 40%, ${p.surfaceContainerHighest} 60%)`;
  const bar = (bw: string, bh: number, radius: number, key: string): ReactElement => (
    <div
      key={key}
      style={{
        width: bw,
        height: bh,
        borderRadius: radius,
        background: shimmer,
        backgroundSize: "200% 100%",
        animation: "m3e-extra-shimmer 1.2s linear infinite",
      }}
    />
  );
  const textish = h >= 72;
  return (
    <div style={{ width: w, height: h, display: "flex", flexDirection: "column", gap: 10, justifyContent: textish ? "center" : "stretch" }}>
      {textish ? [bar("100%", 14, 7, "a"), bar("80%", 14, 7, "b"), bar("60%", 14, 7, "c")] : bar("100%", h, 12, "solo")}
    </div>
  );
}

/** 评分：五颗星。 */
function RatingBody({ item, p }: { item: Item; p: Palette }) {
  const s = item.size ?? 32;
  const v = Math.max(0, Math.min(5, Math.round(item.value ?? 0)));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <MiniIcon key={i} name="star" size={s} fill={i < v} color={i < v ? p.primary : p.outlineVariant} />
      ))}
    </div>
  );
}

/** 提示气泡。 */
function TooltipBody({ item, p }: { item: Item; p: Palette }) {
  const w = item.size ?? 180;
  return (
    <div
      style={{
        width: w,
        height: 36,
        borderRadius: 8,
        background: p.inverseSurface,
        color: p.inverseOnSurface,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 12px",
        fontSize: 12,
        boxSizing: "border-box",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
      }}
    >
      {item.label}
    </div>
  );
}

/** 展开面板：标题行 +（展开时）正文。 */
function ExpansionPanelBody({ item, p }: { item: Item; p: Palette }) {
  const w = item.size ?? 380;
  const open = !!item.checked;
  const label = item.label.trim();
  return (
    <div style={{ width: w, borderRadius: 16, background: p.surfaceContainerLow, boxSizing: "border-box", overflow: "hidden" }}>
      <div style={{ height: 56, display: "flex", alignItems: "center", gap: 12, padding: "0 16px" }}>
        {item.icon && <MiniIcon name={item.icon} size={24} color={p.onSurfaceVariant} />}
        <span style={{ flex: 1, fontSize: 16, fontWeight: 500, color: p.onSurface, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {label}
        </span>
        <span style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s cubic-bezier(.2,0,0,1)", display: "inline-flex" }}>
          <MiniIcon name="keyboard_arrow_down" size={24} color={p.onSurfaceVariant} />
        </span>
      </div>
      {open && (
        <div>
          <div style={{ height: 1, background: p.outlineVariant }} />
          <div style={{ padding: 16, fontSize: 14, lineHeight: 1.5, color: p.onSurfaceVariant }}>{item.supporting ?? ""}</div>
        </div>
      )}
    </div>
  );
}

/** 分段按钮：等宽分段、选中填色。 */
function SegmentedBody({ item, p }: { item: Item; p: Palette }) {
  const w = item.size ?? 380;
  const segments = item.tabs ?? [];
  const sel = Math.min(Math.max(item.selected ?? 0, 0), Math.max(0, segments.length - 1));
  return (
    <div style={{ width: w, height: 40, display: "flex", border: `1px solid ${p.outline}`, borderRadius: 20, overflow: "hidden", boxSizing: "border-box" }}>
      {segments.map((seg, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: i === sel ? p.secondaryContainer : "transparent",
            color: i === sel ? p.onSecondaryContainer : p.onSurface,
            borderRight: i < segments.length - 1 ? `1px solid ${p.outline}` : "none",
            fontSize: 14,
            fontWeight: i === sel ? 600 : 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {seg.icon ? <MiniIcon name={seg.icon} size={18} fill={i === sel} /> : i === sel ? <MiniIcon name="check" size={18} /> : null}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{seg.label}</span>
        </div>
      ))}
    </div>
  );
}

/** 步骤条：圆 + 序号/对勾 + 连接线 + 步骤名。 */
function StepperBody({ item, p }: { item: Item; p: Palette }) {
  const w = item.size ?? 380;
  const steps = item.tabs ?? [];
  const current = Math.min(Math.max(item.value ?? 0, 0), Math.max(0, steps.length - 1));
  return (
    <div style={{ width: w, display: "flex", alignItems: "flex-start" }}>
      {steps.map((step, i) => {
        const done = i < current;
        const here = i === current;
        const circleBg = done ? p.primary : here ? p.primaryContainer : "transparent";
        const circleFg = done ? p.onPrimary : here ? p.onPrimaryContainer : p.onSurfaceVariant;
        const circleBorder = done ? "none" : `2px solid ${here ? p.primary : p.outlineVariant}`;
        return (
          <div key={i} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ width: "100%", display: "flex", alignItems: "center" }}>
              <span style={{ flex: 1, height: 2, background: i === 0 ? "transparent" : i <= current ? p.primary : p.outlineVariant }} />
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: circleBg,
                  color: circleFg,
                  border: circleBorder,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  flex: "0 0 auto",
                  boxSizing: "border-box",
                }}
              >
                {done ? <MiniIcon name="check" size={16} /> : i + 1}
              </span>
              <span style={{ flex: 1, height: 2, background: i === steps.length - 1 ? "transparent" : i < current ? p.primary : p.outlineVariant }} />
            </div>
            <span style={{ fontSize: 12, color: here ? p.onSurface : p.onSurfaceVariant, fontWeight: here ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 时间线：圆点 + 竖线 + 文案。 */
function TimelineBody({ item, p }: { item: Item; p: Palette }) {
  const w = item.size ?? 380;
  const entries = item.tabs ?? [];
  const rowH = item.size2 ?? 56;
  return (
    <div style={{ width: w, display: "flex", flexDirection: "column" }}>
      {entries.map((entry, i) => {
        const last = i === entries.length - 1;
        return (
          <div key={i} style={{ height: rowH, display: "flex", gap: 12 }}>
            <div style={{ width: 24, display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: i === 0 ? p.primary : p.outlineVariant, marginTop: Math.round(rowH / 2) - 5, flex: "0 0 auto" }} />
              {!last && <span style={{ width: 2, flex: 1, background: p.outlineVariant }} />}
            </div>
            <span style={{ alignSelf: "center", fontSize: 14, color: p.onSurface, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {entry.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 本层全部 kind 的渲染入口（M3Node.Body 的 switch 尾部挂这里）。 */
export function ExtraNodeBody({ item, p }: { item: Item; p: Palette }) {
  switch (item.kind as ExtraKind) {
    case "avatar":
      return <AvatarBody item={item} p={p} />;
    case "skeleton":
      return <SkeletonBody item={item} p={p} />;
    case "rating":
      return <RatingBody item={item} p={p} />;
    case "tooltip":
      return <TooltipBody item={item} p={p} />;
    case "expansionPanel":
      return <ExpansionPanelBody item={item} p={p} />;
    case "segmentedButton":
      return <SegmentedBody item={item} p={p} />;
    case "stepper":
      return <StepperBody item={item} p={p} />;
    case "timeline":
      return <TimelineBody item={item} p={p} />;
    default:
      return null;
  }
}
