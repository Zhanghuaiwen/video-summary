import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { sanitizeTreeNode } from '@shared/mindmap-util'
import type { MindMapDoc, MindMapNode } from '@shared/types'
import { fmtTime } from './timeline'

/* ==================== 中间表示 ==================== */

export interface ImportedNode {
  title: string
  note?: string
  keywords?: string[]
  start?: number
  end?: number
  children: ImportedNode[]
}

export function toImported(node: MindMapNode): ImportedNode {
  const note = [node.summary, node.content].filter(Boolean).join('\n\n')
  return {
    title: node.title,
    note: note || undefined,
    keywords: node.keywords,
    start: node.timeRange?.start,
    end: node.timeRange?.end,
    children: (node.children ?? []).map(toImported)
  }
}

export function fromImported(n: ImportedNode): MindMapNode {
  const node = sanitizeTreeNode(
    {
      title: n.title,
      summary: n.note,
      keywords: n.keywords,
      start: n.start,
      end: n.end,
      children: n.children.map(fromImported)
    },
    null
  )
  if (!node) throw new Error('导入的数据为空')
  return node
}

export function docToImported(doc: MindMapDoc): ImportedNode {
  return toImported(doc.root)
}

/* ==================== 小型 XML 解析/序列化 ==================== */

export interface XmlElement {
  name: string
  attrs: Record<string, string>
  children: XmlElement[]
  text: string
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function unescapeXml(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlElement[] = [root]
  let i = 0
  const len = source.length
  let textBuf = ''

  const flushText = (): void => {
    if (textBuf) {
      const cur = stack[stack.length - 1]
      if (cur) cur.text += textBuf
      textBuf = ''
    }
  }

  while (i < len) {
    const c = source[i]
    if (c !== '<') {
      textBuf += c
      i++
      continue
    }
    if (source.startsWith('<!--', i)) {
      flushText()
      const end = source.indexOf('-->', i + 4)
      i = end === -1 ? len : end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', i)) {
      flushText()
      const end = source.indexOf(']]>', i + 9)
      const content = end === -1 ? source.slice(i + 9) : source.slice(i + 9, end)
      const cur = stack[stack.length - 1]
      if (cur) cur.text += content
      i = end === -1 ? len : end + 3
      continue
    }
    if (source.startsWith('<?', i) || source.startsWith('<!', i)) {
      flushText()
      const end = source.indexOf('>', i)
      i = end === -1 ? len : end + 1
      continue
    }
    const end = source.indexOf('>', i)
    if (end === -1) {
      flushText()
      break
    }
    const tag = source.slice(i + 1, end).trim()
    i = end + 1
    if (tag.startsWith('/')) {
      flushText()
      const closing = tag.slice(1).trim()
      const cur = stack[stack.length - 1]
      if (cur && cur.name === closing) stack.pop()
      continue
    }
    const selfClose = tag.endsWith('/')
    const inner = selfClose ? tag.slice(0, -1).trim() : tag
    const m = /^([\w:-]+)([\s\S]*)$/.exec(inner)
    if (!m) continue
    const attrs: Record<string, string> = {}
    let am: RegExpExecArray | null
    while ((am = ATTR_RE.exec(m[2]))) {
      attrs[am[1]] = unescapeXml(am[2] ?? am[3] ?? '')
    }
    const el: XmlElement = { name: m[1], attrs, children: [], text: '' }
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(el)
    if (!selfClose) stack.push(el)
  }
  return root
}

function firstDescendant(el: XmlElement, name: string): XmlElement | null {
  for (const c of el.children) {
    if (c.name === name) return c
    const hit = firstDescendant(c, name)
    if (hit) return hit
  }
  return null
}

function findFirstText(el: XmlElement, name: string): string {
  const hit = firstDescendant(el, name)
  return hit ? hit.text.trim() : ''
}

/* ==================== JSON ==================== */

export function serializeJson(doc: MindMapDoc): string {
  return JSON.stringify(doc, null, 2)
}

/** 解析 JSON 导入（兼容本应用导出 / 通用 {title,children} 结构） */
export function parseJson(text: string): ImportedNode {
  const data = JSON.parse(text) as Record<string, unknown>
  const root = data.root ?? data
  if (!root || typeof root !== 'object') throw new Error('JSON 中未找到节点数据')
  return importedFromRaw(root as Record<string, unknown>)
}

function importedFromRaw(raw: Record<string, unknown>): ImportedNode {
  const title = typeof raw['title'] === 'string' ? (raw['title'] as string).trim() : ''
  if (!title) throw new Error('导入的 JSON 缺少 title 字段')
  const note = (raw['summary'] ?? raw['content'] ?? raw['note']) as string | undefined
  const keywords = Array.isArray(raw['keywords']) ? (raw['keywords'] as unknown[]).filter((k): k is string => typeof k === 'string') : undefined
  const start = typeof raw['start'] === 'number' ? raw['start'] : typeof raw['timeRange'] === 'object' && raw['timeRange'] ? (raw['timeRange'] as Record<string, unknown>)['start'] as number | undefined : undefined
  const end = typeof raw['end'] === 'number' ? raw['end'] : typeof raw['timeRange'] === 'object' && raw['timeRange'] ? (raw['timeRange'] as Record<string, unknown>)['end'] as number | undefined : undefined
  const children = Array.isArray(raw['children']) ? (raw['children'] as Record<string, unknown>[]).map(importedFromRaw) : []
  return { title, note: typeof note === 'string' ? note : undefined, keywords, start, end, children }
}

/* ==================== OPML ==================== */

function opmlAttrs(n: ImportedNode): string {
  const parts = [`text="${escapeXml(n.title)}"`]
  if (n.note) parts.push(`_note="${escapeXml(n.note)}"`)
  if (n.keywords?.length) parts.push(`_keywords="${escapeXml(n.keywords.join(','))}"`)
  if (n.start !== undefined) parts.push(`_start="${n.start}"`)
  if (n.end !== undefined) parts.push(`_end="${n.end}"`)
  return parts.join(' ')
}

function opmlBody(n: ImportedNode, indent: number): string {
  const pad = '  '.repeat(indent)
  if (n.children.length === 0) return `${pad}<outline ${opmlAttrs(n)} />`
  const open = `${pad}<outline ${opmlAttrs(n)}>`
  const inner = n.children.map((c) => opmlBody(c, indent + 1)).join('\n')
  return `${open}\n${inner}\n${pad}</outline>`
}

export function serializeOpml(doc: MindMapDoc): string {
  const root = docToImported(doc)
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXml(doc.title)}</title>
  </head>
  <body>
${opmlBody(root, 1)}
  </body>
</opml>
`
}

export function parseOpml(xml: string): ImportedNode {
  const doc = parseXml(xml)
  const body = firstDescendant(doc, 'body')
  if (!body) throw new Error('OPML 文件缺少 body')
  const outlines = body.children.filter((c) => c.name === 'outline')
  if (outlines.length === 0) throw new Error('OPML 文件缺少 outline 节点')
  const parseOutline = (el: XmlElement): ImportedNode => {
    const title = el.attrs['text'] ?? ''
    if (!title) throw new Error('OPML outline 缺少 text 属性')
    const keywords = el.attrs['_keywords'] ? el.attrs['_keywords'].split(',').map((s) => s.trim()).filter(Boolean) : undefined
    const start = el.attrs['_start'] !== undefined ? Number(el.attrs['_start']) : undefined
    const end = el.attrs['_end'] !== undefined ? Number(el.attrs['_end']) : undefined
    return {
      title,
      note: el.attrs['_note'],
      keywords,
      start: Number.isFinite(start as number) ? start : undefined,
      end: Number.isFinite(end as number) ? end : undefined,
      children: el.children.filter((c) => c.name === 'outline').map(parseOutline)
    }
  }
  return parseOutline(outlines[0])
}

/* ==================== FreeMind (.mm) ==================== */

function fmNodeXml(n: ImportedNode, indent: number): string {
  const pad = '  '.repeat(indent)
  const attrs = [`TEXT="${escapeXml(n.title)}"`]
  if (n.start !== undefined && n.end !== undefined) {
    attrs.push(`START="${n.start}"`, `END="${n.end}"`)
  }
  if (n.children.length > 0) attrs.push('FOLDED="false"')
  const note = n.note
  if (note || n.keywords?.length) {
    const noteText = note || n.keywords!.join('，')
    const noteHtml = `<html><body><p>${escapeXml(noteText).replace(/\n/g, '<br/>')}</p></body></html>`
    const rich = `${pad}  <richcontent TYPE="NOTE">${noteHtml}</richcontent>`
    if (n.children.length === 0) {
      return `${pad}<node ${attrs.join(' ')}>\n${rich}\n${pad}</node>`
    }
    const inner = n.children.map((c) => fmNodeXml(c, indent + 1)).join('\n')
    return `${pad}<node ${attrs.join(' ')}>\n${rich}\n${inner}\n${pad}</node>`
  }
  if (n.children.length === 0) return `${pad}<node ${attrs.join(' ')} />`
  const inner = n.children.map((c) => fmNodeXml(c, indent + 1)).join('\n')
  return `${pad}<node ${attrs.join(' ')}>\n${inner}\n${pad}</node>`
}

export function serializeFreeMind(doc: MindMapDoc): string {
  const root = docToImported(doc)
  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0.1">
${fmNodeXml(root, 1)}
</map>
`
}

