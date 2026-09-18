# SQLite 技术文档：建库 · 查询 · 写代码

> 面向本仓库开发者的实操指南，讲清楚三件事：
> 1. **怎么建**——数据库在哪里、Schema 长什么样、启动时如何初始化/迁移；
> 2. **怎么查**——项目 CRUD、FTS5 全文检索、配置/缓存的 SQL 怎么写；
> 3. **怎么写代码**——通过 `Store` 接口安全读写，不手写裸 SQL。
>
> 存储层完整设计动机见 `docs/sqlite-storage.md`；本文聚焦「可复制即用的 SQL 与代码」。

---

## 1. 一句话速查

| 想干嘛 | 去哪里 | 关键句柄 |
|---|---|---|
| 拿到数据库连接 | `src/main/db.ts` | `getDb()` / `closeDb()` |
| 业务层读写项目 & 产物 | `src/main/store.ts` | `createStore(cb)` 返回的 `Store` |
| 跨项目全文检索 | `src/main/services/search.ts` | `searchProjects(query, store)` |
| 存应用配置 | `store` 上的 `getSettings/saveSettings` | `settings` 表 |
| 分析结果缓存 | `src/main/services/cache.ts` | `saveCacheDocs/loadCacheDocs` |

---

## 2. 数据库文件与连接（怎么建）

### 文件位置

```
<userData>/video-summary.vdb     // 单文件 SQLite；WAL 模式
<userData>/projects/<id>/        // 媒体(mp4) / 音频分段 / 关键帧，文件仍留磁盘
```

- `userData` 由 Electron 提供（Windows 为 `%APPDATA%/<应用名>/`），`db.ts` 里 `getDb()` 首次调用时 `mkdirSync` + `new DatabaseSync(...)` 创建。
- **零原生依赖**：用 `node:sqlite` 的 `DatabaseSync`（Electron 35 / Node 22.14 内置），不依赖 `better-sqlite3`——无需 node-gyp 重编译、FTS5 可用、打包不碎。

### 连接打开（`db.ts:getDb`）

```ts
import { DatabaseSync } from 'node:sqlite'
let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  db = new DatabaseSync(join(app.getPath('userData'), 'video-summary.db'))
  db.exec('PRAGMA journal_mode = WAL;')      // WAL：读不阻塞写
  db.exec('PRAGMA synchronous = NORMAL;')    // 崩溃自恢复、更快
  db.exec('PRAGMA foreign_keys = ON;')       // 外键约束
  migrateSchema(db)                          // 建表(IF NOT EXISTS)
  migrateLegacyData(db, dir)                 // 旧 store/config 一次性迁入
  backfillProjectDocs(db, dir)               // 旧散文件产物回填进列
  return db
}
```

### Schema（`db.ts` 的 `SCHEMA`）

```sql
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  source          TEXT NOT NULL,          -- 'bilibili' | 'local'
  source_url      TEXT,
  local_path      TEXT,
  media_path      TEXT,
  stage           TEXT NOT NULL,          -- queued/…/done/failed
  progress        REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  error           TEXT,
  media_hash      TEXT,
  analysis_config_json TEXT,
  checkpoint_json     TEXT,
  transcript      TEXT,                   -- 整篇文字稿
  blocks_json     TEXT,                   -- 转写分段 { asrModel, blocks[] }
  summary_json    TEXT,                   -- 总结文档 JSON
  vision_json     TEXT,                   -- 视觉分析 JSON
  mindmap_json    TEXT                    -- 思维导图 JSON
);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage);

-- 应用配置（单行 key-value）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 分析产物缓存（内容指纹命中时把文档写回项目，避免重复消耗 API 费用）
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  transcript TEXT, blocks_json TEXT, summary_json TEXT,
  vision_json TEXT, mindmap_json TEXT,
  created_at TEXT NOT NULL
);

-- FTS5 全文检索虚拟表（两张）
CREATE VIRTUAL TABLE IF NOT EXISTS project_fts USING fts5(
  title, transcript, summary, mindmap,
  project_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE IF NOT EXISTS project_fts_trgm USING fts5(
  title, transcript, summary, mindmap,
  project_id UNINDEXED,
  tokenize = 'trigram'
);
```

> 详见表结构请直接看 `src/main/db.ts` 的 `SCHEMA`（含索引），那是唯一真实来源。

---

## 3. 怎么查询：SQL 参考

### 3.1 项目 CRUD（`store.ts` 内部使用，可直接照抄）

**列表（按更新时间倒序）**

```sql
SELECT * FROM projects ORDER BY datetime(updated_at) DESC;
```

**按 id 取单条**

