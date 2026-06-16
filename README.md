# Game Strategy Optimizer

AI agent 比赛数据追踪、版本分析、迭代优化工作流。

```
Agent Tank API → sync.js → SQLite → build_dashboard.js → arena.html
                                       → server.js → 实时看板
                                       → arena.js CLI → 分析/发布
```

## Quick Start

```bash
npm install
cp config.example.json config.json   # 填入 Tank Key
node scripts/server.js               # 打开 http://localhost:3000
```

浏览器打开后点击 **+ Register Tank** 输入你的 Tank Key 即可。

## 目录结构

```
├── scripts/                 # 核心代码
│   ├── server.js            # 看板服务 (localhost:3000)
│   ├── sync.js              # 从 API 拉取比赛数据
│   ├── build_dashboard.js   # 生成静态 arena.html
│   ├── arena.js             # CLI (30+ 命令)
│   ├── db.js                # SQLite 封装
│   ├── publish.js           # 发布代码版本
│   ├── batch.js             # 批量挑战
│   ├── record_iteration.js  # 记录迭代结论
│   └── lib/http.js          # HTTP 工具
├── arena-mcp-server/        # MCP Server (独立, 可选)
├── docs/                    # 文档
│   └── build_dashboard.js   # 看板生成备份
├── references/              # 参考文档
│   ├── db.md                # 数据库 schema
│   ├── iteration.md         # 迭代记录模板
│   ├── maps.md              # 地图策略
│   └── server.md            # API 文档
├── assets/                  # 静态资源
└── versions/                # 代码版本 (v1.js, v2.js...)
```

## CLI 常用命令

```bash
# 查看版本胜率排行
node scripts/arena.js versions

# 查看单版本详情
node scripts/arena.js version 75

# 分析版本 (新!) — 概览/地图分布/对比父版本/迭代记录
node scripts/arena.js analyze 75
node scripts/arena.js analyze 75 --json

# 对比两个版本
node scripts/arena.js compare 74 75

# 发布新版本
node scripts/publish.js versions/v86.js --tank RedStar --notes "adjust aim"
```

所有命令支持 `--tank <name>` 指定坦克、`--json` 输出 JSON。

## 项目特点

- **中英文切换** — 看板右上角语言按钮，所有动态内容（表格/分页/图表）均支持切换
- **多坦克支持** — 同一项目可管理多台坦克，标签页切换
- **版本隔离** — 迭代记录按 tankName 隔离，互不干扰
- **数据安全** — config.json（含 token）默认被 gitignore，不会上传

## 发布记录

- **v1.0.1** — i18n 全面覆盖，动态表格字段支持中英文切换
- **v1.0.0** — 初始发布
