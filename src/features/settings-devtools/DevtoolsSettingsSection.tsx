/**
 * 设置页 · devtools（10-10 **两级信息架构改版**；原 09-21 从 App.tsx 内嵌块搬出）。
 *
 * ⛔⛔ 为什么改版（用户 10-10 反馈原话）：「前端布局混乱、各板块展示方式不统一，可读性差，
 *   用户难以理解」—— 改版前这一页把所有东西平铺在一条长滚动里：能力链路 / 7 组运行时列表 /
 *   检查工具 / 工具清单折叠 / 长段说明 / 手机控制 / Laya / 功能域 / 声明式插件，层级全平。
 *
 * 新结构（**两级 IA**）：
 *   一级（本文件）= 分类卡片网格，只回答"这里有哪几块、各自现在什么状态"；
 *   二级（SettingsDialog 弹窗）= 各板块的完整内容，**⛔ 内容不得内嵌到一级页**。
 *   内容组件：运行时与工具链 → RuntimeToolsPanel · 能力链路 → CapabilityChainPanel ·
 *   手机控制 → PhoneHarnessCard · Laya → LayaCard · 功能域 / 声明式插件 → 各自的声明式插槽。
 *
 * ⛔ 两个声明式插槽的 **id 一个都没改**（`settings.devtools.bottom` /
 *   `settings.devtools.declared-plugins`）：它们是 `electron/declared-plugins.ts` 的
 *   KNOWN_SLOTS 白名单项、也是用户 JSON 插件能挂的位置。这次只把**消费点**从注册表
 *   移进对应弹窗（守卫【268-c】要求同一 id 全局只被消费一次 —— 所以一级页**不**再放插槽）。
 * ⛔ 面板组件一律**挂在弹窗分支里**（守卫【dtIA】钉：一级渲染分支里不许出现面板组件名）。
 */
import { useState } from "react";
import { PageInfo } from "../../components/SettingsHead";
import { Boxes, Brain, ChevronRight, CircleCheck, Puzzle, Smartphone, Wrench } from "lucide-react";
import { SettingsDialog } from "../../components/SettingsDialog";
import { Slot } from "../../runtime/Slot";
import { RuntimeToolsPanel } from "./RuntimeToolsPanel";
import { CapabilityChainPanel } from "./CapabilityChainPanel";
import { PhoneHarnessCard } from "./PhoneHarnessCard";
import { LayaCard } from "./LayaCard";

export type DevtoolsSettingsSectionProps = { downloadSource?: any; capabilityRows: any; capabilityError: any; setNotice: any; devRuntimes: any; runtimeInstalling: any; runtimeUninstalling: any; runtimePercent: any; runtimeStage: any; runtimeSpeed: any; runtimeProgress: any; installDevRuntime: any; uninstallDevRuntime: any; cancelDevRuntime: any };

/** 一级卡片的 key —— 也是弹窗的开关值（同时只开一个）。 */
type DevtoolsCardKey = "runtime" | "capability" | "phone" | "laya" | "domains" | "plugins";

