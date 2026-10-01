import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Sparkles, Wrench, X } from "lucide-react";

/** 首次启动「环境体检」（09-17 用户要求）：
 *
 *  痛点原话：「很多新用户上来，工具都不会装，也不知道要装哪些，不装 Codex 啥也干不了」。
 *  所以这里只做两件事：**把"缺什么、为什么缺了不行"讲清楚**，以及**一键补齐**。
 *
 *  为什么是这 7 项（用户 09-17 拍板「必备 + 常用」，09-18 点名补 PowerShell 7；09-20 用户定稿：
 *  「工作区不要必选，后续用户自己配置就可以了，就保留工具下载」——**工作区已移出体检**，
 *  不再出现「点了去选择 → 弹窗没了 → 工具没装」的断头路）：
 *   - 必备 4 项（模型 / Git / ripgrep / PowerShell 7）—— 缺任何一项，Codex 都"干不好活"：
 *     没模型发不出消息；Git 是引擎跑命令/看 diff/提交的硬依赖；
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
  /** 该项最近一次安装的失败原因（重试入口在行内；10-01 每工具状态机） */
  failed?: string | null;
  /** 用户点了「跳过」：灰显、不进一键安装，可随时恢复或单独安装 */
  skipped?: boolean;
};

export const ENV_CHECK_OPTOUT_KEY = "env-check-optout";

/** 体检项的顺序与文案（运行时项的体积/名称从 devRuntimes 补全，避免与「开发工具」页两处不一致）。
 *  ⛔ 10-01 用户定稿：模型项已移出（首次启动只弹「开发工具」引导，模型配置走设置 → 模型）；
 *  分组语义从「必备/常用」改为「推荐安装/按需安装」。 */
export const ENV_CHECK_SPEC: { id: string; why: string; core: boolean; fallbackName: string }[] = [
  { id: "git", fallbackName: "Git", core: true, why: "引擎执行命令、看 diff、提交、读历史都依赖它" },
  { id: "rg", fallbackName: "ripgrep 代码检索", core: true, why: "Codex 搜代码库的主力工具——缺它检索会慢一个数量级" },
  { id: "pwsh", fallbackName: "PowerShell 7", core: true, why: "内置终端的默认 shell——缺了终端只能退回老旧的 PowerShell 5.1" },
  { id: "python", fallbackName: "Python", core: false, why: "跑 Python 项目、脚本，以及部分 Python 类 MCP" },
  { id: "jq", fallbackName: "jq", core: false, why: "命令行查询、筛选、转换 JSON" },
  { id: "sevenzip", fallbackName: "7-Zip CLI", core: false, why: "解压 zip / 7z / tar 等归档" },
];

/** 推荐项（一键安装的目标）：core=true 的缺项。跳过项不进。 */
export function installableIds(items: EnvCheckState[]): string[] {
  return items.filter((item) => item.core && !item.ok && !item.installing && !item.skipped).map((item) => item.id);
}

