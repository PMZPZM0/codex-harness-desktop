/**
 * 会话级上级关系（11-03 用户：「普通会话一样有上下级和调度关系」）。
 *
 * 不变量：
 *   ① 任何有 supervisorThreadId 的会话都要有会话级权威身份（直接上级 = 笔名 + id）；
 *   ② 明确「工具目录 / 角色模板不是上级」——成员曾被问上级时答成专家团主理人；
 *   ③ 身份块放在全局指令前面（后面的目录再长也盖不过它）；
 *   ④ 新建、打开会话、应用启动、上级改名四条路径都要刷新，历史会话不能停在旧答案。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

const scopeSrc = read("electron/session-scope.ts");
ok(/上级关系（会话级·权威）/.test(scopeSrc)
  && /你的直接上级/.test(scopeSrc)
  && /不是你的上级关系/.test(scopeSrc),
  "通用上级身份块：直接上级（笔名 + id），工具目录/角色模板不是上级");
ok(/aliasRecordOf\(id\)/.test(scopeSrc) && /supervisorThreadId/.test(scopeSrc)
  && /delegateScopeBlock\(/.test(scopeSrc)
  && /groupMemberThreadIds/.test(scopeSrc),
  "按 supervisorThreadId 取真实上级；被派活会话用角色约束块；群成员跳过（由 runner 专用块负责）");
ok(/listByOrigin\(id/.test(scopeSrc) && /snapshotSessionAliases/.test(scopeSrc)
  && /refreshAllSupervisorScopes/.test(scopeSrc),
  "上级改名刷新子会话 + 启动补齐存量被派活会话");
ok(/readCustomModel/.test(scopeSrc) && /originSessionModel/.test(scopeSrc),
  "thread/settings/update 必填 model：会话运行时 → 上级模型 → 全局模型三级兜底（实测 missing field model）");
ok(/listAll\(\)/.test(scopeSrc) && /ensureSessionAlias\(record\.threadId/.test(scopeSrc)
  && /delegate\?\.originThreadId/.test(scopeSrc),
  "存量被派活会话按 delegateRegistry.origin 补上级（专家/子智能体/调度成员/CLI 同一张表）");

const delegationSrc = read("electron/features/delegation.ts");
ok(/\$\{block\}\\n\\n---\\n\\n\$\{baseInstructions\}/.test(delegationSrc),
  "被委派会话的身份块放在全局指令**前面**（不能追加在目录后面）");
const dispatchSrc = read("electron/dispatch.ts");
ok(/不是你的上级关系/.test(dispatchSrc) && /角色模板/.test(dispatchSrc),
  "delegateScopeBlock 明确写清目录/角色模板不是上级");

const teamSrc = read("electron/team-invoke.ts");
ok(/refreshSupervisorScopeForThread\(memberThreadId\)/.test(teamSrc)
  && teamSrc.indexOf("refreshSupervisorScopeForThread(memberThreadId)") < teamSrc.indexOf('server.request("turn/start"', teamSrc.indexOf("refreshSupervisorScopeForThread(memberThreadId)")),
  "专家团成员在派活前写入会话级上级身份");

const ipcSrc = read("electron/features/codex-ipc.ts");
ok(/refreshSupervisorScopeForThread/.test(ipcSrc) && /refreshMemberScopeForThread/.test(ipcSrc),
  "打开任意会话（thread/resume）都按当前笔名刷新上级身份");
ok(/setSessionAliasChangeHook/.test(ipcSrc) && /refreshChildScopesForSupervisor/.test(ipcSrc)
  && /refreshMemberScopesForSupervisor/.test(ipcSrc) && /watchSupervisorScopes/.test(ipcSrc),
  "改名钩子与启动补齐挂在核心域 codex-ipc（不依赖群编排域是否启用）");

const runnerSrc = read("electron/boss-groups/runner.ts");
ok(/watchSupervisorScopes/.test(scopeSrc) && /watchSupervisorScopes\(\)/.test(ipcSrc)
  && !/refreshAllSupervisorScopes/.test(runnerSrc),
  "引擎就绪后的存量补齐挂在核心域 codex-ipc（runner 不重复挂）");
const mainSrc = read("electron/main.ts");
ok(/snapshotSessionAliases/.test(mainSrc) && /aliasSnapshot\[id\]\?\.alias/.test(mainSrc),
  "手机端会话名走别名快照（与桌面同一套笔名，不拿旧引擎名）");

console.log(fails ? `\n【supervisor-scope】失败 ${fails} 项` : `\n【supervisor-scope】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
