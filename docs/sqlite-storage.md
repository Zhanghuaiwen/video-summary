# 存储层设计：SQLite + FTS5 全文检索

> 目标：把项目历史数据从 JSON 散文件迁移到单一关系型数据库，解决「文件即数据」的检索、一致性与健壮性问题，同时提供一个可直接写进简历/作品的亮点模块。

---

## 1. 目标与取舍

| 决策 | 说明 |
|---|---|
| **驱动**：`node:sqlite`（Node 22.5+ 内置，Electron 35 自带） | 零原生依赖、无需 node-gyp 重编译（`better-sqlite3` 在打包后常因 ABI 不匹配而失败）；API 小巧同步（`DatabaseSync`），主进程数据量小，同步开销可忽略 |
| **存储内容**：文字稿 / 总结 / 视觉 / 导图等**文档产物改为 DB 行里的 JSON 列** | 不再写 `transcript.txt` / `summary.json` / `vision.json` / `mindmap.json` 等散文件；媒体文件（mp4 / 音频分段 / 关键帧 jpg）仍留在磁盘，DB 只存引用路径 |
| **检索**：FTS5 虚拟表双索引 | `trigram` 支持**中文子串**检索（≥3 字符），`unicode61` 兼容英文单词/多词查询；短查询（1~2 字符）回退为脚本扫描 |
| **一致性**：单文件 + WAL | `journal_mode=WAL`、`synchronous=NORMAL`，崩溃后自恢复；`foreign_keys=ON` |

### 为什么不用更好的方式

- **`better-sqlite3`**：性能更强，但 Electron 打包需 admin 权限重编译二进制，升级 Electron/Node 易碎。
- **纯内存索引**（如 `minisearch`）：数据存文件、索引要跟随增删改维护，且历史数据（项目、缓存）仍然分散在文件系统中。
- **外置 DB 服务**（PostgreSQL 等）：「仅存本机、零安装、单文件备份」的桌面场景不需要，且违背「一切本地」的产品约束。

---

## 2. Schema（`src/main/db.ts`）

```sql
-- 项目 + 产物文档（真值来源）
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  source          TEXT NOT NULL,          -- 'bilibili' | 'local'
  source_url      TEXT,
  local_path      TEXT,
  media_path      TEXT,
  stage           TEXT NOT NULL,          -- queued/downloading/…/done/failed
  progress        REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  error           TEXT,
  media_hash      TEXT,                   -- 内容指纹（分析缓存键来源）
  analysis_config_json TEXT,              -- JSON：keyFrameInterval 等分析参数
  checkpoint_json     TEXT,               -- JSON：断点续跑（各阶段产物+所用模型）
  transcript      TEXT,                   -- 整篇文字稿
  blocks_json     TEXT,                   -- 转写分段 { asrModel, blocks[] }
  summary_json    TEXT,                   -- 总结文档
  vision_json     TEXT,                   -- 视觉分析（关键帧/时间轴）
  mindmap_json    TEXT                    -- 思维导图文档
);
CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX idx_projects_stage ON projects(stage);

-- 应用配置（API Key / 模型 / 主题 …）
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- 分析结果缓存：内容指纹命中时把文档写回项目行，避免同一视频重复消耗 API 费用
CREATE TABLE cache (
  key         TEXT PRIMARY KEY,           -- sha1(mediaHash + 模型 + 分析参数)
  transcript  TEXT,
  blocks_json TEXT,
  summary_json TEXT,
  vision_json  TEXT,
  mindmap_json TEXT,
  created_at  TEXT NOT NULL
);

-- FTS5 全文检索虚拟表（对 projects 的 title/transcript/summary/mindmap 建索引）
CREATE VIRTUAL TABLE project_fts USING fts5(
  title, transcript, summary, mindmap, project_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE project_fts_trgm USING fts5(
  title, transcript, summary, mindmap, project_id UNINDEXED,
  tokenize = 'trigram'
);
```

**索引维护**：`Store.saveTranscript/saveBlocks/saveSummary/saveVision/saveMindMap` 写列后调用 `refreshFts(id)`（DELETE 旧行 → INSERT 新行，`project_id` 为 UNINDEXED 列，用于逐行定位）；`deleteProject` 同时清空项目行、两个 FTS 行与 `projects/<id>/` 媒体目录。

---

## 3. FTS5 中文检索策略（核心设计）

### 问题

- 默认 FTS5 分词器把连续中文当作**一整个 blob 单词**，查「数据库」搜不出「MySQL 数据库优化」。
- `trigram` 分词器把文本切成 3-gram 序列，可支持**任意 ≥3 字符的中文子串**，但对 1~2 字符查询仍是「大于全部 token 无法匹配」→ 命中为 0。
- 英文（`index.html`、`SvelteKit`）用 trigram 语义不好，`unicode61` 更自然。

