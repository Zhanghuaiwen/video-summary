import { useAppStore } from '@/store/appStore'

export default function MindMapPage(): React.JSX.Element {
  const selectedId = useAppStore((s) => s.selectedProjectId)

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#5b6472]">
        从「项目库」选择已完成的项目查看思维导图
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center text-sm text-[#5b6472]">
      W4 实现：React Flow 思维导图（项目 {selectedId}）
    </div>
  )
}
