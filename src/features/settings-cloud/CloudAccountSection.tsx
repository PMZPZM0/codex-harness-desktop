/**
 * 设置页 · 云账号（10-16）—— 中转站式云账号登录 + 云端模型同步 + 云端知识库/记忆。
 *
 * 设计约束（用户令「各板块之间保持独立，避免结构臃肿」）：
 *   · **自包含**：只经主进程的 `cloud-*` 通道取数，⛔ 不接收 app props、不往 bag 加字段；
 *   · 通道清单 / 落盘位置 / 排查手册见 `docs/CLOUD-ACCOUNT.md`。
 *
 * ⛔ 三条必须在 UI 上如实呈现、不许含糊的事实：
 *   ① 登录后**模型会自动出现在下拉框**（勾选 = 下拉框可见），要明确告诉用户去哪儿看；
 *   ② 云端知识库与**本地**知识库是两份东西（云端跨设备、本地随项目走）；
 *   ③ 记忆中枢当前**没有 MCP 端点**，所以记忆只能是 `rest-only` —— 不画一个假装能用的开关。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Bot, Brain, CheckCircle2, Cloud, Coins, Database, ExternalLink, ListChecks, LogIn, LogOut, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import { provisionCloud, provisionSummary, type CloudProvisionReport } from "../../lib/cloud-provision.mjs";
import { PageInfo } from "../../components/SettingsHead";
import { Spinner } from "../../components/CardShell";
import { cloudUserCenterUrl } from "../../lib/cloud-links.mjs";
import { ProviderSetupDialog, type ProviderSetupCompleted, type ProviderSetupIntent } from "../provider-setup";

import { SessionSyncDialog } from "./SessionSyncDialog";
import { ResultDialog, type ResultAction } from "./ResultDialog";
type AccountView = { id: string; username: string; role: string; baseUrl: string; active: boolean; savedAt: number };
type AuthStatus = { loggedIn: boolean; baseUrl: string; active: AccountView | null; accounts: AccountView[]; defaultBaseUrl: string };
type ModelStatus = { loggedIn: boolean; registered: boolean; enabled: boolean; active: boolean; models: number; hasToken: boolean; lastSyncAt: number; account?: string; tokenPrefix?: string };
type KbStatus = { exists: boolean; enabled: boolean; url: string; hasToken: boolean };
type MemoryStatus = { mode: string; hasCredentials: boolean; note: string; upstream?: "memory" | "model"; connectorId?: string; activation?: { state: "active" | "inactive" | "unknown"; reason: string; entitled: boolean; applied: boolean; checkedAt: number; reasonText: string } };
type PointTxn = { id?: string; at?: number; delta?: number; kind?: string; note?: string; after?: number };
type Points = { ok: boolean; balance: number; signupGrant: number; txns: PointTxn[]; error?: string };
/** cloud-models:test 回执（10-19）：成功 ⇒ 提示保存重启；401/403 主进程已自动重签后重探。 */
type CloudTestReply = {
  ok: boolean;
  code?: string;
  error?: string;
  originalError?: string;
  healed?: boolean;
  model?: string;
  status?: number;
  latencyMs?: number;
  models?: number;
};

/** 积分变动的类型标签（与服务端 `kind` 同源；⛔ 不认识的 kind 原样显示，别吞掉）。 */
const KIND_LABEL: Record<string, string> = {
  signup: "注册赠送",
  grant: "发放",
  consume: "调用消耗",
  entitlement: "开通权益",
  refund: "退还",
  admin: "管理员调整",
};

/** 主进程通道面。全部可选 —— 老构建没有这些通道时页面要能优雅降级（⛔ 不是白屏）。 */
type CloudApi = {
  cloudAuthLogin?: (input: { baseUrl?: string; username: string; password: string }) => Promise<{ ok: boolean; error?: string }>;
  /* 10-18 会话同步（手动）：与模型同步独立。⛔ 服务端可被管理员关闭，届时 code=session-sync-disabled */
  cloudSyncPush?: (input?: { paths?: string[] }) => Promise<{ ok: boolean; reserved?: boolean; code?: string; error?: string }>;
  cloudSyncPull?: (input?: { keys?: string[] }) => Promise<{ ok: boolean; reserved?: boolean; code?: string; error?: string }>;
  cloudAuthLogout?: (id?: string) => Promise<{ ok: boolean }>;
  cloudAuthSwitch?: (id: string) => Promise<{ ok: boolean }>;
  cloudAuthStatus?: () => Promise<AuthStatus>;
  cloudAuthPoints?: () => Promise<Points>;
  cloudModelsSync?: (input?: { force?: boolean }) => Promise<{ ok: boolean; models: number; changed: boolean; promoted: boolean; error?: string }>;
  cloudModelsTest?: (input?: { forceHeal?: boolean }) => Promise<CloudTestReply>;
  cloudModelsActivate?: () => Promise<{ ok: boolean; model: string; error?: string }>;
  cloudModelsStatus?: () => Promise<ModelStatus>;
  cloudKbSync?: () => Promise<{ ok: boolean; action: string; url?: string; kbName?: string; error?: string }>;
  cloudKbStatus?: () => Promise<KbStatus>;
  cloudMemorySync?: () => Promise<{ ok: boolean; mode: string; error?: string; upstream?: "memory" | "model"; upstreamChanged?: boolean; activation?: { state: "active" | "inactive" | "unknown"; reason: string; entitled: boolean; applied: boolean; checkedAt: number; reasonText: string } }>;
  cloudMemoryStatus?: () => Promise<MemoryStatus>;
};

const cloudApi = (): CloudApi => window.codex as unknown as CloudApi;

/** 同步完必须刷新渲染层的供应商状态：下拉框的开启条件是 `customModel` 非空，
 *  而它只在页面加载时读一次 —— 不刷新就会出现"同步成功了但下拉框还是空的"。 */
