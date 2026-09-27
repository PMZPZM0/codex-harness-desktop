/** 手机控制（phone-harness）卡片（09-27 新增，嵌在「开发工具」页）。
 *
 * ⛔ 平台分叉是**能力边界**，不是文案：
 *   · win32 / linux —— 只有 Android 通道（adb）与云手机；iPhone 通道不存在（要 macOS 的镜像窗口）。
 *   · darwin        —— Android 通道 + iPhone 镜像（还要辅助功能 / 屏幕录制授权）。
 *   状态与主进程 electron/features/phone-harness.ts 同源；这里只渲染，不自己判定。
 */
import { useCallback, useEffect, useState } from "react";
import { Smartphone, Download, Trash2, Stethoscope, ShieldCheck, CircleCheck, AlertTriangle } from "lucide-react";
import { Spinner } from "../../components/CardShell";

type Status = {
  platform: string;
  python: string;
  pythonOk: boolean;
  installed: boolean;
  version: string;
  adb: boolean;
  skill: boolean;
  telemetryOff: boolean;
  iphoneEligible: boolean;
};
type Guide = { id: string; title: string; steps: string[] };

export function PhoneHarnessCard({ setNotice }: { setNotice: (text: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [busy, setBusy] = useState<"" | "install" | "uninstall" | "doctor">("");
  const [log, setLog] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, g] = await Promise.all([
        window.codex.phoneHarnessStatus(),
        window.codex.phoneHarnessGuides().catch(() => [] as Guide[]),
      ]);
      setStatus(s);
      setGuides(g ?? []);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (kind: "install" | "uninstall" | "doctor") => {
    setBusy(kind);
    setLog("");
    try {
      const r = kind === "doctor"
        ? await window.codex.phoneHarnessDoctor()
        : kind === "install"
          ? await window.codex.phoneHarnessInstall()
          : await window.codex.phoneHarnessUninstall();
      setLog(r.log ?? "");
      setNotice(r.ok
        ? (kind === "install" ? "phone-harness 已安装：遥测已关闭、技能已注册，去会话里直接让 Codex 操作手机即可。"
          : kind === "uninstall" ? "phone-harness 已卸载。" : "体检完成，结论见卡片下方输出。")
        : `${kind} 未完成：${(r.log ?? "").split("\n").slice(-2).join(" ")}`);
    } catch (error: any) {
      setNotice(`操作失败：${error?.message ?? ""}`);
    } finally {
      setBusy("");
      void refresh();
    }
  };

  const darwin = status?.platform === "darwin";
  const ready = Boolean(status?.installed && status?.skill);

  return (
    <div className="devtools-phone-card">
      <div className="settings-subhead">
        <Smartphone size={13} />手机控制（phone-harness）
        <span className="settings-subhead-hint">
          {darwin ? "Android（adb）+ iPhone（Mac 镜像）" : "仅 Android（adb）与云手机 —— iPhone 通道需要 macOS"}
        </span>
      </div>
      <p className="settings-card-hint">
        让 Codex 直接操作真机：看屏幕、点、打字、滑、读结果。上游是 MIT 许可的 Python CLI，装机后我们把它的
        SKILL.md 注册成引擎技能，模型自己按 skill 写法调用。
        <strong> 装完会自动关掉上游遥测</strong>（它默认开，且会带上你的任务文本与调用参数）。
        保持按需安装（不上内置）是为了随时拿上游修复：上游还是 alpha、每周都在改，点「检查更新」即拉最新版。
      </p>
      <div className="phone-status-row">
        <span>{status?.installed ? <><CircleCheck size={12} />已安装{status.version ? ` v${status.version}` : ""}</> : <><AlertTriangle size={12} />未安装</>}</span>
        <span>Python：{status?.pythonOk ? "可用" : "不可用（先在上方装 Python 运行时）"}</span>
        <span>adb：{status?.adb ? "可用" : "未检测到（Android 通道需要它）"}</span>
        <span>技能：{status?.skill ? "已注册" : "未注册"}</span>
        <span>遥测：{status?.installed ? (status.telemetryOff ? "已关闭" : "开启中（建议关闭）") : "—"}</span>
        <span>iPhone：{darwin ? "本机型支持（需授权）" : "不支持（需 macOS）"}</span>
      </div>
      <div className="phone-actions">
        <button className="secondary-setting" disabled={!status?.pythonOk || busy !== ""} onClick={() => void act("install")} title="已装时拉取上游最新版本（pip -U）">
          {busy === "install" ? <Spinner /> : <Download size={14} />}{status?.installed ? "检查更新" : "安装"}
        </button>
        <button className="secondary-setting" disabled={!status?.installed || busy !== ""} onClick={() => void act("doctor")}>
          {busy === "doctor" ? <Spinner /> : <Stethoscope size={14} />}体检
        </button>
        <button className="secondary-setting" disabled={!status?.installed || busy !== ""} onClick={() => void act("uninstall")}>
          {busy === "uninstall" ? <Spinner /> : <Trash2 size={14} />}卸载
        </button>
        <button className="secondary-setting" onClick={() => void window.codex.phoneHarnessOpenSettings().catch(() => undefined)}>
          <ShieldCheck size={14} />打开系统权限设置
        </button>
        {ready ? <span className="phone-ready">就绪：会话里让 Codex “用手机打开…”即可</span> : null}
      </div>
      {guides.length > 0 && (
        <div className="phone-guides">
          {guides.map((guide) => (
            <div key={guide.id} className="phone-guide">
              <strong>{guide.title}</strong>
              <ol>{guide.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
            </div>
          ))}
        </div>
      )}
      {log ? <pre className="phone-log">{log}</pre> : null}
    </div>
  );
}
