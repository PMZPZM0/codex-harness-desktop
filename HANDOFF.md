# HANDOFF — 交接文档（2026-11-07 09:25）

> 写给**完全没有上下文**的新会话。读完这一份 + 根目录 `AGENTS.md`（怎么建 / 怎么同步三仓）+ `DESIGN.md`
> （长什么样）即可接手。项目：Codex Harness Desktop（Electron 43 + React 19 + Vite 8，主进程 spawn
> `@openai/codex` app-server，stdio JSON-RPC）。
>
> 本文件只放**当前轮的主线**。历史（发版、服务器加固、手机远控、Caddy 日志轮转…）在 `logs/`
> （结论档案，用 `node scripts/logs.mjs search <关键词>` 查）与 `.workbuddy/memory/YYYY-MM-DD.md`
> （逐日流水）。⛔ 本文件只留在主仓（`D:\Codex Harness Desktop`）：PPcode / 云助手是代码镜像，不带文档。

---

## 0 三十秒速览

- **主线**：群聊（团队模式）功能丰富 + **上级协作的消息来源识别**。后者是用户中途插进来的更高优先级任务，已完成并三仓收尾。
- **最近提交**：主仓 `1d2ee053d`（来源结构化识别）+ `da15dca5a`（结论档案）；PP `33da5258` / `ac732a17`；云 `85f36dae` / `8ae2b99a`（**已部署**）。
- **当前状态**：三仓干净、已推送、构建通过、主仓 `npm run check` **9137 行 / 0 红**、三仓 `verify:runtime` 全 PASS、electron 残留 0。
- **下一步**：回到群聊丰富剩下的三块（伙伴资料卡 / @ 候选面板 / 群内搜索），见 §5.1。

---

## 1 我们在做什么

用户最初给了两条诉求，后一条优先级更高、已先做完：

1. **群聊功能丰富 + 界面优化**，参考桌面上的两份逆向报告：
   `C:\Users\Administrator\Desktop\飞书机器人群聊-逆向结论.md`（协议 / 表现层）与
   `C:\Users\Administrator\Desktop\豆包工作伙伴-团队模式-复刻方案.md`（治理 / 运行层）。
   对照进度表在 `docs/TEAM-MODE-PLAN-2026-11-05.md`。
2. **承接第 1 条时用户插入的高优先级修复**（原话）：
   > 「准确区分每条消息是上级发送还是用户发送，并让调度功能在被调度场景中正确识别上级消息，
   > 修复当前无法判断来源、默认全部按用户消息处理的问题……不仅限群聊里面，外面对话框，专家团，
   > 中枢会话也是一样」

   这一条已完成（§3.1），是本轮的主体工作量。

---

## 2 三仓与生效方式（动错仓 = 白干一轮）

| 仓 | 本地路径 | 远端 | 改动怎么生效 |
|---|---|---|---|
| 主仓（开发主线） | `D:\Codex Harness Desktop` | `PMZPZM0/codex-harness-desktop`（推 `origin main`） | 本地 `npm run build`，重启应用 |
| PPcode（副本 + 发布页） | `D:\PPcode` | `PMZPZM0/PPcode`（推 `origin main`） | 同主仓（本地构建即生效） |
| 云助手 | `D:\Codex Assistant` | `PMZPZM0/codex-harness-cloud-src`（⛔ 推 `cloud main`，其 `origin` 指向主仓） | ⛔ **必须** `node scripts/deploy-cloud-ui.mjs`；只 build 用户看不到 |

**每轮固定流程**（10-13 用户令；三仓 `AGENTS.md` 顶部有逐字一致的判定表）：

```
改代码 → 主仓 build / check / 真机验证 → 提交推送
      → 生成补丁同步另两仓（排除各仓自产文件，见 §6.4 / §7.2）
      → 每仓各自 npm run build（⛔ 主仓 build 不会替它们出产物）
      → 云助手 deploy → 各仓提交推送 → 每仓启动校验
```

判据（机械可查，别用"源码 diff 一致"糊弄）：`stat -c %y dist/assets/index-*.css` 必须 ≥ 对应 CSS 源文件
mtime；产物里要能 grep 到本轮新规则。

---

## 3 已经完成

