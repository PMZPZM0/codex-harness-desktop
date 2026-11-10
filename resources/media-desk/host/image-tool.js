// 订阅生图通过宿主公共执行接口调用，不读取登录凭证或引用订阅插件内部模块。
import { randomUUID } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { imageBuffer } from './images.js'
import { tr } from './i18n.js'
import { dshHome } from './store.js'

const NAMES = ['dsh_subscriptions_image_generate', 'image_generate']
const SIZES = ['1024x1024', '1024x1536', '1536x1024', 'auto']
const QUALITIES = ['low', 'medium', 'high', 'auto']
const MAX_BYTES = 40_000_000

/** 只检查公共注册/执行接口，不发请求。别名优先；还须由默认执行器声明可直接调用。 */
export function imageTool(ctx) {
  const tools = ctx.get('tools')
  if (typeof tools?.executable !== 'function' || typeof tools?.execute !== 'function' || typeof tools?.selectExecutor !== 'function') return null
  try {
    const executor = tools.selectExecutor()
    if (typeof executor?.describe !== 'function') return null
    for (const name of NAMES) {
      const definition = tools.executable(name)
      if (definition?.parameters?.properties?.prompt?.type !== 'string' || definition?.output?.schema?.properties?.paths?.type !== 'array') continue
      // PTC 只公布 run_code；不调用生图探测，不绕过默认执行器去执行工具体。
      if (executor.describe([definition])?.schemas?.some(schema => schema.name === name)) return { tools, name }
    }
  } catch {
    // 执行器卸载/不可用时不影响原有 HTTP 功能；调用前仍会重新检测。
  }
  return null
}

/** 只导入订阅插件生图目录下的普通图片，不把工具返回的任意路径变成文件读取接口。 */
async function readGeneratedImage(path, signal) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(tr('生图工具返回的图片路径无效'))
  const root = await realpath(join(dshHome(), 'plugins', 'subscriptions', 'images'))
  const file = await realpath(path)
  const rel = relative(root, file)
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error(tr('生图工具返回的图片路径无效'))
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error(tr('图片太大'))
    signal.throwIfAborted()
    // 有界读取：文件在检查后增长也不能无限分配内存。
    const buffer = Buffer.alloc(info.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      signal.throwIfAborted()
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== info.size) throw new Error(tr('生图工具返回的图片路径无效'))
    signal.throwIfAborted()
    return imageBuffer(buffer.subarray(0, offset))
  } finally {
    await handle.close()
  }
}

export async function generateToolImage(ctx, image, prompt, { signal } = {}) {
  try {
    const selected = imageTool(ctx)
    if (!selected) throw new Error(tr('未找到订阅生图工具，或默认执行器不支持直接调用；请检查插件和执行器后刷新工作台'))
    const args = { prompt }
    if (image.toolSize !== undefined && image.toolSize !== '') {
      if (!SIZES.includes(image.toolSize)) throw new Error(tr('订阅生图工具不支持这个尺寸'))
      args.size = image.toolSize
    }
    if (image.toolQuality !== undefined && image.toolQuality !== '') {
      if (!QUALITIES.includes(image.toolQuality)) throw new Error(tr('订阅生图工具不支持这个质量'))
      args.quality = image.toolQuality
    }
    const timeout = AbortSignal.timeout(300_000)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    combined.throwIfAborted()
    const id = `media-desk:${randomUUID()}`
    // 工作台是独立服务，无聊天 Agent、伪造会话或日志；全局执行策略仍由宿主管理。
    const batch = await selected.tools.execute({ calls: [{ type: 'tool-call', id, name: selected.name, arguments: JSON.stringify(args) }], signal: combined })
    combined.throwIfAborted()
    const result = batch.results?.find(entry => entry.callId === id)?.result
    if (result?.isError) {
      if (result.error?.info?.code === 'UNKNOWN_TOOL') throw new Error(tr('当前工具执行器不支持直接生图调用，请使用原生工具执行器或 HTTP 生图'))
      throw new Error(tr('生图工具失败：{reason}', { reason: String(result.error?.message ?? '').slice(0, 500) }))
    }
    const path = result?.value?.paths?.[0]
    if (result?.isError !== false || !path) throw new Error(tr('生图工具没有返回图片'))
    return await readGeneratedImage(path, combined)
  } catch (error) {
    // 不叠加工作台的限流重试：账号切换/刷新已由工具处理，避免重复消耗额度。
    const failure = new Error(error instanceof Error ? error.message : String(error), { cause: error })
    failure.name = error instanceof Error ? error.name : 'Error'
    failure.permanent = true
    throw failure
  }
}
