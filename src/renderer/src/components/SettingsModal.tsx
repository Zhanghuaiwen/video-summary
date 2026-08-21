import { useState } from 'react'
import { client } from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { DEFAULT_CONFIG, type AccentColor } from '@shared/types'
import { toErrorMessage } from '@shared/errors'
import { applyAccent } from '@/App'
import { IconCheck, IconX } from '@/components/icons'

export default function SettingsModal(): React.JSX.Element {
  const config = useAppStore((s) => s.config)
  const setConfig = useAppStore((s) => s.setConfig)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  const [apiKey, setApiKey] = useState(config?.apiKey ?? DEFAULT_CONFIG.apiKey)
  const [asrModel, setAsrModel] = useState(config?.asrModel ?? DEFAULT_CONFIG.asrModel)
  const [llmModel, setLlmModel] = useState(config?.llmModel ?? DEFAULT_CONFIG.llmModel)
  const [visionModel, setVisionModel] = useState(config?.visionModel ?? DEFAULT_CONFIG.visionModel)
  const [llmBaseUrl, setLlmBaseUrl] = useState(config?.llmBaseUrl ?? DEFAULT_CONFIG.llmBaseUrl)
  const [accent, setAccent] = useState<AccentColor>(config?.accent ?? 'orange')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const next = await client.setConfig({
        apiKey: apiKey.trim(),
        asrModel: asrModel.trim(),
        llmModel: llmModel.trim(),
        visionModel: visionModel.trim(),
        llmBaseUrl: llmBaseUrl.trim(),
        accent
      })
      setConfig(next)
      applyAccent(next.accent)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      alert(toErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent-border-strong)] focus:outline-none'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-overlay)]"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        className="card-raised w-[520px] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-tight text-[var(--text-strong)]">设置</h3>
          <button
            onClick={() => setSettingsOpen(false)}
            title="关闭设置"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">硅基流动 API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-...（在 https://siliconflow.cn 注册获取）"
              className={inputCls}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
              转写（SenseVoice）与总结（Qwen）共用此 Key，仅保存在本机，不会上传到任何第三方。
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">转写模型 (ASR)</label>
            <input value={asrModel} onChange={(e) => setAsrModel(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">总结模型 (LLM)</label>
            <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">视觉理解模型 (VL)</label>
            <input value={visionModel} onChange={(e) => setVisionModel(e.target.value)} className={inputCls} />
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
              用于关键帧的画面描述与 OCR，需为多模态模型（如 Qwen/Qwen2.5-VL-7B-Instruct）。
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">API Base URL</label>
            <input value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">强调色</label>
            <div className="flex gap-2">
              {(
                [
                  { key: 'orange', label: '橙色', swatch: '#f97316' },
                  { key: 'blue', label: '蓝色', swatch: '#3b82f6' }
                ] as { key: AccentColor; label: string; swatch: string }[]
              ).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setAccent(opt.key)}
                  aria-pressed={accent === opt.key}
                  className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    accent === opt.key
                      ? 'border-[var(--accent-border-strong)] bg-[var(--accent-bg-soft)] text-[var(--text)]'
                      : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/20" style={{ background: opt.swatch }} />
                  {opt.label}
                  {accent === opt.key && <IconCheck className="ml-auto h-3.5 w-3.5 text-[var(--accent-text)]" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <a
            href="https://siliconflow.cn"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[var(--accent-text)] hover:opacity-80"
          >
            打开硅基流动官网 →
          </a>
          <div className="flex items-center gap-3">
            {saved && <span className="text-xs text-[var(--status-emerald)]">已保存</span>}
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_var(--accent-glow)] transition-all duration-150 [background-image:var(--accent-gradient)] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
