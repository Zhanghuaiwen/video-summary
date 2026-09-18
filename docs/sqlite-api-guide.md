# SQLite 数据访问实用手册：建库 / 查询 / 写代码

> 面向本文仓（video-summary）开发者的实操文档，回答三个问题：
> 1. **怎么建**——数据库文件在哪、Schema 长什么样、启动时如何初始化/迁移；
> 2. **怎么查询**——项目 CRUD、配置、缓存、FTS5 全文检索的 SQL 与示例；
> 3. **怎么写代码**——业务层不写裸 SQL 的 `Store` 接口用法与语句模式。
>
> 存储层设计动机若需要展开，参见 `docs/sqlite-storage.md`；本文只讲「现在就能抄着用」的部分。

---

## 1. 一句话总览

| 你要做的事 | 关键入口 | 说明 |
|---|---|---|
| 打开/初始化数据库 | `src/main/db.ts` → `getDb()` | 建表 + 旧 JSON 迁移 + FTS 重建，幂等 |
| 建项目 / 取项目 / 存产物 | `src/main/store.ts` → `createStore(...)` 返回的 `Store` | **唯一被业务层调用的接口**，内部自动同步 FTS |
| 跨项目全文检索 | `src/main/services/search.ts` → `searchProjects(q, store)` | FTS 候选 + JS 结构化定位（Hybrid） |
| 分析结果缓存 | cache 表（内容指纹命中时写回文档） | 见 README 缓存章节 |

**决策**：驱动为 `node:sqlite` 的 `DatabaseSync`（Electron 35 内置 Node 22.14，FTS5 可用，零原生依赖）；单文件 `video-summary.db` + WAL，产物文档改存 `projects` 表 JSON 列，不再落散文件；媒体文件（mp4 / 音频 / 关键帧）仍在磁盘，DB 只存引用路径。

---

## 2. 怎么建：连接与 Schema

### 2.1 连接（`src/main/db.ts`）

```ts
import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
import { join } from 'path'

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  const userDataDir = app.getPath('userData')          // Windows: %APPDATA%/video-summary
  mkdirSync(userDataDir, { recursive: true })
  db = new DatabaseSync(join(userDataDir, 'video-summary.db'))
  db.exec('PRAGMA journal_mode = WAL;')                // WAL：读不阻塞写
  db.exec('PRAGMA synchronous = NORMAL;')              // 崩溃自恢复 + 更快的普通写
  db.exec('PRAGMA foreign_keys = ON;')
  migrateSchema(db)                                    // 建表（幂等）
  migrateLegacyData(db, userDataDir)                   // store.json / config.json → SQLite
  backfillProjectDocs(db, userDataDir)                 // 旧产物文件 → 空列
  return db
}

export function closeDb(): void { db?.close(); db = null }
```

> `getDb()` 单例、同步；只有第一个 `DatabaseSync`。所有 DDL 都在 `SCHEMA` 常量里用 `IF NOT EXISTS` 保证可重复执行（`db.ts`）。

### 2.2 Schema 全貌（`db.ts` 的 `SCHEMA`）

```sql
-- 项目 + 产物文档（真值来源。「文档」= 各阶段产物 JSON 列，不再写独立文件）
CREATE TABLE IF NOT EXISTS projects (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  source               TEXT NOT NULL,          -- 'bilibili' | 'local'
  source_url           TEXT,
  local_path           TEXT,
  media_path           TEXT,
  stage                TEXT NOT NULL,          -- queued/downloading/.../done/failed
  progress             REAL NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  error                TEXT,
  media_hash           TEXT,                   -- 内容指纹（分析缓存键来源）
  analysis_config_json TEXT,                   -- JSON：keyFrameInterval 等分析参数
  checkpoint_json      TEXT,                   -- JSON：断点续跑（各阶段产物+所用模型）
  transcript           TEXT,                   -- 整篇文字稿
  blocks_json          TEXT,                   -- 转写分段 { asrModel, blocks[] }
  summary_json         TEXT,                   -- 总结文档
  vision_json          TEXT,                   -- 视觉分析（关键帧/时间轴）
  mindmap_json         TEXT                    -- 思维导图文档
);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage);

-- 应用配置（API Key / 模型 / 主题…）——单行 key-value
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- 分析结果缓存：内容指纹命中时把文档写回项目行，避免同一视频重复消耗 API 费用
CREATE TABLE IF NOT EXISTS cache (
  key         TEXT PRIMARY KEY,            -- sha1(mediaHash + 模型 + 分析参数)
  transcript  TEXT,
  blocks_json TEXT,
  summary_json TEXT,
  vision_json  TEXT,
  mindmap_json TEXT,
  created_at  TEXT NOT NULL
);

-- FTS5 全文检索虚拟表（对 title/transcript/summary/mindmap 建索引）
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

> **表名注意**：`store.ts` / `search.ts` 中实际操作的两张索引虚拟表是 **`project_fts`**（unicode61，英文/单词）与 **`project_fts_trgm`**（trigram，中文 ≥3 字符子串），`settings` 不是 `config`。旧版文档里写过的 `config.json`/`store.json` 已被迁移为 `*.legacy` 并写入 `settings` 表（key=`app`）。

> 产物 JSON 只在 `projects` 与 `cache` 行存在；`project_fts*` 是**检索用的镜像**，不承载真值。

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

**更新（含高频进度列）**

```sql
UPDATE projects SET
  title=?, source=?, source_url=?, local_path=?, media_path=?, stage=?, progress=?,
  updated_at=?, error=?, media_hash=?, analysis_config_json=?, checkpoint_json=?
  WHERE id=?;
