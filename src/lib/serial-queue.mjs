/**
 * 极简串行队列（10-31 审查后加固）：把「读 → 校验 → 写」这类临界区排成一队，
 * 后一个任务一定在前一个**完成之后**才开始。
 *
 * 场景（实测踩到）：`ensureSessionAlias` 是
 * `读已用集合 → 挑一个没被占的 → 写入`，两个不同会话同时进来时各自看到同一份
 * "已用集合"⇒ 都挑到同一个名字（真机实证：构造两个哈希同模的 threadId 并发调用，
 * 两条都拿到「墨藤」）。中枢开局 / 批量调度正是并发建会话。
 *
 * ⛔ 不用 async-mutex 之类的依赖：Node 是单线程，只要把 promise 串起来就够，
 *    30 行以内能说清楚，别引包。
 * ⛔ 前一个任务抛错**不能**卡死队列（`then(fn, fn)` 与 `tail.catch` 两处都是为了这个）。
 */

/**
 * 造一个串行执行器。
 * @returns {<T>(task: () => Promise<T> | T) => Promise<T>}
 */
export function createSerialQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
