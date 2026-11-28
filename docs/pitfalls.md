# 踩过的坑

做网页时碰到的、下次还会碰到的事。

## 契约和规格

- **共用规则会变，别拷进代码。** 像密码的内容的识别规则写到一半时，契约把 `(?i)` 前缀改成了 `flags: i`，又补了一句「超过 `max_length_checked` 个字的不查」。应用从 `GET /v1/meta` 取规则，改的只有 `src/secret.ts` 里怎么编译；`tests/words.test.ts` 会在本仓库的拷贝和旁边的 spec 仓库不一致时失败，提醒跑 `npm run sync:spec`。
- **「不用的词」里有「深挖」。** 词表的比喻清单里列着「深挖（作动词或名词）」，可它同时是词表和用词表的正式词。`tests/words.test.ts` 把它单独放行，并在注释里写了原因。「设置」只禁作入口名：「助手设置」是正式词；接入指南里引用的别家菜单名（Gemini 的 Settings）也放行。
- **英文里绕开 home。** iPhone 上「加到主屏幕」的英文原文是 Add to Home Screen，而 home 在不用的词里。英文写成 the phone's main screen。
- **推送的内容契约没定。** 核心现在发的是 JSON `{ body, count, item_id, kind }`（看的是 core 的 `src/services/notify.ts`）。`sw.js` 取 `body` 当那一句话，有 `item_id` 就点开那一条，没有就开「今天」；不是 JSON 就把正文当那一句话。契约里该补上这个形状。

## 浏览器

- **开发代理的前缀会吃掉应用自己的路径。** Vite 的代理写成 `/c` 时，`/calendar` 也被转给了核心，得到 404。代理改成了正则：`^/(v1|oauth|\.well-known|c)/` 和 `^/mcp$`。对着真核心跑端到端才发现的；假核心按完整的路径段分，所以没露出来。

- **端到端的假核心端口是固定的。** 不设 `BASE_URL` 时，Playwright 用 8803，而且 `reuseExistingServer` 为真：两个检出（含 `git worktree`）同时跑端到端，会共用先起来的那个假核心。后起的一边测的其实是别人的构建，状态还会被对方的 `reset` 清掉（表现是测到一半被登出、`test-results` 里的文件找不到、`EADDRINUSE`）。同时跑时给自己起一个：`npm run build`，再 `PORT=8813 node dev/fake-core.mjs`，另开一个终端 `BASE_URL=http://127.0.0.1:8813 FAKE=1 npx playwright test`。
- **手机上滑动测试要先把卡片滚进视口。** Playwright 经 CDP 发触摸事件，坐标落在视口外不报错，只是什么都不发生。
- **无头 Chromium 的通知权限缺省是 denied，不是 default。** 测「只在点了通知我之后问一次」时，要在页面脚本里把 `Notification.permission` 换成可控的。
- **页面开着时不弹通知。** 规格要求读的界面开着的设备不弹。`sw.js` 发现有可见的窗口就只让页面刷新。Chrome 对「收到推送却不显示通知」有容忍次数，超过后会自己弹一条通用提示；如果内测里见到，就改成照常弹。
- **分享入口要 service worker 已经接管。** `share_target` 用的是 POST（这样才能带图片），由 `sw.js` 接住，把文件放进一个临时缓存，再转到 `/share` 由页面存入（凭据只有页面拿得到）。第一次打开还没装上 service worker 时，POST 会直接打到服务器；核心转给静态文件的 Worker 时要对 `POST /share` 回 303 到 `/share`（假核心是这么做的），否则会是 404/405。这个临时缓存是 `sw.js` 里唯一的缓存，接口应答不缓存。
- **选择文件要一个看得见的按钮去点隐藏的 `<input type=file>`。** 手机上拖不了，也基本贴不进文件（QA #95）。按钮是真的 `button`（键盘能到，Enter 打开选择器）；隐藏的 input 带 `multiple` 和与核心一致的 `accept`，Markdown 文件常常没有类型，所以 `accept` 里也列扩展名。选完要把 `value` 清空，否则拿掉的文件选不回来。端到端里用 `filechooser` 事件，取消用 `setFiles([])`；「存入」按钮用 `data-testid="inbox-save"` 找，因为 `.inbox .btn` 现在有两个。
- **所有图片都转成 WebP。** 动图（GIF）经 canvas 之后只剩第一帧。
- **色表里没有遮罩色。** 弹层后面的暗底用 `color-mix(in srgb, var(--ke-black) 55%, transparent)`，没有新增色值。
- **登录页恒为深色。** 靠在根元素上放 `data-theme="dark"`（色表支持），离开时去掉；不是另写一套颜色。
- **`overflow-wrap: anywhere` 会传给 flex 子项，把它压成一个字母宽。** `.main` 为了不让长地址撑宽页面设了 `overflow-wrap: anywhere`，这个值会继承；它让一个元素的最小内容宽度降到一个字符，所以 `.row.spread` 里「说明文字 + 开关」空间紧时，开关（flex 子项，默认可缩）被压到 62px，「On」拆成 O 和 n（QA #111：英文在 1440、360 等宽度拆行，1280 刚好放得下，只测手机或只测 1280 都会漏）。`.switch` 现在 `flex: none; white-space: nowrap; overflow-wrap: normal`，让旁边的说明去换行。以后在继承了 `anywhere` 的行里放短标签（开关、计数、状态词），都要给它们这三样；`e2e/qa-111.spec.ts` 按每个字母的纵坐标扫 1440 到 320 的宽度。
- **同一个类名两处用。** 月历组件的 `cal-card`（尺寸）和笔记页的卡片曾经撞名，卡片改叫 `month-card`。

