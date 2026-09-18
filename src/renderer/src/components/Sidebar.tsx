import { useState } from "react";
import { useAppStore, type PageKey } from "@/store/appStore";
import { client } from "@/api/client";
import { applyAccent } from "@/App";
import type { ProjectSearchHit, SearchLocation } from "@shared/types";
import {
  IconFileText,
  IconFolderOpen,
  IconGitBranch,
  IconLogo,
  IconMoon,
  IconNewDoc,
  IconSearch,
  IconSettings,
  IconSun,
  IconX,
} from "@/components/icons";

const NAV_ITEMS: {
  key: PageKey;
  label: string;
  icon: (cls?: string) => React.JSX.Element;
}[] = [
  {
    key: "home",
    label: "新建",
    icon: (cls = "h-4 w-4 shrink-0") => <IconNewDoc className={cls} />,
  },
  {
    key: "library",
    label: "项目库",
    icon: (cls = "h-4 w-4 shrink-0") => <IconFolderOpen className={cls} />,
  },
  {
    key: "doc",
    label: "总结文档",
    icon: (cls = "h-4 w-4 shrink-0") => <IconFileText className={cls} />,
  },
  {
    key: "mindmap",
    label: "思维导图",
    icon: (cls = "h-4 w-4 shrink-0") => <IconGitBranch className={cls} />,
  },
];

const LOCATION_LABEL: Record<SearchLocation, string> = {
  title: "标题",
  transcript: "文字稿",
  summary: "总结",
  mindmap: "导图",
};

let searchTimer: number | undefined;

function ProjectSearch(): React.JSX.Element {
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  const setPage = useAppStore((s) => s.setPage);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ProjectSearchHit[] | null>(null);
  const [open, setOpen] = useState(false);

  const run = async (query: string): Promise<void> => {
    try {
      setResults(await client.searchProjects(query));
    } catch {
      setResults([]);
    }
  };

  const onChange = (v: string): void => {
    setQ(v);
    window.clearTimeout(searchTimer);
    if (!v.trim()) {
      setResults(null);
      return;
    }
    searchTimer = window.setTimeout(() => void run(v.trim()), 300);
  };

  const goto = (h: ProjectSearchHit): void => {
    setSelectedProject(h.projectId);
    setPage(h.location === "mindmap" ? "mindmap" : "doc");
    setQ("");
    setResults(null);
    setOpen(false);
  };

  const show = open && q.trim().length > 0;

  return (
    <div className="relative px-3 pb-3">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-faint)]" />
        <input
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 150);
          }}
          placeholder="搜索总结 / 导图 / 文字稿…"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] py-1.5 pl-8 pr-7 text-xs text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[var(--accent-solid)]"
        />
        {q && (
          <button
            onClick={() => {
              setQ("");
              setResults(null);
            }}
            title="清空"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)] transition-colors hover:text-[var(--text-muted)]"
          >
            <IconX className="h-3 w-3" />
          </button>
        )}
      </div>

      {show && (
        <div className="absolute left-3 right-3 top-full z-40 mt-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl shadow-black/10 [box-shadow:var(--popover-shadow)]">
          <div className="max-h-80 overflow-y-auto p-1.5">
            {results === null && (
              <div className="px-3 py-2 text-xs text-[var(--text-faint)]">
                正在搜索…
              </div>
            )}
            {results !== null && results.length === 0 && (
              <div className="px-3 py-2 text-xs text-[var(--text-faint)]">
                未找到相关内容
              </div>
            )}
            {results?.map((h, i) => (
              <button
                key={`${h.projectId}-${i}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  goto(h);
                }}
                className="flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--surface-3)]"
              >
                <span className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium text-[var(--text-strong)]">
                    {h.title}
                  </span>
                  <span className="ml-auto shrink-0 rounded-full bg-[var(--accent-bg)] px-1.5 py-px text-[10px] font-medium text-[var(--accent-text)]">
                    {LOCATION_LABEL[h.location]}
                  </span>
                </span>
                {(h.chapterTitle || h.nodeTitle) && (
                  <span className="truncate text-[11px] text-[var(--text-dim)]">
                    {h.chapterTitle ?? h.nodeTitle}
                  </span>
                )}
                <span className="line-clamp-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                  {h.snippet}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Sidebar(): React.JSX.Element {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);

  const configured = Boolean(config?.apiKey);

  const toggleTheme = async (): Promise<void> => {
    const next = config?.theme === "light" ? "dark" : "light";
    try {
      const saved = await client.setConfig({ theme: next });
      setConfig(saved);
      document.documentElement.dataset.theme = next;
      localStorage.setItem("vs-theme", next);
    } catch {
      // 忽略主题保存失败
    }
  };

  const toggleAccent = async (): Promise<void> => {
    const next = config?.accent === "blue" ? "orange" : "blue";
    try {
      const saved = await client.setConfig({ accent: next });
      setConfig(saved);
      applyAccent(saved.accent);
    } catch {
      // 忽略强调色保存失败
    }
  };

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-3 px-5 pb-6 pt-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-[0_6px_16px_-6px_var(--accent-glow)] [background-image:var(--accent-gradient)]">
          <IconLogo className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight text-[var(--text-strong)]">
            Video Summary
          </div>
          <div className="text-[11px] leading-tight text-[var(--text-dim)]">
            视频 → 知识
          </div>
        </div>
      </div>

      <ProjectSearch />

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => {
          const active = page === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 ${
                active
                  ? "bg-[var(--accent-bg)] font-medium text-[var(--accent-text)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full [background:var(--accent-solid)]" />
              )}
              <span
                className={
                  active
                    ? "[color:var(--accent-text)]"
                    : "[color:var(--text-dim)] transition-colors group-hover:[color:var(--text-muted)]"
                }
              >
                {item.icon()}
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-[var(--border)] px-3 py-3">
        <button
          onClick={() => void toggleTheme()}
          title={
            config?.theme === "light" ? "切换到深色主题" : "切换到浅色主题"
          }
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
        >
          {config?.theme === "light" ? (
            <IconSun className="h-3.5 w-3.5" />
          ) : (
            <IconMoon className="h-3.5 w-3.5" />
          )}
          {config?.theme === "light" ? "浅色" : "深色"}
          <span className="ml-auto text-[10px] text-[var(--text-faint)]">
            切换主题
          </span>
        </button>
        <button
          onClick={() => void toggleAccent()}
          title={
            config?.accent === "blue" ? "切换到橙色强调" : "切换到蓝色强调"
          }
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
        >
          <span className="flex h-3.5 w-3.5 items-center justify-center">
            <span className="h-2.5 w-2.5 rounded-full ring-2 ring-inset ring-white/25 [background:var(--accent-solid)]" />
          </span>
          {config?.accent === "blue" ? "蓝色" : "橙色"}强调
          <span className="ml-auto text-[10px] text-[var(--text-faint)]">
            切换配色
          </span>
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
        <div className="mt-1.5 px-3 text-[11px] tabular-nums text-[var(--text-faint)]">
          v0.1.4 · Zhanghuaiwen
        </div>
      </div>
    </aside>
  );
}
