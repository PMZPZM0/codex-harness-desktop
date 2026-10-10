/**
 * 设置页 · 拓展接口（09-24 立项；**10-10 改两级信息架构**）。
 *
 * 09-24 用户需求：「集中管理所有可拓展的接口，分类展示，每个接口给出用途 / 可拓展位置 /
 * 拓展方式 / 生效方式 / 配套说明」。10-10 用户对整页形态提出与开发工具页同样的要求：
 * 「前端布局混乱、各板块展示方式不统一，可读性差」⇒ 改**两级 IA**：
 *   一级（本文件）= **分类卡片**（就是 catalog 里的分组）+ 统计 + 搜索；
 *   二级（SettingsDialog）= 该分类下的拓展点明细，**⛔ 不内嵌到一级页**。
 *
 * 与开发工具页**共用同一套视觉与交互规范**（用户要求「统一各板块的视觉与交互规范」）：
 *   · 卡片复用 `.settings-card*`（与 `.devtools-card*` 是同一份 CSS 的并列选择器）；
 *   · 弹窗复用 `SettingsDialog`（z=900 设置内档、Esc/点遮罩关、标题栏 + body 独立滚动）。
 *   ⛔ 第二个页面再抄一份卡片/弹窗 CSS，就是从第一天起埋下"两套规范必然漂移"的种子。
 *
 * 数据仍来自 `src/lib/extensibility-catalog.mjs`（纯函数，可被守卫断言）—— 页面只渲染，不写清单。
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Blocks, Cable, Check, ChevronRight, Copy, Layout, Search, Sparkles } from "lucide-react";
import { SettingsDialog } from "../../components/SettingsDialog";
import { EXTENSIBILITY_ENTRIES, EXTENSIBILITY_GROUPS, IPC_CHANNEL_COUNT } from "../../lib/extensibility-catalog.mjs";
import { THEMES } from "../../lib/themes";

export type ExtensibilitySettingsSectionProps = { onNotice?: (message: string) => void };

type Entry = (typeof EXTENSIBILITY_ENTRIES)[number];

/** 分类 → 卡片图标。⛔ 必须有兜底：catalog 新增分组时不会凭空少一张卡（少卡片 = 内容消失）。 */
const GROUP_ICONS: Record<string, ReactNode> = {
  接口与契约: <Cable size={15} />,
  界面与呈现: <Layout size={15} />,
  智能体与能力: <Sparkles size={15} />,
  记忆与质量: <Blocks size={15} />,
};

/** 单条 → 可复制的 Markdown（贴给别人/喂给 AI 都能直接照做） */
function toMarkdown(entry: Entry) {
  return [
    `## ${entry.name}`,
    "",
    `**用途**：${entry.purpose}`,
    "",
    "**可拓展位置**：",
    ...entry.where.map((w) => `- \`${w}\``),
    "",
    "**拓展方式**：",
    ...entry.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `**生效方式**：${entry.effect}`,
    "",
    `**配套守卫**：${entry.guards}`,
    "",
    "**容易踩的坑**：",
    ...entry.pitfalls.map((p) => `- ${p}`),
  ].join("\n");
}

/** 搜索命中：名称 / 用途 / 分组 / 守卫 / 位置 / 步骤 / 坑 任一处包含关键词 */
function matches(entry: Entry, q: string) {
  return [entry.name, entry.purpose, entry.group, entry.guards, ...entry.where, ...entry.steps, ...entry.pitfalls]
    .join(" ").toLowerCase().includes(q);
}

