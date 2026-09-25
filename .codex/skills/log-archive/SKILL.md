---
name: log-archive
description: 往 logs/ 建规范日志条目、检索历史结论、归档或删除条目时用它。适用于「刚定了一个方案 / 修完一个非显而易见的 bug / 发版 / 改了用户可感知的行为」这些该留档的时刻，以及事后想问「当时为什么这么定」。含条目格式要求、索引机制、检索与管理命令、删除的安全边界。
---

# 项目日志库：留档与检索（`logs/`）

## 何时用

**该建条目**（这些时刻不写档 = 这次工作没做完）：

| 情形 | kind |
|---|---|
| 在几个可行方案里选了一个（尤其有取舍） | `decision` |
| 修了一个非显而易见的 bug（有过误判、反直觉证据） | `incident` |
| 发版 / 完成里程碑 | `milestone` |
| 改了用户能感知的行为语义（交互 / 默认值 / 权限边界） | `change` |
| 推翻了以前的结论（包括推翻自己） | `decision` + `supersedes` 指旧 id |

**不用写**：纯格式、重命名、依赖升级、一次就懂的改动 —— 那些留在每日流水（`<ws>/.workbuddy/memory/YYYY-MM-DD.md`）即可。

**检索**：用户问「当时为什么这么定 / 上次那个 bug 怎么修的 / 有没有相关先例」→ 先 `search`，别凭记忆答。

## 写：一条命令

⛔⛔ **正文一律走 `--body-file`，不要用 `--body "…"`**（09-25 实测事故：正文里的反引号被 shell 当命令替换
执行，几段内容**静默消失**、而命令**报「新建成功」**）。正确姿势 = 用 Write 工具把正文落成 `.md`，再：

```bash
node scripts/logs.mjs new --kind decision --area memory --title "记忆后端二选一" \
  --tags memory,mcp --commits 9308b62 --files electron/memory-backend.ts --importance high \
  --body-file .workbuddy/tmp/body.md
```

正文五段（没给就生成骨架，**必须逐段填实**，别留占位符）：背景 / 结论 / 依据 / 影响面 / 回滚。

⛔ 三条硬要求（写不出就是还没想清楚）：

1. **背景里要写"当时我不知道什么"** —— 只写结论会让下一个人重复推理
2. **依据禁止"已验证/测试通过"这种空话** —— 写清**怎么验的**（命令、判据、数据、文件行号）
3. **结论要能被否定** —— 写「X 时用 A、Y 时用 B」，不写「视情况处理」

`id` / 文件名 / 索引都由脚本生成，**不要手工造条目文件**（会漏索引，`verify` 会报"磁盘有、未入索引"）。

## 查

```bash
node scripts/logs.mjs search <关键词...> [--area a] [--kind k] [--tag t] [--since d] [--limit n] [--json]
node scripts/logs.mjs list [--kind k] [--area a] [--since d] [--json]
node scripts/logs.mjs show <唯一前缀即可>      # show 2026-09-25-decision 这样就行，不必敲完整 id
node scripts/logs.mjs stats
```

检索是**纯本地关键词打分**（title 6 / tags 4 / id 3 / area-kind-files 2，× 30 天半衰期新鲜度）。

⛔ 它**没有**语义/向量检索、**不跨会话原文**、无云端排名 —— 关键词挑**现象里最有辨识度的词**
（「原子图标」比「图标问题」有效）。归档段默认不在结果里，要搜就加 `--archived true`。

## 清理与删除（安全边界）

```bash
node scripts/logs.mjs archive <id...>                    # 清理 = 移进 archive 段；内容仍在 git，可搜回
node scripts/logs.mjs archive --all-before 2026-06-01
node scripts/logs.mjs delete <id...> --confirm <id...|all> --reason "为什么删"   # 硬删，留永久墓碑
node scripts/logs.mjs verify                             # 校验：缺文件 / 哈希不符 / 未入索引
node scripts/logs.mjs reindex                            # 索引损坏时从磁盘重建
```

⛔ **默认用 `archive`，不要用 `delete`**。`delete` 只在用户明确要求时用，且必须：

- 给 `--confirm`（逐个 id 或 `all`）—— 没有它脚本会拒绝执行
- 给 `--reason` —— 进永久墓碑（`logs/audit-deletions.jsonl`），半年后靠它解释

删除后正文不在了，但 `id / path / bytes / sha256 / deletedAt / reason` **永久留存** —— 这是"可删"与"不丢失"的调和方式，
别绕过它（例如直接 `rm` 日志文件：那样会留下"索引有、磁盘缺"，`verify` 会红）。

## ⛔⛔ 不要重复写（用户 2026-09-25 明确要求）

三个日志位置**服务不同读者**，同一段正文**只允许存在一份**，其他地方只留**指针**：

| 内容 | 写哪 | 别处怎么写 |
|---|---|---|
| 时间线 / 做到哪一步 / 零散判断 | 日报 `<ws>/.workbuddy/memory/YYYY-MM-DD.md` | —— |
| **结论 / 依据 / 影响面 / 回滚** | **本目录条目** | 日报里**只留一行** `→ logs/<id>`，⛔ 不要复述正文 |
| 每轮要注入的纪律 | `lessons/*.md` | 需要解释来龙去脉时在本目录建 `decision` 条目**指向它**，纪律本身别搬过来 |

**两道机制拦阻**（别绕过）：

1. `new` **写入时就会拦**：标题相似度 ≥0.75、或正文哈希完全相同 ⇒ 直接拒绝并给处理方式
   （同一件事 → 改那条 / `--supersedes`；真是两件事 → 换可区分标题或 `--allow-similar`）。
   撞到这个提示**不要习惯性加 `--allow-similar` 冲过去** —— 先确认是不是同一件事。
2. `node scripts/logs.mjs dedupe` 可随时全库查重（只报告、不自动删）。

⛔ 也别把 `logs/` 条目原文抄进日报或 `lessons/` —— 抄一遍就等于制造了第二份真相源，
两边一改就分叉，半年后没人知道哪份算数。



```bash
node scripts/logs.mjs verify     # 必须 ✓ 一致
```

## 交付前的自检（两行）

```bash
node scripts/logs.mjs verify     # 必须 ✓ 一致
node scripts/logs.mjs dedupe     # 必须 ✓ 没有重复（阈值 0.75）
```

- ⛔ **`.md` 后缀别改**：`.gitignore` 里有 `*.log`，改成 `.log` 会让整个目录进不了 git ⇒ 丢掉最强的一道防丢失保障。

## 一句话判据

**半年后的你，只看这一个文件，能不能明白"当时为什么这么定"？** 不能，就是没写完。
