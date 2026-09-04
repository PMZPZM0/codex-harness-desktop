// 用户消息文本解析：把 userMessage 文本中的"附件/技能/上下文/SYSTEM TASK"等约定引用段
// 剥离为结构化字段，留下对外展示用的 cleanText。
// 纯函数、零 React 依赖，可独立编译跑 node:test（scripts/verify-user-refs.mjs）。

/** 引用会话记录协议块的载荷：id=源会话 ID，note=折叠卡备注行（必须单行），content=记录全文。 */
export type ThreadReferencePayload = { id: string; note: string; content: string };

/** parseUserRefs 返回的结构化字段。teamTask 存在时表示这是团队或成员会话首条系统任务段；
 *  UI 应只展示 requirement，原始文本里的角色提示 / SOP / 编排指令等折叠隐藏。
 *  imported 存在时表示这条用户消息开头附了一段外部导入的会话记录（主流 AI / 官方 Codex /export 的 .md），
 *  记录全文不属用户原文，界面折叠成一张可展开的卡（note=备注行，content=记录全文）。
 *  threadReferences 是通过“会话 ID”引用的本机会话记录，同样只以折叠卡展示。 */
export type ParsedUserRefs = {
  cleanText: string;
  files: string[];
  skills: { name: string; description: string }[];
  contexts: { role: string; text: string }[];
  teamTask?: { kind: "team" | "member"; requirement: string };
  imported?: { note: string; content: string };
  threadReferences: ThreadReferencePayload[];
};

/** 最小 userMessage 形态（不依赖 App.tsx 内部的 ThreadItem），保留结构兼容即可。 */
type UserMessageLike = { type: string; content?: { type: string; text?: string }[] };
/** 最小 turn 形态（同上） */
type TurnWithItems = { items?: UserMessageLike[] };

/** 把用户消息原文解析为结构化引用段。
 *  包含四类约定段：附件文件 / 技能 / 上下文 / SYSTEM TASK，cleanText 是剥完所有引用段后的剩余文本。 */
