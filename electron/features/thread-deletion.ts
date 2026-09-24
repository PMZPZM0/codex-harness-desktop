/**
 * thread-deletion（09-22 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁）
 *
 * 域：永久删除会话的**本地收尾** —— 墓碑（deleted-threads.json）读写 + 磁盘 rollout 清理 +
 *     启动期血缘自愈（源 rollout 丢失的子会话摘掉血缘字段）。
 * 搬出符号：deletedThreadsFile / DELETED_THREADS_LIMIT / deletedThreadIds / deletedThreadOrder /
 *           deletedThreadsLoaded / loadDeletedThreads / rememberDeletedThread / purgeDeletedThread /
 *           healRolloutLineage，另含从 features/engine-ipc.ts 归位的 forgetDeletedThreads（摘墓碑）。
 * 消费方：main.ts（remote 手机对话列表过滤 + bindBoot 注入）、features/engine-ipc.ts（purge/导入后摘墓碑）、
 *         features/boot.ts（经 bindBoot 注入 loadDeletedThreads / purgeDeletedThread / healRolloutLineage）。
 *
 * 代码与原地逐字一致（仅顶部 import、文件头注释、末尾 export 清单，forgetDeletedThreads 里
 * 去掉 `mutableState.` 前缀 —— 该 let 现在归本模块私有，墓碑状态由此只有一个 owner，
 * 以及 deletedThreadsFile 改成惰性求值函数 —— 原因见下方 ⛔ 注释）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { codexHome } from "../runtime-refs";
import { healRolloutLineageAsync, purgeRolloutFilesAsync } from "../rollout-pool";
// ── 永久删除会话的**本地收尾**（09-18 用户实测：「我删除了，重启又恢复了」）────────────
// ⛔ 根因：引擎的 `thread/delete` 只把线程从**索引**里摘掉，磁盘上的 rollout 文件原样留着；
//   而 thread/list 带 rollout 兜底扫描（见下面的 thread/list 分支），它把「索引里没有、
//   磁盘上有」的会话当权威源合回侧栏 ⇒ 删掉的会话重启后又冒出来。
//   用户机实测：state 库 11 条、磁盘 18 个 rollout，其中 12 条「已从索引删除但文件还在」，
//   侧栏那 7 个分组名与它们的 cwd 一一对应（D:\2 四条、D:\Codex Harness Desktop 五条…）。
//
//   收尾两件事，缺一不可：
//     ① 删掉磁盘 rollout —— 真正的清理，不删就永远会复活；
//     ② 记「墓碑」—— 文件被占用（正跑的会话）删不掉时的保险，也是唯一能压住兜底扫描的判据。
//   落点刻意放在**两处**：
//     · 请求路径（codex:request 里 method === "thread/delete"）覆盖渲染层全部删除入口
//       （deleteThreadCore / 删整个项目 / 清空对话 / 级联删专家团成员…）；
//     · 引擎事件（thread/deleted）覆盖不经渲染层的删除。
//   ⛔ 别把这份收尾写到渲染层去：删除入口有 6+ 处，漏一处就是这个 bug 复发（本项目的旧坑形态）。
// ⛔ 不能写成模块顶层 `const deletedThreadsFile = path.join(app.getPath("userData"), …)`（09-22 code review 抓出）：
//    本模块在 main.ts 的 **import 期**求值，而 `app.setPath("userData", …)` 是 main.ts 的**模块体语句**
//    （编译产物里 require 在前、setPath 在后）⇒ 顶层求值拿到默认 userData `%APPDATA%\<package.json name>`，
//    而应用真正用的是 setPath 之后的 `%APPDATA%\Codex Harness Desktop` ⇒ 墓碑会写进另一个目录，
//    旧目录里已有的墓碑被忽略 = 「删掉的会话重启复活」这个 bug 会复发。惰性求值（同 electron/personalization.ts 约定）。
function deletedThreadsFile(): string {
  return path.join(app.getPath("userData"), "deleted-threads.json");
}
/** 墓碑上限：一条 36 字节，3000 条约 120KB —— 够用，且不能让文件无限长大 */
const DELETED_THREADS_LIMIT = 3000;
const deletedThreadIds = new Set<string>();   // 小写 id → thread/list 合并时按它排除
let deletedThreadOrder: string[] = [];        // 与 Set 同步，用于 FIFO 截断
let deletedThreadsLoaded = false;
/** 首次加载的**同一个** promise：并发调用者共享它，避免"看门狗已置位但数据还没到"的窗口。 */
let deletedThreadsLoad: Promise<void> | null = null;

