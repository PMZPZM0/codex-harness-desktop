/**
 * `npm run scan:config` —— 配置面安全扫描的完整报告（给人看）。
 *
 * 与预检【86】的关系：**同一套规则**。预检在每次构建时跑它并只硬断言"我们再引入的内容"
 * （内置技能）零 critical/high；这里出完整报告，把用户侧技能与配置里的命中也都列出来。
 *
 * 退出码：存在 critical 或 high 时为 1（便于挂到 CI 或本地 pre-push）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { selfTest, scanWorkspace, defaultUserDataDir } from "./lib/config-scan.mjs";

const root = process.cwd();
const userData = defaultUserDataDir({ homedir: os.homedir() });

console.log("配置面安全扫描（技能内容 / MCP 配置 / 明文密钥）");
console.log("  仓库根: " + root);
console.log("  用户数据: " + (userData || "(推导不到，跳过用户侧)"));
console.log("");

const st = selfTest();
console.log("扫描器自证: " + (st.ok ? "✓ 通过（正例必中；良性文本不被报成 critical/high）" : "✗ 失败"));
st.failures.forEach((f) => console.log("  ✗ " + f));
console.log("");

const { findings, scanned } = scanWorkspace({ root, userData, fs, path });
console.log("扫描目标 " + scanned.length + " 个 · 命中 " + findings.length + " 条");
console.log("");

const order = ["critical", "high", "medium"];
let hard = 0;
for (const severity of order) {
  const list = findings.filter((f) => f.severity === severity);
  if (!list.length) { console.log("── " + severity + ": 0 条"); continue; }
  if (severity !== "medium") hard += list.length;
  console.log("── " + severity + ": " + list.length + " 条");
  for (const f of list) {
    console.log("   [" + f.ruleId + "] " + f.source + ":" + f.line);
    console.log("      " + f.label);
    console.log("      " + f.excerpt);
  }
}
console.log("");
console.log(hard ? "结论：有 " + hard + " 条 critical/high —— 需要人看（退出码 1）" : "结论：零 critical / 零 high");
process.exit(hard ? 1 : 0);
