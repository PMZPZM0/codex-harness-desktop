// ponytail 技能包开关：写代码模式开 = defaultMode full（钩子注入精简工程规则）；
// 关 = off（钩子直接跳过，零耗时零注入）。读写 ponytail 官方配置文件。
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function configPath() {
  const xdg = process.env.XDG_CONFIG_HOME;
  return path.join(xdg || path.join(os.homedir(), ".config"), "ponytail", "config.json");
}

export async function getPonytailMode(): Promise<string> {
  try {
    const raw = JSON.parse(await fs.readFile(configPath(), "utf8"));
    return String(raw.defaultMode ?? "full");
  } catch {
    return "full";
  }
}

export async function setPonytailMode(mode: "off" | "lite" | "full" | "ultra"): Promise<void> {
  const file = configPath();
  let raw: any = {};
  try { raw = JSON.parse(await fs.readFile(file, "utf8")); } catch { /* 首次 */ }
  raw.defaultMode = mode;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(raw, null, 2), "utf8");
}