/* ⛔ 09-24 修（评估报告 §4.4）：原实现在 `await` **之前**就把 deletedThreadsLoaded 置 true，
   于是与启动竞争的第一次 thread/list（踩在 await 那一瞬）看到的是**空墓碑集** ⇒ 把已删会话
   又合并回侧栏 —— 09-18 修掉的「删掉的会话重启复活」会以竞态形态复发。
   现在改为「共享同一个 in-flight promise」：并发者一定等到数据落定，且仍然只读一次盘。 */
async function loadDeletedThreads() {
  if (deletedThreadsLoad) return deletedThreadsLoad;
  deletedThreadsLoad = (async () => {
    try {
      const raw = JSON.parse(await fs.readFile(deletedThreadsFile(), "utf8"));
      const list = Array.isArray(raw) ? raw : [];
      deletedThreadOrder = list.map((value) => String(value || "").toLowerCase()).filter(Boolean).slice(-DELETED_THREADS_LIMIT);
      for (const value of deletedThreadOrder) deletedThreadIds.add(value);
    } catch { /* 首次运行没有这个文件；损坏也按空处理（只是少了保险，不阻塞启动） */ }
    deletedThreadsLoaded = true;
  })();
  return deletedThreadsLoad;
}

async function rememberDeletedThread(threadId: string) {
  const id = String(threadId || "").trim().toLowerCase();
  if (!id) return;
  await loadDeletedThreads();
  if (!deletedThreadIds.has(id)) {
    deletedThreadIds.add(id);
    deletedThreadOrder.push(id);
    if (deletedThreadOrder.length > DELETED_THREADS_LIMIT) {
      const dropped = deletedThreadOrder.splice(0, deletedThreadOrder.length - DELETED_THREADS_LIMIT);
      for (const value of dropped) deletedThreadIds.delete(value);
    }
  }
  await fs.writeFile(deletedThreadsFile(), JSON.stringify(deletedThreadOrder, null, 2), "utf8").catch(() => undefined);
}

/** 反向操作：把 id 从墓碑里摘掉。
 *  ⛔ 只有「这条会话被重新写回磁盘」时才允许调用 —— 目前唯一入口是**导入会话备份**：
 *  `applySessionsBackup` 会**原样复用备份里的 thread id**（canonical 文件名就是 `rollout-<时间戳>-<id>.jsonl`），
 *  不摘墓碑的话「删除 → 再从备份导入」之后这条会话永远不会显示，用户也没有任何入口能发现原因。
 *  只清「真正写入成功」的条目：duplicate/conflict 说明磁盘上那份还在（或内容冲突被跳过），
 *  那种情况保留墓碑更安全（它就是删不掉的那份残留）。 */

/** 永久删除的本地收尾：**同步**记墓碑（落盘后才返回）+ **后台**清磁盘 rollout。
 *  ⛔ 顺序与同步性是刻意的（code review 后定的）：
 *    · 墓碑必须在删除请求返回**之前**落盘 —— 它是「文件没删掉也不会复活」的唯一保证；
 *    · 文件清理不阻塞删除响应：渲染层在 `await thread/delete` 之后才把该行从侧栏摘掉，
 *      而 purge 走 worker 往返 —— worker 正忙于大目录兜底扫描时请求要排队（超时上限 15s），
 *      用户会看到「点了删除，那行迟迟不消失」。放后台后删一个会话只等一次小文件写入。
 *    · 真失败也不影响正确性：墓碑兜底，重启照样不复活。 */
