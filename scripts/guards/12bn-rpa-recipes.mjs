/**
 * 12bn-rpa-recipes —— RPA 配方的「工具 → 分发 → 状态回写 → 存储 → 界面 → 技能」全链路守卫（11-13）。
 *
 * 用户问「自动化里面的 RPA 有配套工具吗」后按缺口补齐，这组断言钉住：
 *   ① 模型工具 `rpa_save` / `rpa_run` 真在 dynamicTools 里；
 *   ② 分发分支在、且**不再提前写 ok:true**（步骤交给模型 ≠ 跑成功）；
 *   ③ 运行结果只在 turn/completed / aborted / failed / interrupted 结算，并刷新设置页；
 *   ④ 同名保存是 upsert（不堆重复），按名执行只认唯一匹配（不静默跑错配方）；
 *   ⑤ 通道 `rpa:run-result` 三处一致，旧名 `rpa:record` 不许复活；
 *   ⑥ 设置页、专用技能、验收项都在。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【rpa】${m}`); if (!c) fails++; };
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const codeOnly = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const SEG = "src/features/app-state/parts/part08/01-seg.tsx";
const REQ = "src/features/app-state/parts/part05/event-router/02-request.tsx";
const EVT = "src/features/app-state/parts/part05/event-router/03-thread-id.tsx";
const UI = "src/features/settings-rpa/RpaSettingsSection.tsx";

/* ── ① 模型工具面 ─────────────────────────────────────────────── */
{
  const seg = codeOnly(read(SEG));
  ok(/name: "rpa_save"/.test(seg) && /name: "rpa_run"/.test(seg),
    "dynamicTools 含 rpa_save / rpa_run（模型侧真能看见）");
  ok(/name: "rpa_save"[\s\S]{0,900}?enum: \["browser", "desktop", "mixed"\]/.test(seg),
    "rpa_save 的 kind 枚举与存储类型一致");
}

