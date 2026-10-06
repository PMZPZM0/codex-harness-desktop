/**
 * scripts/sketch-fork/build.mjs —— 「前端开发」画布的**补丁层构建器**（10-06 立）。
 *
 * 背景：组件面板与 kind 体系写死在上游 m3e-canvas 里，要新增组件必须改上游源码再重新构建
 * （用户 10-06：「3800个组件你从中调一些常用的组件做成图里面这些组件」）。本仓不并源码，
 * 用**钉死提交 + 定点补丁**的方式复现构建：
 *
 *   1. 克隆上游到 .workbuddy/tmp/m3e-fork，checkout 到钉死的提交（PIN 在下面与 CANVAS-BUILD.json）；
 *   2. 把 patches 里的 overlay 文件拷进上游（lib/extra-kinds.tsx）；
 *   3. 对 tokens / i18n / prompt / M3Node / PartInspector 做**锚点唯一**的定点插入（每处断 count==1）；
 *   4. npm ci（缺 node_modules 时）→ npm run build（next export 到 out/）；
 *   5. 默认接着跑 `node scripts/build-sketch-bundle.mjs --from <out>/` 把产物覆盖进 public/sketch/。
 *
 * ⛔ 上游更新流程：把 PIN 换到新提交 → 跑本脚本；锚点失配会**当场报红**（不许静默套用），
 *    按报错把 hunk 的锚点对准新源码即可。守卫【283】在产物层再做一次对账（44 种枚举/文案）。
 *
 * 用法：
 *   node scripts/sketch-fork/build.mjs                 # 全程：补丁 → 构建 → 出货（public/sketch）
 *   node scripts/sketch-fork/build.mjs --no-ship       # 只到 out/（调试补丁用）
 *   node scripts/sketch-fork/build.mjs --skip-install  # 复用已装的 node_modules
 *   node scripts/sketch-fork/build.mjs --fresh         # 强制重新克隆
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK = join(ROOT, ".workbuddy", "tmp", "m3e-fork");
const OVERLAY = join(ROOT, "scripts", "sketch-fork", "extra-kinds.tsx");

/** 上游仓库与钉死提交（与 public/sketch/CANVAS-BUILD.json 的 fork 字段同源；改这里要同轮改那边）。 */
const UPSTREAM_REPO = "https://github.com/lnkiai/m3e-canvas";
const PINNED_COMMIT = "039ec311acc33dd0c76a54cbc16af4fc8ab9b491";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);

const run = (cmd, cwd) => {
  console.log(`\x1b[36m[sketch-fork] $ ${cmd}\x1b[0m`);
  execSync(cmd, { cwd, stdio: "inherit" });
};

/* ───────────────────────── 一、干净的钉死检出 ───────────────────────── */

if (flag("--fresh") && existsSync(WORK)) rmSync(WORK, { recursive: true, force: true });
if (!existsSync(join(WORK, ".git"))) {
  run(`git clone ${UPSTREAM_REPO} "${WORK}"`, ROOT);
}
run(`git fetch origin ${PINNED_COMMIT} --depth 1 || git fetch origin`, WORK);
run(`git checkout -f ${PINNED_COMMIT}`, WORK);
/* 复位改动、但不碰 node_modules/.next/out（--fresh 才整目录重来）。 */
run(`git clean -fd -e node_modules -e .next -e out`, WORK);

/* ───────────────────────── 二、overlay 与定点补丁 ───────────────────────── */

copyFileSync(OVERLAY, join(WORK, "lib", "extra-kinds.tsx"));
console.log("[sketch-fork] overlay → lib/extra-kinds.tsx");

const EXTRA_UNION = ["avatar", "skeleton", "rating", "tooltip", "expansionPanel", "segmentedButton", "stepper", "timeline"];

