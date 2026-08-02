import { useAppStore, type PageKey } from '@/store/appStore'

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

  const configured = Boolean(config?.apiKey)

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-[#1c212b] bg-[#12151b]">
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
          文
        </div>
        <div>
          <div className="text-sm font-semibold text-[#e6e8ee]">Video Summary</div>
          <div className="text-[11px] text-[#6b7280]">视频 → 知识</div>
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
                  ? 'bg-indigo-500/15 font-medium text-indigo-300'
                  : 'text-[#9aa3b2] hover:bg-[#1a1f29] hover:text-[#e6e8ee]'
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-[#1c212b] px-3 py-3">
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-[#1a1f29]"
        >
          <span className="text-[#9aa3b2]">⚙ 设置</span>
          {!configured && (
            <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
              未配置
            </span>
          )}
        </button>
        <div className="mt-1 px-2 text-[11px] text-[#5b6472]">v0.1.0 · AI 驱动</div>
      </div>
    </aside>
  )
}
