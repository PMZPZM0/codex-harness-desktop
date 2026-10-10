/**
 * MemoryPanes —— 旧「记忆中心」弹窗里那几个内容页的**新家**（10-10 迁移）。
 *
 * ── 为什么要有这个文件 ─────────────────────────────────────────────
 *   用户二轮反馈：「还保留了旧的记忆板块入口，为什么没有清理干净」。旧弹窗
 *   （原 `app-view/AppView/07-memory-panel.tsx`）里除了三个新面板已覆盖的部分，
 *   还压着 5 项能力：记忆条目浏览（置顶 / 删除 / 看全文）、全局搜索、常驻记忆编辑、
 *   容量倍率、整洁清理 —— 直接删入口就是**丢功能**。
 *   ⇒ 把它们整块搬到这里，再分别挂进三个新面板的二级弹窗，然后删掉旧弹窗与它的入口。
 *
 * ── 内容零改写 ─────────────────────────────────────────────────────
 *   ⛔ 本文件只做「搬家」：JSX 与旧弹窗逐字一致（仅去掉外层的 SettingsDialog 壳与
 *     `openMemoryCard` 跳转）。行为语义、权限边界、可见交互一律不动（本项目纪律）。
 *   ⛔ 接收 `app` 而不是几十个扁平 props —— 与旧弹窗 `AppViewMemoryPanel({ app })` 同源，
 *     避免在注册表里再接 30 条线（那种接线一处漏写就是静默 bug）。
 */
import { MEMORY_CATEGORIES } from "../app-view/constants";
import { describeSchedule } from "../app-view/helpers/text";
import { basename } from "../../lib/basename";
import { MEMORY_INJECT_LABEL, MEMORY_SCOPE_HINT, MEMORY_SCOPE_LABEL, MEMORY_SESSION_SCOPES, layersByScope } from "../../lib/memory-scope-rules.mjs";
import { GlobalSearchView } from "../../components/IndexLibrary";
import { MemoryFunnel, MemoryHygienePanel, MemoryInjectPreview, MemoryLayersEditor, MemoryPyramid } from "../memory";
import { MemoryWorkbench } from "../memory-ui";
import { Cloud, CloudOff, Search, Settings2 } from "lucide-react";
import type { HarnessAppApi } from "../app-view/types";
import type { SettingsPage } from "../app-view/types";

/** ⓪ 分层规则（三作用域 / 八层明细 / 优先级 / 引用与继承 / 会话级存储 / L2→技能出边）
 *  → 挂进「金字塔记忆架构」弹窗。
 *  ⛔ 规则数据全部来自 src/lib/memory-scope-rules.mjs（唯一真相源）—— 这里只渲染，
 *    ⛔ 不另写一份层表（两处层表必然漂移）。这个「出边」块是 10-10 架构评审的落地项，
 *    ⛔ 别当成"可删的说明文字"：技能 / 插件是**能力面**，不属于记忆架构。 */
