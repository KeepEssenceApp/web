// An in-memory fake of the client side of contract/openapi.yaml, for developing and testing
// the web app before the real core runs. One user, made-up content, nothing persisted.
//   node dev/fake-core.mjs            (port 8803, PORT overrides)
// It also serves ../dist with single-page-application fallback, as production does.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 8803);
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const LOGIN_CODE = "246810";
const TZ_OFFSET_MS = 8 * 3600e3; // the seeded user lives in Asia/Shanghai
const DAY = 86400e3;

// ---------------------------------------------------------------- contract constants
const LIMITS = {
  item_expiry_default_days: 30, item_expiry_max_days: 365, expiry_options_default: [7, 30, 90, 365],
  claim_minutes: 30, claim_max_items: 10, device_code_minutes: 10, login_code_minutes: 10,
  login_code_max_attempts: 5, device_idle_days: 90, asset_max_bytes: 3145728, image_long_edge_px: 1600,
  storage_quota_bytes: 1073741824, triage_per_user_per_day: 200, triage_default_after_minutes: 10,
  page_fetch_timeout_seconds: 8, queue_idle_days: 7, analysis_summary_max_chars: 60, analysis_points_max: 3,
  notify_wait_seconds: 120, notify_max_wait_seconds: 600, text_max_chars: 200000,
};
const SHARED_RULES = {
  secret_like: {
    description: "Content that looks like a password or a credential. A client must ask the user before saving it, and must not silently drop it. A match on any pattern counts.",
    max_length_checked: 200,
    patterns: [
      { name: "private_key_block", regex: "-----BEGIN [A-Z ]*PRIVATE KEY-----" },
      { name: "known_credential_prefix", regex: "\\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\\b" },
      { name: "bearer_or_basic_header", regex: "\\b(authorization|bearer|basic)[:= ]+[A-Za-z0-9._~+/=-]{16,}", flags: "i" },
      { name: "assignment_of_secret", regex: "\\b(pass(word|wd)?|secret|api[_-]?key|access[_-]?key|private[_-]?key)\\s*[:=]\\s*\\S{6,}", flags: "i" },
      { name: "single_dense_string", description: "One line, no spaces, 12 to 64 characters, with a lower-case letter, an upper-case letter, a digit and a symbol, and not a URL.", regex: "^(?!https?://)(?=\\S*[a-z])(?=\\S*[A-Z])(?=\\S*\\d)(?=\\S*[^A-Za-z0-9])\\S{12,64}$" },
    ],
  },
  save_messages: {
    description: "The one sentence a saving client shows. The core returns the key and the text.",
    saved: { zh: "已存入。", en: "Saved." },
    duplicate: { zh: "之前存过了，没有重复存。", en: "Already saved. Nothing was added." },
    saved_image_skipped_quota: { zh: "已存入。图片没存入：超出存储配额。", en: "Saved. The image was not stored: storage quota exceeded." },
    queued_offline: { zh: "还没存入，排着队，联网后自动存入。", en: "Not saved yet. Queued, and it will be saved when you are back online." },
    failed: { zh: "没存入：{reason}", en: "Not saved: {reason}" },
    queued_not_connected: { zh: "还没存入，排着队，接入后自动存入。", en: "Not saved yet. Queued, and it will be saved once this device is connected." },
    declined: { zh: "没存入。", en: "Not saved." },
    secret_like_question: { zh: "这段内容看起来像密码或凭据，还要存入吗？", en: "This looks like a password or a credential. Save it anyway?" },
  },
  verdicts: {
    worth_deep_dive: { zh: "值得深挖", en: "Worth a deep dive" },
    good_to_know: { zh: "知道就行", en: "Good to know" },
    skippable: { zh: "可以略过", en: "Skippable" },
  },
  content_unavailable: { zh: "没取到内容", en: "Content could not be fetched" },
  notifications: {
    one_analysis: { zh: "「{title}」的解读好了，可以看判定。", en: "The analysis of “{title}” is ready. You can see the verdict." },
    one_deep_read: { zh: "「{title}」的精读好了，可以去深挖队列看精读。", en: "The deep read of “{title}” is ready. See it in the deep-dive queue." },
    many_analysis: { zh: "{n} 条的解读好了，可以去看。", en: "{n} analyses are ready." },
    many_deep_read: { zh: "{n} 条的精读好了，可以去看。", en: "{n} deep reads are ready." },
    many_mixed: { zh: "{n} 条处理好了，可以去看。", en: "{n} items are ready." },
  },
  opening_line: {
    description: "What a user sends to a chat assistant to start a deep dive. It carries no content; the assistant fetches it.",
    zh: "深挖这一条：{first_line}", en: "Deep dive into this item: {first_line}",
  },
};
const ERRORS = {
  bad_request: ["请求的格式不对，或有一项超出了范围。", "The request is malformed or a field is out of range."],
  unauthorized: ["没有登录，或这台设备已被撤销。", "Not signed in, or this device was revoked."],
  forbidden: ["这台设备的权限做不了这件事。", "This device's tier does not allow this."],
  not_found: ["没有这样东西。", "No such thing."],
  conflict: ["和现在的状态冲突。", "The request conflicts with the current state."],
  gone: ["它已经失效了。", "It is no longer available."],
  too_large: ["文件超过了 3 MB。", "The file is larger than 3 MB."],
  unsupported_type: ["不支持这种文件。", "This file type is not supported."],
  rate_limited: ["请求太多，稍后再试。", "Too many requests. Try again later."],
  not_invited: ["这个邮箱不在邀请名单里。", "This email is not on the invitation list."],
  last_manager: ["这是最后一台管理档的设备，不能降档或撤销。", "This is the last device with the manage tier. It cannot be lowered or revoked."],
  idempotency_key_required: ["缺少 Idempotency-Key。", "The Idempotency-Key header is missing."],
  server_error: ["核心出了问题。", "Something went wrong in the core."],
};
const TIERS = ["save", "read", "manage"];
const STEPS = ["triage", "analysis", "digest", "deep_read", "deep_dive"];
const ASSET_TYPES = ["image/webp", "image/png", "image/jpeg", "image/gif", "application/pdf", "text/plain", "text/markdown"];
const CLIENTS = ["web", "phone", "extension", "shortcut", "share", "menubar", "eink"];

class HttpError extends Error {
  constructor(status, code, message) { super(code); this.status = status; this.code = code; this.text = message; }
}
const fail = (status, code, message) => { throw new HttpError(status, code, message); };

// ---------------------------------------------------------------- helpers
const iso = (ms) => new Date(ms).toISOString();
const ago = (ms) => iso(Date.now() - ms);
const dayOf = (ms) => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
const today = () => dayOf(Date.now());
const dayN = (n) => dayOf(Date.now() - n * DAY); // n days ago
const rid = (p, n = 8) => `${p}_${crypto.randomBytes(n).toString("hex")}`;
const rank = (t) => TIERS.indexOf(t);
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return null; } };
// As the core does for a title made from the first sentence: cut at a word or clause, end with "…".
function shorten(text, max) {
  const chars = [...text];
  if (chars.length <= max) return text;
  const head = chars.slice(0, max - 1);
  let cut = head.length;
  for (let i = head.length - 1; i >= Math.floor(head.length * 0.6); i--) if (/[\s,;:，；：、。.!?！？]/.test(head[i])) { cut = i; break; }
  return head.slice(0, cut).join("").replace(/[\s,;:，；：、]+$/, "") + "…";
}
const normCode = (c) => decodeURIComponent(c).toUpperCase().replace(/[^A-Z0-9]/g, "");

// ---------------------------------------------------------------- state and seed
let S;
// The account a user deleted themselves (DELETE /v1/account), for the tests to see. A reset forgets it.
let DELETED = null;

function analysis(a, summary, key_fact, points, verdict, related_hint = null, created = 30 * 60e3) {
  return { unavailable: false, summary, key_fact, points, verdict, related_hint, assistant: { id: a.id, name: a.name }, created_at: ago(created) };
}

