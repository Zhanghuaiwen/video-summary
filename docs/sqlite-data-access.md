# SQLite 数据访问指南：建库 · 查询 · 写代码

> 面向开发者的实操手册。存储设计思路见 [sqlite-storage.md](./sqlite-storage.md)，
> 本文回答三个问题：**数据库是怎么建出来的（Schema）、怎么查询（SQL + FTS5 检索）、
> 业务代码怎么写（Store 接口与语句模式）**。代码事实来源：`src/main/db.ts` / `src/main/store.ts` / `src/main/services/search.ts`。

---

## 1. 一句话总览

| 你要做的事 | 去哪写 | 关键入口 |
|---|---|---|
| 看表结构 / 迁移 / 启动回填 | `src/main/db.ts` | `SCHEMA` / `migrateSchema` / `migrateLegacyData` / `backfillProjectDocs` |
| 业务层读写项目与产物 | `src/main/store.ts` | `createStore(...)` 返回的 `Store` 接口 |
| 跨项目全文检索 | `src/main/services/search.ts` | `searchProjects(query, store)` |
| 应用配置 / 缓存 / 每条 SQL 的落地 | `settings` / `cache` 表 | `getDb()`（`db.ts`） |

- **驱动**：Electron 35 内置 Node 22.14 的 `node:sqlite`（`DatabaseSync`），零原生依赖、无 node-gyp 重编译、FTS5 可用。
- **存储形态**：项目表存「元数据 + 各阶段产物 JSON 列」，文档不再落散文件；媒体文件（mp4 / 音频 / 帧图 jpg）仍留磁盘，DB 只存引用路径。
- **一致性**：单文件 `video-summary.db` + WAL（`journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`）。

---

## 2. 怎么建：Schema 与启动初始化

### 数据库文件在哪

```
$USERDATA/video-summary.db      // Electron userData 目录（Windows: %APPDATA%/video-summary/）
```

启动时 `getDb()`（`db.ts`）做四件事：开库 → `exec(SCHEMA)` 建表 → 迁移旧 JSON 数据 → 回填产物文档。

### 表结构（`db.ts` 的 `SCHEMA`）

```sql
-- 项目 + 产物文档（真值来源；每个阶段产物都是一列 JSON 字符串）
CREATE TABLE IF NOT EXISTS projects (
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
  analysis_config_json TEXT,             -- JSON：keyFrameInterval 等分析参数
  checkpoint_json     TEXT,              -- JSON：断点续跑（各阶段产物+所用模型）
  transcript      TEXT,                   -- 整篇文字稿
  blocks_json     TEXT,                   -- 转写分段 { asrModel, blocks[] }
  summary_json    TEXT,                   -- 总结文档
  vision_json     TEXT,                   -- 视觉分析（关键帧/时间轴）
  mindmap_json    TEXT                    -- 思维导图文档
);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage);

-- 应用配置（API Key / 模型 / 主题 …）：单行 key-value
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- 分析结果缓存：内容指纹命中时把文档写回项目行，避免同一视频重复消耗 API 费用
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,                   -- sha1(mediaHash + 模型 + 分析参数)
  transcript  TEXT,
  blocks_json TEXT,
  summary_json TEXT,
  vision_json  TEXT,
  mindmap_json TEXT,
  created_at  TEXT NOT NULL
);

-- FTS5 全文检索虚拟表（对 projects 的 title/transcript/summary/mindmap 建索引）
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

**索引维护**：`Store.saveTranscript/saveBlocks/saveSummary/saveVision/saveMindMap` 写列后调用 `refreshFts(id)`（DELETE 旧行 → INSERT 新行，把结构化文档先压成纯文本再进索引）；`deleteProject` 同时清空项目行、两个 FTS 行与 `projects/<id>/` 媒体目录。

> 细节：索引列 = `title / transcript / summary / mindmap` 五列，`project_id` 是 `UNINDEXED` 列（不参与分词，仅用于逐行定位后删除/更新）。

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

**更新（含高频进度列）**——注意：**只有 `title` 变化时才需要重建 FTS**，进度等高频更新不碰索引（见 `store.ts:307`）。

```sql
UPDATE projects SET
  title=?, source=?, source_url=?, local_path=?, media_path=?, stage=?, progress=?,
  updated_at=?, error=?, media_hash=?, analysis_config_json=?, checkpoint_json=?
  WHERE id=?;
```

**删除**（同时清 FTS + 磁盘工作目录）

```sql
DELETE FROM projects WHERE id = ?;
DELETE FROM project_fts WHERE project_id = ?;
DELETE FROM project_fts_trgm WHERE project_id = ?;
```

---

### 3.2 FTS5 跨项目全文检索（核心，`services/search.ts`）

#### 为什么有两张索引

- 默认 FTS5 分词器把连续中文当**一个整体 blob 单词**，查「数据库」搜不出「MySQL 数据库优化」。
- **project_fts**（`unicode61 remove_diacritics`）：英文单词/多词查询语义自然。
- **project_fts_trgm**（`trigram`）：把文本切成 ≥3 字符的 3-gram，支持**中文任意子串**（≥3 字符）——中文检索主通道。

#### 检索策略（Hybrid 双路兜底）

```
用户输入 q
  ├─ |q| ≥ 3 字符 →
  │    候选 = project_fts_trgm MATCH '"q"'      -- 中文子串主通道
  │          ∪ project_fts       MATCH '"q"'    -- 英文单词/多词补充
  │          按 bm25() 升序排序，取前 80 候选
  └─ |q| < 3 或 FTS 无命中 →
        遍历 stage=done 项目，逐文档 indexOf 扫描（本地数据量小，开销可忽略）
