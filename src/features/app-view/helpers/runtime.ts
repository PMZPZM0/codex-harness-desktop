/**
 * app-view/helpers/runtime（09-22 架构改造：从 helpers.tsx 按功能域拆出，纯搬迁）
 *
 * 域：会话运行时状态 / 会话级配置（权限 / 模型 / 推理档 / 沙箱）的读写与派生
 * 符号（18）：loadThreadRuntimeRaw / loadThreadRuntime / writeThreadRuntimeMirror / saveThreadRuntime / admitThreadRuntimeRef / ownRuntimeWrites / loadThreadPermissions / threadSandboxOf / threadApprovalOf / saveThreadPermissions / loadThreadModel / saveThreadModel / resolveThreadModel / loadThreadEffort / saveThreadEffort / sandboxPolicy / sandboxMode / displayPath
 *
 * 代码与拆分前逐字一致；依赖边经 AST 依赖图核对，**不跨模块** ⇒ 本文件不 import 同目录其他模块。
 */
import { resolveModelForOpen } from "../../../lib/model-scope.mjs";
import { LEGACY_PREFIX, emptyRuntime, legacyMirror, migrateRuntime, normalizeRuntime, patchRuntime, rememberOwnWrite, runtimeKey, runtimeSignature } from "../../../lib/thread-runtime.mjs";
import { isMacPlatform } from "../../../lib/is-mac-platform";
import { APPROVAL_MODES, SANDBOX_MODES } from "../constants";



export function loadThreadRuntimeRaw(id: string): ReturnType<typeof emptyRuntime> {
  if (!id) return emptyRuntime();
  try {
    const raw = localStorage.getItem(runtimeKey(id));
    if (raw) return normalizeRuntime(JSON.parse(raw));
  } catch { /* 坏 JSON 视为没有，走下面的迁移 */ }
  // 首次读取：从旧三键族迁移（旧键**唯一**还能说话的时刻）
  let legacyModel = "";
  let legacyEffort = "";
  let legacyPerms: unknown = {};
  try {
    legacyModel = localStorage.getItem(LEGACY_PREFIX.model + id) ?? "";
    legacyEffort = localStorage.getItem(LEGACY_PREFIX.effort + id) ?? "";
    legacyPerms = JSON.parse(localStorage.getItem(LEGACY_PREFIX.permissions + id) ?? "{}");
  } catch { /* ignore */ }
  return migrateRuntime({ model: legacyModel, effort: legacyEffort, permissions: legacyPerms });
}

export /** 读会话运行时配置（含旧键自动迁移）。**只有明确的用户动作才调 save，effect 请勿落盘。** */
function loadThreadRuntime(id: string): ReturnType<typeof emptyRuntime> {
  const runtime = loadThreadRuntimeRaw(id);
  // 迁移落盘：旧键里有值、而新键还没有 → 补写一次，之后旧键只作镜像
  if (id && !localStorage.getItem(runtimeKey(id)) && runtimeSignature(runtime) !== "|||") {
    saveThreadRuntime(id, runtime);
  }
  return runtime;
}

export /** 写本地镜像（新键 + 派生旧键）。**权威值在主进程**，这里只让同步读路径（大量 loadThread*）看得见。 */
function writeThreadRuntimeMirror(id: string, runtime: unknown) {
  if (!id) return;
  try {
    const next = normalizeRuntime(runtime);
    localStorage.setItem(runtimeKey(id), JSON.stringify(next));
    const mirror = legacyMirror(next);
    if (mirror.model) localStorage.setItem(LEGACY_PREFIX.model + id, mirror.model);
    if (mirror.effort) localStorage.setItem(LEGACY_PREFIX.effort + id, mirror.effort);
    localStorage.setItem(LEGACY_PREFIX.permissions + id, mirror.permissions);
  } catch { /* ignore */ }
}

export /** 写会话运行时配置：本地镜像立即生效（同步读路径不能等 IPC），再推给主进程做权威落盘 + 广播。
 *  多窗口并发保护（09-14）：baseRev = 本地镜像里上次从主进程同步到的 rev，主进程据此判冲突；
 *  主进程回来的权威值交给 admitThreadRuntime（组件内）写回镜像并同步 React 状态。 */
function saveThreadRuntime(id: string, patch: Partial<ReturnType<typeof emptyRuntime>>, opts?: { takeover?: boolean }) {
  if (!id) return null;
  try {
    const baseRev = normalizeRuntime(loadThreadRuntimeRaw(id)).rev;
    const { runtime, changed } = patchRuntime({ ...loadThreadRuntimeRaw(id), rev: baseRev }, patch);
    if (!changed) return null;
    writeThreadRuntimeMirror(id, runtime);
    rememberOwnWrite(ownRuntimeWrites, id, runtime); // 认出即将广播回来的那次回声
    const request = window.codex?.patchThreadRuntime?.({ threadId: id, patch, baseRev, ...(opts?.takeover ? { takeover: true } : {}) });
    if (!request) return null;
    return request
      .then((result: any) => {
        if (result?.runtime) admitThreadRuntimeRef.current?.(id, result.runtime, { conflict: Boolean(result.conflict) });
        return result;
      })
      .catch(() => null); // 主进程不可用：退回纯 localStorage 行为（旧版本/测试环境）
  } catch { return null; }
}

