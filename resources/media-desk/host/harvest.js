// 抓取网页和个人主页的公开信息。只读公开 HTML，不登录，也不绕过平台限制。
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { tr } from './i18n.js'

const MAX_BYTES = 1_500_000
const TIMEOUT_MS = 8000
const MAX_REDIRECTS = 4

function isPrivateAddress(address) {
  if (address === '::1' || address === '::') return true
  const lower = address.toLowerCase()
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true
  let v4 = lower.startsWith('::ffff:') ? lower.slice(7) : lower
  // URL 解析器会把 ::ffff:127.0.0.1 规范化成 ::ffff:7f00:1
  const mapped = /^([\da-f]{1,4}):([\da-f]{1,4})$/.exec(v4)
  if (mapped) {
    const high = parseInt(mapped[1], 16)
    const low = parseInt(mapped[2], 16)
    v4 = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
  }
  if (isIP(v4) !== 4) return false
  const [a, b] = v4.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** 粘贴的链接可能来自任何地方，不能让它访问本机或内网服务。 */
export async function assertPublicUrl(raw) {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(tr('只支持 http 和 https 链接'))
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error(tr('不能抓取本机地址'))
  const records = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (records.some(record => isPrivateAddress(record.address))) throw new Error(tr('不能抓取内网地址'))
  return url
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => named[name.toLowerCase()] ?? all)
    .trim()
}

function meta(html, names) {
  for (const name of names) {
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)
    if (a?.[1]) return decodeEntities(a[1])
    const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i').exec(html)
    if (b?.[1]) return decodeEntities(b[1])
  }
  return null
}

function followerHint(text) {
  const m = /([\d.,]+)\s*(万|千|k|K|m|M)?\s*(?:粉丝|关注者|followers)/.exec(text) ?? /(?:粉丝|followers)[^\d]{0,6}([\d.,]+)\s*(万|千|k|K|m|M)?/.exec(text)
  if (!m) return null
  const unit = { 万: 1e4, 千: 1e3, k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[m[2]] ?? 1
  const value = Number(m[1].replace(/,/g, '')) * unit
  return Number.isFinite(value) ? Math.round(value) : null
}

async function fetchPublic(raw, fetchImpl) {
  let current = raw
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertPublicUrl(current)
    const res = await fetchImpl(url, {
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', accept: 'text/html,application/xhtml+xml', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), url).toString()
      continue
    }
    return { res, url }
  }
  throw new Error(tr('跳转次数过多'))
}

async function readHtml(raw, fetchImpl) {
  const { res, url } = await fetchPublic(raw, fetchImpl)
  if (!res.ok) throw new Error(tr('页面返回 {status}，可能需要登录或被平台拦截', { status: res.status }))
  const type = res.headers.get('content-type') || ''
  if (!/html|xml/i.test(type)) throw new Error(tr('这不是网页（{type}）', { type: type || tr('未知类型') }))
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => {})
  return { html: Buffer.concat(chunks).toString('utf8'), url }
}

/**
 * 抓一个公开页面的正文，用来提炼风格。
 * @param {string} raw - 页面地址。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{url: string, title: string|null, text: string}>} 页面文字。
 */
export async function harvestText(raw, fetchImpl = fetch) {
  const { html, url } = await readHtml(raw, fetchImpl)
  const title = meta(html, ['og:title']) ?? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '')
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(body).split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length > 8).join('\n')
  return { url: url.toString(), title: title || null, text }
}

/**
 * 读取一个公开页面的标题、简介、封面和可见的粉丝数。
 * @param {string} raw - 页面地址。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{url: string, title: string|null, description: string|null, image: string|null, siteName: string|null, followers: number|null}>} 页面信息。
 */
export async function harvest(raw, fetchImpl = fetch) {
  const { html, url } = await readHtml(raw, fetchImpl)
  const title = meta(html, ['og:title', 'twitter:title']) ?? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '')
  const description = meta(html, ['og:description', 'description', 'twitter:description'])
  let image = meta(html, ['og:image', 'twitter:image', 'og:image:url'])
  if (image) {
    try {
      image = new URL(image, url).toString()
      if (!/^https?:/.test(image)) image = null
    } catch {
      image = null
    }
  }
  const siteName = meta(html, ['og:site_name']) ?? url.hostname.replace(/^www\./, '')
  return { url: url.toString(), title: title || null, description, image, siteName, followers: followerHint(`${description ?? ''} ${html.slice(0, 200000).replace(/<[^>]+>/g, ' ')}`) }
}
