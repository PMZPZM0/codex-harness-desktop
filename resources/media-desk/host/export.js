// 一键保存：把成稿写成一个普通文件夹，脚本、封面、配图和分镜都在里面。
import { existsSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { currentLang, tr } from './i18n.js'

export function defaultExportDir() {
  // 已经有中文文件夹的老用户切到英文后继续用原来的文件夹
  const zh = join(homedir(), 'Documents', '自媒体工作台')
  if (currentLang() !== 'en' || existsSync(zh)) return zh
  return join(homedir(), 'Documents', 'Media Desk')
}

export function resolveExportDir(value) {
  const dir = String(value ?? '').trim()
  if (!dir) return defaultExportDir()
  return dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir
}

function folderName(title) {
  const clean = String(title ?? '').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 60)
  return clean || tr('未命名')
}

function cell(text) {
  return String(text ?? '').replace(/\|/g, '｜').replace(/\n/g, ' ')
}

/**
 * @param {object} production - 成稿。
 * @param {{filesDir: string, exportDir: string, videoCover?: Buffer}} options - 素材目录、保存位置和合成好的视频封面。
 * @returns {Promise<{path: string, files: string[]}>} 文件夹路径和写入的文件名。
 */
export async function saveProduction(production, { filesDir, exportDir, videoCover }) {
  // 英文界面用纯 ASCII 文件名，方便在别的系统和工具里打开
  const en = currentLang() === 'en'
  const names = en
    ? { cover: 'cover-original', videoCover: 'video-cover.jpg', figure: i => `figure-${i}`, shot: n => `shot-${n}`, script: 'script.md', board: 'storyboard.md' }
    : { cover: '封面原图', videoCover: '视频封面.jpg', figure: i => `配图${i}`, shot: n => `分镜${n}`, script: '脚本.md', board: '分镜脚本.md' }
  const target = production.savedPath || join(exportDir, folderName(production.title))
  await mkdir(target, { recursive: true })
  const files = []

  const copy = async (asset, name) => {
    const match = /^media-desk\/files\/([\w.-]+)$/.exec(asset?.src ?? '')
    if (!match) return null
    const file = `${name}${extname(match[1])}`
    await copyFile(join(filesDir, match[1]), join(target, file))
    files.push(file)
    return file
  }

  const cover = await copy(production.cover, names.cover)
  if (videoCover) {
    await writeFile(join(target, names.videoCover), videoCover)
    files.push(names.videoCover)
  }
  const figures = []
  for (const [i, image] of (production.images ?? []).entries()) {
    figures.push({ image, file: await copy(image, names.figure(i + 1)) })
  }
  const shots = []
  for (const [i, shot] of (production.shots ?? []).entries()) {
    shots.push({ shot, file: await copy(shot, names.shot(String(i + 1).padStart(2, '0'))) })
  }

  // 配图放回对应小标题那一节的末尾
  const sections = String(production.article ?? '').split(/\n(?=##\s)/)
  const unplaced = []
  for (const { image, file } of figures) {
    if (!file) continue
    const line = `\n\n![${image.caption ?? ''}](${file})`
    const at = sections.findIndex(part => image.anchor && part.startsWith(`## ${image.anchor}`))
    if (at >= 0) sections[at] = `${sections[at].trimEnd()}${line}\n`
    else unplaced.push(line)
  }
  const article = `# ${production.title}\n\n${sections.join('\n')}${unplaced.join('')}\n`
  await writeFile(join(target, names.script), article)
  files.push(names.script)

  if (shots.length) {
    const seconds = value => (value === undefined || value === null ? '' : en ? `${value}s` : `${value} 秒`)
    const rows = shots.map(({ shot, file }, i) => `| ${i + 1} | ${cell(shot.shot)} | ${seconds(shot.seconds)} | ${cell(shot.visual)} | ${cell(shot.voice)} | ${file ? `![](${file})` : ''} |`)
    const heading = en ? `# ${production.title}: storyboard\n\n| Shot | Size | Length | Visual | Voice-over | Frame |` : `# ${production.title}：分镜头脚本\n\n| 镜号 | 景别 | 时长 | 画面 | 口播 | 分镜图 |`
    await writeFile(join(target, names.board), `${heading}\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`)
    files.push(names.board)
  }
  return { path: target, files }
}
