import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** RPA 配方：记录一次跑通的自动化流程，供下次一键复用 */
export type RpaRecipe = {
  id: string;
  name: string;
  desc: string;
  /** 触发方式：浏览器 / 桌面 / 混合 */
  kind: "browser" | "desktop" | "mixed";
  /** 自动化步骤描述（人话，引擎据此复现） */
  steps: string[];
  /** 目标 URL / 目标应用（可选） */
  target: string;
  workspace?: string;
  /** 复用次数 */
  runCount: number;
  /** 最近运行状态 */
  lastStatus?: "ok" | "failed";
  lastError?: string;
  createdAt: number;
  updatedAt: number;
};

/** 任务清单项 */
export type TaskItem = {
  id: string;
  text: string;
  status: "todo" | "doing" | "done";
  priority: "low" | "medium" | "high";
  createdAt: number;
  updatedAt: number;
};

export class RpaStore {
  private recipes: RpaRecipe[] = [];
  private tasks: TaskItem[] = [];
  private loaded = false;

  constructor(
    private readonly recipeFile: string,
    private readonly taskFile: string,
  ) {}

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try { this.recipes = JSON.parse(await fs.readFile(this.recipeFile, "utf8")); } catch {}
    try { this.tasks = JSON.parse(await fs.readFile(this.taskFile, "utf8")); } catch {}
  }

  // ── RPA 配方 ──
  async listRecipes() { await this.load(); return this.recipes.sort((a, b) => b.updatedAt - a.updatedAt); }

  async saveRecipe(input: Partial<RpaRecipe> & Pick<RpaRecipe, "name" | "steps">) {
    await this.load();
    const now = Date.now();
    const existing = input.id ? this.recipes.find((r) => r.id === input.id) : undefined;
    const recipe: RpaRecipe = {
      id: existing?.id ?? input.id ?? randomUUID(),
      name: input.name.trim(),
      desc: input.desc?.trim() ?? "",
      kind: input.kind ?? "mixed",
      steps: (input.steps ?? []).map((x) => String(x).trim()).filter(Boolean),
      target: input.target?.trim() ?? "",
      workspace: input.workspace,
      runCount: existing?.runCount ?? 0,
      lastStatus: existing?.lastStatus,
      lastError: existing?.lastError,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (!recipe.name || !recipe.steps.length) throw new Error("RPA 配方需要名称和至少一个步骤");
    this.recipes = existing ? this.recipes.map((r) => r.id === recipe.id ? recipe : r) : [recipe, ...this.recipes];
    await this.save();
    return recipe;
  }

  async deleteRecipe(id: string) {
    await this.load();
    this.recipes = this.recipes.filter((r) => r.id !== id);
    await this.save();
  }

  async recordRun(id: string, ok: boolean, error?: string) {
    await this.load();
    const r = this.recipes.find((x) => x.id === id);
    if (!r) return;
    r.runCount += 1;
    r.lastStatus = ok ? "ok" : "failed";
    r.lastError = ok ? undefined : error;
    r.updatedAt = Date.now();
    await this.save();
  }

  // ── 任务清单 ──
  async listTasks() { await this.load(); return this.tasks.sort((a, b) => b.updatedAt - a.updatedAt); }

  async addTask(input: { text: string; priority?: TaskItem["priority"] }) {
    await this.load();
    const now = Date.now();
    const task: TaskItem = { id: randomUUID(), text: input.text.trim(), priority: input.priority ?? "medium", status: "todo", createdAt: now, updatedAt: now };
    if (!task.text) throw new Error("任务内容不能为空");
    this.tasks = [task, ...this.tasks];
    await this.save();
    return task;
  }

  async updateTask(id: string, patch: Partial<Pick<TaskItem, "status" | "priority" | "text">>) {
    await this.load();
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error("任务不存在");
    Object.assign(t, patch, { updatedAt: Date.now() });
    await this.save();
    return t;
  }

  async deleteTask(id: string) {
    await this.load();
    this.tasks = this.tasks.filter((t) => t.id !== id);
    await this.save();
  }

  private async save() {
    await Promise.all([
      fs.writeFile(this.recipeFile, JSON.stringify(this.recipes, null, 2), "utf8"),
      fs.writeFile(this.taskFile, JSON.stringify(this.tasks, null, 2), "utf8"),
    ]);
  }
}