function refreshProviders() {
  try {
    (window as unknown as { __refreshProviders?: () => void }).__refreshProviders?.();
  } catch { /* 未接线时忽略 */ }
}

function agoText(at: number): string {
  if (!at) return "从未";
  const sec = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (sec < 60) return "刚刚";
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  return `${Math.floor(sec / 3600)} 小时前`;
}

const STEP_LABEL: Record<string, string> = {
  auth: "账号",
  models: "模型",
  kb: "知识库",
  memory: "记忆",
  "model-active": "生效模型",
};

/** 就绪清单的一行：图标 + 名称 + 当前状态 + 一句说明。 */
function ReadyRow({ icon, label, tone, tag, detail }: { icon: ReactNode; label: string; tone: "on" | "off"; tag: string; detail: string }) {
  return (
    <div className={`cloud-acct-ready-row ${tone}`}>
      <span className="cloud-acct-ready-ico">{icon}</span>
      <b>{label}</b>
      <span className={`cloud-acct-tag ${tone}`}>{tag}</span>
      <span className="cloud-acct-ready-detail">{detail}</span>
    </div>
  );
}

/** 自动配置的逐步回执（只显示本机实际做过/跳过的步骤，⛔ 不画假进度）。 */
function ProvisionSteps({ report }: { report: CloudProvisionReport }) {
  if (!report.steps.length) return null;
  return (
    <div className="cloud-acct-steps" data-testid="cloud-provision-steps">
      {report.steps.map((step) => (
        <div className={`cloud-acct-step ${step.state}`} key={step.id}>
          <span className="cloud-acct-step-dot" />
          <b>{STEP_LABEL[step.id] || step.id}</b>
          <span>{step.detail}</span>
        </div>
      ))}
    </div>
  );
}

/** 新手教程（10-22 用户令「加上新手教程」）：三步 + 手动流程入口说明。默认收起，不挡操作。 */
function CloudTutorial() {
  return (
    <details className="cloud-tutorial" data-testid="cloud-tutorial">
      <summary>
        <BookOpen size={15} />
        <strong>第一次用？三步搞定</strong>
        <span className="cloud-acct-sub">点开看</span>
      </summary>
      <ol>
        <li><b>注册 / 登录</b>：没有账号就点「去注册」在浏览器里注册；有账号直接填账号密码。</li>
        <li><b>自动配置</b>：点「登录并自动配置」—— 云端勾选的模型会同步到下拉框，云端知识库与记忆会自动接通；没开通的会写清楚原因。</li>
        <li><b>开始用</b>：回聊天直接发消息。云端知识库工具在新会话里可用；云端管理里改了勾选或开通权益，本机最多 10 分钟自动跟上。</li>
      </ol>
      <p className="cloud-tutorial-note">
        需要手动控制（重签密钥 / 连通测试 / 上传下载会话 / 切换供应商）→ 展开下面的「手动流程 / 高级设置」。
      </p>
    </details>
  );
}