const i18nEntries = (lang) => {
  const rows = {
    zh: [
      `    avatar: { noun: "头像", label: "李" },`,
      `    skeleton: { noun: "骨架屏" },`,
      `    rating: { noun: "评分" },`,
      `    tooltip: { noun: "提示气泡", label: "提示文字" },`,
      `    expansionPanel: { noun: "展开面板", label: "面板标题", supporting: "这里是展开后的正文内容。" },`,
      `    segmentedButton: { noun: "分段按钮" },`,
      `    stepper: { noun: "步骤条" },`,
      `    timeline: { noun: "时间线" },`,
    ],
    en: [
      `    avatar: { noun: "Avatar", label: "A" },`,
      `    skeleton: { noun: "Skeleton" },`,
      `    rating: { noun: "Rating" },`,
      `    tooltip: { noun: "Tooltip", label: "Hint text" },`,
      `    expansionPanel: { noun: "Expansion panel", label: "Panel title", supporting: "The content shown while the panel is expanded." },`,
      `    segmentedButton: { noun: "Segmented button" },`,
      `    stepper: { noun: "Stepper" },`,
      `    timeline: { noun: "Timeline" },`,
    ],
    ja: [
      `    avatar: { noun: "アバター", label: "李" },`,
      `    skeleton: { noun: "スケルトン" },`,
      `    rating: { noun: "評価" },`,
      `    tooltip: { noun: "ツールチップ", label: "ヒント" },`,
      `    expansionPanel: { noun: "展開パネル", label: "パネルのタイトル", supporting: "展開したときに表示される本文です。" },`,
      `    segmentedButton: { noun: "セグメントボタン" },`,
      `    stepper: { noun: "ステッパー" },`,
      `    timeline: { noun: "タイムライン" },`,
    ],
    ko: [
      `    avatar: { noun: "아바타", label: "김" },`,
      `    skeleton: { noun: "스켈레톤" },`,
      `    rating: { noun: "평점" },`,
      `    tooltip: { noun: "툴팁", label: "힌트 텍스트" },`,
      `    expansionPanel: { noun: "확장 패널", label: "패널 제목", supporting: "펼쳤을 때 표시되는 본문입니다." },`,
      `    segmentedButton: { noun: "세그먼트 버튼" },`,
      `    stepper: { noun: "스테퍼" },`,
      `    timeline: { noun: "타임라인" },`,
    ],
  };
  return rows[lang].join("\n");
};