## 文案与状态

- **换语言会把整个应用重新挂一遍。** 根元素按语言设了 `key`，所以账户页自己的状态（比如「界面语言已更改」那句确认）随旧页面一起没了。确认放在模块里的一个短时标记里，新挂上的账户页取走一次（见 `AssistantsPage.tsx` 的 `takeLanguageChanged`）。
- **新账号的状态栏不能说助手「还没来」。** 空账号里助手确实没来过，可那时没有东西等它，说「还没来」像在说它迟到了。状态栏只在有东西在等、助手又从没来过时才这么说；空账号里说下一步（QA #98）。假核心用 `reset({ empty: true, never_came: true })` 摆出这种账号：默认的假数据里内置助手几分钟前来过，看不到这句。
- **「今天还没有存入」只有日历答完才能说。** 今天的每日摘要一写出来，当天存入的条目就进了摘要，「今天」的列表是空的；只有日历（`has_digest`）知道摘要写了没有。条目和日历是两个互不等待的请求，条目先回来、日历还没回来（或失败了、或是上一次读取留下的旧答案）时，空列表既不能说「还没有存入」（那是说谎），也不能当成「没有摘要」。`src/today-empty.ts` 把这个决定放成一个纯函数：日历 `pending` 显示读取中，`failed` 照实说没读到并给「再试一次」，只有 `ready`（答的是这一次读取）才在 `in_digest` / `nothing` / `start` 里选。判断「这一次」靠读取时的 `tick` 随答案一起带回来，旧 `tick` 的答案只用来画月历的小点，不决定文案（`useLoad` 在重新读取期间保留旧数据，所以光看 `data` 有没有是不够的）。端到端不改应答，只把真实的日历应答按住（`page.route` 里先等后 `continue`），再看每个出现过的文字（`MutationObserver`）：见 `e2e/qa-44.spec.ts`；假核心有 `POST /__test/digest-today` 把今天没进摘要的条目收进今天的摘要。
- **摘要页上「这份收哪些」的那段说明（QA #110）不写数字，也不用「处理」。** 摘要头部下面有一行默认折叠的「每日摘要收哪些条目」（`digest.scope` / `digest.scope_body`，`DigestPage` 的头部，日历日详情里嵌入的那份用的是同一个组件）。两处有意的写法：① 核心每份最多取 200 条，但这个 200 是 core `src/services/digests.ts` 里 SQL 的字面量 `LIMIT 200`，契约 `x-limits` 里没有，所以文案只说「每份有上限 / up to a set limit per digest」；在它有了唯一来源（契约）并由 web 读取之前写一个数字，就是第二份拷贝，`tests/digest-scope.test.ts` 因此要求这两段文字里没有任何数字。② 中文里「处理」是用户自己对一条做的事（「今天处理过的」「还没处理」就在头部那一行），系统读完一条叫「解读」，所以这段里写「已经解读过（含没能解读出结果的）」，不写「处理过」；英文没有这个冲突，写 processed。③ 这一行是能按的，不矮于 44 px（W8，QA #110 复审）：`.scope summary` 用 `padding: 12px 0` 加 `min-height: var(--ke-control-height)`，不和 `.rest summary` 共用一条规则（后者是另一个控件，没动）；保持 `summary` 的 `list-item` 显示，改成 `display: flex` 会丢掉浏览器自带的开合小三角。窄屏（手机）的日历没有日详情旁栏，有摘要的那天是指向 `/digest/:day` 的链接，所以手机上走的是摘要页本身；`e2e/qa-110.spec.ts` 在 1280 和 412 两个项目里都读渲染出来的高度（`boundingBox`），并在顶边和底边各取一个点确认落在这个 `summary` 上。这段话只说选取规则，不说 21:00 冻结、不说「明天那份」、不说「没有丢」：核心交回时会重新选一次集合（`work.ts`），次日零点是上界，较晚解读完的、超出上限的、之后被删的都不在这份里。

