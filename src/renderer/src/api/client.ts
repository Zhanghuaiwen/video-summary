import type {
  AppConfig,
  CreateProjectInput,
  DialogResult,
  ImportResult,
  IpcResult,
  MindMapDoc,
  MindMapExportFormat,
  ProgressPayload,
  ProjectSearchHit,
  ProjectUpdatedPayload,
  SaveMindMapInput
} from '@shared/types'

async function invoke<T>(fn: () => Promise<IpcResult<T>>): Promise<T> {
  const res = await fn()
  if (!res.ok) throw new Error(res.error ?? '未知错误')
  return res.data as T
}

export const client = {
  appInfo: () => invoke(() => window.api.appInfo()),
  getConfig: () => invoke(() => window.api.getConfig()),
  setConfig: (patch: Partial<AppConfig>) => invoke(() => window.api.setConfig(patch)),
  saveRecentPrompt: (prompt: string) => invoke(() => window.api.saveRecentPrompt(prompt)),
  pickVideo: () => invoke(() => window.api.pickVideo()),
  listProjects: () => invoke(() => window.api.listProjects()),
  createProject: (input: CreateProjectInput) => invoke(() => window.api.createProject(input)),
  deleteProject: (id: string) => invoke(() => window.api.deleteProject(id)),
  startProject: (id: string) => invoke(() => window.api.startProject(id)),
  cancelProject: (id: string) => invoke(() => window.api.cancelProject(id)),
  getTranscript: (id: string) => invoke(() => window.api.getTranscript(id)),
  getSummary: (id: string) => invoke(() => window.api.getSummary(id)),
  getVision: (id: string) => invoke(() => window.api.getVision(id)),
  openFolder: (id: string) => invoke(() => window.api.openFolder(id)),
  playMedia: (id: string) => invoke(() => window.api.playMedia(id)),

  mindmapGet: (id: string) => invoke(() => window.api.mindmapGet(id)),
  mindmapSave: (input: SaveMindMapInput) => invoke(() => window.api.mindmapSave(input)),
  mindmapExport: (input: { projectId: string; format: MindMapExportFormat }) =>
    invoke(() => window.api.mindmapExport(input)),
  mindmapImport: (projectId: string) => invoke(() => window.api.mindmapImport(projectId)),
  mindmapRegenerate: (projectId: string) => invoke(() => window.api.mindmapRegenerate(projectId)),
  mindmapRecent: () => invoke(() => window.api.mindmapRecent()),

  searchProjects: (query: string): Promise<ProjectSearchHit[]> => invoke(() => window.api.searchProjects(query)),

  onProgress: (cb: (payload: ProgressPayload) => void): (() => void) => window.api.onProgress(cb),

  onProjectUpdated: (cb: (payload: ProjectUpdatedPayload) => void): (() => void) =>
    window.api.onProjectUpdated(cb)
}

export type { DialogResult, ImportResult, MindMapDoc }