/** 每处：{ file, find, replace, label }。find 必须在文件里**恰好出现一次**（构建器断言）。 */
const HUNKS = [
  /* ── tokens.ts ── */
  {
    file: "lib/tokens.ts",
    label: "Kind 并集追加 8 个 kind",
    find: `  | "timePicker";`,
    replace: `  | "timePicker"\n${EXTRA_UNION.map((k) => `  | "${k}"`).join("\n")};`,
  },
  {
    file: "lib/tokens.ts",
    label: "引入补丁层",
    find: `import { Contrast, isLightColor, schemeFromSeed } from "./color";`,
    replace: `import { Contrast, isLightColor, schemeFromSeed } from "./color";\nimport { EXTRA_KIND_SPECS, extraIconSlotsOf, extraItemDefaults, extraSizeOf, isExtraKind } from "./extra-kinds";`,
  },
  {
    file: "lib/tokens.ts",
    label: "KIND_SPEC 并入补丁层规格",
    find: `};\n\nexport const KIND_ORDER: Kind[] = [`,
    replace: `  ...EXTRA_KIND_SPECS,\n};\n\nexport const KIND_ORDER: Kind[] = [`,
  },
  {
    file: "lib/tokens.ts",
    label: "KIND_ORDER：actions 段插入 segmentedButton",
    find: `  "chip",\n  "topAppBar",`,
    replace: `  "chip",\n  "segmentedButton",\n  "topAppBar",`,
  },
  {
    file: "lib/tokens.ts",
    label: "KIND_ORDER：navigation 段插入 stepper",
    find: `  "searchBar",\n  "card",`,
    replace: `  "searchBar",\n  "stepper",\n  "card",`,
  },
  {
    file: "lib/tokens.ts",
    label: "KIND_ORDER：containment 段插入 expansionPanel / tooltip",
    find: `  "snackbar",\n  "textField",`,
    replace: `  "snackbar",\n  "expansionPanel",\n  "tooltip",\n  "textField",`,
  },
  {
    file: "lib/tokens.ts",
    label: "KIND_ORDER：inputs 段插入 rating",
    find: `  "timePicker",\n  "text",`,
    replace: `  "timePicker",\n  "rating",\n  "text",`,
  },
  {
    file: "lib/tokens.ts",
    label: "KIND_ORDER：content 段插入 avatar / skeleton / timeline",
    find: `  "image",\n  "carousel",`,
    replace: `  "image",\n  "avatar",\n  "skeleton",\n  "timeline",\n  "carousel",`,
  },
  {
    file: "lib/tokens.ts",
    label: "makeItem：补丁层默认值",
    find: `  if (kind === "toolbar") it.tabs = defaultTabsFor(kind).slice(0, 4);\n  return it;\n}`,
    replace: `  if (kind === "toolbar") it.tabs = defaultTabsFor(kind).slice(0, 4);\n  if (isExtraKind(kind)) extraItemDefaults(it, getLang());\n  return it;\n}`,
  },
  {
    file: "lib/tokens.ts",
    label: "sizeOf 兜底：补丁层尺寸",
    find: `    case "navRail":\n      return { w: railWidth(it), h: it.size2 ?? s.h };\n    default:\n      return { w: s.w, h: s.h };\n  }\n}`,
    replace: `    case "navRail":\n      return { w: railWidth(it), h: it.size2 ?? s.h };\n    default:\n      return isExtraKind(it.kind) ? extraSizeOf(it, s) : { w: s.w, h: s.h };\n  }\n}`,
  },
  {
    file: "lib/tokens.ts",
    label: "iconSlotsOf：补丁层图标槽",
    find: `export function iconSlotsOf(it: Item): IconSlot[] {\n  switch (it.kind) {`,
    replace: `export function iconSlotsOf(it: Item): IconSlot[] {\n  if (isExtraKind(it.kind)) return extraIconSlotsOf(it);\n  switch (it.kind) {`,
  },

  /* ── i18n.ts：四语言各补 8 条（插在各自 timePicker 之后） ── */
  { file: "lib/i18n.ts", label: "KIND_TEXT：ja 补 8 条", find: `    timePicker: { noun: "時刻ピッカー" },`, replace: `    timePicker: { noun: "時刻ピッカー" },\n${i18nEntries("ja")}` },
  { file: "lib/i18n.ts", label: "KIND_TEXT：en 补 8 条", find: `    timePicker: { noun: "time picker" },`, replace: `    timePicker: { noun: "time picker" },\n${i18nEntries("en")}` },
  { file: "lib/i18n.ts", label: "KIND_TEXT：zh 补 8 条", find: `    timePicker: { noun: "时间选择器" },`, replace: `    timePicker: { noun: "时间选择器" },\n${i18nEntries("zh")}` },
  { file: "lib/i18n.ts", label: "KIND_TEXT：ko 补 8 条", find: `    timePicker: { noun: "시간 선택기" },`, replace: `    timePicker: { noun: "시간 선택기" },\n${i18nEntries("ko")}` },

  /* ── prompt.ts ── */
  {
    file: "lib/prompt.ts",
    label: "引入补丁层",
    find: `import { KIND_TEXT, Lang, SWIPE_TEXT, TRANSITION_TEXT, getLang } from "./i18n";`,
    replace: `import { KIND_TEXT, Lang, SWIPE_TEXT, TRANSITION_TEXT, getLang } from "./i18n";\nimport { EXTRA_STYLE_NOTES, EXTRA_STYLE_NOTES_WEB, extraDescribe, isExtraKind } from "./extra-kinds";`,
  },
  {
    file: "lib/prompt.ts",
    label: "描述器 default：ja",
    find: `    case "radio":\n      return \`\${q(it.label)}のラジオボタン（初期状態は\${it.checked ? "選択" : "未選択"}）\`;\n    default:\n      return noun;`,
    replace: `    case "radio":\n      return \`\${q(it.label)}のラジオボタン（初期状態は\${it.checked ? "選択" : "未選択"}）\`;\n    default:\n      return isExtraKind(it.kind) ? extraDescribe(it, "ja") : noun;`,
  },
  {
    file: "lib/prompt.ts",
    label: "描述器 default：en",
    find: `    case "radio":\n      return \`a radio button \${q(it.label)} (initially \${it.checked ? "selected" : "unselected"})\`;\n    default:\n      return noun;`,
    replace: `    case "radio":\n      return \`a radio button \${q(it.label)} (initially \${it.checked ? "selected" : "unselected"})\`;\n    default:\n      return isExtraKind(it.kind) ? extraDescribe(it, "en") : noun;`,
  },
  {
    file: "lib/prompt.ts",
    label: "描述器 default：zh",
    find: `    case "radio":\n      return \`\${q(it.label)}单选按钮（初始状态为\${it.checked ? "选中" : "未选中"}）\`;\n    default:\n      return noun;`,
    replace: `    case "radio":\n      return \`\${q(it.label)}单选按钮（初始状态为\${it.checked ? "选中" : "未选中"}）\`;\n    default:\n      return isExtraKind(it.kind) ? extraDescribe(it, "zh") : noun;`,
  },
  {
    file: "lib/prompt.ts",
    label: "描述器 default：ko",
    find: `    case "radio": return \`\${q(it.label)} 라디오 버튼(초기 상태 \${it.checked ? "선택됨" : "선택 안 됨"})\`;\n    default: return noun;`,
    replace: `    case "radio": return \`\${q(it.label)} 라디오 버튼(초기 상태 \${it.checked ? "선택됨" : "선택 안 됨"})\`;\n    default: return isExtraKind(it.kind) ? extraDescribe(it, "ko") : noun;`,
  },
  {
    file: "lib/prompt.ts",
    label: "STYLE_NOTES 并入补丁层说明",
    find: `const FONT_NOTE: Record<Lang, (name: string) => string> = {`,
    replace: `for (const lang of ["ja", "en", "zh", "ko"] as Lang[]) Object.assign(STYLE_NOTES[lang], EXTRA_STYLE_NOTES[lang]);
const FONT_NOTE: Record<Lang, (name: string) => string> = {`,
  },
  {
    file: "lib/prompt.ts",
    label: "STYLE_NOTES_WEB 并入补丁层说明",
    find: `const PH = {`,
    replace: `for (const lang of ["ja", "en", "zh", "ko"] as Lang[]) Object.assign(STYLE_NOTES_WEB[lang], EXTRA_STYLE_NOTES_WEB[lang]);
const PH = {`,
  },

  /* ── M3Node.tsx ── */
  {
    file: "components/M3Node.tsx",
    label: "引入补丁层渲染器",
    find: `import { AnimatePresence, motion, useReducedMotion } from "motion/react";`,
    replace: `import { AnimatePresence, motion, useReducedMotion } from "motion/react";\nimport { ExtraNodeBody } from "@/lib/extra-kinds";`,
  },
  {
    file: "components/M3Node.tsx",
    label: "Body 渲染 switch：补丁层 8 个 kind",
    find: `    case "loadingIndicator": {\n      const s = item.size ?? 48;\n      return (\n        <LoadingIndicator\n          size={s}\n          color={item.contained ? p.onPrimaryContainer : p.primary}\n          contained={item.contained}\n          containerColor={p.primaryContainer}\n        />\n      );\n    }\n  }\n  return null;\n}`,
    replace: `    case "loadingIndicator": {\n      const s = item.size ?? 48;\n      return (\n        <LoadingIndicator\n          size={s}\n          color={item.contained ? p.onPrimaryContainer : p.primary}\n          contained={item.contained}\n          containerColor={p.primaryContainer}\n        />\n      );\n    }\n\n    case "avatar":\n    case "skeleton":\n    case "rating":\n    case "tooltip":\n    case "expansionPanel":\n    case "segmentedButton":\n    case "stepper":\n    case "timeline":\n      return <ExtraNodeBody item={item} p={p} />;\n  }\n  return null;\n}`,
  },

  /* ── PartInspector.tsx ── */
  {
    file: "components/PartInspector.tsx",
    label: "引入补丁层判据",
    find: `import { t, useLang } from "@/lib/i18n";`,
    replace: `import { t, useLang } from "@/lib/i18n";\nimport { isExtraEntriesKind, isExtraTextKind, isExtraValueKind } from "@/lib/extra-kinds";`,
  },
  {
    file: "components/PartInspector.tsx",
    label: "文字分节：补丁层三件",
    find: `      {kind === "snackbar" && (`,
    replace: `      {isExtraTextKind(kind) && (
        <Section id="part-text" icon="short_text" title={t("text", lang)} p={p}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {iconSlots.length > 0 ? (
              <IconRow slots={iconSlots} onPick={(key, icon) => onChange(setIconSlot(item, key, icon))} p={p}>
                <Field value={item.label} onChange={(label) => onChange({ label })} placeholder={t("label", lang)} p={p} />
              </IconRow>
            ) : (
              <Field value={item.label} onChange={(label) => onChange({ label })} placeholder={t("label", lang)} p={p} />
            )}
            {spec.hasSupporting && (
              <Field value={item.supporting ?? ""} onChange={(supporting) => onChange({ supporting })} placeholder={t("supporting", lang)} p={p} multiline rows={2} maxHeight={120} />
            )}
          </div>
        </Section>
      )}
      {kind === "snackbar" && (`,
  },
  {
    file: "components/PartInspector.tsx",
    label: "条目分节：分段/步骤/时间线",
    find: `      {(kind === "bottomNav" || kind === "navRail" || kind === "tabs" || kind === "select") && (`,
    replace: `      {isExtraEntriesKind(kind) && (
        <Section id="part-entries" icon="view_column" title={t("tabs", lang)} p={p}>
          <EntryList item={item} onChange={onChange} p={p} icons={kind === "segmentedButton"} selectable={kind !== "timeline"} clearable={false} />
        </Section>
      )}
      {isExtraValueKind(kind) && (
        <Section id="part-value" icon={kind === "rating" ? "star" : "linear_scale"} title={t("options", lang)} p={p}>
          <Slider
            icon={kind === "rating" ? "star" : "linear_scale"}
            title={t("options", lang)}
            value={kind === "rating" ? item.value ?? 4 : item.value ?? 1}
            min={0}
            max={kind === "rating" ? 5 : Math.max(1, (item.tabs?.length ?? 2) - 1)}
            step={1}
            onChange={(value) => onChange({ value })}
            p={p}
          />
        </Section>
      )}
      {(kind === "bottomNav" || kind === "navRail" || kind === "tabs" || kind === "select") && (`,
  },
  {
    file: "components/PartInspector.tsx",
    label: "宽度/高度分节：skeleton 并入 box 组",
    find: `      {(kind === "box" || kind === "bottomSheet") && (`,
    replace: `      {(kind === "box" || kind === "bottomSheet" || kind === "skeleton") && (`,
  },

  /* ── 上游自带的 agent 指南：把补丁层的 8 个组件也告诉将来读它的人 ── */
  {
    file: "public/agent.md",
    label: "agent.md 追加补丁层组件表",
    find: `- You are replying with the link (or the JSON), not with a description of it.`,
    replace: `- You are replying with the link (or the JSON), not with a description of it.

## Harness additions: eight more kinds

This build of the canvas adds eight common components to the palette. They take the same document
format — every item still needs \`id\` / \`kind\` / \`label\` / \`icon\` / \`variant\`.

| kind | what it is | useful fields | default size |
|---|---|---|---|
| \`avatar\` | circular avatar | \`label\` initials (or \`icon\`), \`size\` diameter | 56 × 56 |
| \`skeleton\` | loading placeholder with a shimmer | \`size\` width, \`size2\` height | 380 × 96 |
| \`rating\` | five stars | \`value\` 0–5, \`size\` star size | 176 × 40 |
| \`tooltip\` | hint bubble | \`label\`, \`size\` width | 180 × 36 |
| \`expansionPanel\` | panel with a header and a body | \`label\` title, \`supporting\` body, \`checked\` = expanded, \`icon\` | 380 (56 / 148 tall) |
| \`segmentedButton\` | connected segmented control | \`tabs\` segments, \`selected\`, \`size\` | 380 × 40 |
| \`stepper\` | step progress | \`tabs\` step names, \`value\` current index | 380 × 64 |
| \`timeline\` | dot-and-line entries | \`tabs\` entries, \`size2\` row height | 380 (56 per row) |`,
  },
];

