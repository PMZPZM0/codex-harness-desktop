/**
 * 办公室「白色简洁动画场景」判据（2026-10-22 对照 Marvis workbench 重做）
 *
 * 用户先否掉"一张静态 3D 照片"，再要求「一样的白色简洁场景，逆向出来一摸一样」。
 * 现行实现（本文件判据的对象）：
 *   · 纯白底（无照片/位图），白色办公桌 + 黑色显示器 + 白色椅子 + 黑猫成员（彩色围巾）；
 *   · 2 列 × 5 排 = 10 个工位；左侧茶水间 / 跑步机 / 休息区；
 *   · 猫按真实状态换姿态：运行/待机坐姿（背对镜头），等待/完成/失败站姿（正面）；
 *   · 显示器按状态播代码条 + 扫描线；桌子/椅子/猫/显示器全部 DOM + SVG；
 *   · 悬停出详情卡、点击进会话、滚轮以指针为中心缩放。
 * ⛔ 不搬 Marvis 的美术资产：只复用它的布局与状态机，家具/角色都是我们自己的 SVG。
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, codeOnly } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【scene】${m}`); if (!c) fails++; };

const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const canvas = read("src", "features", "team-office", "OfficeCanvas.tsx");
const code = codeOnly(canvas);
const fmt = read("src", "features", "team-office", "office-format.ts");
const screen = read("src", "features", "team-office", "office-screen.ts");
const css = read("src", "styles", "20-team-office.css");
const cssCode = codeOnly(css);

/* ── ① 不再有照片场景 / 宠物管线 ── */
ok(!existsSync(join(ROOT, "src", "features", "team-office", "assets", "office-bg.webp")),
  "⛔ 静态 3D 照片底图已删除（用户明确不要一张图）");
ok(!/<img/.test(code) && !/bgUrl|office-agent-img/.test(code),
  "⛔ 场景里没有任何 <img>（白底 + SVG，不贴图）");
ok(!/petList|pet:\/\/|animationSet|lookFrameSet/.test(code),
  "⛔ 不再走宠物包管线（角色 = 我们的黑猫 SVG）");
ok(!/marvis|Marvis|office\.tmj|Tencent/i.test(code),
  "⛔ 代码不引用 Marvis/Tencent 资产路径（只复用布局与状态机）");

/* ── ② 画布 / 工位网格 ── */
ok(fmt.includes("export const CANVAS_W = 1560") && fmt.includes("export const CANVAS_H = 1270"),
  "画布 = 白色工位板 1560×1270（设计坐标）");
ok(fmt.includes("export const TEAM_OFFICE_LIMIT = 10"),
  "成员/工位上限 = 10（用户 10-22 要求）");
const cols = (canvas.match(/DESK_COLS = \[([^\]]+)\]/)?.[1] ?? "").split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
const rowsText = canvas.match(/DESK_ROWS = \[([^\]]+)\]/)?.[1] ?? "";
const rowsM = rowsText.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
ok(cols.length === 2, `2 列工位（解析到 ${cols.length} 个 x）`);
ok(rowsM.length === 5, `5 排工位（解析到 ${rowsM.length} 个 y）`);
ok(cols.every((x) => x >= 0 && x + 480 <= 1560) && rowsM.every((y) => y >= 0 && y + 230 <= 1270),
  "10 个工位全部落在画布内（480×230/个）");
ok(canvas.includes("Array.from({ length: TEAM_OFFICE_LIMIT }"),
  "按上限渲染 10 个工位（空位也画桌子/椅子，不凭空少桌）");

/* ── ③ 白色家具（DOM/SVG，非照片） ── */
for (const cls of ["ws-desk-top", "ws-desk-edge", "ws-desk-leg", "ws-pedestal", "ws-pc", "ws-monitor", "ws-keyboard", "ws-chair"]) {
  ok(canvas.includes(cls) && css.includes(`.${cls}`), `白色工位部件：${cls}`);
}
ok(canvas.includes("function OfficeChair") && canvas.includes("className={`ws-chair${occupied ? \" is-occupied\" : \"\"}`}"),
  "椅子分空位（白）/有人（灰）两种（Marvis 同款区分）");
