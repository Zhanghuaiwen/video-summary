import { useState } from 'react'
import { client } from '@/api/client'
import { useAppStore } from '@/store/appStore'

export default function SettingsModal(): React.JSX.Element {
  const config = useAppStore((s) => s.config)
  const setConfig = useAppStore((s) => s.setConfig)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  const [apiKey, setApiKey] = useState(config?.apiKey ?? '')
  const [asrModel, setAsrModel] = useState(config?.asrModel ?? 'FunAudioLLM/SenseVoiceSmall')
  const [llmModel, setLlmModel] = useState(config?.llmModel ?? 'Qwen/Qwen2.5-7B-Instruct')
  const [llmBaseUrl, setLlmBaseUrl] = useState(config?.llmBaseUrl ?? 'https://api.siliconflow.cn/v1')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const next = await client.setConfig({ apiKey: apiKey.trim(), asrModel: asrModel.trim(), llmModel: llmModel.trim(), llmBaseUrl: llmBaseUrl.trim() })
      setConfig(next)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-[#1c212b] bg-[#161a22] px-3 py-2 text-sm text-[#e6e8ee] placeholder:text-[#5b6472] focus:border-indigo-500/60 focus:outline-none'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        className="w-[520px] rounded-2xl border border-[#1c212b] bg-[#12151b] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#f1f3f7]">设置</h3>
          <button onClick={() => setSettingsOpen(false)} className="text-[#6b7280] hover:text-[#e6e8ee]">
            ✕
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#9aa3b2]">硅基流动 API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-...（在 https://siliconflow.cn 注册获取）"
              className={inputCls}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#5b6472]">
              转写（SenseVoice）与总结（Qwen）共用此 Key，仅保存在本机，不会上传到任何第三方。
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#9aa3b2]">转写模型 (ASR)</label>
            <input value={asrModel} onChange={(e) => setAsrModel(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#9aa3b2]">总结模型 (LLM)</label>
            <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#9aa3b2]">API Base URL</label>
            <input value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <a
            href="https://siliconflow.cn"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            打开硅基流动官网 →
          </a>
          <div className="flex items-center gap-3">
            {saved && <span className="text-xs text-emerald-400">已保存</span>}
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-opacity hover:bg-indigo-400 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