### 3.1 消息来源结构化识别（主仓 `1d2ee053d`）

**病根**：调度链的输入里**没有「谁发的」**，只有 `originThreadId`，且空串被一律当成「本地用户」。
六种真实来源——主对话模型自派 / 专家团主理人派成员 / 中枢派群成员 / 定时任务 / 群伙伴互 @ /
用户亲自打字——全被拼成同一句「发起方交给你的任务」。消费侧只能靠 `[SYSTEM TASK]` 标签白名单 +
正文正则去猜，猜不到就按用户消息处理。

**解法**：身份作为结构化对象沿链传，并在首任务**需求体第一行**写协议行：

```
发件人：supervisor · 青崖
```

五种身份：`user | supervisor | automation | member | system`。真相源 `src/lib/message-origin.mjs`
（`normalizeSender` / `senderLineOf` / `taskLineOf` / `parseSenderFromText` / `stripSenderMeta` /
`senderFromDispatch`），类型在 `message-origin.d.mts`。

**生产端 6 处全部写协议行**（漏一处 = 那类来源又变回「用户消息」）：

| 位置 | 场景 | sender |
|---|---|---|
| `electron/features/delegation.ts` | 模型自派 / IPC / 宿主工具 | supervisor（有 origin 时兜底推导） |
| `electron/team-invoke.ts` | 专家团主理人 → 成员 | supervisor |
| `electron/features/teams-ipc.ts` | 团队会话首任务 / 成员直达首任务 | user / supervisor（**两处**各一份） |
| `electron/boss-groups/runner.ts` | 中枢 → 群成员 | supervisor |
| `electron/features/harness-team-ipc.ts` + `src/features/harness-team/02-team-store.ts` | 群派活 | user / automation / member（伙伴互 @） |
| `src/features/app-state/parts/part08/02-seg/send.tsx` | 用户亲自在专家/成员会话打字 | user（**显式**，不靠"没标签"猜） |

辅助入口：`electron/features/dispatch-rpc.ts`（`agent_invoke`）与
`src/features/app-state/parts/part05/event-router/02-request.tsx` 显式传 `{ kind: "supervisor" }`。

**消费端**：
- `src/lib/user-refs.ts`：`parseUserRefs` 统一解析出 `sender`；老会话没有协议行时从旧标记推导
  （`上级：` / `发起方交给你的任务` / `主理人分配的子任务` / `用户任务`），**推不出才回落 user**。
- `src/features/shared/UserMessageView.tsx`：`isParentTask` 优先 `refs.sender.isSuperior`；
  定时任务 / 伙伴转交 / 系统各有专属头部（`定时任务` / `伙伴转交` / `系统消息`）。
- 群消息：`team-models.mjs` 的 `senderKindOf()` 落库并投影（`GroupLogMessage.senderKind` /
  `GroupMessageProjected.senderKind`），渲染层 `04-team-group-view.tsx` 按 `data-sender` 出标记。

### 3.2 群视图修复与增强（同一提交）

- **合成来源用徽标代替名字**：真机截图先暴露两个缺陷——「定时任务 **定时任务** 08:55」重复、
  系统消息露英文 id `system`。现在 `automation` / `system` 用 `.team-msg__sender` 徽标占名字位，
  `supervisor` 才是「名字 + 上级派发」；补了 `nameOf("system") → 系统`。
- **跨天分隔**：`src/lib/team-view.mjs`（`dayKeyOf` / `dayLabelOf`）+ `.team-msg__day`
  （两侧细线 + 日期胶囊），只在换天处插一条。

### 3.3 判据与验证

| 项 | 结果 |
|---|---|
| `npm run build`（类型判据） | 三仓 ✓ |
| `npm run check` | 主仓 **9137 行 / 0 红**，预检通过，【93】【94】【96】真跑过 |
| 守卫 11f | **149/149**（本轮新增 16 个断言调用；其中一个遍历 5 个壳生产点 ⇒ 运行时多 20 条。覆盖协议行格式 / 第一行优先级 / 每个生产点 / 群投影与渲染 / 样式在位） |
| 守卫 11q | 主仓 131/131、云 130/130（两条旧断言从「钉旧正则」改锚「结构化身份 + 老标记兜底」） |
| 单测 | `message-origin` 7 / `team-view` 2 / `team-models` 29，全绿 |
| `verify:runtime` | 主仓 / PP / 云三仓 PASS（无 ErrorBoundary、`.app-shell` 在） |
| 真机渲染 | 隔离 profile + 种子群截图：`data-sender` = user / member / automation / system，日期分隔「昨天 / 今天」正常 |