/* ── ② 分发：唯一匹配 + 不提前写成功 + 保存后刷新 ───────────────── */
{
  const req = codeOnly(read(REQ));
  ok(req.includes('event.params?.tool === "rpa_save"') && req.includes('event.params?.tool === "rpa_run"'),
    "分发分支在（tool 名与 dynamicTools 完全一致）");
  ok(/matchRpaRecipe\(/.test(req) && /trackRpaRun\(/.test(req) && /cancelRpaRun\(/.test(req),
    "按名执行走唯一匹配 + 登记结算 + 回执失败可取消");
  ok(!/recordRpaRun\(\{ id: recipe\.id, ok: true \}\)/.test(req),
    "⛔ 不再在工具回执处提前写 ok:true（步骤交给模型 ≠ 跑成功）");
  ok(/listRpaRecipes\(\)\.then\(bag\.setRpaRecipes\)/.test(req),
    "rpa_save 之后刷新设置页列表（否则界面看不到新配方）");
  ok(/recordRpaRun\(\{ id: recipe\.id, ok: false/.test(req),
    "回执本身失败时如实记 failed");
}

/* ── ③ 回合结束结算 ───────────────────────────────────────────── */
{
  const evt = codeOnly(read(EVT));
  ok(/settleRpaRun\(/.test(evt) && /recordRpaRun\(/.test(evt) && /setRpaRunning\(null\)/.test(evt),
    "回合结束结算 RPA：写运行结果 + 清「执行中」");
  ok(/settleRpa\(!params\.turn\?\.error\?\.message/.test(evt),
    "turn/completed 按 turn.error 判成功/失败（不是无条件成功）");
  ok(/settleRpa\(false, params\.turn\?\.error\?\.message \|\| method0\)/.test(read(EVT)),
    "aborted / failed / interrupted 记 failed（不留假「执行中」）");
  ok(/listRpaRecipes\(\)\.then\(bag\.setRpaRecipes\)/.test(evt),
    "结算后刷新列表（「上次成功 / 运行次数」不再滞后）");
}

/* ── ④ 纯函数真跑：名称匹配 + 运行追踪 ────────────────────────── */
try {
  const rec = await import(pathToFileURL(join(ROOT, "src/lib/rpa-recipes.mjs")).href);
  const list = [{ name: "日报" }, { name: "日报2" }, { name: "周报" }];
  ok(rec.matchRpaRecipe(list, "日报").recipe?.name === "日报", "精确名优先（日报不会命中日报2）");
  ok(rec.matchRpaRecipe(list, "报").recipe === null && rec.matchRpaRecipe(list, "报").ambiguous.length === 3,
    "多条部分匹配回 ambiguous（不许静默跑错配方）");
  ok(rec.matchRpaRecipe(list, "不存在").recipe === null, "无匹配回 null");
  ok(rec.matchRpaRecipe(list, "周报").recipe?.name === "周报", "唯一部分匹配仍可执行");
} catch (error) {
  ok(false, `rpa-recipes.mjs 真跑失败：${error?.message ?? error}`);
}
try {
  const trk = await import(pathToFileURL(join(ROOT, "src/lib/rpa-run-tracker.mjs")).href);
  trk.resetRpaRuns();
  trk.trackRpaRun({ recipeId: "r1", threadId: "t1", turnId: "turn1" });
  ok(trk.settleRpaRun({ threadId: "t1", turnId: "turn2" }) === null,
    "⛔ 别的回合结束不结算这次运行（按 turnId 严格匹配）");
  ok(trk.pendingRpaRecipeId({ turnId: "turn1" }) === "r1", "登记后能查到等待结算的配方");
  const done = trk.settleRpaRun({ threadId: "t1", turnId: "turn1", ok: false, error: "boom" });
  ok(done?.recipeId === "r1" && done.ok === false && done.error === "boom", "结算带回 ok/error");
  ok(trk.pendingRpaRecipeId({ turnId: "turn1" }) === "", "结算后不再挂起");
  trk.trackRpaRun({ recipeId: "r2", threadId: "t2", turnId: "" });
  ok(trk.settleRpaRun({ threadId: "t2", turnId: "turnX" })?.recipeId === "r2",
    "拿不到 turnId 时按 thread 兜底（只匹配无 turnId 的登记）");
  trk.resetRpaRuns();
} catch (error) {
  ok(false, `rpa-run-tracker.mjs 真跑失败：${error?.message ?? error}`);
}

/* ── ⑤ 存储 upsert + 通道改名 ─────────────────────────────────── */
{
  const store = codeOnly(read("electron/rpa-store.ts"));
  ok(/:\s*this\.recipes\.find\(\(r\) => r\.name === name\)/.test(store),
    "同名保存 upsert（保留 id/运行次数，不堆重复配方）");
  const manifest = read("electron/ipc-channels.manifest.json");
  const registry = read("electron/ipc-registry.ts");
  const preload = read("electron/preload.ts");
  const ipc = codeOnly(read("electron/features/rpa-ipc.ts"));
  ok(manifest.includes('"rpa:run-result"') && registry.includes('"rpa:run-result"')
    && preload.includes('__ipc("rpa:run-result"') && ipc.includes('ipcHost.handle("rpa:run-result"'),
    "通道 rpa:run-result 三处一致（manifest / registry / 生成桥 / handler）");
  ok(!manifest.includes("rpa:record") && !registry.includes("rpa:record")
    && !preload.includes("rpa:record") && !ipc.includes("rpa:record"),
    "⛔ 旧名 rpa:record 不许复活（它不是「录制」，是运行结果回写）");
}

/* ── ⑥ 设置页 / 技能 / 验收 ───────────────────────────────────── */
{
  const ui = codeOnly(read(UI));
  ok(/trackRpaRun\(/.test(ui) && /runRecipe/.test(ui),
    "设置页播放键启动回合并登记结算（不再只发 turn/start）");
  ok(!/\.finally\(\(\) => setRpaRunning\(null\)\)/.test(ui),
    "⛔ turn/start 返回后不许立刻清运行态（回合还没跑完）");
  ok(/listRpaRecipes\(\)\.then\(setRpaRecipes\)/.test(ui),
    "打开 RPA 页重拉列表（模型/别处保存后也能看到）");
  ok(ui.includes("把这次流程存成 RPA 配方"), "空态文案不再声称「自动沉淀」");
  const skills = codeOnly(read("electron/builtin-skills.ts"));
  const skill = read("electron/builtin-skills/28-skill-rpa-recipes.ts");
  const discipline = read("electron/skill-discipline.ts");
  ok(skills.includes('["rpa-recipes"') && skill.includes("name: rpa-recipes")
    && skill.includes("rpa_save") && skill.includes("rpa_run") && /回合结束/.test(skill),
    "内置技能 rpa-recipes 已注册，含保存/运行/状态口径");
  ok(discipline.includes("rpa-recipes"), "AGENTS 守则点名技能（模型才知道去读）");
  const accept = read("scripts/accept.mjs");
  ok(accept.includes('id: "rpa-recipes"'), "验收项 rpa-recipes 已登记");
  const pkg = read("package.json");
  ok(pkg.includes("node scripts/guards/12bn-rpa-recipes.mjs"), "package.json check 链已登记本守卫");
}

console.log("");
console.log(fails === 0
  ? `【rpa】通过（${checks} 条）`
  : `【rpa】失败：${fails}/${checks} 条`);
process.exit(fails === 0 ? 0 : 1);
