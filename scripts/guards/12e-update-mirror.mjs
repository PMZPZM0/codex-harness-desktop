/**
 * 更新链镜像化判据（10-11 立；11-20 按实测重排）：资产「直连 → gh-proxy → hk.gh-proxy → ghfast」，API 仍镜像优先。
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

/* ── 单一真相源 ── */
ok(/export const GH_MIRROR_PREFIXES = \["", "https:\/\/gh-proxy\.com\/", "https:\/\/hk\.gh-proxy\.com\/", "https:\/\/ghfast\.top\/"\] as const/.test(mirrorSrc),
  "镜像表唯一一份在 gh-mirror.ts：**直连 → gh-proxy → hk.gh-proxy → ghfast**（11-20 实测 16MB Range：gh-proxy 0.68MB/s > ghfast 0.095MB/s > hk 302 不可用；⛔ 顺序已反转两次，发版前必须重测）");
ok(/export const GH_API_MIRROR_PREFIXES = \["https:\/\/gh-proxy\.com\/", "https:\/\/hk\.gh-proxy\.com\/", ""\] as const/.test(mirrorSrc),
  "API 单独一套序（镜像优先）：api.github.com 直连在国内不通，不能与资产共用「直连优先」");
ok(/"https:\/\/ghfast\.top\/"/.test(codeOnly(mirrorSrc)),
  "ghfast 必须在候选里（11-15 曾因 Range 403 删除，11-19 复测已恢复 206 且最快 —— ⛔ 别再按旧结论钉「删除」）");
ok(!/"https:\/\/gh-proxy\.com\/"/.test(updates) && !/"https:\/\/gh-proxy\.com\/"/.test(official),
  "⛔ 镜像字面量不再散落：updates / 官方市场都从 gh-mirror 取（voice/model-store 除外 —— 它的顺序是按实测速度排的，语义不同）");
ok(/const MIRROR_PREFIXES = GH_MIRROR_PREFIXES/.test(official),
  "既有消费方改成别名引用（局部语义与消费写法不变）");

/* ── mirrorCandidates 真值表（真跑，不是读代码）── */
{
  const { mirrorCandidates, GH_MIRROR_PREFIXES } = await import("../../electron/gh-mirror.ts");
  const url = "https://github.com/a/b/releases/download/v1/x.exe";
  const got = mirrorCandidates(url);
  ok(got.length === 4 && got[0] === url && got[1] === "https://gh-proxy.com/" + url
    && got[2] === "https://hk.gh-proxy.com/" + url && got[3] === "https://ghfast.top/" + url,
    "真值：github.com 资产 → **直连第一**、三档镜像按 11-19 实测吞吐兜底");
  const apiGot = mirrorCandidates("https://api.github.com/repos/x/y/releases/latest");
  ok(apiGot.length === 3 && apiGot[0] === "https://gh-proxy.com/https://api.github.com/repos/x/y/releases/latest",
    "真值：api.github.com 仍走**镜像优先**（直连在国内不通），与资产不同序");
  ok(JSON.stringify(mirrorCandidates("https://example.com/self-hosted/manifest.json")) === JSON.stringify(["https://example.com/self-hosted/manifest.json"]),
    "⛔ 真值：非 GitHub host（自建分发/自定义清单）原样返回 —— 不把用户的私有地址发给第三方反代");
  ok(mirrorCandidates("not a url").length === 1,
    "真值：非法 URL 原样返回（不抛）");
  ok(GH_MIRROR_PREFIXES[0] === "",
    "真值：直连排第一（11-15 实测最快）；镜像在其后兜底 —— 直连不通时第一次请求快速失败并落到镜像");
  ok(GH_MIRROR_PREFIXES.length >= 2 && GH_MIRROR_PREFIXES.some((x) => x.startsWith("https://")),
    "真值：至少还留一个镜像兜底（只剩直连 ⇒ 连不上 GitHub 的用户永远更新失败）");
}

/* ── updates.ts 接线（两仓结构不同：主仓单源常量直连；PPcode 有令牌门 —— 断言按仓分岔）── */
if (IS_PPCODE) {
  ok(/const apiCandidates = token \? \[directUrl\] : mirrorCandidates\(directUrl\)/.test(updates),
    "检查更新走镜像序（匿名）；⛔ 带令牌恒直连（apiCandidates 的 token 门）");
  ok(/const candidates = token \? \[releaseUrl\] : mirrorCandidates\(releaseUrl\)/.test(updates),
    "下载安装包走镜像序（匿名）；⛔ 带令牌恒直连");
} else {
  // ⛔ 10-12 对账修正：更新链改走 releases **LIST** API（取全部资产匹配 digest），镜像序判定跟着换锚点
  ok(updates.includes("mirrorCandidates(GITHUB_RELEASES_LIST_API)") && /for \(const candidate of mirrorCandidates\(GITHUB_RELEASES_LIST_API\)\)/.test(updates),
    "检查更新走镜像序逐条尝试（第一个 2xx 生效）");
  ok(updates.includes("const candidates = mirrorCandidates(releaseUrl)")
    && /const ranked = candidates\.length > 1 \? await rankMirrorsBySpeed\(candidates\) : candidates/.test(updates)
    && /for \(let candidateIndex = 0; candidateIndex < ranked\.length/.test(updates),
    "下载安装包：先并行测速重排（rankMirrorsBySpeed，11-20「上来要最快的源」），再逐条试（失败/校验不过/太慢 都换下一档；带索引是为了把 hasAlternative 传给超时与低速看门狗）");
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

/* ── 主仓专属：NSIS 差分更新接线（10-25）──
   electron-updater + blockmap/latest.yml；差分失败必须回退完整包（不能只剩差分一条路）。 */
if (!IS_PPCODE) {
  const pkg = read("package.json");
  const ipc = codeOnly(read("electron/features/updates-ipc.ts"));
  const buildWin = read(".github/workflows/build-win.yml");
  const release = read(".github/workflows/release.yml");
  ok(/"electron-updater"/.test(pkg) && /"provider": "generic"/.test(pkg) && /"artifactName": "Codex\.Harness\.Desktop-\$\{version\}-win-\$\{arch\}/.test(pkg),
    "打包配置含 electron-updater 的 publish 元数据 + 与 Release 一致的 Windows 资产名");
  /* 11-20 用户令：「差分更新删了吧，就保留一个正常安装包更新」。
     隔离实验实测：镜像开 multipart 返回 application/octet-stream（库拒收），关掉后 528 个单段请求
     被 ERR_CONNECTION_RESET 掐断，GitHub 直连 302 都拿不到 ⇒ electron-updater 原生差分在此链路上不可用。
     ⇒ 断言翻成**负向**：差分链不许复活；更新入口只有「查版本 → 镜像序下完整包 → 校验 → 非静默安装」。 */
  ok(!/downloadUpdateDifferential|tryDifferential|differentialUpdater|setFeedURL/.test(updates)
    && !/downloadUpdateDifferential|tryDifferential|hasPendingDifferential/.test(ipc),
    "⛔ 差分链已整体删除（不许再出现 electron-updater 下载器 / feed / tryDifferential）");
  ok(/export async function downloadUpdate\b/.test(updates) && /await downloadUpdate\(url/.test(ipc),
    "更新只剩一条路：镜像序下载完整安装包（downloadUpdate）");
  ok(/\.exe\.blockmap/.test(buildWin) && /latest\.yml/.test(buildWin) && /\.exe\.blockmap/.test(release) && /latest\.yml/.test(release),
    "发布流水线同时上传 exe / .exe.blockmap / latest.yml（缺任一则客户端只能整包）");
}

console.log(`\n【update-mirror】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
