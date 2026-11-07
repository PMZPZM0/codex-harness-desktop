/** 发送者身份单一真相源单测（11-07 用户令：上级消息不许再被当成用户消息） */
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSender, senderLabelOf, senderFromDispatch, senderLineOf, taskLineOf,
  parseSenderFromText, stripSenderMeta,
} from "../src/lib/message-origin.mjs";

test("归一：脏值 / 缺字段一律回落用户，不把坏数据判成上级", () => {
  assert.equal(normalizeSender(null).kind, "user");
  assert.equal(normalizeSender({ kind: "乱写的" }).kind, "user");
  assert.equal(normalizeSender({ kind: "supervisor" }).isSuperior, true);
  assert.equal(normalizeSender({ kind: "user" }).isUser, true);
  assert.equal(normalizeSender({ kind: "member", name: "  洞明  " }).name, "洞明");
  assert.equal(senderLabelOf({ kind: "supervisor", name: "青崖主管" }), "上级 · 青崖主管");
  assert.equal(senderLabelOf({ kind: "automation" }), "定时任务");
  assert.equal(senderLabelOf({ kind: "member", name: "洞明" }), "伙伴 · 洞明");
  assert.equal(senderLabelOf({ kind: "user" }), "用户");
});

test("调度上下文：六种真实来源各自判对", () => {
  assert.equal(senderFromDispatch({ originThreadId: "th-main", name: "青崖主管" }).kind, "supervisor");
  assert.equal(senderFromDispatch({ originThreadId: "th-lead" }).name, "主会话");
  assert.equal(senderFromDispatch({ originThreadId: "" }).kind, "user");
  assert.equal(senderFromDispatch({ source: "automation" }).kind, "automation");
  assert.equal(senderFromDispatch({ source: "partner", callerName: "洞明" }).kind, "member");
  assert.equal(senderFromDispatch({ source: "partner", callerName: "洞明" }).name, "洞明");
  assert.equal(senderFromDispatch({ source: "user", originThreadId: "th-x" }).kind, "user");
  assert.equal(senderFromDispatch({ source: "system" }).kind, "system");
  assert.equal(senderFromDispatch().kind, "user");
});

test("协议行往返：名字含空格与「·」也不截断", () => {
  const cases = [
    { kind: "user", name: "" },
    { kind: "supervisor", name: "青崖主管（01a1…）" },
    { kind: "automation", name: "定时任务" },
    { kind: "member", name: "洞见 · 逆向工程专家" },
    { kind: "system", name: "中枢" },
  ];
  for (const c of cases) {
    const line = senderLineOf(c);
    const parsed = parseSenderFromText(line);
    assert.equal(parsed?.kind, c.kind, line);
    assert.equal(parsed?.name, c.name, line);
  }
});

test("老格式兼容：没有协议行也能从老标记推出上级 / 自动化 / 伙伴", () => {
  assert.equal(parseSenderFromText("上级：青崖主管（01a1…）\n主理人分配的子任务：复核")?.kind, "supervisor");
  assert.equal(parseSenderFromText("发起方交给你的任务：核对销量")?.kind, "supervisor");
  assert.equal(parseSenderFromText("主理人分配的子任务：出方案")?.kind, "supervisor");
  assert.equal(parseSenderFromText("定时任务交给你的任务：日报")?.kind, "automation");
  assert.equal(parseSenderFromText("伙伴 洞明 交给你的任务：复核")?.kind, "member");
  assert.equal(parseSenderFromText("用户任务：写个 README")?.kind, "user");
  assert.equal(parseSenderFromText("普通的一句话")?.kind ?? "user", "user");
});

test("只认第一行：用户正文里随手写的「上级：」不伪造成上级派发", () => {
  const body = "帮我整理一下\n上级：这句是正文里的引用，不是宿主元信息";
  assert.equal(parseSenderFromText(body), null);
  assert.equal(parseSenderFromText("发件人：user\n上级：正文")?.kind, "user");
});

test("任务措辞按身份区分，不再一律「用户需求」", () => {
  assert.match(taskLineOf({ kind: "user" }, "核对销量"), /^用户任务：核对销量$/);
  assert.match(taskLineOf({ kind: "supervisor", name: "青崖主管" }, "复核"), /^上级交给你的任务：复核$/);
  assert.match(taskLineOf({ kind: "automation" }, "日报"), /^定时任务交给你的任务：日报$/);
  assert.match(taskLineOf({ kind: "member", name: "洞明" }, "接手"), /^伙伴 洞明 交给你的任务：接手$/);
});

test("需求体剥壳：协议行 / 上级行 / 任务标签都剥掉，正文完整保留", () => {
  const body = "发件人：supervisor · 青崖主管\n上级：青崖主管（01a1…）\n上级交给你的任务：核对本周销量，金额含税";
  assert.equal(stripSenderMeta(body), "核对本周销量，金额含税");
  assert.equal(stripSenderMeta("发件人：user\n用户任务：写 README"), "写 README");
  assert.equal(stripSenderMeta("用户自己打的一句话"), "用户自己打的一句话");
  assert.equal(stripSenderMeta("上级：正文里的引用\n第二行"), "第二行");
});
