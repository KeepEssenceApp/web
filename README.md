# KeepEssence web

KeepEssence 的网页客户端：读的平台，加上网页收件箱。
The KeepEssence web app: read analyses, daily digests and notes, save from the web inbox, manage assistants and devices.

状态：v1.0 内测的范围做完了，对着契约的假核心验过；对着真核心和真机的验证见下面「没验的」。

## 它做什么

| 页面 | 内容 |
|---|---|
| 今天 | 状态栏、网页收件箱、还没进每日摘要的解读和条目；背景是当月的月历 |
| 每日摘要 | 最新一份，固定四部分，「读了，晚安」，按日期前后翻 |
| 笔记 | 快速查找、深挖队列、笔记（查看、下载、分享）、月历卡片 |
| 助手设置 | 助手和各步由谁做、接入一个助手、规则、设备（改名、改档、撤销、允许短码）、我的月历、通知、账户。只有管理档的设备有这个入口 |
| `/approve` | 允许一台设备：填或核对短码，可以调低权限 |
| `/authorize` | 允许一个助手：核心把浏览器转到这里 |
| `/share` | 系统分享菜单的落点：直接存入，回一句话 |

网页只经接口契约和核心说话（`contract/openapi.yaml`）。应用和接口同一个域名，所以请求都是相对路径 `/v1/...`。

## 结构

| 位置 | 内容 |
|---|---|
| `src/` | Vite + Preact + TypeScript，没有界面框架，手写的 CSS |
| `src/i18n/zh.ts`、`en.ts` | 界面上的每一句话，中英各一份。只用 `design/terms.md` 里的词 |
| `src/styles/app.css` | 样式。颜色、圆角、字号只取 `design/tokens.css`，不写色值 |
| `public/` | `manifest.webmanifest`、`sw.js`（通知和分享入口，不缓存接口应答）、图标 |
| `contract/`、`design/` | 从 spec 仓库拷来的契约、色表、用词表、词表。不在这里改；`npm run sync:spec` 重新拷 |
| `dev/fake-core.mjs` | 契约的内存假核心，内容全是编的。开发和端到端测试用 |
| `tests/` | 单元检查：颜色、用词、凭据、像密码的内容 |
| `e2e/` | Playwright 端到端：桌面和手机（带触摸）两种视口 |
| `docs/pitfalls.md` | 踩过的坑 |

## 开发

需要 Node 22。

```
npm install
npm run dev          # http://127.0.0.1:8792，/v1、/oauth、/mcp、/.well-known、/c 转给核心 http://127.0.0.1:8801
```

核心没跑起来时用假核心：

```
npm run fake         # 假核心，http://127.0.0.1:8803
npm run dev:fake     # 另开一个终端；同样是 8792，接口转给假核心
```

假核心的登录：任何 `@example.com` 的邮箱，验证码固定是 `246810`。它也直接提供构建好的 `dist/`（和线上一样，带单页回退），所以 `npm run build && npm run fake` 之后打开 `http://127.0.0.1:8803` 就是整套应用。

## 测试

```
npm run typecheck
npm test             # 单元检查
npm run build
npm run e2e          # 自己构建、起假核心，在 Chromium 的桌面和手机视口里跑
```

对着别的后端跑端到端：

```
BASE_URL=http://127.0.0.1:8792 LOGIN_EMAIL=you@example.com LOGIN_CODE=123456 npm run e2e
```

带 `BASE_URL` 时不起假核心；依赖假核心的示例内容和 `/__test/*` 的测试会跳过，`e2e/real-core.spec.ts` 只在这时跑（真的授权服务器、真的短码、助手存回笔记）。没有 `LOGIN_CODE` 时，测试用核心的管理接口取验证码：`ADMIN_SECRET` 是它的密钥，`ADMIN_URL` 是核心自己的地址（`BASE_URL` 是 Vite 时要给，Vite 不转 `/admin`）。

```
# 核心在 8801（见 ../core 的 README），Vite 在 8792
BASE_URL=http://127.0.0.1:8792 ADMIN_URL=http://127.0.0.1:8801 ADMIN_SECRET=… npm run e2e
```

截图（浅色深色、桌面手机各一套，放在 `screenshots/`，不进仓库）：

```
npm run build && npm run fake &
node dev/shots.mjs
```

三项自动检查各自守着一条验收标准：

| 检查 | 标准 |
|---|---|
| `tests/colours.test.ts` | W8：样式和组件里出现色表以外的颜色就失败 |
| `tests/words.test.ts` | W9：两份词典里出现「不用的词」就失败；组件里直接写中文也失败 |
| `tests/credential.test.ts`、`e2e/credential.spec.ts` | W11：凭据只进浏览器存储和请求头，不进页面 |

## 构建和部署

```
npm run build        # 产物在 dist/
npx wrangler deploy  # 只有静态文件的 Worker：keepessence-web，带单页回退
```

这个 Worker 没有路由。核心独占域名，把不是接口的请求经 service binding 转过来（决定 D4）。部署要 Cloudflare 的凭据，放在环境变量里，不进仓库。

## 先读

- [平台](https://github.com/KeepEssenceApp/spec/blob/main/product/platforms.md)：读的平台、设备权限、状态栏、通知。
- [产品形态](https://github.com/KeepEssenceApp/spec/blob/main/product/form.md)：读的界面。
- [验收标准](https://github.com/KeepEssenceApp/spec/blob/main/product/acceptance.md)：第 4 节 W1–W11。
- [UX mock](https://github.com/KeepEssenceApp/spec/tree/main/design/mock)：打开 `index.html#web`。
- 接口见 [spec/contract](https://github.com/KeepEssenceApp/spec/tree/main/contract)。

## 没验的

- 真机（iPhone、安卓）：加到主屏幕、系统分享菜单、真手指的左右滑、浏览器通知的到达。自动测试里是 Chromium 的手机视口加触摸。
- 线上（keepessence.app）。

## 参与

见 [贡献指南](https://github.com/KeepEssenceApp/.github/blob/main/CONTRIBUTING.md)。许可证：[AGPL-3.0](LICENSE)。
