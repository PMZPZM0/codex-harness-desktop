// 本地规则解析：模型不可用时对话依然能完成常见操作，界面会标明这是本地规则。
import { platformName, tr } from './i18n.js'
import { fmtWhen, STATUSES } from './ops.js'

const WEEK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
const STATUS_WORDS = { 灵感: 'idea', 大纲: 'outline', 草稿: 'draft', 待发布: 'ready', 已发布: 'published' }
const CN_DIGIT = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 }
const WEEK_EN = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
const MONTH_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const PLATFORM_WORDS = { 'wechat channels': '视频号', wechat: '公众号', xiaohongshu: '小红书', rednote: '小红书', douyin: '抖音', bilibili: 'B站', channels: '视频号', tiktok: 'TikTok', instagram: 'Instagram', ig: 'Instagram', youtube: 'YouTube', twitter: 'X' }

/** 英文里的日期时间：tomorrow 8pm、next wed、Nov 3 20:00、in 3 days。 */
function parseWhenEn(text, now) {
  const date = new Date(now)
  let matched = false
  let m
  if (/\bday after tomorrow\b/i.test(text)) { date.setDate(date.getDate() + 2); matched = true }
  else if (/\btomorrow\b/i.test(text)) { date.setDate(date.getDate() + 1); matched = true }
  else if (/\b(today|tonight|this (morning|afternoon|evening))\b/i.test(text)) { matched = true }
  else if ((m = /\b(next\s+)?(mon|tue|wed|thu|fri|sat|sun)(?:day|s|sday|nesday|rsday|urday|r|rs)?\b/i.exec(text))) {
    const target = WEEK_EN[m[2].toLowerCase()]
    const current = date.getDay()
    let delta = (target - current + 7) % 7
    if (m[1]) delta = ((target + 6) % 7) + (7 - ((current + 6) % 7))
    else if (delta === 0) delta = 7
    date.setDate(date.getDate() + delta)
    matched = true
  } else if ((m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(text))) {
    date.setMonth(MONTH_EN.indexOf(m[1].toLowerCase()), Number(m[2]))
    if (date < now) date.setFullYear(date.getFullYear() + 1)
    matched = true
  } else if ((m = /\bin\s+(\d+)\s+days?\b/i.exec(text))) {
    date.setDate(date.getDate() + Number(m[1]))
    matched = true
  }

  let hour = null
  let minute = 0
  if ((m = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i.exec(text))) {
    hour = Number(m[1])
    minute = Number(m[2])
    if (m[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12
    if (m[3]?.toLowerCase() === 'am' && hour === 12) hour = 0
  } else if ((m = /\b(\d{1,2})\s*(am|pm)\b/i.exec(text))) {
    hour = Number(m[1]) % 12 + (m[2].toLowerCase() === 'pm' ? 12 : 0)
  } else if ((m = /\b(noon|midday)\b/i.exec(text))) {
    hour = 12
  } else if ((m = /\bat\s+(\d{1,2})\b/i.exec(text))) {
    hour = Number(m[1])
    if (/\b(tonight|evening|afternoon)\b/i.test(text) && hour < 12) hour += 12
  }
  if (hour !== null) matched = true
  else if (matched) hour = /\bmorning\b/i.test(text) ? 9 : /\bafternoon\b/i.test(text) ? 15 : 20
  if (!matched) return null
  date.setHours(hour, minute, 0, 0)
  return date
}

/**
 * 从一句话里解析日期时间。没有汉字时按英文认。
 * @param {string} text - 输入。
 * @param {Date} now - 当前时间。
 * @returns {Date|null} 解析结果；没有日期线索时返回 null。
 */
export function parseWhen(text, now = new Date()) {
  if (!/[\u4e00-\u9fff]/.test(text)) return parseWhenEn(text, now)
  const date = new Date(now)
  let matched = false
  let m
  if (/大后天/.test(text)) { date.setDate(date.getDate() + 3); matched = true }
  else if (/后天/.test(text)) { date.setDate(date.getDate() + 2); matched = true }
  else if (/明天|明晚|明早/.test(text)) { date.setDate(date.getDate() + 1); matched = true }
  else if (/今天|今晚|今早/.test(text)) { matched = true }
  else if ((m = /(下下|下)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(text))) {
    const target = WEEK[m[2]]
    const current = date.getDay()
    let delta = (target - current + 7) % 7
    if (m[1] === '下') delta = ((target + 6) % 7) + (7 - ((current + 6) % 7))
    else if (m[1] === '下下') delta = ((target + 6) % 7) + (14 - ((current + 6) % 7))
    else if (delta === 0) delta = 7
    date.setDate(date.getDate() + delta)
    matched = true
  } else if ((m = /(?:(\d{1,2})\s*月\s*)(\d{1,2})\s*[日号]?/.exec(text))) {
    date.setMonth(Number(m[1]) - 1, Number(m[2]))
    if (date < now) date.setFullYear(date.getFullYear() + 1)
    matched = true
  } else if ((m = /(\d{1,2})\s*[日号]/.exec(text))) {
    date.setDate(Number(m[1]))
    if (date < now) date.setMonth(date.getMonth() + 1)
    matched = true
  } else if ((m = /(\d+)\s*天后/.exec(text))) {
    date.setDate(date.getDate() + Number(m[1]))
    matched = true
  }

  let hour = null
  let minute = 0
  if ((m = /(\d{1,2})[:：](\d{2})/.exec(text))) {
    hour = Number(m[1])
    minute = Number(m[2])
  } else if ((m = /(\d{1,2}|十[一二]?|[一两二三四五六七八九])\s*点\s*(半|一刻|\d{1,2}分?)?/.exec(text))) {
    hour = /\d/.test(m[1]) ? Number(m[1]) : CN_DIGIT[m[1]]
    if (m[2] === '半') minute = 30
    else if (m[2] === '一刻') minute = 15
    else if (m[2]) minute = parseInt(m[2], 10)
  }
  const evening = /晚上|今晚|明晚|下午|傍晚|夜里/.test(text)
  if (hour !== null) {
    if (evening && hour < 12) hour += 12
    matched = true
  } else if (matched) {
    hour = /早|上午/.test(text) ? 9 : /中午/.test(text) ? 12 : evening ? 20 : 20
  }
  if (!matched) return null
  date.setHours(hour, minute, 0, 0)
  return date
}

const STOP_WORDS = new Set(['this', 'that', 'with', 'from', 'into', 'about', 'please', 'schedule', 'tomorrow', 'tonight', 'write', 'script', 'delete', 'remove', 'rename', 'title', 'mark', 'make'])

/** 英文按单词算重合，不用二元组，免得 to、in 这类字母组合误中。 */
function wordScore(item, query) {
  const title = item.title.toLowerCase()
  return query.toLowerCase().split(/[^a-z0-9']+/).filter(word => word.length >= 4 && !STOP_WORDS.has(word) && title.includes(word)).length
}

function score(item, query) {
  const title = item.title.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return 0
  if (title === q) return 1000
  if (title.includes(q)) return 500 + q.length
  let hits = 0
  // 中文没有空格分词，用二元组做模糊匹配
  for (let i = 0; i < q.length - 1; i += 1) if (title.includes(q.slice(i, i + 2))) hits += 1
  return hits
}

/** 优先用书名号里的名字，其次用当前选中的卡片，最后做模糊匹配。 */
function resolveItem(state, text, focusId) {
  const quoted = /[《「“"]([^》」”"]+)[》」”"]/.exec(text)
  if (quoted) {
    const best = [...state.items].sort((a, b) => score(b, quoted[1]) - score(a, quoted[1]))[0]
    if (best && score(best, quoted[1]) > 0) return best
    return null
  }
  if ((/这[篇个条张]|它|当前/.test(text) || /\b(this|it|current)\b/i.test(text)) && focusId) return state.items.find(i => i.id === focusId) ?? null
  if (!/[\u4e00-\u9fff]/.test(text)) {
    const best = [...state.items].sort((a, b) => wordScore(b, text) - wordScore(a, text))[0]
    if (best && wordScore(best, text) >= 2) return best
    return focusId ? state.items.find(i => i.id === focusId) ?? null : null
  }
  const best = [...state.items].sort((a, b) => score(b, text) - score(a, text))[0]
  if (best && score(best, text) >= 3) return best
  return focusId ? state.items.find(i => i.id === focusId) ?? null : null
}

function agenda(state, now) {
  const upcoming = state.items
    .filter(i => i.scheduledAt && new Date(i.scheduledAt) >= now && i.status !== 'published')
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    .slice(0, 5)
  if (!upcoming.length) return tr('接下来没有排期的内容。')
  return `${tr('接下来的排期：')}\n${upcoming.map(i => `· ${fmtWhen(i.scheduledAt)} ${platformName(i.platform) ?? ''} ${tr('《{title}》', { title: i.title })}`).join('\n')}`
}

/**
 * @param {object} state - 当前状态。
 * @param {string} message - 用户输入。
 * @param {{focusId?: string, now?: Date}} [options]
 * @returns {{reply: string, ops: Array<object>, actions?: Array<object>}} 回复与待执行操作。
 */
export function localIntent(state, message, { focusId, now = new Date() } = {}) {
  const text = message.trim()
  let m

  if ((/排期|安排|日程|接下来|这周.*(发|写)/.test(text) && !/把|排到|改到|挪到/.test(text))
    || (/\b(schedule|agenda|calendar|upcoming|coming up)\b/i.test(text) && /^(what|what's|whats|show|list|my|any|see)\b|^(schedule|agenda|calendar|upcoming)\??$/i.test(text))) {
    return { reply: agenda(state, now), ops: [] }
  }
  m = /^(?:帮我)?(?:记一下|记下来|记下|记个|记|存一下|存|收藏|新灵感|加一个灵感|加个灵感|灵感)[：:，,\s]*(.+)$/s.exec(text)
    ?? /^(?:note|jot(?: down)?|save|new idea|add (?:an )?idea|idea)\s*[:：,-]\s*(.+)$/is.exec(text)
  if (m) {
    return { reply: tr('记下了，已经放到灵感墙上。'), ops: [{ op: 'add_item', kind: 'note', body: m[1].trim(), title: m[1].trim().split(/[。！？\n]|[.!?](?:\s|$)/)[0].slice(0, 40) }] }
  }
  const ruleZh = /(?:以后|今后|记住|标准|规则)[：:，,\s]*(.+)$/.exec(text)
  m = (ruleZh && !/排|改成/.test(text) ? ruleZh : null)
    ?? /^(?:from now on|going forward|always|rule|remember)\s*[:：,-]?\s+(.+)$/is.exec(text)
  if (m) {
    return { reply: tr('记住了，先作为待确认的规则放进 Skills。'), ops: [{ op: 'add_skill', name: m[1].trim().slice(0, 18), rule: m[1].trim(), source: tr('对话'), status: 'proposed', confidence: 0.6 }] }
  }

  const item = resolveItem(state, text, focusId)

  // 英文的 move/set 也可能是改状态，带上能认出的时间才算排期
  if (/排到|排在|安排到|改到|挪到|放到|发布时间|定在/.test(text) || /^schedule\b/i.test(text) || (/^(?:move|put|set|publish|post)\b/i.test(text) && parseWhen(text, now))) {
    const when = parseWhen(text, now)
    if (!when) return { reply: tr('没听出具体时间，可以说「明晚 8 点」或「11月3日 20:00」。'), ops: [] }
    if (!item) return { reply: tr('没找到要排期的内容，可以用《标题》告诉我是哪一篇。'), ops: [] }
    const word = /\b(wechat channels|wechat|xiaohongshu|rednote|douyin|bilibili|channels|tiktok|instagram|ig|youtube|twitter)\b/i.exec(text)?.[1]?.replace(/\s+/g, ' ')
    const platform = word ? PLATFORM_WORDS[word.toLowerCase()] : ['公众号', '小红书', '抖音', 'B站', '视频号', 'TikTok', 'Instagram', 'YouTube', 'X'].find(p => p.length > 1 && text.toLowerCase().includes(p.toLowerCase())) ?? (/\bon X\b/.test(text) ? 'X' : undefined)
    return { reply: tr('排好了。'), ops: [{ op: 'schedule_item', id: item.id, scheduledAt: when.toISOString(), ...(platform ? { platform } : {}) }] }
  }
  if (/写成|成文|成稿|写一篇|生成文章|生成脚本|成脚本|写脚本|分镜|配图/.test(text) || /\b(?:write|turn|make|produce|draft)\b.*\b(?:script|article|post|storyboard|figures?)\b|^(?:produce|write)(?: it| this)?\b|\bstoryboard\b/i.test(text)) {
    if (!item) return { reply: tr('告诉我要写哪一条，比如：把《标题》成稿。'), ops: [] }
    return { reply: tr('开始做《{title}》。', { title: item.title }), ops: [], actions: [{ type: 'produce', id: item.id }] }
  }
  const EN_STATUS = /\b(?:mark|set|change|move)\b.*\b(?:as|to)\s+(?:an?\s+)?(idea|outline|draft|ready|published)\b/i.exec(text)
  if ((m = /(?:状态)?(?:改成|改为|标记为|设为|变成)\s*(灵感|大纲|草稿|待发布|已发布)/.exec(text)) || EN_STATUS) {
    if (!item) return { reply: tr('没找到这篇内容，可以用《标题》告诉我。'), ops: [] }
    return { reply: tr('改好了。'), ops: [{ op: 'set_status', id: item.id, status: m ? STATUS_WORDS[m[1]] : EN_STATUS[1].toLowerCase() }] }
  }
  if ((m = /(?:标题)?(?:改成|改为)[《「“"]?([^》」”"]+)[》」”"]?$/.exec(text)) && item) {
    return { reply: tr('改好了。'), ops: [{ op: 'update_item', id: item.id, title: m[1].trim() }] }
  }
  // 英文里引号包的是新标题，不是要改的那篇，所以优先用当前选中的
  if ((m = /^(?:rename|retitle)(?:\s+(?:it|this))?(?:\s+to)?\s*[“"]?([^”"]+?)[”"]?$|\btitle to\s*[“"]?([^”"]+?)[”"]?$/i.exec(text))) {
    const target = (focusId ? state.items.find(i => i.id === focusId) : null) ?? item
    if (target) return { reply: tr('改好了。'), ops: [{ op: 'update_item', id: target.id, title: (m[1] ?? m[2]).trim() }] }
  }
  if ((/删除|删掉/.test(text) || /^(?:delete|remove)\b/i.test(text)) && item) {
    return { reply: tr('删掉了，可以随时撤销。'), ops: [{ op: 'delete_item', id: item.id }] }
  }
  const counts = STATUSES.map(s => state.items.filter(i => i.status === s).length)
  return {
    reply: tr('这句话我用本地规则没听懂。现在有 {ideas} 个灵感、{drafts} 篇草稿。连接模型后可以处理任意说法；现在可以试试「记一下：……」「把《标题》排到明晚 8 点」「把《标题》成稿」。', { ideas: counts[0], drafts: counts[2] }),
    ops: [],
  }
}
