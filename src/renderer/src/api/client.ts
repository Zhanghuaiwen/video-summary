import type {
  AppConfig,
  IpcResult,
  ProgressPayload
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
  pickVideo: () => invoke(() => window.api.pickVideo()),
  listProjects: () => invoke(() => window.api.listProjects()),
  createProject: (input: Parameters<typeof window.api.createProject>[0]) =>
    invoke(() => window.api.createProject(input)),
  deleteProject: (id: string) => invoke(() => window.api.deleteProject(id)),
  startProject: (id: string) => invoke(() => window.api.startProject(id)),
  cancelProject: (id: string) => invoke(() => window.api.cancelProject(id)),
  getTranscript: (id: string) => invoke(() => window.api.getTranscript(id)),
  getSummary: (id: string) => invoke(() => window.api.getSummary(id)),
  onProgress: (cb: (payload: ProgressPayload) => void): (() => void) => window.api.onProgress(cb)
}
