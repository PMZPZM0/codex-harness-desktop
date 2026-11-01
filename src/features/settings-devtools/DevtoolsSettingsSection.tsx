/**
 * 设置页 · devtools（10-10 两级 IA；11-01 用户令：**工具分类做一级，明细进二级**）。
 *
 * ⛔ 11-01 改版（用户原话）：「把这个工具分类，改成外面只展示分类名字，二级弹窗预览内容，
 *   预览里面可以手动下载，外面卡片就是一键安装；做好下载/安装/卸载进度条，下载中和安装中可取消」。
 *   ⇒ 一级页不再有「运行时与工具链」这张总卡：7 个工具分类（基础运行时 / 桌面与浏览器自动化 /
 *   开发工具链 / 媒体与文档 / 本地智能 / 系统级安装 / 其它按需下载）+「工具自检与清单」直接成卡；
 *   每张分类卡带「一键安装（N）」，点卡进二级弹窗逐项手动下载 / 卸载 / 取消。
 *
 * ⛔ 两级 IA 契约不变（守卫【dtIA】）：一级只渲染分类卡片，面板内容只在 SettingsDialog 里出现。
 * ⛔ 一键安装的批处理状态挂在**本页**（不在弹窗里）：关掉弹窗后循环要继续、卡片上要看得到进度与取消。
 * ⛔ 两个声明式插槽 id 没改（`settings.devtools.bottom` / `settings.devtools.declared-plugins`）：
 *   它们是 electron/declared-plugins.ts 的 KNOWN_SLOTS 白名单项、也是用户 JSON 插件能挂的位置。
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Activity, AlertTriangle, Bot, Boxes, Brain, ChevronRight, CircleCheck, Copy, Files, Film, Music2, PackageOpen, Puzzle, Smartphone, Trash2, X } from "lucide-react";
import { SettingsDialog } from "../../components/SettingsDialog";
import { copyTextToClipboard } from "../../lib/clipboard";
import { Slot } from "../../runtime/Slot";
import { RuntimeToolsPanel } from "./RuntimeToolsPanel";
import { MediaPlayerCard } from "./MediaPlayerCard";
import { ToolsHealthPanel } from "./ToolsHealthPanel";
import { CapabilityChainPanel } from "./CapabilityChainPanel";
import { PhoneHarnessCard } from "./PhoneHarnessCard";
import { LayaCard } from "./LayaCard";
import { OpenfilmCard } from "../openfilm";
import { MoeKoeCard } from "./MoeKoeCard";
import { FeishuCliCard } from "./FeishuCliCard";
import { FileeCard } from "./FileeCard";
import { SkillPacksPanel } from "../skill-packs";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";
import { RUNTIME_GROUPS, groupOfCardKey, isInstallable, isRemovable, readyLabel, runtimeGroupItems, type RuntimeBatch, type RuntimeGroup, type RuntimeRow } from "./runtime-groups";

export type DevtoolsSettingsSectionProps = { downloadSource?: any; capabilityRows: any; capabilityError: any; setNotice: any; devRuntimes: any; runtimeInstalling: any; runtimeUninstalling: any; runtimePercent: any; runtimeStage: any; runtimeSpeed: any; runtimeProgress: any; installDevRuntime: any; uninstallDevRuntime: any; cancelDevRuntime: any; runtimeModal: any; setRuntimeModal: any; };

/** 一级卡片的 key —— 也是弹窗的开关值（同时只开一个）。 */
type DevtoolsCardKey = "tools-health" | "skill-packs" | "moekoe" | "capability" | "phone" | "laya" | "feishu-cli" | "filee" | "openfilm" | "domains" | "plugins" | `tools-${RuntimeGroup["key"]}`;

type CardSpec = { key: DevtoolsCardKey; icon: ReactNode; title: string; desc: string; stat: string; group?: RuntimeGroup };

