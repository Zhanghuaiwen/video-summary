import { app, shell, BrowserWindow, protocol } from 'electron'
import { join, sep, extname } from 'path'
import { createReadStream, existsSync, statSync } from 'fs'
import { Readable } from 'stream'
import { registerIpc, sendProjectUpdated } from './ipc'
import { createStore, type Store } from './store'
import { getConfig } from './services/config'

const isDev = !app.isPackaged

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vsmedia',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
}

function contentTypeFor(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 自定义协议 vsmedia://<projectId>/<rel>：安全提供项目工作目录内的帧/媒体，
 * rel === 'local' 时映射到项目选择的本地视频文件（受 store 约束）。
 * 支持 HTTP Range 请求（206 Partial Content），否则 <video> 无法拖动进度条 / 跳转时间点。
 */
function registerMediaProtocol(store: Store): void {
  protocol.handle('vsmedia', async (request) => {
    try {
      const url = new URL(request.url)
      const projectId = url.hostname
      const rel = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const project = store.getProject(projectId)
      if (!project) return new Response('Not Found', { status: 404 })

      let full: string
      if (rel === 'local') {
        if (!project.localPath || !existsSync(project.localPath)) return new Response('Not Found', { status: 404 })
        full = project.localPath
      } else if (rel === 'media') {
        if (!project.mediaPath || !existsSync(project.mediaPath)) return new Response('Not Found', { status: 404 })
        full = project.mediaPath
      } else {
        const projDir = join(app.getPath('userData'), 'projects', projectId)
        full = join(projDir, rel)
        if (!full.startsWith(projDir + sep)) return new Response('Forbidden', { status: 403 })
        if (!existsSync(full)) return new Response('Not Found', { status: 404 })
      }

      const size = statSync(full).size
      const headers: Record<string, string> = {
        'Content-Type': contentTypeFor(full),
        'Accept-Ranges': 'bytes'
      }

      let status = 200
      let start = 0
      let end = size - 1
      const range = request.headers.get('range')
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (m && (m[1] !== '' || m[2] !== '')) {
          if (m[1] === '') {
            // 后缀区间 bytes=-N
            const suffix = parseInt(m[2], 10)
            start = Math.max(0, size - suffix)
            end = size - 1
          } else {
            start = Math.max(0, parseInt(m[1], 10))
            end = m[2] === '' ? size - 1 : Math.min(size - 1, parseInt(m[2], 10))
          }
          if (start > end || start >= size) return new Response('Range Not Satisfiable', { status: 416 })
          status = 206
          headers['Content-Range'] = `bytes ${start}-${end}/${size}`
        }
      }
      headers['Content-Length'] = String(end - start + 1)

      const stream = createReadStream(full, { start, end })
      const body = Readable.toWeb(stream) as unknown as ReadableStream
      return new Response(body, {
        status,
        headers,
        statusText: status === 206 ? 'Partial Content' : undefined
      })
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: getConfig().theme === 'light' ? '#f5f5f4' : '#121316',
    title: 'Video Summary',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('console-message', (_e, level, message) => {
    console.log(`[renderer:${level}] ${message}`)
  })

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer-gone]', details.reason, details.exitCode)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const store = createStore(sendProjectUpdated)
  registerMediaProtocol(store)
  registerIpc(store)

  // 启动时修复「mediaPath 指向纯音频 / 文件缺失」的历史项目：
  // 在项目目录里找到完整视频写回，避免界面播放器变成无画面的音乐
  const repaired = store.repairMediaPaths()
  if (repaired > 0) console.log(`[main] 已修复 ${repaired} 个项目缺失/错误的视频引用`)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})