### 3.4 归档

`logs/2026/11/2026-11-07-decision-消息来源结构化识别上级-定时任务-伙伴-用户.md`，三仓已同步并各自重建索引；
主仓跑过 `logs.mjs verify`（索引与磁盘一致）与 `dedupe`（无重复）。

---

## 4 当前卡在哪

没有"做不下去"的卡点，只有三个**已知遗留**（都不是本轮引入的）：

1. **PP 仓 3 条 cloud 断言红**：`scripts/guards/12q-cloud-account.mjs` 报
   「首启登录页有 cloud 模式 / 有云账号选项卡 / 登录方式卡选中态」。已在 PP 仓用 `git stash push -u`
   在 HEAD 上复现——**确认是既有状态**，与本轮改动无关。它会让 `npm run check` 在这一步中断，
   所以 PP 的尾部判据（preflight / bag-types / dead-imports / require-paths）要**手动补跑**。
2. **云仓缺 `resources/tools/automation-tools.zip`**：`verify-packaged-tools` 与 `check-preflight`
   都会停在这一步（缺件，不是断言失败）。要修需先有 `resources/tools/npm-global/node_modules`
   （本机装好自动化工具）再跑 `node scripts/pack-automation.cjs`。
3. **项目 `MEMORY.md` 9908 字符 / 上限 10000**（安全线 9500）。宿主会**静默截断尾部**，
   只剩 92 字符余量 —— 下次往记忆里追加任何东西之前，先外置一条。

---

## 5 下一步计划

### 5.1 回到群聊丰富（用户最初那条需求，还剩三块）

逆向报告里**已落地**的是：成员栏、消息卡片（角色条 + 复制 / 追问 / 来源）、@ 高亮 chip、
团成员展开、运行态与停止键、群菜单、群调度、按天分隔、来源标记。

**还没做**：

1. **伙伴资料卡**（飞书 §2.1「点机器人头像弹资料卡」）
   建议新建独立组件 `src/features/harness-team/14-team-profile-card.tsx`
   （⛔ 别往 `04-team-group-view.tsx` 里顺手加块，`ARCHITECTURE-RULES.md` §2.2 要求新功能独立板块）。
   数据必须真实：`group.members`（`targetKind` / `targetKey` / `targetProfession`）、
   群台账 `harness-team-ledger.json`（用量 / token）、`team-runtime.mjs`（是否在跑）、
   `electron/features/harness-team-ipc.ts` 的 `listDispatchCatalog`。
   ⛔ 不编假数据；拿不到就显示 0 / 空。
2. **@ 候选面板**（飞书 §4：机器人单独一类）
   入口在 `src/features/harness-team/10-team-composer.tsx`；文档里明确写过「不搬 mention 面板」，用户现在要了。
   ⚠️ 纯函数 `mentionTriggerOf` / `matchMentionCandidates` / `applyMention` 曾在工作区里写过并测过，
   但**提交前**因「没有消费方」被删（§6.9），**git 里没有**（`1d2ee053d^` 不含该文件）——要按飞书 §4 重写。
   边界要求：前一个字符必须是空白 / 行首 / 中文标点（否则 `a@b`、`C:\x@y` 误触发）；
   词里不许再有 `@` 或空白；最长 40 字；caret 越界按末尾处理。
3. **群内搜索**（豆包「群消息天然是 append-only 日志」）
   `searchGroupRows` 同样被删过，重写后把结果 key 对到消息 DOM 的 `data-item-id` 上做跳转。

### 5.2 收尾杂项

- PP 的 3 条 cloud 红：要么修，要么给 `12q` 加"本仓无 cloud 面"的**显式跳过**（⛔ 别静默放行）。
- 云仓补齐 `automation-tools.zip` 后重跑完整 `npm run check`。
- `MEMORY.md` 外置一条，把余量拉回安全线以上。

