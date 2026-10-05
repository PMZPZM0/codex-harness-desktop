/** 注册 `_ts-resolve.mjs`（给 `node --import` 用）。见同目录 `_ts-resolve.mjs` 的说明。 */
import { register } from "node:module";

register("./_ts-resolve.mjs", import.meta.url);
