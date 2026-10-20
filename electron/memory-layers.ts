import fs from "node:fs/promises";
import path from "node:path";
import {
  CORRECTION_CATEGORY, PITFALL_CATEGORY, PREFERENCE_CATEGORY, SOP_CATEGORY,
  appendLessonLine, groupLessonSections, lessonSectionTitle, sortLessonSections, splitLessonSections, shouldRememberLine,
} from "./memory-lessons";
import { effectiveMemoryBackend } from "./memory-backend";
/* P2 批次 4（10-18）：布局常量 / 预算 / 金字塔 / 水位 / 蒸馏切分等**纯逻辑**已切到 ./memory/layers-budget。
   ⛔ 重导出保持对外 API；类区仍使用的符号在下方显式回引。 */
export * from "./memory/layers-budget";
import { MEMORY_DIR, MEMORY_SUB, ARCHIVE_DIR, PROJECT_DIR, LESSONS_DIR, LOGS_DIR, ROLLUP_DIR, MEMORY_FILE, BACKGROUND_FILE, LESSON_FILES, LESSON_MISC_FILE, PENDING_MCP_SECTION, LEGACY_LESSONS, LEGACY_MARK, MEMORY_BUDGET, DEFAULT_MEMORY_SCALE, normalizeMemoryScale, scaledMemoryBudget, LESSONS_MAX_LINES, DISTILL_AFTER_DAYS, AUTO_DISTILL_INTERVAL_MS, DISTILL_MIN_CHARS, MEMORY_DISTILL_THRESHOLD, ROLLUP_BUDGET, layerWatermarks, splitDistill, DISTILL_PROMPT, today, daysBetween, clamp, isScratchWorkspace } from "./memory/layers-budget";
import type { MemoryBudget, PyramidLayerId, MemoryLayersSnapshot, DistillPick, DistillResult } from "./memory/layers-budget";

/**
 * 记忆分层（对齐 WorkBuddy 的三层 + 碎片池）
 *
 * L0 用户档案：跨所有项目，只在设置页手动维护
 *   → {userData}/memory/USER.md
 * L1 项目长期记忆：跟随工作区，只由蒸馏或手动置顶写入
 *   → {workspace}/.codex-harness/memory/MEMORY.md
 * L1.5 坑与纪律：**踩过的坑与用户纠错**，半自动追加（捕获链写入，现象去重），独立于日志归档
 *   → {workspace}/.codex-harness/memory/LESSONS.md
 * L2 每日日志：append-only，只回灌最近 N 天
 *   → {workspace}/.codex-harness/memory/logs/YYYY-MM-DD.md
 * L3 碎片检索池：沿用既有 memory.json（MemoryStore），本模块不接管
 *
 * 写入门禁（这套能不能用的生死线）：
 *   - 自动捕获永远只进 L2（+ 命中纠错/失败时进 L1.5）
 *   - L1 只能由蒸馏或手动写入，自动流程绝不直接写 L1
 *   - L0 只能由用户手动写入
 *
 * 为什么单列 L1.5（09-22 用户实测痛点：「犯的错、踩的坑不记」）：
 *   坑只写进当天日志 → 日志 30 天后被蒸馏、注入只回灌最近 3 天 ⇒ 坑会**自然消失**，下一轮照踩。
 *   所以坑要单独成层：注入时**放在最前**（纪律优先于背景），不参与日志归档，蒸馏时要求原样保留。
 */


export class MemoryLayers {
  private readonly userFile: string;
  /** 用户选择的容量倍率（×1 基准）。⛔ 由外部注入 —— 本模块是纯逻辑，不读设置文件。 */
  private scale: number = DEFAULT_MEMORY_SCALE;
  private budgetCache: { scale: number; value: MemoryBudget } | null = null;

  constructor(private readonly userDataDir: string) {
    this.userFile = path.join(userDataDir, MEMORY_SUB, "USER.md");
  }

  /** 设置容量倍率（设置页改完调它）。非法值回退基准；返回实际生效的倍率。 */
  setScale(scale: unknown): number {
    this.scale = normalizeMemoryScale(scale);
    this.budgetCache = null;
    return this.scale;
  }

  getScale(): number { return this.scale; }

  /** 当前生效的注入预算（按倍率放大）。⛔ 本模块**只从这里取预算**，不直接读 MEMORY_BUDGET
   *  —— 直接读会绕过倍率（改一处漏一处，正是"设置改了没生效"那类 bug 的温床）。 */
  get budget(): MemoryBudget {
    if (!this.budgetCache || this.budgetCache.scale !== this.scale) {
      this.budgetCache = { scale: this.scale, value: scaledMemoryBudget(this.scale) };
    }
    return this.budgetCache.value;
  }

  private projectDir(workspace?: string): string | null {
    if (!workspace) return null;
    /* ⛔ scratch 会话（无工作区聊天）没有项目记忆：写了 = 构建即清 = 假记忆，还和真实项目记忆分叉 */
    if (isScratchWorkspace(workspace)) return null;
    return path.join(workspace, MEMORY_DIR, MEMORY_SUB);
  }

  async readText(file: string): Promise<string> {
    try { return await fs.readFile(file, "utf8"); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; return ""; }
  }

  private async writeText(file: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
  }

  // ── L0 用户档案 ────────────────────────────────────────────────
  readUser() { return this.readText(this.userFile); }

  async writeUser(content: string): Promise<void> {
    await this.writeText(this.userFile, content.trim() ? content.trim() + "\n" : "");
  }

