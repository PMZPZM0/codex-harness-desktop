/**
 * 飞书 CLI 卡片（10-29，嵌在「设置 → 开发工具」）。
 *
 * 三步：装 CLI → 配置飞书应用（config init）→ 用户登录（device flow）。
 * ⛔ 登录必须是官方 device flow：`auth login --no-wait` 拿链接 → 用户在浏览器确认 →
 *    后台 `--device-code` 落地。这里只显示链接与状态，不自己编凭据。
 * ⛔ 状态以主进程 feishu-cli:status 为准（它真跑 `lark-cli auth status --json`）。
 * ⛔ 三行用 `runtime-row` 结构与开发工具列表同款（图标 / 标题+说明 / 右侧动作）——
 *    自造一套 `feishu-cli-step` 又没有对应 CSS，出来就是一坨原生排版（10-29 用户截图）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CalendarDays, Check, Copy, Download, ExternalLink, FileText, FolderOpen,
  ListTodo, LogIn, LogOut, Mail, MessageSquare, RefreshCw, Table2, Trash2, Video,
} from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { copyTextToClipboard } from "../../lib/clipboard";
import { feishuPollOutcome } from "../../lib/feishu-card.mjs";

/** 「能做什么」清单：按飞书开放平台的命令域归类（口径与 `lark-cli <域> --help` 一致）。 */
const CAPABILITIES = [
  { icon: MessageSquare, title: "消息与群聊", desc: "发消息、搜聊天记录、建群、加人 / 移人" },
  { icon: FileText, title: "云文档", desc: "新建 / 读取 / 改写文档，导出与成员权限" },
  { icon: Table2, title: "多维表格与电子表格", desc: "建表、读写记录、按视图统计" },
  { icon: CalendarDays, title: "日历与会议", desc: "查日程、约会议、看空闲时间" },
  { icon: ListTodo, title: "任务", desc: "建任务、改状态、分派给同事" },
  { icon: Mail, title: "邮件", desc: "读邮件、写邮件、管理收件规则" },
  { icon: FolderOpen, title: "云盘与知识库", desc: "上传下载文件、读写知识库节点" },
  { icon: Video, title: "会议纪要", desc: "读妙记 / 录制纪要，导出成文本" },
];

/** 示例说法：给用户「照着说」的模板（不是 CLI 命令 —— 用户不该背参数）。 */
const EXAMPLES = [
  "把今天的会议纪要整理成飞书文档，放到「产品周会」文件夹",
  "在「项目群」发一条：今天的构建已通过",
  "查一下我明天的日程，按时间排好",
  "这份 csv 帮我导成多维表格，再按负责人统计",
  "读一下这篇飞书文档，提炼 5 条要点",
  "把这张报价单传到飞书云盘，把链接发我",
];

type Status = {
  installed: boolean;
  path: string;
  version: string;
  configured: boolean;
  /** 当前配置的飞书应用 id（重新配置时用它判断"换没换成功"） */
  appId: string;
  loggedIn: boolean;
  user: string;
  detail: string;
  error: string;
};

