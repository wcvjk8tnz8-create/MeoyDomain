# MeoyDomain

**MeoyDomain** —— 免费、开源的新一代二级域名分发与 DNS 管理系统。
基于 **Cloudflare Workers + D1 + R2**，用户自助申请 `xxx.你的根域名`，审核通过后自行添加 DNS 记录，所有记录通过 **Cloudflare API** 实时下发到你的 Zone。

> 内置落地首页（`/home.html`）、12 种 DNS 记录、根域名验证、域名托管委派、工单与转移、积分与兑换券。


基于 **Cloudflare Workers + D1** 的二级域名注册平台（类似 dnshe / hapdns）。用户自助申请 `xxx.你的根域名`，审核通过后自行添加 DNS 记录，所有记录通过 **Cloudflare API** 实时下发到你的 Zone。

---

## 一、核心特性

### 1. 12 种 DNS 记录类型全支持

| 类型 | 说明 | 备注 |
|---|---|---|
| A | 指向 IPv4 | 可开启 Cloudflare 代理 |
| AAAA | 指向 IPv6 | 可开启代理 |
| CNAME | 域名别名 | 可开启代理 |
| MX | 邮件交换 | 带优先级 |
| TXT | 文本（SPF/DKIM/验证） | |
| NS | 名称服务器（子域委派） | |
| SOA | 起始授权 | **只读**，Cloudflare 不允许 API 修改区域 SOA，页面可查看自动生成的 SOA |
| PTR | 反向解析 | 需在 Cloudflare 托管的反向区域才真正生效 |
| SRV | 服务定位（SIP/XMPP） | 服务名 / 协议 / 优先级 / 权重 / 端口 |
| CAA | CA 授权 | flags + issue/issuewild/iodef 等 |
| NAPTR | 命名权威指针 | order/preference/flags/service/regexp/replacement |
| DS | DNSSEC 委托签名者 | key tag / algorithm / digest type / digest |

### 2. 创建子域名默认零记录

申请子域名时**不会**写入任何 DNS 记录。只有在用户主动添加时才会调用 Cloudflare API 创建，避免产生垃圾记录。

### 3. 根域名验证（Vercel / Netlify / DNSPod …）

在「子域名管理 → DNS 记录」页点击「根域名验证」，选择预设（Vercel `_vercel`、Netlify `_netlify`、DNSPod `_dnsauth`/`_dnspod`、阿里云、Cloudflare、GitHub Pages、Google）或自定义主机名，粘贴平台给的 TXT 值即可写入。

**写入位置**（默认根域名）：

| 作用域 | 生成记录 | 适用 |
|---|---|---|
| 根域名 | `_vercel.meoy.top` | Vercel / Netlify / DNSPod 校验**根域名所有权**时 |
| 本子域名 | `_vercel.xxx.meoy.top` | 平台只校验你自己的子域名时 |

**锁定机制**：验证记录写入后立即 `锁定`：

- 锁定期间**任何人都不能修改或删除**这条记录（按钮被禁用，接口也会拒绝）
- 同一主机名上重复发起验证会被拒绝，提示发起人邮箱
- **唯一退出方式**是发起人点击「确认认证完成」→ 解锁；可选择删除记录（推荐，释放主机名）或保留（如 Google 站点验证需要长期保留）
- 管理员后台「验证锁定」页可强制解锁，作为兜底

这样别人既无法抢注你的验证主机名，也无法在你验证过程中破坏它。

### 4. 账号与审核

- 邮箱 + 密码注册登录（**无需邮箱验证码**），PBKDF2-SHA256 哈希存储，HttpOnly Cookie 会话
- 第一个注册的用户自动成为管理员
- **管理员子域名配额不限**（默认用户 5 个，可在后台单独调整，填 `-1` 即不限量）
- **管理员申请子域名免审核**，即时开通
- **管理员可申请保留域名**（www / mail / admin / api 等，见 `RESERVED_LABELS` 配置）
- 保留列表已包含站点自身功能前缀：**`whois`**（WHOIS 查询页）、**`bbs`** / **`forum`**、以及 `dnshe` / `anyns` / `dns` / `ns` 等，普通用户无法占用
- 子域名默认需管理员审核（可配置为即时开通）
- **被驳回的子域名不占配额**：列表按状态分开统计，驳回项显示驳回原因并标注「不占配额」，可移除后重新申请同名（也可直接重新申请，系统会自动清除旧的驳回记录）
- 管理员驳回/停用需填写原因，用户在列表里直接可见
- 违规使用可封禁：立即踢下线、禁止登录、全部子域名停用，可选一键清空其所有 DNS 记录