## 弹层、底栏和页面宽度

- **条目自己的页面只在窄屏上有，宽屏上它在列表旁边。** `App.tsx` 里 1100 px 以上（`WIDE`）一个条目总是开在 `Split` 的右栏，左边那页（今天、笔记、每日摘要）已经带状态栏；1100 px 以下（手机是 760 px 以下）才是 `ItemPage` 自己的一页。所以状态栏（规则 A5，QA #108）只放在自己的页面上（`ItemPage` 的 `Top`），`panel` 里不放，否则宽屏上会有两条。测它要把视口放窄：手机项目是手机，桌面项目用 `setViewportSize` 到 900 px；宽屏上 `/item/:id` 打开也看不到这一页，别在 1280 px 上等它（`e2e/qa-108.spec.ts`）。

- **粘在底部的元素（`position: sticky` 或 `fixed`）自己就是一个层叠上下文。** 存入的弹层原来放在粘性的 `.inbox` 里面，它的 `z-index: 51` 只在那个上下文里算，比手机底栏（`z-index: 30`）低，底栏盖住了弹层的下半截，「存入」按钮看不见。现在 `.inbox` 是 `display: contents`，只有 `.savebar` 自己是粘性的，弹层和底栏在同一层比。症状是「按钮不见了」，原因是层，不是尺寸。
- **键盘出来时，只跟高度不够。** 手机上弹层贴着可视视口：`visualViewport` 的 `height`、`offsetTop`、`offsetLeft`、`width` 都要读（`lib.ts` 的 `useVisualViewport`）。只跟底部和高度，弹层会留在布局视口里，而可见的那一块因为放大或为了露出输入框左右移了，弹层就像在左右漂。`e2e/overflow.spec.ts` 里有一条用假的 `visualViewport` 验这件事。
- **页面左右晃，不要用 `overflow-x: hidden` 去盖。** 能被横向拖动，是因为有东西比屏幕宽（一个很长的不断词：网址、一串话题；负的外边距；`100vw`）。`.main` 上 `overflow-wrap: anywhere` 让长词在边上断开，`e2e/overflow.spec.ts` 在 320、360、390、430 px 上看每个页面、弹层打开时、带很长不断词的内容：文档宽度不超过窗口，`scrollX` 拖不动，没有元素伸出两边。
- **量位置要等动画停。** 弹层升起和放大时 `getBoundingClientRect` 是动画中的值（差过 24 px）。测试里等连续两次量到的一样再比。
- **剪贴板按钮要用户亲手点。** `navigator.clipboard.read()`、`readText()` 只在点击之类的用户动作里能用，Safari 还会弹一个「粘贴」的小条；读不了就打开弹层，让用户粘贴到框里，而不是静默失败。读到像密码的内容照旧先问（B4），问的时候文字还在框里。

