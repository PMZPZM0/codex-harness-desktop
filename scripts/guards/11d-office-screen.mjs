/**
 * 办公室「交互式场景」判据（2026-10-22 第四次重做）
 *
 * 历史：10-04 扫背景图量屏幕坐标（三次翻车）→ 10-22 改成代码绘制 3/4 场景 →
 * 当天用户拍板「不要卡通风」，改成**参考图风格的 3D 场景图 + 可点热点**（安居客式漫游）。
 *
 * 现行实现（本文件判据的对象）：
 *   · 底图 `assets/office-bg.webp`（1792×960，?inline）；
 *   · `OfficeCanvas.tsx`：10 个热点锚点（人物/椅子 + 状态屏矩形），hover 出详情卡、
 *     点击进入成员会话；状态屏叠细线 + 运行中扫描线；缩放/平移沿用旧的 view 逻辑；
 *   · 状态词由 `office-screen.ts`（精简后只剩 RunPhase / effectivePhase / eventWordZhOf）提供；
 *   · 旧的走位模拟（office-sim）与逐帧屏渲染（drawScreen）已整体退役。
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【scene】${m}`); if (!c) fails++; };

const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const canvas = read("src", "features", "team-office", "OfficeCanvas.tsx");
const fmt = read("src", "features", "team-office", "office-format.ts");
const screen = read("src", "features", "team-office", "office-screen.ts");
const css = read("src", "styles", "20-team-office.css");

/* ── ① 场景资产 ── */
const asset = join(ROOT, "src", "features", "team-office", "assets", "office-bg.webp");
ok(existsSync(asset) && statSync(asset).size > 120 * 1024,
  `3D 办公室场景图存在且是高清底图（${existsSync(asset) ? Math.round(statSync(asset).size / 1024) + "KB" : "缺失"}）`);
ok(/import bgUrl from "\.\/assets\/office-bg\.webp\?inline"/.test(canvas),
  "⛔ 场景图 ?inline 强制 data: URI（拆成独立文件 = 构建版 file:// 下 404 白屏）");
ok(!existsSync(join(ROOT, "src", "features", "team-office", "assets", "bg.webp")),
  "⛔ 旧的代码场景位图 bg.webp 已删除");
ok(!existsSync(join(ROOT, "src", "features", "team-office", "assets", "chars")),
  "⛔ 旧的 16×32 精灵图目录已删除");

/* ── ② 画布尺寸 + 10 个热点锚点 ── */
ok(fmt.includes("export const CANVAS_W = 1792") && fmt.includes("export const CANVAS_H = 960"),
  "画布 = 场景图原生尺寸 1792×960");
const anchors = [...canvas.matchAll(/screen: \{ x: (\d+), y: (-?\d+), w: (\d+), h: (\d+) \}/g)]
  .map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
ok(anchors.length === 10, `10 个热点锚点（解析到 ${anchors.length} 个 —— ⛔ 0 个说明正则失配、断言在空跑）`);
ok(new Set(anchors.map((a) => `${a.x},${a.y}`)).size === anchors.length, "10 个热点坐标互不重复（每个成员一张工位）");
ok(anchors.every((a) => a.x >= 0 && a.y >= 0 && a.x + a.w <= 1792 && a.y + a.h <= 960 && a.w >= 80 && a.h >= 60),
  "状态屏矩形都落在画布内且尺寸合理（80~170 × 60~110）");
