/* /19-skill-self-tools.ts —— 自造工具（09-29 用户：「Codex 有没有办法给自己新增工具能力，
   比如某个功能没有对应工具调用，他没办法自主造工具……那是不是可以马上给自己造一个对应调用工具」）。
   三条路线按成本递增：① 工作区脚本（立即生效，一次性）② connector_register 注册自建 MCP server
   （重启应用后持久生效）③ 改宿主源码（要重新构建，模型做不了重启，需用户参与）。 */
export const SELF_TOOLS_SKILL = `---
name: self-tools
description: 当某个功能没有对应的可调用工具时，怎么给自己造一个：① 工作区脚本立即用（一次性任务首选）；② 写一个零依赖 MCP server 脚本并用 connector_register 注册成持久工具（重启应用后 tools/list 永久多出这个工具）；③ 什么时候才需要改宿主源码。用户说「你没有工具做不了 XX / 给自己造个工具 / 把这个能力变成你的工具」时读这份。
---

# 自造工具（没有现成工具时怎么获得调用能力）

⛔ 先查 \`harness-api\` 清单 —— 要做的东西已有现成工具就别造。确认没有后，按下面三条路线选。

## 路线①：工作区脚本（几分钟，立即生效，一次性任务首选）

任何「调 API / 处理数据 / 转格式」类能力都可以当场写成一个 node 脚本在工作区里跑 —— 脚本就是工具，
写完直接执行，不用注册。适用：任务只做一次、或逻辑很快会变。
⛔ 脚本放工作区内（别散落在盘根）；依赖优先零依赖（node 内置模块够用大多数场景）。

## 路线②：自建 MCP server + connector_register（持久化，重启应用后永久可用）

这个能力以后还要反复用 ⇒ 把它做成**真工具**：

**第一步：写 MCP server 脚本**（零依赖，node 内置就能跑）。模板（改 TOOLS 与 tools/call 分支即可）：

\`\`\`js
// my-tool-server.mjs —— 最小 stdio MCP server（行分隔 JSON-RPC，零依赖）
import readline from "node:readline";
const TOOLS = [{
  name: "my_tool",
  description: "这个工具做什么（写给模型看）",
  inputSchema: { type: "object", properties: { input: { type: "string", description: "入参说明" } }, required: ["input"] },
}];
function doMyTool(a) { return "结果：" + JSON.stringify(a); } // ← 在这里写你的自定义逻辑
let buf = "";
process.stdin.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }
function handle(line) {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "my-tools", version: "1.0.0" } } });
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: TOOLS } });
  else if (m.method === "tools/call") {
    const { name, arguments: a } = m.params || {};
    let text;
    try { text = name === "my_tool" ? String(doMyTool(a ?? {})) : "未知工具: " + name; }
    catch (e) { send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "执行失败: " + e.message }], isError: true } }); return; }
    send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text }] } });
  }
  else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "method not found" } });
}
\`\`\`

⛔ 写完**先本地自测**：\`echo {"jsonrpc":"2.0","id":1,"method":"tools/list"} | node my-tool-server.mjs\`
应输出 tools 列表 —— 测通了再注册，别把没测过的脚本注册进去。

**第二步：注册** —— 调 \`connector_register\` 工具：
- id：字母/数字/连字符（如 \`my-tools\`）
- command：\`node\`（或宿主自带 node 的完整路径）
- args：脚本完整路径数组
- ⛔ 脚本路径给**绝对路径**（工作区会变，userData 下的路径最稳）

**第三步：告诉用户重启应用** —— 重启后的新会话里 tools/list 自动带上新工具，永久可用。

## 路线③：改宿主源码（只有"这能力该长在应用身上"时才走）

给**所有用户**用的功能（新的界面按钮 / 新的内置工具 / 新通道）→ 改应用源码 + 重新构建。
⛔ 模型做不了重新构建与重启 —— 这条路线你只能产出改动说明/代码，构建发版要交给用户；
不要声称"我已经把宿主更新了"。

## 选择口诀

- 只用一次 → 路线①（脚本）
- 以后反复用、只是自己用 → 路线②（connector_register）
- 该成为产品功能 → 路线③（给用户出改动方案）
`;