function CardBody({ card, onOpen }: { card: CardSpec; onOpen: () => void }) {
  return (
    <button type="button" className="devtools-card-open" onClick={onOpen} aria-label={`打开${card.title}`}>
      <span className="devtools-card-logo">{card.icon}</span>
      <span className="devtools-card-copy">
        <strong>{card.title}</strong>
        <small>{card.desc}</small>
        <span className="devtools-card-stat">{card.stat}</span>
      </span>
      <ChevronRight size={15} className="devtools-card-arrow" />
    </button>
  );
}

export function DevtoolsSettingsSection(props: DevtoolsSettingsSectionProps) {
  const { capabilityRows, capabilityError, setNotice, devRuntimes, runtimeInstalling, runtimeUninstalling, runtimePercent, runtimeStage, runtimeSpeed, runtimeProgress, installDevRuntime, uninstallDevRuntime, cancelDevRuntime, runtimeModal, setRuntimeModal } = props;
  const [openCard, setOpenCard] = useState<DevtoolsCardKey | null>(null);
  /* 分类卡「一键卸载」的确认（真删本地文件，不可恢复）：卡片上直接点 → 弹确认 → 才执行。 */
  const [confirmCardUninstall, setConfirmCardUninstall] = useState<{ card: string; title: string; list: RuntimeRow[] } | null>(null);
  const runtimes = (Array.isArray(devRuntimes) ? devRuntimes : []) as RuntimeRow[];

  /* ── 一键安装 / 一键卸载（串行、可取消）────────────────────────────────────
     ⛔ 必须挂在本页：放在弹窗里的话，用户关窗后组件卸载，循环还在跑却看不到进度、也点不到取消。
     串行而非并发：两个工具同时解压会互相踩 staging 目录。 */
  const [batch, setBatch] = useState<RuntimeBatch>({ kind: null, done: 0, total: 0, id: "", name: "", card: "" });
  const batchRunning = useRef(false);
  const batchCancel = useRef(false);
  const runBatch = async (kind: "install" | "uninstall", list: RuntimeRow[], cardKey: string) => {
    if (!list.length || batchRunning.current) return;
    batchRunning.current = true;
    batchCancel.current = false;
    const progress = (i: number) => setBatch({ kind, done: i, total: list.length, id: list[i]?.id ?? "", name: list[i]?.name ?? "", card: cardKey });
    progress(0);
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < list.length; i += 1) {
      if (batchCancel.current) break;
      progress(i);
      try {
        /* ⛔ 11-01 用户实测「安装失败却在顶部报安装完成：成功 1/1」：
           install/uninstallDevRuntime 内部 catch 了错误、**不抛** ⇒ 这里必须按返回值计数。 */
        const succeeded = kind === "install" ? await installDevRuntime(list[i].id) : await uninstallDevRuntime(list[i].id);
        if (succeeded === false) failed += 1; else ok += 1;
      } catch { failed += 1; /* 单项失败不中断整批 */ }
    }
    batchRunning.current = false;
    setBatch({ kind: null, done: 0, total: 0, id: "", name: "", card: "" });
    const cancelled = batchCancel.current;
    batchCancel.current = false;
    const label = kind === "install" ? "安装" : "卸载";
    setNotice(cancelled
      ? `已取消：完成 ${ok} / ${list.length}${failed ? `，失败 ${failed}` : ""}`
      : `${label}完成：成功 ${ok} / ${list.length}${failed ? `，失败 ${failed}` : ""}`);
  };
  const cancelBatch = () => {
    batchCancel.current = true;
    // 只有安装/下载能取消（runtime:cancel 只认安装进程）；卸载只能等它删完。
    if (batch.kind === "install" && batch.id) void cancelDevRuntime(batch.id);
  };

  /* 精选技能包（10-30）：卡片上写错状态比不写更糟；关掉面板时再刷新。 */
  const [skillPackStat, setSkillPackStat] = useState<string>("读取中…");
  useEffect(() => {
    window.codex.listSkillPacks()
      .then((rows) => {
        const installed = rows.filter((row) => row.installed).length;
        setSkillPackStat(installed ? `已装 ${installed} / ${rows.length} 个包` : `未安装 · ${rows.length} 个可选`);
      })
      .catch(() => setSkillPackStat("读取中…"));
  }, [openCard]);

  /* 安装/卸载失败的「完整报错」弹窗（10-11）：多行报错原文完整展示（pre-wrap 可滚动），
     单行 toast 只承载摘要。⛔ 层级 950 > SettingsDialog 的 900；Esc 走全局 ESC 栈（只关最上层）。 */
  useEscapeLayer(Boolean(runtimeModal?.failed), () => setRuntimeModal(null));
  const failedPrompt: string = runtimeModal?.failed ? (runtimes.find((r) => r.id === runtimeModal.id)?.fallbackPrompt ?? "") : "";

  /* 工具分类卡片：分类名 + 一句定位 + 已就绪数；「一键安装」在卡片底部（只对可下载项生效）。 */
  const toolCards: CardSpec[] = RUNTIME_GROUPS.map((group) => {
    const items = runtimeGroupItems(group, runtimes);
    return { key: `tools-${group.key}` as DevtoolsCardKey, icon: group.icon, title: group.title, desc: group.desc, stat: runtimes.length ? readyLabel(items) : "正在读取状态…", group };
  });
  toolCards.push({ key: "tools-health", icon: <Activity size={15} />, title: "工具自检与清单", desc: "逐个验证已装工具能不能真跑；工具清单可整段复制给 Codex", stat: "点开逐个验证" });

  const moekoeRuntime = runtimes.find((row) => row.id === "moekoe");
  const otherCards: CardSpec[] = [
    { key: "skill-packs", icon: <PackageOpen size={15} />, title: "精选技能包", desc: "第三方技能：工程流程 / 图表设计 / 循证生活指南，装到本地技能目录", stat: skillPackStat },
    { key: "moekoe", icon: <Music2 size={15} />, title: "MoeKoe 音乐", desc: "外部酷狗客户端：Codex 通过 6521 API 搜歌/播放", stat: runtimeInstalling === "moekoe" ? "安装中…" : moekoeRuntime?.installed ? "已安装 · 可从 Codex 调用" : "未安装 · 点开安装" },
    { key: "capability", icon: <CircleCheck size={15} />, title: "当前能力链路", desc: "同一件事有多个后端时，现在实际走的是哪条", stat: capabilityRows.length ? `${capabilityRows.length} 项能力` : "正在读取状态…" },
    { key: "phone", icon: <Smartphone size={15} />, title: "手机控制", desc: "让 Codex 直接操作手机：看屏幕、点按、打字、读日志", stat: "Android（adb）· iPhone 需 mac" },
    { key: "laya", icon: <Brain size={15} />, title: "Laya 智能判断", desc: "思考等级「自动」档的本地决策端（Python）", stat: "本地 · 可选安装" },
    { key: "feishu-cli", icon: <Bot size={15} />, title: "飞书 CLI", desc: "官方命令行（@larksuite/cli）：让 Codex 代你操作飞书", stat: "按需安装 · 需登录一次" },
    { key: "filee", icon: <Files size={15} />, title: "Filee 文件转换", desc: "244 种格式本地离线互转（图片/PDF/Office/电子书/音视频/归档），不需要 Office", stat: "按需安装 · 完全离线 · 可卸载" },
    { key: "openfilm", icon: <Film size={15} />, title: "OpenFilm 视频剪辑", desc: "第三方开源（MIT）：让 Codex 直接剪片，Studio 里手改", stat: "按需下载 · 国内镜像加速 · 可卸载" },
    { key: "domains", icon: <Boxes size={15} />, title: "功能域", desc: "启用 / 停用功能板块（停用下次启动生效）", stat: "声明式插槽 · 可被插件替换" },
    { key: "plugins", icon: <Puzzle size={15} />, title: "声明式插件", desc: "只用 JSON 往插槽挂内容、调已有通道，无代码", stat: "放好即生效 · 无需重启" },
  ];
  const activeGroup = openCard ? groupOfCardKey(openCard) : undefined;
  const activeToolCard = toolCards.find((card) => card.key === openCard);
  const activeOtherCard = otherCards.find((card) => card.key === openCard);

  /** 卡片底部动作：批处理中 → 进度 + 取消；有可下载项 → 一键安装；否则留空。 */
  const renderCardAction = (card: CardSpec) => {
    if (!card.group) return null;
    const items = runtimeGroupItems(card.group, runtimes);
    const batching = batch.kind !== null && batch.card === card.key;
    const busyRow = items.find((row) => runtimeInstalling === row.id || runtimeUninstalling === row.id) ?? null;
    if (batching || busyRow) {
      const activeId = batching ? batch.id : busyRow?.id ?? "";
      const uninstalling = batching ? batch.kind === "uninstall" : runtimeUninstalling === busyRow?.id;
      const percent = Math.round(Number(runtimePercent?.[activeId] ?? 0));
      return (
        <div className="devtools-card-progress">
          <span className="devtools-card-progress-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${percent}%` }} />
          </span>
          <span className="devtools-card-progress-text">
            {batching
              ? `${uninstalling ? "卸载" : "安装"} ${Math.min(batch.done + 1, batch.total)}/${batch.total} · ${batch.name}`
              : `${uninstalling ? "卸载" : "安装"}中 · ${busyRow?.name ?? ""}`} · {percent}%
          </span>
          {uninstalling ? null : <button type="button" className="secondary-setting devtools-card-cancel" onClick={cancelBatch}>取消</button>}
        </div>
      );
    }
    const installables = items.filter(isInstallable);
    const removables = items.filter(isRemovable);
    if (!installables.length && !removables.length) return null;
    return (
      <div className="devtools-card-actions">
        {removables.length ? (
          <button type="button" className="secondary-setting devtools-card-uninstall" disabled={batch.kind !== null}
            title={batch.kind !== null ? "另一组正在安装/卸载，等它跑完再操作" : `卸载这一组已装的 ${removables.length} 项`}
            onClick={() => setConfirmCardUninstall({ card: card.key, title: card.title, list: removables })}>
            <Trash2 size={13} />一键卸载（{removables.length}）
          </button>
        ) : null}
        {installables.length ? (
          <button type="button" className="primary-setting devtools-card-install" disabled={batch.kind !== null}
            title={batch.kind !== null ? "另一组正在安装/卸载，等它跑完再装这一组" : undefined}
            onClick={() => void runBatch("install", installables, card.key)}>
            一键安装（{installables.length}）
          </button>
        ) : null}
      </div>
    );
  };

  /* CLI 智能体已挪到「设置 → 专家/专家团」（10-31 用户令：它是调度对象，不是开发工具）。 */

  return (
    <>
      <section className="settings-section stack">
        <p className="settings-card-hint">工具按用途分成 7 类：外面只看分类与就绪数，卡片上直接一键安装；点开卡片逐项手动下载 / 卸载，下载中可取消。</p>
        <div className="settings-subhead">工具链与运行时<span className="settings-subhead-hint">点分类看明细 · 卡片底部一键安装</span></div>
        <div className="devtools-cards" data-count={toolCards.length}>
          {toolCards.map((card) => (
            <div className="devtools-card" key={card.key} data-card={card.key}>
              <CardBody card={card} onOpen={() => setOpenCard(card.key)} />
              {renderCardAction(card)}
            </div>
          ))}
        </div>
        <div className="settings-subhead">拓展与集成<span className="settings-subhead-hint">点卡片打开详情</span></div>
        <div className="devtools-cards" data-count={otherCards.length}>
          {otherCards.map((card) => (
            <div className="devtools-card" key={card.key} data-card={card.key}>
              <CardBody card={card} onOpen={() => setOpenCard(card.key)} />
            </div>
          ))}
        </div>
        {/* 10-08 迁移：语音模型 / 音色克隆模型的选择项已搬到「设置 → 语音通话」——
            用户要求语音相关的东西集中在一处（音色 / 模型 / 播报 / 语速同页）。
            ⛔ 这里只留一句指路，不要再留第二份渲染（同一份状态两处渲染 = 双真相源）。 */}
        <p className="settings-card-hint">
          声明：影视源（LibreTV/TVBox）**仅用于第三方接口调用/检索与打开**，不内置、不下载、不缓存、不代理影视内容；本应用未收取费用、未对源站或内容进行二次创作，影视版权归源站及权利人，可用性由源站决定。
          <button
            type="button"
            className="secondary-setting"
            style={{ marginLeft: 8 }}
            onClick={() => { void window.codex.getUserData().then((dir) => window.codex.shellReveal(dir)).catch(() => undefined); }}
          >
            打开数据目录（media-sources.json）
          </button>
        </p>
        <p className="settings-card-hint">语音模型（识别 + 合成）与音色克隆模型已移到<strong>设置 → 语音通话</strong>，和音色、语速同页管理。</p>
      </section>

      {/* ── 二级：弹窗（内容一律在这里，⛔ 不内嵌到上面的一级页）────────────────── */}
      {activeGroup && activeToolCard && (
        <SettingsDialog title={activeGroup.title} icon={activeGroup.icon} hint={`${activeGroup.hint} · 逐项手动下载 / 卸载`} size="lg" onClose={() => setOpenCard(null)}>
          <RuntimeToolsPanel
            group={activeGroup}
            devRuntimes={runtimes}
            runtimeInstalling={runtimeInstalling} runtimeUninstalling={runtimeUninstalling}
            runtimePercent={runtimePercent} runtimeStage={runtimeStage} runtimeSpeed={runtimeSpeed} runtimeProgress={runtimeProgress}
            installDevRuntime={installDevRuntime} uninstallDevRuntime={uninstallDevRuntime} cancelDevRuntime={cancelDevRuntime}
            setNotice={setNotice} setRuntimeModal={setRuntimeModal} batch={batch} runBatch={runBatch}
          />
        </SettingsDialog>
      )}
      {openCard === "tools-health" && activeToolCard && (
        <SettingsDialog title={activeToolCard.title} icon={<Activity size={15} />} hint="真跑版本命令 · 清单可复制给 Codex" size="lg" onClose={() => setOpenCard(null)}>
          <ToolsHealthPanel devRuntimes={runtimes} setNotice={setNotice} />
        </SettingsDialog>
      )}
      {openCard === "openfilm" && activeOtherCard && (
        <SettingsDialog title={activeOtherCard.title} icon={<Film size={15} />} hint="第三方开源项目 · 按需下载 · 不随包分发" size="md" onClose={() => setOpenCard(null)}>
          <OpenfilmCard />
        </SettingsDialog>
      )}
      {openCard === "capability" && activeOtherCard && (
        <SettingsDialog title={activeOtherCard.title} icon={<CircleCheck size={15} />} hint="前端只渲染，判据来自 capability-registry" onClose={() => setOpenCard(null)}>
          <CapabilityChainPanel capabilityRows={capabilityRows} capabilityError={capabilityError} />
        </SettingsDialog>
      )}
      {openCard === "phone" && activeOtherCard && (
        <SettingsDialog title={activeOtherCard.title} icon={<Smartphone size={15} />} hint="装机 · 关遥测 · 注册技能 · 权限引导" onClose={() => setOpenCard(null)}>
          {/* 手机控制（09-27）：上游 phone-harness 是 Python CLI 不是 MCP 服务，
              所以不做连接器模板，做成工具卡：装机 + 关遥测 + 注册技能 + 权限引导。 */}
          <PhoneHarnessCard setNotice={setNotice} installDevRuntime={installDevRuntime} runtimeInstalling={runtimeInstalling} runtimePercent={runtimePercent} runtimeStage={runtimeStage} />
        </SettingsDialog>
      )}
      {openCard === "skill-packs" && activeOtherCard && (
        <SettingsDialog title={activeOtherCard.title} icon={<PackageOpen size={15} />} hint="技能包 · 国内镜像下载 · 装完自动重启引擎" size="md" onClose={() => setOpenCard(null)}>
          <SkillPacksPanel setNotice={setNotice} />
        </SettingsDialog>
      )}
      {openCard === "moekoe" && activeOtherCard && (
        <SettingsDialog title={activeOtherCard.title} icon={<Music2 size={15} />} hint="外部客户端 · 国内镜像安装 · 6521 API" size="lg" onClose={() => setOpenCard(null)}>
          <MoeKoeCard
            runtime={moekoeRuntime}
            installing={runtimeInstalling === "moekoe"}
            percent={runtimePercent?.["moekoe"]}
            stage={runtimeStage?.["moekoe"]}
            progress={runtimeProgress?.["moekoe"]}
            onInstall={() => installDevRuntime("moekoe")}
            setNotice={setNotice}
          />
        </SettingsDialog>
      )}
      {openCard === "laya" && activeOtherCard && (
        <SettingsDialog title={activeOtherCard.title} icon={<Brain size={15} />} hint="思考等级「自动」档的本地决策端" onClose={() => setOpenCard(null)}>
          {/* Laya 智能判断（10-01）：思考等级「自动」档的本地决策端（Python laya-serve）。 */}
          <LayaCard setNotice={setNotice} />
        </SettingsDialog>
      )}
      {openCard === "feishu-cli" && activeOtherCard && (
        <SettingsDialog title={activeOtherCard.title} icon={<Bot size={15} />} hint="安装 → 配置应用 → 登录（官方 device flow）" size="md" onClose={() => setOpenCard(null)}>
          <FeishuCliCard setNotice={setNotice} installDevRuntime={installDevRuntime} runtimeInstalling={runtimeInstalling} uninstallDevRuntime={uninstallDevRuntime} runtimeUninstalling={runtimeUninstalling} runtimeStage={runtimeStage} />
        </SettingsDialog>
      )}
      {openCard === "filee" && activeOtherCard && (
        <SettingsDialog title={activeOtherCard.title} icon={<Files size={15} />} hint="244 种格式 · 本地离线转换 · 装好就能说人话" size="md" onClose={() => setOpenCard(null)}>
          {/* Filee 文件转换（10-30，KnifeLemon/Filee，MIT）：安装走 runtime:install 的 GitHub 直下型分支。 */}
          <FileeCard setNotice={setNotice} installDevRuntime={installDevRuntime} runtimeInstalling={runtimeInstalling} uninstallDevRuntime={uninstallDevRuntime} runtimeUninstalling={runtimeUninstalling} runtimeStage={runtimeStage} />
        </SettingsDialog>
      )}
      {openCard === "domains" && activeOtherCard && (
        <SettingsDialog title={activeOtherCard.title} icon={<Boxes size={15} />} hint="停用是「下次启动生效」，不是立刻卸载" size="lg" onClose={() => setOpenCard(null)}>
          {/* ⛔ 插槽 id 与注册方式**都没变**（DomainsPanel 自己 registerSlot）——只是消费点从
              注册表移到了这里。守卫【268-c】：同一 id 全局只许被消费一次，所以一级页不放它。 */}
          <Slot id="settings.devtools.bottom" props={{ onNotice: setNotice }} loader={() => import("./DomainsPanel")} />
        </SettingsDialog>
      )}
      {openCard === "plugins" && activeOtherCard && (
        <SettingsDialog title={activeOtherCard.title} icon={<Puzzle size={15} />} hint="声明式：只描述挂什么、调哪条通道" size="lg" onClose={() => setOpenCard(null)}>
          {/* ⛔ 同上：`settings.devtools.declared-plugins` 是 KNOWN_SLOTS 白名单项，id 不动。 */}
          <Slot id="settings.devtools.declared-plugins" loader={() => import("./DeclaredPluginsPanel")} />
        </SettingsDialog>
      )}

      {/* 分类卡「一键卸载」确认（真删本地文件，不可恢复） */}
      {confirmCardUninstall && (
        <SettingsDialog title={`一键卸载 · ${confirmCardUninstall.title}`} icon={<Trash2 size={15} />} size="sm" onClose={() => setConfirmCardUninstall(null)}>
          <div className="settings-section stack">
            <p className="settings-card-hint">
              将删除这 {confirmCardUninstall.list.length} 个工具的本地文件（不可恢复），然后刷新引擎与工具状态：
              <br />
              {confirmCardUninstall.list.map((row) => row.name).join("、")}
            </p>
            <div className="devtools-batch">
              <button type="button" className="danger-setting runtime-uninstall"
                onClick={() => { const job = confirmCardUninstall; setConfirmCardUninstall(null); void runBatch("uninstall", job.list, job.card); }}>
                <Trash2 size={13} />确认卸载
              </button>
              <button type="button" className="secondary-setting" onClick={() => setConfirmCardUninstall(null)}>取消</button>
            </div>
          </div>
        </SettingsDialog>
      )}

      {/* ── 安装/卸载失败 · 完整报错弹窗（10-11）──────────────────────────────────
          报错原文完整展示（多行 pre-wrap，可滚动可复制）—— 修掉旧版「多行报错在单行 toast 里被剪切」。
          ⛔ 层级：z-index 950 > SettingsDialog 的 900（弹窗顺序，用户令）；portal 到 body。 */}
      {runtimeModal?.failed && createPortal(
        <div className="devtools-error-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRuntimeModal(null); }}>
          <div className="devtools-error-modal" role="alertdialog" aria-modal="true" aria-label={`${runtimeModal.name}${runtimeModal.mode === "uninstall" ? "卸载" : "安装"}失败`}>
            <div className="devtools-error-head">
              <AlertTriangle size={17} />
              <span className="devtools-error-title">
                <strong>{runtimeModal.name} {runtimeModal.mode === "uninstall" ? "卸载" : "安装"}失败</strong>
                <small>{runtimeModal.mode === "uninstall" ? "本地文件没有被改动，可以重试或先留着" : "报错原文在下面，完整可复制；网络不好就让 Codex 帮你装"}</small>
              </span>
              <button type="button" className="devtools-error-close" aria-label="关闭" autoFocus onClick={() => setRuntimeModal(null)}><X size={15} /></button>
            </div>
            <div className="devtools-error-body">
              <p>{runtimeModal.mode === "uninstall"
                ? "错误详情如下（完整原文，可滚动、可复制）。"
                : "错误详情如下（完整原文，可滚动、可复制）。网络差时不用反复重试：点下面的「复制提示词」发给任意会话里的 Codex，让它直接在这台机器上装。"}</p>
              <pre className="devtools-error-text">{runtimeModal.error}</pre>
            </div>
            <div className="devtools-error-actions">
              <button type="button" className="secondary-setting" onClick={() => { void copyTextToClipboard(runtimeModal.error); setNotice("错误信息已复制"); }}><Copy size={13} />复制错误信息</button>
              {runtimeModal.mode === "install" && failedPrompt ? (
                <button type="button" className="primary-setting" onClick={() => { void copyTextToClipboard(failedPrompt); setNotice(`已复制「${runtimeModal.name}」的安装提示词 —— 到任意会话里发给 Codex 即可`); }}><Copy size={13} />复制提示词，交给 Codex 装</button>
              ) : null}
              <button type="button" className="secondary-setting" onClick={() => setRuntimeModal(null)}>关闭</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}