/**
 * 托盘图标构建脚本（09-23）
 *
 * 产出三个文件（**不入 git 之外的地方，全部落在 build/**）：
 *   build/tray.png           16/32/48 彩色托盘图（Windows/Linux 用；取 32 作主图，系统按 DPI 缩放）
 *   build/trayTemplate.png   macOS「模板图」：**纯黑 + alpha**，命名以 Template 结尾
 *   build/trayTemplate@2x.png  Retina 倍图（macOS 按文件名自动配 @2x）
 *
 * 为什么 mac 要单独一份（平台约定，不是可选项）：
 *   macOS 状态栏图标用「模板图」——系统只读 alpha 通道并按当前菜单栏明暗自动反色。
 *   直接塞彩色图标会在深色菜单栏上变成一块糊掉的色斑。命名必须以 `Template` 结尾才会被识别。
 *
 * 运行（resvg-js 装在隔离 workspace，不污染项目 node_modules）：
 *   NODE_PATH=<workspace>/node_modules <node> scripts/build-tray-icon.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "build");

let Resvg;
try {
  ({ Resvg } = require("@resvg/resvg-js"));
} catch (error) {
  console.error("[build-tray-icon] 读不到 @resvg/resvg-js：", error.message);
  console.error("  装法：cd ~/.workbuddy/binaries/node/workspace && npm install @resvg/resvg-js");
  process.exit(1);
}

/** 彩色托盘图：**直接复用应用图标母版** `build/icon-a-spark.svg`（桌面快捷方式 / 任务栏用的
 *  `build/icon.ico` 就是它渲染出来的）—— 用户 09-24 明确要求「桌面快捷图标是啥样，任务栏跟系统
 *  托盘就啥样」。
 *  ⛔ 别再在这里另画一版：09-23 首版是手写的简化图（星标压在 `>` 上、无光标条），与应用图标
 *     构图不同 ⇒ 任务栏与托盘肉眼不一致。母版改了这里自动跟着变。 */
const MASTER_SVG = fs.readFileSync(path.join(OUT_DIR, "icon-a-spark.svg"), "utf8");


/** macOS 模板图：**只用 alpha**（系统按菜单栏明暗反色）。所以画成纯黑、无渐变、无底色 ——
 *  底色方块在模板图里会变成一整块实心黑砖，看起来像"菜单栏多了个黑洞"。 */
const TEMPLATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path d="M170 130 L336 256 L170 382" fill="none" stroke="#000000" stroke-width="76"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="382" cy="252" r="30" fill="#000000"/>
</svg>`;

function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

function writePng(file, buffer, label) {
  const target = path.join(OUT_DIR, file);
  fs.writeFileSync(target, buffer);
  // 回读校验：PNG 签名 + 尺寸（防止渲染出 0 字节 / 尺寸不对却静默成功）
  const back = fs.readFileSync(target);
  const isPng = back.slice(0, 8).toString("hex") === "89504e470d0a1a0a";
  const width = back.readUInt32BE(16);
  const height = back.readUInt32BE(20);
  const ok = isPng && width === height && back.length > 100;
  console.log(`  ${ok ? "✓" : "✗"} ${file}  ${width}x${height} ${back.length}B  ${label}`);
  if (!ok) process.exitCode = 1;
  return { file, width, height, bytes: back.length, ok };
}

console.log("[build-tray-icon] 生成托盘图标");
const results = [];
// Windows/Linux：彩色。32 是主图（系统按 DPI 缩放；16 太糊、64 浪费）
results.push(writePng("tray.png", render(MASTER_SVG, 32), "彩色 · 与应用图标同源（Windows/Linux）"));
// macOS：模板图 + @2x。⛔ 文件名必须带 Template 才会被当作模板图
results.push(writePng("trayTemplate.png", render(TEMPLATE_SVG, 16), "macOS 模板图 1x"));
results.push(writePng("trayTemplate@2x.png", render(TEMPLATE_SVG, 32), "macOS 模板图 2x"));

const bad = results.filter((r) => !r.ok).length;
console.log(bad ? `[build-tray-icon] ✗ ${bad} 个文件不合规` : "[build-tray-icon] ✓ 全部就绪");