export function EnvCheckDialog({ items, installing, progress, percent, stage, speed, queueDone, queueTotal, onInstall, onSkip, onClose }: {
  items: EnvCheckState[];
  /** 是否正在后台安装（一键安装点下去弹窗会收起成角标；安装中**允许**关弹窗——
   *  关闭 ≠ 取消，安装继续、右下角角标继续显示进度，装完自动消失/失败自动展开回来。
   *  09-18 用户反馈旧版「安装中禁一切关闭」：安装挂住时整个界面被卡死只能重启）。 */
  installing: boolean;
  /** 当前安装进度文本（来自 runtime:progress 事件） */
  progress: string;
  /** 进度百分比（主进程解析安装脚本的 @@PROGRESS 得到；没有则进度条呈不确定态） */
  percent?: number;
  /** 当前阶段名（下载 / 解压 / 配置…），让新手看得懂"在干什么" */
  stage?: string;
  /** 下载速度（形如 "1.2 MB/s · 45.3 MB / 350 MB"；主进程按 500ms 采样文件大小算出） */
  speed?: string;
  /** 队列总进度（10-01：并行安装队列，已完成 x / 共 y） */
  queueDone?: number;
  queueTotal?: number;
  onInstall: (ids: string[]) => void;
  onSkip: (id: string) => void;
  onClose: (dontAskAgain: boolean) => void;
}) {
  const [dontAsk, setDontAsk] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 安装中 Esc = 收起弹窗转后台（安装继续、角标接管），不是取消 —— 不再禁用（09-18）：
      // 旧版安装中禁关，下载挂住时整个界面被卡死只能重启。
      event.preventDefault();
      event.stopPropagation();
      onClose(dontAsk);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, dontAsk]);

  const missingCore = items.filter((item) => item.core && !item.ok && !item.skipped);
  const missingOptional = items.filter((item) => !item.core && !item.ok && !item.skipped);
  const todo = installableIds(items);
  const doneCount = typeof queueTotal === "number" && queueTotal > 0 ? (queueDone ?? 0) : 0;

  return createPortal(
    <div className="modal-backdrop env-check-backdrop">
      <section className="env-check-modal" role="dialog" aria-modal="true" aria-label="环境体检" ref={dialogRef}>
        <header>
          <div className="env-check-title">
            <span><Wrench size={16} /></span>
            <strong>环境体检</strong>
          </div>
          <button className="icon-button" title="收起（安装转后台继续）" onClick={() => onClose(dontAsk)}><X size={16} /></button>
        </header>

        <div className="env-check-body">
          <p className="env-check-intro">
            {installing
              ? <><b>正在安装 {doneCount}/{queueTotal ?? "…"}</b> —— 可以继续用应用，装完会提醒你。</>
              : missingCore.length > 0
                ? <><b>推荐安装 {missingCore.length} 项</b> —— 补齐后 Codex 才能正常干活。</>
                : missingOptional.length > 0
                  ? <>推荐项都就绪了；下面这几项按需装即可，缺了只是某些活干不了。</>
                  : <>全部就绪，Codex 已经可以正常干活。</>}
          </p>

          <div className="env-check-group">
            <div className="env-check-group-title">推荐安装（缺了干不了活）</div>
            {items.filter((item) => item.core).map((item) => (
              <EnvCheckRow key={item.id} item={item} installing={installing} onInstall={onInstall} onSkip={onSkip} />
            ))}
          </div>

          <div className="env-check-group">
            <div className="env-check-group-title">按需安装（不阻断，缺了某些活干不了）</div>
            {items.filter((item) => !item.core).map((item) => (
              <EnvCheckRow key={item.id} item={item} installing={installing} onInstall={onInstall} onSkip={onSkip} />
            ))}
          </div>

          {installing && (
            <div className="env-check-progress">
              {/* 进度条（09-19 用户：不要弹窗，全部进度条展示，方便新手） */}
              <span className="runtime-progress-bar large" role="progressbar" aria-label="安装进度" aria-valuenow={percent ?? 0} aria-valuemin={0} aria-valuemax={100} data-indeterminate={typeof percent === "number" ? "false" : "true"}>
                <i style={{ width: typeof percent === "number" ? `${percent}%` : "100%" }} />
              </span>
              <span className="env-check-progress-text">
                <Sparkles size={13} />
                {stage ? <b>{stage}</b> : null}
                {typeof percent === "number" ? <b>{percent}%</b> : null}
                {speed ? <b className="env-check-speed">{speed}</b> : null}
                <b>{doneCount}/{queueTotal ?? "…"}</b>
                {progress ? <span>{progress}</span> : null}
              </span>
            </div>
          )}
        </div>

        <footer className="env-check-foot">
          <label className="env-check-optout">
            <input type="checkbox" checked={dontAsk} onChange={(event) => setDontAsk(event.target.checked)} />
            <span>不再提示（仍可在「设置 → 开发工具」里装）</span>
          </label>
          <div className="env-check-actions">
            <button className="secondary-setting" onClick={() => onClose(dontAsk)}>全部稍后再说</button>
            <button
              className="primary-setting"
              disabled={installing || todo.length === 0}
              onClick={() => onInstall(todo)}
            >
              <Download size={14} />
              {installing ? "安装中…" : todo.length === 0 ? "都装好了" : `一键安装推荐项 ${todo.length} 项`}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/** 一行工具：名称 + 用途 + 体积 + 状态 + 行内操作（立即安装 / 跳过|恢复 / 重试）。
 *  状态机：待安装 → 下载中/安装中（主进程 @@PROGRESS/@@STAGE 驱动）→ 成功（✓ 绿）；
 *  失败红显原因 + 重试；跳过灰显可恢复。 */
function EnvCheckRow({ item, installing, onInstall, onSkip }: {
  item: EnvCheckState;
  installing: boolean;
  onInstall: (ids: string[]) => void;
  onSkip: (id: string) => void;
}) {
  const busy = installing && item.installing;
  const status = item.ok
    ? <span className="env-check-badge ok">已安装</span>
    : busy
      ? <span className="env-check-badge soft">安装中…</span>
      : item.failed
        ? <span className="env-check-badge fail">失败</span>
        : item.skipped
          ? <span className="env-check-badge soft">已跳过</span>
          : <span className="env-check-badge">待安装</span>;
  return (
    <div className={`env-check-row ${item.ok ? "ok" : item.failed ? "missing" : item.skipped ? "skipped" : item.core ? "missing" : "optional"}`} key={item.id}>
      <span className="env-check-dot" aria-hidden>{item.ok ? <Check size={12} /> : item.failed ? <AlertTriangle size={12} /> : null}</span>
      <div className="env-check-text">
        <div className="env-check-name">
          <span>{item.name}</span>
          {item.size ? <em>{item.size}</em> : null}
        </div>
        <div className="env-check-why">
          {item.why}
          {item.failed ? <b className="env-check-fail-why">　{item.failed}</b> : null}
        </div>
      </div>
      <span className="env-check-row-actions">
        {status}
        {item.ok
          ? null
          : busy
            ? null
            : <button className="secondary-setting env-check-mini" disabled={installing} onClick={() => onInstall([item.id])}>
                {item.failed ? "重试" : "立即安装"}
              </button>}
        {!item.ok && !busy
          ? <button className="env-check-skip" title={item.skipped ? "取消跳过，回到待安装" : "不再推荐这项"} onClick={() => onSkip(item.id)}>
              {item.skipped ? "恢复" : "跳过"}
            </button>
          : null}
      </span>
    </div>
  );
}
