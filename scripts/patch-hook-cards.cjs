// Hook 事件降噪：同名 hook 的 started/completed 合并为一张状态卡（运行中→已完成），
// 同一 hook 重复触发只更新既有卡，不再一条事件一张卡刷屏
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");

const oldAnchor = `function addSystemEvent(title: string, text: string, tone: SystemEvent["tone"] = "info") {
    setSystemEvents((current) => [...current, { id: crypto.randomUUID(), title, text, tone }]);
  }`;
if (!s.includes(oldAnchor)) { console.log("ANCHOR NOT FOUND"); process.exit(1); }
const addFn = oldAnchor + `

  // Hook 事件合并卡：同一 hook（按 名称+类型 键）只保留一张卡，状态从「已启动」流转到「已完成」
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
s = s.replace(oldAnchor, addFn);

// hook 事件路由改为合并卡
const oldRoute = `      } else if (method === "hook/started" || method === "hook/completed") {
        addSystemEvent(event.method === "hook/started" ? "Hook 已启动" : "Hook 已完成", params.run?.name ?? params.run?.id ?? "Hook");
      } else if`;
if (!s.includes(oldRoute)) { console.log("ROUTE NOT FOUND"); process.exit(1); }
const newRoute = `      } else if (method === "hook/started" || method === "hook/completed") {
        addHookEvent(method === "hook/started", String(params.run?.name ?? params.run?.id ?? "Hook"));
      } else if`;
s = s.replace(oldRoute, newRoute);

// SystemEvent 类型加 hookKey
const typeOld = 'type SystemEvent = { id: string; title: string; text: string; tone?: "info" | "warning" | "error" };';
if (!s.includes(typeOld)) { console.log("TYPE NOT FOUND"); process.exit(1); }
const typeNew = 'type SystemEvent = { id: string; title: string; text: string; tone?: "info" | "warning" | "error"; hookKey?: string };';
s = s.replace(typeOld, typeNew);

fs.writeFileSync("src/App.tsx", s);
console.log("hook merge card applied");
