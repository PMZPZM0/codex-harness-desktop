/** 内联文件卡片 / 引用行（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useMemo, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { resolveFilePath, lookupKnownFile, openImageLightbox } from "../../lib/ui-channels";
import { basename } from "../../lib/basename";
import { isImagePath } from "../../lib/is-image-path";
import { FileText, Zap, Quote } from "lucide-react";
import type { ParsedUserRefs } from "../../lib/user-refs";
import { imageDisplaySrc } from "../../lib/image-src.mjs";
import { imageUrl } from "../../lib/image-url";

function looksLikeFilePath(candidate: string): boolean {
  const trimmed = candidate.replace(/^[`"'\s]+|[`"'\s]+$/g, "");
  if (!trimmed || trimmed.length > 4096) return false;
  // Windows 盘符单独走规则；非盘符路径禁掉明显非法字符
  const hasDrive = /^[A-Za-z]:[\\/]/.test(trimmed);
  if (!hasDrive && /[<>:"|?*\u0000-\u001f]/.test(trimmed)) return false;
  // 版本号 / 纯数字 token（2.55.0、v24.19.0、11.17.0、384.4）不是文件
  if (/^[vV]?\d[\d.,]*\d$/.test(trimmed)) return false;
  // 中文描述末尾的小数（累计升值超0.4、增长3.5）不是“.4/.5 文件”。
  if (/\.\d{1,5}$/.test(trimmed)) return false;
  if (hasDrive) return /\.[A-Za-z0-9]{1,5}$/.test(trimmed);
  if (trimmed.startsWith("~/") || trimmed.startsWith("./") || trimmed.startsWith("../")) return true;
  if (/[\\/]/.test(trimmed) && /\.[A-Za-z0-9]{1,5}$/.test(trimmed)) return true;
  // 裸路径：单词或连续中文，不带空格、不带引号
  if (/\s/.test(trimmed)) return false;
  if (/^[A-Za-z0-9_.\u4e00-\u9fa5-]+\.[A-Za-z0-9]{1,5}$/.test(trimmed)) return true;
  return false;
}

function extractFilePathsFromMarkdown(text: string): { path: string; prefix: string }[] {
  const seen = new Set<string>();
  const out: { path: string; prefix: string }[] = [];
  const push = (raw: string, prefix: string) => {
    const trimmed = raw.replace(/^[`"'\s]+|[`"'\s]+$/g, "").replace(/[\\/]+$/, "");
    if (!looksLikeFilePath(trimmed)) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push({ path: trimmed, prefix });
  };
  const parts = text.split(/```/);
  for (let i = 0; i < parts.length; i += 2) {
    const part = parts[i];
    if (part == null) break;
    for (const line of part.split(/\r?\n/)) {
      // 1) 路径 / Path / 文件 / 位置 关键字前缀（行级，整行就是「keyword: path」）
      const kw = line.match(/^[ \t]*(?:路径|Path|路径名|文件|位置|File|path)[:：][ \t]*(.+?)[ \t]*$/i);
      if (kw) {
        push(kw[1], kw[1].replace(/\s+/g, " ").trim());
        continue;
      }
      // 2) 反引号包裹：本行所有反引号块都收；整行就是单个反引号路径时才把整行也算上
      const bt = line.match(/`([^`\n]+)`/g);
      if (bt) {
        for (const piece of bt) push(piece.slice(1, -1), piece);
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("`") && trimmedLine.endsWith("`") && bt.length === 1) {
          push(trimmedLine.slice(1, -1), trimmedLine);
        }
        continue;
      }
      // 3) 全行就是 Windows 绝对路径（含盘符）；Chinese 字符非 word-boundary，直接定位
      const abs = line.match(/([A-Za-z]:[\\/][^\s<>:"|?*\n]+\.[A-Za-z0-9]{1,5})/);
      if (abs) {
        push(abs[1], abs[1]);
        continue;
      }
      // 4) 任意裸文件路径（含扩展名的 token），可在一行里出现多次
      const bareMatches = line.match(/([^\s<>:"|?*()<>\[\]{}]+\.[A-Za-z0-9]{1,5})/g);
      if (bareMatches) {
        for (const m of bareMatches) push(m, m);
      }
    }
  }
  return out;
}

export function InlineFileCards({ text, onOpenFile }: { text: string; onOpenFile?: (path: string) => void }) {
  const matches = useMemo(() => extractFilePathsFromMarkdown(text), [text]);
  const [resolvedPaths, setResolvedPaths] = useState<Record<string, string>>({});
  // 探测两步走（全程只 stat，不扫磁盘）：① 按解析路径直查；② 裸文件名查会话路径台账
  // （工具调用等消息项里出现过的真实路径）。都找不到才灰显，点击只弹提示、不再炸读取错误。
  useEffect(() => {
    let cancelled = false;
    setResolvedPaths({});
    for (const m of matches) {
      const abs = resolveFilePath(m.path) ?? m.path;
      window.codex.fileExists(abs)
        .then(async (r) => {
          if (cancelled) return;
          if (r?.exists) {
            setResolvedPaths((prev) => ({ ...prev, [m.path]: abs }));
            return;
          }
          const known = lookupKnownFile(m.path) ?? null;
          if (cancelled) return;
          if (!known) return;
          try {
            const check = await window.codex.fileExists(known);
            if (cancelled) return;
            if (check?.exists) setResolvedPaths((prev) => ({ ...prev, [m.path]: known }));
          } catch { /* 无真实文件就不渲染卡片 */ }
        })
        .catch(() => { /* 探测失败不渲染，避免制造点不开的假卡片 */ });
    }
    return () => { cancelled = true; };
  }, [matches]);
  const confirmed = matches.filter((match) => Boolean(resolvedPaths[match.path]));
  if (confirmed.length === 0) return null;
  return (
    <div className="inline-file-cards" aria-label="涉及到的文件">
      {confirmed.map((m, index) => {
        const name = basename(m.path) || m.path;
        const openPath = resolvedPaths[m.path];
        return (
          <button
            type="button"
            className="inline-file-card"
            key={`${m.path}-${index}`}
            title={isImagePath(openPath) ? `点击预览：${openPath}` : `点击打开：${openPath}`}
            onClick={() => {
              if (isImagePath(openPath)) openImageLightbox(openPath, name);
              else onOpenFile?.(openPath);
            }}
          >
            {isImagePath(m.path) ? (
              <span className="inline-file-thumb">
                <img src={imageUrl(resolveFilePath(openPath) ?? openPath)} alt="" loading="lazy" onError={(event) => { (event.currentTarget as HTMLImageElement).style.display = "none"; }} />
              </span>
            ) : <FileText size={14} />}
            <span className="inline-file-name">{name}</span>
            {openPath !== name && <span className="inline-file-path">{openPath}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function UserRefsRow({ refs, onOpenFile, onQuote, extraThumbs, hideFiles }: { refs: ParsedUserRefs; onOpenFile?: (path: string) => void; onQuote?: (text: string) => void; extraThumbs?: ReactNode; hideFiles?: boolean }) {
  const { files, skills, contexts } = refs;
  const visibleFiles = hideFiles ? [] : files;
  if (!visibleFiles.length && !skills.length && !contexts.length && !extraThumbs) return null;
  return (
    <div className="msg-refs">
      {visibleFiles.map((path, index) => {
        const name = basename(path) || path;
        if (isImagePath(path)) {
          // ⛔ 必须走 imageDisplaySrc：写 `startsWith("http") ? path : imageUrl(path)` 会让
          //    data URL 被当成本地路径（09-18 守卫【47】抓到的残留，与灯箱同类缺陷）。
          const src = imageDisplaySrc(path);
          return (
            <button type="button" className="ref-file-card ref-image-card" title={name} onClick={() => openImageLightbox(path, name)} key={index}>
              <span className="ref-image-thumb">
                <img src={src} alt={name} loading="lazy" />
                <span className="ref-image-preview"><img src={src} alt={name} /></span>
              </span>
            </button>
          );
        }
        return (
          <button type="button" className="ref-file-card" title={name} onClick={() => onOpenFile?.(path)} key={index}>
            <FileText size={14} />
            <span className="ref-file-name">{name}</span>
          </button>
        );
      })}
      {skills.map((skill, index) => (
        <span className="ref-skill-chip" title={skill.description || skill.name} key={index}><Zap size={12} /><span>{skill.name}</span></span>
      ))}
      {contexts.map((ctx, index) => (
        <button type="button" className="ref-context-card" title="点击引用" onClick={() => onQuote?.(`${ctx.role}：${ctx.text}`)} key={index}>
          <Quote size={13} />
          <span className="ref-context-role">{ctx.role}</span>
          <span className="ref-context-text">{ctx.text}</span>
        </button>
      ))}
      {extraThumbs}
    </div>
  );
}
