# 源架构图

## 平台层

- `electron/main.cjs`：窗口生命周期、文件系统、持久化、AI、IPC。
- `electron/preload.cjs`：唯一渲染端能力桥接。
- `electron/*Prompt.cjs`：AI 提示词与结构化结果处理。

## 应用层

- `src/App.jsx`：所有持久状态、书库合并、阅读会话和跨窗口同步。
- `src/components/Bookshelf.jsx`：书架、搜索、分类、批量、笔记库和设置入口。
- `src/components/ReaderView.jsx`：阅读工作区、目录、搜索、笔记、设定集与沉浸模式。
- `TextReader`、`LargeTextReader`、`EpubReader`：三类正文适配器，不改变解析语义。
- `ProfilesWindow`、`DictionaryWindow`、`CompanionWindow`：独立辅助窗口。

## UI B 边界

UI B 通过新的 Token、壳层、背景偏好和页面样式重组现有能力。解析、指纹、进度标识、AI 提示词、存储键和 IPC 合同保持兼容。
