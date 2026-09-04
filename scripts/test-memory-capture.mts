// MemoryStore 本地捕获自测：跑一次对话 → memory.json 必须落盘且可召回
import { MemoryStore } from "../dist-electron/harness-services.js";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "memtest-"));
const file = join(dir, "memory.json");
const store = new MemoryStore(file);

// 1. 寒暄不落盘
await store.captureTurn("t1", "你好", "你好呀，很高兴见到你！有什么可以帮你的吗？");
assert.ok(!existsSync(file), "寒暄不应落盘");

// 2. 正常对话落盘 + 自动归类
await store.captureTurn("t1", "帮我在这个项目里加一个登录界面", "已完成后端四端点配置和探测导入逻辑，登录界面开发完成。", { workspace: "D:\\proj" });
assert.ok(existsSync(file), "正常对话应落盘");
const raw = JSON.parse(readFileSync(file, "utf8"));
const arr = Array.isArray(raw) ? raw : raw.memories ?? [];
assert.ok(arr.length === 1, `应恰好 1 条，实际 ${arr.length}`);
assert.ok(arr[0].workspace === "D:\\proj", `workspace 应写入，实际 ${JSON.stringify(arr[0].workspace)}`);

// 3. 近重复对话去重（>0.7 重叠则合并，不新增）
await store.captureTurn("t1", "帮我在这个项目里加一个登录界面", "已完成后端四端点配置和探测导入逻辑，登录界面开发完成啦。");
const arr2 = Array.isArray(raw) ? raw : [];
const after = JSON.parse(readFileSync(file, "utf8"));
const arrAfter = Array.isArray(after) ? after : after.memories ?? [];
assert.ok(arrAfter.length === 1, `去重后应仍 1 条，实际 ${arrAfter.length}`);

// 4. 加权召回：项目背景 > 任务经验，pinned 2x
await store.captureTurn("t2", "我们项目的数据库用 SQLite，部署在 Windows 上", "已记录项目技术栈信息。");
await store.upsert({ category: "用户偏好", content: "用户喜欢简洁中文回复", pinned: true });
const recalled = await store.recall("项目 登录 数据库", { workspace: "D:\\proj" });
assert.ok(recalled.context.includes("登录界面") || recalled.context.includes("SQLite"), `召回应命中本地记忆：${recalled.context}`);

// 5. list 置顶排序
const list = await store.list();
assert.ok(list[0].pinned === true, "pinned 应排最前");

console.log("ALL MEMORY CHECKS PASSED", arrAfter.length, "records");