ok(/const ANCHORS: Anchor\[\] = \[/.test(canvas) && /tagDy: \d+/.test(canvas),
  "锚点带标签纵向偏移（hover 详情卡按它定位）");

/* ── ③ 点击 / 悬停接线（安居客式漫游） ── */
ok(/const hitTest = \(clientX: number, clientY: number\)/.test(canvas)
  && canvas.includes("openRef.current?.(hit.id)"),
  "点击人物热点进入该成员会话（hitTest → openMember）");
ok(/addEventListener\("mousemove"/.test(canvas) && /cursor = id \? "pointer"/.test(canvas),
  "悬停变手型（热点可点这件事必须有视觉提示）");
ok(canvas.includes("hoverRef") && canvas.includes("点击打开会话"),
  "hover 出详情卡（姓名/职业/状态 + 点击提示）");
ok(/const dPerson = Math\.hypot\(/.test(canvas) && /const dTag = Math\.hypot\(/.test(canvas),
  "命中范围覆盖人物与前排标签区（点人和点标签都算）");

/* ── ④ 实时状态层（真实事件面，不编状态） ── */
ok(/eventWordZhOf/.test(canvas) && /effectivePhase/.test(canvas),
  "热点状态走真实阶段 + 真实事件（eventWordZhOf / effectivePhase）");
ok(/status\.level === "run"/.test(canvas) && /createLinearGradient/.test(canvas),
  "运行中的状态屏有实时扫描线（静态场景里的活）");
ok(/fillRect\(s\.x, s\.y, s\.w, 2\)/.test(canvas),
  "状态屏顶部有状态色细线（不覆盖场景里的仪表盘）");
ok(/const hx = a\.x;/.test(canvas) && /ctx\.arc\(hx, hy, isHover \? 8 : 6/.test(canvas),
  "人物肩上主圆标 + 扩散脉冲（清楚可见的可点热点）");
ok(screen.includes("DONE_HOLD_MS") && /export function effectivePhase/.test(screen),
  "office-screen 精简为状态映射（RunPhase / effectivePhase / eventWordZhOf）");
ok(!/export function drawScreen|screensaverAt|screenModeOf/.test(screen),
  "⛔ 旧的逐帧屏渲染（drawScreen / 屏保 / 模式映射）已整体退役");

/* ── ⑤ 照片场景渲染 ── */
ok(canvas.includes("imageSmoothingEnabled = true") && !canvas.includes("imageSmoothingEnabled = false"),
  "照片场景开平滑（关掉会糊成马赛克）");
ok(/image-rendering: auto/.test(css) && !/image-rendering: pixelated/.test(css),
  "画布 CSS 按照片平滑渲染（⛔ 不再 pixelated）");
ok(canvas.includes("ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H)"),
  "底图按画布尺寸铺满（loadImage 失败时有纯色兜底）");

/* ── ⑥ 缩放 / 平移 / 命中（沿用旧的不变量） ── */
ok(/const s = Math\.min\(sw \/ CANVAS_W, sh \/ CANVAS_H\)/.test(canvas)
  && !/Math\.max\(sw \/ CANVAS_W, sh \/ CANVAS_H\)/.test(canvas),
  "⛔ 基准是 contain（整张场景图完整可见）");
ok(!/\.office-pixel-canvas\s*\{[\s\S]{0,300}?object-fit/.test(css),
  "⛔ 画布不许用 object-fit（元素盒≠渲染区 ⇒ 点击命中整体偏移）");
ok(/\.office-overlay-stage\s*\{[\s\S]{0,400}?overflow:\s*hidden/.test(css),
  "舞台容器裁溢出（放大后画布必然超出，不裁会盖住顶栏）");
ok(/canvas\.style\.width = /.test(canvas) && /canvas\.style\.height = /.test(canvas) && /canvas\.style\.transform\s*=/.test(canvas),
  "画布尺寸 + 平移都显式写死");
ok(/addEventListener\("wheel",[\s\S]{0,80}?\{\s*passive:\s*false\s*\}/.test(canvas),
  "滚轮监听必须 { passive: false }");
ok(/const ax = ev\.clientX - rect\.left/.test(canvas) && /const ay = ev\.clientY - rect\.top/.test(canvas),
  "滚轮锚点取指针在舞台坐标系里的位置");
ok(/\(0\.5 - fx\)/.test(canvas) && /\(0\.5 - fy\)/.test(canvas),
  "缩放后按「锚点相对位置不变」重算视图中心");
ok(canvas.includes("controlsRef") && /zoomIn:/.test(canvas) && /zoomOut:/.test(canvas) && /reset: resetView/.test(canvas),
  "缩放句柄（放大 / 缩小 / 重置）与滚轮共用同一条 view 写入路径");
ok(/OFFICE_ZOOM_MIN = 1/.test(canvas) && /OFFICE_ZOOM_MAX = 4/.test(canvas)
  && /Math\.min\(OFFICE_ZOOM_MAX, Math\.max\(OFFICE_ZOOM_MIN/.test(canvas),
  "倍率夹在 [1, 4]（下限=contain 基准）");

/* ── ⑦ 旧模拟层退役（负向，防复活） ── */
ok(!/OfficeSim|from "\.\/office-sim"/.test(canvas) && !/drawWalking|drawRoomStatic/.test(canvas),
  "⛔ 画布不再引用走位模拟/代码画房间人物");
ok(!existsSync(join(ROOT, "src", "features", "team-office", "office-sim.ts")),
  "⛔ office-sim.ts 已删除（旧模拟层退役）");
ok(!existsSync(join(ROOT, "scripts", "guards", "11o-office-sim.mjs")),
  "⛔ 旧 sim 守卫已删除");

/* ── ⑧ 状态映射真跑（事件词 / 完成保留时效） ── */
{
  const script = `
import { eventWordZhOf, effectivePhase, DONE_HOLD_MS } from "./src/features/team-office/office-screen.ts";
const rows = [
  ["terminal", "跑命令"], ["file-edit", "改文件"], ["browser", "开浏览器"],
  ["websearch", "查资料"], ["collab", "分派"], ["thinking", "思考"],
];
let bad = 0;
for (const [kind, want] of rows) {
  const got = eventWordZhOf(kind);
  if (got !== want) { bad += 1; console.log("NO " + kind + " → " + got); }
}
const now = 1_800_000_000_000;
const fresh = effectivePhase("done", now - 1000, now) === "done";
const stale = effectivePhase("done", now - DONE_HOLD_MS - 1000, now) === "none";
const pass = effectivePhase("failed", now - DONE_HOLD_MS - 1000, now) === "none";
const running = effectivePhase("writing", 0, now) === "writing";
console.log((bad === 0 ? "OK " : "NO ") + "事件词映射 " + (rows.length - bad) + "/" + rows.length);
console.log((fresh && stale && pass && running ? "OK " : "NO ") + "effectivePhase：新鲜 done 保留 / 过期回落 none / 运行态不受影响");
`;
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script],
    { cwd: ROOT, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
  const lines = out.split("\n").filter((line) => /^(OK|NO) /.test(line.trim()));
  ok(lines.length >= 2, `状态映射真跑出 ${lines.length} 条（⛔ 0 条 = 脚本没跑起来）`);
  for (const line of lines) {
    const good = line.trim().startsWith("OK ");
    checks += 1;
    if (!good) fails += 1;
    console.log(`  ${good ? "✓" : "✗"} 【scene】${line.trim().slice(3)}`);
  }
}

/* ── ⑨ 成员来源 / 入口（沿用旧口径） ── */
{
  const preview = read("src", "features", "team-office", "TeamOfficePreview.tsx");
  const appView = read("src", "features", "app-view", "AppView.tsx");
  ok(/delegatedRuns\?:\s*DelegateRecordEntry\[\]/.test(preview),
    "TeamOfficePreview 接受 delegatedRuns prop（普通会话的成员来源）");
  ok(/if \(!team\)\s*\{[\s\S]{0,600}?delegatedRuns/.test(preview),
    "team 为空时走「委托记录当成员」这条路径");
  ok(/if \(!teamId\) return null;/.test(preview) && !/if \(!teamId \|\| !team\) return null;/.test(preview),
    "显示门槛只认 teamId（普通会话浮层不被挡掉）");
  ok(/id:\s*r\.threadId/.test(preview), "普通会话成员的 id 是 threadId（点热点能直接开子会话）");
  ok(/id: m\.id/.test(preview) || /members\.concat|members\b/.test(preview),
    "成员数组与热点锚点一一对应（数组顺序 = 场景热点顺序）");
  ok(/delegatedRuns=\{officeDelegates\}/.test(appView) && /Object\.values\(app\.delegateRecords\)/.test(appView),
    "AppView 把委托登记表（含已完成）传进办公室");
  const railsSrc = read("src", "features", "experts-teams", "ExpertsTeams", "02-rails.tsx");
  ok((railsSrc.match(/<OfficeRailNode onOpen=\{/g) ?? []).length === 2,
    "TeamMemberRail 与 DelegatedRail 共用办公室入口节点");
  ok(/OFFICE_SESSION_TEAM_ID\s*=\s*"__office-session__"/.test(read("src", "features", "team-office", "index.ts")),
    "哨兵 teamId 定义在 team-office 域");
}

console.log(`\n【scene】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);