export function parseUserRefs(text: string): ParsedUserRefs {
  const files: string[] = [];
  const skills: { name: string; description: string }[] = [];
  const contexts: { role: string; text: string }[] = [];
  const threadReferences: ParsedUserRefs["threadReferences"] = [];
  let clean = text ?? "";
  // 导入会话记录段：整段是机器附上的外部记录，不属于用户原文，必须最先剥离——
  // 否则记录全文里若恰好含 [附件文件]/[用户指定的对话上下文] 等字样会被后续正则误剥。
  let imported: ParsedUserRefs["imported"];
  const importMatch = clean.match(/\[导入的会话记录\]\s*\n([\s\S]*?)\n=== 记录内容 ===\s*\n([\s\S]*?)\n=== 记录结束 ===/);
  if (importMatch) {
    imported = { note: importMatch[1].trim(), content: importMatch[2].trim() };
    clean = clean.replace(importMatch[0], "");
  }
  // 本机会话引用段：复制“会话 ID”到另一会话后，发送管线会把目标会话的清洗记录
  // 附在这个协议块里。支持一条消息引用多个会话，记录全文不进入用户气泡正文。
  const threadRefPattern = /\[引用的会话记录\]\s*\n会话 ID[：:]\s*([^\s]+)\s*\n([^\n]*)\n=== 记录内容 ===\s*\n([\s\S]*?)\n=== 记录结束 ===/g;
  clean = clean.replace(threadRefPattern, (_block, id: string, note: string, content: string) => {
    threadReferences.push({ id: id.trim(), note: note.trim(), content: content.trim() });
    return "";
  });
  // 附件文件段：[附件文件]\n- path\n...\n[附件结束]
  const fileMatch = clean.match(/\[附件文件\]\s*\n([\s\S]*?)(?:\[附件结束\]|\[[^\]]+\]|$)/);
  if (fileMatch) {
    for (const line of fileMatch[1].split(/\r?\n/)) {
      const m = line.match(/^-\s+(.+)$/);
      if (m) files.push(m[1].trim());
    }
    clean = clean.replace(fileMatch[0], "");
  }
  // 技能段：[本轮已引用技能]\n- name：desc\n...\n[请按上述技能工作流执行]
  const skillMatch = clean.match(/\[本轮已引用技能\]\s*\n([\s\S]*?)(?:\[请按上述技能工作流执行\]|\[[^\]]+\]|$)/);
  if (skillMatch) {
    for (const line of skillMatch[1].split(/\r?\n/)) {
      const m = line.match(/^-\s+(.+)$/);
      if (m) {
        const [name, ...desc] = m[1].split(/[：:]/);
        skills.push({ name: name.trim(), description: desc.join("：").trim() });
      }
    }
    clean = clean.replace(skillMatch[0], "");
  }
  // 上下文段：[用户指定的对话上下文]\n(1) role：text\n...\n[上下文结束]
  const ctxMatch = clean.match(/\[用户指定的对话上下文\]\s*\n([\s\S]*?)(?:\[上下文结束\]|\[[^\]]+\]|$)/);
  if (ctxMatch) {
    for (const entry of ctxMatch[1].split(/\n\n+/)) {
      const m = entry.match(/^\((\d+)\)\s*(.+?)[：:]\s*([\s\S]*)$/);
      if (m) contexts.push({ role: m[2].trim(), text: m[3].trim() });
    }
    clean = clean.replace(ctxMatch[0], "");
  }
  // 记忆召回段：这是发送给模型的内部参考上下文，不属于用户原文。
  // 保留在原始 userMessage 里供引擎使用，但从气泡、标题、复制和引用文本中隐藏，
  // 避免每次开启记忆都把整段项目背景铺满对话框。
  clean = clean.replace(/\[Harness 相关记忆，仅供参考\][\s\S]*?\[记忆结束\]/g, "");
  // 专家团/成员会话首条系统任务段：渲染层只展示用户需求原文，角色提示与编排指令折叠隐藏。
  // 剥除范围 = [SYSTEM TASK ...] 到 === END === 之后的编排指令段（到下一个引用段标记或串尾为止），
  // 否则"请按 SOP…"之类的指令会泄漏进 cleanText。
  const teamTaskMatch = clean.match(/\[SYSTEM TASK · (团队会话|成员会话)\][\s\S]*?=== 用户需求 ===\s*\n([\s\S]*?)\n=== END ===[\s\S]*?(?=\n\[[^\]]+\]|$)/);
  let teamTask: ParsedUserRefs["teamTask"] | undefined;
  if (teamTaskMatch) {
    clean = clean.replace(teamTaskMatch[0], "");
    teamTask = {
      kind: teamTaskMatch[1] === "团队会话" ? "team" : "member",
      requirement: teamTaskMatch[2].trim(),
    };
  }
  return { cleanText: clean.replace(/\n{3,}/g, "\n\n").trim(), files, skills, contexts, teamTask, imported, threadReferences };
}

/** 用户消息对外可见文本（复制/引用/标题/上下文选择使用）：
 *  团队/成员会话首条的 SYSTEM TASK 段已整体折叠为"用户原文 + 系统任务指令卡片"，返回的就是用户真正写的字。
 *  普通消息走 parseUserRefs.cleanText（附件/技能/上下文段也被剥离，因为 UI 上它们是独立卡片而非气泡正文）。 */
export function userDisplayText(rawText: string): string {
  const refs = parseUserRefs(rawText);
  if (refs.teamTask) return refs.teamTask.requirement;
  return refs.cleanText;
}

/** 判断服务端落地的 userMessage 是否对应本地乐观 input。
 * 服务端可能剥掉记忆/技能/引用等内部段，因此文本必须按用户可见正文比较；
 * 没有文字的纯图片消息则按本地图片路径顺序比较。 */
