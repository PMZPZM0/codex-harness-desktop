/**
 * 12bq-husk —— Husk（iPhone 上跑 Android）的「下载 IPA → 侧载引导 → 卡片」全链路守卫（11-14）。
 *
 * 用户令「https://github.com/Leviidev/Husk 把这个放到开发工具界面，按需下载，跟飞书 CLI 界面一样」。
 * 钉住：
 *   ① 只下载官方 Husk.ipa（GitHub release 镜像序 + SHA256），解压/安装一概不做；
 *   ② 不假装能从电脑安装到 iPhone（真机侧载必须用户在 iPhone 上完成）；
 *   ③ 更新链（GITHUB_UPDATEABLE）与 version.txt 对齐；
 *   ④ 通道三处一致（域文件 / manifest / registry）+ 组合表启用；
 *   ⑤ 设置页卡片、官方指南/AltStore 源单一真相源、更新行；
 *   ⑥ 不链 GPL 代码：本仓只下载官方 IPA，不 import 上游源码。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【husk】${m}`); if (!c) fails++; };
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const codeOnly = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const INSTALL = "electron/husk-install.ts";
const DOMAIN = "electron/features/husk-ipc.ts";
const RUNTIME = "electron/features/runtime-ipc.ts";
const DEVRUN = "electron/features/dev-runtimes.ts";
const CARD = "src/features/settings-devtools/HuskCard.tsx";
const PAGE = "src/features/settings-devtools/DevtoolsSettingsSection.tsx";
const GROUPS = "src/features/settings-devtools/runtime-groups.tsx";

/* ── ① 下载链 ────────────────────────────────────────────────── */
{
  const dev = codeOnly(read(DEVRUN));
  ok(/husk: \{ name: "Husk（iPhone 跑 Android）"[\s\S]{0,600}?marker: "husk\\\\Husk\.ipa"/.test(dev),
    "开发工具规格表有 husk 且 marker 指向 Husk.ipa");
  const install = codeOnly(read(INSTALL));
  ok(/export const HUSK_REPO = "Leviidev\/Husk"/.test(install), "仓库地址单一真相源");
  ok(/const asset = "Husk\.ipa"/.test(install), "资产名 = Husk.ipa（官方 release）");
  ok(/releases\/download\/\$\{version\}\/\$\{asset\}/.test(install), "按 release tag 下载");
  ok(/expectZipMagic: true/.test(install), "IPA 是 zip，做 zip 魔数校验");
  ok(/fetchAssetDigest\(asset\)/.test(install) && /expectedSha !== actualSha/.test(install),
    "按 release digest 做 SHA256 校验");
  ok(/writeFile\(paths\.versionFile/.test(install), "装完落 version.txt（更新链读它）");
  ok(/copyFile\(target, next\)[\s\S]{0,120}?rename\(next, paths\.ipa\)/.test(install),
    "IPA 先写临时文件再原子替换（不在半截上覆盖）");
  ok(!/adb|idevice|pymobiledevice|MobileDevice/.test(install), "⛔ 不假装能从电脑装进 iPhone");
}

/* ── ② 更新链 ────────────────────────────────────────────────── */
{
  const runtime = codeOnly(read(RUNTIME));
  ok(/husk: \{ repo: HUSK_REPO, label: "Husk（iPhone 跑 Android）", install: installHuskFromGitHub \}/.test(runtime),
    "GITHUB_UPDATEABLE 有 husk（可检查更新）");
  ok(/if \(id === "husk"\) return huskInstalledVersion\(\)/.test(runtime), "已装版本读 version.txt");
  ok(/id === "husk"[\s\S]{0,240}?installHuskFromGitHub/.test(runtime), "runtime:install 有 husk 分支");
}

/* ── ③ 通道与界面 ────────────────────────────────────────────── */
const EXPECTED = ["husk:status", "husk:guide", "husk:reveal"];
{
  const domain = codeOnly(read(DOMAIN));
  ok(EXPECTED.every((ch) => domain.includes(`"${ch}"`)), "域文件注册全部 3 条通道");
  ok(/HUSK_GUIDE_URL/.test(domain) && /HUSK_SOURCE_URL/.test(domain), "指南与 AltStore 源从主进程单一真相源下发");
  const registry = read("electron/ipc-registry.ts");
  const row = registry.match(/\{ prefix: "husk", count: (\d+)[\s\S]*?channels: \[([^\]]+)\]/);
  ok(Boolean(row) && Number(row[1]) === EXPECTED.length, "ipc-registry 的 count = 3");
  ok(Boolean(row) && EXPECTED.every((ch) => row[2].includes(ch)), "ipc-registry 的 channels 逐条对得上");
  const manifest = read("electron/ipc-channels.manifest.json");
  ok(EXPECTED.every((ch) => manifest.includes(`"channel": "${ch}"`)), "manifest 有全部 3 条通道");
  const composition = read("electron/composition.json");
  ok(/"id": "husk"[\s\S]{0,200}?"file": "features\/husk-ipc\.ts"[\s\S]{0,80}?"export": "huskFeature"/.test(composition),
    "组合表启用 husk");

  const card = codeOnly(read(CARD));
  ok(/<RuntimeUpdateRow[\s\S]{0,200}?id="husk"/.test(card), "卡片内有更新行（Husk.ipa）");
  ok(/huskGuide\(/.test(card) && /huskReveal\(/.test(card) && /sourceUrl/.test(card),
    "侧载区：安装指南 / 定位 IPA / AltStore 源都在");
  ok(/iOS 15\.5\+/.test(card) && /SideStore|AltStore|TrollStore/.test(card), "写清 iOS 15.5+ 与三种侧载方式");
  ok(/不会、也无法替你把 IPA 装进 iPhone/.test(card), "⛔ 明确不声称电脑能直接装进 iPhone");
  const page = codeOnly(read(PAGE));
  ok(/"husk"/.test(page) && /<HuskCard/.test(page), "二级弹窗挂 HuskCard");
  ok(/title: "Husk（iPhone 跑 Android）"/.test(page), "一级卡片出现在开发工具页");
  const groups = codeOnly(read(GROUPS));
  ok(/DEDICATED_IDS = \[[^\]]*"husk"/.test(groups), "专用卡不进分组重复出卡");
  ok(/devtools-update-rows|husk-card/.test(read("scripts/accept.mjs")), "验收项登记（husk 卡）");
}

/* ── ④ GPL 边界 ──────────────────────────────────────────────── */
{
  const install = codeOnly(read(INSTALL));
  const domain = codeOnly(read(DOMAIN));
  ok(!/from ["']\.\.\/.*Husk|Leviidev\/Husk\/src/.test(install + domain),
    "⛔ 不 import 上游源码（只下载官方 IPA，GPL 外部工具不进依赖面）");
  ok(/GPL-2\.0/.test(read(DOMAIN)) && /GPL-2\.0/.test(read(CARD)), "界面与状态如实标注 GPL-2.0");
}

console.log("");
console.log(fails === 0
  ? `【husk】通过（${checks} 条）`
  : `【husk】失败：${fails}/${checks} 条`);
process.exit(fails === 0 ? 0 : 1);
