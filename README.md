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
- **断点续跑**：下载 / 转写 / 视觉 / 总结 / 思维导图各阶段产物均落盘，任务失败或取消后保留进度，一键「继续」从断点续跑（模型或产物变更时自动重做相关阶段）
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
| 存储 | 本地 JSON 文件（`userData` 目录） |

---

## 📁 目录结构

```
video-summary/
├─ src/
│  ├─ main/                    # 主进程（Node.js 能力层）
│  │  ├─ index.ts              # 应用入口、窗口创建、渲染进程日志转发
│  │  ├─ ipc.ts                # IPC 路由注册（config/project/dialog）
│  │  ├─ store.ts              # 项目数据存储（JSON 持久化）
│  │  └─ services/
│  │     ├─ config.ts          # API Key / 模型配置持久化
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
│  │  ├─ components/           # Sidebar / SettingsModal
│  │  ├─ store/                # Zustand 状态
│  │  └─ api/client.ts         # IPC 调用封装
│  └─ shared/types.ts          # 主/渲染共享类型、IPC 通道常量与默认配置
│  └─ shared/errors.ts         # 通用错误消息归一化工具
├─ resources/                  # 内置二进制（yt-dlp.exe）
├─ electron.vite.config.ts
└─ package.json
```

**数据存放位置**（Electron `userData` 目录，Windows 为 `%APPDATA%/<应用名>/`）：

| 文件 | 说明 |
|---|---|
| `config.json` | 用户配置：API Key、转写/总结模型、API Base URL |
| `store.json` | 项目列表（标题、来源、阶段、进度） |
| `projects/<id>/` | 每个项目的工作目录：音频、分段、`transcript.txt`、`summary.json` |

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
   └  done：transcript.txt + summary.json + vision.json + mindmap.json 落盘，UI 可查看
```

**设计要点：**

- 每 10 分钟切一段，满足转写接口「时长 ≤ 1 小时、大小 ≤ 50 MB」的限制，且天然支持长视频进度展示
- 下载格式链 `bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best` 优先产出 H.264 mp4（可播放 + 可转写 + 可提帧），避免落到纯音频
- 主题通过 CSS 变量 + `html[data-theme]` 切换，界面与 ReactFlow 画布（控件、缩略图、节点、加减号）共用同一套变量
- 总结采用「分块 → 章节提取 → 聚合」两阶段，规避单次请求 token 超限；**聚合阶段会附带关键帧画面/OCR 简报**，章节可引用对应画面，总结文档展示相关截图与识别出的文字
- 关键帧数量严格受「最多关键帧数（默认 30）」约束：固定采样 + 场景检测结果超限时均匀抽样缩减，OCR 结果再按相似度去重，控制成本与耗时
- 所有请求自动带 `system` 提示「请用中文回答」，并强制 JSON 结构化输出（失败自动降级/修复重试）
- 每个阶段可取消、可断点重试，失败信息带服务端原始返回便于排查
- **断点续跑**：各阶段完成后把产物（`media.mp4` / `blocks.json` / `transcript.txt` / `vision.json` / `summary.json` / `mindmap.json`）与所用模型写入项目 `checkpoint`；失败/取消后项目显示「已暂停」，点「继续」按 `checkpoint` 跳过已完成阶段，仅重跑未完成部分
- **并行加速**：关键帧提取与转写同时进行（都只依赖媒体文件）；转写完成后先做视觉分析（OCR+画面描述），再顺次生成总结（总结要引用画面/OCR 信息），最后生成思维导图

---

## 🧭 项目路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| W1 | Electron + Vite + React 骨架，IPC 安全桥 | ✅ 完成 |
| W2 | 下载 → 提取 → 转写 → 总结全管线 + 进度上报 | ✅ 完成 |
| W3 | 思维导图（React Flow）+ Markdown 导出 | ⏳ 待做 |
| W4 | electron-builder 打包 + SQLite 历史库 | ⏳ 待做 |

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

---

## ⚠️ 免责声明

本项目仅供学习与技术研究。下载功能仅适用于**用户拥有合法权限**的内容（自有上传、授权转载、平台允许下载的公开内容）。请遵守 B站 等平台的服务条款与当地法律法规，勿用于侵权用途。

---

## 📄 License

MIT