  /** ① L0 用户档案引擎自维护：发现**稳定的**用户偏好/背景事实时追加一行画像。
   *  逐行去重（归一化后已存在即跳过，返回 false）；只追加、绝不改写/删除既有行。
   *  09-22 前 USER.md 只许用户手写 ⇒ 永远是空的，跨项目画像无从积累 —— 这正是
   *  WorkBuddy 云端画像的本地等价物：谁用谁知道的信息，就该谁（引擎）来记。 */
  async appendUserProfile(line: string): Promise<boolean> {
    const text = String(line ?? "").trim();
    if (!text) return false;
    const norm = (s: string) => s.replace(/[\s，。！？、,.!?:：；;"'（）()【】\[\]0-9-]/g, "");
    const existing = (await this.readText(this.userFile)).split("\n");
    if (existing.some((l) => norm(l) && norm(l) === norm(text))) return false;
    existing.push(text);
    await this.writeText(this.userFile, existing.filter((l) => l.trim()).join("\n") + "\n");
    return true;
  }

  // ── 目录布局（v2）与迁移 ────────────────────────────────────────
  private projectFile(dir: string): string { return path.join(dir, PROJECT_DIR, MEMORY_FILE); }
  private backgroundFile(dir: string): string { return path.join(dir, PROJECT_DIR, BACKGROUND_FILE); }
  private lessonsDir(dir: string): string { return path.join(dir, LESSONS_DIR); }
  private lessonFile(dir: string, category: string): string {
    return path.join(dir, LESSONS_DIR, LESSON_FILES[category] ?? LESSON_MISC_FILE);
  }
  private logsDir(dir: string): string { return path.join(dir, LOGS_DIR); }
  private rollupDir(dir: string): string { return path.join(dir, ROLLUP_DIR); }
  private archiveDir(dir: string): string { return path.join(dir, ARCHIVE_DIR); }

  /** 迁移标记：同一进程内不重复扫（跨进程靠磁盘标记文件 + 移动语义兜底） */
  private migrated = new Set<string>();

  /**
   * 把 v1 的散文件布局搬成 v2 的分目录布局（幂等）。
   * ⛔ 三条安全线：① 只用 `rename`（移动，不复制不删）；② 目标已存在则**不覆盖**；③ 失败只记不抛
   *    （记忆是附带功能，绝不能让布局迁移把会话搞挂）。
   */
  private async migrateLayout(dir: string): Promise<void> {
    if (this.migrated.has(dir)) return;
    this.migrated.add(dir);
    try {
      const marker = path.join(dir, LEGACY_MARK);
      if (await fs.access(marker).then(() => true).catch(() => false)) return;
      await fs.mkdir(path.join(dir, PROJECT_DIR), { recursive: true });
      await fs.mkdir(this.lessonsDir(dir), { recursive: true });
      await fs.mkdir(this.logsDir(dir), { recursive: true });
      await fs.mkdir(this.archiveDir(dir), { recursive: true });
      const moveIfFree = async (from: string, to: string) => {
        try {
          await fs.access(to);
          return false; // 目标已有内容：不覆盖（新布局优先）
        } catch { /* 目标不存在，可以搬 */ }
        try { await fs.rename(from, to); return true; }
        catch { return false; }
      };
      /* ① 项目宪法 / 背景 / 日志 */
      await moveIfFree(path.join(dir, MEMORY_FILE), this.projectFile(dir));
      await moveIfFree(path.join(dir, BACKGROUND_FILE), this.backgroundFile(dir));
      for (const date of await this.listLogDatesIn(dir)) {
        await moveIfFree(path.join(dir, `${date}.md`), path.join(this.logsDir(dir), `${date}.md`));
      }
      /* ② 旧 LESSONS.md：按分类拆进 lessons/，原件归档（分节解析复用 memory-lessons 的同一套逻辑） */
      const legacy = path.join(dir, LEGACY_LESSONS);
      if (await fs.access(legacy).then(() => true).catch(() => false)) {
        const text = await this.readText(legacy);
        const sections = sortLessonSections(text);
        for (const section of splitLessonSections(sections)) {
          const body = section.lines.join("\n").replace(/\s*$/, "");
          if (!body.trim()) continue;
          const category = section.category;
          const target = category && LESSON_FILES[category] ? this.lessonFile(dir, category) : path.join(this.lessonsDir(dir), LESSON_MISC_FILE);
          const existing = (await this.readText(target)).trim();
          /* ⛔ 新位置已有内容 ⇒ **不追加、不覆盖**：旧内容以 archive/ 里的原件为准（避免新旧混成一锅、也避免重复条目） */
          if (existing) continue;
          const head = category ? `${lessonSectionTitle(category)}\n` : "";
          await this.writeText(target, `${head}${body}\n`);
        }
        await moveIfFree(legacy, path.join(this.archiveDir(dir), `legacy-${LEGACY_LESSONS}`));
      }
      await this.writeText(marker, `v2 ${today()}\n`);
    } catch { /* 迁移失败不阻塞：读路径对旧位置仍有兜底（见 readProject / readBackground / readLessons） */ }
  }

  /** 旧布局的日志日期（仅迁移用：扫 memory/ 根的 YYYY-MM-DD.md） */
  private async listLogDatesIn(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
        .map((name) => name.replace(/\.md$/, ""))
        .sort();
    } catch { return []; }
  }

  /** 读一个文件：新位置优先，缺失时回落旧位置（未迁移成功的老工作区仍可用） */
  private async readWithLegacy(file: string, legacy: string): Promise<string> {
    const fresh = await this.readText(file);
    if (fresh.trim()) return fresh;
    return this.readText(legacy);
  }

  // ── L1 项目长期记忆 ────────────────────────────────────────────
  async readProject(workspace?: string): Promise<string> {
    const dir = this.projectDir(workspace);
    if (!dir) return "";
    await this.migrateLayout(dir);
    return this.readWithLegacy(this.projectFile(dir), path.join(dir, MEMORY_FILE));
  }

  /** 当前工作区的项目背景：面向该项目下所有会话的快速入门约束。 */
  async readBackground(workspace?: string): Promise<string> {
    const dir = this.projectDir(workspace);
    if (!dir) return "";
    await this.migrateLayout(dir);
    return this.readWithLegacy(this.backgroundFile(dir), path.join(dir, BACKGROUND_FILE));
  }

  async writeBackground(workspace: string, content: string): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir) throw new Error("尚未选择工作区，无法保存项目背景");
    await this.migrateLayout(dir);
    await this.writeText(this.backgroundFile(dir), content.trim() ? content.trim() + "\n" : "");
  }

  async writeProject(workspace: string, content: string): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir) throw new Error("尚未选择工作区，无法保存项目记忆");
    await this.migrateLayout(dir);
    await this.writeText(this.projectFile(dir), content.trim() ? content.trim() + "\n" : "");
  }

  // ── L2 纪律与记忆（lessons/<分类>.md，一个分类一个文件）────────────
  /** 读全部纪律（合成「## 分类」文本：注入 / 快照 / 蒸馏 / UI 都复用同一份解析） */
  async readLessons(workspace?: string): Promise<string> {
    const dir = this.projectDir(workspace);
    if (!dir) return "";
    await this.migrateLayout(dir);
    const parts: string[] = [];
    /* 顺序 = 注入顺序（纠错最前）；文件不存在就跳过 */
    for (const category of Object.keys(LESSON_FILES)) {
      const body = (await this.readText(this.lessonFile(dir, category))).trim();
      if (!body) continue;
      /* 文件里已带 `# 分类` 标题则原样用，否则补一个分节标题，让下游 splitLessonSections 照常工作 */
      parts.push(/^##\s+/m.test(body) ? body : `${lessonSectionTitle(category)}\n${body}`);
    }
    const misc = (await this.readText(path.join(this.lessonsDir(dir), LESSON_MISC_FILE))).trim();
    if (misc) parts.push(misc);
    if (parts.length) return `${parts.join("\n\n")}\n`;
    /* 兜底：迁移没成功时，旧 LESSONS.md 仍然可读 */
    return this.readText(path.join(dir, LEGACY_LESSONS));
  }

  /** 整体写回（设置页编辑器用）：按分类分节拆开，落进各自的文件 */
  async writeLessons(workspace: string, content: string): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir) throw new Error("尚未选择工作区，无法保存纪律与记忆");
    await this.migrateLayout(dir);
    const buckets = new Map<string, string[]>();
    for (const section of splitLessonSections(content)) {
      const file = section.category && LESSON_FILES[section.category] ? section.category : "__misc";
      const body = section.lines.join("\n").replace(/\s*$/, "");
      if (!body.trim()) continue;
      buckets.set(file, [...(buckets.get(file) ?? []), body]);
    }
    for (const [key, bodies] of buckets) {
      const file = key === "__misc" ? path.join(this.lessonsDir(dir), LESSON_MISC_FILE) : this.lessonFile(dir, key);
      const head = key === "__misc" ? "" : `${lessonSectionTitle(key)}\n`;
      await this.writeText(file, `${head}${bodies.join("\n")}\n`);
    }
    /* 清空被删掉的分类文件（编辑器里整类删掉时不留旧内容） */
    for (const category of Object.keys(LESSON_FILES)) {
      if (buckets.has(category)) continue;
      const file = this.lessonFile(dir, category);
      if (await fs.access(file).then(() => true).catch(() => false)) await this.writeText(file, "");
    }
  }

  /**
   * 追加一条纪律/坑（捕获链调用）。**现象去重**：dedupeKey 已存在则跳过（返回 false）。
   * 09-22 起**按分类分文件**（用户要求「纠错的记忆要单独一类」「记忆应该单独一个目录，文件夹保存」）：
   * `category` 缺省按「任务经验」；纠错类由捕获链显式传入 ⇒ 落 `lessons/corrections.md`，
   * 注入时排最前、永不被淘汰。
   */
  async appendLesson(workspace: string, line: string, dedupeKey: string, category?: string): Promise<boolean> {
    /* ⛔ 09-25「记忆后端二选一」：用户启用 MCP 记忆服务**且服务确实装好**时，记忆一律走 MCP，
       内置记忆金字塔停止捕获写入 —— 否则同一条纪律会在 MCP 库里存一份、在 lessons/*.md 里再存一份。
       ⛔ 判据必须是 `effectiveMemoryBackend()`（带可用性回退），**不是** `memoryBackend()`：
       用户选了 MCP 但服务没装/装坏时（原生模块装不上的环境很常见），若这里也让位 ⇒
       记忆一处都不写 = **彻底丢记忆**。宁可回到金字塔，也不能丢。 */
    if (effectiveMemoryBackend() === "mcp") return false;
    /* 10-20：云端后端同样让位 —— 记忆在 memapi 侧自动注入/回写，本地再写就是两份。 */
    if (effectiveMemoryBackend() === "cloud") return false;
    const dir = this.projectDir(workspace);
    const text = String(line ?? "").trim();
    if (!dir || !text) return false;
    /* ⛔ 含字面块标签的纪律行会**反过来破坏剥离**（自指污染，09-23 实证）：它被注入进常驻块后，
       非贪婪成对正则在它内部提前闭合 ⇒ 只剥前半段、后半段铺进 L4「需求」/L2「现象」，并继续喂出新的垃圾行。
       在**写入这一刻**拦住，而不是事后靠自检发现。 */
    if (/\[Harness\s*(?:常驻记忆|相关记忆)|\[(?:常驻记忆结束|记忆结束)\]/.test(text)) return false;
    /* ⛔ 10-17 新增写入判据：这是一条**可以改变未来行为**的纪律，还是一条流水？
       本方法此前只去重、不做价值判断（自动捕获链有 buildLessonLine 把门，但收藏 / 引擎手写 /
       记忆工具这些**直接调用方**绕过了它）。判据本体在 memory-lessons（与分类同源，⛔ 不另起一套）。
       ⛔ 被拒时**必须留痕**：判据是启发式，拒错要能复盘 —— ⛔ 不许静默吞。 */
    const verdict = shouldRememberLine(text, category);
    if (!verdict.keep) {
      console.log(`[memory] 未写入纪律（${verdict.reason}）：${text.slice(0, 80)}`);
      return false;
    }
    await this.migrateLayout(dir);
    const file = this.lessonFile(dir, category || PITFALL_CATEGORY);
    const existing = await this.readText(file);
    const key = String(dedupeKey ?? "").trim();
    /* 去重跨全部文件（同一条纪律不许在两个分类里各存一份） */
    const wsSafe = String(workspace ?? "");
    if (!wsSafe) return false;
    const all = await this.readLessons(wsSafe);
    const norm = (s: string) => String(s ?? "").replace(/[\s，。！？、,.!?:：；;""''（）()【】\[\]]/g, "");
    let textOut = text;
    if (key && norm(all).includes(key)) {
      /* ⛔⛔ 10-17（P1）：同一去重键再次出现**不再静默丢弃**。
         老行为是 `return false` —— 信息直接消失，且**没人知道它被丢了**（09-22 起一直如此）。
         但"同一条纪律又出现一次"本身是有信息的：说明它还在犯、措辞该强化、或该升级成技能。
         两条分支：
           ① 正文与既有条目**实质相同** ⇒ 就地记一次出现（可在面板里数"又犯了几次"）；
           ② 正文**不同** ⇒ 这是**冲突/更新**，不是重复 ⇒ 新行照写并标 \`⟳ 更新\`，
              旧行**原样保留**（可回溯"当时是这么定的"——这就是最轻的时间维度）。 */
      const hit = await this.markRepeatOrConflict(dir, category || PITFALL_CATEGORY, key, text, norm);
      if (hit === "duplicate") return false;            // 已就地记数，不新增行
      if (hit === "conflict") textOut = `⟳ 更新：${text}`; // 冲突 ⇒ 新增一行，旧行保留
      /* hit === "not-found"（键在别的分类文件里）⇒ 按老规矩拦住，跨文件不重复存 */
      if (hit === "not-found") return false;
    }
    const body = appendLessonLine(existing, category || PITFALL_CATEGORY, textOut);
    const lines = body.split("\n").length;
    const out = lines > LESSONS_MAX_LINES && !body.includes("已超过")
      ? body.replace("# 纪律与记忆", `# 纪律与记忆\n\n> ⚠️ 条目已超过 ${LESSONS_MAX_LINES} 行，请在设置 → 记忆里整理/并入 MEMORY.md（不自动删除）。`)
      : body;
    await this.writeText(file, out);
    return true;
  }

  /**
   * MCP 后端下的自动捕获落点（10-20）：lesson 候选不静默丢，也不双写。
   * 先写进 lessons/misc.md 的「待入 MCP」节；Codex 下一轮读常驻记忆时看到，调 MCP
   * `local_memory__memory_write`（暴露名，见 backend-routing.ts 的 mcpToolName）落库后把该行删掉。
   * 内置后端直接走 appendLesson。
   * ⛔ 云端后端**两个都不走**：那个后端没有记忆工具、上游自动从对话内容收记忆，写哪儿都是白写
   *    （写进 lessons 云端读不到，排进「待入 MCP」又没有工具可落库 ⇒ 只会留下永远删不掉的脏行）。
   */
  async appendPendingLesson(workspace: string, line: string, dedupeKey: string, category?: string): Promise<boolean> {
    if (effectiveMemoryBackend() === "mcp" || effectiveMemoryBackend() === "cloud") return false;
    return this.appendLesson(workspace, line, dedupeKey, category);
    const dir = this.projectDir(workspace);
    const text = String(line ?? "").trim();
    if (!dir || !text) return false;
    if (/\[Harness\s*(?:常驻记忆|相关记忆)|\[(?:常驻记忆结束|记忆结束)\]/.test(text)) return false;
    const verdict = shouldRememberLine(text, category);
    if (!verdict.keep) {
      console.log(`[memory] 未入待归档（${verdict.reason}）：${text.slice(0, 80)}`);
      return false;
    }
    const dirSafe = String(dir ?? "");
    if (!dirSafe) return false;
    await this.migrateLayout(dirSafe);
    const file = path.join(this.lessonsDir(dirSafe), LESSON_MISC_FILE);
    const existing = await this.readText(file);
    const key = String(dedupeKey ?? "").trim();
    const all = await this.readLessons(workspace);
    const norm = (s: string) => String(s ?? "").replace(/[\s，。！？、,.!?:：；;""''（）()【】\[\]]/g, "");
    if (key && norm(all).includes(key)) return false;
    if (norm(existing).includes(norm(text))) return false;
    await this.writeText(file, appendLessonLine(existing, PENDING_MCP_SECTION, text));
    return true;
  }

  /** 同键再次出现：区分「重复」与「冲突」（细节见 appendLesson 的说明）。
   *  返回 `duplicate`（已就地记数，调用方不要再加行）/ `conflict`（调用方新增一行并标 ⟳）/ `not-found`（键不在本分类文件里）。 */
  private async markRepeatOrConflict(dir: string, category: string, key: string, text: string, norm: (s: string) => string): Promise<"duplicate" | "conflict" | "not-found"> {
    const file = this.lessonFile(dir, category);
    const raw = await this.readText(file);
    if (!raw) return "not-found";
    const lines = raw.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^\s*[-*]\s+\S/.test(l) && norm(l).includes(key));
    if (idx < 0) return "not-found";
    /* 比较「现象」**与「结论」**两段（都去掉日期与历次标记）：
       现象相同 + 结论相同 ⇒ **又犯了一次**（就地记数）；
       现象相同但**结论不同** ⇒ **冲突/更新**（保留两条，旧的可回溯"当时是这么定的"）。
       ⛔ 只比现象是不够的 —— 那样"结论改了"会被判成"重复"、新结论直接丢掉（实测发现）。 */
    const partsOf = (s: string) => String(s).split("→");
    const phenOf = (s: string) => norm(partsOf(s)[0]).replace(/\d{4}\d{2}\d{2}/g, "").replace(/再次[^）]*/g, "").replace(/[⟳更新：]/g, "");
    const concOf = (s: string) => { const p = partsOf(s); return p.length > 1 ? norm(p.slice(1).join("→")) : ""; };
    const a = phenOf(lines[idx]);
    const b = phenOf(text);
    const samePhen = Boolean(a && b) && (a.includes(b) || b.includes(a));
    /* ⛔ 「一边有结论、一边没有」**不算冲突** —— 那只是"又提了一次、信息更少"，判成更新会白长一行
       （预检【102】的旧用例就是这种：首写有 `→ 结论`、重复那行没有）。只有**两边都有结论且不同**才算冲突。 */
    const ca = concOf(lines[idx]);
    const cb = concOf(text);
    if (!samePhen || (ca && cb && ca !== cb)) return "conflict";
    const stamp = new Date().toISOString().slice(0, 10);
    const seen = lines[idx].match(/（再次 [\d-]+/g) || [];
    if (lines[idx].includes(`（再次 ${stamp}`)) return "duplicate"; // 同一天记过就不再叠
    lines[idx] = `${lines[idx].replace(/\s*（再次 [^）]*）/g, "")}（再次 ${stamp}${seen.length ? `，第 ${seen.length + 2} 次` : ""}）`;
    await this.writeText(file, lines.join("\n"));
    return "duplicate";
  }

  /** 按粒度遗忘（10-17，P1-2）。三种粒度：
   *  ① `line`     —— 单条（按内容子串定位，最精确）；
   *  ② `key`      —— 主题（同一去重键的全部条目）；
   *  ③ `category` —— 整个分类。
   *  ⛔ **只从 lessons 移除**，不删文件、不碰 `logs/`（流水归日志，本来就该留）。
   *  ⛔ `corrections`（用户纠错）**只允许单条粒度** —— 防"按主题一把清掉全部纠错"（那是保护项）。
   *  返回移除的条数。 */
  async forgetLessons(workspace: string, target: { line?: string; key?: string; category?: string }): Promise<number> {
    const dir = this.projectDir(workspace);
    if (!dir) return 0;
    const want = String(target.line || "").trim();
    const key = String(target.key || "").trim();
    const cat = String(target.category || "").trim();
    if (!want && !key && !cat) return 0;
    const norm = (s: string) => String(s ?? "").replace(/[\s，。！？、,.!?:：；;""''（）()【】\[\]]/g, "");
    /* ⛔ 纠错类是**保护项**：只允许**单条**粒度（必须给 `line`）——
       防"按主题一把清掉全部纠错"（那正是当初把它单列一类的原因：注入最前、永不自动淘汰）。 */
    if (!want) {
      if (cat === CORRECTION_CATEGORY) return 0;
      if (key) {
        const corr = await this.readText(this.lessonFile(dir, CORRECTION_CATEGORY));
        if (corr && norm(corr).includes(key)) return 0;
      }
    }
    const files = cat ? [cat] : [CORRECTION_CATEGORY, PITFALL_CATEGORY, SOP_CATEGORY, PREFERENCE_CATEGORY];
    let removed = 0;
    for (const c of files) {
      const file = this.lessonFile(dir, c);
      const raw = await this.readText(file);
      if (!raw) continue;
      const lines = raw.split(/\r?\n/);
      const kept = lines.filter((l) => {
        if (!/^\s*[-*]\s+\S/.test(l)) return true;
        const hit = (want && l.includes(want)) || (key && norm(l).includes(key));
        if (hit) { removed += 1; return false; }
        return true;
      });
      if (kept.length !== lines.length) await this.writeText(file, kept.join("\n"));
    }
    return removed;
  }

  // ── L4 每日日志（logs/YYYY-MM-DD.md）─────────────────────────────  /** 自动捕获的唯一落点：往当天日志追加一行摘要 */
  async appendLog(workspace: string, summary: string): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir || !summary.trim()) return;
    await this.migrateLayout(dir);
    const file = path.join(this.logsDir(dir), `${today()}.md`);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const line = `\n## ${stamp}\n${summary.trim()}\n`;
    const existing = await this.readText(file);
    if (!existing.trim()) {
      await this.writeText(file, `# ${today()}\n${line}`);
      return;
    }
    await fs.appendFile(file, line, "utf8");
  }

  /** 日志日期（v2 在 `logs/`；迁移未完成时并上 `memory/` 根的旧日志，保证不丢） */
  private async listLogDates(dir: string): Promise<string[]> {
    const fresh = await this.listLogDatesIn(this.logsDir(dir));
    const legacy = await this.listLogDatesIn(dir);
    return [...new Set([...fresh, ...legacy])].sort();
  }

  /** 单日日志的落点：新位置优先，缺失时回落旧位置 */
  private async logFilePath(dir: string, date: string): Promise<string> {
    const fresh = path.join(this.logsDir(dir), `${date}.md`);
    if (await fs.access(fresh).then(() => true).catch(() => false)) return fresh;
    const legacy = path.join(dir, `${date}.md`);
    if (await fs.access(legacy).then(() => true).catch(() => false)) return legacy;
    return fresh;
  }

  /** 最近 N 天日志，供注入回灌（不回灌全部，否则上下文爆炸）。
   *  ⛔ 缺省天数取自**当前倍率下的预算**（logDays 本身不随倍率变，但口径统一从这里来）。 */
  async recentLogs(workspace: string | undefined, days?: number): Promise<{ date: string; text: string }[]> {
    const dir = this.projectDir(workspace);
    if (!dir) return [];
    await this.migrateLayout(dir);
    const dates = (await this.listLogDates(dir)).slice(-(days ?? this.budget.logDays));
    const out: { date: string; text: string }[] = [];
    for (const date of dates) {
      const text = await this.readText(await this.logFilePath(dir, date));
      if (text.trim()) out.push({ date, text });
    }
    return out;
  }

  /** 日志层（L4）字符总数 */
  private async logChars(dir: string | null): Promise<number> {
    if (!dir) return 0;
    let total = 0;
    for (const date of await this.listLogDates(dir)) total += (await this.readText(await this.logFilePath(dir, date))).length;
    return total;
  }

  /** 某子目录下 .md 的字符总数（L5 月卷 / L6 冷存档的水位；目录不存在 = 0） */
  private async dirChars(dir: string | null, sub: string): Promise<number> {
    if (!dir) return 0;
    let total = 0;
    try {
      for (const entry of await fs.readdir(path.join(dir, sub), { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        total += (await this.readText(path.join(dir, sub, entry.name))).length;
      }
    } catch { /* 目录不存在 = 0 */ }
    return total;
  }

  /** 金字塔各层当前用量（水位判定 + 设置页展示）。L7 碎片池由 MemoryStore 管，这里不统计。 */
  async layerUsage(workspace?: string): Promise<Partial<Record<PyramidLayerId, number>>> {
    const dir = this.projectDir(workspace);
    return {
      L0: (await this.readUser()).length,
      L1: dir ? (await this.readProject(workspace)).length : 0,
      L2: dir ? (await this.readLessons(workspace)).length : 0,
      L3: dir ? (await this.readBackground(workspace)).length : 0,
      L4: await this.logChars(dir),
      L5: await this.dirChars(dir, ROLLUP_DIR),
      L6: await this.dirChars(dir, ARCHIVE_DIR),
      L7: 0,
    };
  }

  /**
   * 水位提示：只列**已达 90% 蒸馏线**的层（平时返回空串，不占 token）。
   * 这是「引擎自己知道什么时候该蒸馏」的唯一通道 —— 它每轮都随常驻记忆注入。
   */
  async watermarkHint(workspace?: string): Promise<string> {
    const [statuses, pending] = await Promise.all([
      this.layerUsage(workspace).then((used) => layerWatermarks(used, this.scale)),
      this.pickDistill(workspace),
    ]);
    const hot = statuses.filter((s) => s.needDistill);
    if (!hot.length) return "";
    const lines = hot.map((s) => {
      const pct = Math.round((s.ratio ?? 0) * 100);
      /* ③ L1 压缩没有本地自动执行（用户数据不代删）：明确指给引擎 —— 由它直接编辑文件合并同主题 */
      const how = s.id === "L1" ? "（L1 压缩由**你**执行：直接编辑 project/MEMORY.md，合并同主题、删过时条目；本地不代删用户数据）" : "";
      return `- ${s.id} ${s.name} 已到 ${pct}%（${s.used}/${s.budget} 字）⇒ 蒸馏去向：${s.sink}${how}`;
    });
    return [
      "[Harness 记忆水位 · ⚠️ 已达 90% 蒸馏线，先蒸馏再继续干活]",
      ...lines,
      pending ? `（已为你备好待蒸馏的日志：${pending.dates.length} 天 / ${pending.chars} 字；本地蒸馏入口见指令第 9 条）` : "（先把该层压缩，再继续当前任务）",
    ].join("\n");
  }

  // ── 整洁与清理（记忆管理面用的动作；规则见 electron/memory-hygiene.ts） ──
  /** L6 冷存档概况（整洁报告用）。冷存档不参与注入，只被统计与清空。 */
  async archiveStats(workspace?: string): Promise<{ files: number; bytes: number }> {
    const dir = this.projectDir(workspace);
    if (!dir) return { files: 0, bytes: 0 };
    const archive = this.archiveDir(dir);
    let files = 0;
    let bytes = 0;
    try {
      for (const entry of await fs.readdir(archive, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        files += 1;
        bytes += (await this.readText(path.join(archive, entry.name))).length;
      }
    } catch { /* 不存在 = 0 */ }
    return { files, bytes };
  }

  /** 清理留痕：追加一行到 pruned.jsonl（与碎片池淘汰同一份账，事后可查） */
  private async tracePrune(workspace: string, entry: Record<string, unknown>): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir) return;
    try { await fs.appendFile(path.join(dir, "pruned.jsonl"), `${JSON.stringify({ at: Date.now(), ...entry })}\n`, "utf8"); }
    catch { /* 留痕失败不阻塞动作 */ }
  }

  /**
   * 清空 L6 冷存档 —— **用户显式决定**的动作（调用方必须已拿到二次确认，IPC 层强校验）。
   * ⛔ 这是唯一允许"真删"的地方：冷存档不参与注入，清掉只影响回溯能力 ⇒ 必须先告知用户不可回溯。
   */
  async purgeArchive(workspace?: string): Promise<{ removed: number; bytes: number }> {
    const dir = this.projectDir(workspace);
    if (!dir || !workspace) return { removed: 0, bytes: 0 };
    const stats = await this.archiveStats(workspace);
    try { await fs.rm(this.archiveDir(dir), { recursive: true, force: true }); }
    catch { /* 已不存在 */ }
    await this.tracePrune(workspace, { action: "purge-archive", files: stats.files, bytes: stats.bytes });
    return { removed: stats.files, bytes: stats.bytes };
  }

  /**
   * 整理纪律格式（**无损**）：行尾空白、连续空行折叠、补末尾换行。
   * ⛔ 只动空白，不改写任何内容、不增删条目 —— 语义层面的问题由 `lintLessonLines` **报告**，
   *    改不改、怎么改由用户/引擎决定（自动改写纪律文本可能改掉语义，风险太高）。
   */
  async tidyLessons(workspace?: string): Promise<{ files: number; changed: number }> {
    const dir = this.projectDir(workspace);
    if (!dir) return { files: 0, changed: 0 };
    await this.migrateLayout(dir);
    let files = 0;
    let changed = 0;
    const targets = [...Object.keys(LESSON_FILES).map((category) => this.lessonFile(dir, category)), path.join(this.lessonsDir(dir), LESSON_MISC_FILE)];
    for (const file of targets) {
      const before = await this.readText(file);
      if (!before.trim()) continue;
      files += 1;
      const normalized = `${before
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\s*$/, "")}\n`;
      if (normalized !== before) {
        await this.writeText(file, normalized);
        changed += 1;
      }
    }
    return { files, changed };
  }

  // ── 注入上下文 ─────────────────────────────────────────────────
  /** 拼装常驻记忆块：L1.5 坑与纪律（最前）+ L0 + L1 常驻，L2 只回灌最近 3 天 */
  async context(workspace?: string, includeWorkspace = true): Promise<{ text: string; stats: { chars: number; over: boolean } }> {
    /* 按当前倍率取一次预算（⛔ 全函数共用一个局部变量 —— 到处各读一次必然漏掉某一处）。 */
    const budget = this.budget;
    const userRaw = (await this.readUser()).trim();
    const backgroundRaw = includeWorkspace ? (await this.readBackground(workspace)).trim() : "";
    const projectRaw = includeWorkspace ? (await this.readProject(workspace)).trim() : "";
    const lessonsRaw = includeWorkspace ? (await this.readLessons(workspace)).trim() : "";
    const user = clamp(userRaw, budget.user);
    const background = clamp(backgroundRaw, budget.background);
    const project = clamp(projectRaw, budget.project);
    /* 注入前按分类重排（**纠错最前**）；⛔ 只重排注入文本，磁盘上的顺序不动（用户的手工组织不被覆盖） */
    const lessons = clamp(includeWorkspace && lessonsRaw ? sortLessonSections(lessonsRaw) : "", budget.lessons);
    const logs = includeWorkspace ? await this.recentLogs(workspace) : [];

    const blocks: string[] = [];
    /* 截断标记（④ 注入不静默丢内容）：哪层被钳了多少字，直接告诉引擎 —— 它不知道自己在盲区 = 最危险 */
    const clipped = (label: string, cut: number) => `\n> ⛔ 「${label}」超出预算被截断 ${cut} 字 —— 以上不是全部内容。先蒸馏该层（指令第 9 条）再干活，否则你在盲区里。`;
    /* ⛔ 坑与纪律放最前：它是最容易被反复踩的东西，比背景/档案更该被先读到 */
    if (lessons.text) blocks.push(`## 踩坑与纪律（必须遵守，别再犯）${lessons.cut ? clipped("踩坑与纪律", lessons.cut) : ""}\n${lessons.text}`);
    if (user.text) blocks.push(`## 用户档案${user.cut ? clipped("用户档案", user.cut) : ""}\n${user.text}`);
    if (background.text) blocks.push(`## 项目背景${background.cut ? clipped("项目背景", background.cut) : ""}\n${background.text}`);
    if (project.text) blocks.push(`## 项目记忆${project.cut ? clipped("项目记忆", project.cut) : ""}\n${project.text}`);
    if (logs.length) {
      /* ⛔⛔ 日志段单独占预算（2026-10-10 修「记忆很快被占满」）：原来这段**没有任何上限**，
         它把前四层之外的剩余字符全吃掉，再被下面的 `body.slice(0, total)` 一刀切 ——
         而日志拼在**最后**，于是每轮被砍掉的恰好是日志（用户症状：容量小、很快占满）。
         现在：先量出前四层实际占了多少，剩下的（且不超过 MEMORY_BUDGET.logs）才给日志；
         日志内部**按天从最旧开始丢**（recentLogs 是日期升序 = 最旧在前，故从尾往前装）
         —— ⛔ 不按字符砍尾：那会把某一天切成半截，读起来像文件损坏。 */
      const room = Math.max(0, Math.min(budget.logs, budget.total - blocks.join("\n\n").length));
      const kept: string[] = [];
      let used = 0;
      for (let i = logs.length - 1; i >= 0; i -= 1) {
        const trimmed = clamp(logs[i].text, budget.logPerDay);
        const block = `### ${logs[i].date}${trimmed.cut ? clipped(`${logs[i].date} 日志`, trimmed.cut) : ""}\n${trimmed.text}`;
        /* ⛔ 至少留一天（单天已被 logPerDay 钳过，不会超 room）—— 否则日志段整段消失，
           那正是修复前的老症状。 */
        if (kept.length && used + block.length > room) break;
        kept.unshift(block);
        used += block.length;
      }
      if (kept.length) {
        const dropped = logs.length - kept.length;
        const note = dropped > 0
          ? `\n> ⛔ 更早的 ${dropped} 天日志本轮未注入（日志段预算 ${budget.logs} 字）—— 原文仍在 logs/ 里，需要时直接读。`
          : "";
        blocks.push(`## 近期工作日志（最近 ${kept.length} 天）\n${kept.join("\n\n")}${note}`);
      }
    }
    /* 水位提示：只在某层到 90% 线时才非空 —— 引擎据此自己决定"先蒸馏再干活"。
       ⛔ 必须放在 [Harness 常驻记忆 …] 标记**之内**：这段是注入给引擎的，不是给用户看的，
          显示侧按标记对整段剥离（user-refs.ts），放外面会漏进用户气泡。 */
    const hint = includeWorkspace ? await this.watermarkHint(workspace) : "";
    if (!blocks.length) return hint ? { text: `\n\n[Harness 常驻记忆]\n${hint}\n[常驻记忆结束]\n`, stats: { chars: hint.length, over: true } } : { text: "", stats: { chars: 0, over: false } };

    let body = blocks.join("\n\n");
    const over = lessons.over || user.over || background.over || project.over || body.length > budget.total || Boolean(hint);
    /* ⛔ 兜底（正常不会触发：各层与日志段都已按各自预算 clamp ⇒ 四层之和 + logs 恒 ≤ total）。
       真触发说明**预算配置不自洽**了 —— 提示必须指向这一点，别含糊说"尾部被截断"，
       否则下次又会被当成"容量不够"去调大 total（该修的是不自洽本身）。 */
    if (body.length > budget.total) body = `${body.slice(0, budget.total).trimEnd()}\n\n> ⛔ 常驻记忆仍超出总预算 ${body.length - budget.total} 字（各层都已按预算钳制 ⇒ 是预算配置不自洽）。先蒸馏（指令第 9 条）再干活。`;
    const tail = hint ? `\n\n${hint}` : "";
    return { text: `\n\n[Harness 常驻记忆 · 以下为已确认的长期上下文，与当前请求冲突时以当前请求为准]\n${body}${tail}\n[常驻记忆结束]\n`, stats: { chars: body.length + hint.length, over } };
  }

  // ── 蒸馏 ──────────────────────────────────────────────────────
  private stateFile(workspace: string): string | null {
    const dir = this.projectDir(workspace);
    return dir ? path.join(dir, ".distill-state.json") : null;
  }

  private async readState(workspace: string): Promise<{ lastDistillAt?: number }> {
    const file = this.stateFile(workspace);
    if (!file) return {};
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch { return {}; }
  }

  private async writeState(workspace: string, state: { lastDistillAt?: number }): Promise<void> {
    const file = this.stateFile(workspace);
    if (!file) return;
    await this.writeText(file, JSON.stringify(state, null, 2));
  }

  /** 挑出待蒸馏的日志，打包成待蒸馏文本（不调模型）。附上现有坑清单，保证蒸馏时不被丢。
   *  两个触发之一：① 日志满 30 天（年龄）② **L4 已到 90% 水位**（用户 09-22 要求：满了就压）
   *  —— 水位触发时取**最老的一半**，给近处上下文留一半（否则刚聊完就被压掉）。 */
  async pickDistill(workspace?: string): Promise<DistillPick | null> {
    const dir = this.projectDir(workspace);
    if (!dir) return null;
    const base = today();
    const all = await this.listLogDates(dir);
    let trigger: DistillPick["trigger"] = "age";
    let dates = all.filter((date) => daysBetween(date, base) >= DISTILL_AFTER_DAYS);
    if (!dates.length) {
      const logBudget = this.budget.logPerDay * this.budget.logDays;
      const used = await this.logChars(dir);
      if (all.length >= 4 && logBudget > 0 && used / logBudget >= MEMORY_DISTILL_THRESHOLD) {
        dates = all.slice(0, Math.ceil(all.length / 2));
        trigger = "watermark";
      }
    }
    if (!dates.length) return null;
    const chunks: string[] = [];
    for (const date of dates) {
      const text = (await this.readText(await this.logFilePath(dir, date))).trim();
      if (text) chunks.push(`# ${date}\n${text}`);
    }
    const lessons = (await this.readLessons(workspace)).trim();
    if (lessons) chunks.push(`# 现有纪律与记忆（lessons/*.md，蒸馏后必须完整保留，「用户纠错」一条不许丢）\n${lessons}`);
    const text = chunks.join("\n\n");
    if (text.length < DISTILL_MIN_CHARS) return null;
    return { dates, text, chars: text.length, trigger };
  }

  /**
   * 执行蒸馏：把提炼结果追加进 L1，原文移入 archive/。
   * summarize 由调用方注入（主进程用一次性 codex 会话实现），本模块不依赖模型。
   */
  async distill(workspace: string, summarize: (prompt: string, body: string) => Promise<string>, force = false): Promise<DistillResult> {
    const dir = this.projectDir(workspace);
    if (!dir) return { ok: false, dates: [], added: 0, reason: "尚未选择工作区" };
    await this.migrateLayout(dir);
    const pick = await this.pickDistill(workspace);
    if (!pick) return { ok: false, dates: [], added: 0, reason: "没有需要蒸馏的日志" };
    if (!force) {
      const state = await this.readState(workspace);
      if (state.lastDistillAt && Date.now() - state.lastDistillAt < AUTO_DISTILL_INTERVAL_MS) {
        return { ok: false, dates: pick.dates, added: 0, reason: "距上次蒸馏不足 6 小时，已跳过" };
      }
    }

    const summary = (await summarize(DISTILL_PROMPT, pick.text)).trim();
    if (!summary) return { ok: false, dates: pick.dates, added: 0, reason: "模型没有返回提炼结果" };

    /* 两段式切分：核心 → L1 项目宪法；纪要 → L5 月度卷宗（模型漏标题时退回单段，内容不丢） */
    const split = splitDistill(summary);

    const memoryFile = this.projectFile(dir);
    const existing = (await this.readText(memoryFile)).trim();
    const section = `## 蒸馏 ${today()}${pick.trigger === "watermark" ? "（水位触发）" : ""}\n${split.core}\n`;
    await this.writeText(memoryFile, existing ? `${existing}\n\n${section}` : `# 项目记忆\n\n${section}`);

    /* L5 月度卷宗：比日志短、比 L1 细；给后续蒸馏当输入，也给回溯留痕（**不进每轮注入**） */
    let rollupRel: string | undefined;
    if (split.digest) {
      const month = (pick.dates[pick.dates.length - 1] ?? today()).slice(0, 7);
      const rollupFile = path.join(this.rollupDir(dir), `${month}.md`);
      const before = (await this.readText(rollupFile)).trim();
      const entry = `\n## ${today()} 蒸馏（覆盖 ${pick.dates[0]} ~ ${pick.dates[pick.dates.length - 1]}）\n${split.digest}\n`;
      await this.writeText(rollupFile, `${before || `# ${month} 月度卷宗`}\n${entry}`);
      rollupRel = `${ROLLUP_DIR}/${month}.md`;
    }

    // 原文归档（L6 冷存档）：移动而非删除，蒸馏失败也可回溯
    const archiveDir = this.archiveDir(dir);
    await fs.mkdir(archiveDir, { recursive: true });
    for (const date of pick.dates) {
      const from = await this.logFilePath(dir, date);
      const to = path.join(archiveDir, `${date}.md`);
      try { await fs.rename(from, to); }
      catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    await this.writeState(workspace, { lastDistillAt: Date.now() });
    return { ok: true, dates: pick.dates, added: split.core.length, trigger: pick.trigger, rollup: rollupRel };
  }

  /** 会话结束时调用：节流 + 全异常兜底，绝不影响主流程。
   *  ② 先试 L4 日志蒸馏；没触发（未满 30 天/未满水位/节流）再试 L5 月卷下沉 —— 八层表里
   *  「L5 满了沉 L1」从此有**执行者**，不再只是纸面规则。 */
  async autoDistill(workspace: string | undefined, summarize: (prompt: string, body: string) => Promise<string>): Promise<DistillResult | null> {
    if (!workspace) return null;
    try {
      const logs = await this.distill(workspace, summarize);
      if (logs.ok) return logs;
    } catch { /* 落到 L5 下沉再试 */ }
    try { return await this.distillRollup(workspace, summarize); }
    catch { return null; }
  }

  /** ② L5 → L1 下沉：月卷总量到 90% 线时，把**最老**一个月卷提炼进 L1。
   *  月卷原文**保留**（L5 比 L1 细，回溯仍需要；L1 自身的压缩由引擎按水位提示执行）。 */
  async distillRollup(workspace: string, summarize: (prompt: string, body: string) => Promise<string>): Promise<DistillResult> {
    const dir = this.projectDir(workspace);
    if (!dir) return { ok: false, dates: [], added: 0, reason: "尚未选择工作区" };
    const state = await this.readState(workspace);
    if (state.lastDistillAt && Date.now() - state.lastDistillAt < AUTO_DISTILL_INTERVAL_MS) {
      return { ok: false, dates: [], added: 0, reason: "距上次蒸馏不足 6 小时，已跳过" };
    }
    const rollupDir = this.rollupDir(dir);
    const months = (await this.listRollupMonths(rollupDir)).sort();
    if (!months.length) return { ok: false, dates: [], added: 0, reason: "没有月度卷宗" };
    const total = (await this.dirChars(dir, ROLLUP_DIR)) || 0;
    if (total < ROLLUP_BUDGET * MEMORY_DISTILL_THRESHOLD) {
      return { ok: false, dates: [], added: 0, reason: `月卷水位未到（${total}/${ROLLUP_BUDGET}）` };
    }
    const month = months[0];
    const text = (await this.readText(path.join(rollupDir, `${month}.md`))).trim();
    if (text.length < DISTILL_MIN_CHARS) return { ok: false, dates: [month], added: 0, reason: "最老月卷太短，不值得蒸" };

    const summary = (await summarize(DISTILL_PROMPT, text)).trim();
    if (!summary) return { ok: false, dates: [month], added: 0, reason: "模型没有返回提炼结果" };
    const split = splitDistill(summary);
    /* 沉 L1：核心 + 纪要都进项目宪法（月卷在此层的作用就是被蒸馏），标注来源月 */
    const memoryFile = this.projectFile(dir);
    const existing = (await this.readText(memoryFile)).trim();
    const section = `## 蒸馏 ${today()}（L5 月卷下沉：${month}）\n${split.core}${split.digest ? `\n\n${split.digest}` : ""}\n`;
    await this.writeText(memoryFile, existing ? `${existing}\n\n${section}` : `# 项目记忆\n\n${section}`);
    await this.writeState(workspace, { lastDistillAt: Date.now() });
    return { ok: true, dates: [month], added: split.core.length + (split.digest?.length ?? 0), trigger: "watermark", rollup: `${ROLLUP_DIR}/${month}.md` };
  }

  /** 列出 rollups/ 下已有月卷（YYYY-MM），目录不存在 = 空 */
  private async listRollupMonths(rollupDir: string): Promise<string[]> {
    try {
      return (await fs.readdir(rollupDir)).filter((name) => /^\d{4}-\d{2}\.md$/.test(name)).map((name) => name.replace(/\.md$/, ""));
    } catch { return []; }
  }

  // ── 设置页快照 ─────────────────────────────────────────────────
  async snapshot(workspace?: string): Promise<MemoryLayersSnapshot> {
    const budget = this.budget;   // 按当前倍率（水位与 over 判定都要用它）
    const dir = this.projectDir(workspace);
    const user = await this.readUser();
    const background = await this.readBackground(workspace);
    const project = await this.readProject(workspace);
    const lessons = await this.readLessons(workspace);
    const logs = dir ? await this.listLogDates(dir) : [];
    const logStats = dir
      ? await Promise.all(logs.slice(-7).map(async (date) => ({ date, chars: (await this.readText(path.join(dir, `${date}.md`))).length })))
      : [];
    const pending = dir ? await this.pickDistill(workspace) : null;
    const logsChars = logStats.reduce((sum, entry) => sum + entry.chars, 0);
    const lessonsChars = lessons.length;
    const total = user.length + background.length + project.length + lessonsChars + logsChars;
    return {
      user,
      background,
      project,
      lessons,
      hasWorkspace: Boolean(dir),
      paths: {
        user: this.userFile,
        projectDir: dir ?? "",
        background: dir ? this.backgroundFile(dir) : "",
        project: dir ? this.projectFile(dir) : "",
        lessons: dir ? this.lessonsDir(dir) : "",
        logDir: dir ? this.logsDir(dir) : "",
      },
      logs: logStats,
      budget: {
        user: user.length,
        background: background.length,
        project: project.length,
        lessons: lessonsChars,
        logs: logsChars,
        total,
        over: user.length > budget.user || background.length > budget.background || project.length > budget.project || lessonsChars > budget.lessons || total > budget.total,
      },
      /* 金字塔八层水位（needDistill = 已达 90% 线）—— 设置页据此展示漏斗与"该蒸馏了"
         ⛔ 必须带当前倍率：容量放大后水位条若还按基准预算画，会出现"没用多少却报 95%"的假警报。 */
      layers: layerWatermarks(await this.layerUsage(workspace), this.scale),
      /* 纪律与坑的分类计数（纠错单独一类，用户 09-22 要求） */
      lessonGroups: groupLessonSections(lessons),
      pendingDistill: { dates: pending?.dates ?? [], chars: pending?.chars ?? 0 },
      lastDistillAt: workspace ? (await this.readState(workspace)).lastDistillAt : undefined,
    };
  }
}
