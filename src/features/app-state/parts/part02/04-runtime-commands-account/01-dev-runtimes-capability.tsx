/**
 * usePart02d1 —— usePart02d 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：开发运行时与能力快照 · 命令/钩子/项目账户
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import type { Bag } from "../../bag-types";

export function usePart02d1(bag: Bag) {
  // 下载速度（09-20 用户要求「把下载速度显示」）：主进程按 500ms 采样输出文件大小算好速率后下发，
  // 形如 "1.2 MB/s · 45.3 MB / 350 MB" —— 这里原样显示，不做二次加工。
  const [runtimeSpeed, setRuntimeSpeed] = useState<Record<string, string>>({});
bag.runtimeSpeed = runtimeSpeed as typeof bag.runtimeSpeed; bag.setRuntimeSpeed = setRuntimeSpeed as typeof bag.setRuntimeSpeed;


  /** 最近一次进度事件对应的工具 id（体检弹窗/角标据此显示"当前在装哪一个"的进度） */
  const [runtimeActiveId, setRuntimeActiveId] = useState<string>("");
bag.runtimeActiveId = runtimeActiveId as typeof bag.runtimeActiveId; bag.setRuntimeActiveId = setRuntimeActiveId as typeof bag.setRuntimeActiveId;


  // 安装/卸载的内置弹窗（替代 window.confirm——浏览器原生 confirm 会抢焦点且打断输入框）
  const [runtimeModal, setRuntimeModal] = useState<{ id: string; name: string; mode: "install" | "uninstall"; done: boolean; failed: boolean } | null>(null);
bag.runtimeModal = runtimeModal as typeof bag.runtimeModal; bag.setRuntimeModal = setRuntimeModal as typeof bag.setRuntimeModal;


  const refreshDevRuntimes = () => { window.codex.listRuntimes().then(bag.setDevRuntimes).catch(() => bag.setDevRuntimes([])); };
bag.refreshDevRuntimes = refreshDevRuntimes as typeof bag.refreshDevRuntimes;


  /** 「当前能力链路」（09-21）：同一件事有多个后端时，现在实际走哪条。
   *  数据来自 `capabilities:snapshot` —— 判据的唯一来源是 electron/capability-registry.ts
   *  （⛔ 前端不许自己算，否则又变成"界面说的"和"实际走的"两套）。 */
  const [capabilityRows, setCapabilityRows] = useState<{
    id: string; label: string; purpose: string;
    activeId: string | null; activeLabel: string; activeWhy: string;
    alternatives: { id: string; label: string; available: boolean }[];
    note: string;
  }[]>([]);
bag.capabilityRows = capabilityRows as typeof bag.capabilityRows; bag.setCapabilityRows = setCapabilityRows as typeof bag.setCapabilityRows;


  /** 读取失败的原因（非空时界面直接显示它）。
   *  ⛔ 为什么要有：只 catch 成空数组的话，界面会永远停在「读取中…」—— 那是个**说谎的状态**
   *  （看的人会一直等）。失败就把话说明白。 */
  const [capabilityError, setCapabilityError] = useState("");
bag.capabilityError = capabilityError as typeof bag.capabilityError; bag.setCapabilityError = setCapabilityError as typeof bag.setCapabilityError;


  const refreshCapabilities = () => {
    window.codex.capabilitiesSnapshot()
      .then((snapshot) => { bag.setCapabilityRows(snapshot.capabilities); bag.setCapabilityError(""); })
      .catch((error: any) => { bag.setCapabilityRows([]); bag.setCapabilityError(`读取失败：${error?.message ?? "未知错误"}`); });
  };