### 5. 服务条款与反滥用

- 独立的 `/terms.html` 页，含：服务条款、**禁止滥用清单（8 类）**、账号规则、免责声明、信息与处置、条款变更
- 注册必须勾选同意条款，未勾选接口直接拒绝
- **邮箱域名白名单**：默认仅 `gmail.com` / `googlemail.com` / `qq.com` / `foxmail.com`，可用 `ALLOWED_EMAIL_DOMAINS` 覆盖
- **同 IP 最多注册 2 个账号**（后台可调 1-50），超出时注册接口直接拒绝
- 后台「同 IP 账号」页按 IP 聚合，超标的 IP 标红显示，**一键封禁该 IP 下全部账号**：踢下线 + 停用子域名 + 可选清空 DNS + 可选封禁 IP（禁止再注册/登录）

### 6. 界面风格：CYBER / TERMINAL × 二次元

- 深色终端底 + **网格纹理** + **CRT 扫描线**，等宽字体、直角、1px 霓虹描边、卡片四角角标
- 霓虹配色：青 `#00e5ff` / 品红 `#ff3ea5` / 紫 `#8b5cff`，与初音未来、GUMI 的配色同源
- 角色壁纸仍在（Miku / GUMI 切换），作为底层叠霓虹光，不做大圆角毛玻璃
- 标题带 `>` 前缀与闪烁光标，导航显示根域名，hover 有霓虹发光

### 7. 域名托管（NS 委派）

把某个子域名的解析权整体交给第三方 DNS —— 系统在父区域写入 NS 记录，之后由目标服务商负责解析。

| 服务商 | NS | API 自动建区 |
|---|---|---|
| **anyns.io** | `ns1.anyns.io` `ns2.anyns.io`（备用 ns3/ns4） | 无公开稳定 API，写入 NS 后需到其面板添加域名 |
| **DNSHE** | 默认 `ns1.dnshe.com` `ns2.dnshe.com` | ✅ 填 API Token 可自动创建 zone，并使用其返回的官方 NS |
| **Cloudflare** | 需填你在 CF 看到的专属 NS | — |
| **自定义 NS** | 任意（每行一个，≥2 个） | — |

要点：

- 切换或取消托管会自动清理父区域残留的旧 NS 记录（按 name + content 精确匹配）
- **API Token 只在本次请求中使用，不落库、不写日志**
- DNSHE API 失败时自动降级为「按默认 NS 写入 + 提示去面板确认」，不阻断托管
- DNSHE 支持「检查委派」按钮（调其 `/v1/zones/{id}/delegation`）
- 未托管时本站正常解析；托管后本站 DNS 记录页对该域名不再生效

新增服务商：编辑 `src/lib/delegation.js` 的 `DELEGATION_PROVIDERS` 即可。

### 8. 积分与每日签到

| 规则 | 默认 | 说明 |
|---|---|---|
| 每日签到 | **+5 分** | 每个自然日一次（按 UTC+8），重复签到会被拒 |
| 申请子域名 | **−5 分** | 长度 ≥ 2 的名称 |
| 单字域名 | **−35 分** | 长度 ≤ `short_domain_len`（默认 1），如 `a` `1` |
| 管理员 | **不限** | 不消耗、不显示余额，显示 `∞` |
| 新用户初始 | 10 分 | `initial_points` |

**老用户无感迁移**：升级后首次进入积分系统时，按其「已有的、计入额度」的子域名数 × 单个域名价格补偿（`max(初始分, 域名数×5)`）。
**已有域名不会被扣分、不会被回收** —— 实测某 5 域名老用户获得 25 分。

全部规则（签到奖励 / 域名价 / 单字价 / 单字长度 / 初始分）均可在**管理后台 → 站点设置**改。
管理员可在**用户列表**点「积分」直接设置余额或增减，并有完整流水。

