// ponytail 技能包开关：写代码模式开 = defaultMode full（钩子注入精简工程规则）；
// 关 = off（钩子直接跳过，零耗时零注入）。读写 ponytail 官方配置文件。
// ⛔ 缺省一律 off（10-01 用户令）：配置文件不存在/读不了 = 关，不许回退 full ——
//   回退 full 会让"关掉写代码模式"的用户重启后被启动自愈重新拉开。
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
    return String(raw.defaultMode ?? "off");
  } catch {
    return "off";
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