export /** saveThreadRuntime 是模块级函数、拿不到组件内的 setState —— 由组件在渲染时把
 *  admitThreadRuntime 挂到这个 ref 上（主进程返回值与广播两条路径共用同一个收敛函数）。 */
const admitThreadRuntimeRef: { current: ((id: string, runtime: unknown, opts?: { conflict?: boolean; fromRemote?: boolean }) => void) | null } = { current: null };

export /** 本窗口最近写出去的会话运行时（回声表）。判定规则本身在 `src/lib/thread-runtime.mjs`
 *  的 `isOwnEcho` / `rememberOwnWrite`（纯函数，预检里有确定性断言——这段时序竞态在 e2e 里
 *  复现不了，只能靠纯函数把规则钉死）。
 *  ⛔ 主进程把变更广播给**所有**窗口（含写入者自己），而广播可能在 React 提交 state 之前到达——
 *  那一刻 `runtimeStateRef` 还是旧值，会被误判成「另一个窗口改了」，于是用户自己切个模型就弹
 *  「另一个窗口更新了…」（09-14 用户实测的误报）。 */
const ownRuntimeWrites = new Map<string, { signature: string; at: number }>();

export function loadThreadPermissions(id: string): { sandbox?: string; approval?: string } {
  const r = loadThreadRuntime(id);
  return { sandbox: r.sandbox, approval: r.approval };
}

export function threadSandboxOf(id: string): string | undefined {
  const value = loadThreadPermissions(id).sandbox;
  return (SANDBOX_MODES as readonly string[]).includes(String(value)) ? value : undefined;
}

export function threadApprovalOf(id: string): string | undefined {
  const value = loadThreadPermissions(id).approval;
  return (APPROVAL_MODES as readonly string[]).includes(String(value)) ? value : undefined;
}

export function saveThreadPermissions(id: string, sandbox: string, approval: string) {
  saveThreadRuntime(id, { sandbox, approval });
}

export function loadThreadModel(id: string): string {
  return loadThreadRuntime(id).model;
}

export function saveThreadModel(id: string, modelId: string) {
  saveThreadRuntime(id, { model: modelId });
}

export /** 打开会话时的模型回填：**该会话自己的记录优先**，它还没有记录（新建/从没选过）才用全局默认。
 *  规则与两次返工的由来见 src/lib/model-scope.mjs——别再退回「全局后改就覆盖会话」。 */
function resolveThreadModel(id: string): string {
  let global = "";
  try { global = localStorage.getItem("default-model") ?? ""; } catch { /* ignore */ }
  return resolveModelForOpen({ stored: loadThreadModel(id), global });
}

export /** 每会话独立的思考等级：切会话互不串扰（对齐 thread-model 的按会话存储模式）。 */
function loadThreadEffort(id: string): string {
  return loadThreadRuntime(id).effort;
}

export function saveThreadEffort(id: string, effort: string) {
  saveThreadRuntime(id, { effort });
}

export function sandboxPolicy(mode: string, cwd: string) {
  if (mode === "danger-full-access") return { type: "dangerFullAccess" };
  if (mode === "read-only") return { type: "readOnly", networkAccess: false };
  // 默认自主模式：仅在当前项目根目录可写，允许常规构建/测试/依赖查询联网。
  // 工作区外访问仍由 Codex 沙箱与审批策略保护。
  return { type: "workspaceWrite", writableRoots: cwd ? [cwd] : [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
}

export function sandboxMode(policy: any): "danger-full-access" | "read-only" | "workspace-write" | null {
  if (!policy?.type) return null;
  if (policy.type === "dangerFullAccess") return "danger-full-access";
  if (policy.type === "readOnly") return "read-only";
  if (policy.type === "workspaceWrite") return "workspace-write";
  return null;
}

export /** 当前是否 macOS：优先 preload 暴露的 process.platform（打包/开发态都可靠），回退 navigator。
 *  09-17 mac 适配：全库快捷键原先只认 `event.ctrlKey`，而 mac 的「命令键」是 ⌘（metaKey）——
 *  旧判断里那句 `|| event.metaKey` 直接把 mac 的所有快捷键 return 掉：⌘O 打开工作区、
 *  ⌘N 新建任务、⌘K 命令面板、⌘, 设置……**在 mac 上全部无效**（用户报「项目地址功能用不了」）。 */
/** 平台化的快捷键标签（只影响**显示**，不改变按键判断）：mac 上 Ctrl→⌘、Shift→⇧、Alt→⌥。
 *  转换规则在 src/lib/hotkey.mjs 里（纯函数 —— 本机是 Windows 跑不到 mac 分支，只有把它做成
 *  纯函数，预检才能对「mac 上显示成什么」给出确定性断言）。 */
/** 拼**展示用**的路径（渲染层没有 node:path，写死 `\` 会在 mac 上显示成
 *  `/Users/x/Library/Application Support/Codex Harness Desktop\codex-home\skills` 这种四不像）。 */
function displayPath(base: string, ...parts: string[]): string {
  const sep = isMacPlatform() ? "/" : "\\";
  return [String(base ?? "").replace(/[\\/]+$/, ""), ...parts].join(sep);
}