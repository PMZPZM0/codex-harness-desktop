// Hook 静默化：hook 事件不再生成系统卡，改为回合级注入徽标（hookPulse），
// 在最新回复的 footer 图标序列末尾追加一个小钩子图标，hover 弹出本次触发的 hook 明细
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");

// 1) addHookEvent 改为记录到 hookPulse 状态（不再进 systemEvents）
const oldFn = `  // Hook 事件合并卡：同一 hook（按 名称+类型 键）只保留一张卡，状态从「已启动」流转到「已完成」
  function addHookEvent(running: boolean, hookName: string) {
    const key = hookName;
    setSystemEvents((current) => {
      const index = current.findIndex((entry) => entry.hookKey === key);
      const title = running ? "Hook 运行中" : "Hook 已完成";
      if (index >= 0) {
        const next = [...current];
        next[index] = { ...next[index], title, text: hookName, tone: running ? "info" : "success", at: Date.now() };
        // 已完成的卡若在尾部就把它移到末尾保持时间感
        const card = next.splice(index, 1)[0];
        return [...next, card];
      }
      return [...current, { id: crypto.randomUUID(), title, text: hookName, tone: running ? "info" : "success", hookKey: key } as SystemEvent];
    });
  }`;
if (!s.includes(oldFn)) { console.log("FN NOT FOUND"); process.exit(1); }
const newFn = `  // Hook 注入反馈：静默记录到回合徽标（不产生系统卡），最新回复 footer 末尾展示小钩子图标
  function addHookEvent(running: boolean, hookName: string) {
    setHookPulse((current) => ({
      count: running ? current.count + 1 : current.count,
      hooks: current.hooks.some((entry) => entry.name === hookName)
        ? current.hooks.map((entry) => entry.name === hookName ? { name: hookName, done: !running } : entry)
        : [...current.hooks, { name: hookName, done: !running }],
      at: Date.now(),
    }));
  }`;
s = s.replace(oldFn, newFn);

// 2) hookPulse 状态声明（挂在 systemEvents 旁边）
const stAnchor = "const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);";
if (!s.includes(stAnchor)) { console.log("STATE ANCHOR MISSING"); process.exit(1); }
const stNext = stAnchor + "\n  // 本回合 hook 注入徽标（静默）：完成回复时展示在 footer 末尾\n  const [hookPulse, setHookPulse] = useState<{ count: number; hooks: { name: string; done: boolean }[]; at: number }>({ count: 0, hooks: [], at: 0 });";
s = s.replace(stAnchor, stNext);

fs.writeFileSync("src/App.tsx", s);
console.log("hook silenced into pulse state");