ok(/\.ws-chair\.is-occupied \.chair-back\s*\{[\s\S]{0,120}?fill: #9aa0a8/.test(css),
  "有人坐的椅子是灰色（空位保持白色）");
ok(css.includes("background: #f6f7f9") && css.includes(".office-scene-wrap") && /radial-gradient\(120% 90%/.test(css),
  "纯白/浅灰舞台（Marvis 的“白上白”），⛔ 无照片背景");
ok(/\.ws-desk-top\s*\{[\s\S]{0,260}?background: linear-gradient\(180deg, #ffffff/.test(css),
  "桌面是白色渐变 + 柔和投影（不描黑边）");
ok(canvas.includes("function Facilities") && ["facility-coffee", "facility-treadmill", "facility-lounge"].every((c) => canvas.includes(c)),
  "左侧功能区：茶水间 / 跑步机 / 休息区");
ok(!/url\(/.test(cssCode), "⛔ CSS 不引任何位图（家具/猫/屏幕全用形状画）");

/* ── ④ 黑猫成员 ── */
ok(canvas.includes("const SCARVES = [") && (canvas.match(/\"#[0-9a-f]{6}\"/g) ?? []).length >= 10,
  "10 种围巾颜色（每个成员可区分）");
ok(/const scarf = SCARVES\[index % SCARVES\.length\];/.test(canvas),
  "围巾颜色按工位索引取（同一成员不会每帧换色）");
ok(canvas.includes("function SeatedCat") && canvas.includes("function StandingCat"),
  "黑猫两种姿态：坐姿（背对镜头）/ 站姿（正面）");
ok(/const seated = status\.level === \"run\" \|\| status\.level === \"idle\";/.test(canvas)
  && /\{seated \? <SeatedCat /.test(canvas),
  "运行/待机坐着，等待/完成/失败站着（姿态跟真实状态走）");
ok(css.includes("@keyframes cat-type-r") && css.includes("@keyframes cat-type-l")
  && css.includes("@keyframes cat-wave") && css.includes("@keyframes cat-blink")
  && css.includes("@keyframes cat-tail"),
  "猫会敲键盘 / 招手 / 眨眼 / 摇尾巴（不是静态剪影）");
ok(canvas.includes("cat-eyes") && canvas.includes("cat-eyes-failed") && css.includes(".cat-eyes"),
  "正面猫有眼睛；失败时换成 X 眼（状态可读）");
ok(canvas.includes("ws-bubble") && /waiting.*\"…\"|waiting.*…/.test(canvas) && css.includes(".ws-bubble"),
  "等待/完成/失败有气泡（… / ✓ / !）");

/* ── ⑤ 显示器实时内容 ── */
ok(canvas.includes("className={`ws-screen tone-${status.level}`}") && canvas.includes('["--screen-accent" as string]: status.accent'),
  "显示器颜色跟对应成员状态走（tone / accent 来自 statusOf）");
ok(canvas.includes("ws-screen-scan") && canvas.includes("ws-screen-mark"),
  "显示器有扫描线 + 完成/失败标记");
ok(css.includes("@keyframes ws-bar") && css.includes("@keyframes ws-scan")
  && css.includes(".ws-screen > i"),
  "屏幕内容是持续动画（代码条 + 扫描线），⛔ 不是静态图");
ok(css.includes(".ws-screen.tone-idle > i") && css.includes("opacity: 0.32"),
  "待机屏幕内容变淡（运行中更亮）");

/* ── ⑥ 交互：悬停卡 / 点击 / 键盘 ── */
ok(/role="button"/.test(canvas) && /tabIndex=\{0\}/.test(canvas) && /onClick=\{onOpen\}/.test(canvas),
  "点击工位进入成员会话（可聚焦）");
ok(/onKeyDown=\{\(ev\) => \{[\s\S]{0,140}?ev\.key === \"Enter\"[\s\S]{0,80}?onOpen\(\)/.test(canvas),
  "键盘 Enter / Space 也能打开");
ok(/onMouseEnter=\{onEnter\}/.test(canvas) && /onMouseLeave=\{onLeave\}/.test(canvas),
  "悬停进入/离开走独立回调（相邻工位不互相清卡）");
ok(/hovered && \(\s*<div[\s\S]{0,180}?className="office-agent-card"/.test(canvas)
  && canvas.includes("点击打开会话"),
  "详情卡渲染在工位内部（鼠标移到卡上不会把卡弄丢）");
ok(canvas.includes("aria-label={`${member.name} · ${status.text}`}"),
  "每个工位带无障碍标签（姓名 + 当前状态）");

/* ── ⑦ 状态映射（真实事件面，不编状态） ── */
ok(/eventWordZhOf/.test(canvas) && /effectivePhase/.test(canvas),
  "状态走真实阶段 + 真实事件（eventWordZhOf / effectivePhase）");
ok(/phase === \"failed\"[\s\S]{0,80}?level: \"failed\"/.test(canvas)
  && /phase === \"done\"[\s\S]{0,80}?level: \"done\"/.test(canvas)
  && /phase === \"waiting\"[\s\S]{0,80}?level: \"waiting\"/.test(canvas),
  "失败 / 完成 / 等待 的 level 明确（猫姿态与屏幕颜色都有依据）");
ok(screen.includes("DONE_HOLD_MS") && /export function effectivePhase/.test(screen),
  "office-screen 保留完成态时效（RunPhase / effectivePhase / eventWordZhOf）");
ok(!/export function drawScreen|screensaverAt|screenModeOf/.test(screen),
  "⛔ 旧的逐帧屏渲染（drawScreen / 屏保）已整体退役");

/* ── ⑧ 缩放 / 平移 ── */
ok(/const fit = Math\.min\(sw \/ CANVAS_W, sh \/ CANVAS_H\);/.test(canvas)
  && !/Math\.max\(sw \/ CANVAS_W, sh \/ CANVAS_H\)/.test(canvas),
  "⛔ 基准是 contain（整间办公室完整可见）");
ok(/stage\.style\.transform =\s*`translate\(/.test(canvas),
  "尺寸 + 平移写进舞台 transform（子元素跟随缩放，命中不会偏）");
ok(/addEventListener\("wheel",[\s\S]{0,80}?\{\s*passive:\s*false\s*\}/.test(canvas),
  "滚轮监听必须 { passive: false }");
ok(/const designX = \(ax - left\) \/ s0;/.test(canvas) && /const designY = \(ay - top\) \/ s0;/.test(canvas),
  "滚轮锚点换算回设计坐标（缩放以指针为中心）");
ok(/zoomIn:/.test(canvas) && /zoomOut:/.test(canvas) && /reset: resetView/.test(canvas),
  "缩放句柄（放大 / 缩小 / 重置）与滚轮共用同一条 view 写入路径");
ok(/OFFICE_ZOOM_MIN = 1/.test(canvas) && /OFFICE_ZOOM_MAX = 4/.test(canvas),
  "倍率夹在 [1, 4]（下限=contain 基准）");

/* ── ⑨ 旧实现退役（负向） ── */
ok(!/<canvas/.test(code) && !/getContext\("2d"\)/.test(code) && !/office-pixel-canvas/.test(code + cssCode),
  "⛔ 已无 canvas 2D / office-pixel-canvas（旧静态绘制不许复活）");
ok(!/imageSmoothingEnabled/.test(code) && !/image-rendering: pixelated/.test(cssCode),
  "⛔ 不再有像素画布渲染开关");
ok(!/OfficeSim|SEATS|drawWalking|drawRoomStatic/.test(code)
  && !existsSync(join(ROOT, "src", "features", "team-office", "office-sim.ts")),
  "⛔ 旧走位模拟 / 代码画房间已退役");
ok(!existsSync(join(ROOT, "src", "features", "team-office", "assets")),
  "⛔ 旧的场景素材目录已删除（白底无需位图）");

/* ── ⑩ 状态映射真跑（事件词 / 完成保留时效） ── */
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

/* ── ⑪ 成员来源 / 入口（沿用旧口径） ── */
{
  const preview = read("src", "features", "team-office", "TeamOfficePreview.tsx");
  const appView = read("src", "features", "app-view", "AppView.tsx");
  ok(/delegatedRuns\?:\s*DelegateRecordEntry\[\]/.test(preview),
    "TeamOfficePreview 接受 delegatedRuns prop（普通会话的成员来源）");
  ok(/if \(!team\)\s*\{[\s\S]{0,600}?delegatedRuns/.test(preview),
    "team 为空时走「委托记录当成员」这条路径");
  ok(/if \(!teamId\) return null;/.test(preview) && !/if \(!teamId \|\| !team\) return null;/.test(preview),
    "显示门槛只认 teamId（普通会话浮层不被挡掉）");
  ok(/id:\s*r\.threadId/.test(preview), "普通会话成员的 id 是 threadId（点工位能直接开子会话）");
  ok(/slice\(0, TEAM_OFFICE_LIMIT\)/.test(preview), "成员按 10 人上限裁剪（与工位数一致）");
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
