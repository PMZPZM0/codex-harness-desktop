/**
 * Husk 卡片（11-14，嵌在「设置 → 开发工具」，结构照 FeishuCliCard）。
 *
 * Husk（Leviidev/Husk，GPL-2.0）：iPhone 上跑 Android APK 的开源运行环境（翻译层 + QEMU，iOS 15.5+）。
 * 电脑侧只能做三件事：按需下载官方 Husk.ipa、校验、把侧载指南/AltStore 源交给用户。
 * ⛔ 不从电脑直接「安装到 iPhone」——那需要真机 + SideStore/AltStore/TrollStore 签名侧载；
 *   卡片必须如实说清最后一步在 iPhone 上完成，不能假装已装好。
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Check, Copy, Download, ExternalLink, FolderOpen, HelpCircle, Layers, MonitorSmartphone,
  Play, RefreshCw, Smartphone, Trash2, Zap,
} from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SettingsDialog } from "../../components/SettingsDialog";
import { copyTextToClipboard } from "../../lib/clipboard";
import { RuntimeUpdateRow } from "./RuntimeUpdateRow";

/** 「能做什么」清单：按 Husk README 的两条运行路径整理。 */
const CAPABILITIES = [
  { icon: Zap, title: "翻译层直跑", desc: "64 位 Android 代码直接在 iPhone 上执行，不启动整台 Android，游戏秒开" },
  { icon: Layers, title: "QEMU 兜底", desc: "翻译层跑不了的应用，用 QEMU 跑完整 LineageOS 客户机" },
  { icon: Play, title: "导入 APK 全屏", desc: "把 APK 加进 Husk，点一下全屏启动；支持游戏/普通应用" },
  { icon: MonitorSmartphone, title: "iOS 原生体验", desc: "全屏、触摸、音频、输入按 iPhone 的方式工作" },
  { icon: Smartphone, title: "iOS 15.5+", desc: "SideStore / AltStore / TrollStore 三种侧载方式" },
  { icon: RefreshCw, title: "持续更新", desc: "上游 release 更新后，这张卡可直接检查并重新下载 IPA" },
];

type Status = {
  installed: boolean;
  version: string;
  path: string;
  sizeBytes: number;
  tipaInstalled: boolean;
  tipaVersion: string;
  tipaPath: string;
  tipaSizeBytes: number;
  guideUrl: string;
  sourceUrl: string;
  requirement: string;
  attribution: { license: string; home: string };
};