export function DevtoolsSettingsSection(props: DevtoolsSettingsSectionProps) {
  const { capabilityRows, capabilityError, setNotice, devRuntimes, runtimeInstalling, runtimeUninstalling, runtimePercent, runtimeStage, runtimeSpeed, runtimeProgress, installDevRuntime, uninstallDevRuntime, cancelDevRuntime } = props;
  const [openCard, setOpenCard] = useState<DevtoolsCardKey | null>(null);

  /* 卡片摘要只放**算得出来**的：运行时统计来自 devRuntimes；其余给功能定位（不编造数字，
     数字拿不到的就不显示 —— 卡片上写错的状态比不写更糟）。 */
  const runtimeReady = devRuntimes.filter((row: any) => row.installed || row.installedBySystem || row.builtIn).length;
  const runtimeTotal = devRuntimes.length;
  const cards: { key: DevtoolsCardKey; icon: any; title: string; desc: string; stat: string }[] = [
    { key: "runtime", icon: <Wrench size={15} />, title: "运行时与工具链", desc: "内置运行时、桌面与浏览器自动化、开发工具链、媒体与文档", stat: runtimeTotal ? `已就绪 ${runtimeReady} / ${runtimeTotal} 项` : "正在读取状态…" },
    { key: "capability", icon: <CircleCheck size={15} />, title: "当前能力链路", desc: "同一件事有多个后端时，现在实际走的是哪条", stat: capabilityRows.length ? `${capabilityRows.length} 项能力` : "正在读取状态…" },
    { key: "phone", icon: <Smartphone size={15} />, title: "手机控制", desc: "让 Codex 直接操作手机：看屏幕、点按、打字、读日志", stat: "Android（adb）· iPhone 需 mac" },
    { key: "laya", icon: <Brain size={15} />, title: "Laya 智能判断", desc: "思考等级「自动」档的本地决策端（Python）", stat: "本地 · 可选安装" },
    { key: "domains", icon: <Boxes size={15} />, title: "功能域", desc: "启用 / 停用功能板块（停用下次启动生效）", stat: "声明式插槽 · 可被插件替换" },
    { key: "plugins", icon: <Puzzle size={15} />, title: "声明式插件", desc: "只用 JSON 往插槽挂内容、调已有通道，无代码", stat: "放好即生效 · 无需重启" },
  ];
  const activeCard = cards.find((card) => card.key === openCard);

  return (
    <>
      <section className="settings-section stack">
        <div className="settings-copy"><h2>开发工具<PageInfo text={<>桌面与浏览器自动化（Nuphus / Playwright CLI）与写代码模式插件随应用内置、开箱即用；CloakBrowser 指纹浏览器、两类浏览器内核与其余工具链按需下载（国内镜像优先，失败自动回落官方源），安装后自动加入 Codex 环境（不改系统 PATH）。</>} helpKey="devtools" label="开发工具" /></h2></div>
        <p className="settings-card-hint">每个板块独立成页：点下面的卡片打开详情。主界面只保留分类与当前状态，具体操作都在弹窗里。</p>
        <div className="devtools-cards" data-count={cards.length}>
          {cards.map((card) => (
            <button type="button" className="devtools-card" key={card.key} data-card={card.key} onClick={() => setOpenCard(card.key)}>
              <span className="devtools-card-logo">{card.icon}</span>
              <span className="devtools-card-copy">
                <strong>{card.title}</strong>
                <small>{card.desc}</small>
                <span className="devtools-card-stat">{card.stat}</span>
              </span>
              <ChevronRight size={15} className="devtools-card-arrow" />
            </button>
          ))}
        </div>
        {/* 10-08 迁移：语音模型 / 音色克隆模型的选择项已搬到「设置 → 语音通话」——
            用户要求语音相关的东西集中在一处（音色 / 模型 / 播报 / 语速同页）。
            ⛔ 这里只留一句指路，不要再留第二份渲染（同一份状态两处渲染 = 双真相源）。 */}
        <p className="settings-card-hint">语音模型（识别 + 合成）与音色克隆模型已移到<strong>设置 → 语音通话</strong>，和音色、语速同页管理。</p>
      </section>

      {/* ── 二级：弹窗（内容一律在这里，⛔ 不内嵌到上面的一级页）────────────────── */}
      {openCard === "runtime" && activeCard && (
        <SettingsDialog title={activeCard.title} icon={<Wrench size={15} />} hint="内置随包 · 按需下载 · 系统级安装" size="lg" onClose={() => setOpenCard(null)}>
          <RuntimeToolsPanel
            devRuntimes={devRuntimes} runtimeInstalling={runtimeInstalling} runtimeUninstalling={runtimeUninstalling}
            runtimePercent={runtimePercent} runtimeStage={runtimeStage} runtimeSpeed={runtimeSpeed} runtimeProgress={runtimeProgress}
            installDevRuntime={installDevRuntime} uninstallDevRuntime={uninstallDevRuntime} cancelDevRuntime={cancelDevRuntime}
            setNotice={setNotice}
          />
        </SettingsDialog>
      )}
      {openCard === "capability" && activeCard && (
        <SettingsDialog title={activeCard.title} icon={<CircleCheck size={15} />} hint="前端只渲染，判据来自 capability-registry" onClose={() => setOpenCard(null)}>
          <CapabilityChainPanel capabilityRows={capabilityRows} capabilityError={capabilityError} />
        </SettingsDialog>
      )}
      {openCard === "phone" && activeCard && (
        <SettingsDialog title={activeCard.title} icon={<Smartphone size={15} />} hint="装机 · 关遥测 · 注册技能 · 权限引导" onClose={() => setOpenCard(null)}>
          {/* 手机控制（09-27）：上游 phone-harness 是 Python CLI 不是 MCP 服务，
              所以不做连接器模板，做成工具卡：装机 + 关遥测 + 注册技能 + 权限引导。 */}
          <PhoneHarnessCard setNotice={setNotice} installDevRuntime={installDevRuntime} runtimeInstalling={runtimeInstalling} runtimePercent={runtimePercent} runtimeStage={runtimeStage} />
        </SettingsDialog>
      )}
      {openCard === "laya" && activeCard && (
        <SettingsDialog title={activeCard.title} icon={<Brain size={15} />} hint="思考等级「自动」档的本地决策端" onClose={() => setOpenCard(null)}>
          {/* Laya 智能判断（10-01）：思考等级「自动」档的本地决策端（Python laya-serve）。 */}
          <LayaCard setNotice={setNotice} />
        </SettingsDialog>
      )}
      {openCard === "domains" && activeCard && (
        <SettingsDialog title={activeCard.title} icon={<Boxes size={15} />} hint="停用是「下次启动生效」，不是立刻卸载" size="lg" onClose={() => setOpenCard(null)}>
          {/* ⛔ 插槽 id 与注册方式**都没变**（DomainsPanel 自己 registerSlot）——只是消费点从
              注册表移到了这里。守卫【268-c】：同一 id 全局只许被消费一次，所以一级页不放它。 */}
          <Slot id="settings.devtools.bottom" props={{ onNotice: setNotice }} loader={() => import("./DomainsPanel")} />
        </SettingsDialog>
      )}
      {openCard === "plugins" && activeCard && (
        <SettingsDialog title={activeCard.title} icon={<Puzzle size={15} />} hint="声明式：只描述挂什么、调哪条通道" size="lg" onClose={() => setOpenCard(null)}>
          {/* ⛔ 同上：`settings.devtools.declared-plugins` 是 KNOWN_SLOTS 白名单项，id 不动。 */}
          <Slot id="settings.devtools.declared-plugins" loader={() => import("./DeclaredPluginsPanel")} />
        </SettingsDialog>
      )}
    </>
  );
}
