/**
 * 图像工坊判据（image-lab 域，2026-10-09，纯离线、可随预检跑）
 *
 * 链路七接缝（缺一 = tsc/预检全绿但功能不可用）：主进程域（读通道 + 路径闸）→ 编辑引擎（jimp）
 * → 网关能力声明（image_generate/image_edit/image_info/image_view）→ dispatch-rpc 执行端（过闸 + 推送）
 * → preload 双桥（gen 读通道 + 手写推送桥）→ 渲染层弹窗挂载（含 close 自动收起）→ CSS。
 * ⛔ 两条命门：① 路径闸（可信根 + 图片扩展名 + 大小上限），任意路径读写 = 渲染层被注入即可读写全盘；
 *   ② 引擎必须**纯 JS**（jimp）—— 带 .node 的图像库在 Windows 打包 + mac 交叉构建下是已知风险，
 *      本断言把"换回原生库"这类回归直接顶红（用户硬要求：Windows 上要功能完整能跑）。
 * ⛔ 本文件用**本地计数器**（同 12-model-viewer），不进 _ctx 的总账 ⇒ 登记进 check 链不动 EXPECTED_CHECKS。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log(`  ✗ 【img】${m}`); } };
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let labDist = "", rpc = "", core = "";
try {
  labDist = read("dist-electron/features/image-lab.js");
  rpc = read("dist-electron/features/dispatch-rpc.js");
  core = read("dist-electron/features/dispatch-core.js");
} catch {
  console.log("  ✗ 【img】读 dist-electron 产物失败（先 npm run build:electron）");
  process.exit(1);
}
const preload = read("electron/preload.ts");
const pkg = JSON.parse(read("package.json"));
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const appView = codeOnly(read("src/features/app-view/AppView.tsx"));
const barrel = codeOnly(read("src/features/image-lab/index.ts"));
const modal = codeOnly(read("src/features/image-lab/ImageLabModal.tsx"));
const css = read("src/styles/33-image-lab.css");
const stylesEntry = read("src/styles.css");
const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
const registry = read("electron/ipc-registry.ts");
const composition = JSON.parse(read("electron/composition.json"));

/* ── ① 主进程域：读通道 + 路径闸 ── */
ok(
  labDist.includes('"image-lab:read"') && /exports\.resolveImagePath\s*=/.test(labDist),
  "image-lab:read 已注册 + resolveImagePath 已导出（路径闸唯一入口，读通道与编辑共用）",
);
// ⛔ 三件套查**产物**（编译后仍在）；tsc 会把调用改写成 `!(0, runtime_refs_1.isInsideTrustedRoots)(candidate)`
ok(
  /isInsideTrustedRoots\)?\(candidate\)/.test(labDist) && labDist.includes(".png") && /MAX_IMAGE_BYTES/.test(labDist),
  "路径闸三件套（产物层）：可信根 + 图片扩展名白名单 + 大小上限（⛔ 任意路径读写 = XSS 读写全盘）",
);
ok(
  /exports\.imageEditCore\s*=/.test(labDist) && /exports\.imageInfoCore\s*=/.test(labDist),
  "编辑引擎导出（imageEditCore / imageInfoCore —— 网关工具与读通道共用同一实现）",
);

/* ── ② 引擎必须是纯 JS（Windows 打包 + mac 交叉构建的硬要求） ── */
ok(Boolean(deps.jimp), "依赖里有 jimp（纯 JS 图像引擎）");
ok(
  !deps.sharp && !deps.canvas && !deps["@napi-rs/canvas"] && !deps.skcanvas,
  "不许引入带 .node 的图像库（sharp/canvas/@napi-rs/canvas）—— ABI/打包风险，Windows 上跑不起来",
);

/* ── ③ 网关：能力声明 + 执行端 ── */
ok(
  core.includes('"image_edit"') && core.includes('"image_info"') && core.includes('"image_view"') && core.includes('"image_generate"'),
  "图像工坊四件套已进网关能力清单（image_generate/image_edit/image_info/image_view）",
);
ok(
  rpc.includes('"image_edit"') && rpc.includes("imageEditCore") && rpc.includes("pushImageLabEvent"),
  "image_edit 执行端：过闸 → 编辑 → 推 image-lab 事件（不推 = 用户看不到浮层）",
);
ok(
  rpc.includes('"image-lab:event"') === false && rpc.includes("pushImageLabEvent"),
  "推送统一走 pushImageLabEvent（渲染层与主进程同一份事件协议，别在各处手写 channel 字符串）",
);

/* ── ④ preload 双桥（读 = gen 段；推送 = 手写桥） ── */
ok(
  /readImage\b/.test(preload) && manifest.channels.some((c) => c.channel === "image-lab:read" && c.name === "readImage"),
  "读桥 readImage → image-lab:read（gen 段，来自 manifest 单一真相源）",
);
ok(
  /onImageLabEvent:/.test(preload) && preload.includes('"image-lab:event"'),
  "推送桥 onImageLabEvent → image-lab:event（手写桥，不在 manifest）",
);

/* ── ⑤ 渲染层：挂载 + 收图 + 自动收起 + CSS ── */
// ⛔ 挂载断言钉 JSX 侧：光查符号名会命中 import 行（删挂载、import 还在 ⇒ 假绿）
ok(
  appView.includes("<ImageLabBridge />") && barrel.includes("ImageLabBridge"),
  "AppView 挂了 <ImageLabBridge />（经 barrel，域间禁深链）",
);
ok(
  modal.includes("readImage") && modal.includes("createObjectURL") && modal.includes("revokeObjectURL"),
  "浮层经 readImage 拉字节 + Blob URL 生成与回收配对（反复开关不泄漏内存）",
);
// 用户在意的行为：调用完成 → 自动消失（close 相位挂定时器卸载）
ok(
  /phase\s*===\s*"close"/.test(modal) && modal.includes("setTimeout") && modal.includes("setState(null)"),
  "收到 close 相位后延时自动卸载（用户要求：工具调用完成自动消失）",
);
ok(
  stylesEntry.includes("styles/33-image-lab") && /image-lab-backdrop/.test(css),
  "styles.css 引入 33-image-lab（类前缀 image-lab，三前缀同源）",
);

/* ── ⑥ 接线生成物：域表 / 账本 ── */
ok(
  composition.domains.some((d) => d.id === "image-lab" && d.enabled && d.file === "features/image-lab.ts"),
  "域组合表登记了 image-lab（enabled，未登记则域不挂载 ⇒ 读通道 404）",
);
ok(
  registry.includes('prefix: "image-lab"') && registry.includes('"image-lab:read"'),
  "ipc-registry 账本登记了 image-lab（漏登记预检【2】报红）",
);

console.log(`\n【img】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