```

对应 SQL（每张索引表一段，`WHERE table MATCH ?`）：

```sql
SELECT project_id, bm25(project_fts_trgm) AS r FROM project_fts_trgm
WHERE project_fts_trgm MATCH ?
ORDER BY r
LIMIT 80;
```

#### 命中定位（职责分离）

FTS 只负责「快速筛出候选 + bm25 排序」；**摘要片段在 JS 层对结构化文档精确命中定位**（`scanSummary` / `scanMindMap` / `scanTranscript` / title），顺序：**总结（章/要点/子要点）→ 导图（节点 title/summary/content/keywords）→ 文字稿 → 标题**。返回 `ProjectSearchHit { projectId, title, location, snippet, chapterTitle?, nodeTitle? }`，`makeSnippet` 以命中点为中心截取 ±50 字摘要并压缩换行。

> 分工：**FTS 保证“哪里搜得快”，结构扫描保证“命中给得准”**——FTS/倒排索引只负责候选，结构化定位负责摘要的质量。

---

### 3.3 配置与缓存查询

```sql
-- 读应用配置（settings 表单 key，存 JSON 字符串）
SELECT value FROM settings WHERE key = 'app';

-- 写配置
INSERT INTO settings(key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;

-- 缓存命中（按内容指纹 key 读五份文档）
SELECT transcript, blocks_json, summary_json, vision_json, mindmap_json
FROM cache WHERE key = ?;

-- 缓存写回
INSERT INTO cache(key, transcript, blocks_json, summary_json, vision_json, mindmap_json, created_at)
VALUES (?,?,?,?,?,?,?)
ON CONFLICT(key) DO UPDATE SET
  transcript=excluded.transcript, blocks_json=excluded.blocks_json,
  summary_json=excluded.summary_json, vision_json=excluded.vision_json,
  mindmap_json=excluded.mindmap_json, created_at=excluded.created_at;
```

---

## 4. 怎么写代码：Store 接口用法

> 业务层（`pipeline.ts` / `ipc.ts`）**只跟 `Store` 打交道，完全不感知 SQL/FTS 细节**——
> Store 内部自动同步索引。这是「数据访问层封装」的核心价值：调用方不写 SQL。

### 4.1 接口（`src/main/store.ts`）

```ts
interface Store {
  listProjects(): Project[]
  getProject(id): Project | undefined
  createProject(input): Project
  updateProject(id, patch): void   // patch.title 变化时内部自动 refreshFts
  deleteProject(id): void
  projectWorkDir(id): string

  getTranscript / saveTranscript / getBlocks / saveBlocks   // 文字稿 + 转写分段
  getSummary  / saveSummary  / getVision / saveVision
  getMindMap  / saveMindMap  / hasMindMap
}
```

- **写文档自动同步 FTS**：`saveTranscript / saveSummary / saveVision / saveMindMap` 内部调用 `refreshFts(id)`，业务层不感知。
- **只 title 触发索引重建**：`updateProject` 里 `if (patch.title !== undefined) refreshFts(id)`——进度等高频更新不耗尽 IO（`store.ts:307`）。
- **删除/清理一体**：`deleteProject` 清 FTS 行 + `rmSync` 项目媒体目录，避免磁盘垃圾。

### 4.2 代码模式（供业务层参考）

```ts
// 方式一：走 Store 高层接口（推荐，索引自动同步）
store.saveTranscript(id, '整篇文字稿...')
store.saveSummary(id, summaryDoc)

// 方式二：跨项目检索（services/search.ts）
searchProjects('数据库', store) // → ProjectSearchHit[]

// 方式三：需要原始 DB 时（仅限 main 进程）
import { getDb } from './db'
getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id)
```

---

## 5. 常见 SQL 排查速查

| 想确认的事 | 查法 |
|---|---|
| DB 在哪 / 是否 WAL | `app.getPath('userData')/video-summary.db`，`PRAGMA journal_mode;` 应返回 `wal` |
| FTS5 能否用 | `SELECT * FROM sqlite_master WHERE type='virtual' AND name LIKE 'project_fts%';` |
| 中文检索为何没命中 | trigram 需 **≥3 字符**；短于 3 的查询走全量扫描兜底，属预期行为 |
| 单文件备份 | 停应用后直接复制 `video-summary.db`（WAL 下连同 `-wal`/`-shm` 一并复制，或用 `VACUUM INTO`） |
| API Key / 模型存在哪 | `settings WHERE key='app'`（明文本地存储，见 README 安全说明） |
| 一处查询 3 字符就命中但 2 字符不中 | 是 FTS5 trigram 的 token 长度下限所致，非 bug；本地数据量小，兜底扫描可忽略 |
