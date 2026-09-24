/**
 * main 的「maintenance」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import os from "node:os";
import fs from "node:fs/promises";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, watch as watchFs, writeFileSync, type Dirent } from "node:fs";
import path from "node:path";
import { applySessionsBackup, backupFromRolloutFile, buildMarkdownExport, buildSessionsBackup, buildThreadPreview, parseMarkdownConversation, BACKUP_FORMAT, BACKUP_VERSION } from "../thread-backup";
import { codexHome } from "../runtime-paths";
/**
 * 该上游是否指向「本机 / 内网」的自建推理服务。
 *
 * ⛔ 为什么需要它（09-19 代码审查发现的真 bug）：保存逻辑会把「没有密钥的第三方供应商」
 *   强制存成**禁用**（那是为了「首次安装不要默认启用」）。但**本地模型服务（Ollama /
 *   LM Studio / vLLM / llama.cpp）本来就不需要 Key** —— 于是用户配好本地模型、保存，
 *   供应商却是停用状态，发消息毫无反应，且看不出为什么。
 *   这里把 loopback 与私网地址识别出来，这类上游允许「无 Key 且启用」。
 *
 * 判定范围：loopback（127.0.0.1 / localhost / ::1 / 0.0.0.0）+ RFC1918 私网
 *   （10./172.16-31./192.168.）—— 内网自建推理是常见部署形态。
 *   ⚠️ 解析失败就返回 false（宁可保守：把需要 Key 的网关误当本地服务只会多一次 401；
 *      反过来却会让本地用户完全摸不着头脑）。
 */


export function classifyProbeError(error: any): string {
  const message = String(error?.message ?? error);
  if (error?.name === "TimeoutError" || error?.name === "AbortError" || /timeout|aborted/i.test(message)) return "连接超时（服务器长时间无响应）";
  if (error?.code === "ENOTFOUND" || /getaddrinfo|ENOTFOUND/i.test(message)) return "域名解析失败（检查 Base URL）";
  if (error?.code === "ECONNREFUSED" || /ECONNREFUSED/i.test(message)) return "连接被拒绝（服务未启动或端口不对）";
  return message;
}

// ── 旧家 rollout 迁移（09-18 用户：「更新新版本…用户旧会话要能接着用」「复制ID，接力会话也不行」）──
// 09-10 之前的老版本把引擎 CODEX_HOME 指在用户主目录 ~/.codex；现行版本为隔离切到
// userData/codex-home。升级后老会话 rollout 留在旧家 ⇒ 三处全部失联：侧栏 thread/list 兜底扫描
// 只扫新家、复制 ID 引用（buildThreadPreview 只扫新家）、thread/resume（引擎 CODEX_HOME=新家）。
// 修法：把旧家 sessions/ 与 archived_sessions/ 里**新家没有的** rollout **拷贝**进新家——
// ⛔ 只拷不删：~/.codex 可能仍被官方 Codex CLI 使用；文件名是 canonical 的
// rollout-<ts>-<uuid>.jsonl（resume 对文件名有硬要求），同名即同会话，按名判重天然幂等；
// 拷完 rollout 兜底扫描立即可见，resume / 复制 ID 引用随之恢复。
export async function migrateLegacyRolloutHome(): Promise<void> {
  // ⛔ 独立实例开关（09-22）：设 CODEX_HARNESS_NO_MIGRATE=1 ⇒ 不迁旧会话，保证崭新形态。
  //   场景：试运行/演示要用全新数据目录（CODEX_HARNESS_USER_DATA 指到别处），若仍触发本迁移
  //   会把 ~/.codex 的老会话拷进来 ⇒「崭新应用怎么还有记录」。正常用户（升级接力）不受影响。
  if (process.env.CODEX_HARNESS_NO_MIGRATE === "1") return;
  const legacyHome = path.join(os.homedir(), ".codex");
  const roots: { from: string; to: string }[] = [
    { from: path.join(legacyHome, "sessions"), to: path.join(codexHome, "sessions") },
    { from: path.join(legacyHome, "archived_sessions"), to: path.join(codexHome, "archived_sessions") },
  ];
  let copied = 0;
  for (const { from, to } of roots) {
    if (!existsSync(from)) continue;
    const stack = [from];
    while (stack.length) {
      const current = stack.pop()!;
      let entries: Dirent[];
      try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) { stack.push(abs); continue; }
        if (!entry.isFile() || !/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(entry.name)) continue;
        const target = path.join(to, path.relative(from, abs));
        if (existsSync(target)) continue; // 同名 = 同一会话，已在新家 → 幂等跳过
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(abs, target);
        copied += 1;
      }
    }
  }
  if (copied > 0) console.log(`[migration] 已从旧家 ${legacyHome} 拷入 ${copied} 个老会话 rollout（旧家文件保留不动，官方 CLI 不受影响）`);
}

// 网络层错误中文化：证书过期/域名解析/超时等 give 用户能看懂的原因（引擎/插件直连供应商时可能遇到）
export function describeNetworkError(error: unknown, what: string): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const code = String((error as any)?.cause?.code ?? (error as any)?.code ?? "");
  const haystack = raw + " " + code;
  if (/CERT_HAS_EXPIRED|certificate has expired|ERR_CERT/i.test(haystack)) return new Error(`${what}失败：服务器的 HTTPS 证书已过期——这是接口服务商的问题，等其续期后自动恢复；也可先在插件配置里换成其他可用的接口地址。`);
  if (/ENOTFOUND|EAI_AGAIN/i.test(haystack)) return new Error(`${what}失败：域名解析不到，检查网络连接或接口地址是否写错`);
  if (/ECONNREFUSED/i.test(haystack)) return new Error(`${what}失败：连接被拒绝，服务未开放或地址/端口不对`);
  if (/ETIMEDOUT|ECONNABORTED|timeout/i.test(haystack)) return new Error(`${what}失败：连接超时，检查网络或代理设置`);
  if (/ECONNRESET|socket hang up/i.test(haystack)) return new Error(`${what}失败：连接被重置，网络波动或被防火墙拦截`);
  return new Error(`${what}失败：${raw}`);
}
