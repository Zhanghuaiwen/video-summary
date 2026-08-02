export type VideoSource = 'bilibili' | 'local'

export type PipelineStage =
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'summarizing'
  | 'done'
  | 'failed'

export interface Project {
  id: string
  title: string
  source: VideoSource
  sourceUrl: string | null
  localPath: string | null
  stage: PipelineStage
  progress: number
  createdAt: string
  updatedAt: string
  error?: string
  transcriptPath?: string
  summaryPath?: string
}

export interface Chapter {
  title: string
  summary: string
  points: string[]
}

export interface SummaryDoc {
  projectId: string
  title: string
  overview: string
  chapters: Chapter[]
  createdAt: string
}

export interface AppConfig {
  apiKey: string
  asrModel: string
  llmModel: string
  llmBaseUrl: string
}

export const DEFAULT_CONFIG: AppConfig = {
  apiKey: '',
  asrModel: 'FunAudioLLM/SenseVoiceSmall',
  llmModel: 'Qwen/Qwen2.5-7B-Instruct',
  llmBaseUrl: 'https://api.siliconflow.cn/v1'
}

export interface ProgressPayload {
  projectId: string
  stage: PipelineStage
  progress: number
  message?: string
}

export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

export const IpcChannels = {
  appInfo: 'app:info',
  config: {
    get: 'config:get',
    set: 'config:set'
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
    getTranscript: 'project:get-transcript',
    getSummary: 'project:get-summary'
  },
  events: {
    progress: 'project:progress'
  }
} as const