export function userMessageMatchesInput(
  item: any,
  input: any[],
): boolean {
  const serverRaw = (item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text ?? "").join("\n");
  const inputRaw = input.filter((part: any) => part.type === "text").map((part: any) => part.text ?? "").join("\n");
  const serverText = userDisplayText(serverRaw).trim();
  const inputText = userDisplayText(inputRaw).trim();
  if (serverText || inputText) return serverText === inputText;
  const serverImages = (item.content ?? []).filter((part: any) => part.type === "localImage").map((part: any) => String(part.path ?? ""));
  const inputImages = input.filter((part: any) => part.type === "localImage").map((part: any) => String(part.path ?? ""));
  return serverImages.length > 0 && serverImages.length === inputImages.length && serverImages.every((path: string, index: number) => path === inputImages[index]);
}

/** 取回合里首个 userMessage 的对外文本（与气泡/复制/编辑/引用/上下文选择/线程标题一致）。
 *  用于线程标题自动生成与乐观消息文本去重，避免 SYSTEM TASK 段污染标题/匹配键。 */
export function firstUserTextInTurn(turn: TurnWithItems): string {
  for (const item of turn.items ?? []) {
    if (item.type === "userMessage") {
      const text = (item.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
      return userDisplayText(text);
    }
  }
  return "";
}

/** 会话标题的渲染层清洗（_显示_用，不写回数据库）。
 *  引擎里持久化的 thread.name / thread.preview 是历史脏数据：可能含 harness 注入块
 *  （`[Harness 相关记忆，仅供参考]…[记忆结束]`、`[本轮已引用技能]`、`[导入的会话记录]`、
 *  `[引用的会话记录]`、`[SYSTEM TASK · 团队会话]…=== END ===`）或多行首段过长。
 *  下拉框 / 列表 / toast 拿来直接当 label 会让用户看到「哈喽 [Harness 相关记忆…」这种文字。
 *  清洗策略：
 *    1. 用 userDisplayText 剥掉所有已知注入块（标准成对闭合）；
 *    2. 对残缺的 harness 注入片段做容错剥离（用户复述时丢了 `[记忆结束]`）
 *       ——从 `[Harness 相关记忆…]` 起向后到下一个已知块标签或串尾；
 *    3. 取首段非空行（多行贴入时只露标题那行）；
 *    4. 按 maxLength 截断（中文按字符数，避免半字符切断）；
 *    5. 无内容则回退 preview，再无则返回 fallback。
 *  不动数据库原始命名 → 调色板 / 全局搜索 / 调 `thread/name/set` 时仍按 raw name 索引，
 *  不会被这次的清洗剔除旧会话的命中。 */
export function cleanThreadDisplayTitle(
  raw: string | null | undefined,
  opts?: { preview?: string | null; fallback?: string; maxLength?: number }
): string {
  const maxLength = opts?.maxLength ?? 60;
  const fallback = opts?.fallback ?? "未命名会话";

  // 已知 harness 注入块标签——用于残缺片段的容错剥离。
  // 没有 [记忆结束] 时，配对正则不命中；这里从 [Harness 相关记忆…] 起吃
  // 到下一个已知块标签或串尾（含 [本轮已引用技能]、[Harness 常驻记忆…]、导入/引用、
  // SYSTEM TASK、附件、上下文等），避免误伤用户正文里的孤立方括号词。
  const HARNESS_HEAD = "[Harness";
  const KNOWN_BLOCK_LABEL = String.raw`\[(?:Harness\s*(?:相关记忆|常驻记忆)|本轮已引用技能|已注入技能|SYSTEM\s*TASK|附件文件|用户指定的对话上下文|导入的会话记录|引用的会话记录|记忆结束|常驻记忆结束|请按上述技能工作流执行|上下文结束|附件结束)\]`;

  const firstNonEmptyLine = (text: string | null | undefined): string => {
    if (!text) return "";
    let cleaned = userDisplayText(text).trim();
    if (!cleaned) return "";
    // 容错：残缺的 harness 注入片段（用户复述时丢了 [记忆结束]）
    if (cleaned.includes(HARNESS_HEAD)) {
      try {
        const re = new RegExp(String.raw`\[Harness\s*(?:相关记忆|常驻记忆)[^\]]*\][\s\S]*?(?=${KNOWN_BLOCK_LABEL}|$)`, "g");
        cleaned = cleaned.replace(re, "").trim();
      } catch { /* 正则容错失败不要阻塞主流程 */ }
    }
    if (!cleaned) return "";
    return cleaned.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  };

  const picked = firstNonEmptyLine(raw) || firstNonEmptyLine(opts?.preview) || "";
  if (!picked) return fallback;
  return picked.length > maxLength ? picked.slice(0, maxLength).trimEnd() + "…" : picked;
}

// —— 引用会话记录协议：生成侧（与 parseUserRefs 的 threadRefPattern 同文件维护，防格式漂移） ——

const THREAD_ID_SHAPE = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** 从用户输入里提取要引用的会话 ID：识别「会话/任务 ID：uuid」标记形式与整条消息就是一个裸 UUID 两种写法，最多 3 个、去重。 */
export function extractThreadReferenceIds(text: string): string[] {
  const ids = new Set<string>();
  const marked = new RegExp(`(?:会话|任务)\\s*ID\\s*[：:]\\s*(${THREAD_ID_SHAPE})`, "gi");
  for (const match of text.matchAll(marked)) ids.add(match[1].toLowerCase());
  const bare = text.trim().match(new RegExp(`^(${THREAD_ID_SHAPE})$`, "i"));
  if (bare) ids.add(bare[1].toLowerCase());
  return [...ids].slice(0, 3);
}

/** 发送前把「会话 ID：…」标记从正文剥掉；若正文剥完只剩裸 UUID（即用户只粘了个 ID）返回空串。 */
export function stripThreadReferenceIds(text: string): string {
  const marked = new RegExp(`(?:会话|任务)\\s*ID\\s*[：:]\\s*${THREAD_ID_SHAPE}`, "gi");
  const withoutMarked = text.replace(marked, "");
  return new RegExp(`^\\s*${THREAD_ID_SHAPE}\\s*$`, "i").test(withoutMarked) ? "" : withoutMarked.replace(/\n{3,}/g, "\n\n").trim();
}

/** 把引用载荷包装成协议块（parseUserRefs.threadRefPattern 的镜像格式，两侧必须同步修改）。 */
export function formatThreadReferenceBlock(reference: ThreadReferencePayload): string {
  return `[引用的会话记录]\n会话 ID：${reference.id}\n${reference.note}\n=== 记录内容 ===\n${reference.content}\n=== 记录结束 ===`;
}

/** 从目标会话的 User/Assistant 消息序列构建引用载荷：过滤空消息、拼 Markdown、超 16 万字符取尾部。
 *  note 必须单行：threadRefPattern 按「一行 note」匹配，会话名若含换行会让引用块失配
 *  → 卡片不显示且正文被剥离（内容不可见），这里统一折行清洗。 */
export function buildThreadReferencePayload(id: string, name: string, messages: { role: "user" | "assistant"; text: string }[]): ThreadReferencePayload | null {
  const visible = messages.filter((message) => message.text.trim());
  if (!visible.length) return null;
  const full = visible.map((message) => `## ${message.role === "user" ? "User" : "Assistant"}\n${message.text.trim()}`).join("\n\n");
  const maxChars = 160_000;
  const truncated = full.length > maxChars;
  const content = truncated ? `（会话过长，较早内容已截断，以下为最近记录）\n\n${full.slice(-maxChars)}` : full;
  const safeName = String(name || "").replace(/\s*\n+\s*/g, " ").trim();
  return { id, note: `会话名称：${safeName || "未命名会话"} ｜ ${visible.length} 条消息${truncated ? " ｜ 已截取最近内容" : ""}`, content };
}
