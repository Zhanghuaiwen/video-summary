import type { MindMapDoc, MindMapNode } from '@shared/types'
import { chatJson, type ChatOptions } from './llm'
import { sanitizeTreeNode, walk } from '@shared/mindmap-util'

export interface MindMapInput {
  title: string
  /** 带时间标记的文字稿 */
  timedTranscript: string
  /** 汇总文档（概述 + 全片要点 + 章节及其要点/子要点） */
  summaryDigest: string
  /** 画面关键帧简报（含 OCR 文字与描述），用于把画面/PPT 内容纳入导图 */
  visionBrief?: string
}

function buildPrompt(input: MindMapInput): string {
  const { title, timedTranscript, summaryDigest, visionBrief } = input
  return `你是一位资深知识整理专家。请把视频《${title}》的内容整理成一张真正有知识结构、尽量完整细致的思维导图。

输入材料：
1. 带时间标记的文字稿（[mm:ss - mm:ss] 之间是该时间段的语音内容，请据此为节点标注 start/end 时间（秒））
2. 已完成的结构化总结（概述 + 全片核心要点 + 章节，每章含要点与子要点），这是导图内容的主体，请尽量完整地纳入
3. 视频关键帧画面信息（含画面文字 OCR 与描述），请把其中有价值的内容（如 PPT 标题、公式、表格、截图文字）放入合适的分支节点

文字稿与总结：
---
${summaryDigest}

${timedTranscript}
---
${visionBrief ? `\n画面信息（关键帧 OCR 与描述）：\n${visionBrief}` : ''}

要求：
- 根节点（root）用视频主题；一级分支组织为有意义的类别（如：核心概念、核心观点/论点、知识体系、关键案例、方法步骤、结论、行动建议与延伸思考等），但必须根据本视频实际内容动态生成，不要套固定模板
- 组织 3~6 层，根下 4~10 个一级分支，父节点下 2~6 个子节点
- 内容要完整：总结中的每个章节、每个要点都应找到合适位置纳入导图（要点可作为叶子节点，要点的重要子要点可继续作为下一层）；宁可多用层级也不要遗漏内容
- 每个节点：
  - title：简洁（尽量 ≤ 30 字）
  - summary：一句话摘要（可选）
  - content：对重要知识点给出 1~2 句详细解释（可选）
  - keywords：2~6 个关键词（可选）
  - start/end：根据文字稿的时间标记推断该知识块对应的视频时间段（单位秒）；推断不出就省略
- 只输出 JSON，格式：
{"title":"主题","root":{"title":"主题","summary":"...","start":0,"end":3600,"children":[{"title":"...","summary":"...","keywords":["..."],"start":120,"end":300,"content":"...","children":[...]}]}}`
}

export async function generateMindMap(
  input: MindMapInput,
  opts: ChatOptions
): Promise<MindMapNode> {
  const data = (await chatJson(
    [{ role: 'user', content: buildPrompt(input) }],
    // 不固定 timeoutMs：走自适应超时（150s + 每 token 50ms），8192 输出约 9 分钟，避免大导图被硬编码 180s 掐断
    { ...opts, maxTokens: 8192 }
  )) as { root?: unknown }

  const root = sanitizeTreeNode(data.root, null)
  if (!root) throw new Error('思维导图生成失败：未能解析出有效结构')
  return root
}

export function createMindMapDoc(projectId: string, title: string, root: MindMapNode): MindMapDoc {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    projectId,
    title: title.trim() || '未命名视频',
    root,
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 把整棵导图节点的时间区间钳制到真实媒体时长内（防御 LLM 依据错误文字稿标签
 * 推断出超长区间，例如 40s 视频的节点被标成 0~600s）。duration<=0 时不改动。
 */
export function clampMindMapTimes(root: MindMapNode, duration: number): MindMapNode {
  if (!(duration > 0)) return root
  walk(root, (n) => {
    if (!n.timeRange) return
    const start = Math.max(0, Math.min(n.timeRange.start, duration))
    const end = Math.max(start, Math.min(n.timeRange.end, duration))
    n.timeRange = { start, end }
  })
  return root
}