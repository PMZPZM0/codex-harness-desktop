/**
 * 智能体卡通头像的**纯函数层**（选图集 / 选格子）。
 *
 * 10-31 用户令：「设置里面专家卡片、专家团卡片、子智能体卡片做成卡通头像+介绍，
 *   纯文字卡片好丑，区分出来智能体、专家、专家团，不同风格头像」。
 *
 * 三类各一套美术风格（避免"专家和机器人分不清"）：
 *   · expert   = 白领人物半身像（西装 / 衬衫 / 针织，暖白底）
 *   · team     = 两三个同事的团队徽章（彩色底）
 *   · subagent = 办公小机器人（耳机 / 领带 / 猫耳，暖白底）
 * 每类两张 **3×3 图集**（9 张/张 ⇒ 18 个造型），按 seed 稳定散列选图 + 选格
 * —— 同一个专家/子智能体每次渲染都是同一张脸，换列表顺序也不会跳。
 *
 * ⛔ 这里**只算文件名与格子**，不拼 URL：图片在 `public/avatars/`，URL 由组件用
 *   `avatarAsset()`（BASE_URL）拼 —— 打包后 index.html 是 file://，写死 `/avatars/...`
 *   会解析到盘符根目录（用户头像同款坑）。
 * ⛔ 图集必须保持 3×3 等分；切片 = background-size: 300% 300% + 位置 0/50/100%。
 */
export const AGENT_AVATAR_KINDS = ["expert", "team", "subagent"];

/** 每类四张图集（顺序即散列取模顺序）—— 10-31 用户令「多丰富一些头像」：
 *  2 张 → 4 张 ⇒ 36 个造型/类（40 个专家里重复率从 2.2 降到 1.1）。 */
const SHEETS = {
  expert: ["agent-expert-a.webp", "agent-expert-b.webp", "agent-expert-c.webp", "agent-expert-d.webp"],
  team: ["agent-team-a.webp", "agent-team-b.webp", "agent-team-c.webp", "agent-team-d.webp"],
  subagent: ["agent-subagent-a.webp", "agent-subagent-b.webp", "agent-subagent-c.webp", "agent-subagent-d.webp"],
};

/** 图集列数（3×3）。 */
export const AGENT_AVATAR_COLS = 3;
/** 单张图集的格子数。 */
export const AGENT_AVATAR_CELLS = 9;

/** FNV-1a 32 位散列：稳定、无依赖（纯函数可离线真跑）。 */
export function agentAvatarHash(seed, salt = "") {
  let hash = 0x811c9dc5;
  const text = `${seed}|${salt}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 调度目录的 kind → 头像风格（`cli` 用机器人那套；`member` 是团队成员 = 专家风格）。
 * ⛔ 映射只有这一份：@ 面板 / 输入框芯片 / 右侧头像轨都读它，别各自写三元。
 */
export function agentAvatarKindOf(kind) {
  const value = String(kind ?? "").trim();
  if (value === "team") return "team";
  if (value === "subagent" || value === "cli") return "subagent";
  return "expert";
}

/**
 * 选头像：同一 seed 恒定；空 seed 回落第一张图集第 0 格（不随机跳）。
 * @param {"expert"|"team"|"subagent"} kind
 * @param {string} seed 成员 id / 团队 id / 子智能体 id
 * @returns {{ file: string, cell: number, x: number, y: number }}
 *   file = public/avatars 下的文件名；x/y = background-position 百分比（0/50/100）
 */
export function pickAgentAvatar(kind, seed) {
  const list = SHEETS[kind] ?? SHEETS.expert;
  const safe = String(seed ?? "").trim();
  if (!safe) return { file: list[0], cell: 0, x: 0, y: 0 };
  const sheet = agentAvatarHash(safe, "sheet") % list.length;
  const cell = agentAvatarHash(safe, "cell") % AGENT_AVATAR_CELLS;
  const col = cell % AGENT_AVATAR_COLS;
  const row = Math.floor(cell / AGENT_AVATAR_COLS);
  // 百分比定位：i/(n-1)*100 ⇒ 3 列 = 0 / 50 / 100
  return {
    file: list[sheet],
    cell,
    x: (col / (AGENT_AVATAR_COLS - 1)) * 100,
    y: (row / (AGENT_AVATAR_COLS - 1)) * 100,
  };
}
