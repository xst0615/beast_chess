# beast_chess - 经典棋类游戏合集与自媒体发布工具

一个纯 HTML/CSS/JavaScript 实现的经典棋类游戏合集，外加一套多平台自媒体一键发布工具。

## 项目内容

### 棋类游戏（纯静态页面，开箱即玩）

打开 `index.html` 即可通过主页进入所有游戏：

| 文件 | 说明 |
| --- | --- |
| `index.html` | 游戏合集主页 |
| `beast_chess.html` | Q萌斗兽棋（人机对战版） |
| `watermelon_chess.html` | Q萌西瓜棋（趣味对战） |
| `chinese_checkers.html` | 中国跳棋 |
| `military_chess.html` | 二人军棋 |
| `nine_rings.html` | 九连环 |

### 工具与内容页

| 文件 | 说明 |
| --- | --- |
| `agnes_video.html` | Agnes Video 视频生成工作台 |
| `article_shuixiang.html` | 文章页：《水象的小时候：眼泪是世界的雨季》 |

### media_hub/ - 多平台自媒体一键发布与数据看板

基于 Node.js + Express + Playwright 的自动化发布工具，支持微信公众号、今日头条等平台的文章发布（含 AI 配图、文字海报生成）。

## 部署方法

### 在线访问（GitHub Pages）

本仓库已启用 GitHub Pages，无需本地部署即可直接访问：

- 游戏主页：https://xst0615.github.io/beast_chess/
- Agnes Video 工作台：https://xst0615.github.io/beast_chess/agnes_video.html
- 其余页面：将文件名追加到 https://xst0615.github.io/beast_chess/ 后即可

推送到 main 分支后，GitHub Pages 会自动更新（通常 1-2 分钟内生效）。

### 棋类游戏（静态文件，本地运行）

无需构建，任选一种方式启动静态服务器：

```bash
# 方式一：Python（任选端口，如 9090）
python3 -m http.server 9090

# 方式二：Node.js
npx serve .
```

浏览器访问：

- 游戏主页：http://127.0.0.1:9090/index.html
- 斗兽棋：http://127.0.0.1:9090/beast_chess.html

也可以直接双击 `index.html` 在本地打开。

### media_hub 发布工具

```bash
cd media_hub

# 安装依赖
npm install

# 安装 Playwright 浏览器（首次使用需要）
npm run install-browser

# 启动服务（默认端口 3000）
npm start
```

访问 http://127.0.0.1:3000 打开控制台。

> 注意：发布功能依赖各平台的登录状态。首次使用需在弹出的浏览器中完成登录，会话数据保存在本地 `media_hub/data/sessions/`（已被 .gitignore 排除，不会上传）。

## 目录结构

```
.
├── index.html              # 游戏合集主页
├── beast_chess.html        # 斗兽棋
├── watermelon_chess.html   # 西瓜棋
├── chinese_checkers.html   # 中国跳棋
├── military_chess.html     # 二人军棋
├── nine_rings.html         # 九连环
├── agnes_video.html        # 视频生成工作台
├── article_shuixiang.html  # 文章页
├── media_hub/              # 自媒体发布工具
│   ├── server.js           # Express 服务入口
│   ├── public/             # 控制台前端
│   ├── data/               # 文章与会话数据（sessions 不入库）
│   └── *.js                # 诊断 / 测试脚本
└── .gitignore
```
