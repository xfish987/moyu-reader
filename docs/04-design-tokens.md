# UI B 设计 Token

- 圆角：控件 6px、面板 8px；不用胶囊式容器。
- 边框：默认 1px，依靠透明度和表面色区分层级。
- 动效：交互 140ms、面板 220ms，遵守 `prefers-reduced-motion`。
- 字体：`Segoe UI Variable, Microsoft YaHei UI, sans-serif`；正文独立字体栈。
- 颜色：使用 `--b-*` 语义 Token，提供雾蓝浅色和雪线深色映射。
- 控件状态：hover、active、focus-visible、disabled、loading 均有统一表现。
