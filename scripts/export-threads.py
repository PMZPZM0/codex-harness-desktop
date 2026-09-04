#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Codex Harness Desktop - 历史会话导出/恢复工具
================================================
背景：engine 0.150.1 的 thread/list 在存在 legacy sessions/** rollout 文件时返回空列表，
导致应用侧边栏历史消失（数据本身未丢）。本脚本直接从 rollout JSONL 恢复全部对话内容。

用法：
  python export-threads.py [codex-home路径] [输出目录]
默认：
  codex-home = %APPDATA%/Codex Harness Desktop/codex-home
  输出目录   = <脚本所在目录>/../thread-backup-<今天>
"""
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone

# ---------- 路径 ----------
if len(sys.argv) > 1:
    HOME = sys.argv[1]
else:
    HOME = os.path.join(os.environ.get("APPDATA", ""), "Codex Harness Desktop", "codex-home")
if len(sys.argv) > 2:
    OUT = sys.argv[2]
else:
    OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..",
                                       "thread-backup-" + datetime.now().strftime("%Y-%m-%d")))

SESS_DIR = os.path.join(HOME, "sessions")
STATE_DB = os.path.join(HOME, "state_5.sqlite")

# ---------- 读 threads 表（标题/时间/归档） ----------
def load_threads_meta():
    meta = {}
    if not os.path.exists(STATE_DB):
        return meta
    try:
        con = sqlite3.connect("file:" + STATE_DB.replace("\\", "/") + "?mode=ro", uri=True)
        cur = con.cursor()
        cur.execute("SELECT id, title, created_at, updated_at, archived FROM threads")
        for tid, title, created, updated, archived in cur.fetchall():
            meta[tid] = {
                "title": (title or "").strip(),
                "created_at": created,
                "updated_at": updated,
                "archived": bool(archived),
            }
        con.close()
    except Exception as e:
        print("[warn] 读 threads 表失败:", e)
    return meta

# ---------- 遍历 rollout 文件 ----------
def walk_rollouts(root):
    files = []
    for dirpath, _dirs, names in os.walk(root):
        for n in names:
            if n.endswith(".jsonl"):
                files.append(os.path.join(dirpath, n))
    # 按路径排序 = 按日期+时间排序（目录含 YYYY/MM/DD）
    files.sort()
    return files

# ---------- 解析单个 rollout ----------
def parse_rollout(path):
    session_id = None
    parent_id = None
    cwd = None
    originator = None
    msgs = []          # (timestamp_iso, role, text)
    reasoning_n = 0
    tool_n = 0
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            t = ev.get("type")
            ts = ev.get("timestamp", "")
            p = ev.get("payload") or {}
            if t == "session_meta":
                # 注意：threads 表 id / 文件名 id 用的是 session_meta 的 "id" 字段，
                # 不是 "session_id"（那是嵌套子会话的 id）
                if session_id is None:
                    session_id = p.get("id") or p.get("session_id")
                parent_id = p.get("parent_thread_id") or parent_id
                cwd = p.get("cwd") or cwd
                originator = p.get("originator") or originator
            elif t == "event_msg" and p.get("type") == "user_message":
                text = p.get("message", "")
                if not text and p.get("text_elements"):
                    text = "".join(el.get("text", "") for el in p["text_elements"] if isinstance(el, dict))
                if text.strip():
                    msgs.append((ts, "user", text.strip()))
            elif t == "response_item" and p.get("type") == "message":
                role = p.get("role", "")
                if role == "developer":
                    continue
                texts = []
                for c in p.get("content") or []:
                    if isinstance(c, dict) and c.get("type") in ("output_text", "input_text"):
                        t2 = c.get("text", "")
                        if t2:
                            texts.append(t2)
                if texts and role in ("user", "assistant"):
                    joined = "\n".join(texts)
                    # 跳过系统注入的用户消息（AGENTS.md / environment_context）
                    if role == "user" and ("<INSTRUCTIONS>" in joined or "<environment_context>" in joined
                                           or joined.startswith("# AGENTS.md")):
                        continue
                    msgs.append((ts, role, joined))
            elif t == "response_item" and p.get("type") == "reasoning":
                reasoning_n += 1
            elif t == "response_item" and p.get("type") in ("function_call", "custom_tool_call", "web_search_call"):
                tool_n += 1
    return {
        "session_id": session_id,
        "parent_id": parent_id,
        "cwd": cwd,
        "originator": originator,
        "msgs": msgs,
        "reasoning_n": reasoning_n,
        "tool_n": tool_n,
        "path": path,
    }

# ---------- 主流程 ----------
def main():
    meta = load_threads_meta()
    print(f"[1/3] threads 表: {len(meta)} 条")
    files = walk_rollouts(SESS_DIR)
    print(f"[2/3] rollout 文件: {len(files)} 个")

    # 按 session_id 聚合
    threads = {}   # id -> {files:[...], msgs:[...], reasoning, tool, parent, cwd, originator}
    order = []
    for fp in files:
        r = parse_rollout(fp)
        sid = r["session_id"] or os.path.basename(fp).split("-", 2)[-1].rsplit(".", 1)[0]
        if sid not in threads:
            threads[sid] = {"files": [], "msgs": [], "reasoning_n": 0, "tool_n": 0,
                            "parent_id": None, "cwd": None, "originator": None}
            order.append(sid)
        g = threads[sid]
        g["files"].append(fp)
        g["msgs"].extend(r["msgs"])
        g["reasoning_n"] += r["reasoning_n"]
        g["tool_n"] += r["tool_n"]
        g["parent_id"] = r["parent_id"] or g["parent_id"]
        g["cwd"] = r["cwd"] or g["cwd"]
        g["originator"] = r["originator"] or g["originator"]
        # 文件内消息按时间排序（聚合后统一再排一次）
    for g in threads.values():
        g["msgs"].sort(key=lambda m: m[0])
        # 相邻去重：同一用户消息常有多个渲染版本（event 版 / response_item 版），
        # 同 role 且文本互为包含时保留较长者（系统注入版已在解析时过滤）
        dedup = []
        for ts, role, text in g["msgs"]:
            if dedup and dedup[-1][1] == role:
                prev_text = dedup[-1][2]
                if prev_text == text or (role == "user" and (prev_text in text or text in prev_text)):
                    if len(text) > len(prev_text):
                        dedup[-1] = (ts, role, text)
                    continue
            dedup.append((ts, role, text))
        g["msgs"] = dedup

    # 输出
    os.makedirs(os.path.join(OUT, "threads"), exist_ok=True)

    def fmt_ts(ts):
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            return ts

    def fmt_epoch(ep):
        try:
            return datetime.fromtimestamp(ep).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            return str(ep)

    def title_of(sid):
        m = meta.get(sid)
        if m and m.get("title"):
            return m["title"]
        for _ts, _role, text in threads[sid]["msgs"]:
            if _role == "user":
                t = text.replace("\n", " ").strip()
                return t[:40]
        return "(无标题)"

    idx_rows = []
    for sid in order:
        g = threads[sid]
        m = meta.get(sid, {})
        title = title_of(sid)
        user_n = sum(1 for x in g["msgs"] if x[1] == "user")
        agent_n = sum(1 for x in g["msgs"] if x[1] == "assistant")
        safe = re.sub(r'[\\/:*?"<>|]', "_", sid)
        fn = os.path.join(OUT, "threads", f"{safe}.md")
        lines = [
            f"# {title}",
            "",
            f"- **会话 ID**：`{sid}`",
            f"- **创建时间**：{fmt_epoch(m.get('created_at')) if m.get('created_at') else '—'}",
            f"- **最后更新**：{fmt_epoch(m.get('updated_at')) if m.get('updated_at') else '—'}",
            f"- **归档**：{'是' if m.get('archived') else '否'}",
            f"- **工作目录**：`{g['cwd'] or '—'}`",
            f"- **来源**：{g['originator'] or '—'}",
            f"- **rollout 文件**：{len(g['files'])} 个",
            f"- **消息**：用户 {user_n} 条 / 助手 {agent_n} 条"
            + (f" / 思考 {g['reasoning_n']} 条 / 工具调用 {g['tool_n']} 次" if (g["reasoning_n"] or g["tool_n"]) else ""),
            "",
            "---",
            "",
        ]
        for ts, role, text in g["msgs"]:
            who = "🧑 **用户**" if role == "user" else "🤖 **助手**"
            lines.append(f"### {who}　{fmt_ts(ts)}")
            lines.append("")
            lines.append(text)
            lines.append("")
        if not g["msgs"]:
            lines.append("_（该会话无消息记录）_")
            lines.append("")
        with open(fn, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        idx_rows.append((fmt_epoch(m.get("created_at")) if m.get("created_at") else "—",
                         title, len(g["files"]), user_n, agent_n, "是" if m.get("archived") else "否",
                         f"threads/{safe}.md"))

    # 索引
    idx_rows.sort(key=lambda r: r[0], reverse=True)
    il = ["# 会话历史导出（thread/list 兼容性故障恢复）", "",
          f"- 导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
          f"- 数据源：`{SESS_DIR}`（rollout 文件 {len(files)} 个）",
          f"- 恢复线程：{len(order)} 个（含无消息记录者）",
          f"- threads 表：{len(meta)} 条（state_5.sqlite，数据完好）", "",
          "| 创建时间 | 标题 | 文件 | 用户 | 助手 | 归档 | 文档 |",
          "|---|---|---|---|---|---|---|"]
    for r in idx_rows:
        il.append(f"| {r[0]} | {r[1][:50].replace('|', '｜')} | {r[2]} | {r[3]} | {r[4]} | {r[5]} | [{r[1][:20]}]({r[6]}) |")
    with open(os.path.join(OUT, "index.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(il) + "\n")

    # 也导出元数据 JSON
    with open(os.path.join(OUT, "threads-meta.json"), "w", encoding="utf-8") as f:
        json.dump({sid: {"title": title_of(sid), **meta.get(sid, {})} for sid in order}, f,
                  ensure_ascii=False, indent=2)

    print(f"[3/3] 完成 → {OUT}")
    print(f"      线程 {len(order)} 个，其中含消息 {sum(1 for s in order if threads[s]['msgs'])} 个")
    missing = [tid for tid in meta if tid not in threads]
    if missing:
        print(f"      [注] {len(missing)} 个线程在 sessions/ 下没有 rollout 文件（可能为空会话）：")
        for tid in missing:
            print(f"        - {tid}  {meta[tid]['title'][:40]}")

if __name__ == "__main__":
    main()
