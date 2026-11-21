#!/usr/bin/env node
/**
 * 12cf-github-mirror-paths —— 全应用「GitHub 一律走镜像快速通道」（11-21 用户令）
 *
 * 用户原话：「一个个检查，应用必须全部走镜像快速通道，全应用镜像，只要是 GitHub 的必须走镜像快速通道」。
 *
 * 这条守卫钉的是**结构**，不是某次改动的结果：
 *   ① 真相源只有一个 —— `src/lib/github-mirror.mjs`；`electron/gh-mirror.ts` 只转出，不许再写一份表。
 *   ② 所有会**下载** GitHub 资产的模块都必须经 `mirrorCandidates` / `downloadThroughMirrors`；
 *      漏一处 = 那一个功能在国内就是龟速/卡死（用户实测过：CosyVoice 装到 15% 卡死 =
 *      torch 走了 download.pytorch.org；热门页慢 = 硬编码了较慢那档镜像）。
 *   ③ 渲染层直连 `api.github.com` 的两处也必须取同一份候选序（镜像带 ACAO:*，可直接 fetch）。
 *
 * ⛔ 独立守卫（不进 `_ctx.mjs` 的 MODULES）⇒ 不计入 EXPECTED_CHECKS，与 11* / 12b* 系列同款。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
/** 去掉注释再做正则（注释里写「直连快」不该被当成代码行为）。 */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks += 1;
  if (condition) {
    console.log(`✓ ${message}`);
  } else {
    fails += 1;
    console.log(`✗ ${message}`);
  }
};

/* ── ① 单一真相源 ───────────────────────────────────────────────────── */
{
  const shared = codeOnly(read("src/lib/github-mirror.mjs"));
  const shim = codeOnly(read("electron/gh-mirror.ts"));
  ok(/export const GH_MIRROR_PREFIXES = \["", "https:\/\/gh-proxy\.org\/"/.test(shared)
    && /export function mirrorCandidates\(url\)/.test(shared),
    "镜像真相源 = src/lib/github-mirror.mjs（gh-proxy.org 在第二档，mirrorCandidates 只此一处）");
  ok(/GH_MIRROR_PREFIXES as SHARED_ASSET/.test(shim) && /import \{[\s\S]{0,200}github-mirror\.mjs"/.test(shim),
    "electron/gh-mirror.ts 只从共享模块转出（⛔ 不许再写一份前缀数组）");
  ok(!/const GH_MIRROR_PREFIXES = \["/.test(shim),
    "gh-mirror.ts 里没有第二份字面量数组（两处拷贝 = 一处改了另一处还慢）");
}

/* ── ② 下载点全部走镜像 ─────────────────────────────────────────────── */
{
  /* 这些模块真的会下载 GitHub 资产（release 包 / 源码 zip / 清单）。 */
  const downloaders = [
    "electron/update-service.ts",          // 应用自身更新（走 mirror-download）
    "electron/artcraft.ts",                // Craft 全家桶
    "electron/features/runtime-ipc.ts",    // Filee / apkstart / 各运行时
    "electron/husk-install.ts",            // Husk
    "electron/openfilm/desktop.ts",        // OpenFilm 桌面端
    "electron/openmaic-install.ts",        // OpenMAIC
    "electron/features/skill-packs-ipc.ts",// 精选技能包
    "electron/codex-official-market.ts",   // 官方插件市场
    "electron/moekoe-core.ts",             // MoeKoe 音乐
    "electron/voice/model-store.ts",       // 音色克隆 / KWS 模型包
    "electron/voice/external-engines.ts",  // 外部语音引擎（源码 + 子模块）
    "electron/features/github-trending.ts",// GitHub 热门（主进程侧）
  ];
  const missing = downloaders.filter((rel) => {
    const src = codeOnly(read(rel));
    return !/mirrorCandidates|downloadThroughMirrors|GH_MIRROR_PREFIXES|mirrorCandidates|fetchWithMirror|fetchJsonViaMirror/.test(src);
  });
  ok(missing.length === 0,
    `12 个 GitHub 下载点全部经镜像候选序${missing.length ? `（缺：${missing.join(" / ")}）` : ""}`);
}

/* ── ③ PyTorch 必须走阿里云镜像（用户在 15% 卡死就是卡这里）───────────── */
{
  const engines = codeOnly(read("electron/voice/external-engines.ts"));
  ok(/const TORCH_MIRROR_BASE = "https:\/\/mirrors\.aliyun\.com\/pytorch-wheels"/.test(engines)
    && /"--find-links", `\$\{TORCH_MIRROR_BASE\}\/\$\{tag\}\/`/.test(engines),
    "torch 走阿里云 pytorch-wheels 镜像（平铺目录只能 --find-links，⛔ 用 --index-url 会 404）");
  ok(!/"--index-url", "https:\/\/download\.pytorch\.org/.test(engines),
    "⛔ 不再直接让 torch 走 download.pytorch.org（国内拉不动，官方源只在镜像未命中时兜底）");
  ok(/async function installTorch\(/.test(engines)
    && /installTorch\(uv, py, "cu121"/.test(engines)
    && /installTorch\(uv, py, backend/.test(engines),
    "两处 torch 安装（CosyVoice 固定 cu121 / 通用引擎 cuXXX）统一走 installTorch");
  ok(/withHeartbeat\(/.test(engines) && /已用 \$\{fmtElapsed/.test(engines),
    "长时间无自然进度的步骤有心跳（每 5s 报「已用 N 分 M 秒」）—— 否则界面停在 15% 就像卡死");
}

/* ── ④ 渲染层两处直连 GitHub 也必须走同一份候选序 ─────────────────────── */
{
  const trending = codeOnly(read("src/features/github-trending/index.tsx"));
  const design = codeOnly(read("src/features/settings-devtools/FrontendDesignCard.tsx"));
  ok(/mirrorCandidates\(api\)/.test(trending) && /github-mirror\.mjs/.test(trending),
    "渲染层「GitHub 热门」取共享候选序（⛔ 不许硬编码单档镜像）");
  ok(/mirrorCandidates\(`https:\/\/api\.github\.com\/repos\/\$\{repo\}\/commits/.test(design) && /github-mirror\.mjs/.test(design),
    "渲染层「前端设计」查上游提交走镜像（api.github.com 国内直连常 403）");
}

console.log(`\n【github-mirror-paths】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
if (fails) process.exitCode = 1;
