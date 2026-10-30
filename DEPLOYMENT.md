# 写作后台与公开博客的部署

本机版本已经能编辑、保存、预览、粘贴图片并发布到本机博客。2026-10-30 已通过 Wrangler 部署写作后台并绑定私有 KV，未开通付费计划。GitHub OAuth 的 Client ID / Client Secret 已配置，线上接口已确认 configured=true，用户已报告 GitHub 登录成功，并已验证云端草稿保存、格式与图片恢复以及跨设备同步正常。GitHub Pages 与线上发布仍待验收。

后台地址：https://yschannel-writing-desk.yschannel-blog.workers.dev 。初始 TLS 握手失败现已恢复；在线 `/api/session` 已返回 HTTP 200，状态为未登录且 OAuth 尚未配置。

## 先注册 Cloudflare 免费账号

1. 打开 https://dash.cloudflare.com/sign-up ，用自己的邮箱注册并完成验证。
2. 进入控制台即可。这个方案不需要购买域名，也不使用付费 Workers 计划或 R2。
3. 免费 Workers 和 KV 有额度上限，不代表无限使用。保持 Free 计划；遇到需要升级的页面，先暂停，不开通付费。

官方额度与价格：https://developers.cloudflare.com/workers/platform/pricing/ 、https://developers.cloudflare.com/kv/platform/limits/ 。

## 本机使用

```text
npm ci
npm run build:admin
npm run dev
```

- 写作台：http://127.0.0.1:4175/admin/
- 博客：http://127.0.0.1:4175/
- 设备内自动保存：浏览器 IndexedDB。
- 本机后台保存：`.blog-admin/store.json`，已被 Git 忽略。不能将这个目录上传到公开仓库。
- 单张图片不超过 2 MB，支持 PNG/JPG/WebP/GIF；文章总大小不超过 18 MB。
- 本机模式不代表已经通过线上身份验证，也不会向 GitHub 推送；界面会明确提示。

## 部署前需要完成的三项配置

### 1. GitHub Pages

先把公开站点基础文件放进 `yschannel/yschannel.github.io` 的 `main` 分支，再在 Settings → Pages 选择从 `main` 根目录发布。添加 `.nojekyll`，按普通静态文件提供 ES modules。

文章清单是 `content/published.json`；图片在 `assets/uploads/`。文章发布不会把私有草稿提交到仓库。后台发布前会检查博客的 `index.html` 已存在，避免空仓库出现“提交成功但网站不可用”的情况。

公开博客不需要安装编辑器依赖；Tiptap 只用于独立后台。

### 2. Cloudflare Worker 与私有 KV

在自己的本机终端执行下面的命令，并完成 Cloudflare 官方登录授权：

```text
npx wrangler login
npx wrangler kv namespace create DRAFTS
```

把返回的 namespace ID 写入 `wrangler.jsonc` 对应的 `id`；其他占位符不能直接部署。这个 KV 保存私有草稿及会话，不能通过公开静态网址访问。

构建后首次部署获得后台网址：

```text
npm run build:admin
npx wrangler deploy
```

先不要把未经配置的后台当作正式写作入口；未配置登录时，发布按钮不会启用。

### 3. GitHub OAuth 登录

在 GitHub Settings → Developer settings → OAuth Apps 注册自己的应用：

- Homepage URL：刚部署的后台 Worker URL。
- Authorization callback URL：`https://后台域名/auth/callback`。

此实现请求 `public_repo` 权限，用于把文章和图片提交到公开仓库。这是 GitHub OAuth 的公开仓库权限范围，授权范围比单仓库更广；后台代码只允许 `yschannel` 登录，并只向配置的 `yschannel/yschannel.github.io` 写入。正式授权前应审阅权限；后续可改成权限更细的 GitHub App。

将 Client ID 和 Client Secret **直接写入 Cloudflare secrets**，不要放进代码、公开仓库或聊天：

```text
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

重新部署，访问后台并用 GitHub 登录。会话 Cookie 为 HttpOnly/Secure，GitHub token 保存在后台 KV，浏览器只能拿到会话与 CSRF 校验值。退出登录会删除会话。

## 验收流程

1. 电脑写草稿，选中文字加粗，粘贴图片，等待设备内保存，再点击保存草稿。
2. 刷新，确认文字、格式和图片都在。
3. 手机登录同一后台，打开同步的草稿。编辑同一篇文章时避免两台设备同时修改；KV 不是协同编辑数据库，修订号检查只能减少覆盖风险。
4. 预览，确认公开内容，再点击发布并确认。
5. 等待 GitHub Pages 完成更新，访问文章链接；检查图片、搜索、分类、日历和探测仪。

后台会保留草稿，发布不等于删除草稿。修改已发布文章后再次发布，会更新同一篇文章；链接与其他文章冲突时拒绝覆盖。设备内自动保存每次编辑后执行，后台同步在停顿约 45 秒后执行，也可手动保存；每天写入次数仍受 KV 免费额度限制。

## 当前验证边界

已自动测试内容验证、危险内容过滤、图片转静态资源、链接冲突、会话与 CSRF 校验、修订冲突；已在本机浏览器走通可视化编辑、加粗、图片粘贴、保存刷新恢复、预览与本机发布。

线上 OAuth 回调、跨设备同步和 GitHub Pages 实际更新需要账号配置后再验收，不能把本机验证当成这三项已经通过。




