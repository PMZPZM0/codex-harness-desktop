/**
 * OpenFilm 的开源声明常量（10-27；用户明确要求「在界面和文档中标注开源项目地址及相关声明」）。
 *
 * ⛔⛔ 只在这里写一份：界面文案由主进程通过 `openfilm:status` 下发（前端不复制），
 *    `THIRD_PARTY_NOTICES.md` 与设计稿引用同一组事实（MIT + 商标条款）。
 * ⛔ 我们**不分发**它的任何二进制（CLI 走 npm、渲染引擎走 playwright、ffmpeg 用我们自己的），
 *    所以措辞是「提供下载/安装/调用入口」，不是「随包分发」。
 */

export const OPENFILM_HOME = "https://github.com/openfilm/openfilm";
export const OPENFILM_SITE = "https://openfilm.dev";
export const OPENFILM_LICENSE = "MIT";
export const OPENFILM_TRADEMARK_NOTE =
  "「OpenFilm」名称与图标归 OpenFilm 项目所有（TRADEMARK.md）；本产品仅提供下载/安装/调用入口，与该项目无隶属或背书关系。";

export type OpenfilmAttribution = { home: string; site: string; license: string; trademark: string };

export const OPENFILM_ATTRIBUTION: OpenfilmAttribution = {
  home: OPENFILM_HOME,
  site: OPENFILM_SITE,
  license: OPENFILM_LICENSE,
  trademark: OPENFILM_TRADEMARK_NOTE,
};