- 积分不足时返回 `402`，提示「积分不足：单字域名需要 35 分，当前 X 分」
- 单字符域名（如 `a`）此前被 `validateLabel` 拒绝，现已放开 —— 但需 35 分兑换
- 控制台顶部显示余额与签到按钮（已签到则按钮置灰并提示明日再来），可查看积分明细
- 申请输入框实时显示「消耗 X 分 · 余额 Y 分」，不足时标红
- WHOIS 页也显示价格与余额，积分不足时申请按钮禁用

### 9. WHOIS 查询（可查任意域名）

同一个输入框，两种模式：

| 输入 | 行为 |
|---|---|
| `me` | 查本站子域名（注册状态、持有人、积分价格） |
| `me.meoy.top` | 同上 |
| `example.com` | **查任意域名** → RDAP 注册局数据 |
| `foo.de5.net` | **查任意域名** → DNSHE 公开 WHOIS |

**数据源**

- **DNSHE 系后缀**（`de5.net` `us.ci` `cc.cd` `ccwu.cc` `bot.cd` `dnshe.com`）
  → `https://api005.dnshe.com/index.php?m=domain_hub&endpoint=whois&domain=xxx`

**DNSHE 凭证（推荐配置，额度更高更稳）**，两种填法任选：

| 方式 | 操作 | 优先级 |
|---|---|---|
| Worker Secret | 仓库 **Settings → Secrets → Actions** 加 `DNSHE_API_KEY` / `DNSHE_API_SECRET`，CI 自动 `wrangler secret put` | **高** |
| 后台填写 | 管理后台 → 站点设置 → DNSHE API 凭证 | 低 |

凭证只通过 **HTTP Header**（`X-API-Key` / `X-API-Secret`）发送 —— 官方已禁止 URL 参数与 Body 传递。
两者都没填时退回**公开模式**（免认证，官方限制 2 次/分钟/IP）。

**安全**：后台 `GET /api/admin/settings` **不回传明文**，只给「是否已配置 + 末 4 位」（如 `••••••••9853`）；Secret 输入框为 `password` 类型，留空表示不修改。由环境变量配置时后台输入框会锁定。
- **其它后缀** → `https://rdap.org/domain/xxx`（自动 302 到对应注册局），免 key，返回结构化 JSON
  - HTTP 404 = 注册局无记录，判为未注册
  - 解析出：注册商 + IANA ID、注册/到期/更新时间、EPP 状态、NS
  - GDPR 下注册人信息基本都被脱敏，代码不尝试解析

**缓存**：结果写入 `whois_cache` 表，TTL 6 小时。上游失败时若有旧缓存仍展示，并标注时间。

**第三方直达链接**（结果卡片底部）：whois.dnshe.com / ICANN Lookup。
（原 whois.com 已移除 —— DNSHE 公开 WHOIS 本身就能查外部域名，无需再外跳。）

**托管服务说明卡**（仿 DNSHE 公共域名说明页）

查询外部域名时会探测其 CNAME 指向，命中后在结果下方展示说明卡：

| CNAME 指向 | 显示为 |
|---|---|
| `dash.domain.meoy.top`（后台配置） | 你设定的名称，如「Meoy 面板」 |
| `cname.vercel-dns.com` | Vercel |
| `*.pages.dev` | Cloudflare Pages |
| `*.github.io` | GitHub Pages |
| 其它已知平台（17 种指纹） | Netlify / Firebase / Render / Fly.io / Deno / Heroku … |
| 认不出但有 CNAME | 标记「未识别平台」，原样展示 CNAME |
| 无 CNAME | 不展示 |

说明卡含：托管方名称、CNAME 指向、**滥用与违规举报通道**（投诉邮箱 + 在线举报入口）、服务条款按钮。

**后台配置项**（站点设置）：

| 项 | 说明 |
|---|---|
| 托管面板域名 / 显示名称 | CNAME 指向该域名时显示你的名称 |
| 投诉邮箱 / 在线举报入口 URL | 举报通道区块内容 |

CNAME 探测走 DoH（cloudflare-dns.com → dns.google 双端点降级），5 秒超时，失败不影响主查询。

新增数据源：编辑 `src/lib/whoisExt.js`。

> 注意：Cloudflare Workers 有真实出网能力，上述接口在部署后可正常访问。
> 本地沙盒若禁止外部出站，会走「查询失败 + 外链引导」分支，属正常降级。

`GET /api/whois?name=me`（公开，无需登录）或访问 `/whois.html`：

