---
name: memory-board-audit
description: 记忆板块（.codex-harness/memory 八层金字塔）自检与故障定位 SOP：怎么区分「新工作区还没产生内容」与「链路真坏了」、捕获链有没有真的落到真实工作区、L2 里有没有自动生成的垃圾纪律行、L7 碎片池的 workspace 归属是否错乱。当用户说「看下你的记忆板块 / 自检一下记忆 / 记忆怎么是空的 / 记忆没生效」时用。
---

# 记忆板块自检（八层金字塔）

## 何时用
- 用户说「看下你的记忆板块 / 自检一下记忆 / 记忆怎么是空的 / 记忆没生效」；
- 改过 `memory-layers.ts` / `memory-lessons.ts` / `memory-store.ts` 之后要验收。

## 步骤
1. **结构**：`Get-ChildItem -Recurse -Force <ws>\.codex-harness\memory` —— 应有 `project/ lessons/ logs/ archive/` + `.layout-v2-done`。`rollups/` 是**懒创建**（写月卷时才出现），缺它不算问题。
2. **八层逐层读**（读到空字符串是正常值，不是错误）：
   - L0 `<userData>\memory\USER.md`（userData = `<app>\memory.json` 所在目录，如 `D:\codexFBces`）
   - L1 `project\MEMORY.md` · L3 `project\BACKGROUND.md` · L2 `lessons\<分类>.md` · L4 `logs\YYYY-MM-DD.md` · L6 `archive\`
   - L7 `<userData>\memory.json`
3. **先区分「空」与「坏」**（本技能存在的理由）：新工作区/新会话首次注入时 L1–L4 本来就全空 —— 内容要等第一个回合 `turn/completed` 才产生。**没看捕获日志之前不许判缺陷**。
4. **捕获链判据**：`Get-Content <userData>\memory-capture-debug.log -Tail 6`
   - ✅ 通：出现 `"workspace":"<真实工作区>"` + `"via":"exact"` + `reason:"written"`，且 `<ws>\memory\logs\<今天>.md` 的落盘时间 = 最近一次回合结束时间；
   - ❌ 断：只有 `…\scratch\…` 或 `workspace:null`，或出现 `no-workspace-or-layers` / `append-failed` / `lesson-failed`；
   - ⛔ 拿 scratch 会话的记录宣布「链路通了」是无效证据 —— `localCapture` 首行 `isScratchWorkspace` 守卫会把 scratch 的 `workspace` 置为 `undefined`。
5. **查 L2 垃圾纪律行**：读 `lessons\*.md`，若某行的「现象」= 用户原话 + `[Harness …]` 注入块、「结论」= 回复末尾的选项列表 ⇒ 见「坑」第 3 条。
6. **查 L7 归属**：`memory.json` 里 `workspace` 指向 `node_modules\electron\dist\scratch\…`（构建即清）的条目 = 假归属；`search()` 对跨工作区只降权 ×0.5、**不排除** ⇒ 会注入到无关工作区。

## 坑
- **把「新工作区空」当缺陷上报**（已被用户纠错一次）：空 ≠ 坏。判缺陷前先确认「有没有回合真的跑完过」。
- 手工写的记忆文件**不触发** `migrateLayout` ⇒ 目录停在 v1 平铺（`MEMORY.md` / `YYYY-MM-DD.md` 摊在 `memory\` 根、无 `.layout-v2-done`）。这是手工痕迹，**不是**迁移 bug。
- 自动纪律行会把**注入块**当"现象"：`buildLessonLine` 的 `phenomenon = oneLine(userContent, 90)`，而 `userContent` 带着 `[Harness 常驻记忆…]`；`detectFailure` 只凭回复里出现"失败/根因"字样就放行。剥块正则在 `src/lib/user-refs.ts` 与 `electron/thread-backup.ts` 里各有一份，可直接复用。

- **注入块里的「别再犯」把每轮都判成纠错**（09-23 实证）：`shouldCapture` 用的是**未剥**的 userContent，而常驻记忆块标题含「（必须遵守，别再犯）」⇒ 命中 `CORRECTION_SIGNALS` 的 `/ 别再 /` ⇒ 每轮 `forced:true`、`reason=correction-forced(别再)`，并把整轮归到「用户纠错」（永不淘汰、每轮注入）。判据：`memory-capture-debug.log` 里**带注入块的回合** `forced:true`、**不带块的回合** `forced:false`。修法：`shouldCapture` 也走 `stripInjectedBlocks`（预检【102】已钉住）。
- **自动生成的精粒行会进「用户纠错」这个“永不淘汰”文件**：纠错判定一旦误命，代价比普通坑大得多（每轮注入、不能自动淘汰）⇒ 自检时**必须逐行读 `lessons/corrections.md`**，并按「现象字段是不是用户真实纠错」判真假；带注入块的一律当垃圾行删。

- **L2 纪律行自己写出的块标签会反过来破坏剥离**（09-23 实证，称「自指污染」）：纪律行在描述「要剥掉哪些标签」时**字面写出**了闭合标签，而剥离用的是非贪婪成对正则 ⇒ 该行被注入进常驻块后，正则在**它内部提前闭合**，只剥掉前半段、后半段整段铺进 L4「需求」与 L2「现象」，并继续喂出新的垃圾行（正反馈）。判据：`logs/*.md` 的「需求」字段尾部拖着某条纪律行的中段；用**真实** `lessons/pitfalls.md` 拼一个注入块跑 `stripInjectedBlocks` 复现（期望结果恰好只剩用户原话）。修法：① 剥离时闭合标签要求**独立成行**（注入端拼的就是独立一行，自指文本里它永远在行中间）；② **写纪律行永远不要字面写出闭合标签**，用「闭合标签」指代。
- **纯测试轮也会产 L2 垃圾行**（09-23 实证）：`FAILURE_SIGNALS` 的 `/回归/` 命中正常中文「回归本心」⇒ 数字列表回复被判成「这轮涉及失败/修复」⇒ 白产一条纪律行。判据：`logs/` 里出现「⚠️ 这轮涉及失败/修复（回归）」而该轮回复与失败无关。
- **L7 假归属的根因在写入入口、不在 layers**：`isScratchWorkspace` 守卫只加在 `localCapture` 与 `projectDir`，而 `memory-store.upsert` 直接写 `input.workspace` ⇒ `memory:save`（渲染层可传 workspace）照样把 scratch 路径写进 `memory.json`。判据：条目 `workspace` 含 `scratch\chat-`。
## 判据
- 真实工作区的捕获日志出现 `via:"exact"` + `written`，且当天 `logs/` 文件存在；
- `lessons/` 里不存在「现象 = 用户原话 + 注入块」的行；
- `lessons/*.md` 里**不含任何字面块标签**（`[常驻记忆结束]` / `[记忆结束]` / `[Harness 常驻记忆` / `[Harness 相关记忆`）—— 含了就是污染源，会破坏剥离（可用正则直接机器校验）；
- 报结论时明确区分：哪些层是「还没产生」，哪些是「产生不了」。