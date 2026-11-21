/**
 * GitHub 加速前缀 —— 主进程侧的转出点（11-21 起真相源搬到 `src/lib/github-mirror.mjs`）。
 *
 * ⛔ 为什么搬：渲染层「GitHub 热门」「前端设计」也直连 api.github.com，而 `electron/` 与
 *   `src/` 互不 import ⇒ 以前两处各写一份前缀表，实测出更快的源时只有一处会变。
 *   用户原话「应用必须全部走镜像快速通道，只要是 GitHub 的必须走镜像」。
 *   ⇒ 真相源 = `src/lib/github-mirror.mjs`，本文件只做**转出**，两边的 token/写盘逻辑仍各自留在原处。
 *
 * ⛔ 这里保留文件（不直接删掉让所有人改 import）：`gh-mirror` 是既有 20 多处引用的入口，
 *   一次性改全仓 import 只会制造无谓风险；转出层的类型注释仍写清「顺序怎么来的」。
 *
 * ⛔ 顺序按实测且每次发版前重测（已反转过三次）—— 详见 `src/lib/github-mirror.mjs` 的文件头。
 * ⛔ 带令牌的请求**绝不允许**走镜像（令牌会泄露给第三方）：见 updates.ts 的 token 门。
 */
import { GH_API_MIRROR_PREFIXES as SHARED_API, GH_MIRROR_PREFIXES as SHARED_ASSET, mirrorCandidates as sharedCandidates } from "../src/lib/github-mirror.mjs";

/** 大文件资产 / 源码包的前缀序：直连优先，镜像兜底（空串 = 直连，必须排第一）。 */
export const GH_MIRROR_PREFIXES = SHARED_ASSET;

/** 元数据 API 的前缀序：镜像优先（api.github.com 直连在国内常 403/超时）。 */
export const GH_API_MIRROR_PREFIXES = SHARED_API;

/** 一个 URL 的全部候选；非 GitHub host 恒返回单元素。
 *  ⛔ API 与资产**不同序**（见文件头实测表）：资产直连快 47 倍，API 直连根本不通。 */
export const mirrorCandidates = sharedCandidates;
