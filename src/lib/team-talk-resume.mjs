/**
 * 群聊会话 resume 失败分类（11-08 用户令：「查一下 resume 失败后重复会话的问题」）。
 *
 * 真因（引擎二进制里的原话就在这几个字符串上）：
 *   · `cannot resume running thread` —— 会话**正在跑**时 resume 被拒；
 *   · `thread not found: <id>` / `rollout path missing for thread` —— 会话真的不在了。
 * 旧代码把**所有** resume 失败都当成"会话没了"⇒ 新建一条 + 覆盖台账 ⇒
 * 同一位成员出现两条会话（旧的那条还挂在侧栏），也就是用户看到的重复会话。
 *
 * ⇒ 分类口径：
 *   · "busy"      —— 现有会话活着、只是正忙：⛔ 绝不能新建，等上一回合结束再投递（宿主按成员串行）；
 *   · "missing"   —— 引擎明确说找不到：可以重建（用户删过会话）；
 *   · "transient" —— 引擎重启 / 超时 / 未知错误：⛔ 也不新建（下次再试，别把长期会话换掉）。
 */

/** 引擎明确"会话不存在"的错误特征（⛔ 别把 failed to load 这类暂时性错误算进来）。 */
const MISSING = /thread not found|rollout path missing for thread|rollout missing for thread|no rollout (?:found )?for thread/i;
/** 引擎明确"会话正在运行、不能 resume"的错误特征。 */
const BUSY = /cannot resume (?:a )?running thread|while it is already running|is already running with a different rollout/i;

/** 把 resume 的报错归类：`busy`（等它跑完）/ `missing`（可重建）/ `transient`（稍后重试，别重建）。 */
export function classifyTalkResumeFailure(message) {
  const text = String(message ?? "");
  if (BUSY.test(text)) return "busy";
  if (MISSING.test(text)) return "missing";
  return "transient";
}