## 标签

- **标签不显示，但页面还在读它。** A6：标签不给用户看，条目页只有「交给哪个助手」「保留多久」两个控件和一句话。可初筛前核心只放一个占位的保留天数，`ItemPage` 靠条目上有没有 `expiry:` 标签才知道这个值是不是用户自己选的，所以别把读取一并删掉。端到端里不要按 `.tags` 去查（那个类已经没有了）；要查就查页面里没有 `assistant:`、`expiry:`、`source:` 字样，要看核心有没有收下选择就 `GET /v1/items/{id}` 看标签（见 `e2e/qa-94.spec.ts`）。

## 端到端

- **几个会话同时跑端到端时，会共用 8803 这个端口。** `playwright.config.ts` 的 `reuseExistingServer` 在本机是真，第二个会话不会起自己的假核心，而是连到第一个会话的（那个会话的 `dist`）。结果是不相干的用例莫名其妙挂掉，而你改的功能「没生效」。跑之前看一眼 `lsof -nP -iTCP:8803 -sTCP:LISTEN`；有占用就用一份临时配置，换一个端口（`PORT=8815 node dev/fake-core.mjs`，`baseURL` 同步改），别提交这份配置。

## 工作区

- **共用的检出目录会被别人切分支、`reset --hard`。** 在 `web/` 里写到一半的改动被一次 `reset --hard origin/main` 清掉过。自己的工作放在 `git worktree add ../web-wt/<名字> -b <分支> origin/main`，`node_modules` 做个软链。

## 部署

- **用令牌部署要同时给 `CLOUDFLARE_ACCOUNT_ID`。** `wrangler.toml` 里没有 `account_id`：这个仓库是公开的，自托管的人用自己的账号，写死一个就让别人部署不了。只给令牌（wrangler 读的变量名是 `CLOUDFLARE_API_TOKEN`）时，wrangler 去调 `/memberships` 找账号，令牌没有这项权限就报 `10000` 鉴权失败。把账号 ID 放在环境变量 `CLOUDFLARE_ACCOUNT_ID` 里，和令牌放在一起，不进仓库；core 用的是同一个账号。用 `wrangler login` 登录的人不会碰到这个。

- **静态文件的地址，状态码 200 说明不了什么。** `wrangler.toml` 里 `not_found_handling = "single-page-application"`：不存在的路径一律回 200 加应用的页面，连 `.png` 结尾的也是（2026-11-27 在线上量过：`/brand/lockup-en-black.png` 在文件发布之前回 `200 text/html`）。所以邮件里引用的图片（`/brand/lockup-{en,zh}-black.png`，core 的邀请通知和验证码邮件用）要看 `Content-Type` 是 `image/png`、文件头是 PNG、字节和 `tests/brand.test.ts` 钉的 sha256 一致。**本地的假核心（`dev/fake-core.mjs`）对「有扩展名又不存在」的路径回 404，不回页面**，和线上不一样：端到端在假核心上通过，只说明构建里有这两个文件，不说明线上的回答；上线后要对真地址量一次。
- **标志文件是 marketing 的，按 sha256 钉住。** `public/brand/lockup-{en,zh}-black.png` 从 marketing 的 `brand/lockup/` 原样拷来（2026-11-27 取自 marketing 的 PR #2，提交 `b77cb15`，当时还不在它的 `main` 上）。不手改、不重画；那边换了文件，同时换这里的文件和 `tests/brand.test.ts` 里的 sha256，以及 core 的 `src/services/mailcopy.ts` 里写的显示宽度（高度 32 像素时，英文 137、中文 73）。