function parseFreeMindNode(el: XmlElement): ImportedNode {
  const title = unescapeXml(el.attrs['TEXT'] ?? el.attrs['text'] ?? '')
  const noteEl = firstDescendant(el, 'richcontent')
  let note = ''
  if (noteEl) {
    const body = firstDescendant(noteEl, 'body') ?? noteEl
    note = body.text.trim().replace(/<br\s*\/?>/gi, '\n').replace(/\n{2,}/g, '\n')
    note = unescapeXml(note)
  }
  const start = el.attrs['START'] !== undefined ? Number(el.attrs['START']) : undefined
  const end = el.attrs['END'] !== undefined ? Number(el.attrs['END']) : undefined
  return {
    title,
    note: note || undefined,
    start: Number.isFinite(start as number) ? start : undefined,
    end: Number.isFinite(end as number) ? end : undefined,
    children: el.children.filter((c) => c.name === 'node').map(parseFreeMindNode)
  }
}

export function parseFreeMind(xml: string): ImportedNode {
  const doc = parseXml(xml)
  const root = firstDescendant(doc, 'node')
  if (!root) throw new Error('FreeMind 文件缺少 node 节点')
  return parseFreeMindNode(root)
}

/* ==================== XMind（新版：zip + content.json） ==================== */

function importedToXmindTopic(n: ImportedNode): Record<string, unknown> {
  const topic: Record<string, unknown> = {
    id: crypto.randomUUID(),
    class: 'topic',
    title: n.title
  }
  if (n.note) topic['notes'] = { class: 'notes', plain: { content: n.note } }
  if (n.keywords?.length) topic['labels'] = n.keywords
  if (n.children.length > 0) {
    topic['children'] = { attached: n.children.map(importedToXmindTopic) }
  }
  return topic
}