export function FeishuCliCard({ setNotice, installDevRuntime, runtimeInstalling, uninstallDevRuntime, runtimeUninstalling }: {
  setNotice: (text: string, detail?: string) => void;
  installDevRuntime?: (id: string) => void;
  runtimeInstalling?: Record<string, boolean> | null;
  uninstallDevRuntime?: (id: string) => unknown;
  runtimeUninstalling?: Record<string, boolean> | null;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"" | "setup" | "reconfig" | "login" | "logout">("");
  /* 10-30 用户：「提供卸载按键」——CLI 装在这里，卸载也放这里。两步确认，不用原生弹窗。 */
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const uninstalling = Boolean(runtimeUninstalling?.["feishu-cli"]);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const releaseRef = useRef<number>(0);
  /* refresh 在间隔里跑，拿不到闭包里的最新 busy ⇒ 用 ref 镜像判断「当前这条链接属于哪个流程」。 */
  const busyRef = useRef(busy);
  busyRef.current = busy;
  /* 重新配置前记下当前 appId：切换完成的唯一可观测信号是它变了（配置本来就是已完成态）。 */
  const baseAppIdRef = useRef("");

  const refresh = useCallback(async () => {
    try {
      const next = (await window.codex.feishuCliStatus()) as Status;
      setStatus(next);
      /* ⛔ 链接/等待态的归约走纯函数（真值表在守卫 139f）：见 configured 就收链接那次事故，
         就是把「登录等待中配置本来就已完成」这条规则漏在组件闭包里。 */
      const flow = busyRef.current;
      /* 点重新配置时状态还没读到（appId 空）⇒ 用第一轮读到的 appId 做基线，避免把「未知 → 已知」误判成切换完成。 */
      if (flow === "reconfig" && !baseAppIdRef.current && next.appId) baseAppIdRef.current = next.appId;
      /* ⛔ 必须要求新 appId 非空：config init 改写配置的那一瞬间，auth status 可能读不到内容，
         把「读到空」当成「已切换」会提前收尾、用户还没做完。 */
      const appChanged = flow === "reconfig" && Boolean(baseAppIdRef.current) && Boolean(next.appId) && next.appId !== baseAppIdRef.current;
      const outcome = feishuPollOutcome({ flow, configured: next.configured, loggedIn: next.loggedIn, appChanged });
      if (!outcome.keepLink) setLink("");
      if (outcome.clearBusy) {
        setBusy("");
        if (appChanged) { baseAppIdRef.current = next.appId; setNotice?.("已切换到新的飞书应用，请重新登录"); }
      }
      return next;
    } catch (err: any) {
      setError(String(err?.message ?? err));
      return null;
    }
  }, []);

  /** 卸载 CLI：走开发工具同一条 runtime:uninstall（删 npm-global 包体 + 记账）。
   *  ⛔ 不删 `~/.lark-cli`（官方 CLI 自己的凭据目录）——用户重装后不用重新登录；
   *    要清凭据请用「退出登录」或手动删该目录。 */
  const uninstallCli = async () => {
    try {
      setNotice?.("正在卸载飞书 CLI…");
      await Promise.resolve(uninstallDevRuntime?.("feishu-cli"));
      setNotice?.("飞书 CLI 已卸载", "登录凭据仍保留在本机（~/.lark-cli）；需要时可重新安装");
      await refresh();
    } catch (err) {
      setNotice?.("卸载失败", String((err as { message?: unknown })?.message ?? err));
    }
  };

  /* 兜底：浏览器那一步可能被用户放弃（或用户在另一台设备完成）。10 分钟后自动解除「等待中」，
     让按钮可以再点一次；状态仍以主进程为准。 */
  const releaseLater = () => {
    if (releaseRef.current) window.clearTimeout(releaseRef.current);
    releaseRef.current = window.setTimeout(() => setBusy(""), 10 * 60_000);
  };
  const releaseNow = () => {
    if (releaseRef.current) { window.clearTimeout(releaseRef.current); releaseRef.current = 0; }
    setBusy("");
  };

  useEffect(() => { void refresh(); }, [refresh]);

  // 拿到授权链接后每 2 秒看一次状态（登录/配置完成后自动收起链接）
  useEffect(() => {
    if (!link) return;
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [link, refresh]);

  useEffect(() => () => { if (releaseRef.current) window.clearTimeout(releaseRef.current); }, []);

  const installing = Boolean(runtimeInstalling?.["feishu-cli"]);
  const waiting = busy === "setup" || busy === "reconfig" || busy === "login";

  /** 用系统默认浏览器打开授权页；打不开就给一条能自救的提示（链接本身仍可复制）。 */
  const openLink = async () => {
    if (!link) return;
    try {
      await window.codex.openExternal(link);
    } catch {
      setError("默认浏览器没拉起来：点「复制链接」在浏览器里打开即可");
    }
  };

  /** replace=true = 重新配置（换一个飞书应用）：先记下当前 appId，等它变了才算切换完成。 */
  const startSetup = async (replace = false) => {
    if (replace) baseAppIdRef.current = String(status?.appId ?? "");
    setError(""); setBusy(replace ? "reconfig" : "setup"); releaseLater();
    try {
      const result: any = await window.codex.feishuCliSetupStart();
      if (result?.ok && result.url) {
        setLink(result.url);
        setNotice?.(replace ? "正在重新配置：在浏览器里完成新的应用创建 / 绑定，完成后需要重新登录" : "已生成飞书应用配置链接，浏览器里完成即可");
      }
      else { setError(String(result?.error ?? "没有拿到授权链接")); releaseNow(); }
    } catch (err: any) { setError(String(err?.message ?? err)); releaseNow(); }
  };

  const startLogin = async () => {
    setError(""); setBusy("login"); releaseLater();
    try {
      const result: any = await window.codex.feishuCliLoginStart();
      if (result?.ok && result.url) { setLink(result.url); setNotice?.("已生成登录链接，浏览器确认后自动完成"); }
      else { setError(String(result?.error ?? "没有拿到登录链接")); releaseNow(); }
    } catch (err: any) { setError(String(err?.message ?? err)); releaseNow(); }
  };

  /** 取消本次授权：主进程会杀掉挂在后台的 config init / device-code 轮询进程。 */
  const cancel = async () => {
    try { await window.codex.feishuCliCancel(); } catch { /* 主进程没接上也照样清界面 */ }
    setLink(""); setError(""); releaseNow();
    setNotice?.("已取消本次授权");
    void refresh();
  };

  const logout = async () => {
    setError(""); setBusy("logout");
    try { await window.codex.feishuCliLogout(); } catch (err: any) { setError(String(err?.message ?? err)); }
    releaseNow(); void refresh();
  };

  const copy = () => { if (link) void copyTextToClipboard(link).then(() => setNotice?.("链接已复制")).catch(() => undefined); };

  return (
    <section className="settings-section stack feishu-cli-card">
      <div className="feishu-cli-list">
        <div className={`runtime-row ${status?.installed ? "installed" : "missing"} ${installing ? "busy" : ""}`}>
          <span className="runtime-icon">{installing ? <Spinner /> : status?.installed ? <Check size={15} /> : <Download size={15} />}</span>
          <span className="runtime-copy">
            <strong>安装 CLI</strong>
            <small>{status?.installed ? `已安装${status.version ? ` ${status.version}` : ""}；卸载不会删除本机已登录的飞书凭据` : "约 51 MB，走国内 npm 镜像；装好后可在这里卸载"}</small>
          </span>
          <div className="runtime-actions">
            {status?.installed ? <>
                <span className="runtime-badge installed">已安装</span>
                <button
                  type="button"
                  className={`runtime-install feishu-cli-uninstall ${confirmUninstall ? "confirming" : ""}`}
                  disabled={uninstalling}
                  title="卸载 CLI（不动本机已登录的飞书凭据 ~/.lark-cli；需要时再装回来即可）"
                  onClick={() => {
                    if (!confirmUninstall) {
                      setConfirmUninstall(true);
                      window.setTimeout(() => setConfirmUninstall(false), 4000);
                      return;
                    }
                    setConfirmUninstall(false);
                    void uninstallCli();
                  }}
                >
                  {uninstalling ? <><Spinner /> 卸载中</> : <><Trash2 size={13} />{confirmUninstall ? "确认卸载" : "卸载"}</>}
                </button>
              </>
              : <button type="button" className="primary-setting runtime-install" disabled={installing} onClick={() => installDevRuntime?.("feishu-cli")}>
                  {installing ? <><Spinner /> 安装中</> : <><Download size={14} />安装</>}
                </button>}
          </div>
        </div>

        <div className={`runtime-row ${status?.configured ? "installed" : "missing"} ${busy === "setup" || busy === "reconfig" ? "busy" : ""}`}>
          <span className="runtime-icon">{busy === "setup" || busy === "reconfig" ? <Spinner /> : status?.configured ? <Check size={15} /> : <ExternalLink size={15} />}</span>
          <span className="runtime-copy">
            <strong>配置飞书应用</strong>
            <small>{status?.configured ? "已配置（应用凭据存在本机，可重复使用）" : "在浏览器里创建 / 绑定一个飞书应用，一次即可"}</small>
          </span>
          <div className="runtime-actions">
            {status?.configured ? <>
                <span className="runtime-badge installed">已配置</span>
                <button type="button" className="runtime-install" disabled={Boolean(busy)} onClick={() => void startSetup(true)} title="换一个飞书应用（会替换当前绑定的应用，完成后需重新登录）">
                  {busy === "reconfig" ? <><Spinner /> 配置中</> : <><RefreshCw size={13} />重新配置</>}
                </button>
              </>
              : <button type="button" className="runtime-install" disabled={!status?.installed || Boolean(busy)} onClick={() => void startSetup(false)}>
                  {busy === "setup" ? <><Spinner /> 等待浏览器</> : <><ExternalLink size={13} />去配置</>}
                </button>}
          </div>
        </div>

        <div className={`runtime-row ${status?.loggedIn ? "installed" : "missing"} ${busy === "login" ? "busy" : ""}`}>
          <span className="runtime-icon">{busy === "login" ? <Spinner /> : status?.loggedIn ? <Check size={15} /> : <LogIn size={15} />}</span>
          <span className="runtime-copy">
            <strong>登录飞书</strong>
            <small>{status?.loggedIn ? `已登录${status.user ? `：${status.user}` : ""}` : "在浏览器里授权一次，之后自动复用"}</small>
          </span>
          <div className="runtime-actions">
            {status?.loggedIn
              ? <button type="button" className="runtime-install" disabled={Boolean(busy)} onClick={() => void logout()}>
                  {busy === "logout" ? <Spinner /> : <><LogOut size={13} />退出登录</>}
                </button>
              : <button type="button" className="primary-setting runtime-install" disabled={!status?.configured || Boolean(busy)} onClick={() => void startLogin()}>
                  {busy === "login" ? <><Spinner /> 等待授权</> : <><ExternalLink size={13} />登录</>}
                </button>}
          </div>
        </div>
      </div>

      {link ? (
        <div className="feishu-cli-link">
          <a href={link} onClick={(event) => { event.preventDefault(); void openLink(); }} title="用默认浏览器打开">{link}</a>
          <button type="button" className="runtime-install" onClick={() => void openLink()}><ExternalLink size={13} />打开浏览器</button>
          <button type="button" className="runtime-install" onClick={copy}><Copy size={13} />复制</button>
          {waiting ? <button type="button" className="runtime-install danger-text" onClick={() => void cancel()}>取消授权</button> : null}
        </div>
      ) : null}

      {status?.installed && !status.configured && !link && !waiting ? (
        <p className="settings-card-hint"><AlertTriangle size={13} /> 还没配置飞书应用：点第 2 步「去配置」，在浏览器完成即可。</p>
      ) : null}
      {error ? <p className="settings-card-hint" style={{ color: "var(--danger, #c0392b)" }}><AlertTriangle size={13} /> {error}</p> : null}

      <section className="feishu-cli-guide">
        <div className="feishu-cli-guide-head">
          <strong>能做什么</strong>
          <small>装好并登录后，Codex 会多一个 feishu_cli 工具 —— 用你本人的权限操作飞书，覆盖官方 200+ 条命令里的常用部分</small>
        </div>
        <div className="feishu-cli-cap-grid">
          {CAPABILITIES.map(({ icon: Icon, title, desc }) => (
            <div className="feishu-cli-cap" key={title}>
              <span className="feishu-cli-cap-icon"><Icon size={15} /></span>
              <span className="feishu-cli-cap-copy"><strong>{title}</strong><small>{desc}</small></span>
            </div>
          ))}
        </div>

        <div className="feishu-cli-guide-head">
          <strong>怎么用</strong>
          <small>上面三步完成后，直接在对话里说人话，不用背命令</small>
        </div>
        <ol className="feishu-cli-guide-steps">
          <li><b>说清「做什么 + 发到哪 / 放哪」</b><span>例如「发到项目群」「放进产品周会文件夹」；不确定的群名或文档名，让它先查再动手。</span></li>
          <li><b>先读后写</b><span>要改文档 / 发表格前，先让它把现状读出来给你看，确认后再落笔。</span></li>
          <li><b>敏感动作先说一遍</b><span>发消息、批量改表这类动作，先让它复述「发到哪、发什么」，你点头再执行。</span></li>
        </ol>

        <div className="feishu-cli-examples">
          {EXAMPLES.map((text) => <span className="feishu-cli-example" key={text}>{text}</span>)}
        </div>

        <ul className="feishu-cli-notes">
          <li>权限就是你在飞书里授权的范围 —— 看不到与你无关的会话和文档。</li>
          <li>登录凭据只存在本机 <code>~/.lark-cli</code>；「退出登录」只清本机令牌，飞书后台的授权需要到飞书里解除。</li>
          <li>更新 / 卸载在「控制台 → 组件更新」与开发工具的运行时列表里；命令拿不准，可以让它先跑 <code>&lt;域&gt; --help</code>。</li>
        </ul>
      </section>
    </section>
  );
}
