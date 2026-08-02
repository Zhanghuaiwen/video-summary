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
│  │     ├─ video.ts           # B站元数据获取 + 音频下载 + 进度解析
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
│  └─ shared/types.ts          # 主/渲染共享类型与 IPC 通道常量
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
   │  ① downloading（仅链接）：yt-dlp 获取元数据 → 下载最佳音频
   ▼
   │  ② extracting：ffmpeg 转 16kHz 单声道 mp3 → 按 10 分钟切段
   ▼
   │  ③ transcribing：逐段上传硅基流动 SenseVoiceSmall 转写（进度 = 段数）
   ▼
   │  ④ summarizing：文字稿按段落分块 → 每块提取章节（JSON）→ 聚合去重生成最终文档
   ▼
   └  done：transcript.txt + summary.json 落盘，UI 可查看
```

**设计要点：**

- 每 10 分钟切一段，满足转写接口「时长 ≤ 1 小时、大小 ≤ 50 MB」的限制，且天然支持长视频进度展示
- 总结采用「分块 → 章节提取 → 聚合」两阶段，规避单次请求 token 超限
- 所有请求自动带 `system` 提示「请用中文回答」，并强制 JSON 结构化输出（失败自动降级/修复重试）
- 每个阶段可取消、可断点重试，失败信息带服务端原始返回便于排查

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

**Q：会不会上传我的数据？**
A：仅上传「视频音频 → 硅基流动」用于转写、以及「转写文字 → 硅基流动」用于总结。API Key 与所有项目文件仅存本机。

---

## ⚠️ 免责声明

本项目仅供学习与技术研究。下载功能仅适用于**用户拥有合法权限**的内容（自有上传、授权转载、平台允许下载的公开内容）。请遵守 B站 等平台的服务条款与当地法律法规，勿用于侵权用途。

---

## 📄 License

MIT