export function serializeXMind(doc: MindMapDoc): Uint8Array {
  const sheetId = `sheet-${crypto.randomUUID()}`
  const rootTopic = importedToXmindTopic(docToImported(doc))
  const content = JSON.stringify(
    [
      {
        id: sheetId,
        class: 'sheet',
        title: doc.title,
        rootTopic,
        theme: { id: 'modern-0' }
      }
    ],
    null,
    2
  )
  const metadata = JSON.stringify(
    {
      creator: { name: 'Video Summary', version: '0.1.0' },
      activeSheetId: sheetId,
      title: doc.title
    },
    null,
    2
  )
  const entries = ['content.json', 'metadata.json', 'manifest.json'].map((f) => ({
    'full-path': `/${f}`,
    'media-type': 'application/json'
  }))
  const manifest = JSON.stringify({ 'file-entries': { 'content.json': entries[0], 'metadata.json': entries[1], 'manifest.json': entries[2] } }, null, 2)

  return zipSync({
    'content.json': strToU8(content),
    'metadata.json': strToU8(metadata),
    'manifest.json': strToU8(manifest)
  })
}

function xmindTopicToImported(topic: Record<string, unknown>): ImportedNode {
  const title = typeof topic['title'] === 'string' ? topic['title'] : ''
  const plain = topic['notes'] as Record<string, unknown> | undefined
  const note = plain?.plain && typeof (plain.plain as Record<string, unknown>)['content'] === 'string'
    ? ((plain.plain as Record<string, unknown>)['content'] as string)
    : undefined
  const labels = Array.isArray(topic['labels']) ? (topic['labels'] as unknown[]).filter((l): l is string => typeof l === 'string') : undefined
  const childrenObj = topic['children'] as Record<string, unknown> | undefined
  const attached = Array.isArray(childrenObj?.attached) ? childrenObj.attached as Record<string, unknown>[] : []
  return {
    title,
    note,
    keywords: labels,
    children: attached.map(xmindTopicToImported)
  }
}

