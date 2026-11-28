/**
 * 12bc —— 手机看屏（11-06 P1；11-27 加横屏 + 点击操作）的租约与接线
 *
 * 为什么先钉租约：手机切后台/断网/锁屏时，若没有「15 秒没取帧就自动停采」，
 * 桌面会一直处在被采集状态 —— 那就是后门。判据真跑租约时序（注入时钟，不用等 15 秒），
 * 再钉接线：主进程接口（必须已配对）/ 点击注入 / 桌面提示与停止键 / 手机页取帧与横屏。
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(import.meta.url);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/[^'"`]*$/, "")).join("\n");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

console.log("【12bc】手机看屏（可点击操作）租约 + 接线");

const artifact = join(ROOT, "dist-electron", "remote-screen-lease.js");
if (!existsSync(artifact)) {
  ok(false, "构建产物存在（缺 dist-electron/remote-screen-lease.js —— 先 npm run build:electron）");
} else {
  const { createScreenLease } = require_(artifact);
  let clock = 1_000;
  const lease = createScreenLease(15_000, () => clock);
  ok(lease.state().active === false && lease.expired() === false,
    "真跑：初始未激活、不报过期");
  lease.start();
  ok(lease.state().active === true && lease.state().startedAt === 1_000,
    "真跑：start 后激活并记下起点");
  clock = 12_000;
  ok(lease.touch() === true && lease.expired() === false,
    "真跑：取帧续租（12 秒时还没过期）");
  clock = 20_000;
  ok(lease.expired() === false, "真跑：续租后 8 秒仍不过期（从最后一次取帧算，不是从 start 算）");
  clock = 28_000;
  ok(lease.expired() === true, "真跑：距最后取帧超过 15 秒 ⇒ 过期（手机切后台就会走到这里）");
  lease.stop();
  ok(lease.state().active === false && lease.expired() === false,
    "真跑：stop 后不再报过期（幂等，可反复调）");
  ok(lease.touch() === false, "真跑：未激活时 touch 返回 false（迟到的取帧不能复活租约）");
}

const remoteSrc = stripComments(read("electron/remote.ts"));
ok(/createScreenLease\(15_000\)/.test(remoteSrc),
  "主进程租约 15 秒（手机切后台/断网 ⇒ 自动停采）");
ok(/desktopCapturer\.getSources\(\{ types: \["screen"\]/.test(remoteSrc)
  && /toJPEG\(55\)/.test(remoteSrc),
  "采集用 desktopCapturer（主进程）+ JPEG 55 质量（低延迟，不引新依赖）");
const endpointAuth = [...remoteSrc.matchAll(/url\.startsWith\("\/api\/screen\/(start|frame|stop|click|input)"\)[\s\S]{0,120}?authorizedDevice\(req\)/g)].length;
ok(endpointAuth === 5,
  `五个看屏接口都要求已配对设备（实测 ${endpointAuth}/5 —— 少一处 = 任何人打开页面就能看屏/操作）`);
/* ⛔ 顺序判据必须**只看 frame 接口那一段**：expired() 在采集循环里也有调用，
   拿全文匹配会被那处顶成假绿（变异实测过）。 */
const frameAt = remoteSrc.indexOf('url.startsWith("/api/screen/frame")');
const frameBlock = frameAt < 0 ? "" : remoteSrc.slice(frameAt, frameAt + 700);
const expiredAt = frameBlock.indexOf("screenLease.expired()");
const touchAt = frameBlock.indexOf("screenLease.touch()");
ok(expiredAt > 0 && touchAt > expiredAt && /stopScreenView\(\)/.test(frameBlock.slice(expiredAt, touchAt)),
  "取帧前**先判过期再续租**（顺序反了：过期租约会被一次取帧续活）");

const clickAt = remoteSrc.indexOf('url.startsWith("/api/screen/click")');
const clickBlock = clickAt < 0 ? "" : remoteSrc.slice(clickAt, clickAt + 1400);
ok(clickBlock.includes("authorizedDevice(req)")
  && clickBlock.includes("screenLease.expired()")
  && clickBlock.includes("screenLease.state().active")
  && clickBlock.includes("clickRemoteScreen(")
  && clickBlock.includes("screenBounds"),
  "点击接口：已配对 + 租约有效 + 有画面才注入（关屏/过期后不能再点）");
ok(/display\.bounds/.test(remoteSrc) && /screenBounds/.test(remoteSrc),
  "截帧时记录对应显示器边界（点击坐标按同一块屏映射）");
