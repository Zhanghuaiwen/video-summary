import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

export function ytDlpPath(): string {
  const packaged = join(process.resourcesPath, 'bin', 'yt-dlp.exe')
  if (app.isPackaged && existsSync(packaged)) return packaged
  return join(app.getAppPath(), 'resources', 'yt-dlp.exe')
}
