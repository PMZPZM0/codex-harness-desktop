/**
 * Filee 文件转换卡片（10-30，嵌在「设置 → 开发工具」，结构照 FeishuCliCard）。
 *
 * 两步：装 Filee（GitHub release 直下型 151MB，镜像序 + SHA256 校验）→ 直接在对话里说人话。
 * ⛔ 三行用 `runtime-row` 结构与开发工具列表同款（图标 / 标题+说明 / 右侧动作）——
 *    自造样式没有对应 CSS，出来就是原生排版（飞书 CLI 卡 10-29 同款教训）。
 * ⛔ 「控制台更新」不在本卡：Filee 与飞书 CLI 一样进「设置 → 控制台 → 组件更新」的
 *    手动检查清单（runtime:update-check 的 GITHUB_UPDATEABLE 行）；这里只写指路文案。
 * ⛔ 状态以主进程 filee:status 为准（真跑 `filee-cli --version`，60s 缓存）。
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Archive, BookOpen, Check, Download, ExternalLink, FileText, Film, Image as ImageIcon,
  Music, Presentation, RefreshCw, Sigma, Table2, Trash2, Type, Boxes,
} from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SettingsDialog } from "../../components/SettingsDialog";

/** 「能做什么」清单：按 Filee 的转换域归类（口径与 README 的 Formats 表一致）。 */
const CAPABILITIES = [
  { icon: ImageIcon, title: "图片", desc: "heic/psd/raw/webp/avif/tiff 等 ↔ 互转、转 PDF、缩放灰度" },
  { icon: FileText, title: "PDF 与文档", desc: "pdf ↔ docx/txt/png，合并拆分压缩；doc/odt/rtf/pages→pdf" },
  { icon: Table2, title: "表格", desc: "xlsx/xls/ods/csv/tsv ↔ pdf/json/html；Numbers 也能读" },
  { icon: Presentation, title: "演示文稿", desc: "pptx/ppt/odp/keynote → pdf / 每页一张图" },
  { icon: BookOpen, title: "电子书", desc: "epub/mobi/azw3/cbz ↔ pdf/epub/docx/txt" },
  { icon: Film, title: "音视频", desc: "mp4/mkv/mov/webm → mp4/webm/gif，抽音轨 mp3/m4a（需本机 ffmpeg）" },
  { icon: Music, title: "字幕", desc: "srt/ass/webvtt 等互转并统一 UTF-8（韩文 CP949 也能读）" },
  { icon: Archive, title: "归档", desc: "zip/7z/rar/tar/iso 解压；任意文件打包成 zip/7z" },
  { icon: Boxes, title: "CAD / 3D / 字体", desc: "dwg/dxf→pdf/svg；glb/stl/obj 互转+预览；ttf/otf/woff 互转" },
  { icon: Sigma, title: "数据格式", desc: "json/yaml/toml/xml/csv 互转；vCard ↔ CSV" },
];

/** 示例说法：给用户「照着说」的模板（不是 CLI 命令 —— 用户不该背参数）。 */
const EXAMPLES = [
  "把这几张 heic 转成 jpg，放到原图旁边的 converted 文件夹",
  "这份 PDF 帮我转成 docx，我要改两段文字",
  "桌面那个 ppt 转成 pdf 发我",
  "把这段 mp4 的音轨抽成 mp3",
  "这个 epub 转成 pdf，方便打印",
  "把这批 png 全部压成 webp，质量 80",
];

type Status = { installed: boolean; path: string; version: string; detail: string };

