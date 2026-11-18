import { useEffect, useState } from "react";
import { Activity, ClipboardCheck, Copy, ExternalLink, RefreshCw, TrendingUp } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import type { RuntimeRow } from "../../lib/runtime-row";
import { PluginGuide } from "./PluginGuide";

/** 展示知微核心技能的实际位置，并提供项目初始化和缺件修复指引。 */
export function PredictionCard() {
  const [revision, setRevision] = useState(0);
  const [row, setRow] = useState<RuntimeRow>();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    setLoading(true); setNotice(""); setRow(undefined);
    void window.codex.listRuntimes().then(rows => {
      if (alive) setRow(rows.find(item => item.id === "cheat-on-content"));
    }).catch(() => { if (alive) setNotice("无法读取本机工具清单"); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [revision]);
  return <section className="settings-section stack feishu-cli-card">
    <div className="feishu-cli-list"><div className="runtime-row"><Activity size={16} /><div><strong>核心技能文件</strong><p>{loading ? "检测中…" : row ? row.installed ? "已就绪" : "缺少核心文件" : "本机未返回检测结果"}</p></div>
      <button type="button" className="runtime-install" disabled={loading} onClick={() => setRevision(v => v + 1)}><RefreshCw size={14} />重新检测</button></div></div>
    {row?.installTarget && <p className="tool-list-preview">{row.installTarget}</p>}
    <div className="devtools-card-actions"><button type="button" className="secondary-setting" disabled={!row?.fallbackPrompt} onClick={async () => {
      try { await copyTextToClipboard(row!.fallbackPrompt!); setNotice("已复制检查与修复提示词"); } catch { setNotice("复制失败，请选中提示词手动复制"); }
    }}><Copy size={14} />复制检查与修复提示词</button><button type="button" className="secondary-setting" onClick={() => void window.codex.openExternal("https://github.com/XBuilderLAB/cheat-on-content")}><ExternalLink size={14} />GitHub 上游</button></div>
    {row?.fallbackPrompt && <details><summary>查看提示词</summary><pre className="tool-list-preview">{row.fallbackPrompt}</pre></details>}
    {notice && <small role="status">{notice}</small>}
    <PluginGuide capabilities={[{icon: ClipboardCheck, title: "稿件打分", desc: "按项目评分标准评估脚本"}, {icon: TrendingUp, title: "盲预测与复盘", desc: "发布前记录预测，发布后用实绩校准"}]} steps={[{b: "初始化项目", s: "打开知微会话，指定工作目录并发送「初始化 cheat-on-content」。"}, {b: "提交稿件", s: "把稿件交给知微打分并记录预测；发布后补入实际数据。"}]} notes={["工具状态反映随包核心文件。项目初始化由知微在选定工作目录中检查。"]} />
  </section>;
}
