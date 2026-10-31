/** 串行队列（纯函数，主进程与守卫共用）。 */
export function createSerialQueue(): <T>(task: () => Promise<T> | T) => Promise<T>;
