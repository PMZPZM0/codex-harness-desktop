/**
 * 预检守卫组：05-ipc-contract
 * 分节：【22】（原 L2896–L2912）
 *
 * ⚠️ 名不符实说明（2026-09-24 评估 P2-10）：**本文件实际只查 koffi 圆角打包**，与「IPC 契约」
 * 无关 —— IPC 三件套一致性守卫在 01-build-ipc-css（【2】组），跨段一致性在 _ctx 的生成物比对。
 * 文件名沿用是为了不打乱 NN- 分节编号与聚合顺序；拆分/重命名待用户拍板（评估报告 P2-10）。
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, existsSync, fail, join, ok, readFileSync,
} from "./_ctx.mjs";

export async function run() {

  /* ══ 【22】原 L2896–L2912 ══ */
  {
console.log(C.bold("\n【22】Windows 原生圆角：koffi 依赖与打包就位"));

{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const deps = pkg.dependencies || {};
  (deps.koffi ? ok : fail)("生产依赖含 koffi（主进程用它调 DwmSetWindowAttribute 做原生圆角）");
  const unpack = (pkg.build && pkg.build.asarUnpack) || [];
  const unpackHas = (pat) => unpack.some((p) => p.includes(pat));
  (unpackHas("node_modules/koffi") ? ok : fail)("asarUnpack 含 node_modules/koffi/**（.node 必须在 asar 外才能 dlopen）");
  (unpackHas("node_modules/@koromix") ? ok : fail)("asarUnpack 含 node_modules/@koromix/**（koffi 的 win32 预编译子包）");
  if (process.platform === "win32") {
    (existsSync(join(ROOT, "node_modules/koffi")) ? ok : fail)("node_modules/koffi 已安装");
    (existsSync(join(ROOT, "node_modules/@koromix/koffi-win32-x64")) ? ok : fail)("node_modules/@koromix/koffi-win32-x64 预编译就位（Electron 44 / ABI 149 下实测可加载）");
  } else {
    ok("非 win32 平台：跳过原生二进制检查（圆角函数内已按 platform 静默跳过）");
  }
}
  }
}
