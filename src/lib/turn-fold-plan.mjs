// src/lib/turn-fold-plan.mjs
//
// 「完成态过程折叠」的纯逻辑：决定哪些单元收进折叠组、哪些作为正文锚点留在外面。
//
// ⛔⛔ 现行口径（10-10 用户定稿，原话：「不管回合时间多长，运行过程中有多少步骤，
//   在结束的时候，运行过程必须完全折叠进去，只保留汇总结果和汇总消息下面的已修改文件板块」）：
//   **收尾时整个运行过程（工具 / 思考 / 过渡正文 / 长正文，一视同仁）收成折叠组**；
//   留在折叠组外的只有：① 用户消息（含中途插入的 steer，09-13 定稿）；
//   ② 最终汇总结果（finalAgent）。已修改文件板块由调用方插在两者之间（frozenEditRows）。
//
// 演进史（⛔ 别按旧口径"改回来"，每一版都是用户的明确表态）：
//   · 09-12「折叠把最后汇报也收了」→ 当时的修法是「≥200 字的长正文留在外面」（治标：
//     只护住最长的那几段，超长回合的过程仍被切成多段）；
//   · 09-23 试「有正文就是锚点」（每段正文之间的过程各自成块）→ 当天被否（过程被切碎）；
//   · 10-10 用户实测超长回合：**长正文锚点把运行过程切成多段 = 没有折叠整个运行过程**
//     ⇒ 废除长正文锚点，改为"只认汇总结果"。
//   已知并接受的代价：结尾若是「长汇报 → 工具 → 一句话收尾」，那段长汇报也收进折叠组
//   （点开可见；汇总结果 = 最后那条仍在外面）。再改这条必须先问用户。
//
// ⛔⛔⛔ 10-25 用户定稿（**这条把上面所有口径统一了，别再改回去**）：
//   原话：「必须全部进大折叠」+「又出折叠会话到消息尾部了…重启应用，就跑到消息汇总下面」。
//   真因（实测 + 纯逻辑复现，见 scripts/guards/07-turn-fold.mjs 的断言）：
//   完成态的折叠是**两层**的 —— 外层「整段运行过程」大折叠 + **体内二次分段**
//   （`NestedProcessRuns`：把大折叠里的正文切成 body 段，夹在正文之间的过程再收成
//   内层小芯片）。而 `planCompletedFold` 只把**最后一条**有正文的 agentMessage 留在组外，
//   **中间那些有正文的 agentMessage 全部留在大折叠组内** ⇒ 它们被 `NestedProcessRuns`
//   当成 body 段切开，于是「过程小芯片」被渲染在**正文之间/正文下方** ——
//   截图实证：「使用技能 ADH 写法」芯片落在汇总正文**下面**，重启（走历史快照路径）后更明显。
//   ⇒ 定稿：**整个回合的过程（含中间正文）一律收进唯一一个大折叠组**，
//     组外只留「用户消息」与「最终汇总结果」；**体内不再二次分段**（否则又是散落芯片）。
//     这与 10-10 的「运行过程必须完全折叠进去」同向，且补上了「必须全部进大折叠」这条。

/** 取 agentMessage 的正文文本（其它类型一律空串） */
function bodyTextOf(item) {
  return item && item.type === "agentMessage" ? String(item.text ?? "").trim() : "";
}

/**
 * 完成态折叠计划：输入单元序列与最终答复的 item id，输出渲染计划：
 *   { kind: "fold", units } —— 连续的过程单元 → 收进折叠组
 *   { kind: "body", unit }  —— 锚点 → 常驻在折叠组外（用户消息 / 最终汇总结果）
 *
 * ⛔⛔⛔ 10-25 用户定稿（本函数的**核心不变量**，守卫已钉死）：
 *   **最终汇总正文永远是计划的最后一项；它后面不许再出现任何折叠组。**
 *
 *   为什么（真因，截图 + 纯逻辑复现都指向它）：
 *   上游给的 item 顺序里，**最终答复后面可能还有过程单元**（典型：模型先说话、
 *   引擎随后才补记/落定那条工具调用 —— 实测引擎快照就出现过
 *   `… > agentMessage > commandExecution` 这种尾巴）。
 *   旧实现在遍历到最终答复时 flush 一次、然后**继续把尾巴收进第二个折叠组** ⇒
 *   那个折叠组渲染在**汇总消息下面**（用户截图：「使用技能 ADH 写法」芯片
 *   落在汇总正文下方；「重启应用，就跑到消息汇总下面」—— 重启走历史快照路径，
 *   尾巴更容易出现）。
 *
 *   修法：**尾巴里的过程单元一律前移**到最终答复之前（它们本来就是过程），
 *   于是「整个回合的过程」收进**唯一一个大折叠组**，组外只剩
 *   ① 用户消息 ② 最终汇总正文 —— 用户原话「必须全部进大折叠」。
 *
 *   附带修掉「过程被切成多段」的老毛病：中间那些有正文的 agentMessage 也在
 *   折叠组内，展开时由 `NestedProcessRuns` 做体内二次分段（09-23 用户要的双层）。
 */
export function planCompletedFold(units, finalAgentId) {
  const raw = Array.isArray(units) ? units : [];
  const isUser = (unit) => unit?.item?.type === "userMessage";
  const isAgentWithBody = (unit) => unit?.item?.type === "agentMessage" && Boolean(bodyTextOf(unit.item));
  // 最终汇总：优先按 id 匹配；id 对不上（上游快照丢 id 的既有形态）→ 以最后一条有正文的消息兜底
  let finalIndex = -1;
  if (finalAgentId) {
    for (let index = raw.length - 1; index >= 0; index--) {
      if (raw[index]?.item?.id === finalAgentId && isAgentWithBody(raw[index])) { finalIndex = index; break; }
    }
  }
  if (finalIndex < 0) {
    for (let index = raw.length - 1; index >= 0; index--) {
      if (isAgentWithBody(raw[index])) { finalIndex = index; break; }
    }
  }
  // ⛔ 找不到汇总正文 ⇒ 全是过程 ⇒ 整段收成一个大折叠组（组外无正文）
  if (finalIndex < 0) {
    return raw.length ? [{ kind: "fold", units: [...raw] }] : [];
  }
  // ⛔⛔ 尾巴前移：最终答复**之后**的过程单元归入同一个大折叠组（不另起一个组）。
  //    用户消息不动（它是要留在组外的锚点，09-13 定稿）。
  const head = raw.slice(0, finalIndex);
  const finalUnit = raw[finalIndex];
  const tail = raw.slice(finalIndex + 1);
  const tailProcess = tail.filter((unit) => !isUser(unit));
  const tailUsers = tail.filter(isUser);
  const list = [...head, ...tailProcess, finalUnit, ...tailUsers];

  const plan = [];
  let buffer = [];
  const flush = () => { if (buffer.length) plan.push({ kind: "fold", units: buffer }); buffer = []; };
  const finalPos = list.indexOf(finalUnit);
  list.forEach((unit, index) => {
    if (isUser(unit) || index === finalPos) { flush(); plan.push({ kind: "body", unit }); }
    else buffer.push(unit);
  });
  flush();
  return plan;
}