## 提交

- 仓库的提交钩子会跑 gitleaks。测试里用来验「像密码」规则的假样本会被它拦下，所以样本在测试里用几段字符串拼出来，不写成整串。

## 先显示、后确认的动作

- **手动改数据要作废在路上的读取。** 动作一按下就先改界面（卡片离开列表、开关拨过去），再发给核心。如果这时有一次稍早发出的读取还没回来，它带回的旧数据会把刚改的界面改回去，卡片闪一下又出现。`useLoad` 的 `set` 所以会让在路上的读取作废；核心答复后再读一次，以核心为准。
- **「挽回」可能比核心的答复先到。** 那句话是按下时就说的，上面的「挽回」如果在核心答复前被点了，要等那次答复回来再发撤销，否则两个请求的先后不定。
- **假核心的两个钩子**：`POST /__test/delay`（每个 `/v1` 应答等若干毫秒）和 `POST /__test/fail-next`（让下一个匹配的请求失败一次），用来看等待中和被拒绝时界面是什么样。

## 图片的告知

- **成功那一句不加字，说明放在存入之前。** 图片会被压缩（网页一律重编成 WebP、最长边不超过契约的 `image_long_edge_px`），用户有权知道，但每存一张都提醒会变成噪音，也不能弹窗要确认（B1）。所以只在「等着存入的文件」里有图片时，在旁边放一行小字（`Inbox.tsx`，分享页在结果下面），成功那句仍是核心原话。小字里的像素数和压缩用的是同一个 `imageLongEdge()`，不另存一份常量。
- **动图要自己数帧。** 网页把图片画进 canvas 再编成 WebP，动图只剩一张静态的画面；不能因为类型是 `image/gif` 就说「只保留了一帧」，静态的 GIF 并没有丢东西。`src/gif.ts` 顺着 GIF 的块数图像描述符，多于一个才说。说的是「一帧」，不说「第一帧」：已知的只有留下了一张。 只在核心说 `saved`（图存下了）时才说；`saved_image_skipped_quota`（超出配额，图没存）那一句本来就说「图片没存入」，再接「只保留了一帧」就是假话。
- **上限的单位是 MiB。** 契约的 `asset_max_bytes` 是 3,145,728 字节，是 3 MiB，不是 3 MB（3 MB 是 3,000,000 字节）。「文件超过 N」这句写 `{mib} MiB`，数字由 `src/size.ts` 的 `mib()` 算：整数就写整数，否则一位小数，**向下取整**，这样「超过 N」对每个被拒的文件都成立。别在界面上写 MB。
- **浏览器读不了图片，它自己的英文异常不能当原因给用户。** `createImageBitmap` 对坏图或只有图片名字的文件抛 `The source image could not be decoded.`，一开始直接落进了「没存入：…」，中文界面里出现一句英文。`toWebp` 现在把它换成 `Error("webp")`，`saveFile` 把这个说成已有的那句「这种文件存不了」，不另造一句话，也不猜原因（是坏了还是不支持，浏览器不告诉我们）。
- **说明小字的字以市场的主稿为准，不自己写。** 唯一有效的是 marketing `14726f8` 的 `content/copy-drafts/image-save-notices.md`：「图片会先在你的设备上处理再存入，长边超过 {px} 像素的会缩小；原图不上传。」。「不写的」里的几样（原图保存、高清、无损、每张都缩到 1600、3 MB、图里的字都读得出来）界面上一个也不写；`e2e/qa-87.spec.ts` 查这几个词。
