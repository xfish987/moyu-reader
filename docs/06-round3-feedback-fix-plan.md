# UI B 第三轮反馈修复计划

日期：2026-08-06 · 分支：ui-b-rebuild

## 反馈条目与根因

### F1 全屏/沉浸模式下阅读文字消失（严重）
- 根因：`src/ui-b/ui-b.css` 的 `.ui-b .reader-view { grid-template-rows: 54px minmax(0,1fr) }` 与
  `styles.css` 的 `.reader-view.is-immersive { grid-template-rows: minmax(0,1fr) }` 同优先级且加载在后，
  沉浸模式下工具栏本不渲染，阅读区被自动布局挤进 54px 的第一行——这就是截图里顶部那条白色短条，正文区高度塌为零。
- 次生问题：`.ui-b .text-viewport` 中 `left: 50%` 被同声明块内后置的 `inset-inline: auto` 覆盖，
  居中失效（元素被 translateX(-50%) 甩到左侧半屏外）；
  `TextReader.jsx` 用外壳宽度（`shellRef`）计算列宽，而 UI B 可视文字区被限制在 `min(820px, 100%-56px)`，
  列宽与可视宽度不一致，窗口越大错位越严重。
- 修复：
  1. 补 `.ui-b .reader-view.is-immersive { grid-template-rows: minmax(0, 1fr) }`。
  2. `.ui-b .text-viewport` 改为 `inset-inline: 0; margin-inline: auto` 居中，去掉 transform。
  3. `TextReader.jsx` 的 ResizeObserver 改为观察 `.text-viewport` 自身，列宽 = 视口宽 − 2×页边距，
     `.ui-b .text-columns` 内边距改用 `var(--page-padding)`，保证「列宽+列距=翻页步长」恒等式在任何窗口尺寸成立。
  4. `.ui-b .epub-host` 高度改为 `calc(100% - 48px)`（它带 24px 上下外边距，100% 高度会溢出）。

### F2 背景图看不到图案、模糊过度、深浅对比失衡
- 根因：默认焦点统一 50%/50%，窄窗 cover 裁切后只剩天空；默认模糊 4px 叠加低对比让图案发灰；
  深色图（雪线寒夜）遮罩不足时亮字/暗字都可能糊。
- 修复：
  1. 每张内置预设登记焦点（按素材实际构图）：
     - 清夜湖光 reader-moon-blue → (76, 45)，月亮与花枝在右侧
     - 雪线寒夜 reader-moon-night → (75, 35)，月亮右上、雪线右下
     - 纸上花枝 home-paper-blossom → (82, 45)，花枝在右缘
     - 月下浅山 home-moon-light → (68, 55)，月左山右，取中山
     - 春日山水 home-spring → (72, 58)，亭与花右下
  2. 选中预设或主题自动匹配时自动带上焦点；用户手动调过位置则以用户为准（用户上传图不走自动焦点）。
  3. 主页默认：模糊 4→1px、不透明度 0.55、遮罩 0.06→0.12、饱和度 0.74→0.8、对比度 1.02。
     原则：图案靠「清晰+焦点」呈现，可读性靠「遮罩」兜底，不再靠模糊遮羞。
  4. 外观面板已有位置/缩放/对比度滑杆（本轮前已补），用户可继续微调。

### F3 删除主页「墨读书房 / 选择一本书，继续你的故事」场景标签
- 删除 `VirtualBookshelfHome.jsx` 中的 `.v-scene-label` 及对应 CSS。

### F4 管理页左侧导航自动隐藏，悬停弹出
- 桌面宽度（>680px）：`.app-navigation` 改为固定定位抽屉，默认 `translateX(-102%)` 收起；
  左侧留 16px 热区 `.shelf-nav-edge`，悬停热区或导航本身时滑出（180ms 过渡）。
  工作区随之占满整行（grid 改单列）。
- ≤680px 窄窗维持顶部横排形态（见 F5），不走抽屉。

### F5 窄窗顶部导航禁止横向滚动，纯图标全摆下
- ≤680px：导航按钮隐藏文字与计数（`span`/`small`），固定 40px 宽、居中图标，
  `overflow-x: visible`，4 个图标约 180px，360px 窗口可全部容纳。

## 不做的事
- 不再跑 CDP 回归脚本（效率低），仅保留生产构建验证语法；视觉验收由用户逐张反馈。
- 管理页内部「书架/笔记」切换保持不变。

## 后续（原计划保留）
- 生产构建 + electron-builder 便携 EXE。
- 提交 ui-b-rebuild 并推送 GitHub。