function seed(opts = {}) {
  const builtin = { id: "as_builtin", name: "内置助手", kind: "scheduled", steps: ["analysis", "digest"], built_in: true, connected_at: null, last_seen_at: ago(4 * 60e3), runs_at: null };
  const adu = { id: "as_adu", name: "阿读", kind: "scheduled", steps: ["analysis", "digest", "deep_read", "deep_dive"], built_in: false, connected_at: ago(20 * DAY), last_seen_at: ago(50 * 60e3), runs_at: "agent.example.com" };
  const ashen = { id: "as_ashen", name: "阿深", kind: "chat", steps: ["deep_dive"], built_in: false, connected_at: ago(12 * DAY), last_seen_at: ago(3 * DAY), runs_at: "chat.example.com" };
  S = {
    user: { id: "u_reader", timezone: "Asia/Shanghai", lang: "zh" }, email: "reader@example.com",
    devices: new Map(), creds: new Map(), assistants: [builtin, adu, ashen],
    settings: {
      rules: "讲工程实践的长文交给阿读，保留 90 天。\n新闻和版本发布保留 7 天。",
      expiry_options: [7, 30, 90, 365], notify: true,
      roles: { analysis: "as_builtin", digest: "as_builtin", deep_read: "as_adu", deep_dive: "as_ashen" },
      calendar_enabled: false, calendar_secret: crypto.randomBytes(16).toString("hex"),
    },
    items: new Map(), digests: new Map(), queue: new Map(), notes: [], assets: new Map(),
    saved: new Map(), noteDays: new Set(), idem: new Map(), codes: new Map(), oauth: new Map(),
    pushes: [], decisions: [], lastSaved: null, noDigestReason: opts.no_digest_reason, overQuota: !!opts.over_quota,
    delay: 0, failNext: null,
    pushKey: (() => { const e = crypto.createECDH("prime256v1"); e.generateKeys(); return e.getPublicKey().toString("base64url"); })(),
  };
  // An account that exists already, in this language: signing in does not change it.
  if (opts.account_lang) { S.user.lang = opts.account_lang; S.signedInOnce = true; }
  S.devices.set("dev_ext", { id: "dev_ext", name: "Chrome 扩展 · Mac", category: "client", client: "extension", tier: "save", created_at: ago(9 * DAY), last_used_at: ago(3 * 3600e3), notifications: false });
  S.oauth.set("req_demo", { client_name: "Example Chat", client_uri: "https://chat.example.com", redirect_host: "chat.example.com", steps_requested: ["deep_dive"], state: "xyz" });
  S.oauth.set("req_agent", { client_name: "My Agent", client_uri: null, redirect_host: "agent.example.com", steps_requested: ["analysis", "digest", "deep_read", "deep_dive"], state: "xyz" });
  // An empty account is a new one: this is its first month, as the core would say.
  if (opts.empty) { S.firstMonth = true; return; }

  const put = (it) => S.items.set(it.id, { kind: "link", site: null, url: null, stage: "analysed", content_unavailable: false, dispatch_to: { id: builtin.id, name: builtin.name }, expiry_days: 30, pinned: false, signal: null, analysis: null, body: null, asset_id: null, digest_day: null, source: "web", ...it });
  const H = 3600e3;
  // Today: not yet in a daily digest.
  put({ id: "it_saved", title: "写给自己的发布检查单", site: "notes.example.net", url: "https://notes.example.net/release-checklist", created_at: ago(2 * 60e3), stage: "saved", dispatch_to: null });
  put({ id: "it_triaged", kind: "text", title: "读书会备忘：下周讨论第三章", created_at: ago(20 * 60e3), stage: "triaged", dispatch_to: { id: adu.id, name: adu.name }, body: "读书会备忘：下周讨论第三章\n每人带一个自己工作里的例子，说明「先定接口再写实现」哪里行得通，哪里行不通。" });
  put({ id: "it_worth", title: "租约与认领：一份活怎么只归一个人", site: "blog.example.dev", url: "https://blog.example.dev/leases", created_at: ago(1 * H), body: "任务队列里，一份活同时只该有一个人在做。常见的做法是认领加租约……",
    analysis: analysis(builtin, "用租约解决任务队列里「一份活两个人做」的问题，给出了三条可照做的规则。", "文章 · 约 3200 字", ["认领必须带期限，过期自动放回。", "交回要能重放：同一份交两遍只留一份。", "续期只能由持有者做。"], "worth_deep_dive", "和上周存的《持久化执行的三件事》讲的是同一个问题。", 40 * 60e3) });
  put({ id: "it_queued", title: "durable-harness：可重放的工具调用", site: "code.example.com", url: "https://code.example.com/example/durable-harness", created_at: ago(2 * H), dispatch_to: { id: adu.id, name: adu.name },
    analysis: analysis(adu, "一个把工具调用记成「意图、效果、结果」三段的小库，崩溃后可以接着跑。", "代码仓库 · TypeScript · 1.2k 星", ["每次调用先落一条意图。", "重放时跳过已有结果的调用。"], "worth_deep_dive", null, 90 * 60e3) });
  put({ id: "it_know", title: "十分钟看懂向量检索", site: "video.example.com", url: "https://video.example.com/watch/vec-10min", created_at: ago(3 * H),
    analysis: analysis(builtin, "用动画讲了向量检索的基本思路：把文字变成坐标，再找最近的点。", "视频 · 10 分 24 秒", ["近似最近邻是用精度换速度。", "索引要随数据重建。"], "good_to_know", null, 2 * H) });
  put({ id: "it_skip", title: "某构建工具发布 2.4 版", site: "news.example.org", url: "https://news.example.org/build-tool-2-4", created_at: ago(4 * H), expiry_days: 7,
    analysis: analysis(builtin, "例行版本更新：启动快了一些，修了几个缺陷，没有破坏性改动。", "新闻 · 约 400 字", ["冷启动快了约一成。"], "skippable", null, 3 * H) });
  put({ id: "it_unavail", title: "example.org 上的一个页面", site: "example.org", url: "https://example.org/members/only", created_at: ago(5 * H), content_unavailable: true,
    analysis: { unavailable: true, summary: "没取到内容", assistant: { id: builtin.id, name: builtin.name }, created_at: ago(4 * H) } });
  S.queue.set("it_queued", { item_id: "it_queued", added_at: ago(90 * 60e3), deep_read: "waiting", report: null, went_at: null, fetched_at: null, entry: null });

  // Daily digests for the previous five days; yesterday's is unread.
  const worthPool = [
    ["把评审意见写成可以执行的句子", "评审意见要写成对方能直接照做的一句话，文中给了六个改写的例子。"],
    ["为什么小团队不该先上微服务", "拆服务的成本先于收益到来，作者用三个团队的经历说明什么时候才值得拆。"],
    ["一次线上事故的完整复盘", "事故的根因不是那一行代码，而是没人知道那个开关还连着线上。"],
    ["提示词不是咒语：怎么系统地改它", "把提示词当成代码来改：有样例、有对照、一次只动一处。"],
    ["本地优先的软件是什么意思", "数据先在自己的设备上，联网只是同步；文章列了七条判断标准。"],
    ["读论文的三遍法", "第一遍只看标题、摘要和图，决定值不值得读第二遍。"],
    ["给接口起名字的十条经验", "名字要说明它做什么，不说明它怎么做；十条里有四条讲的是别起什么名字。"],
    ["缓存失效为什么难", "难的不是失效本身，而是失效和写入之间的那一小段时间。"],
    ["写好一份设计文档的开头", "开头只回答三个问题：要解决什么、不解决什么、怎么算做完。"],
    ["长期主义者的周计划", "周计划只列三件事，其余的都算机动；作者坚持了两年的记录。"],
  ];
  const restPool = ["某数据库发布了新的小版本", "一张讲清楚时区的图", "键盘布局的简短历史", "周末做的一个小工具", "关于会议纪要的一条短帖", "一个字体的更新说明", "终端配色方案合集", "某播客的一期节目单", "读者来信：关于上一篇的补充", "一份开源许可证的对比表", "路由器固件的更新日志", "如何给照片批量改名", "一个命令行小技巧", "某大会的日程表", "排版里的避头尾规则", "旧文重读：关于专注", "一份咖啡冲煮参数表", "一个日历应用的评测", "文件同步工具的三种思路", "关于写作节奏的一段话"];
  for (let n = 1; n <= 5; n++) {
    const day = dayN(n), ids = [], at = (h) => ago(n * DAY + h * H);
    const add = (suffix, title, extra) => {
      const id = `d${n}_${suffix}`; ids.push(id);
      put({ id, title, site: "read.example.com", url: `https://read.example.com/${id}`, created_at: at(ids.length), digest_day: day, ...extra });
    };
    const w = (i) => worthPool[(n - 1) * 2 + i];
    add("w1", w(0)[0], { line: w(0)[1], analysis: analysis(builtin, w(0)[1].slice(0, 58), "文章 · 约 2800 字", ["结论在第二节。"], "worth_deep_dive", null, n * DAY) });
    add("w2", w(1)[0], { line: w(1)[1], analysis: analysis(builtin, w(1)[1].slice(0, 58), "文章 · 约 1900 字", ["有三个例子。"], "worth_deep_dive", null, n * DAY) });
    const r = (i) => restPool[(n - 1) * 4 + i];
    add("r1", r(0), { analysis: analysis(builtin, "一条简短的更新，没有需要跟进的地方。", "新闻 · 约 300 字", [], "good_to_know", null, n * DAY) });
    add("r2", r(1), { analysis: analysis(builtin, "内容很短，看标题就够了。", "帖子 · read.example.com", [], "skippable", null, n * DAY) });
    add("r3", r(2), { signal: "not_interested", analysis: analysis(builtin, "一篇背景介绍，写得清楚。", "文章 · 约 1500 字", ["适合当参考。"], "worth_deep_dive", null, n * DAY) });
    add("r4", r(3), { signal: "seen", analysis: analysis(builtin, "一个小工具的介绍。", "文章 · 约 700 字", [], "good_to_know", null, n * DAY) });
    if (n === 2) { add("q1", "认领过期之后：重放安全的三种做法", { analysis: analysis(adu, "比较了三种让交回可以重放的做法。", "文章 · 约 4100 字", ["按内容去重最省事。"], "worth_deep_dive", null, n * DAY) }); }
    if (n === 3) { add("q1", "从零写一个定时任务调度器", { analysis: analysis(adu, "一步步写出一个能错过补跑的调度器。", "文章 · 约 5200 字", ["补跑要有上限。"], "worth_deep_dive", null, n * DAY) }); }
    S.digests.set(day, {
      day, read: n > 1, item_ids: ids, saved: ids.length + 2,
      summary: `这一天存入了 ${ids.length + 2} 条。两条讲的是怎么把事情做得可重复、可检查，值得坐下来细看；其余的多是版本更新和短帖，知道有这回事就行。`,
      question: ["如果只能留下今天读到的一句话，会是哪一句？", "手上哪件事，其实缺的只是一个期限？", "上一次改变主意，是因为读到了什么？", "哪一条规则是你自己定的，却最常自己破？", "明天最想弄明白的一个问题是什么？"][n - 1],
      assistant: { id: builtin.id, name: builtin.name },
    });
    S.saved.set(day, ids.length + 2);
  }
  S.queue.set("d2_q1", { item_id: "d2_q1", added_at: ago(2 * DAY), deep_read: "ready", went_at: ago(20 * H), fetched_at: ago(19 * H), entry: "https://agent.example.com/dive/abc",
    report: { read: "文章比较了三种做法：按请求键去重、按内容去重、按版本号拒绝旧的交回。作者的结论是按内容去重最省事，但要求结果是确定的。", found: "另外查了两篇相关的文章：一篇讲租约的时钟漂移，一篇讲幂等键该存多久。两篇都同意「期限要比最慢的一次处理长」。", questions: ["结果不确定（比如带时间戳）时，按内容去重还成立吗？", "幂等键存 7 天的依据是什么？", "续期失败时该放弃还是做完再交？"], assistant: { id: adu.id, name: adu.name } } });
  S.queue.set("d3_q1", { item_id: "d3_q1", added_at: ago(5 * H), deep_read: "reading", report: null, went_at: null, fetched_at: null, entry: null });

  // Notes.
  const note = (id, daysAgo, title, body, sources, itemId) => {
    const it = S.items.get(itemId);
    S.notes.push({ id, title, body, created_at: ago(daysAgo * DAY + 2 * H), assistant: { id: ashen.id, name: ashen.name, submitted_by_user: id === "n3" },
      origin: it ? { item_id: it.id, item_title: it.title, item_url: it.url, digest_day: it.digest_day } : null, sources, asset_ids: [] });
    S.noteDays.add(dayN(daysAgo));
  };
  note("n1", 1, "一份活只归一个人：认领、租约、重放", "一份活同时只归一个助手，靠的是**认领**；认领会过期，靠的是**租约**；过期之后别人接着做不出乱子，靠的是**重放安全**。三件事缺一件，另外两件都白做。\n\n## 结论\n\n1. 租约定 30 分钟，比最慢的一次处理长。\n2. 交回按内容去重，同一份交两遍只留后一次。\n3. 不能重放的工具，不在取活的路上调用。\n\n## 还没想清楚的\n\n- 时钟不准时租约怎么算。\n- 详见 [Leases in job queues](https://blog.example.dev/leases)。", [{ title: "Leases in job queues", url: "https://blog.example.dev/leases" }, { title: "Durable harness: intent, effect, result", url: "https://code.example.com/example/durable-harness" }], "d2_w1");
  note("n2", 4, "评审意见的写法", "评审意见写给要改的人看，不是写给自己看。\n\n## 三条\n\n- 说**哪里**，引用原句。\n- 说**为什么**，一句话。\n- 说**怎么改**，给一个可以直接用的版本。\n\n> 一条意见如果对方看完不知道下一步做什么，就等于没写。", [{ title: "把评审意见写成可以执行的句子", url: "https://read.example.com/d4_w1" }], "d4_w1");
  note("n3", 12, "向量检索的边界", "向量检索擅长「意思相近」，不擅长「一字不差」。\n\n## 什么时候不用它\n\n- 找编号、人名、报错原文：用关键词。\n- 数据不到一万条：直接全扫，`cosine` 算一遍也很快。\n\n## 什么时候用\n\n问题和答案的用词不一样的时候。", [{ title: "十分钟看懂向量检索", url: "https://video.example.com/watch/vec-10min" }], null);
  note("n4", 31, "设计文档的开头只回答三个问题", "开头不写背景，写这三句：\n\n1. 要解决什么。\n2. **不**解决什么。\n3. 怎么算做完。\n\n背景放到后面，给需要的人看。", [{ title: "写好一份设计文档的开头", url: null }], null);

  // Days further back: some saved, some empty.
  for (let n = 6; n <= 75; n++) { const k = (n * 7) % 5; if (k) S.saved.set(dayN(n), k + 2); }
  S.saved.set(today(), 7);

  if (opts.no_deep) {
    // Nobody can deep read or deep dive: only the built-in assistant is left.
    S.assistants = [builtin];
    S.settings.roles = { ...S.settings.roles, deep_read: null, deep_dive: null };
    for (const it of S.items.values()) if (it.dispatch_to?.id !== builtin.id) it.dispatch_to = { id: builtin.id, name: builtin.name };
  }
  if (opts.no_assistants) {
    // Every assistant has come before and none lately. One that has never come counts as
    // expected soon, and the status bar is then not red.
    builtin.last_seen_at = ago(4 * DAY); adu.last_seen_at = ago(5 * DAY); ashen.last_seen_at = ago(6 * DAY);
    for (const it of S.items.values()) if (!it.digest_day) { it.analysis = null; it.stage = it.stage === "saved" ? "saved" : "triaged"; it.content_unavailable = false; }
    S.items.get("it_unavail").created_at = ago(27 * DAY);
    S.queue.delete("it_queued");
    S.noDigestReason = "no_assistant";
  }
}