export function CloudAccountSection() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [models, setModels] = useState<ModelStatus | null>(null);
  const [points, setPoints] = useState<Points | null>(null);
  const [kb, setKb] = useState<KbStatus | null>(null);
  const [memory, setMemory] = useState<MemoryStatus | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  /* 10-22「登录即用」：自动配置的逐步回执（账号 / 模型 / 知识库 / 记忆 / 生效位）。 */
  const [provisionReport, setProvisionReport] = useState<CloudProvisionReport | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  /* 10-24：登录 / 选择模型统一走自动配置大弹窗（检测目录 → 勾选 → 保存启用 → 重启）。 */
  const [setupIntent, setSetupIntent] = useState<ProviderSetupIntent | null>(null);
  /* 10-18：会话同步用**独立弹窗**（非内嵌）；null = 关闭 */
  const [sessionDialog, setSessionDialog] = useState<"upload" | "pull" | null>(null);
  /* 10-18：连通测试 / 刷新的**弹窗**反馈（内嵌 hint 会被滚动错过） */
  const [resultDialog, setResultDialog] = useState<{ title: string; tone: "ok" | "err" | "info"; message: string; details?: Array<{ label: string; value: string }>; actions?: ResultAction[] } | null>(null);
  const confirmTimer = useRef<number | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const refresh = useCallback(async () => {
    const api = cloudApi();
    if (!api.cloudAuthStatus) { setUnsupported(true); return; }
    const s = await api.cloudAuthStatus();
    setStatus(s);
    if (!s.loggedIn) { setModels(null); setKb(null); setMemory(null); setPoints(null); return; }
    const [m, k, mem, pts] = await Promise.all([
      api.cloudModelsStatus?.() ?? Promise.resolve(null),
      api.cloudKbStatus?.() ?? Promise.resolve(null),
      api.cloudMemoryStatus?.() ?? Promise.resolve(null),
      api.cloudAuthPoints?.() ?? Promise.resolve(null),
    ]);
    setModels(m); setKb(k); setMemory(mem); setPoints(pts);
  }, []);

  useEffect(() => {
    void refresh();
    return () => { if (confirmTimer.current != null) window.clearTimeout(confirmTimer.current); };
  }, [refresh]);

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(""); }
  }, []);

  const finishCloudSetup = async ({ result }: ProviderSetupCompleted, options: { restart: boolean }) => {
    setSetupIntent(null);
    refreshProviders();
    setMsg({ kind: "ok", text: `已启用「云端模型」· ${result.models.length} 个模型；旧供应商已自动停用。` });
    await refresh();
    if (options.restart) window.setTimeout(() => { void window.codex.relaunchApp().catch(() => undefined); }, 900);
  };

  const doLogin = () => run("login", async () => {
    const api = cloudApi();
    if (!api.cloudAuthLogin) return;
    setMsg(null);
    setProvisionReport(null);
    const r = await api.cloudAuthLogin({ username: username.trim(), password });
    if (!r.ok) { setMsg({ kind: "err", text: r.error || "登录失败" }); return; }
    setPassword("");
    /* 10-22「登录即用」：登录后一次配齐模型 / 知识库 / 记忆；**生效位交给统一弹窗**
       （10-24：勾选模型 → 保存并启用 → 旧供应商自动停用 → 重启，不再在这里偷偷切生效位）。
       ⛔ 令牌失效的 401 由 sync 内部自愈；仍失败才 force 重签一次（保留 10-18 多设备保护：
          不无条件重签，否则会把同账号另外两台设备的令牌挤出 3 枚令牌环）。 */
    let report = await provisionCloud(api, { activate: false });
    if (!report.models?.ok) {
      const forced = await api.cloudModelsSync?.({ force: true });
      if (forced?.ok) report = await provisionCloud(api, { activate: false });
    }
    setProvisionReport(report);
    refreshProviders();
    await refresh();
    if (report.models?.ok) {
      setMsg({ kind: "ok", text: `登录成功，已读取 ${report.models.count} 个云端模型 —— 在弹窗里勾选后保存启用。` });
      setSetupIntent({
        provider: "cloud",
        name: "云端模型",
        baseUrl: "",
        apiKey: "",
        source: "cloud",
        autoStart: true,
        account: username.trim() || status?.active?.username || undefined,
      });
      return;
    }
    setMsg({
      kind: "err",
      text: `登录成功，但自动配置未完成：${provisionSummary(report) || "请稍后点「一键同步 / 修复」重试"}`,
    });
  });

  /* 已登录状态的「一键同步 / 修复」：与登录页同一个编排函数（⛔ 不写第二套）。 */
  const doProvision = () => run("provision", async () => {
    const api = cloudApi();
    setMsg(null);
    /* 10-24 用户：「云账号一键同步 / 修复后，模型页会自动更新、并保存重启吗」
       ⇒ 显式点击就走 restartIfActive：云端目录已同步时重写生效档案 + 重启引擎 + 广播
       provider-activated，模型页卡片列表与当前会话模型都跟着刷新。 */
    const report = await provisionCloud(api, { activate: true, onlyIfEmpty: true, restartIfActive: true });
    setProvisionReport(report);
    refreshProviders();
    setMsg({
      kind: report.ok ? "ok" : "err",
      text: report.ok
        ? (report.activated
          ? `已同步并重启引擎生效，模型页已自动刷新。${provisionSummary(report)}`
          : `已同步。${provisionSummary(report)}`)
        : `自动配置未完成：${provisionSummary(report) || "请检查网络后重试"}`,
    });
    await refresh();
  });

  const doSync = (force: boolean) => run(force ? "resync" : "sync", async () => {
    const api = cloudApi();
    if (!api.cloudModelsSync) return;
    setMsg(null);
    const r = await api.cloudModelsSync({ force });
    refreshProviders();
    setMsg(r.ok
      ? {
        kind: "ok",
        text: r.models > 0
          ? `已同步 ${r.models} 个云端模型${r.changed ? "（本机档案已更新）" : "（无变化）"}${r.promoted ? "，并把「云端模型」设为当前生效供应商" : ""}。`
          : "云端当前没有勾选任何模型 —— 去云用户中心或面板里勾选后再同步。",
      }
      : { kind: "err", text: r.error === "not-logged-in" ? "登录已过期，请重新登录" : `同步失败：${r.error || "未知原因"}` });
    await refresh();
  });

  /* 10-18 手动会话同步（推 / 拉）。
     ⛔ 失败文案必须能分辨「管理员已关闭」——服务端会回 code=session-sync-disabled，
        这时**不是**网络故障，不能让用户反复重试。 */
  const doSyncPush = () => run("sync-push", async () => {
    const api = cloudApi();
    if (!api.cloudSyncPush) return;
    setMsg(null);
    const r = await api.cloudSyncPush({});
    setMsg(r.ok
      ? { kind: "ok", text: "会话已上传到云端" }
      : { kind: "err", text: r.code === "session-sync-disabled" ? "管理员已关闭云端会话同步" : (r.error || "上传失败") });
  });
  const doSyncPull = () => run("sync-pull", async () => {
    const api = cloudApi();
    if (!api.cloudSyncPull) return;
    setMsg(null);
    const r = await api.cloudSyncPull({});
    setMsg(r.ok
      ? { kind: "ok", text: "已从云端下载" }
      : { kind: "err", text: r.code === "session-sync-disabled" ? "管理员已关闭云端会话同步" : (r.error || "下载失败") });
  });

  /** 打开**云端用户中心**（账户 / 积分 / 模型勾选 / 知识库 / 记忆 的自助页）。
   *  ⛔ 它是纯静态页 + 账号服务接口，**不需要桌面端在线**（页内只有配对中心那块会提示本机助手未启动）。
   *  地址由账号服务基址派生（`src/lib/cloud-links.mjs`），⛔ 不写死域名。 */
  const openUserCenter = () => {
    const url = cloudUserCenterUrl(status?.baseUrl);
    if (!url) { setMsg({ kind: "err", text: "还不知道账号服务地址 —— 先登录一次即可" }); return; }
    void window.codex.openExternal(url).catch((error: any) => setMsg({ kind: "err", text: `打开失败：${error?.message ?? error}` }));
  };

  const doActivate = () => run("activate", async () => {
    const api = cloudApi();
    if (!api.cloudModelsActivate) return;
    setMsg(null);
    const r = await api.cloudModelsActivate();
    refreshProviders();
    setMsg(r.ok
      ? { kind: "ok", text: `已把「云端模型」设为当前生效供应商（默认模型 ${r.model}）—— 引擎正在重启以应用新密钥。` }
      : { kind: "err", text: r.error === "no-models" ? "云端没有可用模型，先在云端勾选后再同步" : "切换失败，请先「立即同步模型」再试" });
    await refresh();
  });

  /* 连通测试成功后的「保存并重启应用」：先做一次非强制同步把配置落定（幂等），
     再重启应用 —— 引擎进程只在启动时读 Key，不重启则新密钥不生效。 */
  const doSaveRestart = () => run("save-restart", async () => {
    const api = cloudApi();
    if (api.cloudModelsSync) {
      const r = await api.cloudModelsSync({ force: false });
      if (!r.ok) {
        setMsg({ kind: "err", text: `保存失败：${r.error === "not-logged-in" ? "登录已过期，请重新登录" : (r.error || "未知原因")} —— 未重启应用` });
        return;
      }
    }
    setMsg({ kind: "ok", text: "配置已保存，应用即将重启…" });
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    await window.codex.relaunchApp();
  });

  /* 云端模型连通测试（10-19）—— 与「模型供应商 → 测试当前供应商」同一套逻辑：
     探活 → 成功提示保存并重启；401/403 由主进程自动重签并重探；仍失败则弹窗给出「重签密钥并重试」。
     ⛔ 探测的是**行里的合成上游**（记忆开启时 = memapi + 记忆 userKey），不是纯模型通道。 */
  const doTestModels = (forceHeal = false) => run("test-models", async () => {
    const api = cloudApi();
    if (!api.cloudModelsTest) {
      setResultDialog({ title: "连通测试 · 云端模型", tone: "err", message: "当前版本不支持云端模型探测（缺少 cloudModelsTest），请更新后再试。" });
      return;
    }
    setMsg(null);
    try {
      const r = await api.cloudModelsTest({ forceHeal });
      refreshProviders();
      await refresh().catch(() => undefined);
      if (r.ok) {
        const response = `HTTP ${r.status ?? "—"} · ${r.latencyMs ?? 0} ms · ${r.models ?? 0} 个模型可用`;
        setResultDialog({
          title: "连通测试 · 云端模型",
          tone: "ok",
          message: r.healed
            ? "连接成功。刚才的本机密钥已失效，已自动重签并恢复。点「保存并重启应用」让引擎用上新密钥。"
            : "连接成功。点「保存并重启应用」确保配置在引擎中生效。",
          details: [
            { label: "模型", value: r.model || "—" },
            { label: "响应", value: response },
            ...(r.healed ? [{ label: "自愈", value: "已自动重签并刷新记忆凭据" }] : []),
            { label: "注意", value: "重启会中断正在运行的任务（会话历史完整保留）" },
          ],
          actions: [
            { label: "保存并重启应用", primary: true, onClick: doSaveRestart },
            { label: "稍后", onClick: () => undefined },
          ],
        });
        return;
      }
      const healFailed = r.code === "heal-failed";
      const stillFailing = r.code === "still-failing";
      const authTrouble = healFailed || stillFailing;
      const canResign = authTrouble || r.code === "no-token";
      /* 动作按失败类型给，不一律甩「重签」：网络不通重签没用、未登录更不该签；
         没模型/没供应商的正确下一步是同步（否则用户只能关掉弹窗自己找按钮）。 */
      const actions: ResultAction[] = [];
      if (canResign) actions.push({ label: "重签密钥并重试", primary: true, onClick: () => { void doTestModels(true); } });
      else if (r.code === "unreachable") actions.push({ label: "重试", primary: true, onClick: () => { void doTestModels(false); } });
      else if (r.code === "no-provider" || r.code === "no-model") actions.push({ label: "立即同步模型", primary: true, onClick: () => doSync(false) });
      if (authTrouble) actions.push({ label: "云端用户中心", onClick: openUserCenter });
      actions.push({ label: "关闭", onClick: () => undefined });
      const advice = authTrouble
        ? "重签密钥后重试；仍失败检查账号权益或稍后再试"
        : r.code === "unreachable"
          ? "检查网络后重试；持续失败请打开云端用户中心"
          : r.code === "not-logged-in"
            ? "重新登录云账号后再测试"
            : "先「立即同步模型」，再重试";
      setResultDialog({
        title: "连通测试 · 云端模型",
        tone: "err",
        message: healFailed
          ? "认证失败，自动重签密钥也没成功。可以手动重签再试一次；仍失败请打开云端用户中心检查账号与权益。"
          : stillFailing
            ? "已自动重签密钥，但连接仍然失败。请打开云端用户中心确认账号/权益，或稍后再试。"
            : r.code === "not-logged-in"
              ? "登录已过期 —— 请重新登录云账号后再测试。"
              : r.code === "no-provider" || r.code === "no-model" || r.code === "no-token"
                ? (r.error || "云端模型尚未就绪：先同步模型、补齐密钥后再测试。")
                : `连接失败：${r.error || "未知原因"}`,
        details: [
          ...(r.error ? [{ label: "原因", value: r.error }] : []),
          ...(r.originalError && r.originalError !== r.error ? [{ label: "原始错误", value: r.originalError }] : []),
          { label: "建议", value: advice },
        ],
        actions,
      });
    } catch (error: any) {
      setResultDialog({ title: "连通测试 · 云端模型", tone: "err", message: `探测异常：${String(error?.message ?? error).slice(0, 200)}` });
    }
  });

  const doKb = () => run("kb", async () => {
    const api = cloudApi();
    if (!api.cloudKbSync) return;
    setMsg(null);
    const r = await api.cloudKbSync();
    setMsg(r.ok
      ? { kind: "ok", text: `云端知识库已接通为 MCP 连接器${r.kbName ? `（${r.kbName}）` : ""} —— 重启会话后 Codex 可直接检索它。` }
      : { kind: "err", text: r.error === "not-activated" ? "云端知识库未开通权益（服务端不建库、不发钥匙）—— 先在云用户中心开通。" : `接通失败：${r.error || "未知原因"}` });
    await refresh();
  });

  const doMemory = () => run("memory", async () => {
    const api = cloudApi();
    if (!api.cloudMemorySync) return;
    setMsg(null);
    const r = await api.cloudMemorySync();
    /* ⛔ 结论以主进程回执的 activation 为准（它同时落库给记忆页用）——
       这里不再用 mode 反推，否则两个页面会给出不同的"开通/生效"判断。 */
    const a = r.activation;
    setMsg(r.ok
      ? (a?.applied
          ? { kind: "ok", text: "云端记忆已接通：对话上游已切到记忆端点，记忆在请求层自动注入与写入（无需工具调用）。回「记忆 → 记忆后端选项」即可选云端。" }
          : { kind: "ok", text: "记忆凭据已取回并加密缓存；再刷新一次或重启应用即可切到记忆上游。" })
      : {
        kind: "err",
        text: `未能接通：${a?.reasonText || (r.error === "not-activated" ? "当前账号未开通云端记忆" : r.error || "未知原因")}`
          + (a?.reason === "not-logged-in" ? " —— 请重新登录云账号。" : " —— 去云用户中心开通后重试。"),
      });
    await refresh();
  });

  /* 10-18 连通测试：只**探测**（复用 cloudKbStatus / cloudMemoryStatus，不建连接、不改配置），
     结果用弹窗展示 —— 用户要求「连通测试弹窗反馈」。 */
  const doTest = (kind: "kb" | "memory") => run(`test-${kind}`, async () => {
    const api = cloudApi();
    try {
      if (kind === "kb") {
        const st = await api.cloudKbStatus?.();
        if (!st) { setResultDialog({ title: "连通测试 · 知识库", tone: "err", message: "当前版本不支持知识库探测（缺少 cloudKbStatus）" }); return; }
        const ok = Boolean(st.url && st.hasToken);
        setResultDialog({
          title: "连通测试 · 云端知识库",
          tone: ok ? "ok" : "err",
          message: ok
            ? "连接信息完整：端点已下发、凭据已保存。引擎可把它当 MCP 连接器检索。"
            : "连接信息不完整 —— 还需要先「接通 / 刷新云端知识库」。",
          details: [
            { label: "端点", value: st.url ? st.url : "无" },
            { label: "凭据", value: st.hasToken ? "已保存" : "无" },
            { label: "名称", value: (st as { kbName?: string }).kbName || "—" },
          ],
        });
      } else {
        const st = await api.cloudMemoryStatus?.();
        if (!st) { setResultDialog({ title: "连通测试 · 记忆", tone: "err", message: "当前版本不支持记忆探测（缺少 cloudMemoryStatus）" }); return; }
        const ok = st.mode === "mcp" || st.mode === "rest-only";
        setResultDialog({
          title: "连通测试 · 云端记忆",
          tone: ok ? "ok" : "err",
          message: ok
            ? (st.upstream === "memory" ? "记忆已接通：对话上游已切到记忆端点，请求层自动注入与写入。" : "凭据已就绪（未生效）：再刷新一次或重启应用即会切到记忆上游。")
            : "尚未开通或未取到凭据 —— 先「获取 / 刷新记忆凭据」。",
          details: [
            { label: "模式", value: st.mode || "—" },
            { label: "上游", value: (st as { upstream?: string }).upstream || "—" },
            { label: "凭据", value: st.hasCredentials ? "已缓存" : "无" },
          ],
        });
      }
    } catch (e) {
      setResultDialog({ title: `连通测试 · ${kind === "kb" ? "知识库" : "记忆"}`, tone: "err", message: `探测异常：${(e as Error).message.slice(0, 160)}` });
    }
  });

  const doLogout = (id?: string) => {
    if (!confirmLogout) {
      setConfirmLogout(true);
      confirmTimer.current = window.setTimeout(() => setConfirmLogout(false), 4000);
      return;
    }
    setConfirmLogout(false);
    void run("logout", async () => {
      const api = cloudApi();
      if (!api.cloudAuthLogout) return;
      const r = await api.cloudAuthLogout(id);
      refreshProviders();
      if (r.ok) setProvisionReport(null);
      setMsg(r.ok ? { kind: "ok", text: "已退出云账号（云端模型已从下拉框收起，配置保留，重新登录即恢复）。" } : { kind: "err", text: "退出失败" });
      await refresh();
    });
  };

  const doSwitch = (id: string) => run("switch", async () => {
    const api = cloudApi();
    if (!api.cloudAuthSwitch) return;
    const r = await api.cloudAuthSwitch(id);
    if (!r.ok) { setMsg({ kind: "err", text: "切换失败" }); return; }
    setProvisionReport(null);
    await api.cloudModelsSync?.({ force: false });
    refreshProviders();
    setMsg({ kind: "ok", text: "已切换云账号并同步其云端模型。" });
    await refresh();
  });

  const busyIcon = (key: string) => (busy === key ? <Spinner /> : null);

  /* 10-22 就绪状态：模型可不可用 / 是否生效 / KB / 记忆，一行一个结论。 */
  const modelReady = Boolean(models?.registered && (models?.models ?? 0) > 0);
  const modelLive = Boolean(models?.active);
  const kbReady = Boolean(kb?.enabled);
  const memReady = Boolean(memory?.activation?.state === "active" && memory?.activation?.applied);
  const overall = !modelReady
    ? { tone: "off" as const, label: "待配置", hint: "登录成功，但云端模型还没同步 —— 点「一键同步 / 修复」，或去用户中心勾选模型。" }
    : !modelLive
      ? { tone: "off" as const, label: "已同步，未生效", hint: "你现在用的是别的供应商（已保留）。需要云端出字时点「设为当前供应商」；知识库与记忆已自动接好。" }
      : { tone: "on" as const, label: "已就绪", hint: "直接回聊天发消息即可；云端勾选与权益变动会每 10 分钟自动同步。" };

  return (
    <section className="settings-section stack cloud-acct-section">
      {/* 10-18 会话同步弹窗（**独立弹窗，非内嵌**）。成功关闭后回调刷新外部界面：
          让"最近同步 / 已上传数量"这类展示跟着变（用户要求：状态变化后正确渲染刷新）。 */}
      {resultDialog && (
        <ResultDialog
          title={resultDialog.title}
          tone={resultDialog.tone}
          message={resultDialog.message}
          details={resultDialog.details}
          actions={resultDialog.actions}
          onClose={() => setResultDialog(null)}
        />
      )}
      {sessionDialog && (
        <SessionSyncDialog
          mode={sessionDialog}
          onClose={(result) => { setSessionDialog(null); if (result) { setMsg(result); void refresh(); } }}
        />
      )}
      <div className="settings-copy channel-heading">
        <div>
          <h2>
            云账号
            <PageInfo
              text={<>登录云账号后<b>自动配好</b>：云端勾选的模型同步到本机下拉框，<b>云端知识库与记忆</b>一并接通；没开通的会写明原因。云端管理里改了勾选 / 权益，本机最多 10 分钟自动跟上。<br />⛔ 这与「中转站」是两条独立的登录线，互不影响。</>}
            />
          </h2>
          <p className="muted">
            新手只需登录一次，剩下交给下面的一键配置；重签密钥 / 连通测试 / 上传下载会话等手动操作都收在「高级设置」里。
          </p>
        </div>
      </div>

      {msg && <div className={`cloud-acct-msg ${msg.kind}`}>{msg.text}</div>}

      {unsupported ? (
        <div className="cloud-acct-msg err">
          当前构建未包含云账号接口（主进程缺少 cloud-* 通道），请更新后再试。
        </div>
      ) : !status ? (
        <div className="cloud-acct-card"><Spinner /></div>
      ) : !status.loggedIn ? (
        <>
          {/* 未登录：只留一张「登录即用」卡（10-22 用户令「流程简化，新手登录即用」）。 */}
          <div className="cloud-acct-card cloud-acct-hero cloud-acct-simple" data-testid="cloud-login-simple">
            <div className="cloud-acct-hero-top">
              <span className="cloud-acct-hero-icon"><Cloud size={22} /></span>
              <div className="cloud-acct-hero-main">
                <h3>登录云账号，直接开始用</h3>
                <p className="muted">登录后自动同步云端模型，并接通云端知识库与记忆；没开通的会写清楚去哪开通，不会让你猜。</p>
              </div>
            </div>
            <div className="cloud-acct-form">
              <label htmlFor="cloud-acct-user">账号</label>
              <input
                id="cloud-acct-user"
                className="field"
                value={username}
                autoComplete="username"
                placeholder="用户名（与网页端同一个）"
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && username && password) doLogin(); }}
              />
              <label htmlFor="cloud-acct-pwd">密码</label>
              <input
                id="cloud-acct-pwd"
                className="field"
                type="password"
                value={password}
                autoComplete="current-password"
                placeholder="云账号密码"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && username && password) doLogin(); }}
              />
            </div>
            <div className="cloud-acct-hero-actions">
              <button className="primary-setting cloud-acct-login" disabled={!username || !password || busy === "login"} onClick={doLogin}>
                <LogIn size={14} />{busy === "login" ? "正在登录并自动配置…" : "登录并自动配置"}
              </button>
              <button className="secondary-setting" onClick={openUserCenter} title="浏览器打开，不需要桌面端在线">
                <ExternalLink size={14} />去注册 / 用户中心
              </button>
            </div>
            <p className="cloud-acct-sub cloud-acct-footnote">
              还没有账号？先在浏览器打开云端用户中心注册（不需要先装云助手）。注册后回这里登录即可。
            </p>
          </div>
          <CloudTutorial />
        </>
      ) : (
        <>
          {/* 已登录：先给「就绪状态」，手动流程收进下面的高级折叠。 */}
          <div className="cloud-acct-card cloud-acct-hero cloud-acct-ready" data-testid="cloud-ready">
            <div className="cloud-acct-hero-top">
              <span className="cloud-acct-hero-icon"><Cloud size={22} /></span>
              <div className="cloud-acct-hero-main">
                <h3>
                  {status.active?.username}
                  <span className={`cloud-acct-tag ${overall.tone}`}>{overall.label}</span>
                </h3>
                <p className="muted">{overall.hint}</p>
              </div>
              <div className="cloud-acct-hero-actions">
                <button className="primary-setting" disabled={!!busy} onClick={doProvision}>
                  <RefreshCw size={14} />{busy === "provision" ? "正在自动配置…" : "一键同步 / 修复"}
                </button>
                <button className="secondary-setting" onClick={openUserCenter}>
                  <ExternalLink size={14} />用户中心
                </button>
              </div>
            </div>
            <div className="cloud-acct-ready-grid">
              <ReadyRow
                icon={<Bot size={15} />}
                label="云端模型"
                tone={modelReady ? "on" : "off"}
                tag={modelLive ? "当前生效" : modelReady ? "已同步" : "未注册"}
                detail={modelReady ? `${models?.models ?? 0} 个可用 · 上次同步 ${agoText(models?.lastSyncAt ?? 0)}` : "云端还没有勾选模型（去用户中心勾选后点一键同步）"}
              />
              <ReadyRow
                icon={<BookOpen size={15} />}
                label="云端知识库"
                tone={kbReady ? "on" : "off"}
                tag={kbReady ? "已接通" : kb?.exists ? "已停用" : "未开通"}
                detail={kbReady ? "MCP 连接器已就绪，新会话可直接检索" : "开通后点「一键同步」即可接通（未开通不影响聊天）"}
              />
              <ReadyRow
                icon={<Brain size={15} />}
                label="云端记忆"
                tone={memReady ? "on" : "off"}
                tag={memReady ? (memory?.mode === "mcp" ? "已接通（MCP）" : "已接通（请求层）") : memory?.activation?.state === "unknown" ? "待确认" : "未开通"}
                detail={memReady ? "每账号独立命名空间，自动注入与写入" : (memory?.activation?.reasonText || "开通后点「一键同步」即可接通")}
              />
            </div>
            <div className="cloud-acct-hero-foot">
              <span className="cloud-acct-points">
                <Coins size={13} />
                {points ? (points.ok ? `${Number(points.balance).toLocaleString()} 积分` : "积分读取失败") : "积分读取中…"}
              </span>
              <span className="cloud-acct-sub">{status.active?.role} · {status.active?.baseUrl}</span>
              <button className="cloud-acct-link" disabled={!!busy} onClick={() => doLogout(status.active?.id)}>
                <LogOut size={13} />{confirmLogout ? "再点一次确认退出" : "退出登录"}
              </button>
            </div>
          </div>

          {provisionReport && <ProvisionSteps report={provisionReport} />}

          <CloudTutorial />

          <details className="cloud-acct-advanced" data-testid="cloud-advanced">
            <summary>
              <CheckCircle2 size={15} />
              <strong>手动流程 / 高级设置</strong>
              <span className="cloud-acct-sub">登录时已自动做过；只有需要修复或手动切换时才用</span>
            </summary>

            <div className="cloud-acct-card">
              <div className="cloud-acct-head">
                <Cloud size={16} />
                <strong>账号与密钥</strong>
                <span className="cloud-acct-sub">已登录 · {status.active?.username}</span>
              </div>
              <div className="cloud-acct-kv"><span>服务地址</span><code>{status.active?.baseUrl}</code></div>
              <div className="cloud-acct-kv">
                <span>模型令牌</span>
                <code>{models?.tokenPrefix ? models.tokenPrefix + "…" : "尚未签发"}</code>
                <span className="cloud-acct-sub">{models?.account || status.active?.username || ""}</span>
              </div>
              <div className="cloud-acct-actions">
                <button className="secondary-setting" disabled={!!busy} onClick={() => doSync(false)}>
                  <RefreshCw size={14} />{busy === "sync" ? "同步中…" : "立即同步模型"}
                </button>
                <button className="secondary-setting" disabled={!!busy} onClick={() => doSync(true)}>
                  <RotateCcw size={14} />{busy === "resync" ? "重签中…" : "重签密钥并同步"}
                </button>
                <button className="secondary-setting" disabled={!!busy || !models?.registered || !models.models} onClick={() => doTestModels(false)} title="测试云端模型链路（与引擎实际使用的上游一致；401 会自动重签一次）">
                  <RefreshCw size={14} />{busy === "test-models" ? "测试中…" : "连通测试"}
                </button>
                <button className="secondary-setting" onClick={openUserCenter}>
                  <ExternalLink size={14} />云端用户中心
                </button>
                <button className="secondary-setting danger" disabled={!!busy} onClick={() => doLogout(status.active?.id)}>
                  <LogOut size={14} />{confirmLogout ? "再点一次确认退出" : "退出登录"}
                </button>
                {busyIcon("sync")}{busyIcon("resync")}
              </div>
              <div className="cloud-acct-actions">
                <button className="secondary-setting" disabled={!!busy} onClick={() => setSessionDialog("upload")}>
                  {busy === "sync-push" ? "上传中…" : "上传会话"}
                </button>
                <button className="secondary-setting" disabled={!!busy} onClick={() => setSessionDialog("pull")}>
                  {busy === "sync-pull" ? "下载中…" : "从云端下载"}
                </button>
              </div>
            </div>

            <div className="cloud-acct-card">
              <div className="cloud-acct-head">
                <Database size={16} />
                <strong>云端模型（手动）</strong>
                <span className={`cloud-acct-tag ${models?.registered && models.enabled ? "on" : "off"}`}>
                  {models?.registered ? (models.enabled ? "已注册" : "已停用") : "未注册"}
                </span>
                {models?.registered && (
                  <span className={`cloud-acct-tag ${models.active ? "on" : "off"}`}>{models.active ? "当前生效" : "未生效"}</span>
                )}
              </div>
              <div className="cloud-acct-metrics">
                <span>下拉框可见模型 <b>{models?.models ?? 0}</b> 个</span>
                <span>代理密钥 <b>{models?.hasToken ? "已就位" : "缺失"}</b></span>
                <span>上次同步 <b>{agoText(models?.lastSyncAt ?? 0)}</b></span>
                <span>自动保持更新 <b>每 10 分钟</b></span>
              </div>
              {models?.registered && (
                <div className="cloud-acct-actions">
                  <button className="primary-setting" disabled={!!busy || !models.models} onClick={() => setSetupIntent({
                    provider: "cloud",
                    name: "云端模型",
                    baseUrl: "",
                    apiKey: "",
                    source: "cloud",
                    autoStart: true,
                    account: models.account || undefined,
                  })}>
                    <ListChecks size={14} />选择模型并启用
                  </button>
                  <span className="cloud-acct-sub">自动读取云端目录，可一键全选；保存后旧供应商自动停用并重启应用</span>
                </div>
              )}
              {models?.registered && !models.active && (
                <div className="cloud-acct-actions">
                  <button className="secondary-setting" disabled={!!busy || !models.models} onClick={doActivate}>
                    <Cloud size={14} />{busy === "activate" ? "切换中…" : "直接设为当前供应商（保持现有勾选）"}
                  </button>
                  {busyIcon("activate")}
                </div>
              )}
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                勾选哪些模型由云端决定（云端勾选 = 本机下拉框可见）。改了勾选后在云端保存，本机最多 10 分钟自动跟上，也可点上面的「立即同步模型」。
              </p>
            </div>

            <div className="cloud-acct-card">
              <div className="cloud-acct-head">
                <BookOpen size={16} />
                <strong>云端知识库（手动）</strong>
                <span className={`cloud-acct-tag ${kb?.enabled ? "on" : "off"}`}>{kb?.enabled ? "已接通" : kb?.exists ? "已停用" : "未接通"}</span>
              </div>
              <div className="cloud-acct-metrics">
                <span>连接器 <b>cloud-kb</b></span>
                <span>端点 <b>{kb?.url ? "已下发" : "无"}</b></span>
                <span>凭据 <b>{kb?.hasToken ? "已保存" : "无"}</b></span>
              </div>
              <div className="cloud-acct-actions">
                <button className="secondary-setting" disabled={!!busy} onClick={doKb}>
                  <BookOpen size={14} />{busy === "kb" ? "接通中…" : "接通 / 刷新云端知识库"}
                </button>
                <button className="secondary-setting" disabled={!!busy} onClick={() => doTest("kb")}>
                  {busy === "test-kb" ? "测试中…" : "连通测试"}
                </button>
                {busyIcon("kb")}
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                接通后以 MCP 连接器形式提供给引擎（令牌经环境变量注入，⛔ 不写进 config.toml）。它与本机「知识库」页那份项目级知识库是<b>两份</b>，各管各的。
              </p>
            </div>

            <div className="cloud-acct-card">
              <div className="cloud-acct-head">
                <TriangleAlert size={16} />
                <strong>云端记忆（手动）</strong>
                <span className={`cloud-acct-tag ${memory?.activation?.state === "active" && memory?.activation?.applied ? "on" : "off"}`}>
                  {memory?.activation?.state === "active"
                    ? (memory.activation.applied
                        ? (memory?.mode === "mcp" ? "已接通（MCP）" : "已接通（请求层）")
                        : "已开通（未接通）")
                    : memory?.activation?.state === "unknown"
                      ? "待确认"
                      : "未开通"}
                </span>
              </div>
              <div className="cloud-acct-metrics">
                <span>凭据 <b>{memory?.hasCredentials ? "已缓存" : "无"}</b></span>
                <span>开通 <b>{memory?.activation?.reasonText ?? "待确认"}</b></span>
              </div>
              <div className="cloud-acct-actions">
                <button className="secondary-setting" disabled={!!busy} onClick={doMemory}>
                  <RefreshCw size={14} />{busy === "memory" ? "获取中…" : "获取 / 刷新记忆凭据"}
                </button>
                <button className="secondary-setting" disabled={!!busy} onClick={() => doTest("memory")}>
                  {busy === "test-memory" ? "测试中…" : "连通测试"}
                </button>
                {busyIcon("memory")}
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                {memory?.upstream === "memory" ? (
                  <>✅ 记忆<b>已接通</b>：对话上游已切到记忆端点，记忆在<b>请求层</b>自动注入与写入（每账号独立命名空间，<b>不需要工具调用</b>）。</>
                ) : memory?.mode === "rest-only" ? (
                  <>凭据已就绪但<b>尚未生效</b>：再点一次「获取 / 刷新记忆凭据」会把它切到对话上游（重启应用也会自动生效）。</>
                ) : (
                  <>记忆中枢的 MCP 端点尚未提供；REST 通道正常，开通权益并刷新凭据后按<b>请求层注入</b>生效。</>
                )}
              </p>
            </div>

            {status.accounts.length > 1 && (
              <div className="cloud-acct-card">
                <div className="cloud-acct-head"><strong>其他已保存的云账号</strong></div>
                {status.accounts.filter((a) => !a.active).map((a) => (
                  <div className="cloud-acct-row" key={a.id}>
                    <label>{a.username}</label>
                    <span className="cloud-acct-sub" style={{ flex: 1 }}>{a.baseUrl}</span>
                    <button className="secondary-setting" disabled={!!busy} onClick={() => doSwitch(a.id)}>切为此账号</button>
                    <button className="secondary-setting danger" disabled={!!busy} onClick={() => doLogout(a.id)}>移除</button>
                  </div>
                ))}
              </div>
            )}

            <div className="cloud-acct-card">
              <div className="cloud-acct-head">
                <Coins size={16} />
                <strong>我的积分</strong>
                <span className={`cloud-acct-tag ${points?.ok ? "on" : "off"}`}>
                  {points ? (points.ok ? `${Number(points.balance).toLocaleString()} 积分` : "读取失败") : "读取中…"}
                </span>
                {points && !points.ok && <span className="cloud-acct-sub">{points.error}</span>}
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                用途：在「云端模型」里调用模型时按<b>模型倍率</b>扣减；余额为 0 会暂停调用。
              </p>
              {points?.txns?.length ? (
                <div className="cloud-acct-txns">
                  {points.txns.map((t, i) => (
                    <div className="cloud-acct-txn" key={t.id || `${t.at}-${i}`}>
                      <span className="cloud-acct-txn-when">
                        {t.at ? new Date(t.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
                      </span>
                      <span className="cloud-acct-txn-kind">{t.kind ? (KIND_LABEL[t.kind] || t.kind) : "变动"}</span>
                      <span className="cloud-acct-txn-note" title={t.note || ""}>{t.note || ""}</span>
                      <span className="cloud-acct-txn-delta">{(t.delta ?? 0) >= 0 ? "+" : ""}{t.delta ?? 0}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 12 }}>
                  {points?.ok ? `暂无变动记录（注册赠送 ${Number(points.signupGrant || 0).toLocaleString()} 积分）` : "登录后读取"}
                </div>
              )}
            </div>
          </details>
        </>
      )}
      {setupIntent && (
        <ProviderSetupDialog
          intent={setupIntent}
          onClose={() => setSetupIntent(null)}
          onCompleted={finishCloudSetup}
        />
      )}
    </section>
  );
}
