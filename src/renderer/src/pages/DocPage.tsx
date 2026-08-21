import { useEffect, useState } from "react";
import { client } from "@/api/client";
import { useAppStore } from "@/store/appStore";
import { toErrorMessage } from "@shared/errors";
import type { SummaryDoc } from "@shared/types";
import { normalizeSummaryDoc } from "@shared/summary-util";
import { IconFolderOpen, IconPlay } from "@/components/icons";

type TabKey = "summary" | "transcript";

function fmtTime2(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export default function DocPage(): React.JSX.Element {
  const selectedId = useAppStore((s) => s.selectedProjectId);
  const projects = useAppStore((s) => s.projects);
  const project = projects.find((p) => p.id === selectedId);

  const [tab, setTab] = useState<TabKey>("summary");
  const [summary, setSummary] = useState<SummaryDoc | null>(null);
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openFolder = async (id: string): Promise<void> => {
    try {
      await client.openFolder(id);
    } catch (err) {
      setError(toErrorMessage(err));
    }
  };

  const playMedia = async (id: string): Promise<void> => {
    try {
      await client.playMedia(id);
    } catch (err) {
      setError(toErrorMessage(err));
    }
  };

  useEffect(() => {
    setSummary(null);
    setTranscript("");
    setError(null);
    setTab("summary");
    if (!selectedId || !project || project.stage !== "done") return;

    setLoading(true);
    void Promise.all([
      client.getSummary(selectedId),
      client.getTranscript(selectedId),
    ])
      .then(([s, t]) => {
        setSummary(normalizeSummaryDoc(s));
        setTranscript(t);
      })
      .catch((err: unknown) => setError(toErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [selectedId, project?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
        从「项目库」选择已完成的项目查看总结文档
      </div>
    );
  }

  if (!project || project.stage !== "done") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
        {project
          ? `任务进行中（${project.stage}），完成后即可查看`
          : "项目不存在"}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
        加载中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--status-rose)]">
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="truncate text-[22px] font-semibold tracking-tight text-[var(--text-strong)]">
          {summary?.title ?? project.title}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {project.mediaPath && (
            <>
              <button
                onClick={() => void playMedia(project.id)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              >
                <IconPlay className="h-3 w-3" />
                播放视频
              </button>
              <button
                onClick={() => void openFolder(project.id)}
                title="打开项目文件夹（视频 / 转写 / 总结等）"
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              >
                <IconFolderOpen className="h-3.5 w-3.5" />
                文件夹
              </button>
            </>
          )}
          <div className="flex shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {(
              [
                ["summary", "总结"],
                ["transcript", "文字稿"],
              ] as [TabKey, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === key
                    ? "bg-[var(--accent-bg)] text-[var(--accent-text)]"
                    : "text-[var(--text-muted2)] hover:text-[var(--text)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === "summary" && summary && (
        <div className="mt-6 flex flex-col gap-5">
          <section className="card-raised overflow-hidden rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-bg-soft)] p-5">
            <div className="text-[15px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-text)]">
              核心概述
            </div>
            <p className="mt-2.5 text-[15px] leading-[1.8] text-[var(--text-body)]">
              {summary.overview}
            </p>
            {summary.takeaways && summary.takeaways.length > 0 && (
              <div className="mt-5 border-t border-[var(--accent-border)] pt-4">
                <div className="text-[15px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-text)]">
                  全片核心要点
                </div>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {summary.takeaways.map((t, ti) => (
                    <li
                      key={ti}
                      className="flex items-start gap-2.5 text-[15px] leading-[1.7] text-[var(--text-secondary)]"
                    >
                      <span className="mt-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--accent-bg)] text-[10px] font-semibold tabular-nums text-[var(--accent-text)]">
                        {ti + 1}
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {summary.chapters.map((ch, i) => (
            <section
              key={i}
              className="card-raised rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums text-white [background-image:var(--accent-gradient)]">
                  {i + 1}
                </span>
                <h3 className="min-w-0 text-base font-semibold tracking-tight text-[var(--text-strong)]">
                  {ch.title}
                </h3>
              </div>
              <p className="mt-3 text-[15px] leading-[1.75] text-[var(--text-secondary)]">
                {ch.summary}
              </p>
              {ch.points.length > 0 && (
                <ul className="mt-3.5 flex flex-col gap-2.5">
                  {ch.points.map((pt, j) => (
                    <li
                      key={j}
                      className="flex items-start gap-2.5 text-[15px] leading-[1.7] text-[var(--text-body)]"
                    >
                      <span className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-[var(--dot)]" />
                      <div className="min-w-0">
                        <div>{pt.text}</div>
                        {pt.subPoints && pt.subPoints.length > 0 && (
                          <ul className="mt-1.5 flex flex-col gap-1 pl-4">
                            {pt.subPoints.map((sp, k) => (
                              <li
                                key={k}
                                className="flex items-start gap-2 text-[13px] leading-[1.65] text-[var(--text-muted)]"
                              >
                                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[var(--dot)] opacity-70" />
                                <span>{sp}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {ch.frames && ch.frames.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {ch.frames.map((f, fi) => (
                    <figure
                      key={fi}
                      className="group overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] transition-colors hover:border-[var(--border-strong)]"
                    >
                      <div className="relative">
                        <img
                          src={`vsmedia://${project.id}/${f.path}`}
                          alt={`画面 ${f.time}s`}
                          loading="lazy"
                          className="aspect-video w-full object-cover"
                        />
                        <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white backdrop-blur-sm">
                          {fmtTime2(f.time)}
                        </span>
                      </div>
                      <figcaption className="flex flex-col gap-1 p-2.5">
                        {f.ocr && (
                          <div className="whitespace-pre-wrap text-[11px] leading-normal text-[var(--text-muted2)]">
                            {f.ocr}
                          </div>
                        )}
                        {f.visual && (
                          <div className="text-[11px] leading-snug text-[var(--text-faint)]">
                            {f.visual}
                          </div>
                        )}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {tab === "transcript" && (
        <pre className="card-raised mt-6 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm leading-[1.85] text-[var(--text-secondary)]">
          {transcript}
        </pre>
      )}
    </div>
  );
}