export function LayerRulesPane() {
  return (
    <div className="memory-center-pane">
      <div className="memory-rule-scope-list">
        {(["cross-project", "project", "session"] as const).map((scope) => (
          <section className="memory-rule-scope" key={scope} data-scope={scope}>
            <header className="memory-rule-scope-head">
              <span className="memory-rule-scope-chip">{MEMORY_SCOPE_LABEL[scope]}</span>
              <span className="memory-rule-scope-hint">{MEMORY_SCOPE_HINT[scope]}</span>
              <em className="memory-rule-scope-layers">{layersByScope(scope).map((rule: any) => rule.layer).join(" · ")}</em>
            </header>
            {layersByScope(scope).map((rule: any) => (
              <article className="memory-rule-row" key={rule.layer} data-layer={rule.layer}>
                <header className="memory-rule-row-head">
                  <b>{rule.layer}</b><strong>{rule.name}</strong>
                  <i className="memory-rule-tier">{MEMORY_INJECT_LABEL[rule.inject as keyof typeof MEMORY_INJECT_LABEL]}</i>
                </header>
                <dl className="memory-rule-facts">
                  <dt>存储范围</dt><dd>{rule.store}</dd>
                  <dt>共享边界</dt><dd>{rule.sharedWith}</dd>
                  <dt>隔离原则</dt><dd>{rule.isolatedFrom}</dd>
                  <dt>引用（从哪来）</dt><dd>{rule.inheritsFrom}</dd>
                  <dt>同步（去哪）</dt><dd>{rule.syncsTo}</dd>
                </dl>
              </article>
            ))}
          </section>
        ))}
      </div>
      <div className="memory-center-block">
        <div className="memory-center-block-head"><div><strong>出边：记忆 → 能力</strong><span>记忆只往外送出一样东西 —— 攒够的纪律会升级成可复用的技能。</span></div></div>
        <article className="memory-rule-row">
          <header className="memory-rule-row-head"><b>L2 →</b><strong>技能库</strong><i className="memory-rule-tier">退出记忆预算</i></header>
          <p className="memory-rule-note">L2（纪律与记忆）在满水位之前，先按分类把反复出现的条目**升级为技能**：技能是可复用能力（全局或项目级），不再占用常驻注入预算；升级完再压缩 L2 原文。⛔ 技能 / 插件清单不放在记忆架构里（它们是能力面）。</p>
        </article>
      </div>
      <div className="memory-center-block">
        <div className="memory-center-block-head"><div><strong>会话级存储</strong><span>「其余记忆按会话独立存储」的落地形态：命名空间隔离，条目按来源会话标记。</span></div></div>
        {MEMORY_SESSION_SCOPES.map((scope: any) => (
          <article className="memory-rule-row" key={scope.id}>
            <header className="memory-rule-row-head"><b>{scope.label}</b><strong>{scope.owner}</strong></header>
            <p className="memory-rule-note">{scope.note}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

/** ① 会话来源记忆（原「记忆库与会话记忆」页的 fabric 部分）→ 挂进「金字塔记忆架构」弹窗 */
export function MemorySourcesPane({ app }: { app: HarnessAppApi }) {
  return (
    <div className="memory-center-block">
      {/* ⭐ 10-05 统一记忆（fabric）：按**来源**看条目 —— 主会话 / 子智能体 / 专家 / 专家团 / 被调度。
          ⛔ 与项目记忆分开排：会话记忆与项目记忆的**可见范围完全不同**，混排时用户无法判断
            "这条会不会被别的会话读到"。 */}
      <MemoryWorkbench
        workspace={app.memoryManagementWorkspace}
        onOpenThread={(id: string) => { app.setSettingsOpen(false); void app.openThread(id); }}
      />
    </div>
  );
}

/** ② 记忆条目（P0–P3 记忆库：分类筛选 / 置顶 / 删除 / 看全文）→ 挂进「项目共享记忆库」弹窗 */
export function MemoryEntriesPane({ app }: { app: HarnessAppApi }) {
  return (
    <div className="memory-library">
      <div className="memory-library-head">
        <div className="memory-library-title">
          <h3>记忆条目</h3>
          <p>按重要度 P0–P3 分层，点击条目可看全文；★ 置顶的核心记忆不会被自动清理。</p>
        </div>
        <div className="memory-toolbar">
          <span className="memory-count">{app.memoryVisibleRecords.length} 条 · {app.memoryMode === "cloud" ? "云端同步 / 本地缓存" : "本地"}</span>
        </div>
      </div>
      <div className="memory-funnel-toolbar">
        <span className="memory-funnel-toolbar-label">分类筛选</span>
        <div className="memory-funnel-chips" role="tablist" aria-label="按分类筛选">
          <button role="tab" aria-selected={app.memoryCategory === ""} className={`memory-funnel-chip ${app.memoryCategory === "" ? "active" : ""}`} onClick={() => app.setMemoryCategory("")}>全部</button>
          {MEMORY_CATEGORIES.map((cat) => <button key={cat.name} role="tab" aria-selected={app.memoryCategory === cat.name} className={`memory-funnel-chip ${app.memoryCategory === cat.name ? "active" : ""}`} onClick={() => app.setMemoryCategory(app.memoryCategory === cat.name ? "" : cat.name)}>{cat.name}</button>)}
        </div>
      </div>
      <MemoryFunnel
        groups={app.memoryGroupsFiltered}
        emptyHint={{ totalElsewhere: app.memories.length - app.memoryVisibleRecords.length, scopeLabel: app.memoryProjectWorkspace === "__all__" ? "全部项目" : basename(app.memoryProjectWorkspace) }}
        onShowAll={() => app.setMemoryProjectWorkspace("__all__")}
        onPreview={(entry: any) => app.setMemoryPreview(entry)}
        onTogglePin={app.togglePinned}
        onDeleteOne={(id: string) => void app.deleteMemoryRecord(id)}
        onDeleteGroup={(group: any) => void app.deleteMemoryGroup((entry: any) => (entry.sourceThreadId ?? "__manual") === group.key).then((count: number) => { if (count > 0) app.setMemoryStatus(`已从「${group.threadTitle}」删除 ${count} 条记忆`); else app.setMemoryStatus("没有可删除的记忆（可能已被删除）"); })}
        readOnly
        onOpenThread={(threadId: string) => { app.setSettingsOpen(false); void app.openThread(threadId); }}
      />
    </div>
  );
}

/** ③ 常驻记忆（容量倍率 / 层水位 / 注入预览 / 正文编辑 / 整洁清理）→ 挂进「项目共享记忆库」弹窗 */
export function ResidentMemoryPane({ app }: { app: HarnessAppApi }) {
  return (
    <div className="memory-center-pane">
      {/* 容量倍率：×1 基准按倍数放大常驻注入预算。⛔ 放在最上面 —— 它改的就是下面所有水位条的分母。 */}
      {app.memoryCapacity && (
        <div className="memory-center-block">
          <div className="memory-center-block-head">
            <div>
              <strong>容量倍率</strong>
              <span>把常驻记忆的注入预算按倍数放大（×1 = 基准）。当前总预算 {app.memoryCapacity.budget.total.toLocaleString()} 字；切换后下一条消息起生效。</span>
            </div>
          </div>
          <div className="memory-funnel-chips" role="tablist" aria-label="记忆容量倍率">
            {app.memoryCapacity.options.map((n: number) => (
              <button key={n} role="tab" aria-selected={app.memoryCapacity!.scale === n}
                disabled={app.memoryScaleBusy}
                className={`memory-funnel-chip ${app.memoryCapacity!.scale === n ? "active" : ""}`}
                onClick={() => void app.applyMemoryCapacity(n)}>×{n}</button>
            ))}
          </div>
        </div>
      )}
      <MemoryPyramid
        snapshot={app.memoryLayers}
        distilling={app.memoryDistilling}
        onJump={(layerId: string) => {
          if (layerId === "L0") { app.setMemoryLayerScope("user"); return; }
          if (layerId === "L3") { app.setMemoryLayerScope("background"); return; }
          if (layerId === "L1") { app.setMemoryLayerScope("project"); return; }
          app.setMemoryStatus(`${layerId} 由捕获链 / 蒸馏自动写入，见下方「记忆整洁」与「近期日志」。`);
        }}
        onDistill={() => void app.runMemoryDistill()}
        records={app.memories}
        onOpenThread={(threadId: string) => { app.setSettingsOpen(false); void app.openThread(threadId); }}
        onReveal={(path: string) => void window.codex.shellReveal(path)}
      />
      <MemoryInjectPreview workspace={app.memoryManagementWorkspace} />
      <MemoryLayersEditor
        snapshot={app.memoryLayers}
        scope={app.memoryLayerScope}
        draft={app.memoryLayerDraft}
        dirty={app.memoryLayerDirty}
        distilling={app.memoryDistilling}
        hasWorkspace={Boolean(app.memoryManagementWorkspace)}
        savedAt={app.memoryLayerSavedAt}
        onScope={app.setMemoryLayerScope}
        onDraft={app.setMemoryLayerDraft}
        onSave={() => void app.saveMemoryLayer()}
        onDistill={() => void app.runMemoryDistill()}
      />
      {/* 记忆整洁与清理规则（09-22）：水位 / 待办 / 三个动作（危险动作二次确认） */}
      <MemoryHygienePanel snapshot={app.memoryLayers} workspace={app.memoryManagementWorkspace} onStatus={app.setMemoryStatus} />
    </div>
  );
}

/** ④ 全局搜索（跨会话 / 记忆 / 任务 / 技能）→ 挂进「项目共享记忆库」弹窗底部 */
export function MemorySearchPane({ app }: { app: HarnessAppApi }) {
  const ws = app.memoryManagementWorkspace;
  return (
    <>
      <div className="memory-center-block-head">
        <div><strong><Search size={13} /> 全局搜索</strong><span>一次检索会话、记忆条目、定时任务与技能；命中按来源分组，可预览全文或跳到那个会话。</span></div>
      </div>
      <GlobalSearchView
        threads={(ws ? app.threads.filter((entry: any) => entry.cwd === ws) : app.threads).map((entry: any) => ({ id: entry.id, title: entry.name, preview: entry.preview, updatedAt: entry.updatedAt, turnCount: entry.turns?.length }))}
        memories={app.memories.map((entry: any) => ({ id: entry.id, category: entry.category, content: entry.content, sourceThreadId: entry.sourceThreadId, createdAt: entry.updatedAt }))}
        tasks={(ws ? app.scheduledTasks.filter((task: any) => task.workspace === ws) : app.scheduledTasks).map((task: any) => ({ id: task.id, name: task.name, prompt: task.prompt, enabled: task.enabled, schedule: describeSchedule(task) }))}
        skills={app.localSkills.map((skill: any) => ({ name: skill.name, description: skill.description }))}
        onPreview={app.setSearchPreview}
        onOpenThread={(threadId: string) => { app.setSettingsOpen(false); void app.openThread(threadId); }}
        onOpenSettings={(page: string) => { app.setSettingsPage(page as SettingsPage); }}
      />
    </>
  );
}

/** ⑤ 记忆保存在哪（本地 / 云端 + 云端配置）→ 挂进「记忆后端选项」弹窗
 *  ⛔ 只搬「保存位置」这一段：工作区开关那一行**面板里已经有**（BackendConsolePanel），
 *    不重复渲染同一开关（同一切换器出现两次必然状态不同步）。 */
export function MemoryModePane({ app }: { app: HarnessAppApi }) {
  return (
    <div className="memory-center-block">
      <div className="memory-center-block-head">
        <div><strong>记忆保存在哪</strong><span>本地模式只保存在本机 memory.json；云端同步模式会通过 TencentDB Gateway 召回与保存，并保留本机缓存。</span></div>
        <button className="secondary-setting" onClick={() => app.setMemoryConfigOpen(true)}><Settings2 size={13} />云端配置</button>
      </div>
      <div className="memory-mode-switch" role="tablist" aria-label="记忆来源">
        <button role="tab" aria-selected={app.memoryMode === "local"} className={`memory-mode-card ${app.memoryMode === "local" ? "active" : ""}`} onClick={() => app.updateMemoryMode("local")}>
          <div className="memory-mode-icon"><CloudOff size={15} /></div>
          <div className="memory-mode-body"><strong>本地记忆</strong><span>仅保存在本机 memory.json</span></div>
          <span className="memory-mode-tag">{app.memories.length} 条</span>
        </button>
        <button role="tab" aria-selected={app.memoryMode === "cloud"} className={`memory-mode-card ${app.memoryMode === "cloud" ? "active" : ""}`} onClick={() => app.updateMemoryMode("cloud")}>
          <div className="memory-mode-icon"><Cloud size={15} /></div>
          <div className="memory-mode-body"><strong>云端同步</strong><span>TencentDB Gateway，云端召回并保留本地缓存</span></div>
          <span className="memory-mode-tag">{app.memoryGateway.endpoint ? "已配置" : "未配置"}</span>
        </button>
      </div>
    </div>
  );
}