// ---------------------------------------------------------------- views
const inQueue = (id) => S.queue.has(id);
const assistantById = (id) => S.assistants.find((a) => a.id === id);
// The term counts from when the item was saved, or from when a kept item got an end date again.
const termStart = (it) => it.term_from ?? Date.parse(it.created_at);
function daysLeft(it) {
  if (it.pinned) return null;
  return Math.max(0, it.expiry_days - Math.floor((Date.now() - termStart(it)) / DAY));
}
function itemOut(it, detail = false) {
  const o = { id: it.id, kind: it.kind, title: it.title, site: it.site, url: it.url, created_at: it.created_at, stage: it.stage, content_unavailable: it.content_unavailable,
    dispatch_to: it.stage === "saved" && !it.user_assistant ? null : it.dispatch_to, days_left: daysLeft(it), pinned: it.pinned, signal: it.signal, in_queue: inQueue(it.id), analysis: it.analysis };
  if (!detail) return o;
  const tags = [];
  if ((it.stage !== "saved" || it.user_assistant) && it.dispatch_to) tags.push(`assistant:${it.dispatch_to.name}`);
  // A kept item has no end date, so no expiry tag is listed for it.
  if ((it.stage !== "saved" || it.user_set) && !it.pinned) tags.push(`expiry:${it.expiry_days}`);
  tags.push(`source:${it.source}`);
  return { ...o, body: it.body, asset_id: it.asset_id, tags, expiry_days: it.pinned ? null : it.expiry_days,
    expires_at: it.pinned ? null : iso(termStart(it) + it.expiry_days * DAY) };
}
function deviceOut(d, me) {
  return { id: d.id, name: d.name, category: "client", client: d.client, tier: d.tier, created_at: d.created_at, last_used_at: d.last_used_at, notifications: !!d.notifications, this_device: d.id === me?.id };
}
const assistantDevice = (a) => ({ id: a.id, name: a.name, category: "assistant", steps: a.steps, created_at: a.connected_at ?? ago(0), last_used_at: a.last_seen_at, notifications: false, this_device: false });
function settingsOut(origin, tier) {
  const s = S.settings;
  return { rules: s.rules, preference: null, expiry_options: s.expiry_options, notify: s.notify, timezone: S.user.timezone, lang: S.user.lang,
    // The account's email, for the manage tier only.
    ...(tier === "manage" ? { email: S.email } : {}), roles: s.roles,
    calendar_image: { enabled: s.calendar_enabled, url: s.calendar_enabled && tier === "manage" ? `${origin}/c/${s.calendar_secret}.svg` : null } };
}
function digestOut(d) {
  const days = [...S.digests.keys()].sort(), i = days.indexOf(d.day), worth = [], rest = [];
  for (const id of d.item_ids) {
    const it = S.items.get(id), q = inQueue(id);
    if (!it) { rest.push({ item_id: id, title: d.gone?.[id] ?? "", signal: null, in_queue: false, available: false, can_restore: false }); continue; }
    if (it.analysis?.verdict === "worth_deep_dive" && !it.signal && !q) worth.push({ item_id: id, title: it.title, line: it.line ?? it.analysis.summary, verdict: "worth_deep_dive", available: true, in_queue: false });
    else rest.push({ item_id: id, title: it.title, signal: it.signal, in_queue: q, available: true, can_restore: !!it.signal || q });
  }
  return { day: d.day, read: d.read, counts: { saved: d.saved, worth: worth.length }, summary: d.summary, worth, rest, question: d.question, assistant: d.assistant,
    previous_day: i > 0 ? days[i - 1] : null, next_day: i < days.length - 1 ? days[i + 1] : null };
}
function queueOut(e) {
  return { item_id: e.item_id, title: S.items.get(e.item_id)?.title ?? "", added_at: e.added_at, deep_read: e.deep_read, report: e.report, went_at: e.went_at, fetched_at: e.fetched_at, entry: e.entry };
}
function markOf(day) {
  if (day > today()) return "future";
  if (S.noteDays.has(day)) return "note";
  const d = S.digests.get(day);
  if (d) return d.read ? "digest_read" : "digest_unread";
  return S.saved.get(day) ? "saved" : "empty";
}
function calendarOut(month) {
  const cur = today().slice(0, 7); month ??= cur;
  const [y, m] = month.split("-").map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = [], counts = { saved: 0, digests: 0, read: 0, notes: 0 };
  for (let d = 1; d <= n; d++) {
    const day = `${month}-${String(d).padStart(2, "0")}`, dg = S.digests.get(day);
    days.push({ day, mark: markOf(day), has_digest: !!dg });
    counts.saved += S.saved.get(day) ?? 0; if (dg) { counts.digests++; if (dg.read) counts.read++; }
  }
  counts.notes = S.notes.filter((x) => dayOf(Date.parse(x.created_at)).startsWith(month)).length;
  const shift = (k) => new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7);
  const floor = new Date(Date.now() + TZ_OFFSET_MS); floor.setUTCMonth(floor.getUTCMonth() - 12);
  return { month, today: today(), days, counts, previous_month: !S.firstMonth && shift(-1) >= floor.toISOString().slice(0, 7) ? shift(-1) : null, next_month: month < cur ? shift(1) : null };
}
function statusOut() {
  const waiting = [...S.items.values()].filter((i) => i.stage !== "analysed");
  const oldest = waiting.sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  let reason = S.noDigestReason;
  if (reason === undefined) {
    if (S.digests.has(today())) reason = null;
    else if (new Date(Date.now() + TZ_OFFSET_MS).getUTCHours() < 21) reason = "not_yet_time";
    else reason = [...S.items.values()].some((i) => !i.digest_day && i.analysis) ? "waiting_for_assistant" : "nothing_analysed";
  }
  return {
    assistants: S.assistants.map((a) => ({ id: a.id, name: a.name, last_seen_at: a.last_seen_at,
      state: a.working ? "working" : !a.last_seen_at ? "never" : Date.now() - Date.parse(a.last_seen_at) < DAY ? "recent" : "quiet" })),
    saved_today: S.saved.get(today()) ?? 0, waiting: waiting.length,
    oldest_waiting_deleted_on: oldest ? dayOf(Date.parse(oldest.created_at) + oldest.expiry_days * DAY) : null, no_digest_reason: reason,
  };
}
function page(list, q) {
  const limit = Math.min(100, Math.max(1, Number(q.get("limit") ?? 20) || 20)), start = Number(q.get("cursor") ?? 0) || 0;
  return { slice: list.slice(start, start + limit), next_cursor: start + limit < list.length ? String(start + limit) : null };
}
function calendarSvg(theme) {
  const dark = theme === "dark", ink = dark ? "#F5F5F3" : "#0B0B0B", grey = dark ? "#929290" : "#6B6B6B", bg = theme === "clear" ? "" : `<rect width="196" height="${28 * 5 + 28}" fill="${dark ? "#0B0B0B" : "#F5F5F3"}"/>`;
  const dots = calendarOut().days.filter((d) => d.mark !== "future").map((d, i) => {
    const x = 28 + (i % 7) * 24, y = 28 + Math.floor(i / 7) * 24;
    if (d.mark === "empty") return `<circle cx="${x}" cy="${y}" r="1.5" fill="${grey}"/>`;
    if (d.mark === "saved") return `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="${grey}" stroke-width="1.5"/>`;
    if (d.mark === "digest_unread") return `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="${ink}" stroke-width="1.5"/>`;
    return `<circle cx="${x}" cy="${y}" r="6.75" fill="${d.mark === "note" ? "#C5A229" : ink}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 196 168" width="196" height="168">${bg}${dots}</svg>`;
}

// ---------------------------------------------------------------- routes
const routes = [];
function on(method, pattern, tier, handler) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:[a-z_]+/g, (k) => { keys.push(k.slice(1)); return "([^/]+)"; }) + "$");
  routes.push({ method, re, keys, tier, handler });
}
const need = (cond, status = 400, code = "bad_request") => { if (!cond) fail(status, code); };
const getItem = (id) => S.items.get(id) ?? fail(404, "not_found");
function onlyKeys(body, keys) { need(body && typeof body === "object" && Object.keys(body).every((k) => keys.includes(k))); }
function createDevice(name, client, tier) {
  const d = { id: rid("dev"), name, category: "client", client, tier, created_at: ago(0), last_used_at: null, notifications: false };
  const credential = "kd_" + crypto.randomBytes(20).toString("hex");
  S.devices.set(d.id, d); S.creds.set(credential, d.id);
  return { d, credential };
}
function guardLastManager(d, lowering) {
  const managers = [...S.devices.values()].filter((x) => x.tier === "manage");
  if (d.tier === "manage" && lowering && managers.length === 1) fail(409, "last_manager");
}
function idempotent(c, make) {
  const key = c.req.headers["idempotency-key"];
  if (!key || key.length < 8) fail(400, "idempotency_key_required");
  const k = `${c.req.method} ${c.path} ${key}`;
  if (!S.idem.has(k)) S.idem.set(k, make());
  return S.idem.get(k);
}
function newDeviceCode(body, origin) {
  need(body.device_name && CLIENTS.includes(body.client) && TIERS.includes(body.requested_tier));
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", pick = () => Array.from(crypto.randomBytes(3), (b) => A[b % A.length]).join("");
  const code = `${pick()}-${pick()}`;
  const rec = { code, device_name: body.device_name, client: body.client, requested_tier: body.requested_tier, poll_secret: "ps_" + crypto.randomBytes(16).toString("hex"), expires: Date.now() + 10 * 60e3, status: "pending", grant: null };
  S.codes.set(normCode(code), rec);
  return [201, { code, poll_secret: rec.poll_secret, expires_at: iso(rec.expires), approve_url: `${origin}/approve?code=${code}` }];
}
function pendingCode(code) {
  const rec = S.codes.get(normCode(code)) ?? fail(404, "not_found");
  if (rec.status !== "pending" || Date.now() > rec.expires) fail(410, "gone");
  return rec;
}