| 字段 | 说明 |
|---|---|
| `statusText` | 可注册 / 审核中 / 已注册 / 已驳回 / 已停用 / 系统保留 |
| `registeredAt`、`recordCount` | 申请时间、DNS 记录数 |
| `holder` | 持有人邮箱，默认脱敏 `ab***@gmail.com` |
| `reason` | 驳回或停用原因 |

**whois 子域名自动跳转**：访问 `whois.<根域名>`（如 `whois.meoy.top`）自动进入查询页；`whois.meoy.top/<名称>` 直接查询该名称。
**服务端重定向**（`src/index.js` 中间件，不依赖前端 JS，最可靠）：Worker 检测 Host 首段为 `whois`，把 `/` 与 `/<名称>` 302 到 WHOIS 页。**只接管入口页** —— `/dashboard`、`/admin`、`/whois`、`/domain` 等一律放行。

> ⚠️ 曾经踩过的坑：跳转逻辑写了两份（前端 `api.js` 一份、服务端一份），前端那份会在**每个页面**执行，于是访问 `/dashboard` 被踢去 `/whois.html?name=dashboard`，而登录页又把已登录的人送回 `/dashboard`，两边互相抢夺形成死循环。
> 现在**前端不再做任何 whois 跳转**，只由服务端处理。新增跳转逻辑时务必只写一处。

**WHOIS 页豁免规则**（它必须完全不受影响）：

1. **服务端**：中间件第一条判断就是 `/^\/whois(\.html)?$/i` → 无条件放行，任何 host 都不重定向
2. **免登录**：`mountNav('whois', { optional: true })`，未登录也正常渲染
3. **401 不踢人**：公开页设 `window.MEOY_PUBLIC_PAGE = true`，`api.req` 遇到 401 时不跳转登录页。
   这一条很关键 —— 未登录时 `/api/auth/me` 必然返回 401，若照旧跳 `/`，在 whois 子域下就形成 `/whois → / → /whois.html` 循环
4. **清理历史标记**：页面 head 清除 `meoy_whois_rd` / `meoy_whois_n`，不受旧版本残留状态影响

条款页同样按公开页处理。
为此 `wrangler.toml` 设了 `run_worker_first = true`，Worker 处理完后通过 `ASSETS.fetch()` 回落静态资源。**不要再手动改写路径**（补 `index.html`、去 `.html`）—— ASSETS 自带 `/xxx.html ⇄ /xxx` 规范化，两边都改会形成自指 307 死循环。

**入口分流**（`index.html` 头部同步脚本，早于页面渲染，作为前端兜底）：

| 访问 | 结果 |
|---|---|
| `meoy.top/` 已登录 | 直接进 `/dashboard`，不闪登录页 |
| `meoy.top/` 未登录 | 登录页 |
| `meoy.top/?login=1` | 强制留在登录页（切换账号用） |
| `whois.meoy.top/` | → `/whois.html` |
| `whois.meoy.top/google` | → `/whois.html?name=google` |

已登录时登录表单用 `visibility:hidden` 压住，直到确认是访客才显示，所以不会闪一下。

**WHOIS 是免登录页面**（`mountNav(..., { optional: true })`）。这一点很关键：早期版本它要求登录，未登录就跳 `/`，而 whois 子域又把 `/` 跳回 `/whois.html`，形成死循环。现在它不要求登录，并有计数熔断兜底。

防循环三重保护：只在入口页（`/`、`/index.html`）触发；识别 `whois` 与 `whois.html` 两种形态（部分托管会规范化掉 `.html`）；同一次会话内对同一目标只跳一次，落地后即清除标记。即使 `whois.html` 缺失被回退到首页也不会无限刷新。
需要先把 `whois` 这个主机名指向本 Worker —— 在 Cloudflare 的 Worker 设置里添加**自定义域/路由** `whois.meoy.top/*`（或在 DNS 里加一条指向 Worker 的记录并开启代理）。前缀可在 `public/js/api.js` 顶部的 `WHOIS_SUBDOMAIN` 改。

持有人显示策略（后台「站点设置」可改）：`masked` 脱敏（默认）/ `none` 不显示 / `full` 完整公开；**本人与管理员始终可见完整地址**。

