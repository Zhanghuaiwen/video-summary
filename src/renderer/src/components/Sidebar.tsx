import { useAppStore, type PageKey } from '@/store/appStore'
import { client } from '@/api/client'
import { applyAccent } from '@/App'

const NAV_ITEMS: { key: PageKey; label: string }[] = [
  { key: 'home', label: '新建' },
  { key: 'library', label: '项目库' },
  { key: 'doc', label: '总结文档' },
  { key: 'mindmap', label: '思维导图' }
]

export default function Sidebar(): React.JSX.Element {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const config = useAppStore((s) => s.config)
  const setConfig = useAppStore((s) => s.setConfig)

  const configured = Boolean(config?.apiKey)

  const toggleTheme = async (): Promise<void> => {
    const next = config?.theme === 'light' ? 'dark' : 'light'
    try {
      const saved = await client.setConfig({ theme: next })
      setConfig(saved)
      document.documentElement.dataset.theme = next
      localStorage.setItem('vs-theme', next)
    } catch {
      // 忽略主题保存失败
    }
  }

  const toggleAccent = async (): Promise<void> => {
    const next = config?.accent === 'blue' ? 'orange' : 'blue'
    try {
      const saved = await client.setConfig({ accent: next })
      setConfig(saved)
      applyAccent(saved.accent)
    } catch {
      // 忽略强调色保存失败
    }
  }

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white [background-image:var(--accent-gradient)]"
        >
          文
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--text)]">Video Summary</div>
          <div className="text-[11px] text-[var(--text-dim)]">视频 → 知识</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => {
          const active = page === item.key
          return (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                active
                  ? 'bg-[var(--accent-bg)] font-medium text-[var(--accent-text)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-[var(--border)] px-3 py-3">
        <button
          onClick={() => void toggleTheme()}
          title={config?.theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-3)]"
        >
          <span className="text-[var(--text-muted)]">{config?.theme === 'light' ? '☀ 浅色' : '🌙 深色'}</span>
          <span className="ml-auto text-[10px] text-[var(--text-faint)]">切换主题</span>
        </button>
        <button
          onClick={() => void toggleAccent()}
          title={config?.accent === 'blue' ? '切换到橙色强调' : '切换到蓝色强调'}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-3)]"
        >
          <span className="text-[var(--text-muted)]">
            <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle [background:var(--accent-solid)]" />
            {config?.accent === 'blue' ? '蓝色' : '橙色'}强调
          </span>
          <span className="ml-auto text-[10px] text-[var(--text-faint)]">切换配色</span>
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-3)]"
        >
          <span className="text-[var(--text-muted)]">⚙ 设置</span>
          {!configured && (
            <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-[var(--status-amber)]">
              未配置
            </span>
          )}
        </button>
        <div className="mt-1 px-2 text-[11px] text-[var(--text-faint)]">v0.1.0 · AI 驱动</div>
      </div>
    </aside>
  )
}