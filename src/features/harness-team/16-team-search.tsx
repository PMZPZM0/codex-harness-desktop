/**
 * 团队模式 · 群内搜索（11-07 用户令）
 *
 * 用户原话：「群内搜索」。豆包那边的口径：群消息天然是 append-only 日志，
 * 搜索只是对**已投影的行**做过滤，⛔ 不建索引、⛔ 不落盘。
 *
 * ⛔ 结果必须能跳转：每条结果的 `itemId` 与消息 DOM 的 `data-item-id` 对齐，
 *    由父层补分页 + 滚动定位（见 `04-team-group-view.tsx` 的 `jumpToRow`）。
 * ⛔ 纯过滤在 `src/lib/team-search.mjs`；这里只管输入与结果列表。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { GroupMessageRow } from "./01-team-types";
import { searchGroupRows } from "../../lib/team-search.mjs";

type Props = {
  rows: GroupMessageRow[];
  authorName: (id: string) => string;
  onJump: (hit: { key: string; itemId: string }) => void;
  onClose: () => void;
};

function fmtAt(at: number): string {
  if (!at) return "";
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TeamSearchPanel({ rows, authorName, onJump, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => { inputRef.current?.focus(); }, []);

  const hits = useMemo(() => searchGroupRows(rows, query), [rows, query]);

  return (
    <div className="team-search" role="dialog" aria-label="群内搜索">
      <div className="team-search__head">
        <Search size={13} aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
            if (e.key === "Enter" && hits.length) {
              e.preventDefault();
              onJump(hits[0]);
            }
          }}
          placeholder="搜索群消息（空格分词，全部命中）"
          aria-label="搜索群消息"
        />
        <span className="team-search__count">{query.trim() ? `${hits.length} 条` : ""}</span>
        <button type="button" className="team-search__close" aria-label="关闭搜索" onClick={onClose}>
          <X size={12} />
        </button>
      </div>
      {query.trim() && (
        <div className="team-search__results">
          {hits.map((hit) => (
            <button key={hit.key || hit.itemId} type="button" onClick={() => onJump(hit)} title={hit.text.slice(0, 400)}>
              <span className="team-search__meta">
                <strong>{authorName(hit.authorId)}</strong>
                <time>{fmtAt(hit.at)}</time>
              </span>
              <span className="team-search__snippet">{hit.snippet}</span>
            </button>
          ))}
          {!hits.length && <p className="team-search__empty">没有匹配的消息</p>}
        </div>
      )}
    </div>
  );
}
