/**
 * 3D 模型预览判据（model-viewer 域，2026-10-05，纯离线、可随预检跑）
 *
 * 链路六接缝（缺一 = tsc/预检全绿但功能白屏）：网关能力声明 → dispatch-rpc 执行端（路径闸 + 推送）
 * → preload 双桥（gen 读通道 + 手写推送桥）→ 渲染层弹窗挂载 → 懒加载模型库 → CSS。
 * ⛔ 安全面是命门：resolveModelPath 必须钉死「可信根 + 扩展名白名单 + 大小上限」三件套。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log(`  ✗ 【mv】${m}`); } };

const read = (p) => readFileSync(join(ROOT, p), "utf8");
let mvDist = "", rpc = "", core = "", preload = "";
try {
  mvDist = read("dist-electron/features/model-viewer-ipc.js");
  rpc = read("dist-electron/features/dispatch-rpc.js");
  core = read("dist-electron/features/dispatch-core.js");
  preload = read("dist-electron/preload.js");
} catch {
  console.log("  ✗ 【mv】读 dist-electron 产物失败（先 npm run build:electron）");
  process.exit(1);
}
const mvSrc = codeOnly(read("electron/features/model-viewer-ipc.ts"));
const appView = codeOnly(read("src/features/app-view/AppView.tsx"));
const barrel = codeOnly(read("src/features/model-viewer/index.ts"));
const modal = codeOnly(read("src/features/model-viewer/ModelViewerModal.tsx"));
const styles = read("src/styles.css");
const skill = codeOnly(read("electron/builtin-skills/17-skill-3d-modeling.ts"));
const zhNotes = codeOnly(read("electron/builtin-skills/00-skill-zh-notes.ts"));
const seed = codeOnly(read("electron/expert-teams/04-team-builders.ts"));
const part08 = codeOnly(read("src/features/app-state/parts/part08/01-seg.tsx"));

/* ── 主进程域：读通道 + 路径闸 ── */
ok(
  mvDist.includes('"model-viewer:read"') && /exports\.resolveModelPath\s*=/.test(mvDist),
  "model-viewer:read 已注册 + resolveModelPath 已导出（路径闸唯一入口，网关与读通道共用）",
);
// ⛔ 三件套查**产物**（编译后仍在）：源码断言抓不住"产物里闸被拆掉"的变异（实测 m1 假绿）。
// ⛔ 产物里调用被 tsc 改写成 `!(0, runtime_refs_1.isInsideTrustedRoots)(candidate)` ——
//   正则要兼容这种形态（源码形态 isInsideTrustedRoots(candidate) 在产物里不存在，恒红）。
ok(
  /isInsideTrustedRoots\)?\(candidate\)/.test(mvDist) && mvDist.includes('".glb"') && /MAX_MODEL_BYTES/.test(mvDist),
  "路径闸三件套（产物层）：可信根 + 扩展名白名单（.glb/.gltf）+ 大小上限（⛔ 任意路径读 = XSS 读全盘）",
);

/* ── 网关：声明 + 执行端 ── */
ok(
  core.includes('"preview_3d"') && /glb/i.test(core),
  "preview_3d 已进网关能力清单（模型 name=list 要能看到）",
);
ok(
  rpc.includes('"preview_3d"') && rpc.includes("resolveModelPath") && rpc.includes('"model-viewer:open"'),
  "preview_3d 执行端：路径过闸 → sendToWindow(model-viewer:open)（不过闸直接推 = 安全面裸奔）",
);

/* ── preload 双桥（读 = gen 段；推送 = 手写桥，两段都要在）── */
ok(
  preload.includes('"model-viewer:read"') && preload.includes("readModel"),
  "preload 读桥 readModel → model-viewer:read（gen 段）",
);
ok(
  /onModelViewerOpen:\s*\(listener/.test(preload) && preload.includes('"model-viewer:open"'),
  "preload 推送桥 onModelViewerOpen → model-viewer:open（手写桥，不在 manifest）",
);

/* ── 渲染层：挂载 + 懒加载 + CSS ── */
// ⛔ 挂载断言必须钉 **JSX 侧**：光查符号名会命中 import 行（变异删掉挂载、import 还在 ⇒ 假绿）。
ok(
  appView.includes("<ModelViewerBridge />") && barrel.includes("ModelViewerBridge"),
  "AppView 挂了 <ModelViewerBridge />（经 barrel，域间禁深链）",
);
ok(
  modal.includes('import("@google/model-viewer")') && /viewerPromise\s*\?\?=/,
  "模型库懒加载（~1MB，⛔ 不许改成顶层 import 把主包撑大）",
);
ok(
  modal.includes("URL.revokeObjectURL") && modal.includes("createObjectURL"),
  "Blob URL 生成与回收配对（预览开关多次不泄漏内存）",
);
ok(
  styles.includes("styles/27-model-viewer"),
  "styles.css 引入 27-model-viewer（类前缀 model-viewer，三前缀同源）",
);

/* ── 联动知识面：模型必须「知道」这条链 ── */
ok(
  skill.includes("preview_3d") && zhNotes.includes("preview_3d"),
  "内置技能 3d-modeling 与中文导读都写了 preview_3d 用法",
);
ok(
  seed.includes("preview_3d"),
  "鲁班种子提示词/SOP 写了 preview_3d（新装用户开箱即知；老存档靠技能与网关描述兜底）",
);
ok(
  part08.includes("preview_3d"),
  "harness_tools 网关描述列了 preview_3d（模型读不到 list 就靠这段常驻文本）",
);

console.log(`\n【mv】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
