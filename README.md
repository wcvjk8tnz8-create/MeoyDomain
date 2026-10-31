# 二级域名分发系统

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
- 子域名默认需管理员审核（可配置为即时开通）
- 违规使用可封禁：立即踢下线、禁止登录、全部子域名停用，可选一键清空其所有 DNS 记录

### 5. 站点品牌（后台可改）

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
