// Host 这一侧的语言。浏览器每次请求都带上当前语言，一个请求里发起的生成任务沿用同一个语言。
import { AsyncLocalStorage } from 'node:async_hooks'
import { EN } from './en.js'

const current = new AsyncLocalStorage()

/** 把请求头里的语言规整成 'zh' 或 'en'。 */
export function normalizeLang(value) {
  return String(value ?? '').toLowerCase().startsWith('en') ? 'en' : 'zh'
}

/** 在指定语言下运行 fn，里面的 tr() 和模型提示词都按这个语言来。 */
export function withLang(lang, fn) {
  return current.run(normalizeLang(lang), fn)
}

/** 当前语言，没有请求上下文时是中文。 */
export function currentLang() {
  return current.getStore() ?? 'zh'
}

/**
 * 翻译一段给用户看的文字。key 是中文原文，{name} 是占位符。
 * @param {string} zh - 中文原文。
 * @param {Record<string, unknown>} [vars] - 占位符的值。
 * @returns {string} 当前语言的文字。
 */
export function tr(zh, vars) {
  const text = currentLang() === 'en' ? (EN[zh] ?? zh) : zh
  return vars ? text.replace(/\{(\w+)\}/g, (match, key) => (vars[key] === undefined ? match : String(vars[key]))) : text
}

/** 英文界面时追加到系统提示词末尾，让模型用英文写所有给人看的内容。 */
export const ENGLISH_DIRECTIVE = [
  '',
  '## Output language',
  'The user works in English. Write every human-readable value (titles, cover text, scripts, outlines, captions, storyboard lines, voice-over, style cards, rules, chat replies) in natural, fluent English, even if the instructions above or the material are in Chinese.',
  'Keep JSON keys, op names, ids, enum values and platform names exactly as specified above.',
  'Where a length limit is given in Chinese characters (字), treat it as about half as many English words.',
].join('\n')

/** 按当前语言二选一，给提示词里的语言相关片段用。 */
export function byLang(zh, en) {
  return currentLang() === 'en' ? en : zh
}

const PLATFORM_EN = { 公众号: 'WeChat', 小红书: 'RedNote', 抖音: 'Douyin', B站: 'Bilibili', 视频号: 'WeChat Channels', TikTok: 'TikTok', Instagram: 'Instagram', YouTube: 'YouTube', X: 'X' }

/** 平台在数据里一直是中文值；拼进给人看的句子时按当前语言显示。 */
export function platformName(platform) {
  if (!platform) return platform
  return currentLang() === 'en' ? (PLATFORM_EN[platform] ?? platform) : platform
}
