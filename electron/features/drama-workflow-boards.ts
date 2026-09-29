/**
 * drama-workflow-boards（09-29「打通」）：画布快照镜像的读写帮手。
 * 数据源 = 渲染层防抖推的 drama-canvas:board-sync（存 userData/drama-canvas/boards.json）；
 * workflow_read / workflow_writeback 两个真工具在这里读写。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

export function boardsFileOf(): string {
  return path.join(app.getPath("userData"), "drama-canvas", "boards.json");
}

export async function readWorkflowBoards(): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(boardsFileOf(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeWorkflowBoards(all: Record<string, unknown>): Promise<void> {
  const file = boardsFileOf();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(all, null, 2), "utf8");
}