bag.refreshCapabilities = refreshCapabilities as typeof bag.refreshCapabilities;


  useEffect(() => window.codex.onRuntimeProgress((event) => {
    // auto = 主进程监视到 tools 目录变化（引擎自己装了工具）→ 静默刷新清单与状态，
    // 不动「正在安装」指示（那是按钮安装路径的专属状态）
    if (event.auto) { bag.refreshDevRuntimes(); bag.refreshToolsStatus(); return; }
    bag.setRuntimeActiveId(event.id);
    if (typeof event.percent === "number") bag.setRuntimePercent((current) => ({ ...current, [event.id]: event.percent as number }));
    if (event.stage) bag.setRuntimeStage((current) => ({ ...current, [event.id]: String(event.stage) }));
    if (typeof event.speed === "string") bag.setRuntimeSpeed((current) => ({ ...current, [event.id]: event.speed as string }));
    if (event.message) {
      const text = String(event.message);
      bag.setRuntimeProgress((current) => ({ ...current, [event.id]: text.split(/\r?\n/).at(-1) || text }));
    }
    if (event.done) {
      bag.setRuntimePercent((current) => ({ ...current, [event.id]: 100 }));
      // 速度是「下载中」的瞬时量：收尾就清掉，免得下一次安装一打开弹窗还挂着上次的速率
      bag.setRuntimeSpeed((current) => ({ ...current, [event.id]: "" }));
      bag.setRuntimeInstalling(null); bag.refreshDevRuntimes();
      // 首次启动的 Git 自动安装（后台跑的，用户可能没开开发工具页）：完成/失败都弹一条通知
      if (event.id === "git" && String(event.message ?? "").includes("自动")) bag.setNotice(String(event.message));
    }
  }), []);


  // 引擎重启被闸门推迟/补做（09-19）：说清楚"改动已保存，但等当前任务跑完才生效"——
  // 否则用户改完配置看不到生效，会以为没保存成功（这一条是闸门的必要配套）。
  useEffect(() => {
    const off = window.codex.onEngineRestartDeferred?.((event) => {
      if (event.waiting) {
        bag.setNotice(`改动已保存，将在当前任务结束后生效${event.activeTurns ? `（还有 ${event.activeTurns} 个任务在跑，不会打断它们）` : ""}`);
      } else {
        bag.setNotice("任务已结束，引擎已按你的改动重新加载");
      }
    });
    return () => { try { off?.(); } catch { /* 忽略 */ } };
  }, []);


  async function installDevRuntime(id: string) {
    bag.setRuntimeInstalling(id);
    bag.setRuntimeProgress((current) => ({ ...current, [id]: "准备下载…" }));
    bag.setRuntimeModal({ id, name: bag.devRuntimes.find((r) => r.id === id)?.name ?? id, mode: "install", done: false, failed: false });
    try {
      const result = await window.codex.installRuntime(id);
      bag.setDevRuntimes(result.runtimes);
      // 同步能力总闸联动开关（桌面/浏览器自动化）与工具状态，安装后立即生效
      await Promise.all([bag.refreshSettingsResources(), bag.refreshToolsStatus()]);
      bag.setRuntimeModal((m) => m ? { ...m, done: true } : m);
      bag.setRuntimeProgress((current) => ({ ...current, [id]: "安装完成" }));
      bag.setNotice("开发工具安装成功，Codex 引擎已刷新");
    } catch (error: any) {
      bag.setRuntimeModal((m) => m ? { ...m, done: true, failed: true } : m);
      bag.setRuntimeProgress((current) => ({ ...current, [id]: `安装失败：${error.message}` }));
      bag.setNotice(`开发工具安装失败：${error.message}`);
    } finally {
      bag.setRuntimeInstalling(null);
    }
  }
bag.installDevRuntime = installDevRuntime as typeof bag.installDevRuntime;



  async function uninstallDevRuntime(id: string) {
    const spec = bag.devRuntimes.find((r) => r.id === id);
    // 内置 / 随包资源 / 系统级安装都不允许卸载（UI 也不出按钮，这里是第二道防线）
    if (!spec || spec.builtIn || spec.noUninstall) return;
    bag.setRuntimeInstalling(id);
    bag.setRuntimeProgress((current) => ({ ...current, [id]: "正在卸载…" }));
    bag.setRuntimeModal({ id, name: spec.name, mode: "uninstall", done: false, failed: false });
    try {
      const result = await window.codex.uninstallRuntime(id);
      bag.setDevRuntimes(result.runtimes);
      await Promise.all([bag.refreshSettingsResources(), bag.refreshToolsStatus()]);
      bag.setRuntimeModal((m) => m ? { ...m, done: true } : m);
      bag.setRuntimeProgress((current) => ({ ...current, [id]: "卸载完成" }));
      bag.setNotice(`已卸载「${spec.name}」`);
    } catch (error: any) {
      bag.setRuntimeModal((m) => m ? { ...m, done: true, failed: true } : m);
      bag.setRuntimeProgress((current) => ({ ...current, [id]: `卸载失败：${error.message}` }));
      bag.setNotice(`卸载失败：${error.message}`);
    } finally {
      bag.setRuntimeInstalling(null);
    }
  }
