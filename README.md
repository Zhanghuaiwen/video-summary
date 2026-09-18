# Video Summary（视频总结助手）

> 把任意视频变成一个可读、可检索、可分享的知识文档。粘贴链接或上传视频，AI 自动转写并生成结构化总结。

基于 **Electron + React + TypeScript** 的桌面应用，全链路使用 JavaScript/TypeScript 一栈实现：视频下载 → 音频提取 → 语音转写 → AI 总结，进度实时可见。

---

## ✨ 功能特性

- **两种视频来源**：B站视频链接（自动下载） / 本地视频文件上传
- **智能转写**：长视频自动切分为 10 分钟分段，逐段转写，规避单次请求大小/时长限制
- **AI 结构化总结**：按主题划分章节，每章包含概述 + 要点；多轮「分块 → 聚合」保证长视频不丢失细节
- **多形态输出**：总结文档（章节卡片 + 核心概述）/ 完整文字稿（双视图切换）
- **实时进度**：下载 → 提取 → 转写 → 总结 四阶段进度条，可随时取消
- **断点续跑**：下载 / 转写 / 视觉 / 总结 / 思维导图各阶段产物均落库，任务失败或取消后保留进度，一键「继续」从断点续跑（模型或产物变更时自动重做相关阶段）
- **本地全文检索**：标题 / 文字稿 / 总结 / 思维导图全部建入 SQLite FTS5 索引，侧边栏搜索框毫秒级返回命中位置与摘要片段（中文子串 ≥3 字符走 trigram 索引，短词自动回退全量扫描）
- **浅色 / 深色主题**：侧边栏一键切换，界面与思维导图（画布、定位缩略图、节点加减号、控件按钮）随主题自适应
- **B站视频可播放**：下载优先 H.264 mp4 音视频合并格式，杜绝「只下到音频」；总结页可一键「播放视频 / 打开文件夹」
- **本地数据**：所有配置与项目历史仅保存在本机，API Key 不上传任何第三方
- **可配置模型**：转写与总结模型均可在设置中自由更换

---

## 🛠 技术栈

| 层面 | 技术 |
|---|---|
| 桌面框架 | Electron + electron-vite |
| UI | React 19 + TypeScript + Tailwind CSS v4 + Zustand |
| 视频下载 | yt-dlp（内置二进制，`resources/yt-dlp.exe`） |
| 音视频处理 | ffmpeg-static（内置二进制） |
| 语音转写 | 硅基流动 `FunAudioLLM/SenseVoiceSmall` |
| 文本总结 | 硅基流动 `Qwen/Qwen2.5-7B-Instruct` |
| 存储 | SQLite（`node:sqlite` 内置驱动，含 FTS5 全文检索） |

---

## 📁 目录结构

```
video-summary/
├─ src/
│  ├─ main/                    # 主进程（Node.js 能力层）
│  │  ├─ index.ts              # 应用入口、窗口创建、渲染进程日志转发
│  │  ├─ ipc.ts                # IPC 路由注册（config/project/mindmap/search）
│  │  ├─ db.ts                 # SQLite 连接、schema、FTS5 双索引、旧数据迁移
│  │  ├─ store.ts              # 项目/文档/设置存储（SQLite 持久化）
│  │  └─ services/
│  │     ├─ config.ts          # API Key / 模型配置持久化（settings 表）
│  │     ├─ cache.ts           # 分析结果缓存（cache 表 + 帧图目录）
│  │     ├─ search.ts          # 全文检索（FTS5 候选 + 结构化定位 + 摘要）
│  │     ├─ process.ts         # 子进程执行封装（yt-dlp / ffmpeg）
│  │     ├─ bin.ts             # 二进制路径解析（dev / 打包后）
│  │     ├─ video.ts           # B站元数据获取 + 音视频下载(合并 mp4) + 进度解析
│  │     ├─ audio.ts           # ffmpeg 抽音频 → 10 分钟分段
│  │     ├─ transcriber.ts     # 硅基流动 ASR（分段批量转写）
│  │     ├─ summarizer.ts      # 硅基流动 LLM（分块提取章节 + 聚合）
│  │     └─ pipeline.ts        # 管线编排：5 阶段任务 + 取消 + 进度上报
│  ├─ preload/                 # contextBridge 安全桥（window.api）
│  ├─ renderer/                # 渲染进程（React UI）
│  │  ├─ pages/                # HomePage / LibraryPage / DocPage / MindMapPage
│  │  ├─ components/           # Sidebar（含全文检索）/ SettingsModal
│  │  ├─ store/                # Zustand 状态
│  │  └─ api/client.ts         # IPC 调用封装
│  └─ shared/types.ts          # 主/渲染共享类型、IPC 通道常量与默认配置
│  └─ shared/errors.ts         # 通用错误消息归一化工具
├─ resources/                  # 内置二进制（yt-dlp.exe）
├─ electron.vite.config.ts
└─ package.json
```

