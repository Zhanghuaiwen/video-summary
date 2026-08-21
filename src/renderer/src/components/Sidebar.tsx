import { useAppStore, type PageKey } from '@/store/appStore'
import { client } from '@/api/client'
import { applyAccent } from '@/App'
import {
  IconFileText,
  IconFolderOpen,
  IconGitBranch,
  IconLogo,
  IconMoon,
  IconNewDoc,
  IconSettings,
  IconSun
} from '@/components/icons'

const NAV_ITEMS: { key: PageKey; label: string; icon: (cls?: string) => React.JSX.Element }[] = [
  { key: 'home', label: '新建', icon: (cls = 'h-4 w-4 shrink-0') => <IconNewDoc className={cls} /> },
  { key: 'library', label: '项目库', icon: (cls = 'h-4 w-4 shrink-0') => <IconFolderOpen className={cls} /> },
  { key: 'doc', label: '总结文档', icon: (cls = 'h-4 w-4 shrink-0') => <IconFileText className={cls} /> },
  { key: 'mindmap', label: '思维导图', icon: (cls = 'h-4 w-4 shrink-0') => <IconGitBranch className={cls} /> }
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
      <div className="flex items-center gap-3 px-5 pb-6 pt-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-[0_6px_16px_-6px_var(--accent-glow)] [background-image:var(--accent-gradient)]">
          <IconLogo className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight text-[var(--text-strong)]">Video Summary</div>
          <div className="text-[11px] leading-tight text-[var(--text-dim)]">视频 → 知识</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => {
          const active = page === item.key
          return (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 ${
                active
                  ? 'bg-[var(--accent-bg)] font-medium text-[var(--accent-text)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full [background:var(--accent-solid)]" />
              )}
              <span className={active ? '[color:var(--accent-text)]' : '[color:var(--text-dim)] transition-colors group-hover:[color:var(--text-muted)]'}>
                {item.icon()}
              </span>
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-[var(--border)] px-3 py-3">
        <button
          onClick={() => void toggleTheme()}
          title={config?.theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
        >
          {config?.theme === 'light' ? <IconSun className="h-3.5 w-3.5" /> : <IconMoon className="h-3.5 w-3.5" />}
          {config?.theme === 'light' ? '浅色' : '深色'}
          <span className="ml-auto text-[10px] text-[var(--text-faint)]">切换主题</span>
        </button>
        <button
          onClick={() => void toggleAccent()}
          title={config?.accent === 'blue' ? '切换到橙色强调' : '切换到蓝色强调'}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
        >
          <span className="flex h-3.5 w-3.5 items-center justify-center">
            <span className="h-2.5 w-2.5 rounded-full ring-2 ring-inset ring-white/25 [background:var(--accent-solid)]" />
          </span>
          {config?.accent === 'blue' ? '蓝色' : '橙色'}强调
          <span className="ml-auto text-[10px] text-[var(--text-faint)]">切换配色</span>
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
        >
          <IconSettings className="h-3.5 w-3.5" />
          设置
          {!configured && (
            <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-[var(--status-amber)]">
              未配置
            </span>
          )}
        </button>
        <div className="mt-1.5 px-3 text-[11px] tabular-nums text-[var(--text-faint)]">v0.1.0 · AI 驱动</div>
      </div>
    </aside>
  )
}
