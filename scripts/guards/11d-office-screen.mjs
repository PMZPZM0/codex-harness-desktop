/**
 * 办公室「白色 3D 工位板」判据（2026-10-22 对照 Marvis workbench 重做）
 *
 * 用户提供参考图：纯白背景、白色 3D 办公桌/椅子、黑猫成员（彩色围巾）、
 * 左侧茶水间/跑步机/洗手间。用户选择「保留 10 工位 + 分页」。
 *
 * 现行实现：
 *   · 家具/设施 = 本仓生成的白底 3D 图（assets/*.webp，?inline + multiply 融进白板）；
 *   · 猫 = DOM/SVG（坐姿背对镜头 / 站姿正面；idle 偶尔打瞌睡 Zzz）；
 *   · 一页 6 个工位（2 列 × 3 排），10 人分 2 页，底部 pager；
 *   · 显示器叠实时内容；悬停详情卡、点击进会话、滚轮指针锚点缩放。
 * ⛔ 只复用 Marvis 的布局与状态机，不搬它的美术资产。
 */
import { readFileSync, existsSync, statSync } from "node:fs";
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

/* ── ① 资产：本仓生成的白色 3D 家具/设施 ── */
for (const name of ["desk", "chair-white", "chair-gray", "coffee", "treadmill", "toilet"]) {
  const p = join(ROOT, "src", "features", "team-office", "assets", `${name}.webp`);
  ok(existsSync(p) && statSync(p).size > 8 * 1024,
    `白色 3D 资产：${name}.webp（${existsSync(p) ? Math.round(statSync(p).size / 1024) + "KB" : "缺失"}）`);
  ok(new RegExp(`import \\w+ from "\\./assets/${name}\\.webp\\?inline"`).test(canvas),
    `${name} 走 ?inline（构建版 file:// 不 404）`);
}
ok(!existsSync(join(ROOT, "src", "features", "team-office", "assets", "office-bg.webp"))
  && !code.includes("office-scene-bg"),
  "⛔ 没有整张照片底图（用户否掉静态图；家具是独立 3D 资产）");
ok(!/petList|pet:\/\/|animationSet|lookFrameSet/.test(code),
  "⛔ 不再走宠物包管线（角色 = 自绘黑猫 SVG）");
ok(!/marvis|Marvis|office\.tmj|Tencent/i.test(code),
  "⛔ 代码不引用 Marvis/Tencent 资产路径（只复用布局与状态机）");

/* ── ② 画布 / 分页网格 ── */
ok(fmt.includes("export const CANVAS_W = 1500") && fmt.includes("export const CANVAS_H = 1360"),
  "画布 = 1500×1360（一页 6 工位，照参考图尺寸）");
ok(fmt.includes("export const TEAM_OFFICE_LIMIT = 10"), "成员/工位上限 = 10");
const cols = (canvas.match(/DESK_COLS = \[([^\]]+)\]/)?.[1] ?? "").split(",").filter((s) => s.trim()).length;
const rowNums = (canvas.match(/DESK_ROWS = \[([^\]]+)\]/)?.[1] ?? "").split(",").filter((s) => s.trim()).length;
ok(cols === 2 && rowNums === 3, `2 列 × 3 排 = 6 个工位/页（解析 ${cols}×${rowNums}）`);
ok(/const PAGE_SIZE = 6;/.test(canvas) && /Math\.ceil\(rows\.length \/ PAGE_SIZE\)/.test(canvas),
  "分页：10 人 → 2 页（ceil(10/6)）");