async function purgeDeletedThread(threadId: string) {
  const id = String(threadId || "").trim();
  if (!id) return;
  await rememberDeletedThread(id);
  void purgeRolloutFilesAsync(codexHome, [id]).then((result) => {
    if (result?.removed?.length) console.log("[thread/delete] 已清理磁盘 rollout:", result.removed.length, "个");
    // ⛔⛔ 血缘守卫命中（09-19）：这条会话的 rollout 还被别的活着的会话依赖（分支/接力/派生），
    //   删了会让那个会话直接打不开（`missing source rollout`）——所以**故意保留**这个文件。
    //   侧栏不会显示它（墓碑仍然生效），用户视角就是"删掉了"，只是磁盘上留一份血缘锚点。
    if (result?.kept?.length) {
      console.warn(
        "[thread/delete] 保留 rollout（被其它会话的血缘依赖，删了会让那些会话打不开）:",
        JSON.stringify(result.kept).slice(0, 400),
      );
    }
    if (result?.failed?.length) console.warn("[thread/delete] rollout 文件清理失败（已记墓碑，侧栏不会再显示）：", JSON.stringify(result.failed).slice(0, 300));
  }).catch((error: any) => {
    console.warn("[thread/delete] rollout 清理（worker）失败：", error?.message ?? error);
  });
}

/**
 * 血缘自愈（09-19 用户：「归档会话后另一个会话报 missing source rollout，都没法用了，从根上修掉」）。
 *
 * 旧版本删会话时没有血缘守卫，把**子会话依赖的源 rollout** 一起删了 ⇒ 子会话每次打开都报
 *   `invalid paginated history lineage for <源>: missing source rollout`，连侧栏点击都不行。
 * 启动时跑一次：把这类「源已丢失」的子会话首行血缘字段摘掉（原首行存 `.lineage.bak`），
 * 让引擎按独立会话加载 —— 代价是丢失继承自源会话的那段历史（自己的回合都在，不受影响），
 * 但"完全打不开"显然更糟。幂等：修过的不再匹配（血缘字段已摘除）。
 */
async function healRolloutLineage() {
  try {
    // ⛔ 必须带时限：它被 `await` 在**启动链**上（只有放在 server.start() 之前才生效），
    //   而 rollout-pool 对 worker 调用的超时是 15s ⇒ worker 卡住时最坏把启动拖 15 秒
    //   （用户看到的是"双击没反应"）。超时就降级 —— 本次不自愈，下次启动再试，
    //   绝不能为了自愈把引擎挡在门外。
    const result: any = await Promise.race([
      healRolloutLineageAsync(codexHome),
      new Promise((resolve) => setTimeout(() => resolve({ healed: [], failed: [], timedOut: true }), 5000)),
    ]);
    if (result?.timedOut) console.warn("[boot] 血缘自愈超时（5s），本次跳过、不影响启动");
    if (result?.healed?.length) {
      console.warn("[boot] 修复了血缘断裂的会话（源 rollout 已丢失，已转为独立会话）:", JSON.stringify(result.healed).slice(0, 400));
    }
    if (result?.failed?.length) {
      console.warn("[boot] 血缘修复失败（不影响启动）:", JSON.stringify(result.failed).slice(0, 300));
    }
  } catch (error: any) {
    console.warn("[boot] healRolloutLineage 失败（降级继续）:", error?.message ?? error);
  }
}

/** ⛔ 从 features/engine-ipc.ts 归位（09-22）：摘墓碑与记墓碑必须同属一个模块 ——
 *  它读写上面那几个模块私有变量；原先经 main.mutableState 跨文件改写同一份状态（两个 owner）。 */
async function forgetDeletedThreads(ids: string[]) {
  await loadDeletedThreads();
  const targets = new Set(ids.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  if (!targets.size) return;
  let changed = false;
  for (const id of targets) if (deletedThreadIds.delete(id)) changed = true;
  if (!changed) return;
  deletedThreadOrder = deletedThreadOrder.filter((value) => !targets.has(value));
  await fs.writeFile(deletedThreadsFile(), JSON.stringify(deletedThreadOrder, null, 2), "utf8").catch(() => undefined);
}

export { DELETED_THREADS_LIMIT, deletedThreadIds, forgetDeletedThreads, healRolloutLineage, loadDeletedThreads, purgeDeletedThread, rememberDeletedThread };
