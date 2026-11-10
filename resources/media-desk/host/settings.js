// 工作台设置。密钥和内容数据分开存放，文件权限 600，也不会返回给浏览器。
import { chmod, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tr } from './i18n.js'

const DEFAULTS = {
  image: { source: 'http', baseUrl: '', model: '', apiKey: '', size: '1536x1024', quality: '', toolSize: '1536x1024', toolQuality: '', extra: '' },
  // 助手文字模型：空对象表示跟随 DeepSeek Harness 默认模型
  assistant: { provider: '', model: '' },
  voice: '',
  exportDir: '',
  imageCount: 2,
  shotCount: 6,
  language: 'auto',
}

function clamp(value, min, max, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export class Settings {
  constructor(root) {
    this.file = join(root, 'settings.json')
    this.value = null
  }

  async read() {
    // 每次都读文件：桌面版和 Web 版可能同时运行
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'))
      this.value = { ...DEFAULTS, ...saved, image: { ...DEFAULTS.image, ...saved.image }, assistant: { ...DEFAULTS.assistant, ...(saved.assistant ?? {}) } }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      this.value = structuredClone(DEFAULTS)
    }
    return this.value
  }

  /** 空密钥表示不修改，clearKey 才会删除。 */
  async update(patch) {
    const current = await this.read()
    const next = structuredClone(current)
    const image = patch.image ?? {}
    if (image.source !== undefined) {
      if (!['http', 'tool'].includes(image.source)) throw Object.assign(new Error(tr('生图来源无效')), { status: 400 })
      next.image.source = image.source
    }
    for (const key of ['model', 'size', 'quality']) {
      if (typeof image[key] === 'string') next.image[key] = image[key].trim().slice(0, 200)
    }
    for (const [key, values, message] of [
      ['toolSize', ['', '1024x1024', '1024x1536', '1536x1024', 'auto'], '订阅生图工具不支持这个尺寸'],
      ['toolQuality', ['', 'low', 'medium', 'high', 'auto'], '订阅生图工具不支持这个质量'],
    ]) {
      if (image[key] !== undefined) {
        if (typeof image[key] !== 'string' || !values.includes(image[key].trim())) throw Object.assign(new Error(tr(message)), { status: 400 })
        next.image[key] = image[key].trim()
      }
    }
    if (typeof image.baseUrl === 'string') {
      const url = image.baseUrl.trim().replace(/\/+$/, '').replace(/\/images\/generations$/, '')
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw Object.assign(new Error(tr('接口地址要以 http:// 或 https:// 开头')), { status: 400 })
      next.image.baseUrl = url
    }
    if (typeof image.extra === 'string') {
      const extra = image.extra.trim()
      if (extra) {
        let parsed
        try {
          parsed = JSON.parse(extra)
        } catch {
          parsed = null
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error(tr('附加参数要是一个 JSON 对象')), { status: 400 })
      }
      next.image.extra = extra
    }
    if (typeof image.apiKey === 'string' && image.apiKey.trim()) next.image.apiKey = image.apiKey.trim()
    if (image.clearKey === true) next.image.apiKey = ''
    if (patch.assistant && typeof patch.assistant === 'object') {
      const provider = typeof patch.assistant.provider === 'string' ? patch.assistant.provider.trim().slice(0, 200) : ''
      const model = typeof patch.assistant.model === 'string' ? patch.assistant.model.trim().slice(0, 200) : ''
      // provider 和 model 要么都填（指定模型），要么都空（跟随默认）
      if (Boolean(provider) !== Boolean(model)) throw Object.assign(new Error(tr('助手模型的提供方和模型要一起填')), { status: 400 })
      next.assistant = { provider, model }
    }
    if (typeof patch.voice === 'string') next.voice = patch.voice.slice(0, 8000)
    if (typeof patch.exportDir === 'string') next.exportDir = patch.exportDir.trim().slice(0, 500)
    if (patch.imageCount !== undefined) next.imageCount = clamp(patch.imageCount, 0, 4, current.imageCount)
    if (['auto', 'zh', 'en'].includes(patch.language)) next.language = patch.language
    if (patch.shotCount !== undefined) next.shotCount = clamp(patch.shotCount, 0, 12, current.shotCount)
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
    this.value = next
    return next
  }
}

export function imageReady(settings, toolAvailable = false) {
  if (settings.image.source === 'tool') return toolAvailable
  return Boolean(settings.image.baseUrl && settings.image.model && settings.image.apiKey)
}

/** 发给浏览器的版本：只告诉它有没有密钥和末四位。 */
export function publicSettings(settings, toolAvailable = false) {
  const { apiKey, ...image } = settings.image
  return { ...settings, image: { ...image, hasKey: Boolean(apiKey), keyHint: apiKey ? apiKey.slice(-4) : '' }, imageToolAvailable: toolAvailable, imageReady: imageReady(settings, toolAvailable) }
}