### 方案：双表 + 双路兜底

```
用户输入 q
  ├─ |q| ≥ 3  →
  │    候选 = project_fts_trgm MATCH '"q"'      -- 中文子串主通道
  │          ∪ project_fts       MATCH '"q"'    -- 英文单词/多词补充
  │          按 bm25() 升序，取前 80 条候选
  └─ |q| < 3 或 FTS 无命中 →
        遍历 stage=done 项目，逐文档 indexOf 扫描（本地数据量小，开销可忽略）
```

### 命中定位（`src/main/services/search.ts`）

FTS 只负责「快速筛出候选项目」（含排序），**摘要片段在 JS 层对结构化文档精确定位**，顺序：**总结（章/要点/子要点）→ 导图（节点 title/summary/content/keywords）→ 文字稿 → 标题**。返回 `ProjectSearchHit { projectId, title, location, snippet, chapterTitle?, nodeTitle? }`，`makeSnippet` 以命中点为中心截取 ±50 字摘要并压缩换行。

> 职责分离：**FTS 保证“哪里搜得快”，结构扫描保证“命中给得准”**——这也是本地全文检索和倒排索引系统的通用分工。

### bm25 排序

```sql
SELECT project_id FROM project_fts_trgm
WHERE project_fts_trgm MATCH ?        -- '"查询词"'
ORDER BY bm25(project_fts_trgm) LIMIT 80;
```

`bm25` 是关键词在文中出现频率/分布的综合评分，命中多、靠前的项目自然排到顶部。

---

## 4. 旧数据迁移（`migrateLegacyData`）

首次启动检测 `userData/store.json` 与 `config.json`：

1. 逐条 `INSERT OR IGNORE` 到 `projects`（旧 `transcriptPath/summaryPath/visionPath/mindmapPath` 指向的文件若存在，则读入对应 JSON 列）。
2. 成功后把原文件 `renameSync` 为 `store.json.legacy` / `config.json.legacy` 留档（避免数据丢失的兜底）。
3. 任一步失败都不动原文件，下次启动重试。

---

## 5. Store 接口（`src/main/store.ts`）

```ts
interface Store {
  listProjects(): Project[]
  getProject(id): Project | undefined
  createProject(input): Project
  updateProject(id, patch): void
  deleteProject(id): void
  projectWorkDir(id): string

  getTranscript / saveTranscript / getBlocks / saveBlocks   // 文字稿 + 转写分段
  getSummary / saveSummary / getVision / saveVision
  getMindMap / saveMindMap / hasMindMap
}
```

- 文档存取方法**内部自动同步 FTS 索引**，业务层（`pipeline.ts` / `ipc.ts`）完全不感知索引细节。
- `updateProject` 写列即 `updated_at=now` 并触发 `onProjectUpdated`（把完整 project 实时推给渲染层，沿用 #10 的实时推送机制）。
- 所有语句在 `createStore` 中 `prepare` 一次，查询热路径零解析开销。

---

## 6. 缓存（`cache.ts`）

- **缓存键**：`sha1(mediaHash + asrModel + llmModel + visionModel + JSON(analysisConfig))`——模型或分析参数变必然 miss。
- **命中还原**：把 cache 行的文档 JSON 写回项目列（并重置 `projectId/createdAt/updatedAt`），帧图从 `userData/cache/<key>/frames/` 目录还原，跳过整条管线直接 `done`。
- **缓存写回**：管线完成后把五份文档写入 cache 行，`saveFramesDir` 把工作目录关键帧拷入缓存目录（覆盖写）。
- 缓存损坏（JSON 解析失败）不影响分析：捕获后走全新管线。

---

## 7. 边界与已验证行为

- `node:sqlite` 在 electron-vite 构建下保持外部化（`import { DatabaseSync } from "node:sqlite"` 原样保留），运行时解析到 Electron 内置 Node，无需打包原生模块。
- `trigram` 中文检索实测：`"数据库"` → 命中，`"数据"`（2 字符）→ 0 命中（触发脚本兜底），`"优化的一"` 这类跨词子串 → 命中。
- SenseVoice 转写无词级时间戳，时间轴精度依赖 ffmpeg 静音检测，与存储层无关（见 README 排障 #12/#15）。
- 单文件备份：停止应用后直接复制 `video-summary.db`（WAL 模式下最好连同 `-wal`/`-shm` 一并复制，或用 `VACUUM INTO`）。

---

## 8. 安全与隐私

- 数据仅存本机 `userData/video-summary.db`；不含 API Key 之外的上传行为。
- API Key 存 `settings` 表明文（与应用同权限），符合 Electron 本地配置常规做法；建议后续用 `safeStorage` 加密。