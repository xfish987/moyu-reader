# 风险与禁止修改区

## 禁止改变的语义

- 书籍指纹、TXT 分块偏移、EPUB CFI/章节进度。
- 存储键及历史数据迁移流程。
- 防剧透内容截取和 AI 安全校验。
- `contextIsolation: true` 与 `nodeIntegration: false`。
- 无外部禁止修改区：原 `read/` 项目已退役删除，本仓库是唯一主项目。

## 主要风险

- 原 CSS 体积大且选择器全局化，新样式必须后加载并使用 `ui-b` 根作用域。
- `App.jsx` 承担大量业务编排，重构应以视图适配为主，避免同时重写状态管理。
- 多个辅助 BrowserWindow 共用 renderer 资源，Token 改动需要验证这些窗口。
- 自定义背景必须复制到 UI B 的 userData，不能保存临时源路径。

## 隔离证据

- 新 `appId`：`com.local.moyureader.uib`。
- 新产品名：`墨读书房 B`。
- 新 userData：`%APPDATA%/MoyuReaderUIB`。
- 新产物：`MoyuStudy-B-2.0.0.exe`。