**数据存放位置**（Electron `userData` 目录，Windows 为 `%APPDATA%/<应用名>/`）：

| 文件/位置 | 说明 |
|---|---|
| `video-summary.db` | SQLite 数据库：`projects`（含文字稿/总结/视觉/导图 JSON 列）、`settings`（配置）、`cache`（分析缓存）、`project_fts` + `project_fts_trgm`（全文检索索引） |
| `projects/<id>/` | 每个项目的媒体工作目录：下载的 mp4、音频分段、关键帧图片（产物文档已迁入 SQLite，仅存大文件） |
| `store.json` / `config.json` | 旧 JSON 存储：首次启动自动迁入 SQLite 后保留为 `*.legacy` 备份，可删除 |

> 📐 详见 [docs/sqlite-storage.md](./docs/sqlite-storage.md)：schema 设计、FTS5 中文检索策略与迁移说明。

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18（本项目在 Node 24 上开发）
- 可访问公网（yt-dlp 下载视频、调用硅基流动 API）
- 一个[硅基流动](https://siliconflow.cn)账号（注册即送额度，转写 + 总结共用）

### 安装

```bash
npm install
```

首次安装会自动下载 yt-dlp（`resources/yt-dlp.exe`）与 ffmpeg 二进制（`ffmpeg-static` 的 postinstall）。

### 开发模式

```bash
npm run dev
```

### 类型检查 / 构建

```bash
npm run typecheck   # 主进程 + 渲染进程类型检查
npm run build       # 产物输出到 out/
```

### 打包 Windows 安装包（W4 完善中）

```bash
npm run package:win
```

---

## 📖 使用说明

1. **配置 API Key**：点击左下角「设置」，填入硅基流动 API Key，保存。
   - 转写模型默认 `FunAudioLLM/SenseVoiceSmall`
   - 总结模型默认 `Qwen/Qwen2.5-7B-Instruct`
   - 可在设置中随时更换，均要求 OpenAI 兼容的 `/v1` 接口
2. **新建任务**：「新建」页选择「B站链接」（粘贴链接）或「本地文件」（选择视频文件），可自定义标题，点击「开始解析」。
3. **查看进度**：自动跳转「项目库」，实时查看四阶段进度条，可随时「停止」。
4. **查看结果**：任务完成后点「查看」，在「总结文档」页切换 **总结 / 文字稿** 两个视图。

---

## 🔧 处理管线（Pipeline）

```
视频URL / 本地文件
   │  ① downloading（仅链接）：yt-dlp 获取元数据 → 下载音视频并合并为 mp4（兼顾转写与关键帧/视觉分析）
   ▼
   │  ② extracting：ffmpeg 转 16kHz 单声道 mp3 → 按 10 分钟切段；同时并行提取关键帧（固定采样 + 场景检测，受「最多关键帧数」上限约束）
   ▼
   │  ③ transcribing：逐段上传硅基流动 SenseVoiceSmall 转写（进度 = 段数）
   ▼
   │  ④ analyzing：关键帧分批送视觉模型做 OCR + 画面描述（与语音对齐），按「最多关键帧数」严格限量
   ▼
   │  ⑤ summarizing：文字稿分块提取章节 → 聚合（附带画面/OCR 简报），产出 overview + 全片要点 + 分章节要点/子要点 + 相关画面引用
   ▼
   │  ⑥ mindmap：基于完整总结 + 文字稿 + 画面/OCR 生成 3~6 层思维导图，尽量覆盖全部内容
   ▼
   └  done：transcript / summary / vision / mindmap 写入 SQLite（并刷新 FTS 索引），UI 可查看
```

**设计要点：**

- 每 10 分钟切一段，满足转写接口「时长 ≤ 1 小时、大小 ≤ 50 MB」的限制，且天然支持长视频进度展示
- 下载格式链 `bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best` 优先产出 H.264 mp4（可播放 + 可转写 + 可提帧），避免落到纯音频
- 主题通过 CSS 变量 + `html[data-theme]` 切换，界面与 ReactFlow 画布（控件、缩略图、节点、加减号）共用同一套变量
- 总结采用「分块 → 章节提取 → 聚合」两阶段，规避单次请求 token 超限；**聚合阶段会附带关键帧画面/OCR 简报**，章节可引用对应画面，总结文档展示相关截图与识别出的文字
- 关键帧数量严格受「最多关键帧数（默认 30）」约束：固定采样 + 场景检测结果超限时均匀抽样缩减，OCR 结果再按相似度去重，控制成本与耗时
- 所有请求自动带 `system` 提示「请用中文回答」，并强制 JSON 结构化输出（失败自动降级/修复重试）
- 每个阶段可取消、可断点重试，失败信息带服务端原始返回便于排查
- **断点续跑**：各阶段完成后把产物（`media.mp4` / 转写 / 视觉 / 总结 / 思维导图）与所用模型写入项目 `checkpoint`；产物存在性与模型匹配决定跳过/重做，失败/取消后项目显示「已暂停」，点「继续」按 `checkpoint` 跳过已完成阶段，仅重跑未完成部分
- **并行加速**：关键帧提取与转写同时进行（都只依赖媒体文件）；转写完成后先做视觉分析（OCR+画面描述），再顺次生成总结（总结要引用画面/OCR 信息），最后生成思维导图
- **全文检索**：每次写回文字稿/总结/导图即重建对应 FTS 行；检索时以 trigram/unicode61 双索引取候选（bm25 排序），再做结构化定位（章节/节点）给出摘要片段，见 docs/sqlite-storage.md

---

## 🧭 项目路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| W1 | Electron + Vite + React 骨架，IPC 安全桥 | ✅ 完成 |
| W2 | 下载 → 提取 → 转写 → 总结全管线 + 进度上报 | ✅ 完成 |
| W3 | 思维导图（React Flow）+ Markdown 导出 | ✅ 完成 |
| W4 | SQLite 历史库（node:sqlite + FTS5 全文检索） | ✅ 完成 |
| W5 | electron-builder 打包 + 自动更新 | ⏳ 待做 |

---

## ❓ 常见问题（FAQ）

**Q：打开界面一片空白 / 深蓝底色？**
A：多为 preload 未加载导致 `window.api` 不存在。`package.json` 为 `"type": "module"` 时 preload 产物是 `index.mjs`，主进程须引用对应文件名。如仍异常，先 `npm run build` 清掉 `out/` 再 `npm run dev`。

**Q：转写/总结报错怎么办？**
A：错误信息会带上服务端返回（如模型名错误、限流、鉴权失败）。常见原因：
- API Key 未填或已过期 → 检查「设置」
- 模型名失效 → 硅基流动模型列表会定期调整，去设置里换成在架模型
- 429 限流 / 503 过载 → 代码已内置自动重试，稍后再试

**Q：B站视频下载失败？**
A：部分视频需要登录（弹幕/会员内容）。基础内容无需登录即可下载。如遇反爬，可考虑为 yt-dlp 配置 cookies（后续版本支持）。

**Q：视频标题显示乱码？**
A：这是 yt-dlp（Python 打包）在中文 Windows 下的经典编码问题——通过管道输出时默认用 GBK 而非 UTF-8。代码已对 yt-dlp 调用统一加 `--encoding utf-8` 参数强制 UTF-8 输出，正常情况不会出现。若仍出现类似 `������` 的乱码，请检查是否有旧版本 yt-dlp 二进制被缓存，删除 `resources/yt-dlp.exe` 后重新安装即可。

**Q：长视频会失败吗？**
A：不会。音频按 10 分钟分段转写，总结按文字块分批提取，理论上支持任意时长，仅受 API 额度与时间影响。

**Q：任务失败 / 中途取消怎么办？**
A：各阶段产物都会落盘（视频、转写、视觉、总结、思维导图）。失败或取消后项目显示「已暂停」，点击「继续」会从断点续跑，已完成的阶段不会重复执行（仅重跑未完成部分）。若更换了模型，受影响的阶段及后续会自动重做。

**Q：思维导图生成慢 / 进度条不动？**
A：思维导图是单次大 LLM 请求（输入带时间戳文字稿 + 总结，输出整棵嵌套 JSON 树），通常需 1~3 分钟。代码会用耗时驱动进度条（5%→90%）并显示已用时，避免看起来像卡死；生成失败不会阻塞整个任务，可在「思维导图」页单独重新生成。

**Q：会不会上传我的数据？**
A：仅上传「视频音频 → 硅基流动」用于转写、以及「转写文字 → 硅基流动」用于总结。API Key 与所有项目文件仅存本机。

---

## 🐛 已修复的问题（故障排查参考）

以下是开发与使用中修复过的问题，遇到相似报错时可对照排查：

**1. 报错 `The operation was aborted due to timeout`（LLM 请求超时）**
- 原因：总结模型若为**思考型模型**（如 `Qwen/Qwen3-8B`），回答前会先输出大量推理内容，单次总结请求耗时可达 83~268 秒，超过程序原超时阈值；且旧代码只对 `fetch` 阶段做超时处理，响应体读取（`res.text()`）阶段超时会把 undici 原始英文报错直接抛给界面。
- 修复（`src/main/services/llm.ts`）：
  - 超时检测覆盖「发起请求 + 读取响应体」全程，超时统一转为可重试错误；
  - 超时阈值按输出规模自动放大：`150s + 50ms/token`；
  - 自动识别 `Qwen/Qwen3*` 并附加 `thinking: { type: 'disabled' }` 禁用思考模式（提速约 5 倍）；
  - JSON 解析改为可容忍截断/尾部噪声的回退解析（最多回退 40 次）并支持修复重试。

**2. 报错 `Expected ',' or ']' after array element in JSON ...` / `LLM 返回缺少 chapters 字段`（总结 JSON 异常）**
- 原因：总结模型的输出可能被截断成非法 JSON，或返回合法 JSON 但缺少 `chapters` 字段；旧代码在这些情况下会直接把底层异常抛给界面。
- 修复（`src/main/services/summarizer.ts` + `llm.ts`）：
  - 分块输出 token 上限提高到 3072、最终聚合提高到 8192，避免长文被截断；
  - 聚合 JSON 解析失败**或**缺 `chapters` 时，自动回退用已收集的分块章节，并自动拼接 `overview`，不再整任务失败；
  - 单段总结整体兜底 try/catch；所有分块全失败时，会用完整文字稿再跑一次兜底；
  - 错误信息透出真实原因（`pipeline.ts`），不再吞成笼统文案。

**3. 报错 `ENOENT: no such file or directory, open '...projects/<id>/media.f30077.mp4'`（下载后找不到文件）**
- 原因：B站下载改为 `bestvideo[ext=mp4]+bestaudio/best` 后，yt-dlp 会先下载两个分部文件再合并成 `media.mp4`，随后**删除分部文件**；而旧代码解析「第一条 `[download] Destination:`」路径，正好拿到被删除的 `media.f30077.mp4`，后续对不存在的文件计算哈希即报 ENOENT。
- 修复（`src/main/services/video.ts`）：成品路径按优先级解析——优先返回已存在的 `media.mp4`（合并产物），否则取**最后一条** `Destination` 指向的文件（单格式/仅音频回退场景），否则回退默认 `media.mp4`。

**4. 视觉分析静默失效（`vision.json` 的 `frames` 恒为空）**
- 原因：旧下载格式 `-f bestaudio/best` 只下载**纯音频**（m4a 无视频流），关键帧提取（`extractKeyFrames`）报「Output file does not contain any stream」，导致 frames 目录恒为空、视觉分析被静默跳过。
- 修复（`src/main/services/video.ts`）：下载改为「音视频分离下载 + 合并为 mp4」，关键帧/OCR/画面描述正常生效（25 分钟视频实测提取 25 帧）。

**5. 总结模型推荐**
- 实测同一总结请求：`Qwen/Qwen2.5-7B-Instruct` 约 3~18 秒，`Qwen/Qwen3-8B`（思考型）约 40~268 秒。总结模型默认配置为 `Qwen/Qwen2.5-7B-Instruct`，如必须使用 Qwen3 系列，代码已自动禁用其思考模式。

**6. 视频进度条拖不动 / 「跳转到此处」失效**
- 原因：`vsmedia://` 自定义协议旧实现只支持整文件流式返回（不支持 HTTP `Range`），Chromium 的 `<video>` 因无法获取分段数据而不能 seek（进度条拖不动、跳转时间点无效）。
- 修复（`src/main/index.ts`）：协议实现 `Range` 请求 → 返回 `206 Partial Content` + `Content-Range` / `Accept-Ranges: bytes` / `Content-Length`，支持 `bytes=start-end`、`bytes=N-`、后缀区间 `bytes=-N`；播放器 `Player.tsx` 在媒体未就绪（`readyState < 1`）时等待 `loadedmetadata` 后再设置 `currentTime`，并带 1.5s 兜底。

**7. 思维导图小地图覆盖层看不清 / 视口框偏移**
- 原因：旧实现用 CSS 类把小地图压到 150×100，而组件内部按默认 200×150 计算视口框坐标，宽高比不一致导致视口框偏移；覆盖层遮罩颜色过淡（浅色主题下几乎看不见）。
- 修复（`src/renderer/src/pages/mindmap/MindMapFlow.tsx`）：改为直接传 `style={{ width: 150, height: 100 }}` 使内部坐标与显示尺寸一致；遮罩加 `maskStrokeColor`（主题强调色描出当前视口框），浅色主题遮罩改为半透明深色，深色主题保持遮罩变暗，底层节点图保持静态不变。

**8. 短视频时间轴错误（40 秒视频结束时间显示为 10:00）**
- 原因：时间轴按「每段 10 分钟」假设计算每个转写分段的 `endTime = startTime + 600`，短视频只有 1 段，结尾被算成 00:10:00；思维导图模型据此把节点时间区间标成 0~600 秒。
- 修复：
  - `src/main/services/video.ts` 新增 `probeMediaDuration`：用 ffmpeg 只读打开媒体解析真实时长（不做转码，秒级返回）；
  - `src/main/services/timeline.ts` `buildTimeline` 支持 `mediaDuration`，把每个分段 `endTime` 钳制到真实时长内；
  - 断点续跑读取旧 `vision.json` 时按真实时长重算时间轴；
  - `src/main/services/mindmap.ts` 新增 `clampMindMapTimes`：生成/重新生成导图后把全部节点 `timeRange` 钳制到媒体时长内（防御性兜底）。

**9. 思维导图出现大量「22:57 - 22:57」退化时间区间**
- 原因：LLM 为部分节点推断出**完全落在片尾之后**的时间区间；旧的 `clampMindMapTimes` 会把 start/end 同时钳制到媒体时长，产生一堆零长的「22:57 - 22:57」。此外提示词示例里的 `"end":3600` 会诱导模型输出超出总时长的数值。
- 修复：
  - `src/main/services/mindmap.ts` `clampMindMapTimes`：start ≥ 时长（整体越界）或 start == end 的区间直接丢弃，只保留钳制后有意义的部分重叠区间；
  - 提示词新增视频总时长约束（`durationSec`，由 `pipeline.ts` / `ipc.ts` 传入真实探测时长），明确「0 ≤ start ≤ end ≤ 总时长，定位不到就省略」，并从 JSON 示例中移除误导性的固定 end 值。

**10. 新建项目后标题不显示、且「该任务没有可播放的媒体文件」（第一遍不对、重启后正常）**
- 现象：点「开始解析」后立即跳到项目库，标题仍是默认「B站视频」、播放器提示无媒体；但任务在后台跑完后，重启应用再进项目库就一切正常。
- 根因：**前端只在提交瞬间 `listProjects()` 拉了一次快照**，而标题/媒体路径是后台管线异步写入 store 的。后端每次 `store.updateProject` 都会落盘，但前端老的 `applyProgress` 只合并 `stage/progress/error`，把 `title`/`mediaPath` 等字段全部丢弃——所以前端一直显示创建时的陈旧快照。这与「下载失败」无关，是纯前端实时刷新缺失。
- 修复（全链路实时推送完整 project）：
  - `src/shared/types.ts`：新增 `project:updated` 事件通道 + `ProjectUpdatedPayload { project }` 类型；
  - `src/main/store.ts`：`createStore(onProjectUpdated?)` 注入回调，`updateProject` 写盘后调用它，把完整 project 推出去；
  - `src/main/ipc.ts` + `src/main/index.ts`：新增模块级 `sendProjectUpdated` 并在创建 store 时注入；
  - `src/renderer`：`preload/index.ts` 与 `api/client.ts` 新增 `onProjectUpdated`，`store/appStore.ts` 新增 `applyProjectUpdated`（用完整 project 替换列表项），`App.tsx` 订阅该事件。
  - 效果：标题/媒体路径/各产物路径一旦落盘即实时反映到项目库，不再需要重启。

**11. 视频下载偶发「下载了文件却判定失败 / 没有可播放媒体」（yt-dlp 退出码误判）**
- 现象：B站视频在 Windows 上偶发「下载阶段报错」，但工作目录里其实有 `media.mp4` 残片。
- 根因：`downloadMedia` 用 `runCommand` 调用 yt-dlp，而 `runCommand` 默认零容忍非零退出码。yt-dlp 在 Windows 上偶发非零退出（即便成品 `media.mp4` 已生成），导致整条管线 `catch` 进 `failed`，`mediaPath` 从未写入 store → 项目库判定「无媒体」。
- 修复（`src/main/services/video.ts`）：给 yt-dlp 的 `runCommand` 调用加 `{ allowNonZero: true }`，成功判定改为「成品 `media.mp4` 是否真实存在」，不再被退出码误杀。

**12. 关键帧时间点偏差 + 思维导图节点时间模糊不准（SenseVoice 无时间戳的根因与根治）**
- 根因调研：**转写用的是 `FunAudioLLM/SenseVoiceSmall`，经 OpenAI 兼容接口 `/audio/transcriptions` 只返回整段 `text`，零时间戳**。因此句子级时间只能靠线性插值（旧 `timeline.ts` 在每 60s 段内按字符占比均匀摊开），本质是「假设语速均匀」，必然漂移，越往后误差越大；关键帧固定采样也曾用「请求时刻 `-ss t`」而非实际帧 `pts_time`，也有 ±0.5s 偏差。
- 修复（不引入任何新模型/新依赖，纯工程方案）：
  - **关键帧真实 pts**（`src/main/services/frames.ts`）：固定采样抽帧加 `-vf showinfo`，回读返回帧的真实 `pts_time` 作为时间点，消除 `-ss` 寻址偏差；
  - **句子级时间戳改用真实停顿边界**（`src/main/services/audio.ts` + `timeline.ts`）：新增 `detectSilences()` 用 ffmpeg `silencedetect` 在整段音频上检测停顿点（说话自然停顿即句子边界），把这些真实时间点作为锚点骨架，在骨架上按句子数定位每句起止——精度从「字符线性插值」升级到「真实停顿边界（秒级）」；无停顿点时回退到字符插值；
  - **管线接入**（`src/main/services/pipeline.ts`）：转写前先 `detectSilences`，把 `silenceTimes` 传给 `buildTimeline` → `refineSegments`；视觉阶段 `runVisionStage` 也复用同一组停顿点，保证导图节点时间与语音对齐一致。
- 说明：因 SenseVoice 本身不出词级时间戳，若不引入 faster-whisper 等额外模型，本方案（ffmpeg 静音检测 + 真实 pts）是精度与成本的最优折中；长段连续念稿无停顿时，时间精度会退化为段内插值，但已远优于旧实现。

**13. 断点续跑丢失真实停顿点（sentence 时间回退到字符插值）**
- 现象：任务失败/取消后点「继续」，从断点恢复时句子级时间戳变回旧的模糊插值结果。
- 根因：`silenceTimes`（真实停顿点）是运行时检测产物，未写入 `checkpoint`，断点恢复分支拿不到 → 回退空数组 → 字符插值。
- 修复：
  - `src/shared/types.ts`：`ProjectCheckpoint` 新增 `silenceTimes?: number[]`；
  - `src/main/services/pipeline.ts`：转写阶段完成后把 `silenceTimes` 写入 `checkpoint`；断点恢复（`reuseTranscribe`）时从 `cp.silenceTimes` 复用，句子级时间轴无需重跑静音检测。

**14. `npm run dev` / `npm run build` 直接失败（主进程打包报错）**
- 现象：`npm run dev` 或 `npm run build` 启动即报 `src/main/index.ts: "sendProjectUpdated" is not exported by "src/main/ipc.ts"`。
- 根因：新增 `project:updated` 实时推送时，`src/main/index.ts` 从 `./ipc` 导入了 `sendProjectUpdated`，但 `ipc.ts` 里把它定义成了模块内部的 `const`（未 `export`），rollup 打包阶段即失败，导致整个 dev/build 无法启动。
- 修复（`src/main/ipc.ts`）：将 `const sendProjectUpdated` 改为 `export const sendProjectUpdated`。`npm run build` 现已通过（`✓ built`），dev 同步恢复。

**15. 时间轴时间戳精度与一致性缺陷（依据 `分析.txt` 复盘修复）**
- 现象 / 根因（共 5 处，均在 `src/main/services/timeline.ts`）：
  1. **结尾越界（分析 §8）**：`buildTimeline` 中 `endTime` 先被 `mediaDuration` 钳制，若钳制后仍 `≤ startTime`，旧代码无条件 `endTime = startTime + 1`，会把段尾顶到真实视频时长之外（如 590s 视频算出 591s）；且 `start >= mediaDuration` 的退化段从未被丢弃。
     - 修复：补齐时再次 `Math.min(..., mediaDuration)`，并在末尾 `.filter(s => s.endTime > s.startTime)` 丢弃退化段。
  2. **两套时间（分析 §21-§22，优先级最高）**：`buildTimedTranscript`（导图文字稿）又调了一次 `refineSegments(segments, blockChars)` 且**没传 `silenceTimes`**，对「已细化过」的 segments 二次细化，且丢掉真实停顿对齐 → UI 时间轴与导图 LLM 文字稿时间轴不一致（同句差几秒）。
     - 修复：删除二次 `refineSegments`，直接消费 `buildTimeline` 已细化好的 segments，使 `TimelineSegment` 成为 UI / 视频跳转 / 关键帧 / 导图 LLM 共用的**唯一时间源（Single Source of Truth）**。
  3. **句子边界不落在真实停顿（分析 §14-§18）**：旧 `lerpToBoundaries` 只是把句子**按数量比例**映射到「停顿骨架」上做插值，句子边界实际落在停顿区间内部而非真实停顿点——注释声称「对齐真实停顿」但并未做到。
     - 修复：新增 `snapBoundaries()`，以字符数作为说话时长代理算出每句比例位置，把边界**吸附到比例上最近的真实停顿**（`|差值| ≤ 0.5`）；无停顿或差值过大时回退线性比例，最后做单调修复保证时间严格递增。移除原 `lerpToBoundaries`。
  4. **打包长度误判（分析 §13）**：`packSentences` 用 `buf.length + s.length + 1 > maxChars` 判断，但 `joinSentences` 在中文等场景并不加分隔符，导致长度判断偏保守/不准。
     - 修复：直接 `const merged = joinSentences(buf, s); if (merged.length > maxChars)` 用真实拼接结果判断。
  5. **性能：线性查找（分析 §24-§25）**：`makeTranscriptByTime` 每次查找用 `segments.find` 线性扫描（长视频 2000 段 × 60FPS 拖动）；`refineSegments` 关键帧重分配用 `out.slice(...).find` 双重循环。
     - 修复：`makeTranscriptByTime` 改为对有序时间轴的二分查找（O(log n)）；关键帧重分配改用双指针，复杂度从 O(segments·frames) 降到 O(segments+frames)。
- 说明：上述 §14-§18 指出，仅凭 `silenceTimes`（段落级停顿）无法做到「词级 / 句级」精确对齐，根治需 ASR 词级时间戳（如 faster-whisper）。本修复在不引入新模型的约束下，把边界吸附到真实停顿、并消除 UI 与导图的时间漂移，已是当前架构下的最优折中。
- 验证：`npm run typecheck` 通过；`lerpToBoundaries` 已无引用残留。

---

## ⚠️ 免责声明

本项目仅供学习与技术研究。下载功能仅适用于**用户拥有合法权限**的内容（自有上传、授权转载、平台允许下载的公开内容）。请遵守 B站 等平台的服务条款与当地法律法规，勿用于侵权用途。

---

## 📄 License

MIT