bag.uninstallDevRuntime = uninstallDevRuntime as typeof bag.uninstallDevRuntime;


  useEffect(() => { if (bag.settingsOpen) bag.refreshToolsStatus(); }, [bag.settingsOpen]);


  useEffect(() => { if (bag.settingsOpen && bag.settingsPage === "devtools") bag.refreshDevRuntimes(); }, [bag.settingsOpen, bag.settingsPage]);


  // 进入「开发工具」页时同时刷一次能力链路（装/卸工具会改变"现在走哪条"：例如装上 playwright-cli 后
  // 浏览器自动化就多了条兜底路径）
  useEffect(() => { if (bag.settingsOpen && bag.settingsPage === "devtools") bag.refreshCapabilities(); }, [bag.settingsOpen, bag.settingsPage]);


  // 进入「SSH 服务器」分区时拉取一次服务器列表
  useEffect(() => {
    if (bag.settingsOpen && bag.settingsPage === "ssh" && !bag.sshLoaded) {
      void window.codex.listSshServers().then((servers) => { bag.setSshServers(servers); bag.setSshLoaded(true); }).catch(() => bag.setSshLoaded(true));
    }
  }, [bag.settingsOpen, bag.settingsPage, bag.sshLoaded]);


  const [settingsResources, setSettingsResources] = useState<{ skills: any[]; hooks: any[]; plugins: any[]; mcp: any[] }>({ skills: [], hooks: [], plugins: [], mcp: [] });
bag.settingsResources = settingsResources as typeof bag.settingsResources; bag.setSettingsResources = setSettingsResources as typeof bag.setSettingsResources;


  const installedTotalCount = useMemo(() => {
    const localNames = new Set(bag.localSkills.map((entry) => entry.name.toLowerCase()));
    const localByPath = new Set(bag.localSkills.map((entry) => entry.path));
    const builtin = bag.settingsResources.skills.filter((entry: any) => !localByPath.has(entry.path) && !localNames.has((entry.name ?? "").toLowerCase()));
    return builtin.length + bag.localSkills.length;
  }, [bag.localSkills, bag.settingsResources.skills]);
bag.installedTotalCount = installedTotalCount as typeof bag.installedTotalCount;


  const [resourceLoading, setResourceLoading] = useState(false);
bag.resourceLoading = resourceLoading as typeof bag.resourceLoading; bag.setResourceLoading = setResourceLoading as typeof bag.setResourceLoading;


  const [resourceError, setResourceError] = useState("");
bag.resourceError = resourceError as typeof bag.resourceError; bag.setResourceError = setResourceError as typeof bag.setResourceError;


  const [pluginSearch, setPluginSearch] = useState("");
bag.pluginSearch = pluginSearch as typeof bag.pluginSearch; bag.setPluginSearch = setPluginSearch as typeof bag.setPluginSearch;


  const [pluginInstalledOnly, setPluginInstalledOnly] = useState(false);
bag.pluginInstalledOnly = pluginInstalledOnly as typeof bag.pluginInstalledOnly; bag.setPluginInstalledOnly = setPluginInstalledOnly as typeof bag.setPluginInstalledOnly;


  const [pluginBusy, setPluginBusy] = useState<string | null>(null);
bag.pluginBusy = pluginBusy as typeof bag.pluginBusy; bag.setPluginBusy = setPluginBusy as typeof bag.setPluginBusy;


  const [pluginBatchBusy, setPluginBatchBusy] = useState<"enable" | "disable" | null>(null);
bag.pluginBatchBusy = pluginBatchBusy as typeof bag.pluginBatchBusy; bag.setPluginBatchBusy = setPluginBatchBusy as typeof bag.setPluginBatchBusy;


  const [skillBatchBusy, setSkillBatchBusy] = useState<"enable" | "disable" | null>(null);
bag.skillBatchBusy = skillBatchBusy as typeof bag.skillBatchBusy; bag.setSkillBatchBusy = setSkillBatchBusy as typeof bag.setSkillBatchBusy;


  // 勾选集合：批量操作只作用于勾选的条目，而不是「当前筛选出的全部」
  const [pluginChecked, setPluginChecked] = useState<string[]>([]);