on("GET", "/v1/meta", null, () => [200, { contract_version: "1.0.0", limits: LIMITS, shared_rules: SHARED_RULES }]);

on("POST", "/v1/auth/email-codes", null, (c) => {
  need(typeof c.body.email === "string" && /^\S+@\S+\.\S+$/.test(c.body.email));
  if (c.body.lang !== undefined) { need(["zh", "en"].includes(c.body.lang)); S.codeLang = c.body.lang; }
  return [202];
});
on("POST", "/v1/auth/sessions", null, (c) => {
  const b = c.body;
  need(b.email && b.code && b.device_name && CLIENTS.includes(b.client));
  if (!/@example\.com$/i.test(b.email) || b.code !== LOGIN_CODE) fail(401, "unauthorized", c.lang === "zh" ? "验证码不对，或已经失效。" : "The code is wrong or has expired.");
  // As in the core: the first sign-in makes the account, in the language of the sign-in page
  // that asked for the code. Later sign-ins leave the account's language alone.
  if (!S.signedInOnce) { S.user.lang = S.codeLang ?? c.lang; S.email = b.email.trim().toLowerCase(); }
  S.signedInOnce = true;
  const { d, credential } = createDevice(b.device_name, b.client, "manage");
  return [201, { credential, device: deviceOut(d, d), user: S.user }];
});

