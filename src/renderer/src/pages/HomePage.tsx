import { useState } from 'react'
import { client } from '@/api/client'
import { useAppStore } from '@/store/appStore'

type SourceMode = 'link' | 'file'

const SOURCE_MODES: { key: SourceMode; title: string; desc: string }[] = [
  { key: 'link', title: 'B站链接', desc: '粘贴视频链接，自动下载并解析' },
  { key: 'file', title: '本地文件', desc: '选择本地视频文件，直接解析' }
]

export default function HomePage(): React.JSX.Element {
  const [mode, setMode] = useState<SourceMode>('link')
  const [link, setLink] = useState('')
  const [filePath, setFilePath] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const config = useAppStore((s) => s.config)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const setProjects = useAppStore((s) => s.setProjects)

  const pickFile = async (): Promise<void> => {
    const path = await client.pickVideo()
    if (path) setFilePath(path)
  }

  const submit = async (): Promise<void> => {
    setError(null)
    if (mode === 'link' && !link.trim()) {
      setError('请粘贴 B站视频链接')
      return
    }
    if (mode === 'file' && !filePath.trim()) {
      setError('请选择要解析的本地视频文件')
      return
    }

    setBusy(true)
    try {
      const project = await client.createProject({
        title: title.trim() || (mode === 'link' ? 'B站视频' : filePath.split(/[\\/]/).pop() ?? '本地视频'),
        source: mode === 'link' ? 'bilibili' : 'local',
        sourceUrl: mode === 'link' ? link.trim() : undefined,
        localPath: mode === 'file' ? filePath.trim() : undefined
      })
      await client.startProject(project.id)
      const projects = await client.listProjects()
      setProjects(projects)
      useAppStore.getState().setSelectedProject(project.id)
      useAppStore.getState().setPage('library')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-[#1c212b] bg-[#161a22] px-4 py-3 text-sm text-[#e6e8ee] placeholder:text-[#5b6472] focus:border-indigo-500/60 focus:outline-none'

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-8">
      {!config?.apiKey && (
        <button
          onClick={() => setSettingsOpen(true)}
          className="mb-8 flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300 transition-colors hover:bg-amber-500/20"
        >
          尚未配置 API Key，点击前往「设置」填写（转写与总结都需要）
        </button>
      )}

      <h1 className="text-3xl font-semibold tracking-tight text-[#f1f3f7]">把视频，变成知识</h1>
      <p className="mt-3 text-center text-sm text-[#8a93a5]">
        粘贴链接或上传视频，AI 自动转写并生成摘要文档与思维导图
      </p>

      <div className="mt-10 w-full rounded-2xl border border-[#1c212b] bg-[#12151b] p-6 shadow-xl shadow-black/20">
        <div className="mb-5 flex gap-2">
          {SOURCE_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => {
                setMode(m.key)
                setError(null)
              }}
              className={`flex-1 rounded-xl border px-4 py-3 text-left transition-colors ${
                mode === m.key
                  ? 'border-indigo-500/60 bg-indigo-500/10'
                  : 'border-[#1c212b] bg-[#161a22] hover:border-[#2a2f3a]'
              }`}
            >
              <div className="text-sm font-medium text-[#e6e8ee]">{m.title}</div>
              <div className="mt-0.5 text-[11px] text-[#8a93a5]">{m.desc}</div>
            </button>
          ))}
        </div>

        {mode === 'link' ? (
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder="例如：https://www.bilibili.com/video/BV1..."
            className={inputCls}
          />
        ) : (
          <div className="flex items-center gap-2">
            <input
              value={filePath}
              readOnly
              placeholder="尚未选择文件"
              className={`${inputCls} cursor-default`}
            />
            <button
              onClick={() => void pickFile()}
              className="shrink-0 rounded-xl border border-[#1c212b] bg-[#161a22] px-4 py-3 text-sm text-[#9aa3b2] transition-colors hover:border-[#2a2f3a] hover:text-[#e6e8ee]"
            >
              选择文件
            </button>
          </div>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题（可选，默认取视频标题）"
          className={`${inputCls} mt-3`}
        />

        {error && <div className="mt-3 text-xs text-rose-400">{error}</div>}

        <button
          onClick={() => void submit()}
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '创建中…' : '开始解析'}
        </button>
      </div>
    </div>
  )
}
