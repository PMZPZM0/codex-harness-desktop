/**
 * 免费模型网关（free-gateway 域）判据（10-12 立）
 *
 * 用户令：把第三方开源 dsh-our-free-model 做成可选下载的侧车网关接入（方案 A），
 * 并在新手引导与模型页推荐，**必须带免责声明「一切与开发者无关」**。
 *
 * 失效方式全是有害且静默的：
 *   · 免责声明被改文案删掉 ⇒ 推荐一个灰色第三方能力却没告知风险（本守卫最核心的一条）；
 *   · 本域直接写 custom-model 存储 ⇒ 两套写路径漂移（注册必须走渲染层 custom-model:save）；
 *   · manifest/registry/composition 任一漏登记 ⇒ 通道调不到或域不挂载；
 *   · 侧车本体落进源码仓 ⇒ 2.9MB 混淆产物进 git。
 * 行为（真实下载/启动）由验收与用户实测覆盖；本守卫钉结构、登记与单源边界。
 * 独立守卫（不进 _ctx MODULES 计数），要加进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【free-gateway】${message}`);
  if (!condition) fails++;
};

const domain = read("electron/features/free-gateway-ipc.ts");
const manifest = read("electron/ipc-channels.manifest.json");
const registry = read("electron/ipc-registry.ts");
const composition = read("electron/composition.json");
const card = read("src/features/free-gateway/FreeGatewayCard.tsx");
const barrel = read("src/features/free-gateway/index.ts");
const guide = read("src/features/newbie-guide/sections.tsx");
const modelPage = read("src/features/settings-model/ModelSettingsSection.tsx");
const css = read("src/styles/35-free-gateway.css");
const stylesEntry = read("src/styles.css");
const pkg = JSON.parse(read("package.json"));

/* ── 一、登记三件套 ─────────────────────────────────────────────────── */
ok(/id: "free-gateway"/.test(domain) && /export const freeGatewayFeature/.test(domain),
  "域文件 defineFeature(id=free-gateway) 在");
for (const ch of ["status", "download", "start", "stop", "open-admin", "models"]) {
  ok(manifest.includes(`"channel": "free-gateway:${ch}"`) && domain.includes(`"free-gateway:${ch}"`),
    `通道 free-gateway:${ch} 在 manifest 与域两侧都在`);
}
ok(/prefix: "free-gateway", count: 7,/.test(registry) && /file: "features\/free-gateway-ipc\.ts"/.test(registry),
  "ipc-registry 账本登记（count 6 + 域文件指向）");
ok(/"id": "free-gateway"/.test(composition) && /"export": "freeGatewayFeature"/.test(composition),
  "composition.json 域组合表登记（域不自挂，由组合层挂载）");

/* ── 二、⛔ 免责声明契约（用户定稿「一切与开发者无关」）────────────────── */
ok(card.includes("与本项目开发者无关") && /DISCLAIMER_SHORT = "第三方开源项目，与本项目开发者无关"/.test(card),
  "推荐卡/弹窗带免责声明（「与本项目开发者无关」，文案常量在卡片文件）");
ok(guide.includes("与本项目开发者无关") && guide.includes("免费模型网关"),
  "新手引导的推荐步骤带免责声明");
ok(modelPage.includes("免费模型网关") && modelPage.includes("../free-gateway"),
  "模型页接入了推荐卡（经 free-gateway barrel，禁深链内部文件）");

/* ── 三、单一真相源边界：供应商注册走 custom-model:save ────────────────── */
{
  const cardCode = codeOnly(card);
  ok(cardCode.includes("window.codex.saveCustomModel") && cardCode.includes("window.codex.freeGatewayModels"),
    "注册走既有 custom-model:save（渲染层拿 Key/模型清单后调用），模型清单经 free-gateway:models");
  const domainCode = codeOnly(domain);
  ok(!/custom-model/i.test(domainCode.replace(/不走本域|不碰 custom-model 存储/g, "")),
    "⛔ 域文件不 import / 不写 custom-model 存储（两套写路径必漂移 —— 头注契约）");
}

/* ── 四、侧车本体不进源码仓 + 样式接入 ────────────────────────────────── */
ok(/app\.getPath\("userData"\), "free-gateway"\)/.test(domain) && /"app"\)/.test(domain),
  "侧车本体落 userData/free-gateway/app（⛔ 不进源码仓 —— 2.9MB 混淆产物）");
ok(stylesEntry.includes('@import "./styles/35-free-gateway"') && /\.free-gateway-disclaimer \{/.test(css),
  "样式分节 35-free-gateway.css 存在且被 barrel 引入");

/* ── 五、check 链登记（本文件必须被跑）────────────────────────────────── */
ok(pkg.scripts.check.includes("12c-free-gateway.mjs"), "package.json check 链已登记本守卫");

console.log(`\n【free-gateway】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