on("POST", "/v1/device-codes", null, (c) => newDeviceCode(c.body, c.origin));
on("GET", "/v1/device-codes/:code", "poll", (c) => {
  const rec = S.codes.get(normCode(c.p.code));
  if (!rec || c.bearer !== rec.poll_secret) fail(401, "unauthorized");
  if (rec.status === "pending") { if (Date.now() > rec.expires) fail(410, "gone"); return [200, { status: "pending" }]; }
  if (rec.status === "denied") return [200, { status: "denied" }];
  if (!rec.grant) fail(410, "gone");
  const grant = rec.grant; rec.grant = null;
  return [200, { status: "approved", grant }];
});
on("GET", "/v1/device-codes/:code/request", "manage", (c) => {
  const r = pendingCode(c.p.code);
  return [200, { device_name: r.device_name, client: r.client, requested_tier: r.requested_tier, expires_at: iso(r.expires) }];
});
on("POST", "/v1/device-codes/:code/approve", "manage", (c) => {
  const r = pendingCode(c.p.code), tier = c.body.tier ?? r.requested_tier;
  need(TIERS.includes(tier) && rank(tier) <= rank(r.requested_tier));
  const { d, credential } = createDevice(c.body.device_name || r.device_name, r.client, tier);
  r.status = "approved"; r.grant = { credential, device: deviceOut(d, d), user: S.user };
  S.decisions.push({ kind: "device_code", code: r.code, allowed: true, tier });
  return [200, deviceOut(d, c.device)];
});
on("POST", "/v1/device-codes/:code/deny", "manage", (c) => {
  const r = pendingCode(c.p.code); r.status = "denied";
  S.decisions.push({ kind: "device_code", code: r.code, allowed: false });
  return [204];
});

on("GET", "/v1/devices", "manage", (c) => [200, { devices: [...[...S.devices.values()].map((d) => deviceOut(d, c.device)), ...S.assistants.filter((a) => !a.built_in).map(assistantDevice)] }]);
on("GET", "/v1/devices/me", "save", (c) => [200, { device: deviceOut(c.device, c.device), user: S.user }]);
on("DELETE", "/v1/devices/me", "save", (c) => { S.devices.delete(c.device.id); return [204]; });
on("PUT", "/v1/devices/me/push", "read", (c) => {
  const b = c.body; need(b.kind === "webpush" && typeof b.endpoint === "string" && b.keys?.p256dh && b.keys?.auth);
  c.device.notifications = true; S.pushes.push({ device_id: c.device.id, endpoint: b.endpoint });
  return [204];
});
on("DELETE", "/v1/devices/me/push", "read", (c) => { c.device.notifications = false; S.pushes = S.pushes.filter((p) => p.device_id !== c.device.id); return [204]; });
on("PATCH", "/v1/devices/:id", "manage", (c) => {
  onlyKeys(c.body, ["name", "tier"]);
  const a = assistantById(c.p.id);
  if (a && !a.built_in) { if (c.body.name) a.name = c.body.name; return [200, assistantDevice(a)]; }
  const d = S.devices.get(c.p.id) ?? fail(404, "not_found");
  if (c.body.tier !== undefined) { need(TIERS.includes(c.body.tier)); guardLastManager(d, rank(c.body.tier) < rank("manage")); d.tier = c.body.tier; }
  if (c.body.name !== undefined) { need(c.body.name.length >= 1 && c.body.name.length <= 60); d.name = c.body.name; }
  return [200, deviceOut(d, c.device)];
});
on("DELETE", "/v1/devices/:id", "manage", (c) => {
  const a = assistantById(c.p.id);
  if (a && !a.built_in) { removeAssistant(a); return [204]; }
  const d = S.devices.get(c.p.id) ?? fail(404, "not_found");
  guardLastManager(d, true); S.devices.delete(d.id);
  return [204];
});
on("GET", "/v1/push/key", "read", () => [200, { public_key: S.pushKey }]);

on("POST", "/v1/items", "save", (c) => {
  const [status, body] = idempotent(c, () => {
    const b = c.body;
    onlyKeys(b, ["kind", "url", "title", "text", "asset_id", "entry"]);
    need(["link", "text", "image", "file"].includes(b.kind));
    if (b.kind === "link") need(typeof b.url === "string" && hostOf(b.url));
    if (b.kind === "text") need(typeof b.text === "string" && b.text.length > 0 && b.text.length <= 200000);
    let asset = null;
    if (b.kind === "image" || b.kind === "file") { asset = S.assets.get(b.asset_id); need(asset && (asset.stored || asset.over_quota)); }
    const msg = (key) => SHARED_RULES.save_messages[key][c.lang];
    S.lastSaved = { kind: b.kind, url: b.url ?? null, text: b.text ?? null, title: b.title ?? null, entry: b.entry ?? null, asset_bytes: asset?.data?.length ?? null, asset_content_type: asset?.content_type ?? null };
    if (b.url) { const dup = [...S.items.values()].find((i) => i.url === b.url); if (dup) return [200, { status: "duplicate", item_id: dup.id, message_key: "duplicate", message: msg("duplicate") }]; }
    const skipped = !!asset?.over_quota;
    const title = b.title || (b.kind === "link" ? hostOf(b.url) : b.kind === "text" ? shorten(b.text.trim().split("\n")[0], 80) : b.kind === "image" ? (c.lang === "zh" ? "图片" : "Image") : (c.lang === "zh" ? "文件" : "File"));
    const it = { id: rid("it", 6), kind: b.kind, title, site: b.url ? hostOf(b.url) : null, url: b.url ?? null, created_at: ago(0), stage: "saved", content_unavailable: false, dispatch_to: null, expiry_days: 30, pinned: false, signal: null, analysis: null,
      // The core reads a text file itself: its text is the item's body.
      body: b.text ?? (asset && !skipped && /^text\/(plain|markdown)$/.test(asset.content_type) ? asset.data.toString("utf8") : null), asset_id: asset && !skipped ? b.asset_id : null, digest_day: null, source: c.device.client };
    S.items.set(it.id, it); S.saved.set(today(), (S.saved.get(today()) ?? 0) + 1);
    const key = skipped ? "saved_image_skipped_quota" : "saved";
    return [201, { status: "saved", item_id: it.id, message_key: key, message: msg(key), ...(asset ? { image_stored: !skipped } : {}) }];
  });
  return [status, body];
});
on("GET", "/v1/items", "read", (c) => {
  const state = c.q.get("state"); need(["today", "digested", "pinned"].includes(state));
  const all = [...S.items.values()].filter((i) => state === "pinned" ? i.pinned : state === "today" ? !i.digest_day : !!i.digest_day).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const { slice, next_cursor } = page(all, c.q);
  return [200, { items: slice.map((i) => itemOut(i)), next_cursor }];
});
on("GET", "/v1/items/search", "read", (c) => {
  const q = (c.q.get("q") ?? "").toLowerCase(); need(q.length >= 1 && q.length <= 100);
  const hits = [...S.items.values()].filter((i) => `${i.title}\n${i.body ?? ""}`.toLowerCase().includes(q));
  return [200, { items: page(hits, c.q).slice.map((i) => itemOut(i)) }];
});
on("GET", "/v1/items/:id", "read", (c) => [200, itemOut(getItem(c.p.id), true)]);
on("PATCH", "/v1/items/:id", "manage", (c) => {
  const it = getItem(c.p.id); onlyKeys(c.body, ["expiry_days", "dispatch_to"]);
  if (c.body.expiry_days !== undefined) {
    need(Number.isInteger(c.body.expiry_days) && c.body.expiry_days >= 1 && c.body.expiry_days <= 365); it.expiry_days = c.body.expiry_days;
    // Days chosen on a kept item give it an end date again, counted from now.
    if (it.pinned) { it.pinned = false; it.term_from = Date.now(); }
  }
  if (c.body.dispatch_to !== undefined) { const a = assistantById(c.body.dispatch_to); need(a && a.steps.includes("analysis")); it.dispatch_to = { id: a.id, name: a.name }; it.user_assistant = true; }
  // Any edit by the user protects the retention (and the assistant, when there is one) from triage.
  if (Object.keys(c.body).length) { it.user_set = true; if (it.dispatch_to) it.user_assistant = true; }
  return [200, itemOut(it, true)];
});
on("DELETE", "/v1/items/:id", "manage", (c) => {
  const it = getItem(c.p.id); S.items.delete(it.id); S.queue.delete(it.id);
  const d = it.digest_day && S.digests.get(it.digest_day); if (d) (d.gone ??= {})[it.id] = it.title;
  return [204];
});
on("PUT", "/v1/items/:id/pin", "read", (c) => { const it = getItem(c.p.id); it.pinned = true; it.user_set = true; return [204]; });
on("DELETE", "/v1/items/:id/pin", "read", (c) => { const it = getItem(c.p.id); if (it.pinned) { it.pinned = false; it.term_from = Date.now(); } it.user_set = true; return [204]; });
on("PUT", "/v1/items/:id/signal", "read", (c) => { need(["not_interested", "seen"].includes(c.body.signal)); getItem(c.p.id).signal = c.body.signal; return [204]; });
on("DELETE", "/v1/items/:id/signal", "read", (c) => { getItem(c.p.id).signal = null; return [204]; });