**一致性与并发**：`/check`、`/whois`、提交申请三者共用同一套判定（`lookupLabel`），不会出现"页面显示可注册、提交却说已被注册"。此外对 `label` / `fqdn` 的唯一约束冲突做了兜底，并发抢注会返回「手慢一步，该子域名刚刚被他人注册」。

被驳回的名称：仅原申请人（或管理员）可重新申请，其他人查询时显示「暂不可用（原申请人正在处理）」，与提交时判定完全一致。

### 10. 登录页（参考 DNSHE 布局）

- 顶部导航：Logo + 站点名、注册账号 / 返回首页 / 服务条款、壁纸切换
- 左侧登录卡片：欢迎回来 + 邮箱 + 密码 + **记住我** + 登录账户；注册页在同一卡片内切换
- 右侧信息栏四个模块：账户控制台、注册域名（流程）、产品服务、账户安全提醒

**记住我**：勾选 → 会话 90 天；不勾选 → 1 天。注册默认 90 天。

### 11. 站点品牌（后台可改）

管理员在「管理后台 → 站点设置」可实时修改，无需重新部署：

| 项 | 默认 | 说明 |
|---|---|---|
| 站点名称 | `Meoy` | 显示在导航、标题、浏览器标签 |
| Logo | `/img/logo.jpg` | 站内路径或外链图片均可，带实时预览 |
| favicon | `/img/favicon.png` | 浏览器标签图标 |
| 站点公告 | 空 | 预留 |

改完点保存，导航 Logo 立即刷新，其它页面刷新一次生效。另有「恢复默认 Logo」按钮。

想换成本地图：把图片放进仓库的 `public/img/`，推一次，再把地址填进后台即可。

---

## 二、项目结构

```
subdomain-hub/
├── src/
│   ├── index.js                 入口：路由挂载、公开配置、尾斜杠兼容
│   ├── lib/
│   │   ├── records.js           12 种记录类型的字段定义与校验、Cloudflare payload 构造
│   │   ├── cf.js                Cloudflare DNS API 封装（含 MOCK 模式）
│   │   ├── crypto.js            PBKDF2 密码哈希、会话令牌
│   │   └── util.js              统一响应、审计日志
│   ├── middleware/auth.js       会话解析、requireAuth / requireAdmin
│   └── routes/
│       ├── auth.js              注册 / 登录 / 登出 / 改密
│       ├── subdomains.js        申请 / 列表 / 详情 / 释放（含可用性检查、保留字）
│       ├── records.js           记录增删改 + 根域名验证 + 确认解锁 + SOA 查看
│       └── admin.js             审核 / 封禁 / 配额 / 锁定管理 / 审计日志
├── public/                      前端（原生 HTML + CSS + JS，无构建）
│   ├── index.html               登录注册
│   ├── dashboard.html           我的子域名
│   ├── domain.html              DNS 记录管理 + 根域名验证
│   └── admin.html               管理后台
├── schema.sql                   D1 表结构
└── wrangler.toml                配置
```

---

## 三、部署步骤

### 1. 获取 Cloudflare 凭据

| 需要什么 | 去哪里拿 |
|---|---|
| **API Token** | <https://dash.cloudflare.com/profile/api-tokens> → Create Custom Token |
| **Account ID** | <https://dash.cloudflare.com/?to=/:account/workers-and-pages> 右侧栏 |
| **Zone ID** | 选中根域名 → Overview → 右下角 API 区块 |

API Token 需要的权限：

| 权限 | 资源 | 作用 |
|---|---|---|
| `Account` → `D1` → `Edit` | 你的账户 | CI 自动创建 D1 数据库 |
| `Account` → `Workers Scripts` → `Edit` | 你的账户 | 部署 Worker |
| `Zone` → `DNS` → `Edit` | 你的根域名 | 读写 DNS 记录 |

> 省事做法：用官方模板 **Edit Cloudflare Workers**（覆盖前两项），再补一条 Zone DNS 编辑权限。

### 2. 填 Secrets，推一次就完事

仓库 **Settings → Secrets and variables → Actions → Secrets**：

**必需**（4 个，缺任一个部署会直接报错并提示缺谁）

| 名称 | 必需 | 说明 |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | 必需 | 账户 ID |
| `CF_ZONE_ID` | 必需 | 根域名的 Zone ID |
| `CLOUDFLARE_API_TOKEN` | **二选一** | Cloudflare API Token，用于 CI 部署（建 D1、建表、发布） |
| `CF_API_TOKEN` | **二选一** | 同上，Worker 运行期调 DNS API 用 |

