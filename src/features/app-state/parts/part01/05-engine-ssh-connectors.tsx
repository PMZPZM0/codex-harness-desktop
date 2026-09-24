/**
 * usePart01e（09-22：part01 按序切分出来的第 5 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import type { Bag } from "../bag-types";

export function usePart01e(bag: Bag) {
  // —— Codex 引擎更新（设置 → 控制台底部） ——
  const [engineVersion, setEngineVersion] = useState("");
bag.engineVersion = engineVersion as typeof bag.engineVersion; bag.setEngineVersion = setEngineVersion as typeof bag.setEngineVersion;


  const [engineCheck, setEngineCheck] = useState<{ state: "idle" | "checking" | "latest" | "available" | "error"; latest?: string; message?: string }>({ state: "idle" });
bag.engineCheck = engineCheck as typeof bag.engineCheck; bag.setEngineCheck = setEngineCheck as typeof bag.setEngineCheck;


  const [engineUpdating, setEngineUpdating] = useState(false);
bag.engineUpdating = engineUpdating as typeof bag.engineUpdating; bag.setEngineUpdating = setEngineUpdating as typeof bag.setEngineUpdating;


  const [engineUpdateLog, setEngineUpdateLog] = useState<string[]>([]);
bag.engineUpdateLog = engineUpdateLog as typeof bag.engineUpdateLog; bag.setEngineUpdateLog = setEngineUpdateLog as typeof bag.setEngineUpdateLog;


  const [engineUpdatePercent, setEngineUpdatePercent] = useState<number | null>(null);
bag.engineUpdatePercent = engineUpdatePercent as typeof bag.engineUpdatePercent; bag.setEngineUpdatePercent = setEngineUpdatePercent as typeof bag.setEngineUpdatePercent;


  const [engineUpdateStageText, setEngineUpdateStageText] = useState("准备更新…");
bag.engineUpdateStageText = engineUpdateStageText as typeof bag.engineUpdateStageText; bag.setEngineUpdateStageText = setEngineUpdateStageText as typeof bag.setEngineUpdateStageText;


  const [engineUpdateResult, setEngineUpdateResult] = useState<{ ok: boolean; message: string } | null>(null);
bag.engineUpdateResult = engineUpdateResult as typeof bag.engineUpdateResult; bag.setEngineUpdateResult = setEngineUpdateResult as typeof bag.setEngineUpdateResult;


  const [relaunchCountdown, setRelaunchCountdown] = useState<number | null>(null);
bag.relaunchCountdown = relaunchCountdown as typeof bag.relaunchCountdown; bag.setRelaunchCountdown = setRelaunchCountdown as typeof bag.setRelaunchCountdown;


  useEffect(() => { void window.codex.engineInfo().then((info) => bag.setEngineVersion(info.version)).catch(() => undefined); }, []);


  useEffect(() => window.codex.onEngineUpdateProgress((event) => {
    const stageTextMap: Record<string, string> = { wait: "等待当前任务结束…", query: "查询最新版本…", download: `下载引擎包 ${Math.round((event.percent ?? 0) * 100)}%`, extract: "解压引擎包…", verify: "校验新引擎…", replace: "替换引擎文件…", done: "更新完成" };
    const text = event.stage === "download" ? stageTextMap.download : (stageTextMap[event.stage] || event.detail || event.stage);
    bag.setEngineUpdateStageText(text);
    bag.setEngineUpdatePercent(event.stage === "download" ? (event.percent ?? 0) : null);
    const logText = event.stage === "download" ? text : (event.detail || event.stage);
    bag.setEngineUpdateLog((current) => [...current.slice(-9), logText]);
  }), []);


  useEffect(() => {
    if (bag.relaunchCountdown == null) return;
    if (bag.relaunchCountdown <= 0) { void window.codex.relaunchApp(); return; }
    const timer = setTimeout(() => bag.setRelaunchCountdown((value) => (value == null ? null : value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [bag.relaunchCountdown]);


  const checkEngineUpdateNow = async () => {
    bag.setEngineCheck({ state: "checking" });
    try {
      const info = await window.codex.engineCheckUpdate();
      bag.setEngineVersion(info.current);
      bag.setEngineCheck(info.hasUpdate ? { state: "available", latest: info.latest } : { state: "latest", latest: info.latest });
    } catch (error: any) {
      bag.setEngineCheck({ state: "error", message: error?.message ?? "检查失败" });
    }
  };
bag.checkEngineUpdateNow = checkEngineUpdateNow as typeof bag.checkEngineUpdateNow;


  const performEngineUpdateNow = async () => {
    if (bag.engineUpdating) return;
    if (!(await bag.openAppConfirm("更新 Codex 引擎", `确定把 Codex 引擎更新到 ${bag.engineCheck.latest} 吗？\n· 更新会先停止引擎（正在运行的任务会先等它结束）\n· 下载约 30MB，失败会自动回滚旧版本\n· 完成后应用将自动重启生效`, "立即更新"))) return;
    bag.setEngineUpdating(true);
    bag.setEngineUpdateLog([]);
    bag.setEngineUpdatePercent(null);
    bag.setEngineUpdateStageText("准备更新…");
    bag.setEngineUpdateResult(null);
    try {
      const result = await window.codex.enginePerformUpdate();
      if (result.ok) {
        bag.setEngineUpdateLog((current) => [...current, result.message]);
        bag.setEngineVersion(`codex-cli ${result.version}`);
        bag.setEngineCheck({ state: "latest", latest: result.version });
        bag.setNotice("引擎更新完成，应用即将自动重启…");
        bag.setRelaunchCountdown(3);
      } else {
        bag.setEngineUpdateResult({ ok: false, message: result.message });
      }
    } catch (error: any) {
      bag.setEngineUpdateResult({ ok: false, message: error?.message ?? "更新失败" });
    } finally {
      bag.setEngineUpdating(false);
    }
  };
bag.performEngineUpdateNow = performEngineUpdateNow as typeof bag.performEngineUpdateNow;



  // —— SSH 服务器连接管理 ——
  const emptySshJump = (): SshJumpHost => ({ host: "", port: 22, username: "", authType: "password", password: "", privateKey: "", keyPath: "", passphrase: "" });
bag.emptySshJump = emptySshJump as typeof bag.emptySshJump;


  const emptySshDraft = (): SshServer => ({
    id: "", name: "", host: "", port: 22, username: "root", authType: "password", password: "", privateKey: "", keyPath: "",
    passphrase: "", enabled: true, createdAt: "", group: "", tags: [], notes: "", favorite: false, startupCommand: "",
    remotePath: "", keepaliveInterval: 30, connectTimeout: 10, termType: "xterm-256color", jumpHost: null,
  });
bag.emptySshDraft = emptySshDraft as typeof bag.emptySshDraft;


  const sshDraftIssues = (draft: SshServer) => {
    const issues: string[] = [];
    if (!draft.name.trim()) issues.push("连接名称未填写");
    if (!draft.host.trim()) issues.push("主机地址未填写");
    if (!draft.username.trim()) issues.push("用户名未填写");
    if (draft.port && (draft.port < 1 || draft.port > 65535)) issues.push("端口需在 1-65535 之间");
    if (draft.authType === "key" && !draft.privateKey?.trim() && !draft.keyPath?.trim()) issues.push("私钥认证需要私钥内容或私钥文件路径");
    if (draft.jumpHost?.host?.trim() && !draft.jumpHost.username?.trim()) issues.push("跳板机用户名未填写");
    return issues;
  };
bag.sshDraftIssues = sshDraftIssues as typeof bag.sshDraftIssues;


  const sshDraftValid = (draft: SshServer) => bag.sshDraftIssues(draft).length === 0;
bag.sshDraftValid = sshDraftValid as typeof bag.sshDraftValid;


  /** 列表过滤：关键字（名称/主机/用户名/标签/分组/备注）+ 状态分段 */
  const sshVisible = useMemo(() => {
    const keyword = bag.sshQuery.trim().toLowerCase();
    return bag.sshServers.filter((server) => {
      if (bag.sshFilter === "on" && !server.enabled) return false;
      if (bag.sshFilter === "off" && server.enabled) return false;
      if (bag.sshFilter === "star" && !server.favorite) return false;
      if (!keyword) return true;
      return [server.name, server.host, server.username, server.group ?? "", server.notes ?? "", (server.tags ?? []).join(" ")]
        .join(" ").toLowerCase().includes(keyword);
    });
  }, [bag.sshServers, bag.sshQuery, bag.sshFilter]);