export function parseXMindBytes(bytes: Uint8Array): ImportedNode {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (err) {
    throw new Error(`无法解压 XMind 文件：${err instanceof Error ? err.message : String(err)}`)
  }
  const contentFile = files['content.json']
  if (contentFile) {
    const data = JSON.parse(strFromU8(contentFile)) as Record<string, unknown>[]
    const sheet = data[0]
    const rootTopic = sheet?.rootTopic as Record<string, unknown> | undefined
    if (!rootTopic) throw new Error('XMind 文件缺少 rootTopic')
    return xmindTopicToImported(rootTopic)
  }
  const xmlFile = files['content.xml']
  if (xmlFile) return parseXMind8Xml(strFromU8(xmlFile))
  throw new Error('不支持的 XMind 文件（缺少 content.json 或 content.xml）')
}

/* ==================== XMind 8（旧版：zip + content.xml） ==================== */

export function parseXMind8Xml(xml: string): ImportedNode {
  const doc = parseXml(xml)
  const topicEl = firstDescendant(doc, 'topic')
  if (!topicEl) throw new Error('XMind 8 文件缺少 topic 节点')
  const parseTopic = (el: XmlElement): ImportedNode => {
    const title = findFirstText(el, 'title')
    const plainEl = firstDescendant(el, 'plain')
    const note = plainEl ? plainEl.text.trim() : undefined
    let children: ImportedNode[] = []
    const topics = firstDescendant(el, 'topics')
    if (topics) {
      children = topics.children.filter((c) => c.name === 'topic').map(parseTopic)
    }
    return { title, note: note || undefined, children }
  }
  return parseTopic(topicEl)
}

/* ==================== Markdown ==================== */

export function serializeMarkdown(doc: MindMapDoc): string {
  const lines: string[] = [`# ${doc.title}`, '']
  const walk = (n: ImportedNode, depth: number): void => {
    const time = n.start !== undefined && n.end !== undefined ? ` \`[${fmtTime(n.start)}-${fmtTime(n.end)}]\`` : ''
    if (depth === 0) {
      lines.push(`- ${n.title}${time}`)
    } else {
      lines.push(`${'  '.repeat(depth)}- ${n.title}${time}`)
    }
    if (n.note) {
      const noteLines = n.note.split('\n').filter(Boolean)
      lines.push(`${'  '.repeat(depth + 1)}> ${noteLines[0]}`)
      for (const extra of noteLines.slice(1)) lines.push(`${'  '.repeat(depth + 1)}> ${extra}`)
    }
    n.children.forEach((c) => walk(c, depth + 1))
  }
  walk(docToImported(doc), 0)
  return lines.join('\n') + '\n'
}

/* ==================== 格式检测 ==================== */

export type DetectedFormat = 'json' | 'opml' | 'freemind' | 'xmind' | 'xmind8'

export function detectFormat(content: string | Uint8Array): DetectedFormat {
  if (content instanceof Uint8Array) {
    if (content.length >= 4 && content[0] === 0x50 && content[1] === 0x4b) return 'xmind'
    const text = new TextDecoder().decode(content)
    return detectTextFormat(text)
  }
  return detectTextFormat(content)
}

function detectTextFormat(text: string): DetectedFormat {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  const lower = trimmed.toLowerCase()
  if (lower.includes('<opml')) return 'opml'
  if (lower.includes('<xmap-content')) return 'xmind8'
  if (lower.includes('<map')) return 'freemind'
  throw new Error('无法识别的思维导图文件格式')
}

export const EXPORT_EXTENSIONS: Record<string, string> = {
  json: '.mindmap.json',
  opml: '.opml',
  freemind: '.mm',
  xmind: '.xmind',
  markdown: '.md'
}

export const EXPORT_LABELS: Record<string, string> = {
  json: 'JSON（完整无损）',
  xmind: 'XMind',
  opml: 'OPML',
  freemind: 'FreeMind (.mm)',
  markdown: 'Markdown'
}