let applied = 0;
/* ⛔ 本机 git 可能 autocrlf=true ⇒ 检出是 CRLF，多行锚点会全失配。补丁前统一转 LF。 */
for (const rel of [...new Set(HUNKS.map((h) => h.file))]) {
  const path = join(WORK, rel);
  const text = readFileSync(path, "utf8");
  const lf = text.replace(/\r\n/g, "\n");
  if (lf !== text) writeFileSync(path, lf);
}
for (const hunk of HUNKS) {
  const path = join(WORK, hunk.file);
  const src = readFileSync(path, "utf8");
  const count = src.split(hunk.find).length - 1;
  if (count !== 1) {
    console.error(`\x1b[31m[sketch-fork] 锚点失配（${hunk.file} · ${hunk.label}）：出现 ${count} 次（要 1 次）\x1b[0m`);
    console.error(`  锚点原文：\n${hunk.find.split("\n").map((l) => "    | " + l).join("\n")}`);
    process.exit(1);
  }
  writeFileSync(path, src.replace(hunk.find, hunk.replace));
  applied++;
}
console.log(`[sketch-fork] 定点补丁完成：${applied} 处`);

/* ───────────────────────── 三、构建 ───────────────────────── */

if (!flag("--skip-install") && !existsSync(join(WORK, "node_modules"))) {
  run("npm ci", WORK);
}
run("npm run build", WORK);

