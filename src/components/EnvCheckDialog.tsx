import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Check, Download, FolderOpen, Sparkles, Wrench, X } from "lucide-react";

/** 首次启动「环境体检」（09-17 用户要求）：
 *
 *  痛点原话：「很多新用户上来，工具都不会装，也不知道要装哪些，不装 Codex 啥也干不了」。
 *  所以这里只做两件事：**把"缺什么、为什么缺了不行"讲清楚**，以及**一键补齐**。
 *
 *  为什么是这 8 项（用户 09-17 拍板「必备 + 常用」，09-18 点名补 PowerShell 7——"这个是终端必要的工具"）：
 *   - 必备 5 项（模型 / 工作区 / Git / ripgrep / PowerShell 7）—— 缺任何一项，Codex 都"干不好活"：
 *     没模型发不出消息；没工作区不知道改哪个目录；Git 是引擎跑命令/看 diff/提交的硬依赖；
 *     ripgrep 是代码检索主力（缺它搜代码会慢一个数量级）；终端默认 shell 优先用 pwsh 7，
 *     缺了只能退回系统自带的 PowerShell 5.1（模块与脚本兼容性差一截）。
 *   - 常用 3 项（Python / jq / 7-Zip）—— 按需，缺了只是"某些活干不了"，不阻断。
 *   ⛔ 不把 22 个运行时全列出来：新用户的注意力有限，列满只会让他更迷茫（这正是用户遇到的问题）。
 *     其余的仍在「设置 → 开发工具」页按需下载。
 *
 *  ⛔ 一律**弹窗确认后**才下载（用户 09-17 拍板）：Git 90MB + Python 40MB 属于"该知情"的量级，
 *     静默下载会突然吃掉带宽（计量流量/公司网络下会被反感）。唯一例外是 Git —— 它是硬依赖，
 *     主进程已有后台自愈（`autoInstallGitIfNeeded`），这里不重复管。
 */
export type EnvCheckState = {
  id: string;
  /** 显示名（运行时项直接取 devRuntimes 的 name，保证与「开发工具」页一致） */
  name: string;
  /** 一句话说明"缺了会怎样"（面向新手，不写技术参数） */
  why: string;
  /** 体积文案；非运行时项为空 */
  size: string;
  core: boolean;
  ok: boolean;
  /** 主进程侧正在装（例如首次启动的 Git 后台自愈安装）——此时不该再让用户点它，也不该算进「一键安装」 */
  installing?: boolean;
  /** 非运行时项缺失时的去向（模型设置 / 工作区选择）；运行时项为空 */
  go?: "model" | "workspace";
};

export const ENV_CHECK_OPTOUT_KEY = "env-check-optout";

/** 体检项的顺序与文案（运行时项的体积/名称从 devRuntimes 补全，避免与「开发工具」页两处不一致）。 */
export const ENV_CHECK_SPEC: { id: string; why: string; core: boolean; go?: "model" | "workspace"; fallbackName: string }[] = [
  { id: "model", fallbackName: "模型配置", core: true, go: "model", why: "决定 Codex 用哪个「大脑」——没配就发不出消息" },
  { id: "workspace", fallbackName: "工作区", core: true, go: "workspace", why: "Codex 干活的项目目录——没选它不知道去改哪里" },
  { id: "git", fallbackName: "Git", core: true, why: "引擎执行命令、看 diff、提交、读历史都依赖它" },
  { id: "rg", fallbackName: "ripgrep 代码检索", core: true, why: "Codex 搜代码库的主力工具——缺它检索会慢一个数量级" },
  { id: "pwsh", fallbackName: "PowerShell 7", core: true, why: "内置终端的默认 shell——缺了终端只能退回老旧的 PowerShell 5.1" },
  { id: "python", fallbackName: "Python", core: false, why: "跑 Python 项目、脚本，以及部分 Python 类 MCP" },
  { id: "jq", fallbackName: "jq", core: false, why: "命令行查询、筛选、转换 JSON" },
  { id: "sevenzip", fallbackName: "7-Zip CLI", core: false, why: "解压 zip / 7z / tar 等归档" },
];

/** 缺项里可自动安装的运行时 id。
 *  ⛔ 必须排除 model / workspace —— 它们不是"装"能解决的（要去配置/选目录），
 *  漏掉这个排除会让「一键安装」拿它们去调 installRuntime（未知工具，必然失败）。
 *  ⛔ 也必须排除**正在安装中**的项（首次启动 Git 后台自愈会占住 git）：否则批量安装的第一个请求
 *  就撞上「该工具正在安装」，整批被中断（09-18 用户反馈）。正在装的就静静等它结束，清单会自己刷新。 */
