# 📖 ChatGPT eBook Reader

一款 Chrome 扩展，让你在 ChatGPT 界面中阅读电子书。书籍内容以 ChatGPT 回复消息的样式渲染在聊天区域，提供沉浸式阅读体验。

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ 功能特性

- 📚 **多格式支持** — PDF、EPUB、TXT 电子书格式
- 🎨 **原生风格渲染** — 内容以 ChatGPT 回复气泡样式呈现，阅读体验自然
- ⌨️ **快捷键导航** — 键盘快捷键翻页，高效便捷
- 🔖 **段落级书签** — 支持在段落旁添加书签，并跳转回精确阅读位置
- 🧭 **稳定阅读定位** — EPUB 按段落生成稳定位置标识，减少分页变化导致的跳转偏移
- 🔖 **阅读进度记忆** — 自动保存阅读位置，关闭浏览器后可继续
- 📊 **进度指示器** — 页面右下角实时显示阅读进度
- 💬 **消息式挂载** — 启用后将阅读内容追加到最后一条对话消息下方，关闭后回到原对话位置
- ⚙️ **高度可定制** — 每页字数、每批页数、快捷键均可自定义

## 🚀 安装

### 从源码安装（开发者模式）

1. 克隆本仓库：
   ```bash
   git clone https://github.com/JuliusJu572/chatgpt-ebook-reader.git
   ```

2. 打开 Chrome，访问 `chrome://extensions/`

3. 开启右上角 **开发者模式**

4. 点击 **加载已解压的扩展程序**，选择克隆下来的项目目录

5. 完成！在 ChatGPT 页面中即可使用

## 📖 使用方法

### 上传电子书

1. 点击 Chrome 工具栏中的扩展图标，打开 Popup 面板
2. 在「上传」标签页中拖拽或点击上传电子书文件
3. 支持 `.pdf`、`.epub`、`.txt` 格式

### 快捷键

| 功能 | 默认快捷键 |
|------|-----------|
| 启用 / 禁用阅读器 | `Alt + Shift + E` |
| 下一批（向后翻页）| `Alt + Shift + →` |
| 上一批（向前翻页）| `Alt + Shift + ←` |

> 所有快捷键均可在 Popup 的「设置」标签页中自定义。

启用阅读器时，当前批次会作为一条独立的阅读消息追加到最后一条 ChatGPT 对话消息下方；禁用阅读器时会移除阅读消息，并滚动回最后一条原生对话消息附近。

### 设置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| 每页字数 | 2000 | 每"页"包含的字符数 |
| 每批页数 | 10 | 每次翻页渲染的页数 |

## 🏗️ 技术架构

```
chatgpt-ebook-reader/
├── manifest.json           # Chrome Extension Manifest V3
├── background/
│   └── service-worker.js   # 后台服务（数据中介 + 消息路由）
├── content/
│   ├── content.js          # 内容脚本主入口
│   ├── dom-adapter.js      # ChatGPT DOM 定位与滚动适配
│   ├── reader-mount.js     # 阅读器消息式挂载/移除管理
│   ├── renderer.js         # 聊天区域渲染引擎
│   ├── navigator.js        # 翻页导航逻辑
│   ├── shortcut.js         # 快捷键管理
│   └── indicator.js        # 页面状态指示器
├── popup/
│   ├── popup.html/css/js   # 弹窗界面（上传 + 书架 + 设置）
├── lib/
│   ├── pdf.min.js          # PDF.js（PDF 解析）
│   ├── jszip.min.js        # JSZip（EPUB 解析）
│   └── parser.js           # 统一电子书解析器
├── storage/
│   └── db.js               # 存储层封装
└── styles/
    └── chatgpt-mimic.css   # ChatGPT 回复样式模拟
```

### 核心设计

- **Manifest V3** — 符合 Chrome 最新扩展标准
- **Service Worker 数据中介** — 解决 content script 与 popup 之间的 IndexedDB origin 隔离问题
- **消息式挂载** — 通过 DOM 适配层定位最后一条原生消息，避免影响 ChatGPT 输入框布局
- **稳定位置模型** — EPUB 段落会生成 `locId`，书签和阅读进度优先使用稳定位置而不是临时页内序号
- **智能分页** — 新解析内容按段落边界分页，减少书签和目录跳转漂移

## ⚠️ 已知限制

- ChatGPT 的 DOM 结构可能随版本更新变化，渲染引擎中的选择器可能需要相应调整
- 超大 PDF 文件（>50MB）解析可能较慢
- 仅支持 ChatGPT 网页版（chatgpt.com / chat.openai.com）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。