```

**删除（同时清 FTS 行 + 项目行）**

```sql
DELETE FROM projects WHERE id = ?;
```

> `deleteProject` 的清理逻辑：先 `DELETE` FTS 两表对应 `project_id` 行，再删 `projects` 行，最后 `rmSync` 项目媒体目录（见 `store.ts`，避免磁盘垃圾累积）。

### 3.2 FTS5 全文检索（`src/main/services/search.ts` 核心）

**为什么有两张索引**
- 默认 FTS5 分词器把连续中文当**一个整 blob 单词**，查「数据库」搜不出「MySQL 数据库优化」。
- `project_fts_trgm` 用 **trigram** 分词器（`tokenize='trigram'`），把文本切 3-gram，支持**任意 ≥3 字符的中文子串**——中文检索主通道。
- `project_fts` 用 **unicode61**（`remove_diacritics`），英文单词/多词查询语义更自然。
- 二者按设计**职责不同、不是重复**：中文子串走 trigram，英文单词走 unicode61。

**检索策略（Hybrid）**

```
用户输入 q
  ├─ |q| ≥ 3  →
  │    候选 = project_fts_trgm MATCH '"q"'      -- 中文子串主通道
  │          ∪ project_fts       MATCH '"q"'    -- 英文单词/多词补充
  │          按 bm25() 排序，取前 80 条候选
  └─ |q| < 3 或 FTS 无命中 →
        遍历 done 项目，逐文档 indexOf 扫描（本地数据量小，开销可忽略）
```

> **重要**：FTS 只负责「候选筛选 + 排序」，**命中定位/摘要在 JS 层对结构化文档精确扫描**（章节 → 导图节点 → 文字稿 → 标题顺序），返回 `ProjectSearchHit { projectId, title, location, snippet }`，`makeSnippet` 以命中点为圆心截取 ±50 字摘要。

**FTS 候选 SQL（两个分词器各查一次再取并集）**

```sql
SELECT project_id, bm25(project_fts_trgm) AS r FROM project_fts_trgm
WHERE project_fts_trgm MATCH '"'"数据库"'"'   -- 中文子串（≥3 字符）
ORDER BY r LIMIT 80;

SELECT project_id, bm25(project_fts) AS r FROM project_fts
WHERE project_fts MATCH '"database"'           -- 英文单词/多词
ORDER BY r LIMIT 80;
```

> 两张索引的候选 `UNION` 进同一个 `Set`，再用 `bm25` 排序；短查询直接 `indexOf` 全量扫描。

### 3.3 配置与缓存查询

```sql
-- 读配置（settings.key = 'app'）
SELECT value FROM settings WHERE key = 'app';

-- 写配置（UPSERT，key='app'）
INSERT INTO settings(key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value;

-- 缓存读取（按内容指纹命中）
SELECT * FROM cache WHERE key = ?;

-- 缓存写回（五份文档按 key 整行写）
INSERT OR REPLACE INTO cache(
  key, transcript, blocks_json, summary_json, vision_json, mindmap_json, created_at
) VALUES (?,?,?,?,?,?,?);
```

---

## 4. 怎么写代码：Store 接口用法

> 业务层（`pipeline.ts` / `ipc.ts`）**只跟 `Store` 打交道，完全不感知 SQL/FTS 细节**——SQL 是主进程的实现细节，索引在 `refreshFts` 里自动同步。

```ts
// store.ts 对外暴露的核心接口（节选）
interface Store {
  listProjects(): Project[]
  getProject(id): Project | undefined
  createProject(input): Project
  updateProject(id, patch): void
  deleteProject(id): void

  getTranscript / saveTranscript / getBlocks / saveBlocks  // 文字稿 + 转写分段
  getSummary  / saveSummary  / getVision / saveVision     // 总结 / 视觉分析
  getMindMap  / saveMindMap  / hasMindMap                 // 思维导图
}

// 用法示例
store.saveTranscript(id, '整篇文字稿')
store.saveSummary(id, summaryDoc)
const mv = store.getMindMap(id)
```

- **写文档自动同步 FTS**：`saveTranscript/saveSummary/saveVision/saveMindMap` 写列后调用 `refreshFts(id)`（DELETE 旧行 → INSERT 新行，`project_id` 为 UNINDEXED 列用于逐行定位），业务层无需关心索引。
- **项目行写列即 `updated_at=now`**，并触发 `onProjectUpdated`（实时推给渲染层）。
- **参数化**：所有 SQL 用 `db.prepare(...)` 一次 `prepare`，查询热路径零解析开销；**不要**用字符串拼接（FTS 查询词需转义引号：`phrase = '"'+q.replace(/"/g, '""')+'"'`）。

---

## 5. 常见问题排障

| 现象 | 原因 / 处理 |
|---|---|
| 改完标题搜不到 | FTS 只在 title 变化时重建索引（进度等高频更新不碰索引，`store.ts` 显式判断） |
| 中文 2 字符搜不到 | trigram 需 ≥3 字符；短查询（`数据`）走全量扫描兜底，属设计（见 search.ts 注释） |
| 备份单文件 | 停止应用后复制 `video-summary.db`（WAL 下连同 `-wal`/`-shm`，或用 `VACUUM INTO`） |
| `settings` vs `config` | 配置统一存 `settings` 表（key=`app`）；`config.json` 是旧版遗留已迁移留档 |
| 是否会上传数据 | 全部仅存本机 `userData/`；API Key 存 `settings` 明文（与本地应用同权限） |
