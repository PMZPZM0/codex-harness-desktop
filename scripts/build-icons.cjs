/**
 * 应用图标构建：SVG → PNG 多尺寸 → ICO（PNG 压缩格式）。
 * 用法：
 *   node scripts/build-icons.cjs          # 全量渲染 + 主方案 A 落盘
 *   node scripts/build-icons.cjs B        # 全量渲染 + 主方案 B 落盘（同步 icon.png/ico/favicon）
 * 产物：
 *   build/icon-<key>-<size>.png  全部方案 8 尺寸 PNG（1024..16）
 *   build/icon.png               主方案 512（窗口图标 / favicon 源）
 *   build/icon.ico               主方案 16/32/48/64/128/256 多尺寸（electron-builder win.icon）
 *   public/icon.png              主方案 512（favicon，vite 自动拷入 dist）
 * 依赖：@resvg/resvg-js（已装入 ~/.workbuddy/binaries/node/workspace，prebuilt 无需编译）
 */
const fs = require("fs");
const path = require("path");

let Resvg;
try {
  ({ Resvg } = require("@resvg/resvg-js"));
} catch {
  // 回退：从管理的 node workspace 找
  const ws = "C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules";
  ({ Resvg } = require(path.join(ws, "@resvg/resvg-js")));
}

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const PUBLIC = path.join(ROOT, "public");
const SIZES = [1024, 512, 256, 128, 64, 48, 32, 16];
const PLANS = [
  { key: "icon-a-spark", file: "icon-a-spark.svg", label: "A · Codex Spark" },
  { key: "icon-b-terminal", file: "icon-b-terminal.svg", label: "B · 终端窗口" },
  { key: "icon-c-dialogue", file: "icon-c-dialogue.svg", label: "C · 对话代码" },
];

function svgToPng(svgPath, size) {
  const svg = fs.readFileSync(svgPath, "utf8");
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  return resvg.render().asPng();
}

/** PNG 压缩格式 ICO：ICONDIR + ICONDIRENTRY*N + PNG 数据（256 用 0 表示） */
function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + count * 16;
  pngBuffers.forEach((buf, i) => {
    const e = Buffer.alloc(16);
    const dim = sizes[i]; // 必须用传入 sizes，不能引全局 SIZES（顺序会错位）
    e.writeUInt8(dim >= 256 ? 0 : dim, 0);
    e.writeUInt8(dim >= 256 ? 0 : dim, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  });
  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

/** 校验 ICO：每档 entry 尺寸标注与 PNG 数据头 */
function verifyIco(icoPath) {
  const b = fs.readFileSync(icoPath);
  const count = b.readUInt16LE(4);
  let off = 6;
  let ok = true;
  for (let i = 0; i < count; i++) {
    const dim = b[off] || 256;
    const pos = b.readUInt32LE(off + 12);
    const sig = b.slice(pos, pos + 8).toString("hex");
    if (sig !== "89504e470d0a1a0a") ok = false;
    console.log(`  ico entry ${i}: ${dim}x${dim} PNG=${sig === "89504e470d0a1a0a" ? "✓" : "✗"}`);
    off += 16;
  }
  if (!ok) throw new Error("ICO 包含损坏 entry");
  return count;
}

function main() {
  const arg = process.argv[2]?.trim().toUpperCase();
  const want = arg ? PLANS.find((p) => p.label.startsWith(arg) || p.key.includes(arg.toLowerCase())) : PLANS[0];
  if (!want) {
    console.error(`未知方案「${arg}」，可用：${PLANS.map((p) => p.label).join(" / ")}`);
    process.exit(1);
  }
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(PUBLIC, { recursive: true });

  // 1. 渲染全部方案（备选保留，方便随时切换）
  for (const plan of PLANS) {
    for (const size of SIZES) {
      const png = svgToPng(path.join(BUILD, plan.file), size);
      fs.writeFileSync(path.join(BUILD, `${plan.key}-${size}.png`), png);
    }
    console.log(`✓ ${plan.label}: ${SIZES.length} 个尺寸 PNG`);
  }

  // 2. 主方案落盘：icon.png（窗口/favicon）+ icon.ico（exe）+ public/icon.png（favicon）
  fs.copyFileSync(path.join(BUILD, `${want.key}-512.png`), path.join(BUILD, "icon.png"));
  fs.copyFileSync(path.join(BUILD, `${want.key}-512.png`), path.join(PUBLIC, "icon.png"));
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const pngs = icoSizes.map((s) => fs.readFileSync(path.join(BUILD, `${want.key}-${s}.png`)));
  fs.writeFileSync(path.join(BUILD, "icon.ico"), buildIco(pngs, icoSizes));
  const n = verifyIco(path.join(BUILD, "icon.ico"));
  console.log(`✓ 主方案 ${want.label} → icon.png / icon.ico(${n} 档) / public/icon.png 已同步`);
}

main();
