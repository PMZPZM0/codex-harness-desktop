# 技能与工具契约（11-19 立）

> 目的：**常驻注入只放索引，细节按需读**。每新增一个技能或工具，都必须在本文件规定的索引里登记，
> 否则会出现两类事故：① 模型看不见（工具/技能等于不存在）；② 每轮白烧 token（清单越滚越长）。

## 一、技能：三层索引，唯一真相是磁盘

| 层 | 位置 | 谁写 | 作用 |
|---|---|---|---|
| 1. 运行层 | `$CODEX_HOME/skills/<name>/SKILL.md`、`<cwd>/.codex/skills/<name>/SKILL.md` | 内置同步 / 包安装 / 市场安装 / 用户手写 | **引擎唯一认的地方**；`skills/list` 与模型清单都来自这里 |
| 2. 包级索引 | `electron/skill-packs-catalog.ts` | 手写（单一真相源） | 精选技能包的分类 / 版本 / 包内技能 / 配套专家 / 是否随包内置 |
| 3. 界面层 | 渲染层读 `skill-packs:list`、`skills:local-list` | 派生，⛔ 不另存一份 | 开发工具页、技能页、浏览器自动化页 |

### 新增技能的硬规则

1. **frontmatter 必须有 `name` + `description`**；`description` ≤ **60 字**，只写「什么时候用它」（触发词），
   步骤写正文 —— 因为这条 description 会被引擎**每轮**注入 `### Available skills`。
2. 正文按内置技能的既有四段写（触发条件 / 步骤 / 判据 / 坑）。
3. 通过**技能包**装的，落盘时必须写 `.skill-pack.json`（`packId`）；卸载只删带本包凭据的目录。
4. 进精选技能库的，`skill-packs-catalog.ts` 必须给：`category`、`version`、`skills[]`、`experts[]`；
   随包内置的加 `bundled`（市场原位注册的再加 `market: true`，⛔ 不许再拷贝一份到 skills 目录）。
5. 装完不必重启：引擎下一回合就会扫到（技能包安装器会主动 `server.restart()`）。

### 「find skills」的现状与边界（诚实声明）

- 引擎会把**每个技能的 description** 注入清单，宿主**无法关闭**这块 ⇒ 唯一可控的杠杆是
  **把 description 压到触发词级**（已做：60 字）。
- 用户要的 `find_skills(query)` 工具（按关键词搜本地技能正文，返回 name/path/摘要）**尚未实现**：
  需要新增一条宿主工具，涉及渲染层工具分发 + 主进程 handler + manifest + 工具画像四处，
  且必须真机验证「新装的技能立即可被找到」。
- 在此之前的行为：清单给「触发词 + 路径」，模型先看清单命中，再用 `read_file` 读 `SKILL.md` 正文。

## 二、工具：一张目录 + 三档画像

| 项 | 位置 | 规则 |
|---|---|---|
| 工具目录 | `electron/tool-profiles.ts` → `HOST_TOOL_CATALOG` | **新增宿主工具必须登记**，否则它「默认保留」= 没纳入画像 |
| 常驻集 | `CORE_TOOLS` | 普通会话每轮可见的 schema；**必须自足**（任务 / 记忆 / 技能 / 调度 / 网关） |
| 岗位增量 | `ROLE_EXTRAS` | 按专家岗位（product / engineering / design）追加；由 `roleKeyOf()` 从岗位文案判定 |
| 回滚开关 | `TOOL_PROFILES_ENABLED` | 置 `false` = 恢复全量工具面（不删代码） |
| 其余能力 | `harness_tools` 网关 | 一个 schema 覆盖 40+ 能力，按需调用 |

### 新增工具的硬规则

1. 先想清楚：**普通会话每一轮都可能用它吗？** 不是 ⇒ 进网关，不进 `CORE_TOOLS`。
2. 加进 `HOST_TOOL_CATALOG`；需要常驻的再加进 `CORE_TOOLS` / 对应 `ROLE_EXTRAS`。
3. 工具描述 ≤ 3 句：做什么 / 何时用 / 一个硬约束；长手册放技能里（渐进披露）。
4. 权限与安全闸留在**执行端**，⛔ 不许拿工具面裁剪当安全边界。
5. 若工具依赖某个可选安装（Ego / Laya / 飞书 CLI），必须**条件注册**（没装就别让它出现在 schema 里）。

## 三、验收

| 判据 | 守卫 |
|---|---|
| 技能包字段齐全（category / version / skills / experts / bundled） | 12ai（`必需包齐全` 一条） |
| 引擎指令里的技能口径与清单同源 | 【103】【104】 |
| 工具面：委派 / 团队会话都包了 `withStepParam` | 【127】 |
| 工具目录与常驻集一致性、回滚开关存在 | 12ai（工具画像三条，11-19 加） |