bag.sshVisible = sshVisible as typeof bag.sshVisible;


  const sshCheckedSet = useMemo(() => new Set(bag.sshChecked), [bag.sshChecked]);
bag.sshCheckedSet = sshCheckedSet as typeof bag.sshCheckedSet;


  const sshToggleChecked = (id: string) => bag.setSshChecked((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
bag.sshToggleChecked = sshToggleChecked as typeof bag.sshToggleChecked;



  async function saveSshEntry() {
    if (!bag.sshDraft || !bag.sshDraftValid(bag.sshDraft)) return;
    bag.setSshSaving(true);
    try {
      const servers = await window.codex.saveSshServer({
        ...bag.sshDraft,
        tags: (bag.sshDraft.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
        jumpHost: bag.sshDraft.jumpHost?.host?.trim() ? bag.sshDraft.jumpHost : null,
      });
      bag.setSshServers(servers);
      bag.setSshDraft(null);
      bag.setNotice(`SSH 服务器「${bag.sshDraft.name}」已保存`);
    } catch (error: any) { bag.setNotice(`保存 SSH 服务器失败：${error.message}`); }
    finally { bag.setSshSaving(false); }
  }
bag.saveSshEntry = saveSshEntry as typeof bag.saveSshEntry;



  /** 编辑器内测试：直接拿草稿去连，不落盘，方便边填边验证 */
  async function testSshDraft() {
    if (!bag.sshDraft || !bag.sshDraftValid(bag.sshDraft)) return;
    bag.setSshTestingId("draft");
    bag.setSshEditorTest(null);
    try {
      const result = await window.codex.testSshServer(bag.sshDraft);
      bag.setSshEditorTest({
        ok: result.ok,
        message: result.ok
          ? `连接成功（${result.latencyMs ?? "?"}ms）${result.serverInfo?.os ? ` · ${result.serverInfo.os}` : ""}${result.serverInfo?.hostname ? ` · ${result.serverInfo.hostname}` : ""}`
          : `连接失败：${result.error ?? "未知错误"}`,
      });
    } catch (error: any) {
      bag.setSshEditorTest({ ok: false, message: `测试失败：${error.message}` });
    } finally { bag.setSshTestingId(null); }
  }
bag.testSshDraft = testSshDraft as typeof bag.testSshDraft;



  async function toggleSshEntry(server: SshServer, next: boolean) {
    bag.setSshBusyId(server.id);
    try {
      const servers = await window.codex.setSshServersEnabled([server.id], next);
      bag.setSshServers(servers);
      bag.setNotice(`SSH 服务器「${server.name}」已${next ? "启用" : "停用"}`);
    } catch (error: any) { bag.setNotice(`切换 SSH 服务器状态失败：${error.message}`); }
    finally { bag.setSshBusyId(null); }
  }
bag.toggleSshEntry = toggleSshEntry as typeof bag.toggleSshEntry;



  /** 批量启停：勾选集为空时直接返回，避免空请求 */
  async function toggleSshBatch(next: boolean) {
    if (!bag.sshChecked.length) return;
    bag.setSshBatchBusy(true);
    try {
      bag.setSshServers(await window.codex.setSshServersEnabled(bag.sshChecked, next));
      bag.setNotice(`已${next ? "启用" : "停用"} ${bag.sshChecked.length} 台 SSH 服务器`);
      bag.setSshChecked([]);
    } catch (error: any) { bag.setNotice(`批量${next ? "启用" : "停用"}失败：${error.message}`); }
    finally { bag.setSshBatchBusy(false); }
  }
bag.toggleSshBatch = toggleSshBatch as typeof bag.toggleSshBatch;



  /** 连接测试：成功后回写延迟/指纹/远端系统信息，失败回写错误原因，卡片常驻显示 */
  async function testSshEntry(server: SshServer, silent = false) {
    bag.setSshTestingId(server.id);
    try {
      const result = await window.codex.testSshServer(server);
      const servers = await window.codex.saveSshServer({
        ...server,
        lastTestAt: new Date().toISOString(),
        lastTestOk: result.ok,
        lastTestError: result.ok ? "" : (result.error ?? "未知错误"),
        lastTestLatencyMs: result.latencyMs,
        lastFingerprint: result.fingerprint,
        lastServerInfo: result.serverInfo,
        lastConnectedAt: result.ok ? new Date().toISOString() : server.lastConnectedAt,
      });
      bag.setSshServers(servers);
      if (!silent) {
        if (result.ok) bag.setNotice(`SSH 服务器「${server.name}」连接成功（${result.latencyMs ?? "?"}ms）`);
        else bag.setNotice(`SSH 服务器「${server.name}」连接失败：${result.error ?? "未知错误"}`);
      }
      return result;
    } catch (error: any) {
      if (!silent) bag.setNotice(`测试 SSH 连接失败：${error.message}`);
      return { ok: false as const, error: error.message };
    } finally { bag.setSshTestingId(null); }
  }
bag.testSshEntry = testSshEntry as typeof bag.testSshEntry;



  async function testSshBatch() {
    if (!bag.sshChecked.length) return;
    bag.setSshBatchBusy(true);
    const targets = bag.sshServers.filter((server) => bag.sshChecked.includes(server.id));
    let passed = 0;
    for (const server of targets) {
      const result = await bag.testSshEntry(server, true);
      if (result.ok) passed += 1;
    }
    bag.setNotice(`批量测试完成：${passed}/${targets.length} 台连通`);
    bag.setSshBatchBusy(false);
  }
bag.testSshBatch = testSshBatch as typeof bag.testSshBatch;



  async function removeSshEntries(ids: string[]) {
    if (!ids.length) return;
    bag.setSshBatchBusy(true);
    try {
      bag.setSshServers(await window.codex.deleteSshServers(ids));
      bag.setSshChecked((current) => current.filter((id) => !ids.includes(id)));
      bag.setNotice(ids.length > 1 ? `已删除 ${ids.length} 台 SSH 服务器` : `SSH 服务器已删除`);
    } catch (error: any) { bag.setNotice(`删除 SSH 服务器失败：${error.message}`); }
    finally { bag.setSshBatchBusy(false); }
  }
bag.removeSshEntries = removeSshEntries as typeof bag.removeSshEntries;



  /** 复制连接：以「副本」形式新建，凭据一并复制，方便改几个字段就能连第二台机器 */
  async function duplicateSshEntry(server: SshServer) {
    try {
      const servers = await window.codex.saveSshServer({
        ...server,
        id: "",
        name: `${server.name} 副本`,
        createdAt: "",
        lastTestAt: undefined,
        lastTestOk: undefined,
        lastTestError: "",
        lastFingerprint: undefined,
        lastServerInfo: undefined,
        lastConnectedAt: undefined,
      });
      bag.setSshServers(servers);
      bag.setNotice(`已复制为「${server.name} 副本」`);
    } catch (error: any) { bag.setNotice(`复制 SSH 连接失败：${error.message}`); }
  }
bag.duplicateSshEntry = duplicateSshEntry as typeof bag.duplicateSshEntry;



  async function toggleSshFavorite(server: SshServer) {
    try {
      bag.setSshServers(await window.codex.saveSshServer({ ...server, favorite: !server.favorite }));
    } catch (error: any) { bag.setNotice(`收藏失败：${error.message}`); }
  }
bag.toggleSshFavorite = toggleSshFavorite as typeof bag.toggleSshFavorite;



  /** 导出：默认剔除密码/私钥，需要迁移机器时可勾选「包含凭据」 */
  async function exportSshEntries(includeSecrets: boolean) {
    const targets = bag.sshChecked.length ? bag.sshServers.filter((server) => bag.sshChecked.includes(server.id)) : bag.sshServers;
    if (!targets.length) { bag.setNotice("没有可导出的 SSH 连接"); return; }
    const path = await window.codex.exportSshServers(targets, includeSecrets);
    if (path) bag.setNotice(`已导出 ${targets.length} 台 SSH 服务器到 ${path}`);
  }
bag.exportSshEntries = exportSshEntries as typeof bag.exportSshEntries;



  async function importSshEntries() {
    bag.setSshBatchBusy(true);
    try {
      const servers = await window.codex.importSshServers();
      if (!servers) { bag.setSshBatchBusy(false); return; }
      bag.setSshServers(servers);
      bag.setNotice(`SSH 连接导入完成，当前共 ${servers.length} 台`);
    } catch (error: any) { bag.setNotice(`导入失败：${error.message}`); }
    finally { bag.setSshBatchBusy(false); }
  }
bag.importSshEntries = importSshEntries as typeof bag.importSshEntries;



  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (!localStorage.getItem("sidebar-default-expanded-v1")) {
      localStorage.setItem("sidebar-default-expanded-v1", "true");
      localStorage.setItem("sidebar-collapsed", "false");
      return false;
    }
    return localStorage.getItem("sidebar-collapsed") === "true";
  });
bag.sidebarCollapsed = sidebarCollapsed as typeof bag.sidebarCollapsed; bag.setSidebarCollapsed = setSidebarCollapsed as typeof bag.setSidebarCollapsed;



  const [rightTab, setRightTab] = useState<string>(() => "");
bag.rightTab = rightTab as typeof bag.rightTab; bag.setRightTab = setRightTab as typeof bag.setRightTab;


  const [openTabs, setOpenTabs] = useState<{ key: string; name: string }[]>([]);
bag.openTabs = openTabs as typeof bag.openTabs; bag.setOpenTabs = setOpenTabs as typeof bag.setOpenTabs;


  const [recentlyClosed, setRecentlyClosed] = useState<{ key: string; name: string; at: number }[]>([]);
bag.recentlyClosed = recentlyClosed as typeof bag.recentlyClosed; bag.setRecentlyClosed = setRecentlyClosed as typeof bag.setRecentlyClosed;


  const [switcherOpen, setSwitcherOpen] = useState(false);
bag.switcherOpen = switcherOpen as typeof bag.switcherOpen; bag.setSwitcherOpen = setSwitcherOpen as typeof bag.setSwitcherOpen;


  const [switcherQuery, setSwitcherQuery] = useState("");
bag.switcherQuery = switcherQuery as typeof bag.switcherQuery; bag.setSwitcherQuery = setSwitcherQuery as typeof bag.setSwitcherQuery;


  const [goalsExpanded, setGoalsExpanded] = useState(false);
bag.goalsExpanded = goalsExpanded as typeof bag.goalsExpanded; bag.setGoalsExpanded = setGoalsExpanded as typeof bag.setGoalsExpanded;
  return { engineVersion, setEngineVersion, engineCheck, setEngineCheck, engineUpdating, setEngineUpdating, engineUpdateLog, setEngineUpdateLog, engineUpdatePercent, setEngineUpdatePercent, engineUpdateStageText, setEngineUpdateStageText, engineUpdateResult, setEngineUpdateResult, relaunchCountdown, setRelaunchCountdown, checkEngineUpdateNow, performEngineUpdateNow, emptySshJump, emptySshDraft, sshDraftIssues, sshDraftValid, sshVisible, sshCheckedSet, sshToggleChecked, saveSshEntry, testSshDraft, toggleSshEntry, toggleSshBatch, testSshEntry, testSshBatch, removeSshEntries, duplicateSshEntry, toggleSshFavorite, exportSshEntries, importSshEntries, sidebarCollapsed, setSidebarCollapsed, rightTab, setRightTab, openTabs, setOpenTabs, recentlyClosed, setRecentlyClosed, switcherOpen, setSwitcherOpen, switcherQuery, setSwitcherQuery, goalsExpanded, setGoalsExpanded };
}