ok(/Array\.from\(\{ length: PAGE_SIZE \}/.test(canvas) && /pageRows\[i\]/.test(canvas),
  "只渲染当前页的 6 个工位（空位也画桌子/白椅）");
ok(/className="office-pager"/.test(canvas) && /aria-label="上一页"/.test(canvas) && /aria-label="下一页"/.test(canvas),
  "底部 pager（上一页 / 下一页 / 页码）");
ok(/const pageCount = Math\.max\(1, Math\.ceil/.test(canvas) && /pageCount > 1/.test(canvas),
  "只有超过 6 人才显示分页（6 人以内不出现多余控件）");

/* ── ③ 白色 3D 家具 + 显示器内容 ── */
ok(canvas.includes('className="ws-desk-wrap"') && canvas.includes('className="ws-desk-img"'),
  "桌面 = 生成的白色 3D 图（不是 CSS 画的平板）");
ok(css.includes(".ws-desk-img") && /mix-blend-mode:\s*multiply/.test(css),
  "白底家具用 multiply 融进白板（无白框/硬边）");
ok(canvas.includes("chairWhiteUrl") && canvas.includes("chairGrayUrl") && canvas.includes("ws-chair-img is-gray"),
  "空位白椅 / 有人灰椅 两套资产");
ok(css.includes(".ws-chair-img") && /width:\s*150px/.test(css), "椅子有独立尺寸/层级");
ok(canvas.includes('className={`ws-screen tone-${status.level}`}') && canvas.includes('["--screen-accent" as string]: status.accent'),
  "显示器内容颜色跟真实状态走");
ok(canvas.includes("ws-screen-scan") && canvas.includes("ws-screen-mark"),
  "屏幕有扫描线 + 完成/失败标记");
ok(/\.ws-screen\s*\{[\s\S]{0,500}?position:\s*absolute/.test(css) && /@keyframes ws-bar/.test(css) && /@keyframes ws-scan/.test(css),
  "屏幕内容是持续动画（代码条 + 扫描线）");
ok(canvas.includes("function Facilities") && ["coffee", "treadmill", "toilet"].every((k) => canvas.includes(k)),
  "左侧功能区：茶水间 / 跑步机 / 洗手间（生成的 3D 设施）");

/* ── ④ 黑猫成员 ── */
ok(canvas.includes("const SCARVES = [") && (canvas.match(/"#[0-9a-f]{6}"/g) ?? []).length >= 10,
  "10 种围巾颜色（每个成员可区分）");
ok(/const scarf = SCARVES\[index % SCARVES\.length\];/.test(canvas), "围巾颜色按成员索引取（不闪色）");
ok(canvas.includes("function SeatedCat") && canvas.includes("function StandingCat"),
  "黑猫两种姿态：坐姿（背对镜头）/ 站姿（正面）");
ok(/const seated = status\.level === "run" \|\| status\.level === "idle";/.test(canvas)
  && /\{seated \? \(/.test(canvas), "运行/待机坐着，等待/完成/失败站着");
ok(/const dozing = status\.level === "idle"/.test(canvas) && /className="ws-zzz"/.test(canvas),
  "待机偶尔打瞌睡（Zzz，参考图里的浏览器管家）");
ok(css.includes("@keyframes cat-type-r") && css.includes("@keyframes cat-wave")
  && css.includes("@keyframes cat-blink") && css.includes("@keyframes cat-tail") && css.includes("@keyframes cat-doze"),
  "猫会敲键盘 / 招手 / 眨眼 / 摇尾 / 打瞌睡（不是静态剪影）");
ok(canvas.includes("cat-eyes") && canvas.includes("cat-eyes-failed"), "正面猫有眼睛；失败换 X 眼");
ok(canvas.includes("ws-bubble") && /waiting.*…/.test(canvas) && css.includes(".ws-bubble"),
  "等待/完成/失败有气泡（… / ✓ / !）");

/* ── ⑤ 交互 ── */
ok(/role="button"/.test(canvas) && /tabIndex=\{0\}/.test(canvas) && /onClick=\{onOpen\}/.test(canvas),
  "点击工位进入成员会话（可聚焦）");
ok(/onKeyDown=\{\(ev\) => \{[\s\S]{0,140}?ev\.key === "Enter"[\s\S]{0,80}?onOpen\(\)/.test(canvas),
  "键盘 Enter / Space 也能打开");
ok(/onMouseEnter=\{onEnter\}/.test(canvas) && /onMouseLeave=\{onLeave\}/.test(canvas),
  "悬停进入/离开走独立回调（相邻工位不互相清卡）");
ok(/hovered && \(\s*<div[\s\S]{0,180}?className="office-agent-card"/.test(canvas) && canvas.includes("点击打开会话"),
  "详情卡渲染在工位内部（鼠标移到卡上不会丢）");
ok(canvas.includes("aria-label={`${member.name} · ${status.text}`}"), "每个工位有无障碍标签");

/* ── ⑥ 状态映射 ── */
ok(/eventWordZhOf/.test(canvas) && /effectivePhase/.test(canvas), "状态走真实阶段 + 真实事件");
ok(/phase === "failed"[\s\S]{0,80}?level: "failed"/.test(canvas)
  && /phase === "done"[\s\S]{0,80}?level: "done"/.test(canvas)
  && /phase === "waiting"[\s\S]{0,80}?level: "waiting"/.test(canvas),
  "失败/完成/等待的 level 明确（猫姿态与屏幕颜色都有依据）");
ok(screen.includes("DONE_HOLD_MS") && /export function effectivePhase/.test(screen),
  "office-screen 保留完成态时效");
ok(!/export function drawScreen|screensaverAt|screenModeOf/.test(screen), "⛔ 旧的逐帧屏渲染已退役");

/* ── ⑦ 缩放 / 平移 ── */
ok(/const fit = Math\.min\(sw \/ CANVAS_W, sh \/ CANVAS_H\);/.test(canvas)
  && !/Math\.max\(sw \/ CANVAS_W, sh \/ CANVAS_H\)/.test(canvas),
  "contain 基准（一页完整可见）");
ok(/stage\.style\.transform =\s*`translate\(/.test(canvas), "尺寸 + 平移写进舞台 transform");
ok(/addEventListener\("wheel",[\s\S]{0,80}?\{\s*passive:\s*false\s*\}/.test(canvas), "滚轮监听 { passive:false }");
ok(/const designX = \(ax - left\) \/ s0;/.test(canvas) && /const designY = \(ay - top\) \/ s0;/.test(canvas),
  "滚轮锚点换算回设计坐标");
ok(/zoomIn:/.test(canvas) && /zoomOut:/.test(canvas) && /reset: resetView/.test(canvas),
  "缩放句柄与滚轮共用同一条 view 写入路径");
ok(/OFFICE_ZOOM_MIN = 1/.test(canvas) && /OFFICE_ZOOM_MAX = 4/.test(canvas), "倍率夹在 [1, 4]");

/* ── ⑧ 旧实现退役（负向） ── */
ok(!/<canvas/.test(code) && !/getContext\("2d"\)/.test(code) && !/office-pixel-canvas/.test(code + cssCode),
  "⛔ 已无 canvas 2D / office-pixel-canvas");
ok(!/imageSmoothingEnabled/.test(code) && !/image-rendering: pixelated/.test(cssCode),
  "⛔ 不再有像素画布开关");
ok(!/OfficeSim|SEATS|drawWalking|drawRoomStatic/.test(code)
  && !existsSync(join(ROOT, "src", "features", "team-office", "office-sim.ts")),
  "⛔ 旧走位模拟 / 代码画房间已退役");
ok(!/ipcRenderer|window\.codex\./.test(code), "画布层零 IPC（成员状态由宿主 props 传入）");

/* ── ⑨ 状态映射真跑 ── */
{
  const script = `
import { eventWordZhOf, effectivePhase, DONE_HOLD_MS } from "./src/features/team-office/office-screen.ts";
const rows = [["terminal","跑命令"],["file-edit","改文件"],["browser","开浏览器"],["websearch","查资料"],["collab","分派"],["thinking","思考"]];
let bad = 0;
for (const [kind, want] of rows) { const got = eventWordZhOf(kind); if (got !== want) { bad += 1; console.log("NO " + kind + " → " + got); } }
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
  ok(lines.length >= 2, `状态映射真跑出 ${lines.length} 条`);
  for (const line of lines) {
    const good = line.trim().startsWith("OK ");
    checks += 1;
    if (!good) fails += 1;
    console.log(`  ${good ? "✓" : "✗"} 【scene】${line.trim().slice(3)}`);
  }
}

/* ── ⑩ 成员来源 / 入口 ── */
{
  const preview = read("src", "features", "team-office", "TeamOfficePreview.tsx");
  const appView = read("src", "features", "app-view", "AppView.tsx");
  ok(/delegatedRuns\?:\s*DelegateRecordEntry\[\]/.test(preview), "TeamOfficePreview 接受 delegatedRuns prop");
  ok(/if \(!team\)\s*\{[\s\S]{0,600}?delegatedRuns/.test(preview), "team 为空时走委托记录");
  ok(/if \(!teamId\) return null;/.test(preview), "显示门槛只认 teamId");
  ok(/id:\s*r\.threadId/.test(preview), "普通会话成员 id 是 threadId");
  ok(/slice\(0, TEAM_OFFICE_LIMIT\)/.test(preview), "成员按 10 人上限裁剪（与分页一致）");
  ok(/delegatedRuns=\{officeDelegates\}/.test(appView), "AppView 传入委托登记表");
  const railsSrc = read("src", "features", "experts-teams", "ExpertsTeams", "02-rails.tsx");
  ok((railsSrc.match(/<OfficeRailNode onOpen=\{/g) ?? []).length === 2, "两条轨道共用办公室入口");
  ok(/OFFICE_SESSION_TEAM_ID\s*=\s*"__office-session__"/.test(read("src", "features", "team-office", "index.ts")),
    "哨兵 teamId 定义在 team-office 域");
}

console.log(`\n【scene】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