**关于两个 Token**：它们是同一个东西的两种用途，**填一个就行** ——

- 只填 `CLOUDFLARE_API_TOKEN` → 部署和 DNS 都用它
- 只填 `CF_API_TOKEN` → 部署和 DNS 都用它
- 两个都填 → 各用各的（可以给不同最小权限，更安全）
- 两个都不填 → 工作流第一步就报错退出

**可选**

| 名称 | 说明 |
|---|---|
| `D1_DATABASE_ID` | 一般不填：CI 会自动建库。只有你想用已有的另一个库时才填 |

然后 `git push origin main`，Actions 自动完成全流程：

1. **检查配置** —— 缺哪个必需项就直接报出名字，不用猜
2. **D1 数据库自动创建** —— 按名字查找，已存在就复用，不存在才创建（重复部署不会重复建库、不会丢数据）
3. 把 database_id 写进 `wrangler.toml`
4. 把 `CF_API_TOKEN` / `CF_ZONE_ID` 加密写入 Worker（等同 `wrangler secret put`）
5. 建表（幂等，只建不存在的表）
6. `wrangler deploy`

全程不需要 `wrangler login`、不需要手动改配置文件、不需要手动建库。

**可选调整**（Settings → Variables，明文即可）：

| 名称 | 说明 | 默认 |
|---|---|---|
| `ROOT_DOMAIN` | 根域名 | `meoy.top` |
| `DEFAULT_QUOTA` | 每用户子域名数 | `5` |
| `ALLOW_SIGNUP` | `1` 开放注册 / `0` 关闭 | `1` |
| `REQUIRE_APPROVAL` | `1` 需审核 / `0` 即时开通 | `1` |
| `RESERVED_LABELS` | 保留子域名（逗号分隔） | www/mail/admin… |
| `D1_DATABASE_NAME` | D1 数据库名 | `subdomain-hub-db` |
| `CF_MOCK` | `1` = 不调真实 Cloudflare | `0` |

改完 Variables 后手动 **Actions → Run workflow** 一次即可生效。

> 如果你不想让 CI 建库，也可以本地 `npx wrangler d1 create subdomain-hub-db` 后把真实 `database_id` 填进 `wrangler.toml`；此时 CI 检测到已填写就直接用，不会重复创建。

### 3. 本地命令行部署（不想用 Actions 时）

```bash
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ZONE_ID
npm run db:init
npm run deploy
```

部署后访问分配的 `*.workers.dev` 域名，第一个注册的用户即管理员。
如需绑定自己的域名：Workers → Settings → Domains & Routes 添加自定义域，然后在 Cloudflare DNS 里给它加一条 CNAME（会自动创建）。

### 5. 常用运维命令

```bash
npm run dev          # 本地开发（会用 .dev.vars）
npm run tail         # 查看线上日志
npm run admin a@b.com        # 把某用户设为管理员
npm run admin a@b.com --unban  # 解封用户
```

手动 SQL（如重置某人为管理员）：

```bash
npx wrangler d1 execute subdomain-hub-db --remote \
  --command "UPDATE users SET role='admin' WHERE email='a@b.com'"
```

---

## 四、本地调试（不碰真实 DNS）

```bash
cp .dev.vars.example .dev.vars   # 里面 CF_MOCK=1
npx wrangler d1 execute subdomain-hub-db --local --file=./schema.sql
npm run dev
```

`CF_MOCK=1` 时所有 DNS 写操作只在内存里模拟（返回 `mock1001` 这类假 ID），可以完整跑通注册 → 申请 → 审核 → 加记录 → 验证解锁的全部流程而不会影响线上 Zone。
上线前把 `CF_MOCK` 设为 `0` 并填写真实 Token / Zone ID。

---

