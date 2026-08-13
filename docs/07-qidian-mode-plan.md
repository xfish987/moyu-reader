# 07 - 起点模式（主窗口内嵌起点阅读器）计划

## 背景与取舍

早期方案是"把起点书加进本地书架 + 独立网文窗口"，经讨论后放弃：本地阅读器与起点阅读器不应强行融合。新方案是**主窗口一键切换"起点模式"**——墨读变身为一个起点桌面客户端（类似起点手机版的桌面版），再点一次"起"回到本地阅读器，两个世界互不干扰。

原则：不逆向任何接口、不抓正文、不存账号凭证；登录、付费、章评（本章说）、书架收藏全部发生在起点官方页面里（内嵌 `<webview>`，`persist:qidian` 分区持久化登录态）。

## 功能范围

- 标题栏"快捷键"按钮左侧新增 **起** 按钮：点击切换 墨读本地阅读器 ↔ 起点模式（再点一次返回）。
- 起点模式 = 工具条 + 内嵌起点网页：
  - 主页 / 排行榜 / 我的书架（收藏）直达按钮；
  - 起点账号登录（走起点官方登录页，会话持久化，重启仍在）；
  - 书籍主页的"免费试读/立即阅读"等原生按钮正常可用，工具条另有"阅读"按钮代点它；
  - 目录按钮直达当前书籍目录页。
- 章节页自动进入**翻页阅读模式**（注入脚本实现）：
  - 页面净化为纯阅读内容（隐藏导航、推荐、打赏、二维码等）；
  - 正文按窗口宽度分页：A / D、← / →、空格、PageUp/PageDown、鼠标滚轮、页面左右边缘点击区，均可翻页；
  - 翻到本章末尾继续右翻自动进入下一章，章首左翻回上一章；
  - 字号随窗口宽度自适应（clamp），支持超窄窗口摸鱼阅读；
  - 段评（本章说）角标保留可点，评论面板为起点原生浮层。
- 摸鱼兼容：老板键（F10）、窗口置顶、超小窗口（minWidth 360）均不受影响。

## 实现要点

### 主进程 `electron/main.cjs`
- 主窗口 `webPreferences` 增加 `webviewTag: true`（仅此一处开启）。
- `STORE_KEYS` 增加 `reader:qidian-state`（记录起点模式最后浏览地址，重开续读）。
- 保留 `shell:open-external`（仅 https），供工具条"在浏览器打开"。
- 拆除旧方案的独立网文窗口、`webnovel:*` IPC、`webnovel` 存储键；`electron/webnovel.cjs`、`test-webnovel.mjs`、`src/WebnovelWindow.jsx`、网文 dock 图标一并移除。

### 渲染端
- `src/QidianMode.jsx`（新）：
  - 工具条：主页 / 排行榜 / 书架 / 阅读 / 目录 / 翻页（‹ ›，仅阅读模式显示）/ 刷新 / 浏览器打开；
  - `<webview partition="persist:qidian">`，初始地址为上次浏览页或起点主页；
  - `did-navigate` / `did-navigate-in-page` 去抖写回 `reader:qidian-state.lastUrl`；
  - `dom-ready` 后 `executeJavaScript` 注入阅读模式脚本（幂等），返回是否已激活，驱动翻页按钮与左右点击区的显隐；
  - `new-window`：起点域内当前页加载，域外交给系统浏览器。
- 注入脚本（运行于起点页面内）：
  - 仅当存在 `main.content`（章节页）时激活：`<html>` 加 `moyu-clean` 类，净化 CSS 隐藏 `#navbar`、`#left-container`、`#right-container`、`#r-breadcrumbs`、`#r-titlePage` 及 `.chapter-wrapper` 内非正文区块（选择器 2026-08 实测，失效时最坏只是看到原版页面）；
  - 正文容器改多栏水平分页：`column-width = 窗口宽 - 左右各 6vw`，`column-gap = 12vw`，每步滚动恰好一屏；窗口 resize 保持当前页码重排；
  - `window.__moyuPage(dir)`：右翻到末页 → 点击页面内"下一章"链接，左翻到首页 → "上一章"；
  - 键盘 / 滚轮（260ms 节流）翻页；输入框聚焦时不劫持按键。
- `src/App.jsx`：`qidianMode` 状态切换渲染 `<QidianMode />`；本地快捷键处理在起点模式下让位（A/D 归起点翻页）。
- `src/components/WindowBar.jsx`：快捷键按钮左侧加"起"切换按钮（激活态高亮）。
- 样式追加到 `src/styles.css`（工具条、点击区、起按钮），夜间主题沿用 `data-moyu-theme`。

## 验证

1. 已登录的测试浏览器内对真实章节页跑注入脚本：分页、翻页、自动下一章、段评可点。
2. `npm test` 无回归，`npm run build` 通过。
3. 应用内实测：起 → 登录 → 主页/排行/书架 → 开书 → 翻页阅读 → 目录 → 窄窗 → 再点"起"返回本地。
4. 版本号 2.2.14 → 2.3.0，`npm run dist` 出包，上传 GitHub Release。
