/**
 * 排队消息定时发送总开关（11-02 用户令）：
 *   「定时加一个开启关闭功能，定时默认关闭状态，这样排队消息就不显示，
 *     每次排队消息发出去都显示定时了」
 *
 * 三条不变量：
 *   ① 默认**关闭**：没写过偏好键一律不显示定时入口（老档案 / 新装都按关闭处理）；
 *   ② 关闭 ⇒ 排队卡不渲染「定时」按钮与倒计时徽标，已设的定时**连同主进程定时器一起撤销**
 *      （隐藏按钮不够：不撤销会在用户看不见的地方到点自动发送）；
 *   ③ 排队消息发出后的清理必须**静默**：原来无条件弹「已取消定时」，
 *      于是每发一条排队消息都会冒出一句与用户操作无关的定时提示。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

const modeSrc = read("src/lib/queue-timer-mode.ts");
ok(/localStorage\.getItem\(KEY\) === "true"/.test(modeSrc) && /let enabled = \(\(\) =>/.test(modeSrc),
  "偏好模块：默认关闭（只有显式存过 \"true\" 才算开启）");
ok(/export function setQueueTimerEnabled/.test(modeSrc) && /subscribeQueueTimerMode/.test(modeSrc)
  && /useSyncExternalStore/.test(modeSrc),
  "偏好模块：写入即广播 + React 订阅钩子（设置页切换后排队卡立即变）");

const queueSrc = read("src/features/session-queue/SessionQueue.tsx");
ok(/import \{ useQueueTimerEnabled \} from "\.\.\/\.\.\/lib\/queue-timer-mode"/.test(queueSrc)
  && /const timerEnabled = useQueueTimerEnabled\(\)/.test(queueSrc),
  "排队卡读取总开关");
ok(/\{timerEnabled && timerRunAt != null && \(/.test(queueSrc),
  "关闭时倒计时徽标不渲染");
ok(/\{timerEnabled && \(\s*<span className="queued-timer-wrap">/.test(queueSrc),
  "关闭时「定时」按钮与菜单不渲染");
ok(/if \(timerEnabled\) return;\s*setTimerMenuOpen\(false\)/.test(queueSrc),
  "总开关在菜单展开时被关掉 ⇒ 菜单立即收起");

const generalSrc = read("src/features/settings-general/GeneralSettingsSection.tsx");
ok(/useQueueTimerEnabled, setQueueTimerEnabled/.test(generalSrc) && /const queueTimerEnabled = useQueueTimerEnabled\(\)/.test(generalSrc),
  "控制台页提供总开关入口");
ok(/<ToggleSwitch checked=\{queueTimerEnabled\} label="排队消息定时发送" onChange=\{\(next\) => setQueueTimerEnabled\(next\)\} \/>/.test(generalSrc),
  "总开关绑到 ToggleSwitch（默认关闭态即真实偏好值）");

const partSrc = read("src/features/app-state/parts/part04/03-seg/02-browser-queue-settings.tsx");
ok(/if \(runAt != null && !isQueueTimerEnabled\(\)\) return;/.test(partSrc),
  "关闭态拒绝新的定时（防御路径）");
ok(/const hadTimer = queueTimers\[threadId\]\?\.\[id\] != null;\s*if \(runAt == null && !hadTimer\) return;/.test(partSrc),
  "没有定时时清理直接返回：不发 IPC、不弹「已取消定时」");
ok(/if \(opts\.silent\) return;/.test(partSrc) && /bag\.setQueuedTimer\(bag\.thread\.id, id, null, \{ silent: true \}\)/.test(partSrc),
  "发送后的定时清理静默执行（不再每次排队发送都弹定时提示）");
ok(/if \(!isQueueTimerEnabled\(\)\) clearAllTimers\(\);\s*return subscribeQueueTimerMode/.test(partSrc),
  "关闭总开关 ⇒ 订阅回调里撤销全部已设定时（含主进程定时器）");
ok(/\/\/ 总闸已关[^\n]*\n\s*if \(!isQueueTimerEnabled\(\)\) return;/.test(partSrc),
  "在途 due 事件在关闭态不再发送");
ok(/if \(!isQueueTimerEnabled\(\)\) \{\s*try \{ localStorage\.removeItem\("queue-timers-v1"\)/.test(partSrc),
  "关闭态启动不恢复旧定时（清掉本地持久化）");

const timerCalls = [...partSrc.matchAll(/setQueuedTimer\([^)]*null[^)]*\)/g)].map((m) => m[0]);
ok(timerCalls.length > 0 && timerCalls.every((call) => call.includes("silent")), `所有「取消定时」调用都走静默或手动取消语义（${timerCalls.length} 处）`);

console.log(fails ? `\n【queue-timer】失败 ${fails} 项` : `\n【queue-timer】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