on("GET", "/v1/digests", "read", (c) => {
  const all = [...S.digests.values()].sort((a, b) => b.day.localeCompare(a.day)).map((d) => ({ day: d.day, read: d.read }));
  const { slice, next_cursor } = page(all, c.q);
  return [200, { digests: slice, next_cursor }];
});
const getDigest = (day) => {
  if (day === "latest") day = [...S.digests.keys()].sort().pop();
  return S.digests.get(day) ?? fail(404, "not_found");
};
on("GET", "/v1/digests/:day", "read", (c) => [200, digestOut(getDigest(c.p.day))]);
on("POST", "/v1/digests/:day/read", "read", (c) => { getDigest(c.p.day).read = true; return [204]; });

on("GET", "/v1/deep-read-queue", "read", () => [200, { entries: [...S.queue.values()].sort((a, b) => b.added_at.localeCompare(a.added_at)).map(queueOut) }]);
on("PUT", "/v1/deep-read-queue/:item_id", "read", (c) => {
  const it = getItem(c.p.item_id);
  if (!S.queue.has(it.id)) S.queue.set(it.id, { item_id: it.id, added_at: ago(0), deep_read: S.settings.roles.deep_read ? "waiting" : "none", report: null, went_at: null, fetched_at: null, entry: null });
  return [200, queueOut(S.queue.get(it.id))];
});
on("DELETE", "/v1/deep-read-queue/:item_id", "read", (c) => { S.queue.delete(c.p.item_id); return [204]; });
on("POST", "/v1/deep-dive-requests", "read", (c) => {
  const it = getItem(c.body.item_id ?? "");
  const divers = S.assistants.filter((a) => a.steps.includes("deep_dive"));
  if (!divers.length) fail(409, "conflict", c.lang === "zh" ? "还没有能深挖的助手。" : "No assistant can deep dive yet.");
  const a = c.body.assistant_id ? divers.find((x) => x.id === c.body.assistant_id) ?? fail(409, "conflict") : divers.find((x) => x.id === S.settings.roles.deep_dive) ?? divers[0];
  const e = S.queue.get(it.id); if (e) e.went_at = ago(0);
  const opening_line = SHARED_RULES.opening_line[c.lang].replace("{first_line}", it.title);
  return [201, { assistant: { id: a.id, name: a.name }, opening_line, open_url: a.kind === "chat" ? `https://chat.example.com/new?q=${encodeURIComponent(opening_line)}` : null, entry: a.kind === "chat" ? null : e?.entry ?? null }];
});