if (!existsSync(join(WORK, "out", "index.html"))) {
  console.error("[sketch-fork] 构建没有产出 out/index.html —— next.config 的 output:export 被改过？");
  process.exit(1);
}

/* 给出货脚本留一张「这是补丁层构建」的标记（build-sketch-bundle 会把它记进
   CANVAS-BUILD.json 的 fork 字段，并在出货后从产物里删掉）。 */
writeFileSync(
  join(WORK, "out", ".fork-build.json"),
  JSON.stringify(
    {
      repo: UPSTREAM_REPO,
      pinnedCommit: PINNED_COMMIT,
      patchedBy: "scripts/sketch-fork/build.mjs + patches/extra-kinds.tsx",
      extraKinds: EXTRA_UNION,
      builtAt: new Date().toISOString().slice(0, 19),
    },
    null,
    2
  )
);

/* ───────────────────────── 四、出货（覆盖随包产物） ───────────────────────── */

if (!flag("--no-ship")) {
  run(`node scripts/build-sketch-bundle.mjs --from "${join(WORK, "out")}"`, ROOT);
  console.log("\x1b[32m[sketch-fork] 完成：public/sketch 已更新（含补丁层 8 个组件）。\x1b[0m");
} else {
  console.log(`[sketch-fork] --no-ship：产物留在 ${join(WORK, "out")}`);
}
