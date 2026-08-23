# 跨境电商标题工作流工具

一个面向小白的开箱即用 Web 工具，用来批量生成/优化 Amazon、Temu 平台的中英文商品标题，
并支持**上传素材图 → AI 识别生成热搜词 / 用户痛点 / 核心卖点**。

所有 AI 能力由 **你自己的 DeepSeek API Key** 驱动，前端自适应手机 / 平板 / 电脑。

---

## 一、功能清单

| 模块 | 说明 |
| --- | --- |
| ⚙️ API Key 设置 | 在网页上填写 DeepSeek Key（浏览器本地保存），或在部署平台配置环境变量 |
| 📝 标题生成 / 优化 | 选平台（Amazon / Temu）、语言（中文 / 英文），填商品信息 → 生成 5 条标题；填"已有标题"则做优化 |
| 🖼️ 图片识别 | 上传商品图 → 输出「商品识别 / 热搜词 / 用户痛点 / 核心卖点」四块结构化结果 |

## 二、技术架构

- 前端：单页 HTML + Tailwind CSS（CDN），自适应布局，发布目录 `public/`
- 核心逻辑：`core.py`（标题生成 + 图片分析，纯函数，无状态）
- 本地调试：`app.py`（Flask），访问 `http://localhost:8080`
- 云端生产：`netlify/functions/api.py`（Netlify Functions，复用 `core.py`）
- 配置：`netlify.toml`

> 接口统一为 `/api/*`：本地走 Flask；云端走 Netlify 函数 `/.netlify/functions/api`，前端自动切换。

## 三、本地运行（调试用，可选）

需要 Python（本项目已装在 `D:\WorkBuddyPython`）。双击 `start.bat` 即可启动，
浏览器打开 `http://localhost:8080`。本地调试时，页面填写的 Key 会额外写入 `.env`。

## 四、部署到 Netlify（生产环境，任何设备都能访问）

Netlify 连上 GitHub 后，**每次 `git push` 自动重新部署**，天然实现「改 bug / 更新后新版本自动上线」。

### 第 1 步：把代码推到 GitHub
1. 在 https://github.com 新建一个**空仓库**（不要勾选 README / .gitignore / License）；
2. 复制仓库 HTTPS 地址（形如 `https://github.com/你的用户名/仓库名.git`）；
3. 在本地项目目录执行（仓库地址替换成你自己的）：
   ```bash
   git remote add origin https://github.com/你的用户名/仓库名.git
   git branch -M main
   git push -u origin main
   ```

### 第 2 步：Netlify 关联 GitHub 并部署
1. 打开 https://app.netlify.com ，用 GitHub 账号登录；
2. 点 **Add new site → Import an existing project** → 选 GitHub，授权并选中你的仓库；
3. 部署设置（本项目已内置 `netlify.toml`，一般会自动识别，无需手填）：
   - Build command：留空（纯静态 + 函数，无需构建）
   - Publish directory：`public`
   - Functions directory：`netlify/functions`
4. 点 **Deploy site**，等待几十秒，Netlify 会给你一个 `https://xxxx.netlify.app` 的地址，
   手机、平板、电脑在任何网络下都能打开。

### 第 3 步：配置 DeepSeek API Key（重要）
两种方式二选一：
- **方式 A（推荐，最简单）**：直接在网页「⚙️ DeepSeek API 设置」里粘贴 Key，会保存在你浏览器本地；
- **方式 B（更稳，全站通用）**：Netlify 后台 → Site settings → Environment variables →
  新增 `DEEPSEEK_API_KEY`，值填你的 Key → 保存后触发一次重新部署。

## 五、如何「更新 / 修 bug 后自动上线」

1. 在本地修改代码（例如 `core.py`、`public/index.html`）；
2. 提交并推送到 GitHub：
   ```bash
   git add .
   git commit -m "修复 xxx / 新增 xxx"
   git push
   ```
3. Netlify 检测到 push **自动重新部署**，几十秒后新版本对所有用户生效，**无需手动操作**。

## 六、目录结构

```
crossborder-title-tool/
├── app.py                  # 本地 Flask 调试服务
├── core.py                 # 核心 AI 逻辑（标题 + 图片），本地和云端共用
├── config.py               # 配置（端口、版本号、Key）
├── updater.py              # 本地模式检查更新（git pull）
├── netlify.toml            # Netlify 构建/函数配置
├── netlify/functions/api.py# 云端 API 入口（Netlify Functions）
├── public/index.html       # 前端页面（发布目录）
├── requirements.txt        # 本地依赖
├── netlify/functions/requirements.txt
├── .env.example            # Key 配置模板（.env 已被 git 忽略）
├── version.txt             # 版本号
└── uploads/                # 用户图片暂存（已忽略）
```

## 七、安全须知

- `.env`（含你的 Key）已写入 `.gitignore`，**绝不会被提交到 GitHub**，请保持这个规则；
- 图片在前端压缩后直接发给 DeepSeek 官方接口处理，不会落盘到服务器；
- 不要把你的 DeepSeek Key 写进会被公开分享的配置文件。

## 八、常见问题

- **标题生成报错 `ERROR: 请先配置有效的 DeepSeek API Key`**：说明没填 Key 或填的是占位符。
- **图片识别报错 400**：确认使用模型 `deepseek-v4-flash-vision-exp`（代码已内置），且图片格式为 jpg/png/webp。
- **本地启动白屏**：确认已用 `start.bat` 启动 Flask，且访问 `http://localhost:8080`（不是直接双击 html）。