const noteSummary = (n) => ({ id: n.id, title: n.title, excerpt: n.body.replace(/[#*>`\[\]\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120), created_at: n.created_at });
on("GET", "/v1/notes", "read", (c) => {
  const q = (c.q.get("q") ?? "").trim().toLowerCase(); need(q.length <= 100);
  const all = S.notes.filter((n) => !q || `${n.title}\n${n.body}`.toLowerCase().includes(q)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const { slice, next_cursor } = page(all, c.q);
  return [200, { notes: slice.map(noteSummary), next_cursor }];
});
on("POST", "/v1/notes", "read", (c) => idempotent(c, () => {
  const b = c.body; onlyKeys(b, ["title", "body", "item_id", "assistant_id", "asset_ids"]);
  need(typeof b.title === "string" && b.title.length >= 1 && b.title.length <= 200 && typeof b.body === "string" && b.body.length >= 1);
  const it = b.item_id ? S.items.get(b.item_id) : null;
  const a = assistantById(b.assistant_id) ?? assistantById(S.settings.roles.deep_dive) ?? S.assistants[0];
  const n = { id: rid("n", 6), title: b.title, body: b.body, created_at: ago(0), assistant: { id: a.id, name: a.name, submitted_by_user: true },
    origin: it ? { item_id: it.id, item_title: it.title, item_url: it.url, digest_day: it.digest_day } : null, sources: [], asset_ids: b.asset_ids ?? [] };
  S.notes.push(n); S.noteDays.add(today()); if (it) S.queue.delete(it.id);
  return [201, n];
}));
on("GET", "/v1/notes/:id", "read", (c) => {
  const n = S.notes.find((x) => x.id === c.p.id) ?? fail(404, "not_found");
  if (!(c.req.headers.accept ?? "").includes("text/markdown")) return [200, n];
  const src = n.sources.length ? `\n\n## ${c.lang === "zh" ? "出处" : "Sources"}\n\n` + n.sources.map((s) => (s.url ? `- [${s.title}](${s.url})` : `- ${s.title}`)).join("\n") : "";
  return [200, `# ${n.title}\n\n${n.body}${src}\n`, "text/markdown; charset=utf-8"];
});

on("POST", "/v1/assets", "save", (c) => {
  const b = c.body;
  need(/^[0-9a-f]{64}$/.test(b.sha256 ?? "") && Number.isInteger(b.bytes) && b.bytes >= 1);
  if (b.bytes > LIMITS.asset_max_bytes) fail(413, "too_large");
  if (!ASSET_TYPES.includes(b.content_type)) fail(415, "unsupported_type");
  const have = [...S.assets.values()].find((a) => a.sha256 === b.sha256 && a.stored);
  if (have) return [200, { asset_id: have.id, status: "stored" }];
  const a = { id: rid("as", 6), sha256: b.sha256, bytes: b.bytes, content_type: b.content_type, sig: crypto.randomBytes(12).toString("hex"), expires: Date.now() + 10 * 60e3, data: null, stored: false, over_quota: S.overQuota };
  S.assets.set(a.id, a);
  if (a.over_quota) return [200, { asset_id: a.id, status: "over_quota" }];
  return [200, { asset_id: a.id, status: "upload", upload_url: `${c.origin}/v1/assets/${a.id}/upload?sig=${a.sig}`, expires_at: iso(a.expires) }];
});
const signedAsset = (c) => { const a = S.assets.get(c.p.id); if (!a || c.q.get("sig") !== a.sig) fail(401, "unauthorized"); return a; };
on("PUT", "/v1/assets/:id/upload", null, (c) => {
  const a = signedAsset(c);
  if (Date.now() > a.expires) fail(410, "gone");
  if (c.raw.length > LIMITS.asset_max_bytes) fail(413, "too_large");
  a.data = c.raw; return [204];
});
on("POST", "/v1/assets/:id/complete", "save", (c) => {
  const a = S.assets.get(c.p.id) ?? fail(404, "not_found");
  if (a.stored) return [204];
  if (!a.data || a.data.length !== a.bytes || crypto.createHash("sha256").update(a.data).digest("hex") !== a.sha256) fail(409, "conflict");
  a.stored = true; return [204];
});
// The signed download address, as the core serves it: valid for 5 minutes, an image shown in
// place and every other file handed over as a download, never run as a page.
const DOWNLOAD_MS = 5 * 60e3;
on("GET", "/v1/assets/:id/download", null, (c) => {
  const a = signedAsset(c); if (!a.stored) fail(404, "not_found");
  const exp = Number(c.q.get("exp"));
  if (!(exp > Date.now()) || exp - DOWNLOAD_MS < (S.downloadsNotBefore ?? 0)) fail(401, "unauthorized");
  return [200, a.data, a.content_type, {
    "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
    "content-disposition": a.content_type.startsWith("image/") ? "inline" : "attachment",
  }];
});
on("GET", "/v1/assets/:id", "read", (c) => {
  const a = S.assets.get(c.p.id); if (!a?.stored) fail(404, "not_found");
  const exp = Date.now() + DOWNLOAD_MS;
  return [200, { download_url: `${c.origin}/v1/assets/${a.id}/download?exp=${exp}&sig=${a.sig}`, expires_at: iso(exp), content_type: a.content_type, bytes: a.bytes }];
});

on("GET", "/v1/status", "read", () => [200, statusOut()]);
on("GET", "/v1/calendar", "read", (c) => { const m = c.q.get("month"); need(!m || /^\d{4}-\d{2}$/.test(m)); return [200, calendarOut(m ?? undefined)]; });
on("GET", "/v1/stats", "read", (c) => {
  const n = Math.min(366, Math.max(1, Number(c.q.get("days") ?? 30) || 30)), days = [];
  for (let i = 0; i < n; i++) { const day = dayN(i), saved = S.saved.get(day) ?? 0; days.push({ day, saved, analysed: Math.max(0, saved - 1), digests: S.digests.has(day) ? 1 : 0, notes: S.notes.filter((x) => dayOf(Date.parse(x.created_at)) === day).length, by_source: saved ? { web: saved } : {} }); }
  return [200, { days }];
});
on("GET", "/v1/usage", "manage", () => [200, { assistants: S.assistants.map((a, i) => ({ assistant_id: a.id, name: a.name, calls: 40 - i * 12, input_tokens: 52000 - i * 9000, output_tokens: 8100 - i * 1500, items: 36 - i * 10, self_reported: !a.built_in })) }]);

on("GET", "/v1/settings", "read", (c) => [200, settingsOut(c.origin, c.device.tier)]);
on("PATCH", "/v1/settings", "manage", (c) => {
  const b = c.body, s = S.settings;
  onlyKeys(b, ["rules", "expiry_options", "notify", "timezone", "lang", "roles", "calendar_image_enabled"]);
  if (b.rules !== undefined) { need(typeof b.rules === "string" && b.rules.length <= 4000); s.rules = b.rules; }
  if (b.expiry_options !== undefined) { need(Array.isArray(b.expiry_options) && b.expiry_options.length >= 1 && b.expiry_options.length <= 6 && b.expiry_options.every((n) => Number.isInteger(n) && n >= 1 && n <= 365)); s.expiry_options = b.expiry_options; }
  if (b.notify !== undefined) { need(typeof b.notify === "boolean"); s.notify = b.notify; }
  if (b.timezone !== undefined) { need(typeof b.timezone === "string" && b.timezone.length > 0); S.user.timezone = b.timezone; }
  if (b.lang !== undefined) { need(["zh", "en"].includes(b.lang)); S.user.lang = b.lang; }
  if (b.calendar_image_enabled !== undefined) { need(typeof b.calendar_image_enabled === "boolean"); s.calendar_enabled = b.calendar_image_enabled; }
  if (b.roles !== undefined) {
    onlyKeys(b.roles, ["analysis", "digest", "deep_read", "deep_dive"]);
    for (const [step, id] of Object.entries(b.roles)) {
      if (id !== null) { const a = assistantById(id); need(a && a.steps.includes(step) && (a.kind === "scheduled" || step === "deep_dive")); }
      s.roles = { ...s.roles, [step]: id };
    }
  }
  return [200, settingsOut(c.origin, c.device.tier)];
});
on("POST", "/v1/settings/calendar-image/rotate", "manage", (c) => { S.settings.calendar_secret = crypto.randomBytes(16).toString("hex"); return [200, settingsOut(c.origin, c.device.tier)]; });
on("GET", "/c/:file", null, (c) => {
  if (!S.settings.calendar_enabled || c.p.file !== `${S.settings.calendar_secret}.svg`) return [404, "Not found", "text/plain; charset=utf-8"];
  return [200, calendarSvg(c.q.get("theme") ?? "light"), "image/svg+xml"];
});

// Everything of the account that lasts, as one document (the core streams it; the shape is the same).
const EXT = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "application/pdf": "pdf", "text/plain": "txt", "text/markdown": "md" };
function exportOut(lang) {
  const sig = (id) => { const a = id && assistantById(id); return a ? { id: a.id, name: a.name } : null; };
  const fileOf = (it) => { const a = it.asset_id && S.assets.get(it.asset_id); return a?.stored ? { id: a.id, name: it.title, type: a.content_type, size: a.bytes } : null; };
  const items = [...S.items.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const s = S.settings;
  return {
    version: 1, exported_at: iso(Date.now()),
    contents: lang === "zh"
      ? { included: ["你的各项选择。", "每一份每日摘要。", "每一篇笔记，连同出处。", "每一条还在的条目，连同解读和标签。", "你的文件清单。"], not_included: ["已经删除的条目。", "文件本身的内容。"], files: "文件的内容不在这份文档里。每个文件单独下载。" }
      : { included: ["Your rules and choices.", "Every daily digest.", "Every note, with its sources.", "Every item that still exists, with its analysis and tags.", "A list of your files."], not_included: ["Items that were deleted.", "The contents of files."], files: "File contents are not in this document. Each file is downloaded separately." },
    account: { id: S.user.id, email: S.email, created_at: ago(80 * DAY) },
    settings: { rules: s.rules, expiry_options: s.expiry_options, notify: s.notify, timezone: S.user.timezone, lang: S.user.lang,
      roles: Object.fromEntries(Object.entries(s.roles).map(([k, id]) => [k, sig(id)])), calendar_image_enabled: s.calendar_enabled },
    digests: [...S.digests.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ day: d.day, read: d.read, created_at: null, covers: [d.day], summary: d.summary, question: d.question,
      worth: d.item_ids.map((id) => S.items.get(id)).filter((it) => it?.line).map((it) => ({ item_id: it.id, line: it.line })),
      entries: d.item_ids.map((id) => ({ item_id: id, title: S.items.get(id)?.title ?? d.gone?.[id] ?? "", verdict: S.items.get(id)?.analysis?.verdict ?? null })), assistant: d.assistant })),
    notes: [...S.notes].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    items: items.map((it) => ({ ...itemOut(it, true), file: fileOf(it) })),
    files: items.map(fileOf).filter(Boolean),
  };
}
on("GET", "/v1/export", "manage", (c) => [200, JSON.stringify(exportOut(c.lang), null, 1) + "\n", "application/json; charset=utf-8",
  { "content-disposition": `attachment; filename="export-${today()}.json"` }]);
// Feedback to the operator: kept in memory so the tests can look at it.
on("POST", "/v1/feedback", "save", (c) => {
  onlyKeys(c.body, ["where", "doing", "wrong", "wish"]);
  need(typeof c.body.wrong === "string" && c.body.wrong.trim().length > 0 && c.body.wrong.length <= 4000);
  (S.feedback ??= []).push({ ...c.body, email: S.email, client: c.device.client });
  return [201, { id: `fb_${S.feedback.length}` }];
});
// The user deletes their own account: the email must be the account's. Everything goes, every
// credential stops working, and the same email can come back later as a new, empty account.
on("DELETE", "/v1/account", "manage", (c) => {
  onlyKeys(c.body, ["confirm_email"]);
  const typed = typeof c.body.confirm_email === "string" ? c.body.confirm_email.trim().toLowerCase() : "";
  if (typed !== S.email) fail(400, "bad_request", c.lang === "zh" ? "邮箱和这个账户的邮箱不一致，没有删除。" : "The email does not match the email of this account. Nothing was deleted.");
  const gone = { user_id: S.user.id, email: S.email, at: iso(Date.now()), items: S.items.size, notes: S.notes.length, devices: S.devices.size };
  seed({ empty: true });
  DELETED = gone;
  return [204];
});

on("GET", "/v1/assistants", "read", (c) => [200, { assistants: S.assistants, connect_url: `${c.origin}/mcp` }]);
function removeAssistant(a) {
  S.assistants = S.assistants.filter((x) => x !== a);
  for (const k of Object.keys(S.settings.roles)) if (S.settings.roles[k] === a.id) S.settings.roles[k] = null;
}
on("PATCH", "/v1/assistants/:id", "manage", (c) => {
  const a = assistantById(c.p.id) ?? fail(404, "not_found"); onlyKeys(c.body, ["name", "steps"]);
  if (c.body.name !== undefined) {
    need(c.body.name.length >= 1 && c.body.name.length <= 40);
    if (S.assistants.some((x) => x !== a && x.name === c.body.name)) fail(409, "conflict", c.lang === "zh" ? "已经有一个助手叫这个名字。" : "Another assistant already has this name.");
    a.name = c.body.name;
  }
  if (c.body.steps !== undefined) {
    need(Array.isArray(c.body.steps) && c.body.steps.every((s) => STEPS.includes(s)));
    a.steps = a.kind === "chat" ? c.body.steps.filter((s) => s === "deep_dive") : c.body.steps;
    for (const k of Object.keys(S.settings.roles)) if (S.settings.roles[k] === a.id && !a.steps.includes(k)) S.settings.roles[k] = null;
  }
  return [200, a];
});
on("DELETE", "/v1/assistants/:id", "manage", (c) => {
  const a = assistantById(c.p.id) ?? fail(404, "not_found");
  if (a.built_in) fail(409, "conflict");
  removeAssistant(a); return [204];
});

on("GET", "/oauth/authorize", null, (c) => {
  const id = rid("req", 6); let host = "unknown.example.com";
  try { host = new URL(c.q.get("redirect_uri")).host; } catch { fail(400, "bad_request"); }
  const steps = (c.q.get("scope") ?? "").split(" ").filter((s) => STEPS.includes(s) && s !== "triage");
  S.oauth.set(id, { client_name: c.q.get("client_id") ?? "Client", client_uri: null, redirect_host: host, steps_requested: steps.length ? steps : ["deep_dive"], state: c.q.get("state") ?? "" });
  return [302, null, null, { location: `/authorize?request=${id}` }];
});
const pendingRequest = (id) => { const r = S.oauth.get(id); if (!r || r.decided) fail(410, "gone"); return r; };
on("GET", "/v1/oauth/requests/:id", "manage", (c) => { const r = pendingRequest(c.p.id); return [200, { client_name: r.client_name, client_uri: r.client_uri, redirect_host: r.redirect_host, steps_requested: r.steps_requested }]; });
on("POST", "/v1/oauth/requests/:id/decision", "manage", (c) => {
  const r = pendingRequest(c.p.id), b = c.body; onlyKeys(b, ["allow", "name", "kind", "steps"]); need(typeof b.allow === "boolean");
  if (b.allow) {
    need(typeof b.name === "string" && b.name.length >= 1 && b.name.length <= 40);
    if (S.assistants.some((a) => a.name === b.name)) fail(409, "conflict", c.lang === "zh" ? "已经有一个助手叫这个名字。" : "Another assistant already has this name.");
    const kind = b.kind ?? "scheduled"; need(["scheduled", "chat"].includes(kind));
    const steps = kind === "chat" ? ["deep_dive"] : (b.steps ?? r.steps_requested).filter((s) => r.steps_requested.includes(s));
    S.assistants.push({ id: rid("as", 6), name: b.name, kind, steps, built_in: false, connected_at: ago(0), last_seen_at: null, runs_at: r.redirect_host });
    S.decisions.push({ kind: "oauth", request: c.p.id, allowed: true, name: b.name, assistant_kind: kind, steps });
  } else S.decisions.push({ kind: "oauth", request: c.p.id, allowed: false });
  r.decided = true;
  return [200, { redirect_to: `${c.origin}/__test/oauth-done?allowed=${b.allow ? 1 : 0}&state=${encodeURIComponent(r.state)}` }];
});

// ---------------------------------------------------------------- test hooks
on("POST", "/__test/reset", null, (c) => { seed(c.body ?? {}); DELETED = null; return [200, { ok: true }]; });
on("POST", "/__test/analyse", null, (c) => {
  const it = c.body.item_id ? getItem(c.body.item_id) : [...S.items.values()].filter((i) => !i.digest_day && i.stage !== "analysed").sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? fail(404, "not_found");
  const a = S.assistants[0];
  it.stage = "analysed"; it.dispatch_to ??= { id: a.id, name: a.name };
  it.analysis = analysis(a, "这是一份刚交回的解读，内容是编的。", "文章 · 约 1000 字", ["第一条要点。", "第二条要点。"], "good_to_know", null, 0);
  // `unavailable`: the assistant could not read it and says so in one sentence (the built-in
  // assistant after three failed attempts: "content could not be read").
  if (c.body.unavailable) it.analysis = { unavailable: true, summary: String(c.body.unavailable), assistant: { id: a.id, name: a.name }, created_at: ago(0) };
  return [200, itemOut(it)];
});
// What the dispatch step does when it comes: it gives the item an assistant and a number of
// days, except where the user has set them.
on("POST", "/__test/triage", null, (c) => {
  const it = getItem(c.body.item_id);
  if (it.stage === "saved") {
    const a = assistantById(c.body.assistant_id) ?? assistantById(S.settings.roles.analysis) ?? S.assistants[0];
    if (!it.user_assistant) it.dispatch_to = { id: a.id, name: a.name };
    if (!it.user_set) it.expiry_days = c.body.expiry_days ?? 30;
    it.stage = "triaged";
  }
  return [200, itemOut(it, true)];
});
// A slow core (every /v1 answer waits `ms`), and one answer that fails, to see what the app shows meanwhile.
// Time passes: every download address handed out so far is past its five minutes.
on("POST", "/__test/expire-downloads", null, () => { S.downloadsNotBefore = Date.now() + 1; return [200, { ok: true }]; });
on("POST", "/__test/delay", null, (c) => { S.delay = Number(c.body.ms) || 0; return [200, { ok: true }]; });
on("POST", "/__test/fail-next", null, (c) => { S.failNext = { method: c.body.method, path: c.body.path }; return [200, { ok: true }]; });
on("POST", "/__test/device-code", null, (c) => newDeviceCode(c.body, c.origin));
on("POST", "/__test/set-tier", "save", (c) => { need(TIERS.includes(c.body.tier)); c.device.tier = c.body.tier; return [200, deviceOut(c.device, c.device)]; });
on("GET", "/__test/state", null, () => [200, {
  counts: { items: S.items.size, today: [...S.items.values()].filter((i) => !i.digest_day).length, notes: S.notes.length, queue: S.queue.size, devices: S.devices.size, assistants: S.assistants.length, digests: S.digests.size, assets: [...S.assets.values()].filter((a) => a.stored).length },
  feedback: S.feedback ?? [], last_saved: S.lastSaved, pushes: S.pushes, decisions: S.decisions, settings: { ...S.settings, calendar_secret: undefined }, user: S.user, email: S.email,
  deleted_account: DELETED,
}]);
on("GET", "/__test/oauth-done", null, (c) => [200, `<!doctype html><meta charset="utf-8"><title>oauth-done</title><p id="done">oauth-done allowed=${c.q.get("allowed") === "1" ? 1 : 0}</p>`, "text/html; charset=utf-8"]);
on("POST", "/share", null, () => [303, null, null, { location: "/share" }]);

// ---------------------------------------------------------------- server
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".map": "application/json" };
function serveStatic(pathname, res) {
  let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) file = DIST;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(pathname)) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    file = path.join(DIST, "index.html");
    if (!fs.existsSync(file)) return send(res, 404, "dist/ is missing. Run `npm run build`.", "text/plain; charset=utf-8");
  }
  const headers = { "cache-control": "no-cache" };
  if (path.basename(file) === "sw.js") headers["service-worker-allowed"] = "/";
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] ?? "application/octet-stream", headers);
}
function send(res, status, body, type, headers = {}) {
  if (body === undefined || body === null) { res.writeHead(status, headers); return res.end(); }
  const data = Buffer.isBuffer(body) ? body : typeof body === "string" ? Buffer.from(body) : Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": type ?? "application/json; charset=utf-8", "content-length": data.length, "cache-control": "no-store", ...headers });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => { const chunks = []; req.on("data", (d) => chunks.push(d)); req.on("end", () => resolve(Buffer.concat(chunks))); req.on("error", reject); });
}