---

## 6 踩过的坑（别踩第二次）

1. **`npm run check` 前必须 `unset NODE_OPTIONS`**。不清的话链会在中途提前中断，
   尾部 `bag-types` / `dead-imports` / `require-paths` 全都不跑，看起来"绿"其实是没跑。
   收尾要**看输出末尾**确认【93】【94】【96】真跑过。
2. **`npm run check | tail` 的退出码是 `tail` 的**。`EXIT=0` 不代表通过 —— 要看有没有 `✗`，
   以及后面的守卫有没有真跑到（链断在哪个守卫，就只看到它的总结）。
3. **守卫会"自洽地错"**：本轮 `11q` 两条断言钉的是**旧实现的字面量**，代码一改就红。
   正确做法是把锚点改到新不变量（结构化身份 + 老标记兜底），⛔ 不是把断言删掉或放宽成 `/x/.test()`。
4. **`src/vite-env.d.ts` 是生成物、每仓自产**。补丁打到另两仓会冲突 ⇒ 排除它，
   在那两仓各跑一次 `npm run gen:ipc`。
5. **`09-structural.mjs` 的 `GIANT_CAP` 棘轮按实测记账、每仓独立**。
   口径 = 非空且非 `//`、`/*`、`*` 开头的行；改完量出实测值写进 cap 并注明来历。⛔ 别照抄别的仓的数字。
6. **`send.tsx` 在三个仓的上下文不完全一致**，补丁会冲突 ⇒ 手工合并（加一行 import + 改一行模板串）。
7. **`projectGroupLog` 按 `at` 排序**，同刻消息的先后不属于契约 —— 单测别按插入顺序断言，按 id 取再比。
8. **合成身份不能靠改 `authorKind`**：它还管着过程折叠 / 卡片 / 动作条，动了会连带坏一片。
   新增来源一律走**独立的 `senderKind`**，`authorKind` 语义保持不动。
9. **不许留"写了没接"的模块**：本轮 `team-view.mjs` 一开始塞了 8 个派生函数，只有 2 个有消费方，
   收尾时删掉 6 个。要么同轮接线，要么不写。
10. **真机截图是必要判据，不是补充**：本轮两个显示缺陷（徽标重复、英文 id）只有截图才看得见，
    守卫和单测全绿。截图用隔离 profile（§7.3），⛔ 不要动真实 userData。
11. **老会话兼容必须双向**：新协议行读不到时要能从旧标记推导；反过来，用户自己在成员会话里打的
    `上级：…` 不能被误判成宿主派发（11-03 的老边界：**只认正文第一行**）。
12. **怀疑"是我弄红的"之前先 `git stash push -u` 在 HEAD 上复现一次**（PP 那 3 条 cloud 红就是这么排除的）。
13. **三仓同步不要 `git add -A` 了事**：先看 `git status` 里有没有别人的 hunk（10-31 踩过），
    有就按 `parallel-hunk-commit` 只提交自己的。
14. **文档里的数字必须与实测一致**：写"9137 行 / 0 红"之前真的跑过；写"29 条单测"之前真的数过。

---

## 7 常用命令与验证清单

### 7.1 本仓

```bash
cd "D:/Codex Harness Desktop"
unset NODE_OPTIONS
npm run build                      # 唯一可信的类型判据（tsc -b 会假绿）
npm run check                      # 看末尾【93】【94】【96】
node --test tests/message-origin.test.mjs tests/team-view.test.mjs tests/team-models.test.mjs
npm run verify:runtime             # 真机探针：ErrorBoundary / .app-shell / 会话行
node .workbuddy/memory/check-budget.mjs
```

### 7.2 三仓同步

```bash
# 1) 主仓出补丁
git format-patch -1 --stdout > /tmp/x.patch
# 2) 另两仓（排除各仓自产 / 易冲突文件）
git apply --check --stat /tmp/x.patch
git apply --exclude=scripts/guards/09-structural.mjs \
          --exclude=src/vite-env.d.ts \
          --exclude=src/features/app-state/parts/part08/02-seg/send.tsx /tmp/x.patch
npm run gen:ipc                    # 重生成 vite-env.d.ts
# 3) 手工合并 send.tsx 与 09-structural 的 cap（按本仓实测）
npm run build && npm run check
# 4) 云助手额外：node scripts/deploy-cloud-ui.mjs --skip-build
# 5) 各自提交推送：主 origin main / PP origin main / 云 cloud main
```

