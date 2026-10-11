/**
 * 更新链镜像化判据（10-11 立）：检查更新 / 下载安装包走国内镜像优先（gh-proxy → ghfast → 直连）。
 *
 * 失效方式全是静默的：镜像表被复制出第二份（改镜像顺序要动三处还漏）、mirrorCandidates 对
 * 自定义清单/非 GitHub host 也加前缀（把用户自建分发地址发给第三方反代 = 信息泄露）、
 * asset.digest 不再接线（走镜像后「包体没被换过」就没了证据）、PPcode 的令牌发给了镜像
 * （只读令牌泄露给第三方反代）。本守卫钉**代码形态 + mirrorCandidates 真值表**；网络行为已实测。
 * 独立守卫（不进 check-preflight 的 checks 计数）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** 两仓同一份守卫：断言差异按 package name 分岔（主仓无令牌概念，PPcode 私有仓有 token 门）。 */
const IS_PPCODE = JSON.parse(read("package.json")).name === "ppcode";

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【update-mirror】${message}`);
  if (!condition) fails++;
};

const mirrorSrc = read("electron/gh-mirror.ts");
const updates = codeOnly(read("electron/updates.ts"));
const official = codeOnly(read("electron/codex-official-market.ts"));
const freeGw = codeOnly(read("electron/features/free-gateway-ipc.ts"));

/* ── 单一真相源 ── */
ok(/export const GH_MIRROR_PREFIXES = \["https:\/\/gh-proxy\.com\/", "https:\/\/ghfast\.top\/", ""\] as const/.test(mirrorSrc),
  "镜像表唯一一份在 gh-mirror.ts：gh-proxy → ghfast → 直连(空串)，顺序即契约");
ok(!/"https:\/\/gh-proxy\.com\/"/.test(updates) && !/"https:\/\/gh-proxy\.com\/"/.test(official) && !/"https:\/\/gh-proxy\.com\/"/.test(freeGw),
  "⛔ 镜像字面量不再散落：updates / 官方市场 / 免费网关都从 gh-mirror 取（voice/model-store 除外 —— 它的顺序是按实测速度排的，语义不同）");
ok(/const MIRROR_PREFIXES = GH_MIRROR_PREFIXES/.test(official) && /const MIRRORS = GH_MIRROR_PREFIXES/.test(freeGw),
  "两个既有消费方改成别名引用（局部语义与消费写法不变）");

/* ── mirrorCandidates 真值表（真跑，不是读代码）── */
{
  const { mirrorCandidates, GH_MIRROR_PREFIXES } = await import("../../electron/gh-mirror.ts");
  const url = "https://github.com/a/b/releases/download/v1/x.exe";
  const got = mirrorCandidates(url);
  ok(got.length === 3 && got[0] === "https://gh-proxy.com/" + url && got[1] === "https://ghfast.top/" + url && got[2] === url,
    "真值：github.com 地址 → 镜像两条 + 直连兜底（三条）");
  ok(mirrorCandidates("https://api.github.com/repos/x/y/releases/latest").length === 3,
    "真值：api.github.com 也走镜像（检查更新用）");
  ok(JSON.stringify(mirrorCandidates("https://example.com/self-hosted/manifest.json")) === JSON.stringify(["https://example.com/self-hosted/manifest.json"]),
    "⛔ 真值：非 GitHub host（自建分发/自定义清单）原样返回 —— 不把用户的私有地址发给第三方反代");
  ok(mirrorCandidates("not a url").length === 1,
    "真值：非法 URL 原样返回（不抛）");
  ok(GH_MIRROR_PREFIXES[GH_MIRROR_PREFIXES.length - 1] === "",
    "真值：最后一档恒为直连（空串）—— 镜像站倒了更新不可用 = 回归");
}

/* ── updates.ts 接线（两仓结构不同：主仓单源常量直连；PPcode 有令牌门 —— 断言按仓分岔）── */
if (IS_PPCODE) {
  ok(/const apiCandidates = token \? \[directUrl\] : mirrorCandidates\(directUrl\)/.test(updates),
    "检查更新走镜像序（匿名）；⛔ 带令牌恒直连（apiCandidates 的 token 门）");
  ok(/const candidates = token \? \[releaseUrl\] : mirrorCandidates\(releaseUrl\)/.test(updates),
    "下载安装包走镜像序（匿名）；⛔ 带令牌恒直连");
} else {
  ok(updates.includes("mirrorCandidates(GITHUB_RELEASES_API)") && /for \(const candidate of mirrorCandidates\(GITHUB_RELEASES_API\)\)/.test(updates),
    "检查更新走镜像序逐条尝试（第一个 2xx 生效）");
  ok(updates.includes("const candidates = mirrorCandidates(releaseUrl)") && /for \(const candidate of candidates\)/.test(updates),
    "下载安装包走镜像序（失败/校验不过换下一档）");
}
ok(/fs\.rm\(destPath, \{ force: true \}\)/.test(updates) && /fs\.rm\(result\.path, \{ force: true \}\)/.test(updates),
  "每条候选开跑前删半截文件、校验失败删坏文件（半截包绝不进下一轮/不被执行）");
ok(/sha256Of\(match\??\.digest\)/.test(updates) && /function sha256Of\(/.test(updates),
  "asset.digest（GitHub 自带 sha256）接入候选 —— 走镜像后包体完整性的唯一证据");
if (!IS_PPCODE) {
  ok(!/Authorization/i.test(updates),
    "⛔ 主仓更新链零令牌：updates.ts 不出现 Authorization（镜像与直连都不带）");
}

/* ── PPcode 专属：私有仓令牌绝不到镜像 ── */
if (IS_PPCODE) {
  ok(/token \? \[releaseUrl\] : mirrorCandidates\(releaseUrl\)/.test(updates) || /token\s*\?\s*\[[^\]]*\]\s*:\s*mirrorCandidates/.test(updates),
    "⛔ 令牌门：带 token 的下载恒直连（资产 API 地址），只有匿名走镜像 —— 只读令牌不泄露给第三方反代");
  ok(/source\.token ?\?|token \?/.test(updates) && !/mirrorCandidates\([^)]*\)[^;\n]*Authorization/i.test(updates),
    "⛔ 检查更新同理：带令牌的 API 请求不走镜像前缀");
}

console.log(`\n【update-mirror】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