export function ExtensibilitySettingsSection(props: ExtensibilitySettingsSectionProps) {
  const { onNotice } = props;
  const [query, setQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState("");
  const [skillCount, setSkillCount] = useState<number | null>(null);

  /* 本地技能数：现取（设置页按需加载，符合本应用既有做法），失败静默显示「—」 */
  useEffect(() => {
    let alive = true;
    Promise.resolve(window.codex?.listLocalSkills?.())
      .then((list: unknown) => { if (alive && Array.isArray(list)) setSkillCount(list.length); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  /* 一级卡片 = 分组。搜索**只筛卡片**（命中数写在卡上），明细在弹窗里同样按同一关键词过滤
     —— ⛔ 不让搜索把一级页变回"平铺结果列表"（那正是这次要消灭的长滚动）。 */
  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (EXTENSIBILITY_GROUPS as string[])
      .map((group) => {
        const all = EXTENSIBILITY_ENTRIES.filter((e) => e.group === group);
        const hit = q ? all.filter((e) => matches(e, q)) : all;
        return {
          group, all, hit,
          preview: hit.slice(0, 3).map((e) => e.name).join(" · ") || "（本类暂无匹配）",
          stat: q ? `${hit.length} / ${all.length} 命中` : `${all.length} 个拓展点`,
        };
      })
      .filter((card) => card.hit.length > 0);
  }, [query]);

  const copy = async (entry: Entry) => {
    try {
      await navigator.clipboard.writeText(toMarkdown(entry));
      setCopiedId(entry.id);
      onNotice?.(`已复制「${entry.name}」的拓展说明`);
      window.setTimeout(() => setCopiedId(""), 1600);
    } catch {
      onNotice?.("复制失败，请手动选择文本");
    }
  };

  const openCard = cards.find((card) => card.group === openGroup) ?? null;

  return (
    <>
      <section className="settings-section stack ext-page">
        <div className="settings-copy">
          <h2><Blocks size={15} /> 拓展接口</h2>
          <p>这里集中列出本项目所有可以扩展的地方：用途、改哪个文件、怎么改、改完怎么生效、有哪些守卫在看着。</p>
        </div>

        <div className="ext-stats">
          <span><b>{IPC_CHANNEL_COUNT}</b> 个 IPC 通道</span>
          <span><b>{THEMES.length}</b> 套主题</span>
          <span><b>{skillCount ?? "—"}</b> 个本地技能</span>
          <span><b>{EXTENSIBILITY_ENTRIES.length}</b> 个拓展点</span>
        </div>

        <label className="ext-search">
          <Search size={13} />
          <input
            type="search"
            value={query}
            placeholder="搜索：IPC / 主题 / 技能 / 守卫 …（按分类筛选）"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? <button type="button" onClick={() => setQuery("")}>清除</button> : null}
        </label>

        <p className="settings-card-hint">
          按分类看：点卡片打开该类下的全部拓展点（共 {EXTENSIBILITY_ENTRIES.length} 个拓展点 / {EXTENSIBILITY_GROUPS.length} 个分类），
          明细在弹窗里，一类一页。
        </p>

        <div className="settings-cards" data-count={cards.length}>
          {cards.map((card) => (
            <button type="button" className="settings-card" key={card.group} data-group={card.group} onClick={() => setOpenGroup(card.group)}>
              <span className="settings-card-logo">{GROUP_ICONS[card.group] ?? <Blocks size={15} />}</span>
              <span className="settings-card-copy">
                <strong>{card.group}</strong>
                <small>{card.preview}</small>
                <span className="settings-card-stat">{card.stat}</span>
              </span>
              <ChevronRight size={15} className="settings-card-arrow" />
            </button>
          ))}
        </div>

        {cards.length === 0 ? <p className="ext-empty">没有匹配的拓展点，换个关键词试试。</p> : null}
      </section>

      {/* ── 二级：弹窗（明细一律在这里，⛔ 不内嵌到一级页）────────────────────── */}
      {openCard && (
        <SettingsDialog
          title={openCard.group}
          icon={GROUP_ICONS[openCard.group] ?? <Blocks size={15} />}
          hint={query ? `${openCard.hit.length} / ${openCard.all.length} 个拓展点命中「${query.trim()}」` : `${openCard.hit.length} 个拓展点`}
          size="lg"
          onClose={() => setOpenGroup(null)}
        >
          <div className="ext-dialog">
            {openCard.hit.map((entry) => (
              <article className="ext-item" key={entry.id}>
                <header className="ext-item-head">
                  <h3>{entry.name}</h3>
                  <button type="button" className="ext-copy" onClick={() => copy(entry)} title="复制为 Markdown（可直接贴给同事或 AI）">
                    {copiedId === entry.id ? <Check size={12} /> : <Copy size={12} />}
                    {copiedId === entry.id ? "已复制" : "复制说明"}
                  </button>
                </header>
                <p className="ext-purpose">{entry.purpose}</p>

                <div className="ext-block">
                  <span className="ext-label">可拓展位置</span>
                  <div className="ext-where">
                    {entry.where.map((w) => <code key={w}>{w}</code>)}
                  </div>
                </div>

                <div className="ext-block">
                  <span className="ext-label">拓展方式</span>
                  <ol className="ext-steps">
                    {entry.steps.map((s) => <li key={s}>{s}</li>)}
                  </ol>
                </div>

                <div className="ext-block">
                  <span className="ext-label">如何生效</span>
                  <p className="ext-effect">{entry.effect}</p>
                </div>

                <div className="ext-block">
                  <span className="ext-label">配套守卫</span>
                  <p className="ext-guards">{entry.guards}</p>
                </div>

                <div className="ext-block">
                  <span className="ext-label">容易踩的坑</span>
                  <ul className="ext-pitfalls">
                    {entry.pitfalls.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </SettingsDialog>
      )}
    </>
  );
}
