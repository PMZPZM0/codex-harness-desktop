/**
 * 预检守卫：OpenFilm 对接域（10-27 立）
 *
 * 为什么单独一条：这是一个**第三方开源项目**的对接面，失效方式全是静默的 ——
 *   镜像被换回官方（国内用户下不动 100MB 浏览器）、卸载范围失手（删到用户影片）、
 *   许可声明被顺手删掉（合规问题）、版本比较被手写第二份（预发布语义分歧）。
 *   这些 tsc 与预检都看不见，只能钉结构与常量来源。
 *
 * ⛔ 本守卫钉「契约与来源」，不钉"安装能成功"（那要真下 100MB，属验收脚本的事）。
 * 独立守卫（不进 check-preflight 的 checks 计数，同 22/11r 口径）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const has = (rel) => existsSync(join(ROOT, rel));

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【openfilm】${message}`);
  if (!condition) fails++;
};

const ipc = has("electron/features/openfilm-ipc.ts") ? codeOnly(read("electron/features/openfilm-ipc.ts")) : "";
ok(Boolean(ipc), "主进程域存在（electron/features/openfilm-ipc.ts）");

/* ── 1. 域登记：一个前缀、7 条通道、生成物齐 ─────────────────────────── */
{
  const composition = JSON.parse(read("electron/composition.json"));
  const row = (composition.domains ?? []).find((d) => d.id === "openfilm");
  ok(Boolean(row?.enabled) && row?.file === "features/openfilm-ipc.ts" && row?.export === "openfilmFeature",
    "composition.json 已启用该域且 file/export 对得上");
  ok(read("electron/composition.gen.ts").includes("openfilm-ipc"), "composition.gen.ts 已重生成（跑过 npm run gen:domains）");

  const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
  const channels = manifest.channels.filter((c) => String(c.channel ?? "").startsWith("openfilm:")).map((c) => c.channel);
  ok(channels.length === 7, `manifest 有 7 条 openfilm 通道（实测 ${channels.length}）`);
  ok(["openfilm:status", "openfilm:install", "openfilm:retry", "openfilm:uninstall", "openfilm:settings-get", "openfilm:settings-set", "openfilm:update-check"]
    .every((name) => channels.includes(name)), "7 条通道名与实现一致（不含尚未实现的 studio/render —— 那要 session 守护）");

  const registry = read("electron/ipc-registry.ts");
  ok(/\{ prefix: "openfilm", count: 7, status: "in-features", file: "features\/openfilm-ipc\.ts"/.test(registry),
    "ipc-registry.ts 账本已登记（count=7）");

  const preload = read("electron/preload.ts");
  for (const method of ["openfilmStatus", "openfilmInstall", "openfilmRetry", "openfilmUninstall", "openfilmSettingsGet", "openfilmSettingsSet", "openfilmUpdateCheck"]) {
    ok(preload.includes(method), `preload 已生成 ${method}`);
  }
}

/* ── 2. 安装纪律：镜像来源单一真相源 + 双跳回落 + 不经 shell ──────────── */
{
  ok(/import \{[^}]*CHINA_NPM_REGISTRY[^}]*\} from "\.\.\/toolchain"/.test(ipc),
    "npm 镜像取自 toolchain 的 CHINA_NPM_REGISTRY（⛔ 不在这里再写一份 registry 字面量）");
  ok(!/registry\.npmmirror\.com/.test(ipc),
    "⛔ 源码里不出现 npmmirror 字面量（只有 toolchain 一处真相源）");
  ok(/\[CHINA_NPM_REGISTRY, "https:\/\/registry\.npmjs\.org"\]/.test(ipc),
    "安装按「国内镜像 → 官方」两跳（⛔ 失败不能静默停在国内源）");
  ok(/PLAYWRIGHT_DOWNLOAD_HOST/.test(ipc) && /cdn\.npmmirror\.com\/binaries\/playwright/.test(ipc),
    "渲染引擎走 playwright 自己的下载根，并指向 cdn.npmmirror.com 镜像");
  ok(/\{ host: PLAYWRIGHT_MIRROR, label:[^}]*\}, \{ host: "", label: "官方 CDN" \}/.test(ipc),
    "渲染引擎同样是「镜像 → 官方」两跳；⛔ 镜像挂掉不能把用户卡死");
  ok(!/shell:\s*true/.test(ipc) && /spawn\(node\.exe, args, \{/.test(ipc),
    "子进程一律 spawn(args 数组)，⛔ 不经 shell / 不拼命令字符串");
  ok(/bundledNode\(\)/.test(ipc) && /bundledNpmCli\(\)/.test(ipc),
    "用我们自己的内置 node/npm（⛔ 不要求用户装 Node）");
  ok(/bundledFfmpeg\(\)/.test(ipc) && !/ffmpeg\.exe\?|github\.com\/Gyan/.test(ipc),
    "ffmpeg 只认内置/系统（⛔ 不下载第三方 ffmpeg 二进制 —— GPL 传染风险，见设计稿）");
}

/* ── 3. 卸载安全闸：只删 runtime，绝不碰用户影片 ─────────────────────── */
{
  ok(/entry === "runtime"/.test(ipc) && /entry === "\.installing"/.test(ipc),
    "卸载只清 runtime（与安装标记），白名单之外的条目一律不动");
  ok(/!\/openfilm\$\/i\.test\(resolved\)/.test(ipc) && /length < 3/.test(ipc),
    "删除目标必须是自己算出的 openfilm 根且深度 ≥3（防路径配置坏掉时删到用户目录）");
  ok(!/films/.test(ipc),
    "⛔ 主进程代码里根本不该出现 films（用户的影片目录不归我们管）");
}

/* ── 4. 版本比较单一真相源 ───────────────────────────────────────────── */
{
  ok(/import \{ compareVersions \} from "\.\.\/updates"/.test(ipc) && /compareVersions\(latest\.version, current\)/.test(ipc),
    "版本比较走 electron/updates.ts 的 compareVersions（⛔ 不手写第二份）");
  ok(!/function compareVersions|function parseVersion/.test(ipc), "⛔ 本域不重复实现版本比较");
}

/* ── 5. 开源声明（用户明确要求：界面与文档都要标） ───────────────────── */
{
  ok(/OPENFILM_HOME = "https:\/\/github\.com\/openfilm\/openfilm"/.test(ipc)
    && /OPENFILM_LICENSE = "MIT"/.test(ipc),
    "声明常量：仓库地址 + MIT 许可");
  ok(/OPENFILM_TRADEMARK_NOTE =[\s\S]{0,200}?TRADEMARK\.md[\s\S]{0,200}?无隶属或背书关系/.test(ipc),
    "商标声明含「名称与图标归 OpenFilm 项目所有」与「无隶属或背书」（TRADEMARK.md 是上游事实）");
  ok(/attribution: \{ home: OPENFILM_HOME, site: OPENFILM_SITE, license: OPENFILM_LICENSE, trademark: OPENFILM_TRADEMARK_NOTE \}/.test(ipc),
    "状态接口把声明下发给界面（⛔ 前端不写第二份文案）");
  ok(has("docs/OPENFILM-INTEGRATION-2026-10-27.md"), "设计/合规文档在位（docs/OPENFILM-INTEGRATION-2026-10-27.md）");
  ok(!/OpenFilm-.*\.(exe|dmg)|OpenFilm-Setup/.test(ipc),
    "⛔ 不下载/不内置上游桌面安装包（只装 npm CLI + 浏览器）");
}

/* ── 6. 渲染层：卡片挂在开发工具页，且开关只有这套语义 ───────────────── */
{
  const card = has("src/features/openfilm/OpenfilmCard.tsx") ? codeOnly(read("src/features/openfilm/OpenfilmCard.tsx")) : "";
  ok(Boolean(card) && /window\.codex\.openfilmStatus\(\)/.test(card), "卡片自取状态（window.codex.openfilmStatus）");
  ok(/window\.codex\.openfilmInstall\(/.test(card) && /window\.codex\.openfilmUninstall\(/.test(card),
    "卡片有「下载并安装 / 卸载」入口");
  ok(/AUTO_UPDATE_OPTIONS[\s\S]{0,400}?value: "off"[\s\S]{0,200}?value: "startup"[\s\S]{0,200}?value: "auto"/.test(card),
    "自动更新三档（关闭 / 启动时检查 / 自动安装）");
  ok(/saveSettings\(\{ mirror: "auto" \}\)/.test(card) && /saveSettings\(\{ mirror: "official" \}\)/.test(card),
    "下载源可切（国内镜像优先 / 仅官方）");
  ok(/status\.attribution\.home/.test(card), "界面地址取自 status.attribution（⛔ 不写死 URL）");

  const devtools = codeOnly(read("src/features/settings-devtools/DevtoolsSettingsSection.tsx"));
  ok(/import \{ OpenfilmCard \} from "\.\.\/openfilm"/.test(devtools) && /key: "openfilm"/.test(devtools)
    && /openCard === "openfilm"/.test(devtools),
    "卡片挂在「开发工具」页（一级卡 + 二级弹窗都在位）");
}

console.log(`\n【openfilm】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