export function FileeCard({ setNotice, installDevRuntime, runtimeInstalling, uninstallDevRuntime, runtimeUninstalling, runtimeStage }: {
  setNotice: (text: string, detail?: string) => void;
  installDevRuntime?: (id: string) => void;
  /** ⛔ 真实类型是「正在安装的工具 id」（单个字符串），不是 map（飞书 CLI 卡同款教训）。 */
  runtimeInstalling?: string | null;
  uninstallDevRuntime?: (id: string) => unknown;
  runtimeUninstalling?: string | null;
  /** 安装阶段文案（runtime:progress 的 message，id=filee）；用于下载进度反馈。 */
  runtimeStage?: Record<string, string>;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  /* 卸载确认放在设置内二级弹窗（⛔ 不用 openAppConfirm：挂在设置遮罩之下看不见，飞书卡 10-30 实测）。 */
  const [uninstallOpen, setUninstallOpen] = useState(false);

  const refresh = useCallback(async () => {
    try { setStatus((await window.codex.fileeStatus()) as Status); } catch { /* 主进程没接上就保持现状 */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const uninstall = async () => {
    try {
      setNotice?.("正在卸载 Filee…");
      await Promise.resolve(uninstallDevRuntime?.("filee"));
      setNotice?.("Filee 已卸载", "需要时随时可以再装回来");
    } catch (err) {
      setNotice?.("卸载失败", String((err as { message?: unknown })?.message ?? err));
    }
    void refresh();
  };

  const installing = runtimeInstalling === "filee";
  /* 别的工具在装时也不许并发点（与运行时列表同口径：一次只跑一个安装）。 */
  const otherBusy = Boolean(runtimeInstalling) && !installing;
  const uninstalling = runtimeUninstalling === "filee";

  useEffect(() => {
    const off = window.codex.onRuntimeProgress((payload: { id?: string; done?: boolean }) => {
      if (payload?.id !== "filee" || !payload.done) return;
      void refresh();
    });
    return off;
  }, [refresh]);

  return (
    <>
      <section className="settings-section stack feishu-cli-card">
        <div className="feishu-cli-list">
          <div className={`runtime-row ${status?.installed ? "installed" : "missing"} ${installing ? "busy" : ""}`}>
            <span className="runtime-icon">{installing ? <Spinner /> : status?.installed ? <Check size={15} /> : <Download size={15} />}</span>
            <span className="runtime-copy">
              <strong>安装 Filee</strong>
              <small>{installing ? (runtimeStage?.["filee"] || "正在下载（约 151 MB，国内镜像加速，含 SHA256 校验）…") : status?.installed ? `已安装${status.version ? ` ${status.version}` : ""}；卸载不会影响你的任何文件` : "约 151 MB，GitHub release 国内镜像下载 + SHA256 校验；装好后可在这里卸载"}</small>
            </span>
            <div className="runtime-actions">
              {status?.installed ? <>
                  <span className="runtime-badge installed">已安装</span>
                  <button
                    type="button"
                    className="runtime-install feishu-cli-uninstall"
                    disabled={uninstalling}
                    title="卸载 Filee（弹窗确认；只删程序，不动你的文件）"
                    onClick={() => setUninstallOpen(true)}
                  >
                    {uninstalling ? <><Spinner /> 卸载中</> : <><Trash2 size={13} />卸载</>}
                  </button>
                </>
                : <button type="button" className="primary-setting runtime-install" disabled={installing || otherBusy} onClick={() => installDevRuntime?.("filee")}>
                    {installing ? <><Spinner /> 安装中</> : <><Download size={14} />安装</>}
                  </button>}
            </div>
          </div>

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon"><RefreshCw size={15} /></span>
            <span className="runtime-copy">
              <strong>更新与配套工具</strong>
              <small>更新在「控制台 → 组件更新」列表里手动检查；装好后 Codex 自动多一个 filee_convert 工具，说人话即可</small>
            </span>
            <div className="runtime-actions">
              <span className={`runtime-badge ${status?.installed ? "installed" : ""}`}>{status?.installed ? `filee_convert 已可用` : "安装后可用"}</span>
            </div>
          </div>
        </div>

        <section className="feishu-cli-guide">
          <div className="feishu-cli-guide-head">
            <strong>能做什么</strong>
            <small>244 种格式本地离线互转 —— 文件不上传，不需要 Office / LibreOffice；部分冷门格式（视频/PS/EPS 等）会按需自动下载对应引擎</small>
          </div>
          <div className="feishu-cli-cap-grid">
            {CAPABILITIES.map(({ icon: Icon, title, desc }) => (
              <div className="feishu-cli-cap" key={title}>
                <span className="feishu-cli-cap-icon"><Icon size={15} /></span>
                <span className="feishu-cli-cap-copy"><strong>{title}</strong><small>{desc}</small></span>
              </div>
            ))}
          </div>

          <div className="feishu-cli-guide-head">
            <strong>怎么用</strong>
            <small>装好后直接在对话里说人话，不用背命令</small>
          </div>
          <ol className="feishu-cli-guide-steps">
            <li><b>说清「哪个文件 → 转成什么」</b><span>例如「把这张 heic 转成 jpg」；不知道目标格式叫什么，直接说扩展名就行。</span></li>
            <li><b>说清「放哪里」（可选）</b><span>默认保存在源文件旁边；要说「放到 D:\导出」也可以。</span></li>
            <li><b>批量直接说</b><span>「把这个文件夹里的 png 全转成 webp」——一次最多 64 个文件，自动并行。</span></li>
          </ol>

          <div className="feishu-cli-examples">
            {EXAMPLES.map((text) => <span className="feishu-cli-example" key={text}>{text}</span>)}
          </div>

          <ul className="feishu-cli-notes">
            <li>完全本地转换：文件不上传任何服务器；源文件不会被修改，输出默认写在源文件旁边。</li>
            <li>视频 / 音频转换需要本机 FFmpeg（开发工具页可装）；其余常用格式开箱即用。</li>
            <li>更新去「控制台 → 组件更新」手动检查；卸载只删程序（约 151 MB），不动你的任何文件。</li>
          </ul>
        </section>

        {/* 开源声明（用户令 10-31：必须标注项目声明与 GitHub 跳转；复用 OpenFilm 卡的声明样式） */}
        <p className="openfilm-attribution">
          第三方开源项目 Filee · 许可 <b>MIT</b> · 由 Myeonggu Kim（KnifeLemon）与 Filee 贡献者开发 ·
          <button type="button" className="openfilm-link" onClick={() => void window.codex.openExternal("https://github.com/KnifeLemon/Filee")}>
            github.com/KnifeLemon/Filee <ExternalLink size={10} />
          </button>
          · <button type="button" className="openfilm-link" onClick={() => void window.codex.openExternal("https://filee.sh")}>
            官网 filee.sh <ExternalLink size={10} />
          </button>
          <br />
          <span className="openfilm-fineprint">本应用只做 Filee 官方 CLI 的下载与调用；转换完全在用户本机完成，与 Filee 项目无隶属关系，问题反馈请到其 GitHub 仓库。</span>
        </p>
      </section>

      {/* 卸载确认弹窗（设置内二级弹窗，同飞书 CLI 卡口径）。 */}
      {uninstallOpen && (
        <SettingsDialog title="卸载 Filee" icon={<Trash2 size={15} />} hint="只删程序，不动你的文件" size="sm" onClose={() => setUninstallOpen(false)}>
          <div className="settings-section stack feishu-uninstall-confirm">
            <p className="settings-card-hint">
              会删除本机安装的 Filee 程序（约 151 MB）；你的文件、已转换的结果都不会被改动。
              模型侧的 <code>filee_convert</code> 工具也会随之消失，需要时再装回来即可。
            </p>
            <div className="feishu-uninstall-actions">
              <button type="button" className="secondary-setting" onClick={() => setUninstallOpen(false)}>取消</button>
              <button type="button" className="primary-setting danger" onClick={() => { setUninstallOpen(false); void uninstall(); }}><Trash2 size={13} />卸载</button>
            </div>
          </div>
        </SettingsDialog>
      )}
    </>
  );
}