const MANUAL_IDS = new Set(["model", "workspace"]);
export function installableIds(items: EnvCheckState[]): string[] {
  return items.filter((item) => !item.ok && !item.installing && !MANUAL_IDS.has(item.id)).map((item) => item.id);
}

export function EnvCheckDialog({ items, installing, progress, onInstall, onGo, onClose }: {
  items: EnvCheckState[];
  /** 是否正在安装（安装期间禁用一切关闭动作，避免用户以为"取消了"其实还在下） */
  installing: boolean;
  /** 当前安装进度文本（来自 runtime:progress 事件） */
  progress: string;
  onInstall: (ids: string[]) => void;
  onGo: (target: "model" | "workspace") => void;
  onClose: (dontAskAgain: boolean) => void;
}) {
  const [dontAsk, setDontAsk] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (installing) return; // 安装中不许 Esc 关掉（下载还在跑，关了会让人以为停下来了）
      event.preventDefault();
      event.stopPropagation();
      onClose(dontAsk);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, dontAsk, installing]);

  const missingCore = items.filter((item) => item.core && !item.ok);
  const missingOptional = items.filter((item) => !item.core && !item.ok);
  const todo = installableIds(items);

  return createPortal(
    <div className="modal-backdrop env-check-backdrop">
      <section className="env-check-modal" role="dialog" aria-modal="true" aria-label="环境体检" ref={dialogRef}>
        <header>
          <div className="env-check-title">
            <span><Wrench size={16} /></span>
            <strong>环境体检</strong>
          </div>
          {!installing && <button className="icon-button" title="关闭（Esc）" onClick={() => onClose(dontAsk)}><X size={16} /></button>}
        </header>

        <div className="env-check-body">
          <p className="env-check-intro">
            {missingCore.length > 0
              ? <><b>还有 {missingCore.length} 项必备没就绪</b> —— 补齐后 Codex 才能正常干活。</>
              : missingOptional.length > 0
                ? <>必备项都就绪了；下面这几项按需装即可，缺了只是某些活干不了。</>
                : <>全部就绪，Codex 已经可以正常干活。</>}
          </p>

          <div className="env-check-group">
            <div className="env-check-group-title">必备（缺了干不了活）</div>
            {items.filter((item) => item.core).map((item) => (
              <div className={`env-check-row ${item.ok ? "ok" : "missing"}`} key={item.id}>
                <span className="env-check-dot" aria-hidden>{item.ok ? <Check size={12} /> : null}</span>
                <div className="env-check-text">
                  <div className="env-check-name">
                    <span>{item.name}</span>
                    {item.size ? <em>{item.size}</em> : null}
                  </div>
                  <div className="env-check-why">{item.why}</div>
                </div>
                {!item.ok && item.go
                  ? <button className="secondary-setting env-check-go" onClick={() => onGo(item.go as "model" | "workspace")}>
                      {item.go === "model" ? <>去配置</> : <><FolderOpen size={13} />去选择</>}
                    </button>
                  : !item.ok && !item.go
                    ? <span className="env-check-badge">{item.installing ? "安装中…" : "待安装"}</span>
                    : null}
              </div>
            ))}
          </div>

          <div className="env-check-group">
            <div className="env-check-group-title">常用（按需，不阻断）</div>
            {items.filter((item) => !item.core).map((item) => (
              <div className={`env-check-row ${item.ok ? "ok" : "optional"}`} key={item.id}>
                <span className="env-check-dot" aria-hidden>{item.ok ? <Check size={12} /> : null}</span>
                <div className="env-check-text">
                  <div className="env-check-name">
                    <span>{item.name}</span>
                    {item.size ? <em>{item.size}</em> : null}
                  </div>
                  <div className="env-check-why">{item.why}</div>
                </div>
                {!item.ok ? <span className="env-check-badge soft">{item.installing ? "安装中…" : "待安装"}</span> : null}
              </div>
            ))}
          </div>

          {installing && progress && (
            <div className="env-check-progress"><Sparkles size={13} />{progress}</div>
          )}
        </div>

        <footer className="env-check-foot">
          <label className="env-check-optout">
            <input type="checkbox" checked={dontAsk} disabled={installing} onChange={(event) => setDontAsk(event.target.checked)} />
            <span>不再提示（仍可在「设置 → 开发工具」里装）</span>
          </label>
          <div className="env-check-actions">
            <button className="secondary-setting" disabled={installing} onClick={() => onClose(dontAsk)}>稍后再说</button>
            <button
              className="primary-setting"
              disabled={installing || todo.length === 0}
              onClick={() => onInstall(todo)}
            >
              <Download size={14} />
              {installing ? "安装中…" : todo.length === 0 ? "都装好了" : `一键安装 ${todo.length} 项`}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
