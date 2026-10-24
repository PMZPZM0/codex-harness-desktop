/**
 * 创世 boss · 群编排 —— 落盘（`<userData>/boss-groups.json`）
 *
 * ⛔ 与 delegate-threads.json / team-threads.json 同一路子：内存态 + 合并写（120ms），
 *    群规模是个位数量级，别提前上 sqlite。真到上千条任务再迁（写在这里是为了下次有人想迁时先看到这句话）。
 * ⛔ 写盘必须**原子**（tmp + rename）：这文件里装着"谁被打回、谁被锁"，写坏了等于制度失效。
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { emptyState } from "./state";
import type { BossState } from "./types";

export class BossGroupStore {
  private file = "";
  private state: BossState = emptyState();
  private timer: NodeJS.Timeout | null = null;
  private loaded = false;

  private resolveFile(): string {
    // ⛔ 惰性求值：本模块可能在 app.setPath 之前被 import（记忆里的 91 号坑），
    //    路径必须在**第一次读写时**才算，不能写成模块级常量。
    if (!this.file) this.file = path.join(app.getPath("userData"), "boss-groups.json");
    return this.file;
  }

  async load(): Promise<BossState> {
    if (this.loaded) return this.state;
    try {
      const raw = await fs.readFile(this.resolveFile(), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && parsed.groups && parsed.tasks) {
        this.state = parsed as BossState;
        if (!Array.isArray(this.state.events)) this.state.events = [];
      }
    } catch { /* 文件不存在 / 损坏：从空账本开始（群丢了比启动不了好） */ }
    this.loaded = true;
    return this.state;
  }

  get(): BossState {
    return this.state;
  }

  /** 合并写：任何一次状态变更后调它，120ms 内的多次变更只落一次盘。 */
  save(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 120);
  }

  async flush(): Promise<void> {
    const file = this.resolveFile();
    const body = JSON.stringify(this.state, null, 2);
    const tmp = `${file}.tmp`;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, file);
    } catch (error: any) {
      console.warn("[boss-groups] 落盘失败：", String(error?.message ?? error).slice(0, 200));
    }
  }

  /** 改动 + 落盘一步到位（调用方只关心"改完了"）。 */
  mutate<T>(fn: (state: BossState) => T): T {
    const result = fn(this.state);
    this.save();
    return result;
  }
}

export const bossStore = new BossGroupStore();
