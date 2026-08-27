import { useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import SettingsModal from '@/components/SettingsModal'
import HomePage from '@/pages/HomePage'
import LibraryPage from '@/pages/LibraryPage'
import DocPage from '@/pages/DocPage'
import MindMapPage from '@/pages/MindMapPage'
import { useAppStore } from '@/store/appStore'
import { client } from '@/api/client'
import type { AccentColor } from '@shared/types'

/** 应用强调色并广播给依赖它的组件（如思维导图分支配色） */
export function applyAccent(accent: AccentColor | undefined): void {
  const next = accent === 'blue' ? 'blue' : 'orange'
  document.documentElement.dataset.accent = next
  localStorage.setItem('vs-accent', next)
  window.dispatchEvent(new CustomEvent('vs-accent', { detail: next }))
}

export default function App(): React.JSX.Element {
  const page = useAppStore((s) => s.page)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const setProjects = useAppStore((s) => s.setProjects)
  const applyProgress = useAppStore((s) => s.applyProgress)
  const applyProjectUpdated = useAppStore((s) => s.applyProjectUpdated)
  const setConfig = useAppStore((s) => s.setConfig)

  useEffect(() => {
    void client.listProjects().then(setProjects).catch(console.error)
    void client.getConfig().then((c) => {
      setConfig(c)
      document.documentElement.dataset.theme = c.theme
      localStorage.setItem('vs-theme', c.theme)
      applyAccent(c.accent)
    }).catch(console.error)
    const unsubProgress = client.onProgress(applyProgress)
    const unsubUpdated = client.onProjectUpdated(applyProjectUpdated)
    return () => {
      unsubProgress()
      unsubUpdated()
    }
  }, [setProjects, setConfig, applyProgress, applyProjectUpdated])

  return (
    <div className="flex h-full overflow-hidden bg-[var(--bg)]">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {page === 'home' && <HomePage />}
        {page === 'library' && <LibraryPage />}
        {page === 'doc' && <DocPage />}
        {page === 'mindmap' && <MindMapPage />}
      </main>
      {settingsOpen && <SettingsModal />}
    </div>
  )
}
