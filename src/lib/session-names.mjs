/**
 * 会话「笔名」体系（10-31 立，11-01 改版）—— 纯函数 + 内置名字库，主进程与渲染层共用。
 *
 * 用户 11-01 逐字要求：
 *   「笔名最后不要用人名啊，这样会被投诉的」+「你可以直接改会话名字，而不是在前面加一个什么主管标签，
 *     会话选项名字，这样就不要跟着用户首个消息内容去会话名字」
 *   ⇒ 三条硬口径：
 *     ① **不再叫「XX主管」**：笔名本身就是会话名，**不加任何职级后缀**；
 *     ② 笔名**不能像人名**（上一版「林钟 / 青崖」被判"像人名，会被投诉"）——
 *        换成**器物 / 工具型**双字词（快刀、明镜、稳舟…），一眼是代号，不是姓名；
 *     ③ 会话标题就是笔名，不再跟着首条用户消息走。
 *
 * 口径（⛔ 改之前先读，守卫【live-edits】逐条钉）：
 *   · 笔名只有两个字，由「手感前缀 × 器物本体」拼出，池子 30 × 20 = 600 种，远超 200 会话不重名；
 *   · 每个字自带寓意；名字的寓意 = 前缀寓意 + 本体寓意；
 *   · 用户 = **总经理**（唯一职级称谓，标在用户气泡旁）；会话行不带职级；
 *   · 选取确定性（按 threadId 哈希起步 + 顺延避开已占用）；用户改过的一律以用户为准。
 */

/** 前缀池：**手感 / 状态**字。⛔ 不用姓氏字，避免再拼出像人名的组合。 */
const HEADS = [
  ["快", "出手快、不拖"], ["稳", "稳、不返工"], ["直", "坦白、不粉饰"], ["细", "细、不漏细节"],
  ["深", "想得深、挖到底"], ["厚", "底子厚、扛得住"], ["轻", "不压人、节奏轻"], ["重", "抓关键、分量足"],
  ["冷", "客观、不带情绪"], ["明", "透亮、讲得清"], ["暗", "低调、只交结果"], ["短", "利落、只说重点"],
  ["长", "持久、不松劲"], ["宽", "能容、留余地"], ["圆", "圆、不藏角、能转"], ["平", "持平、不偏"],
  ["密", "密、不漏风"], ["疏", "疏、抓大放小"], ["干", "干净、不拖泥"], ["润", "顺、不卡顿"],
  ["亮", "明亮、先照见"], ["钝", "钝、不急下结论"], ["利", "锋利、切要害"], ["整", "整、收得齐"],
  ["齐", "齐、一项不落"], ["简", "去繁、直给"], ["繁", "繁、肯下笨功"], ["静", "静、不抢话"],
  ["定", "定、不摇摆"], ["顺", "顺、会借势"],
];

/** 本体池：**器物 / 工具**。⛔ 不用「崖 / 川 / 林 / 钟 / 山」这类会被读成人名的字。 */
const TAILS = [
  ["刀", "锋利、切要害"], ["尺", "有标准、讲尺度"], ["舟", "渡人、能摆渡问题"], ["镜", "如实、照见问题"],
  ["网", "铺开、不漏项"], ["灯", "照亮、给方向"], ["井", "深挖、有源头"], ["桥", "连接、会牵线"],
  ["钉", "钉死、不含糊"], ["锁", "扣住、不松口"], ["绳", "串起、有牵挂"], ["轴", "转得动、承力"],
  ["闸", "控节奏、能截流"], ["盘", "盘点、会结算"], ["匣", "收纳、有分类"], ["册", "有条理、爱记录"],
  ["线", "理线、有脉络"], ["锤", "敲定、敢定论"], ["轮", "推进、带节奏"], ["榫", "咬合、严丝合缝"],
];

/** 用户职级（唯一称谓；会话行不加职级）。 */
export const USER_TITLE = "总经理";
/** ⛔ 11-01 起**不再使用**职级后缀（保留导出只为兼容旧引用；空串 = 拼不出「XX主管」）。 */
export const SUPERVISOR_SUFFIX = "";

/** 全部候选笔名（HEADS × TAILS，600 个）。⛔ 顺序固定，别排序/别随机化（保证确定性）。 */
export const ALIAS_POOL = HEADS.flatMap(([head]) => TAILS.map(([tail]) => `${head}${tail}`));

/** 某笔名的「特点与含义」：前缀寓意 + 本体寓意。不认识的（用户自改的）返回空串。 */
export function aliasMeaningOf(alias) {
  const name = String(alias ?? "").trim();
  if (name.length !== 2) return "";
  const head = HEADS.find(([ch]) => ch === name[0]);
  const tail = TAILS.find(([ch]) => ch === name[1]);
  if (!head || !tail) return "";
  return `${head[1]}；${tail[1]}`;
}

/** 字符串 → 稳定的非负整数（FNV-1a，纯函数、无依赖；⛔ 别用 Math.random，重开就变）。 */
function hashOf(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 取一个未占用的笔名：从 `seed`（通常是 threadId）哈希处起步，撞了就顺延。
 * @param seed 参与哈希的稳定字符串（会话 id）
 * @param used 已被占用的笔名集合（Set 或数组；用户自改的名字也要算进去）
 * @returns 笔名（两字）；池子全被占时返回空串（调用方自行降级）
 */
export function pickSessionAlias(seed, used = []) {
  const taken = used instanceof Set ? used : new Set(Array.isArray(used) ? used : []);
  const size = ALIAS_POOL.length;
  if (!size || taken.size >= size) return "";
  const start = hashOf(seed) % size;
  for (let i = 0; i < size; i += 1) {
    const candidate = ALIAS_POOL[(start + i) % size];
    if (!taken.has(candidate)) return candidate;
  }
  return "";
}

/**
 * 会话对外显示名 = 笔名本身（11-01 用户令：不加「主管」）。
 * ⛔ 保留函数名是为了不动所有调用点；语义已变成"原样返回"。
 */
export function supervisorIdOf(alias) {
  return String(alias ?? "").trim();
}

/**
 * 用户改名的校验。
 *
 * ⛔ 11-01 用户令：「笔名就是会话选项名，为啥要重复两个改名字的选项呢」——
 *    ⇒ **名字 = 会话名**，不再是"两字笔名"这个独立概念。
 *    自动分配仍然从池子里取两字（`pickSessionAlias`），但用户手动改的时候可以写任意
 *    「1~24 个字符」的自然名字（如「英伟达调研」「Jetson 选型」），否则"改名"和"改笔名"
 *    就永远不是一回事、也没法合并成一个入口。
 * 仍然保留**不重名**（用户 10-31 明确要求「确保 200 个会话不能有重复名字」；
 *   重名会让"上级是谁"在气泡里分不清）。
 */
export function validateAlias(input, used = []) {
  const name = String(input ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (!name) return { ok: false, reason: "名字不能为空" };
  if ([...name].length > 24) return { ok: false, reason: "名字最多 24 个字" };
  const taken = used instanceof Set ? used : new Set(Array.isArray(used) ? used : []);
  if (taken.has(name)) return { ok: false, reason: "这个名字已经被别的会话用了" };
  return { ok: true, alias: name };
}
