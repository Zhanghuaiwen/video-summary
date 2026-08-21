import { useState } from 'react'
import { client } from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { DEFAULT_ANALYSIS_CONFIG } from '@shared/types'
import { toErrorMessage } from '@shared/errors'
import { IconAlert, IconChevronDown, IconLink, IconVideo } from '@/components/icons'

type SourceMode = 'link' | 'file'

const SOURCE_MODES: { key: SourceMode; title: string; desc: string; icon: React.JSX.Element }[] = [
  {
    key: 'link',
    title: 'B站链接',
    desc: '粘贴视频链接，自动下载并解析',
    icon: <IconLink className="h-[18px] w-[18px] shrink-0" />
  },
  {
    key: 'file',
    title: '本地文件',
    desc: '选择本地视频文件，直接解析',
    icon: <IconVideo className="h-[18px] w-[18px] shrink-0" />
  }
]

export default function HomePage(): React.JSX.Element {
  const [mode, setMode] = useState<SourceMode>('link')
  const [link, setLink] = useState('')
  const [filePath, setFilePath] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [advOpen, setAdvOpen] = useState(false)
  const [enableVision, setEnableVision] = useState(DEFAULT_ANALYSIS_CONFIG.enableVision)
  const [keyFrameInterval, setKeyFrameInterval] = useState(String(DEFAULT_ANALYSIS_CONFIG.keyFrameInterval))
  const [sceneThreshold, setSceneThreshold] = useState(String(DEFAULT_ANALYSIS_CONFIG.sceneThreshold))
  const [maxKeyFrames, setMaxKeyFrames] = useState(String(DEFAULT_ANALYSIS_CONFIG.maxKeyFrames))
  const [customPrompt, setCustomPrompt] = useState('')

  const config = useAppStore((s) => s.config)
  const setConfig = useAppStore((s) => s.setConfig)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const setProjects = useAppStore((s) => s.setProjects)
  const setSelectedProject = useAppStore((s) => s.setSelectedProject)
  const setPage = useAppStore((s) => s.setPage)

  const recentPrompts = config?.recentPrompts ?? []

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
      const prompt = customPrompt.trim()
      const project = await client.createProject({
        title: title.trim() || (mode === 'link' ? 'B站视频' : filePath.split(/[\\/]/).pop() ?? '本地视频'),
        source: mode === 'link' ? 'bilibili' : 'local',
        sourceUrl: mode === 'link' ? link.trim() : undefined,
        localPath: mode === 'file' ? filePath.trim() : undefined,
        analysisConfig: {
          enableVision,
          keyFrameInterval: Math.max(5, Math.min(600, Number(keyFrameInterval) || DEFAULT_ANALYSIS_CONFIG.keyFrameInterval)),
          sceneThreshold: Math.max(0.05, Math.min(0.9, Number(sceneThreshold) || DEFAULT_ANALYSIS_CONFIG.sceneThreshold)),
          maxKeyFrames: Math.max(4, Math.min(200, Number(maxKeyFrames) || DEFAULT_ANALYSIS_CONFIG.maxKeyFrames)),
          customPrompt: prompt || undefined
        }
      })
      if (prompt) {
        const next = await client.saveRecentPrompt(prompt)
        setConfig(next)
      }
      await client.startProject(project.id)
      const projects = await client.listProjects()
      setProjects(projects)
      setSelectedProject(project.id)
      setPage('library')
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] transition-colors focus:border-[var(--accent-border-strong)] focus:bg-[var(--surface)] focus:outline-none'

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-8 py-10">
      {!config?.apiKey && (
        <button
          onClick={() => setSettingsOpen(true)}
          className="mb-8 flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-[var(--status-amber)] transition-colors hover:bg-amber-500/20"
        >
          <IconAlert className="h-3.5 w-3.5" />
          尚未配置 API Key，点击前往「设置」填写（转写与总结都需要）
        </button>
      )}

      <h1 className="mt-2 text-center text-[32px] font-semibold leading-[1.25] tracking-tight text-balance text-[var(--text-strong)]">
        把视频，变成<span className="text-[var(--accent-solid)]">知识</span>
      </h1>
      <p className="mt-3 whitespace-nowrap text-center text-sm leading-relaxed text-[var(--text-muted2)]">
        粘贴链接或上传视频，AI 自动转写并生成摘要文档、思维导图与视觉分析
      </p>

      <div className="card-raised mt-8 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="mb-5 grid grid-cols-2 gap-2">
          {SOURCE_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => {
                setMode(m.key)
                setError(null)
              }}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150 ${
                mode === m.key
                  ? 'border-[var(--accent-border-strong)] bg-[var(--accent-bg)] shadow-[0_0_0_1px_var(--accent-border-strong)]'
                  : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border-strong)]'
              }`}
            >
              <span className={mode === m.key ? 'text-[var(--accent-text)]' : 'text-[var(--text-dim)]'}>{m.icon}</span>
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${mode === m.key ? 'text-[var(--text)]' : 'text-[var(--text-body)]'}`}>
                  {m.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted2)]">{m.desc}</span>
              </span>
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
              className="flex shrink-0 items-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-border)] hover:text-[var(--text)]"
            >
              <IconVideo className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
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

        {/* 高级分析选项 */}
        <button
          onClick={() => setAdvOpen((v) => !v)}
          className="mt-4 flex items-center gap-1.5 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          <IconChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${advOpen ? '' : '-rotate-90'}`} />
          高级分析选项
        </button>

        {advOpen && (
          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-4">
            <label className="flex cursor-pointer items-center justify-between text-xs text-[var(--text-muted)]">
              <span>视觉分析（关键帧 + 画面 OCR + 视觉理解）</span>
              <input
                type="checkbox"
                checked={enableVision}
                onChange={(e) => setEnableVision(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent-solid)]"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">关键帧采样间隔（秒）</label>
                <input
                  value={keyFrameInterval}
                  onChange={(e) => setKeyFrameInterval(e.target.value)}
                  type="number"
                  min={5}
                  max={600}
                  className={`${inputCls} px-3 py-2`}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">场景变化阈值（0.05~0.9）</label>
                <input
                  value={sceneThreshold}
                  onChange={(e) => setSceneThreshold(e.target.value)}
                  type="number"
                  min={0.05}
                  max={0.9}
                  step={0.05}
                  className={`${inputCls} px-3 py-2`}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                  最多关键帧数（控制 OCR/画面分析数量，越少越快）
                </label>
                <input
                  value={maxKeyFrames}
                  onChange={(e) => setMaxKeyFrames(e.target.value)}
                  type="number"
                  min={4}
                  max={200}
                  className={`${inputCls} px-3 py-2`}
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                自定义分析要求（可选，贯穿 视觉 / 总结 / 思维导图）
              </label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={2}
                placeholder="例如：这是面向初学者的教程，重点总结实现步骤与代码要点..."
                className={`${inputCls} resize-none`}
              />
              {recentPrompts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {recentPrompts.map((p) => (
                    <button
                      key={p}
                      onClick={() => setCustomPrompt(p)}
                      className="max-w-56 truncate rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-muted2)] transition-colors hover:border-[var(--accent-border)] hover:text-[var(--text-hover)]"
                      title={p}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-[var(--status-rose)]">
            <IconAlert className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={() => void submit()}
          disabled={busy}
          className="mt-5 w-full rounded-xl py-3 text-sm font-semibold tracking-wide text-white shadow-[0_10px_24px_-8px_var(--accent-glow)] transition-all duration-150 [background-image:var(--accent-gradient)] hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {busy ? '创建中…' : '开始解析'}
        </button>
      </div>
    </div>
  )
}