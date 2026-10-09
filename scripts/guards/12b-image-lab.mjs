/**
 * 图像工坊判据（image-lab 域，2026-10-09，纯离线、可随预检跑）
 *
 * 链路（缺一 = tsc/预检全绿但功能不可用）：主进程域（读通道 + 路径闸 + **四条工具通道**）→ 编辑引擎
 * （jimp）→ 渲染层四个**各自独立**的 dynamicTool（image_generate/image_edit/image_info/image_view）
 * → 四个工具各自路由到自己的 IPC → preload 双桥（gen 段四条 + 手写推送桥）→ 浮层挂载（含 close 自动收起）→ CSS。
 * ⛔ 10-09 用户两次点名「工具区分开，不要共用一个工具」+「把生成和编辑的 IPC 彻底分开」⇒ 图像四件套
 *    **不再**走 harness_tools 网关 / agents:dispatch-call，本守卫负责把"退回旧网关写法"顶红。
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
  // ⛔ 一律**剥注释**再断言：源码注释里会提到这些工具名（"已搬去 image-lab"之类的说明文字），
  //    直接 includes 会命中注释 ⇒ 旧结构其实删掉了也报绿（假绿）。
  labDist = codeOnly(read("dist-electron/features/image-lab.js"));
  rpc = codeOnly(read("dist-electron/features/dispatch-rpc.js"));
  core = codeOnly(read("dist-electron/features/dispatch-core.js"));
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
const seg08 = codeOnly(read("src/features/app-state/parts/part08/01-seg.tsx"));
const req = codeOnly(read("src/features/app-state/parts/part05/event-router/02-request.tsx"));

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
  "编辑引擎导出（imageEditCore / imageInfoCore —— IPC 通道与浮层共用同一实现）",
);
// ⛔ 10-09 用户：「把生成和编辑的 IPC 也彻底分开，不要混在一起」
ok(
  ["image-lab:generate", "image-lab:edit", "image-lab:info", "image-lab:view"].every((ch) => labDist.includes(`"${ch}"`)),
  "生图 / 修图 / 元信息 / 预览**各有一条自己的 IPC 通道**（不再共用一个 agents:dispatch-call）",
);

/* ── ② 引擎必须是纯 JS（Windows 打包 + mac 交叉构建的硬要求） ── */
ok(Boolean(deps.jimp), "依赖里有 jimp（纯 JS 图像引擎）");
ok(
  !deps.sharp && !deps.canvas && !deps["@napi-rs/canvas"] && !deps.skcanvas,
  "不许引入带 .node 的图像库（sharp/canvas/@napi-rs/canvas）—— ABI/打包风险，Windows 上跑不起来",
);

/* ── ③ 拆分：图像四件套**各走各的**（10-09 用户：「工具区分开，不要共用一个工具」）──
   ⛔ 旧结构是「四个工具都塞进 harness_tools 网关 → agents:dispatch-call → dispatchRpcCall」。
      新结构是「四个各自独立的 dynamicTool → 各自的 image-lab:* 通道」。本组断言把回退挡住。 */
ok(
  !/"image_edit"|"image_info"|"image_view"|"image_generate"/.test(core),
  "⛔ 图像四件套已从 MCP 工具面（dispatch-core）移除 —— 不再与能力网关混在一起",
);
ok(
  !/imageEditCore/.test(rpc) && !/pushImageLabEvent/.test(rpc),
  "⛔ dispatch-rpc 里已无任何图像分支（生成与编辑彻底搬离 agents 域）",
);
ok(
  !/name === "image_/.test(rpc) && !/name === "image_/.test(core),
  "⛔ 执行端不再按工具名分发图像能力（那是旧网关写法）",
);
ok(
  ["image_generate", "image_edit", "image_info", "image_view"].every((n) => seg08.includes(`name: "${n}"`)),
  "渲染层把四件套各注册成独立 dynamicTool（模型工具面里一眼可见，不再包一层 harness_tools）",
);
ok(
  ["imageGenerate", "imageEdit", "imageInfo", "imageView"].every((m) => req.includes(`window.codex.${m}(`)),
  "四个工具各自路由到自己的 IPC（imageGenerate/imageEdit/imageInfo/imageView），不经 callDispatchTool",
);
{
  // ⛔ 一个能力两个入口 = 模型只挑直白的那个、另一套被绕过（项目踩过 subagent_invoke）。
  //    判据只取**「可用：」那段枚举**——描述里同时有一句"这四件是独立工具、本工具调不到"的免责说明，
  //    拿整段做负向会命中那句说明（假红）。
  const descStart = seg08.indexOf('name: "harness_tools"');
  const descEnd = seg08.indexOf('required: ["name"]', descStart);
  const descBlock = descStart >= 0 ? seg08.slice(descStart, descEnd > descStart ? descEnd : undefined) : "";
  const availStart = descBlock.indexOf("可用：");
  const availEnd = descBlock.indexOf("connector_register", availStart);
  const avail = availStart >= 0 ? descBlock.slice(availStart, availEnd > availStart ? availEnd : undefined) : "";
  ok(!!avail && !/image_generate|image_edit|image_info|image_view/.test(avail),
    "⛔ harness_tools 的「可用：」枚举里不再有图像能力（列了 = 一个能力两个入口）");
  ok(/各自独立的工具/.test(descBlock),
    "harness_tools 的描述里点明了图像四件套是独立工具（模型才知道该直接按名字调）");
}
{
  // 用户要的前置询问：生图 / 修图两条描述里必须写明"小改动先问，别自己替用户决定"
  const defsStart = seg08.indexOf("function imageToolDefs");
  const defsEnd = seg08.indexOf("动态工具面（thread/start", defsStart);
  const defs = defsStart >= 0 ? seg08.slice(defsStart, defsEnd > defsStart ? defsEnd : undefined) : "";
  ok(!!defs && /agent_ask/.test(defs) && /重新生成/.test(defs),
    "生图工具的描述里写明了「小改动先用 agent_ask 问：修图 还是 重新生成」");
}

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
{
  // ⛔ 账本自维护：count 必须等于自己 channels 的长度（加通道忘登记 ⇒ 这里红），别写死数字以外的东西
  const entry = /\{\s*prefix: "image-lab", count: (\d+)[\s\S]*?channels: \[([^\]]*)\]/.exec(registry);
  const declared = entry ? Number(entry[1]) : -1;
  const listed = entry ? (entry[2].match(/"[^"]+"/g) || []).length : -1;
  ok(
    declared === 5 && declared === listed && /"image-lab:generate"/.test(registry) && /"image-lab:edit"/.test(registry),
    `ipc-registry 的 image-lab 域账本自洽（count=${declared} / 列出 ${listed} 条，含 generate 与 edit）`,
  );
}
ok(
  ["image-lab:generate", "image-lab:edit", "image-lab:info", "image-lab:view"].every((ch) => manifest.channels.some((c) => c.channel === ch)),
  "manifest 登记了四条独立通道（gen:ipc 据此生成 preload 方法）",
);

console.log(`\n【img】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
