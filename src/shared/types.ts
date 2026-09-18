export type VideoSource = 'bilibili' | 'local'

export type PipelineStage =
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'analyzing'
  | 'summarizing'
  | 'mindmap'
  | 'done'
  | 'failed'

export interface AnalysisConfig {
  /** 用户自定义分析要求，贯穿 视觉/总结/思维导图 全链路 */
  customPrompt?: string
  /** 是否启用视觉分析（关键帧 + OCR + 画面描述） */
  enableVision: boolean
  /** 固定采样的时间间隔（秒），用于补充场景变化之外的帧 */
  keyFrameInterval: number
  /** 场景变化检测阈值 0~1，值越小越敏感 */
  sceneThreshold: number
  /** 用于视觉分析/OCR 的最多关键帧数（超过则均匀抽样缩减，严格控制成本与耗时） */
  maxKeyFrames: number
}

/** 断点续跑记录：各阶段是否已完成、以及完成时使用的模型（模型变更时自动重做该阶段及后续） */
export interface ProjectCheckpoint {
  asrModel?: string
  llmModel?: string
  visionModel?: string
  transcribeDone?: boolean
  visionDone?: boolean
  summaryDone?: boolean
  mindmapDone?: boolean
  /** 转写阶段检测到的真实停顿时间点（秒），用于句子级时间戳锚点；断点续跑时直接复用，避免重跑检测 */
  silenceTimes?: number[]
}

export interface Project {
  id: string
  title: string
  source: VideoSource
  sourceUrl: string | null
  localPath: string | null
  /** 实际用于分析的媒体文件（本地文件或下载产物） */
  mediaPath?: string
  stage: PipelineStage
  progress: number
  createdAt: string
  updatedAt: string
  error?: string
  /** 媒体文件 sha1，用于分析结果缓存 */
  mediaHash?: string
  analysisConfig?: AnalysisConfig
  /** 断点续跑记录（任务失败/取消后保留，点击「继续」从已完成阶段续跑） */
  checkpoint?: ProjectCheckpoint
}

export interface ChapterPoint {
  /** 要点：尽量具体（含数字、专有名词、步骤等） */
  text: string
  /** 该要点的展开细节 / 论据（加深层次） */
  subPoints?: string[]
}

/** 与章节内容相关的关键帧（OCR/画面分析结果，用于把合适的画面放进总结） */
export interface FrameRef {
  /** 帧在视频中的时间点（秒） */
  time: number
  /** 相对项目工作目录的路径，如 frames/fixed_0001.jpg */
  path: string
  /** 画面文字（OCR） */
  ocr?: string
  /** 一句话画面描述 */
  visual?: string
}

export interface Chapter {
  title: string
  summary: string
  points: ChapterPoint[]
  /** 与该章节内容直接相关的关键帧（最多若干张） */
  frames?: FrameRef[]
}

export interface SummaryDoc {
  projectId: string
  title: string
  overview: string
  /** 全片核心要点（有则渲染在概述之下） */
  takeaways?: string[]
  chapters: Chapter[]
  createdAt: string
}

export type ThemeMode = 'dark' | 'light'
export type AccentColor = 'orange' | 'blue'

export interface AppConfig {
  apiKey: string
  asrModel: string
  llmModel: string
  visionModel: string
  llmBaseUrl: string
  /** 界面主题：dark 深色（默认）/ light 浅色 */
  theme: ThemeMode
  /** 强调色主题：orange 橙（默认）/ blue 蓝 */
  accent: AccentColor
  /** 最近使用的自定义 Prompt（最多 5 条） */
  recentPrompts: string[]
}

export const DEFAULT_CONFIG: AppConfig = {
  apiKey: '',
  asrModel: 'FunAudioLLM/SenseVoiceSmall',
  llmModel: 'Qwen/Qwen2.5-7B-Instruct',
  visionModel: 'Qwen/Qwen2.5-VL-7B-Instruct',
  llmBaseUrl: 'https://api.siliconflow.cn/v1',
  theme: 'dark',
  accent: 'orange',
  recentPrompts: []
}