bag.pluginChecked = pluginChecked as typeof bag.pluginChecked; bag.setPluginChecked = setPluginChecked as typeof bag.setPluginChecked;


  const [skillChecked, setSkillChecked] = useState<string[]>([]);
bag.skillChecked = skillChecked as typeof bag.skillChecked; bag.setSkillChecked = setSkillChecked as typeof bag.setSkillChecked;


  const [skillManageSearch, setSkillManageSearch] = useState("");
bag.skillManageSearch = skillManageSearch as typeof bag.skillManageSearch; bag.setSkillManageSearch = setSkillManageSearch as typeof bag.setSkillManageSearch;


  // —— 命令页（复刻 WorkBuddy 命令界面）：内置 + 自定义 + 技能 ——
  const [customCommands, setCustomCommands] = useState<CustomCommandEntry[]>([]);
bag.customCommands = customCommands as typeof bag.customCommands; bag.setCustomCommands = setCustomCommands as typeof bag.setCustomCommands;


  const [commandSearch, setCommandSearch] = useState("");
bag.commandSearch = commandSearch as typeof bag.commandSearch; bag.setCommandSearch = setCommandSearch as typeof bag.setCommandSearch;


  const [commandFilter, setCommandFilter] = useState<"all" | "custom" | "builtin" | "skill">("all");
bag.commandFilter = commandFilter as typeof bag.commandFilter; bag.setCommandFilter = setCommandFilter as typeof bag.setCommandFilter;


  const [commandBusy, setCommandBusy] = useState(false);
bag.commandBusy = commandBusy as typeof bag.commandBusy; bag.setCommandBusy = setCommandBusy as typeof bag.setCommandBusy;


  const [commandEditor, setCommandEditor] = useState<{ mode: "new" | "edit"; name: string; source: CommandSource; description: string; argumentHint: string; allowedTools: string; model: string; body: string; prevFilePath?: string } | null>(null);
bag.commandEditor = commandEditor as typeof bag.commandEditor; bag.setCommandEditor = setCommandEditor as typeof bag.setCommandEditor;


  const [commandDelete, setCommandDelete] = useState<CustomCommandEntry | null>(null);
bag.commandDelete = commandDelete as typeof bag.commandDelete; bag.setCommandDelete = setCommandDelete as typeof bag.setCommandDelete;


  const [commandBusyKey, setCommandBusyKey] = useState<string | null>(null);
bag.commandBusyKey = commandBusyKey as typeof bag.commandBusyKey; bag.setCommandBusyKey = setCommandBusyKey as typeof bag.setCommandBusyKey;


  const refreshCommands = useCallback(async () => {
    bag.setCommandBusy(true);
    try { bag.setCustomCommands(await window.codex.listCommands({ cwd: bag.workspace ?? undefined })); }
    catch (error: any) { bag.setNotice(`命令列表加载失败：${error.message}`); }
    finally { bag.setCommandBusy(false); }
  }, [bag.workspace, bag.setNotice]);
bag.refreshCommands = refreshCommands as typeof bag.refreshCommands;


  useEffect(() => { if (bag.settingsOpen) void bag.refreshCommands(); }, [bag.settingsOpen, bag.workspace, bag.refreshCommands]);
  return { runtimeSpeed, setRuntimeSpeed, runtimeActiveId, setRuntimeActiveId, runtimeModal, setRuntimeModal, refreshDevRuntimes, capabilityRows, setCapabilityRows, capabilityError, setCapabilityError, refreshCapabilities, installDevRuntime, uninstallDevRuntime, settingsResources, setSettingsResources, installedTotalCount, resourceLoading, setResourceLoading, resourceError, setResourceError, pluginSearch, setPluginSearch, pluginInstalledOnly, setPluginInstalledOnly, pluginBusy, setPluginBusy, pluginBatchBusy, setPluginBatchBusy, skillBatchBusy, setSkillBatchBusy, pluginChecked, setPluginChecked, skillChecked, setSkillChecked, skillManageSearch, setSkillManageSearch, customCommands, setCustomCommands, commandSearch, setCommandSearch, commandFilter, setCommandFilter, commandBusy, setCommandBusy, commandEditor, setCommandEditor, commandDelete, setCommandDelete, commandBusyKey, setCommandBusyKey, refreshCommands };
}