### 7.3 真机看群视图（本轮实际用过的方式）

用 `scripts/e2e/lib/harness.mjs` 的 `ElectronHarness`，**隔离 profile + 种子数据**：

```js
const h = new ElectronHarness({
  name: "sender-badge-" + Date.now(),
  seedProfile: (dir) => writeFileSync(join(dir, "harness-teams.json"), JSON.stringify(seed)),
});
await h.launch();                                  // mkdtemp 一个临时 userData，不碰真实数据
await h.clickByTitle("群聊");                       // 侧栏入口（title 以「群聊」开头）
await h.eval(`document.querySelectorAll(".team-mode__group")[0].click()`);
const shot = await h.screenshot("sender-badge");   // 落到 .e2e-artifacts/shots/
await h.close();
```

种子群结构（`harness-teams.json`）：
`{ version, groups: [{ id, name, leadId, members: [...] }], messages: { <gid>: [{ id, threadId,
authorId, authorKind, senderKind, at, kind, text, mentions }] } }`。
伙伴消息的 `threadId` 必须非空（假的用 `thread:seed-1`），否则 `appendGroupMessage` 判无效。
⚠️ `ElectronHarness({ name })` **不会**建持久 profile（实测走了 `mkdtemp`），
要复用 profile 得传 `profileName` 并自己灌种子。

### 7.4 收尾四步

① 审查本轮 diff ② `npm run build` ③ 拉起应用跑探针 ④ 关掉应用并确认 `electron.exe` 残留 = 0。
⛔ 启动与检查要**在同一次 shell 调用**里完成（GUI 进程会被会话 job 回收）。

---

## 8 关键文件地图

| 关注点 | 文件 |
|---|---|
| 发送者身份（唯一真相源 + 类型） | `src/lib/message-origin.mjs` / `.d.mts` |
| 用户消息解析（壳 / 引用 / 群事件） | `src/lib/user-refs.ts` |
| 用户消息渲染（左对齐上级气泡） | `src/features/shared/UserMessageView.tsx` |
| 调度主闸（所有派活共用） | `electron/features/delegation.ts` |
| 专家团主理人 → 成员 | `electron/team-invoke.ts` |
| 团队会话 / 成员直达会话 | `electron/features/teams-ipc.ts` |
| 中枢 → 群成员 | `electron/boss-groups/runner.ts` |
| 群消息落库 / 定时任务派活 | `electron/features/harness-team-ipc.ts` |
| 群消息模型（投影 + `senderKindOf`） | `src/lib/team-models.mjs` / `.d.mts` |
| 群视图（消息流 / 成员栏 / 日期分隔） | `src/features/harness-team/04-team-group-view.tsx` |
| 群输入框（@ 面板要改这里） | `src/features/harness-team/10-team-composer.tsx` |
| 群样式（`.team-msg__sender` / `.team-msg__day`） | `src/styles/61-team-mode.css` |
| 日期派生 | `src/lib/team-view.mjs` |
| 守卫 | `scripts/guards/11f-dispatch-integrity.mjs`（来源协议）/ `11q-live-edits.mjs`（上级气泡）/ `09-structural.mjs`（棘轮） |
| 结论档案 | `logs/2026/11/2026-11-07-decision-消息来源结构化识别上级-定时任务-伙伴-用户.md` |

---

## 9 接手第一步建议

1. 读 `AGENTS.md` 的「三仓」与「收尾」两节，再读 `docs/ARCHITECTURE-RULES.md` §2.2（新功能独立板块）。
2. `git log -3 --oneline` + `git status` 确认三仓基点与干净度。
3. 跑一次 `npm run build && npm run check`（先 `unset NODE_OPTIONS`），确认基线是绿的再动手。
4. 从 §5.1 的三块里挑一块，按「纯函数 + 单测 → 接线 → 守卫 → 真机截图 → 三仓」的顺序做。
