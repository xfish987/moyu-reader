# UI B 调查报告

## 结论

- 唯一可信源项目：`D:\\tools\\book\\read`。
- 独立目标项目：`D:\\tools\\book\\moyu`。
- 源仓库在复制时为 `main@6f490392`，工作树干净。
- 目标通过本地 `git clone --no-hardlinks` 创建，源远程已改名为 `source-readonly`。

## 技术事实

- Electron 33.2、React 18.3、Vite 6、全局 CSS、Lucide React。
- Node 24.12，使用 `pnpm-lock.yaml`，通过 Corepack 调用 pnpm。
- 主进程负责文件扫描、TXT/EPUB 解析、磁盘存储、AI 请求和伴侣窗口。
- 渲染层通过 `electron/preload.cjs` 暴露的 `readerAPI` 调用 IPC。
- 现有发布方式为 electron-builder Windows portable。

## 数据边界

原版通过 Electron `userData` 写入 `data/reader-data.json`、`data/ai-settings.json`、缓存、备份和日志。UI B 强制改到 `%APPDATA%/MoyuReaderUIB`，不会写回原版数据目录。

## 基线命令

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm run build
corepack pnpm run dist
```
