# 思考中断与档位排查

## 取证范围

- 会话：`01a086a0-95fa-7031-8766-67afc69c82be`。
- 异常回合：`01a086fc-8b84-77b2-aa78-e8e211db464a`。
- 只读检查本地 rollout、`engine-debug.log`、`logs_2.sqlite`。
- 本文不包含聊天正文、密钥或认证令牌。所有时刻为北京时间。

## 思考为何变成正文

该会话实际使用 `deepseek-v4-flash`，供应商配置为 Responses 协议。
异常回合在 2026-09-10 00:26:27、00:27:54、00:29:47 三次记录
`stream disconnected before completion: Upstream request failed`，引擎随后重试。
响应头包含 `WorkBuddyRetryProxy/1.0 Python/3.12.3`，说明链路经过该代理。
仅凭此响应头不能断定是代理程序还是更上游的服务出错。
最后一次采样请求 00:30:03 的两个 x-request-id 为
`f68f1dec-e501-4a90-aff8-b67f8d7d4836` 和
`8ad62c4f-d30f-42ab-b016-b2495dafde2f`，可供网关侧关联原始流日志。

00:31:49，原档依次收到：

- reasoning：`item_6311e73322d31484a6cc8920`，摘要 15,057 字。
- assistant message：`item_8490e6a7f95dd4eb3c2bb634`，正文 15,057 字。
- 两段文本逐字相同，ID 不同，随后回合结束。

同类重复也出现在首个回合：2026-09-09 22:46:04 的两段文本均为 14,881 字。
引擎日志分别记录了 reasoning 与 message 的 output item 及完成事件，
不是渲染层将原有 reasoning 节点改成 agentMessage。
没有保存当时的原始 HTTP SSE 全流，不能进一步确定重复由哪一层网关转换产生。
前端修改折叠或延长运行计时不能恢复上游未提供的独立最终答复。

## 思考档位验证

该会话的 21 条 turn_context 都记录 `effort=ultra`，说明请求选择进入了引擎，
但这个字段不能证明最终 HTTP 参数或供应商采用的计算强度。

`npm run verify:reasoning` 使用独立临时 CODEX_HOME、当前实际 Codex 二进制及
本地 HTTP SSE 测试服务。直接提取应用的 buildModelCatalog 和 composer startTurn
构造逻辑，不读取用户凭据，不调用真实模型，不改动现有会话。

当前引擎 0.153.4、模型名 deepseek-v4-flash 的抓包结果：

| 所选档位 | 实际 HTTP reasoning.effort |
| --- | --- |
| minimal | minimal |
| low | low |
| medium | medium |
| high | high |
| ultra | high |
| xhigh | xhigh |

这些值证明应用到引擎再到 HTTP 请求的传递，不证明中转站到模型后端的支持情况。
模型目录 `supports_reasoning_summaries` 分别设置 true/false 均不改变上述结果，
因此没有为此修改该配置。

另查实：计划模式只传顶层 effort 时，collaborationMode.settings 未指定
reasoning_effort，实际 HTTP 值会变成 medium。现已补齐嵌套参数，
覆盖 low/high/ultra/xhigh 的请求验证，以及计划结束后普通回合的档位验证。

## 本轮边界

- 修复计划模式覆盖所选档位。
- 无效档位回落至仍被模型声明的档位，不再硬编码 high。
- 去除 ultra 保证更高、最慢的描述，并明确该模型的 ultra 实际映射。
- 未修改折叠状态机、历史原档、供应商地址或用户凭据。
- 未声称修复远端断流或远端重复输出；进一步定位需要网关端对应请求的原始流日志。