## 五、接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（首位用户自动 admin） |
| POST | `/api/auth/login` `/logout` | 登录 / 登出 |
| GET | `/api/auth/me` | 当前用户与已用配额 |
| POST | `/api/auth/password` | 修改密码 |
| GET | `/api/config` | 记录类型、TTL、验证预设（前端初始化） |
| GET | `/api/subdomains/check?label=` | 可用性检查 |
| GET/POST | `/api/subdomains` | 我的列表 / 申请 |
| GET/PATCH/DELETE | `/api/subdomains/:id` | 详情（含记录）/ 改备注 / 释放 |
| GET/POST | `/api/subdomains/:id/records` | 记录列表 / 添加 |
| PATCH/DELETE | `/api/records/:id` | 编辑 / 删除（锁定记录拒绝） |
| POST | `/api/subdomains/:id/verify` | 写入并锁定验证 TXT |
| POST | `/api/records/:id/verify-confirm` | **确认认证完成**（唯一解锁入口） |
| POST | `/api/records/:id/force-unlock` | 管理员强制解锁 |
| GET | `/api/soa` | 区域 SOA（只读） |
| GET | `/api/admin/stats` `/subdomains` `/users` `/locks` `/audit` | 后台数据 |
| POST | `/api/admin/subdomains/:id/approve\|reject\|suspend\|restore` | 审核操作 |
| POST | `/api/admin/users/:id/ban\|unban\|quota` | 封禁 / 解封 / 配额角色 |

---

## 六、安全设计

- 记录名强制拼接在用户自己的子域名之下，`host` 无论填什么都只会生成 `xxx.子域名.根域名`，**无法越权改到根域或他人子域**
- 所有写操作先落 Cloudflare 再落库；Cloudflare 失败则不写库，避免脏数据
- 会话 token 32 字节随机，HttpOnly + SameSite=Lax，改密后踢掉其它会话
- 单子域名最多 50 条记录，用户配额、保留字、标签格式均在前后端双重校验
- 关键操作（注册/登录/建删记录/审核/封禁/解锁）全部写入 `audit_log`
- 密码 PBKDF2-SHA256 60000 轮 + 16 字节随机盐

---

## 七、已知限制

- **SOA**：Cloudflare 不允许通过 API 增删改区域 SOA，页面只提供查看；如需自定义需走 Cloudflare 工单
- **PTR**：只有在 Cloudflare 托管反向区域（in-addr.arpa）时才真正生效，正向域中创建仅作占位
- **NS**：Cloudflare 区域的根域 NS 不可修改，但子域委派（如 `sub.xxx.meoy.top` 的 NS）可以正常添加
- TXT 单条最长 2048 字符（Cloudflare 限制），超出需分段


---

## 开发语言：渐进式 TypeScript

项目支持 TypeScript，采用**渐进式迁移**，不破坏现有代码：

- Wrangler 原生支持 `.ts`（内置 esbuild 转译），**无需额外构建步骤**，`wrangler deploy` 直接可用
- `tsconfig.json` 里 `allowJs: true` + `checkJs: false` —— 存量 `.js` 正常参与打包，但暂不做类型检查
- 全局类型在 `src/types.d.ts`：`Env`（D1/R2/ASSETS/Secrets/Vars 全部绑定）、
  数据行类型（与 `schema.sql` 一一对应）、`SessionUser` 等
- 已迁移：~~`src/lib/util.js`~~ → `src/lib/util.ts`（统一响应 / audit / clientIp）

```bash
npm run typecheck   # tsc --noEmit，只检查 .ts
```

**为什么存量 `import ... from './util.js'` 不用改**：esbuild（Wrangler 内置）会把
`./util.js` 自动解析到同名的 `util.ts`，因此删除 `.js` 后所有引用无需修改。

**新代码约定**：新增模块请用 `.ts`，并 `import type { Env, UserRow } from '../types'`；
存量 `.js` 保持不动，除非要顺手重写。


---

## 多个根域名

一个站点可以同时分发多个根域名下的子域名（如 `meoy.top` 与 `foo.com`）。

**配置**（仓库 Settings → Variables，或 `wrangler.toml` 的 `[vars]`）：

| 变量 | 示例 | 说明 |
|---|---|---|
| `ROOT_DOMAINS` | `meoy.top,foo.com` | 允许的根域名列表，逗号分隔 |
| `CF_ZONE_IDS` | `meoy.top:aaa...,foo.com:bbb...` | 每个根域名对应的 Zone ID |
| `ROOT_DOMAIN` | `meoy.top` | 默认根域名（向后兼容，必须保留） |
| `CF_ZONE_ID` | `aaa...` | 默认 Zone（向后兼容） |