/** Husk 卡片：IPA 下载/更新/卸载 + iPhone 侧载引导。 */
export function HuskCard({ setNotice, installDevRuntime, runtimeInstalling, uninstallDevRuntime, runtimeUninstalling, runtimeStage, runtimePercent, runtimeSpeed, runtimeProgress, cancelDevRuntime, setRuntimeModal }: {
  setNotice: (text: string, detail?: string) => void;
  installDevRuntime?: (id: string) => void;
  runtimeInstalling?: string | null;
  uninstallDevRuntime?: (id: string) => unknown;
  runtimeUninstalling?: string | null;
  runtimeStage?: Record<string, string>;
  runtimePercent?: Record<string, number> | null;
  runtimeSpeed?: Record<string, string> | null;
  runtimeProgress?: Record<string, string> | null;
  cancelDevRuntime?: (id: string) => unknown;
  setRuntimeModal?: (value: { id?: string; name?: string; mode?: string; done?: boolean; failed?: boolean; error?: string } | null) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [uninstallOpen, setUninstallOpen] = useState(false);

  const refresh = useCallback(async () => {
    try { setStatus((await window.codex.huskStatus()) as Status); } catch { /* 主进程没接上就保持现状 */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const installing = runtimeInstalling === "husk";
  const tipaInstalling = runtimeInstalling === "husk-tipa";
  const otherBusy = Boolean(runtimeInstalling) && !installing && !tipaInstalling;
  const uninstalling = runtimeUninstalling === "husk";
  const percent = Math.round(Number(runtimePercent?.["husk"] ?? 0));
  const speed = runtimeSpeed?.["husk"] ?? "";
  const latest = runtimeProgress?.["husk"] ?? "";
  const installFailed = latest.startsWith("安装失败");
  const sizeMb = status?.sizeBytes ? Math.round(status.sizeBytes / 1048576) : 0;
  const tipaMb = status?.tipaSizeBytes ? Math.round(status.tipaSizeBytes / 1048576) : 0;
  const tipaPercent = Math.round(Number(runtimePercent?.["husk-tipa"] ?? 0));
  const tipaStage = runtimeStage?.["husk-tipa"] ?? "";
  const tipaLatest = runtimeProgress?.["husk-tipa"] ?? "";

  useEffect(() => {
    const off = window.codex.onRuntimeProgress((payload: { id?: string; done?: boolean }) => {
      if ((payload?.id !== "husk" && payload?.id !== "husk-tipa") || !payload.done) return;
      void refresh();
    });
    return off;
  }, [refresh]);

  const openGuide = async () => {
    try { await window.codex.huskGuide(); setNotice?.("已打开 Husk 安装指南", "在 iPhone 上用 SideStore / AltStore / TrollStore 选择一种方式"); }
    catch { setNotice?.("打开失败", "可以复制指南地址在浏览器里打开"); }
  };
  const copySource = async () => {
    const url = status?.sourceUrl ?? "https://itslevii.dev/repo.json";
    try { await copyTextToClipboard(url); setNotice?.("已复制 SideStore / AltStore 源", url); }
    catch { setNotice?.("复制失败", url); }
  };
  const reveal = async () => { try { await window.codex.huskReveal(); } catch { setNotice?.("打不开文件夹", "IPA 可能还没下载"); } };

  const uninstall = async () => {
    try {
      setNotice?.("正在删除 Husk.ipa…");
      await Promise.resolve(uninstallDevRuntime?.("husk"));
      setNotice?.("Husk 安装包已删除", "iPhone 上已侧载的 Husk 不受影响");
    } catch (err) {
      setNotice?.("删除失败", String((err as { message?: unknown })?.message ?? err));
    }
    setUninstallOpen(false);
    void refresh();
  };

  return (
    <>
      <section className="settings-section stack feishu-cli-card">
        <div className="feishu-cli-list">
          <div className={`runtime-row ${status?.installed ? "installed" : "missing"} ${installing ? "busy" : ""}`}>
            <span className="runtime-icon">{installing ? <Spinner /> : status?.installed ? <Check size={15} /> : <Download size={15} />}</span>
            <span className="runtime-copy">
              <strong>下载 Husk.ipa</strong>
              <small>{installing ? "正在准备下载（约 142 MB，自动选最快的国内镜像）…" : status?.installed ? `已下载${status.version ? ` ${status.version}` : ""}${sizeMb ? `（${sizeMb} MB）` : ""}；删除只影响电脑上的安装包，iPhone 上已装的 Husk 不受影响` : "约 142 MB：从 GitHub release 镜像序下载官方 Husk.ipa + SHA256 校验；⛔ 电脑侧只准备安装包，最后一步要在 iPhone 上侧载"}</small>
              {installing ? (
                <span className="runtime-install-state devtools-progress-row">
                  <span className="runtime-progress-bar" role="progressbar" aria-label="Husk 下载进度" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${percent}%` }} />
                  </span>
                  <em className="runtime-progress">
                    {runtimeStage?.["husk"] || "正在选择最快的下载源…"}
                    {percent ? ` · ${percent}%` : ""}
                    {speed ? ` · ${speed}` : ""}
                    {latest && !installFailed ? ` · ${latest}` : ""}
                  </em>
                </span>
              ) : null}
              {installFailed ? (
                <button type="button" className="runtime-failed" onClick={() => setRuntimeModal?.({ id: "husk", name: "Husk（iPhone 跑 Android）", mode: "install", done: true, failed: true, error: latest.replace(/^安装失败：/, "") })}>
                  <AlertTriangle size={12} />下载失败 · 点开完整报错与备用方案
                </button>
              ) : null}
            </span>
            <div className="runtime-actions">
              {status?.installed ? <>
                  <span className="runtime-badge installed">已下载</span>
                  <button type="button" className="runtime-install feishu-cli-uninstall" disabled={uninstalling} title="删除电脑上的 Husk.ipa" onClick={() => setUninstallOpen(true)}>
                    {uninstalling ? <><Spinner /> 删除中</> : <><Trash2 size={13} />删除</>}
                  </button>
                </>
                : installing ? (
                  <button type="button" className="secondary-setting runtime-cancel" onClick={() => void cancelDevRuntime?.("husk")}>取消</button>
                ) : <button type="button" className="primary-setting runtime-install" disabled={otherBusy} onClick={() => installDevRuntime?.("husk")}>
                    <Download size={14} />下载 IPA
                  </button>}
            </div>
          </div>

          <RuntimeUpdateRow
            id="husk"
            installed={Boolean(status?.installed)}
            hint="从 GitHub release 镜像序重新下载新版 Husk.ipa（约 142 MB，SHA256 校验）"
            runtimeStage={runtimeStage}
            runtimePercent={runtimePercent}
            runtimeSpeed={runtimeSpeed}
            runtimeProgress={runtimeProgress}
            cancelDevRuntime={cancelDevRuntime}
            onUpdated={refresh}
          />

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon"><Smartphone size={15} /></span>
            <span className="runtime-copy">
              <strong>侧载到 iPhone</strong>
              <small>iOS 15.5+：用 SideStore / AltStore / TrollStore 安装 Husk.ipa；装好后在 Husk 里导入 APK 即可全屏运行（部分游戏需要 JIT）</small>
            </span>
            <div className="runtime-actions">
              <button type="button" className="primary-setting runtime-install" onClick={() => void openGuide()}><HelpCircle size={13} />安装指南</button>
              <button type="button" className="secondary-setting runtime-install" onClick={() => void copySource()}><Copy size={13} />复制 AltStore 源</button>
              {status?.installed ? <button type="button" className="secondary-setting runtime-install" onClick={() => void reveal()}><FolderOpen size={13} />打开 IPA</button> : null}
            </div>
          </div>

          <div className={`runtime-row ${status?.tipaInstalled ? "installed" : "missing"} ${tipaInstalling ? "busy" : ""}`}>
            <span className="runtime-icon">{tipaInstalling ? <Spinner /> : status?.tipaInstalled ? <Check size={15} /> : <Download size={15} />}</span>
            <span className="runtime-copy">
              <strong>TrollStore 专用（可选）</strong>
              <small>{tipaInstalling ? "正在下载 Husk.tipa…" : status?.tipaInstalled ? `已下载 TIPA${status.tipaVersion ? ` ${status.tipaVersion}` : ""}${tipaMb ? `（${tipaMb} MB）` : ""}；TrollStore 用户装这个更方便` : "TrollStore 用户可单独下载 .tipa（与 IPA 同版本）；SideStore / AltStore 用户不需要"}</small>
              {tipaInstalling ? (
                <span className="runtime-install-state devtools-progress-row">
                  <span className="runtime-progress-bar" role="progressbar" aria-label="TIPA 下载进度" aria-valuenow={tipaPercent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${tipaPercent}%` }} /></span>
                  <em className="runtime-progress">{tipaStage || "正在准备下载…"}{tipaPercent ? ` · ${tipaPercent}%` : ""}{tipaLatest ? ` · ${tipaLatest}` : ""}</em>
                </span>
              ) : null}
            </span>
            <div className="runtime-actions">
              {tipaInstalling ? (
                <button type="button" className="secondary-setting runtime-cancel" onClick={() => void cancelDevRuntime?.("husk-tipa")}>取消</button>
              ) : status?.tipaInstalled ? (
                <span className="runtime-badge installed">TIPA 已下载</span>
              ) : (
                <button type="button" className="secondary-setting runtime-install" disabled={otherBusy} onClick={() => installDevRuntime?.("husk-tipa")}><Download size={13} />下载 TIPA</button>
              )}
            </div>
          </div>

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon"><Zap size={15} /></span>
            <span className="runtime-copy">
              <strong>兼容性</strong>
              <small>翻译层优先、跑不了自动走 QEMU（完整 LineageOS）；银行类应用与部分反作弊游戏会检测运行环境，装前先看上游兼容列表</small>
            </span>
            <div className="runtime-actions">
              <button type="button" className="secondary-setting runtime-install" onClick={() => void window.codex.openExternal(status?.attribution?.home ?? "https://github.com/Leviidev/Husk")}><ExternalLink size={13} />兼容列表</button>
            </div>
          </div>
        </div>

        <section className="feishu-cli-guide">
          <div className="feishu-cli-guide-head">
            <strong>能做什么</strong>
            <small>iPhone 上直接跑 Android 应用与游戏：不需要越狱，不需要电脑常驻</small>
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
            <strong>怎么装</strong>
            <small>电脑只负责准备 IPA；真正安装要在 iPhone 上完成</small>
          </div>
          <ol className="feishu-cli-guide-steps">
            <li><b>先下载 IPA</b><span>点上面的「下载 IPA」；这张卡会做 SHA256 校验，并用「打开 IPA」定位文件。</span></li>
            <li><b>在 iPhone 上侧载</b><span>推荐 SideStore / AltStore：添加源 <code>https://itslevii.dev/repo.json</code> 后直接装 Husk；或按官方指南用 TrollStore。</span></li>
            <li><b>导入 APK</b><span>打开 Husk → 添加 APK → 点一下全屏运行。部分游戏要按指南开启 JIT。</span></li>
          </ol>

          <ul className="feishu-cli-notes">
            <li>Husk 是 iPhone 应用（iOS 15.5+）；电脑这张卡不会、也无法替你把 IPA 装进 iPhone。</li>
            <li>本应用只下载官方 IPA 与提供指南，不重签名、不修改 Husk 代码；许可 GPL-2.0-or-later。</li>
            <li>银行类应用、部分反作弊游戏会拒绝在 Husk 里运行；安装前先看上游兼容列表。</li>
          </ul>
        </section>

        {status?.attribution && (
          <p className="openfilm-attribution">
            第三方开源项目 Husk · 许可 <b>{status.attribution.license}</b> · 由 Leviidev 与贡献者开发 ·
            <button type="button" className="openfilm-link" onClick={() => void window.codex.openExternal(status.attribution.home)}>
              {status.attribution.home.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink size={10} />
            </button>
            <br />
            <span className="openfilm-fineprint">本应用只下载 Husk 官方发布包并展示侧载指南；安装、运行与数据都在你的 iPhone 上，与 Husk 项目无隶属关系。</span>
          </p>
        )}
      </section>

      {uninstallOpen && (
        <SettingsDialog title="删除 Husk.ipa" icon={<Trash2 size={15} />} hint="只删电脑上的安装包" size="sm" onClose={() => setUninstallOpen(false)}>
          <div className="settings-section stack feishu-uninstall-confirm">
            <p className="settings-card-hint">
              会删除电脑上下载的 Husk.ipa 与 Husk.tipa（各约 142 MB）。iPhone 上已经侧载的 Husk 应用与 Android 数据不会被影响。
            </p>
            <div className="feishu-uninstall-actions">
              <button type="button" className="secondary-setting" onClick={() => setUninstallOpen(false)}>取消</button>
              <button type="button" className="primary-setting danger" onClick={() => void uninstall()}><Trash2 size={13} />删除</button>
            </div>
          </div>
        </SettingsDialog>
      )}
    </>
  );
}
