/**
 * 设置页 · 拓展接口（09-24 用户需求：「集中管理所有可拓展的接口，分类展示，每个接口给出
 * 用途 / 可拓展位置 / 拓展方式 / 生效方式 / 配套说明」）。
 *
 * 设计要点：
 *   · 数据来自 `src/lib/extensibility-catalog.mjs`（纯函数，可被守卫断言）—— 页面只渲染，不写清单；
 *   · 每条都能**一键复制成 Markdown**，方便贴给同事或直接喂给 AI 让它照做；
 *   · 运行时数字（技能数、主题数）现取，不写死；IPC 通道数由守卫保证与 manifest 一致。
 */
import { useEffect, useMemo, useState } from "react";
import { Blocks, Check, Copy, Search } from "lucide-react";
import { EXTENSIBILITY_ENTRIES, EXTENSIBILITY_GROUPS, IPC_CHANNEL_COUNT } from "../../lib/extensibility-catalog.mjs";
import { THEMES } from "../../lib/themes";

export type ExtensibilitySettingsSectionProps = { onNotice?: (message: string) => void };

/** 单条 → 可复制的 Markdown（贴给别人/喂给 AI 都能直接照做） */
function toMarkdown(entry: (typeof EXTENSIBILITY_ENTRIES)[number]) {
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

export function ExtensibilitySettingsSection(props: ExtensibilitySettingsSectionProps) {
  const { onNotice } = props;
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>(EXTENSIBILITY_GROUPS as string[]);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EXTENSIBILITY_ENTRIES;
    return EXTENSIBILITY_ENTRIES.filter((e) =>
      [e.name, e.purpose, e.group, e.guards, ...e.where, ...e.steps, ...e.pitfalls]
        .join(" ").toLowerCase().includes(q)
    );
  }, [query]);

  const copy = async (entry: (typeof EXTENSIBILITY_ENTRIES)[number]) => {
    try {
      await navigator.clipboard.writeText(toMarkdown(entry));
      setCopiedId(entry.id);
      onNotice?.(`已复制「${entry.name}」的拓展说明`);
      window.setTimeout(() => setCopiedId(""), 1600);
    } catch {
      onNotice?.("复制失败，请手动选择文本");
    }
  };

  return (
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
          placeholder="搜索：IPC / 主题 / 技能 / 守卫 …"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? <button type="button" onClick={() => setQuery("")}>清除</button> : null}
      </label>

      {EXTENSIBILITY_GROUPS.map((group) => {
        const items = filtered.filter((e) => e.group === group);
        if (!items.length) return null;
        const open = openGroups.includes(group);
        return (
          <div className={`ext-group ${open ? "open" : ""}`} key={group}>
            <button
              type="button"
              className="ext-group-head"
              aria-expanded={open}
              onClick={() => setOpenGroups((prev) => prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group])}
            >
              <span className="ext-group-name">{group}</span>
              <span className="ext-group-count">{items.length}</span>
            </button>
            {open ? (
              <div className="ext-group-body">
                {items.map((entry) => (
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
            ) : null}
          </div>
        );
      })}

      {filtered.length === 0 ? <p className="ext-empty">没有匹配的拓展点，换个关键词试试。</p> : null}
    </section>
  );
}