**向后兼容**：只填 `ROOT_DOMAIN` / `CF_ZONE_ID` 时，行为与单根域名完全一致。

**配额口径**：跨根域名**共享**。配额 5 就是总共 5 个，不按根域名分别计算 —— 避免通过多根域名绕过限制。

**使用**：控制台申请框在配置了多个根域名时会自动把静态后缀换成下拉选择，切换后实时重新查询可用性。

**数据结构**：`subdomains` 表新增 `root_domain` 列，同时**去掉了 `label` 的 UNIQUE 约束** ——
否则 `mail.meoy.top` 与 `mail.foo.com` 会互斥。唯一性改由 `fqdn` 承担（fqdn 已包含根域名）。
迁移在 `schema.sql` 里自动完成，`root_domain` 由 `fqdn` 反推，可重复执行。
旧表会保留为 `subdomains_old_mr`，确认无误后可自行删除。


---

## 主题：浅色 / 深色双皮肤

顶栏右侧有切换按钮（月亮 ⇄ 太阳），**全站 13 个页面通用**。

| 皮肤 | 参考 |
|---|---|
| 浅色（默认） | DnsNeko：蓝白网格底、白色卡片、蓝色主色 |
| 深色 | domin.xueling.top：深蓝云雾底、深色卡片、亮蓝主色 |

**实现**：只切 `documentElement[data-theme]`，颜色全部由 CSS 令牌接管，
组件样式不写死颜色 —— 因此两套皮肤共用同一套结构，新增页面自动支持。

**记忆**：选择存 `localStorage.meoy_theme`；未手动选过则跟随系统
`prefers-color-scheme`，系统切换时实时响应。

**防闪屏**：每个页面 `<head>` 里有一段同步脚本，在渲染前就把 `data-theme`
写好，避免深色模式刷新时先白一下。


---

## 天空蓝云层背景（Cloud Shader）

落地页 Hero 用了 WebGL 云层着色器（`public/js/cloud-shader.js`，纯原生无依赖）。

**关于 `npx shadcn@latest add @aceternity/cloud-shader`**：装不了，两个原因

1. **registry 被挡**：`ui.shadcn.com/r/registries.json` 与 `ui.aceternity.com/registry/*`
   在当前网络下均返回 403（`No policy rule matched the request`）。
2. **框架不匹配**：`shadcn info` 显示本项目是 `Manual`（无 React、无 Tailwind、
   无 `components.json`），而该组件是 React + Tailwind 的 TSX，本项目的原生
   HTML/CSS/JS（Cloudflare Workers）无法直接运行。

因此按同样的思路手写了一份：全屏 quad + FBM 噪声体积云 + 时间动画，
配色在深/浅主题下各一套。

**在任意页面启用**：加一个容器即可

```html
<div class="cloud-bg" data-cloud-speed="0.9"></div>
```

**特性**：无 WebGL 自动降级为 CSS 天空渐变（`.cloud-fallback`）；
标签切到后台暂停渲染；`prefers-reduced-motion` 下只画静态一帧；
DPR 上限 1.75 以照顾移动端性能；主题切换后自动重取配色。

## 壁纸

切换器里有 4 张：樱花喵 1/2、Miku、GUMI。想换回 Miku 主题直接选即可，
壁纸与深/浅主题互相独立。


---

## 界面骨架（参照后台面板模板）

控制台骨架按后台面板模板重做：

- **侧栏** 204px，白底；顶部品牌头，导航按「控制台 / 资源管理 / 用户中心 / 系统」分组；
  图标为线性风格（stroke 1.8），激活项实心主色 + 彩色投影
- **顶栏** 54px：面包屑（首页 / 当前页）+ 搜索框（Ctrl+K 聚焦域名输入）+ 通知铃铛（带未读数）+ 头像
- **内容区** 卡片圆角 16px + 柔和阴影；表格表头浅蓝底
- **新增组件** 分组标题、公告条、提示条（info/blue/red/warn）、开关、筛选胶囊、
  分段器、步骤条、空状态、底部页脚
- **个人资料页** 封面 + 浮起大头像 + 标签 + 签名 + 信息行

配色改为模板蓝：`--primary: #3b82f6`、`--background: #f3f7fd`、`--radius: 16px`，
全部走 CSS 令牌，深色主题自动适配。

公告条内容可在后台「站点设置 → 公告」配置，留空则不显示。