export const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  enableVision: true,
  keyFrameInterval: 60,
  sceneThreshold: 0.3,
  maxKeyFrames: 30
}

export interface KeyFrameInfo {
  /** 帧在视频中的时间点（秒） */
  time: number
  /** 相对项目工作目录的输出路径，如 frames/frame_00001.jpg */
  path: string
  /** 画面文字（OCR） */
  ocr?: string
  /** 一句话画面描述 */
  visual?: string
  /** 画面与语音内容的关联说明 */
  relation?: string
}

export interface TimelineSegment {
  startTime: number
  endTime: number
  transcript: string
  frameTimes: number[]
}

export interface VisionDoc {
  frames: KeyFrameInfo[]
  segments: TimelineSegment[]
  createdAt: string
}

export interface MindMapNode {
  id: string
  parentId: string | null
  title: string
  /** 一句话摘要 */
  summary?: string
  /** 详细内容（重点知识点展开） */
  content?: string
  keywords?: string[]
  /** 关联的视频时间区间（秒），点击节点可跳转 */
  timeRange?: { start: number; end: number }
  /** 与该节点内容直接相关的关键帧（自动配帧，用于在详情面板展示画面） */
  frames?: FrameRef[]
  children?: MindMapNode[]
  /** 画布布局坐标（由自动布局生成或用户拖动产生） */
  x?: number
  y?: number
  collapsed?: boolean
}

export interface MindMapDoc {
  id: string
  projectId: string
  title: string
  description?: string
  root: MindMapNode
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type MindMapExportFormat = 'json' | 'opml' | 'freemind' | 'xmind' | 'markdown'

export interface ProgressPayload {
  projectId: string
  stage: PipelineStage
  progress: number
  message?: string
}

/** 项目完整数据更新（每次 store.updateProject 后推送），用于前端实时刷新标题/媒体路径等字段 */
export interface ProjectUpdatedPayload {
  project: Project
}

export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

export interface DialogResult {
  path: string | null
  canceled: boolean
}

export interface ImportResult {
  doc: MindMapDoc
  format: string
}

export interface CreateProjectInput {
  title: string
  source: VideoSource
  sourceUrl?: string
  localPath?: string
  analysisConfig?: AnalysisConfig
}

export interface SaveMindMapInput {
  projectId: string
  doc: MindMapDoc
}

export interface ExportMindMapInput {
  projectId: string
  format: MindMapExportFormat
}

/** 全文检索命中的内容位置 */
export type SearchLocation = 'title' | 'transcript' | 'summary' | 'mindmap'

/** 全文检索结果：一次命中对应「项目 + 所在文档结构」，附一段可读摘要 */
export interface ProjectSearchHit {
  projectId: string
  title: string
  location: SearchLocation
  /** 命中文本附近的一段摘要 */
  snippet: string
  /** location === 'summary' 时，命中所在的章节标题 */
  chapterTitle?: string
  /** location === 'mindmap' 时，命中的节点标题 */
  nodeTitle?: string
}

export const IpcChannels = {
  appInfo: 'app:info',
  config: {
    get: 'config:get',
    set: 'config:set',
    recentPrompt: 'config:recent-prompt'
  },
  dialog: {
    pickVideo: 'dialog:pick-video'
  },
  project: {
    list: 'project:list',
    create: 'project:create',
    delete: 'project:delete',
    start: 'project:start',
    cancel: 'project:cancel',
    restart: 'project:restart',
    getTranscript: 'project:get-transcript',
    getSummary: 'project:get-summary',
    regenerateSummary: 'project:regenerate-summary',
    getVision: 'project:get-vision',
    getFrame: 'project:get-frame',
    openFolder: 'project:open-folder',
    playMedia: 'project:play-media'
  },
  mindmap: {
    get: 'mindmap:get',
    save: 'mindmap:save',
    export: 'mindmap:export',
    import: 'mindmap:import',
    regenerate: 'mindmap:regenerate',
    recent: 'mindmap:recent'
  },
  search: {
    query: 'search:query'
  },
  events: {
    progress: 'project:progress',
    projectUpdated: 'project:updated'
  }
} as const