import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";

/**
 * 复刻 WorkBuddy 项目列表的展开/折叠交互（ProjectGrid）：
 * - 折叠态：只渲染前 COLLAPSED_PROJECT_RENDER_COUNT 个项目，CSS max-height 裁成视觉 3 行
 *   （.project-list-rows--collapsed，与 WorkBuddy 的 .project-grid__cards--collapsed 同一思路）；
 * - ResizeObserver 检测内容是否溢出折叠高度（scrollHeight > clientHeight + 1），
 *   只有真正溢出了才显示「展开全部」按钮；
 * - 展开态：IntersectionObserver（底部提前 300px 触发）按 chunk 分批追加渲染，
 *   按钮 Chevron 上下翻转，与 WorkBuddy 的 ExpandToggleIcon 行为一致。
 */

export type ProjectListEntry = { id: string; updatedAt: number };
export type ProjectListGroup = [string, ProjectListEntry[]];

const COLLAPSED_PROJECT_RENDER_COUNT = 12;
const EXPAND_CHUNK = 20;
const COLLAPSED_VISIBLE_ROWS = 3;
const PROJECT_ROW_MIN_HEIGHT = 46;

function basename(value: string) {
  return value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value;
}

function timeAgo(timestamp: number) {
  const seconds = Math.max(0, Date.now() / 1000 - timestamp);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

interface CollapsibleProjectListProps {
  projects: ProjectListGroup[];
  onSelect: (cwd: string) => void;
}

export default function CollapsibleProjectList({ projects, onSelect }: CollapsibleProjectListProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [collapsedOverflow, setCollapsedOverflow] = useState(false);
  const [expandedCount, setExpandedCount] = useState(COLLAPSED_PROJECT_RENDER_COUNT + EXPAND_CHUNK);
  const rowsRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 折叠态渲染前 12 个；展开态按 expandedCount 分批渲染
  const visibleProjects = useMemo(
    () => (isExpanded ? projects.slice(0, expandedCount) : projects.slice(0, COLLAPSED_PROJECT_RENDER_COUNT)),
    [projects, isExpanded, expandedCount],
  );
  const hasMore = isExpanded && expandedCount < projects.length;
  const showToggle = isExpanded || projects.length > COLLAPSED_PROJECT_RENDER_COUNT || collapsedOverflow;

  // 折叠态：ResizeObserver 检测内容溢出（WorkBuddy: scrollHeight > clientHeight + 1）
  useLayoutEffect(() => {
    if (isExpanded) {
      setCollapsedOverflow(false);
      return;
    }
    const el = rowsRef.current;
    if (!el) {
      setCollapsedOverflow(false);
      return;
    }
    const update = () => setCollapsedOverflow(el.scrollHeight > el.clientHeight + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [isExpanded, projects.length]);

  // 展开态：IntersectionObserver 提前 300px 触发加载下一批
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!isExpanded || !sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setExpandedCount((count) => Math.min(projects.length, count + EXPAND_CHUNK));
        }
      },
      { threshold: 0, rootMargin: "0px 0px 300px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isExpanded, hasMore, projects.length]);

  const toggle = () => {
    if (!isExpanded) setExpandedCount(COLLAPSED_PROJECT_RENDER_COUNT + EXPAND_CHUNK);
    setIsExpanded((current) => !current);
  };

  return (
    <div className="collapsible-project-list">
      <div ref={rowsRef} className={`project-list-rows${isExpanded ? "" : " project-list-rows--collapsed"}`}>
        {visibleProjects.map(([cwd, entries]) => (
          <button className="project-row" key={cwd} title={cwd} onClick={() => onSelect(cwd)}>
            <FolderOpen size={15} />
            <span><strong>{basename(cwd)}</strong><small>{entries.length} 个任务 · {timeAgo(Math.max(...entries.map((entry) => entry.updatedAt)))}</small></span>
          </button>
        ))}
      </div>
      {hasMore && <div className="project-list-sentinel" ref={sentinelRef} aria-hidden />}
      {showToggle && (
        <button className="project-expand-toggle" aria-expanded={isExpanded} onClick={toggle}>
          <span>{isExpanded ? "收起" : `展开全部（${projects.length}）`}</span>
          <ChevronDown size={14} className={`project-expand-chevron${isExpanded ? " is-expanded" : ""}`} />
        </button>
      )}
    </div>
  );
}
