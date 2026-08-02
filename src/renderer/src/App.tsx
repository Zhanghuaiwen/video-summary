import { useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import SettingsModal from '@/components/SettingsModal'
import HomePage from '@/pages/HomePage'
import LibraryPage from '@/pages/LibraryPage'
import DocPage from '@/pages/DocPage'
import MindMapPage from '@/pages/MindMapPage'
import { useAppStore } from '@/store/appStore'
import { client } from '@/api/client'

export default function App(): React.JSX.Element {
  const page = useAppStore((s) => s.page)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const setProjects = useAppStore((s) => s.setProjects)
  const applyProgress = useAppStore((s) => s.applyProgress)
  const setConfig = useAppStore((s) => s.setConfig)

  useEffect(() => {
    void client.listProjects().then(setProjects).catch(console.error)
    void client.getConfig().then(setConfig).catch(console.error)
    const unsub = client.onProgress(applyProgress)
    return unsub
  }, [setProjects, setConfig, applyProgress])

  return (
    <div className="flex h-full overflow-hidden bg-[#0f1115]">
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