```sql
SELECT * FROM projects WHERE id = ?;
```

**新建（插入初始行）**

```sql
INSERT INTO projects(
  id, title, source, source_url, local_path, media_path, stage, progress,
  created_at, updated_at, error, media_hash, analysis_config_json, checkpoint_json
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?);
```

**更新（高频进度列）**

```sql
UPDATE projects SET
  title=?, source=?, source_url=?, local_path=?, media_path=?, stage=?, progress=?,
  updated_at=?, error=?, media_hash=?, analysis_config_json=?, checkpoint_json=?
  WHERE id=?;
```

**删除（同时清两个 FTS 行）**

```sql
DELETE FROM project_fts WHERE project_id = ?;
DELETE FROM project_fts_trgm WHERE project_id = ?;
DELETE FROM projects WHERE id = ?;
```

### 3.2 FTS5 全文检索（`services/search.ts`）

- 主查询**长度 ≥ 3 字符**才走索引（`MIN_TRIGRAM_CHARS = 3`）……中文子串靠 `trigram`（`project_fts_trgm`），英文单词/多词靠 `unicode61`（`project_fts`）。
- **短查询（< 3 字符，如「缓存」「性能」）或 FTS 无命中**时，退化为全项目扫描兜底（本地数据量小、开销可忽略）。

```ts
const phrase = `"${q.replace(/"/g, '""')}"`
const hits = getDb()
  .prepare(
    `SELECT project_id, bm25(${table}) AS r FROM ${table}
     WHERE ${table} MATCH ?
     ORDER BY r
     LIMIT 80`
  )
  .all(phrase)
```

> FTS 只负责「快速筛出候选项目 + bm25 排序」，**摘要片段在 JS 层对结构化文档精确定位**（章节/要点/导图节点），见 `search.ts` 的 `scanSummary` / `scanMindMap`。

### 3.3 配置 / 缓存查询

```sql
-- 读配置
SELECT value FROM settings WHERE key = 'app';
-- 写配置（UPSERT）
INSERT INTO settings(key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value;

-- 缓存命中（按内容指纹读五份文档）
SELECT transcript, blocks_json, summary_json, vision_json, mindmap_json
FROM cache WHERE key = ?;
```

---

## 4. 怎么写代码：Store 接口用法

> 业务层（`pipeline.ts` / `ipc.ts` / `search.ts`）**不直接写裸 SQL**，统一走 `store` 上的方法；
> 读写文档列的方法内部**自动同步 FTS 索引**（`refreshFts`），调用方完全无感知。

```ts
// 创建 store（主进程启动时一次）
const store = createStore(onProjectUpdated)

store.createProject({
  title: '…', source: 'bilibili', sourceUrl: '…',
  analysisConfig: { keyFrameInterval: 30, maxKeyFrames: 20 }
})
store.updateProject(id, { stage: 'downloading', progress: 0.4 })
store.deleteProject(id)

store.saveTranscript(id, text)      // 自动 refreshFts
store.saveBlocks(id, json)
store.saveSummary(id, doc)         // 自动 refreshFts
store.saveVision(id, doc)
store.saveMindMap(id, doc)         // 自动 refreshFts

store.getTranscript(id)
store.getSummary(id)               // 返回解析后的 SummaryDoc
store.getMindMap(id)
store.hasMindMap(id)
```

---

## 5. 常见问题排障

| 现象 | 原因 / 处理 |
|---|---|
| 改完标题搜不到 | FTS 只在 `title` 变化时重建索引（`updateProject` 内判断），进度等高频更新不碰索引——属预期。 |
| 中文 2 字符搜不到 | trigram 语义要求 ≥3 字符子串，短查询走全量扫描兜底，是设计而非 bug（见 README 排障 #12）。 |
| 需要单文件备份 | 停止应用后整页复制 DB 文件，WAL 最好连同 `-wal`/`-shm` 或用 `VACUUM INTO`。 |
| 旧版 store/config 遗留 | 启动时会自动迁移并改名为 `*.legacy`；失败保留原文件不阻塞，下次重试。 |

---

## 6. 边界与已验证行为

- `node:sqlite` 在 electron-vite 构建下保持**外部化**（`import { DatabaseSync } from "node:sqlite"` 原样保留），运行时解析到 Electron 内置 Node，无需打包原生模块。
- `trigram` 中文检索实测：`"数据库"` → 命中；`"数据"`（2 字符）→ 不命中（兜底扫描）；`"优化的一"` 这类跨词子串 → 命中。
- 句子级时间戳来自 ffmpeg 静音检测（转写无词级时间戳），与存储层无关（见 README 排障 #15）。
