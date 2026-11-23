# 本地开发

项目目录：`/root/workspace/videoApp`。使用 Node.js 22（`.nvmrc`）、pnpm 10.33.0（`package.json`）和系统 FFmpeg / FFprobe。脚本会自动加载当前用户的 nvm，无需手动修复终端 PATH。

```bash
cd /root/workspace/videoApp
./dev.sh install       # 首次安装或更新代码后，同步锁文件中的依赖
./dev.sh              # 前台开发，支持热更新，Ctrl+C 停止
```

默认访问 <http://127.0.0.1:3000>，可通过 `PORT` 环境变量修改端口。脚本可以从任意目录通过绝对路径调用。

启动脚本设置 `NEXT_TELEMETRY_DISABLED=1`，禁用 Next.js 使用统计遥测。已运行的服务需自行停止后重新执行 `./dev.sh`，才能加载新的启动环境。

## 后台运行

```bash
./dev.sh start         # 后台启动，等待 HTTP 和 SQLite 健康检查
./dev.sh status        # 查看后台进程
./dev.sh logs          # 跟随日志；Ctrl+C 仅退出日志查看
./dev.sh restart       # 重启后台服务
./dev.sh stop          # 停止后台服务及其子进程
```

前台和后台方式择一使用。`stop/status/logs` 管理脚本启动的后台服务；前台服务使用 Ctrl+C 停止。后台运行不依赖终端保持打开，但没有配置开机自启。

日志在 `.dev/server.log`，最近一次启动健康检查结果在 `.dev/health.json`；这些临时文件不会提交到 Git。

## 端口和网络

```bash
PORT=3002 ./dev.sh                  # 使用另一个端口
DEV_HOST=0.0.0.0 ./dev.sh restart    # 允许局域网访问
```

脚本在 Node.js 启动前读取本地 `.env.dev-shell`（已被 Git 忽略）。当前机器配置使用 `http://127.0.0.1:17897` 的 HTTP 代理，并启用 `NODE_USE_ENV_PROXY=1`，让服务端 `fetch` 也使用代理；本地地址保持直连。不会修改系统或 shell 配置。

修改代理端口后，需要在运行服务的终端按 Ctrl+C，再执行 `./dev.sh`。仅刷新网页不会更新服务进程的网络环境。可用以下命令临时覆盖配置：

```bash
DEV_PROXY_URL=http://127.0.0.1:17897 ./dev.sh
DEV_NO_PROXY=1 ./dev.sh             # 显式禁用代理，使用直连
```

Node.js 的环境代理支持需要 22.21 或更新的 22.x 版本（当前为 22.23.2）。若 Key 来自第三方兼容平台，必须在网页设置中填写该平台提供的 Base URL，不能仅填 Key 后沿用 OpenAI 官方地址。

## 数据与首次配置

- SQLite 数据库：`data/sqlite.db`，应用首次访问数据库时自动迁移。
- 上传文件：`data/uploads/`；生成文件：`data/output/`。备份时先停止服务，再备份整个 `data/`。
- 健康检查：<http://127.0.0.1:3000/api/health>，正常时 `db.status` 为 `ok`。
- 打开网页的「设置」配置 LLM 接口与 API Key；AI 生图、生视频需要对应供应商配置。密钥由你自行填写。
- 页面启动和数据库检查不调用付费 AI 服务，也不代表外部 AI、素材或配音服务已经验证可用。

## 常用开发命令

```bash
source "$HOME/.nvm/nvm.sh"
nvm use
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

如果更换了 Node.js 大版本，切回 `.nvmrc` 指定版本后运行 `corepack pnpm rebuild better-sqlite3`。不要使用 `npm install` 改写项目的依赖管理方式。

脚本面向当前 Ubuntu/Linux 环境，后台管理使用 `setsid`、`flock` 和 `/proc`。
