/**
 * 供应商「一次只能启用一个」的**唯一实现**（10-15 用户：「云管理新增的供应商，上面的豆包没有自动停用，
 * 供应商正向反向做的还不够」）。
 *
 * 不变量：模型档案（`custom-models.json`）里**最多一个** `enabled !== false` 的供应商，且它就是生效供应商
 * （`custom-model.json`）。
 *
 * ⛔⛔ 为什么必须收成一处（真机事故链）：
 *   · `enabled` 的三个写入者原先各写各的 —— `custom-model:save` / `custom-model:set-enabled` 各自抄了一份
 *     "遍历其它行置 false"的循环，而 `cloud-provider`（云端同步 / 「设为当前供应商」）**一份都没有**
 *     ⇒ 云端同步把「云端模型」置 true 后，原来生效的「豆包」仍是 true ⇒ 列表里两个绿开关（截图实证）。
 *   · 更糟的是同步**每 10 分钟跑一次**：用户手动关掉云端模型，下一轮同步又把它顶回来 ⇒「反向」永远不成立。
 *   ⇒ 规则只写在这里；三个写入者一律调它。守卫 `12q-cloud-account` 跑本文件的**真值表**（不是抄一份）。
 *
 * ⛔ 纯函数、无 I/O、无 electron 依赖 —— 守卫可以直接 import 跑（`--experimental-strip-types`）。
 * ⛔ `enabled` 的语义是「`!== false` 即启用」（历史数据缺这个字段时按启用算），别改成 `=== true`。
 */

export type ProviderRowLike = { provider: string; enabled?: boolean };

/**
 * 只保留 `enabledProviderId` 一个启用行，其余全部停用。
 * @param enabledProviderId 要启用的供应商 id；`null`/空 = **全部停用**（调用方保证 id 存在，见下）
 * @returns 新列表（未变时原样返回）+ `changed`
 * ⛔ 传入不存在的 id 的语义是「全部停用」——宁可一个都不启用，也不要留下两个绿开关；
 *   调用方（save / set-enabled / activate）都会先校验 id 存在。
 */
export function withExclusiveEnabled<T extends ProviderRowLike>(
  list: T[],
  enabledProviderId: string | null | undefined,
): { list: T[]; changed: boolean } {
  const keep = String(enabledProviderId ?? "");
  let changed = false;
  const next = list.map((row) => {
    const want = keep !== "" && row.provider === keep;
    const is = row.enabled !== false;
    if (is === want) return row;
    changed = true;
    return { ...row, enabled: want };
  });
  return { list: next, changed };
}