seed();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`);
  const lang = /^\s*en/i.test(req.headers["accept-language"] ?? "") ? "en" : "zh";
  try {
    const hit = routes.map((r) => ({ r, m: r.method === req.method && url.pathname.match(r.re) })).find((x) => x.m);
    if (!hit) {
      const api = /^\/(v1|oauth|mcp|c|__test|\.well-known)(\/|$)/.test(url.pathname);
      if (api || req.method !== "GET") return send(res, 404, { error: { code: "not_found", message: ERRORS.not_found[lang === "zh" ? 0 : 1] } });
      return serveStatic(url.pathname, res);
    }
    const raw = await readBody(req);
    if (url.pathname.startsWith("/v1/")) {
      if (S.delay) await new Promise((r) => setTimeout(r, S.delay));
      const f = S.failNext;
      if (f && f.method === req.method && new RegExp(f.path).test(url.pathname)) { S.failNext = null; fail(500, "server_error"); }
    }
    let body = {};
    if (raw.length && /json/.test(req.headers["content-type"] ?? "")) { try { body = JSON.parse(raw.toString("utf8")); } catch { fail(400, "bad_request"); } }
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || null;
    const c = { req, q: url.searchParams, path: url.pathname, origin: url.origin, lang, body, raw, bearer, device: null, p: Object.fromEntries(hit.r.keys.map((k, i) => [k, decodeURIComponent(hit.m[i + 1])])) };
    if (hit.r.tier && hit.r.tier !== "poll") {
      const d = bearer && S.devices.get(S.creds.get(bearer));
      if (!d) fail(401, "unauthorized");
      if (rank(d.tier) < rank(hit.r.tier)) fail(403, "forbidden");
      d.last_used_at = ago(0); c.device = d;
    }
    const [status, out, type, headers] = hit.r.handler(c);
    send(res, status, out, type, headers);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.text ?? (ERRORS[e.code] ?? ERRORS.server_error)[lang === "zh" ? 0 : 1] } });
    console.error(e);
    send(res, 500, { error: { code: "server_error", message: ERRORS.server_error[lang === "zh" ? 0 : 1] } });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`fake core on http://127.0.0.1:${PORT} (sign-in code ${LOGIN_CODE})`));