const inputAt = remoteSrc.indexOf('url.startsWith("/api/screen/input")');
const inputBlock = inputAt < 0 ? "" : remoteSrc.slice(inputAt, inputAt + 1800);
ok(inputBlock.includes("authorizedDevice(req)")
  && inputBlock.includes("screenLease.expired()")
  && inputBlock.includes("screenLease.state().active")
  && /scrollRemoteScreen|pressRemoteKey|editRemoteText|typeRemoteText/.test(inputBlock),
  "输入接口：已配对 + 租约有效才允许滚轮/按键/文本");
const inputSrc = stripComments(read("electron/remote-input.ts"));
ok(/koffi\.load\("user32\.dll"\)/.test(inputSrc)
  && /SetCursorPos/.test(inputSrc)
  && /mouse_event/.test(inputSrc)
  && /dipToScreenPoint/.test(inputSrc)
  && /keybd_event/.test(inputSrc)
  && /clipboard\.writeText/.test(inputSrc)
  && /MOUSEEVENTF_RIGHTDOWN|0x0008/.test(inputSrc)
  && /win32/.test(inputSrc),
  "Windows 输入注入：koffi → 光标/左键/右键/滚轮/按键/剪贴板文本；非 Windows 明确拒绝");

const manifest = read("electron/ipc-channels.manifest.json");
const registry = read("electron/ipc-registry.ts");
const ipcFeature = stripComments(read("electron/features/remote-ipc.ts"));
ok(/"channel": "remote:screen-stop"/.test(manifest) && /"remote:screen-stop"/.test(registry),
  "remote:screen-stop 登记进 manifest + 域账本（生成物由各仓自己 gen:ipc 产出）");
/* ⛔ 必须断言它进了 REMOTE_CHANNELS **数组**（handle 那行本身也含这个字符串，
   拿全文 includes 会被它顶成假绿 —— 变异实测过）。 */
const channelsList = ipcFeature.slice(ipcFeature.indexOf("const REMOTE_CHANNELS"), ipcFeature.indexOf("];", ipcFeature.indexOf("const REMOTE_CHANNELS")));
ok(/ipcHost\.handle\("remote:screen-stop"[\s\S]{0,120}?remote\.stopScreenView\(\)/.test(ipcFeature)
  && /"remote:screen-stop"/.test(channelsList),
  "桌面停止键接到 stopScreenView，且登记进卸载清理名单（漏登记 = 卸载后 handler 残留）");

const notice = read("src/components/RemoteScreenNotice.tsx");
ok(/event\?\.type === "remote:screen"/.test(notice) && /remoteScreenStop\(\)/.test(notice),
  "桌面提示监听 remote:screen 并能一键停止");
ok(/<RemoteScreenNotice \/>/.test(read("src/features/app-view/AppView.tsx")),
  "提示挂在 AppView（壳内，手机一看就能看见）");

const page = read("electron/remote/web-page.ts");
ok(/onclick="toggleTopMenu\(false\);openScreen\(\)"/.test(page),
  "手机页有「看屏幕」入口");
ok(/\/api\/screen\/start/.test(page) && /\/api\/screen\/frame/.test(page) && /\/api\/screen\/stop/.test(page),
  "手机页三个接口都接（开始 / 取帧 / 停止）");
ok(/function closePanel\(\) \{[\s\S]{0,120}?if \(screenActive\) void stopScreen\(\)/.test(page),
  "关面板即停采（不靠用户记得点停止）");
ok(/\/api\/screen\/click/.test(page) && /pointerup/.test(page) && /screenPointFromEvent/.test(page),
  "手机页点击画面会换算坐标并调用 /api/screen/click（含 contain 黑边换算）");
ok(/screen-landscape/.test(page) && /screen\.orientation\.lock/.test(page) && /横屏/.test(page),
  "手机页有横屏全屏查看（锁定 orientation，失败仍可按屏幕比例铺满）");
ok(/pointermove/.test(page) && /lastDist/.test(page) && /zoomScreenAt/.test(page) && /screen-zoom-reset/.test(page),
  "手机页支持双指缩放 / 放大后单指拖动 / 复位");
ok(/longPressTimer/.test(page) && /button === "right"/.test(page),
  "手机页长按 480ms 发右键，且不误触左键");
ok(/screen-ime/.test(page) && /ime\.focus/.test(page) && /\/api\/screen\/input/.test(page) && /kind: "text"/.test(page),
  "手机页用隐藏 input 唤起系统键盘（无页内输入框/按键）");
ok(/sendKeyboardDiff/.test(page) && /kbdLast/.test(page) && /queueScreenEdit/.test(page),
  "手机键盘实时输入：按增量删改并串行发送，不是每次手点发送");
ok(/手机正在查看并操作/.test(notice),
  "桌面提示明确告知「正在操作」而不是只读");

console.log(fails ? `\n【remote-screen】失败 ${fails} 项` : `\n【remote-screen】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
