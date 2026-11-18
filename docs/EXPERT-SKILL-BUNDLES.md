# 专家配套技能包（skillset）

> 背景：用户 2026-11-18 连续三问——「缺的技能市场都有？」「不应该专家自带吗」「所有专家都要配套技能」。
> 实测结论：能力表原先 13 个技能名里 **12 个本机不存在**，「去技能市场」是假出口。
> 现在分两条路走，本文件说明第二条（打包）。

## 两条路的分工

| 路径 | 谁用 | 现状 |
|---|---|---|
| **A 引用本机技能** | 自建专家、推荐专家 | ✅ 已实现：能力表 `skills[]` → 专家卡「管理配套技能」逐项启用/停用 |
| **B 随专家包装技能** | 专家市场包、要分发给他人的专家 | ✅ 机制已存在（`expert-market:install` → `installSkillHubSkillset`）；本文件补上**打包器** |

## 打包器用法

```bash
node scripts/skillset-pack.mjs \
  --slug zhuji-baseline \
  --name "筑基·环境自检" \
  --skills harness-api,self-tools,self-review \
  [--out dist/skillsets] [--install] [--dry]
```

- 技能根自动探测：`%APPDATA%/<应用>/codex-home/skills`（多账号时取**技能最多**的那套）；可用 `--root` 指定
- 产物：
  ```
  <slug>/.skillhub.json            { kind: "skillset", marketId, children: [...] }
  <slug>/<技能>/.skillhub.json     { kind: "skillset-child", skillset: <slug> }
  <slug>.skillhub.zip
  ```
- `--install`：把子技能复制进技能根（**只新增，同名拒绝覆盖**，不删任何东西）
- `--dry`：只打印将要打包什么

⛔ 打包器**不改技能正文**（内容属于作者工作）；⛔ 不会凭空造技能——技能不存在直接报错退出（退出码 3）。

## 与专家配置的衔接

`ExpertTeamConfig.skillBundle?: string`（`electron/expert-teams/01-team-types.ts`）：

- 留空 = 走 A 路（引用本机技能）；
- 填 slug = 声明「这位专家的技能随 `<slug>` 包提供」；包未安装时，专家卡按缺件处理。

## 已知限制

1. **本地打出来的包不能直接喂给 `expert-market:install`** —— 那条链路按 slug 从 SkillHub 远端拉取。
   本地包目前用 `--install` 手工装（或后续接一个「从文件安装」通道）。
2. 打包器只写 SkillHub 的两类元数据；`.cocoloop.json` 旧格式未处理（新包一律用 `.skillhub.json`）。
