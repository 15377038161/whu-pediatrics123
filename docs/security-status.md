# 攻击面核验与正式评分阻断记录

更新时间：2026-10-08（核验阶段）；2026-10-09 复测补充见文末
实测脚本：`scripts/verify-attacks.ts`（真实 A/B JWT + Data API 直调，绕过 Next 路由模拟恶意客户端）
提交范围：仅 Coder 沙箱本地提交（最新 4eb998b），未推送 GitHub、未正式发布。

## 实测结果总览（2026-10-08）

| 编号 | 攻击向量 | 结果 | 证据 |
|---|---|---|---|
| 3a | 训练中(active)直调 case_snapshot_get_reference | **拦截** | 返回 null（完成态门控生效） |
| 3b | active 会话 stage 跳级 history→report | **拦截** | `SESSION_STAGE_SKIP_FORBIDDEN` |
| 3c | 学生逐步推进 stage（每次一格） | 允许（设计内） | owner_update + 单向有序；6 步后 stage=report |
| 3d | 学生自置 status=completed 后直调 get_reference | **VULN（攻击成功）** | update 成功；reference 返回完整诊断/方案 |
| 3e | completed 回退 active 重刷 | **拦截** | `SESSION_STATUS_REGRESSION` |
| 2 | 学生直改本人 state 注入伪造评分证据（events/decision） | **VULN（攻击成功）** | update 成功；伪造 decision 落库 |
| 1 | 完成会话后直调 report_save_completed 传自选 100 分 | **VULN（攻击成功）** | rpc=true；落库 total_score=100 |

**结论：拦截 3 / 攻击成功 3。正式评分与可信考试成绩交付为【阻断项】；练习反馈（过程分）可保留。**

## 根因分析

平台无服务端特权身份（SERVICE_ROLE_KEY 仅存在于 Coder 平台服务端，不进入生成应用）。因此：

1. **攻击1根因**：`report_save_completed` RPC 接受客户端传入的 `p_total_score`。教师可写教师身份调用（正当），但**学生以本人 JWT 同样可调用**——数据库无法区分「Next 服务端 finish 路由调用」与「学生 Data API 直调」，因为两者都持有用户 JWT。
2. **攻击2根因**：`training_sessions` 的 `owner_update` 策略允许学生更新本人 state（业务上会话推进依赖它），而评分输入（events/decision）全部存于 state 内，无法用列级策略区分「阶段推进」与「证据篡改」。
3. **攻击3d根因**：status 列更新无「须经服务端流程」的区分机制。guard 触发器只能约束方向（active→completed 允许），无法验证该转换是否来自合法 finish 流程。学生自置 completed 后即可解锁 reference 读取诊断对照。

## 不可行的替代方案（已排除，不采用）

- ~~MD5/自定义秘密签名~~：密钥必须进入生成应用（客户端可见或环境变量），学生可提取后伪造，非可信。
- ~~放宽为匿名/服务角色直连~~：违反平台安全红线（禁止导出 SERVICE_ROLE_KEY、禁止伪造用户 JWT）。
- ~~接受攻击成功并宣称安全~~：违反如实记录原则。

## 平台官方方案选项（需平台侧/用户选择）

**选项 A（推荐）：平台提供可信服务端写通道**
平台在 Coder 服务端提供「应用后端→数据库」的特权执行入口（如平台代理的 RPC 执行 API，携带平台侧身份），使 `report_save_completed`/`training_sessions.status` 写操作仅可由服务端流程发起。契约缺口：当前 `db_execute` 仅为迁移工具，运行时无服务端特权通道。

**选项 B：评分下移至平台任务流（TaskFlow）**
把 finish→buildReport→保存 改为调用平台预定义任务流（服务端执行、学生 JWT 只能触发不能传参分数）。契约缺口：需平台配置对应任务流（`list_task_flow` 当前未列出此类流）。

**选项 C：成绩降级为「练习反馈」交付（当前默认）**
数据库所有报告仅标注 `status: 'practice'`（练习反馈），UI/文档明确「非可信考试成绩」；教师端报告保留 `teacher_select` 全量可见并在展示时注明分数可被学生自改。零平台依赖，立即可用。

## 在选项落地前的临时约束（已实施）

- `docs/知识库接入与安全状态.md` 已声明：报告分数不得作为可信考试成绩交付
- E2E 脚本保留 7.4 节如实记录（不作安全断言）
- 攻击实测脚本 `verify-attacks.ts` 保留全部断言（攻击成功记 VULN，不删除断言凑通过）

## 与 70/0 E2E 的关系说明

`verify-rls-e2e.ts` 的 70/0 覆盖：RLS 行级隔离（跨用户/越权/直读拦截）、幂等、归属校验。**不覆盖**上述三条攻击（同一用户对自有数据的完整性攻击）。两者互补，均不可单独宣称「安全完成」。

## 2026-10-09 复测补充

- **agent_call_records 唯一约束修复实证**：`scripts/verify-agent-turn.ts` 7/7 通过（连续两轮问诊 200、幂等重复提交 200、跨学生 turn 403、未登录 401、落库两行独立记录）。此前「学生每轮对话 AI 应答在持久化调用记录时 409」的问题已解决。
- **platform-session 路由安全核验**：`scripts/verify-platform-session-security.ts` 11/11 通过（伪造 token/假签名 JWT 401 不落 cookie、假 cookie 401、学生访问教师路由 403、body 注入 role 无效、身份经 auth.getUser 网络验证）。
- **已知行为如实记录**：Supabase setSession 在 access 有效期内不校验 refresh（混合 token 返回 200）。评估结论：身份仍由真实 access token + getUser 网络验证保证，不可伪造他人身份；无效 refresh 导致会话不可续期、短期自动失效，非身份伪造漏洞，不以 401 断言宣称拦截。

## 2026-10-09 沙箱网关 Cookie 透传限制（平台阻断证据，fail-closed）

**现象**：真实浏览器完成完整 OAuth 链路（authorize-url 200 → 超星授权 → checklogin 中转 → exchange 200 → `POST /api/auth/callback/platform-session` 200），最终仍停留在登录首页，未登录。

**诊断结论：应用侧无缺陷，沙箱预览网关限制**。证据链（脱敏复跑脚本 `scripts/verify-platform-session-chain.ts`，全部 PASS）：

| 实验 | 结果 | 证据 |
|---|---|---|
| 本地直连 `platform-session`（真实学生 session） | HTTP 200，Set-Cookie 名含 `luojia-peds-auth` | 落地正常 |
| 本地直连 `GET /`（带会话 cookie） | **HTTP 307 → /student** | 服务端鉴权 + 角色重定向全通 |
| 网关域名 `platform-session` | HTTP 200，Set-Cookie 正确下发 | 落地路由正常 |
| 网关域名 `GET /`（显式携带会话 cookie） | HTTP 200 登录页 | cookie 到达应用时被剥离（app.log 该请求 `cookies:none`） |
| 网关 Cookie 透传对照（唯一路径 `/diag-cookie-fwd-*`，显式发送 `fwd-probe=1` 与 `luojia-peds-auth=shortdummy`） | 应用日志仅见网关 jar 回放的 `luojia_peds_preview_teacher`，**两个显式 cookie 均未到达** | 网关不透传客户端 Cookie，与 secure 标志无关 |

**根因**：沙箱预览网关不透传客户端请求的 Cookie 头，仅回放其共享 cookie jar 中缓存的值。`platform-session` 正确下发的 `Set-Cookie` 因此无法在后续请求中回传，服务端 `getUser` 鉴权永远收不到会话。

**已排除的安全降级方案**：去掉 auth cookie 的 secure 标志可让其进入网关共享 jar 被回放，但会导致 **http 明文传输 + 所有沙箱访客串用同一会话**（此前预览身份串用已实证该机制），属安全红线，不采用。

**未验边界**：完整 OAuth 链路（authorize → 扫码授权 → exchange → 会话落地 → 角色重定向）的浏览器端验收被此平台限制阻断；本地直连链路已实证可用。待平台网关支持客户端 Cookie 透传后复验。

**恢复条件**：平台网关支持 Cookie 透传（或提供非网关的正式部署域名）后，用真实超星账号走一遍登录即可复验，应用代码无需改动。
- **选项 B 契约再核验**：`list_task_flow` 返回空——平台当前无任何预定义任务流，选项 B（评分下移任务流）依赖平台配置，缺口未闭合。选项 A/C 状态不变。

## 2026-10-09 补充：Origin/CSRF 防护与真实重启持久化实测

- **platform-session 路由 Origin 防护**：POST 前校验 `Origin`（同源或平台预览域名 `CODER_PROJECTS_DOMAIN`），跨站一律 403；无 Origin 头的非浏览器客户端放行，由 token 签名校验兜底。`scripts/verify-platform-session-security.ts` 扩至 **13/13 通过**（新增 A3 跨站 Origin 403 拒绝、A4 同源放行至 token 校验）。
- **真实服务重启持久化**：`scripts/verify-restart-persistence.ts` **9/9 通过**——学生登录落 cookie → 作答一题 → touch 入口触发 `tsx watch` 真实重启（服务 PID 实际变化，非 DB 复读等价替代）→ 同 cookie 复读作答记录完整保留（含首次提交答案）→ 重新登录新 cookie 仍可读 → logout 后原 cookie 访问受保护接口 401。
- **cookie 会话安全**：会话由服务端 SSR 客户端 setSession 写 httpOnly cookie，重启后凭数据库持久会话自动恢复；退出后 cookie 立即失效，无泄露残留。

## 2026-10-09 补充：登录入口链路核验与草稿严格交集恢复

### 平台内置超星 OAuth 登录链路（首页主入口，实测）

首页登录按钮为 `PlatformChaoxingLogin`（`src/components/platform-chaoxing-login.tsx`），完整链路：

| 步骤 | 端点 | 实测状态 |
|------|------|----------|
| 1. 点击「使用超星账号进入」 | `GET {平台代理}/v1/api/coder/proxy/auth/chaoxing-oauth/authorize-url?redirect_uri=<首页>` | **200**，返回真实超星授权地址（`auth.chaoxing.com/connect/oauth2/authorize`，appid 由平台持有） |
| 2. 顶层跳转授权页，用户扫码授权 | 超星授权页（人工操作） | 需真实超星账号登录 |
| 3. 回跳首页带 code → checklogin 中转 | `GET {平台代理}/v1/api/coder/proxy/auth/chaoxing-checklogin/url?backurl=<首页>` | **200** |
| 4. userinfo 回跳 → exchange 兑换 | `POST {平台代理}/v1/api/coder/proxy/auth/chaoxing-oauth/exchange` | 平台侧兑换 Supabase session |
| 5. session 落地 | `POST /api/auth/callback/platform-session` | 空 body **400**、跨站 Origin **403**、伪造 token **401**（不落 cookie） |

**与旧接口的区分**：`/api/auth/chaoxing`（旧自有 OAuth，依赖 `CHAOXING_APPID/SECRET`）当前 307 → `config_missing`，属**旧链路 fail-closed**，不代表平台内置登录失败。首页已不使用旧接口。

**平台契约限制（如实保留）**：authorize-url 仅接受 `redirect_uri`，不支持应用级 state/nonce（平台契约，非应用缺陷）；跨租户合法 token 拒绝测试无样本，标注未测。

### 2026-10-09 补充：登录按钮「点击后恢复」的根因与修复（完整 OAuth 仍未验）

**用户浏览器实测症状**：刷新首页点击「使用超星账号进入」→ 短暂「正在连接超星…」后按钮恢复原状，地址未跳转、无错误提示、无新窗口、Console 无报错。

**根因排查（脱敏运行证据）**：

1. **authorize-url API 排除**：本地直连与网关域名（模拟浏览器头）均 **200** + 真实授权地址 + 正确 CORS——API 层无缺陷。
2. **双重缺口定位**：
   - `src/lib/chaoxing-oauth-client.ts` 源码已含诊断代码（NAV_ATTEMPT 标记、空授权地址显式报错）
   - 但 `platform-chaoxing-login.tsx` 组件**从未消费 `consumeNavigationAttempt`**——标记写入后无人读取，兜底按钮不存在
   - `.next` 产物为旧构建（BUILD_ID 旧值），不含任何新特征——`tsx watch` 热重载只影响 server.ts 入口，不重编 Next 客户端产物
3. **症状吻合路径**：`window.location.assign(外部授权域)` 被内置浏览器环境拦截 → 页面重载回 `/` → React 状态重置（视觉即「按钮恢复」）→ sessionStorage 中的拦截标记因组件未消费而失效。**此为最吻合假说，尚未经浏览器最终确认**（不把外部导航拦截假说当确认根因）。

**修复（已实施，本地提交不推送）**：

- 组件挂载时 `useEffect` 消费 `consumeNavigationAttempt()`：存在标记 → 显示 `自动跳转超星登录页被当前浏览器环境拦截` 错误提示 + 「手动打开超星登录页」按钮（`window.open` 新窗口，`noopener,noreferrer`）
- 库层既有防线不变：网络失败 / 非 200 / 空/畸形授权地址均显式报错，不静默恢复按钮
- 重新构建并经 tsx watch 重载：新 BUILD_ID 已上线，新特征（`手动打开超星登录页` / `cx_nav_attempt`）已确认存在于**经域名实际服务的 chunk** 中

**页面可见验收标志（浏览器复验用）**：

1. 刷新首页 → 点击「使用超星账号进入」
2. 若导航被拦截：按钮恢复后应出现 **红色错误提示**「自动跳转超星登录页被当前浏览器环境拦截」+ **「手动打开超星登录页」按钮**（点击新窗口打开授权页）——若仍无任何提示则说明拦截标记未生效，需回报
3. 若导航成功：地址跳转超星授权页，扫码/登录后回跳本站自动建立会话

**状态声明：完整 OAuth 登录链路（authorize → 扫码 → 回跳 → exchange → session 落地 → 角色重定向）仍未验证**——需要真实超星账号在浏览器中完成人工授权步骤。此前 authorize-url/checklogin 的 HTTP 200 仅证明 API 层可用，不构成完整登录成功。

### 2026-10-10 诊断阶段：登录按钮可见阶段标志（login-diag-20261010-a）

**背景**：上一轮修复（拦截标记消费 + 手动跳转兜底）经真实浏览器复验**未通过**——点击登录后按钮恢复、无红色提示、无手动按钮、地址未跳转。按判据确认「标记机制未达验收」，本轮不再新增 cookie/跳转兜底补丁，改为**可见诊断阶段标志**以区分根因归属。

**实际挂载的调用关系与分支**（源码核实）：

- `PlatformChaoxingLogin.login()`：`setPending(true)` → `loginWithChaoxingOAuth()` → 失败分支必渲染 `login-error`；成功分支保持 pending 等待跳转
- `loginWithChaoxingOAuth()` 四个失败分支（网络 catch / 非 2xx / JSON 解析失败 / URL 校验失败）均返回 `{success:false}` → 必显示错误文案
- 唯一成功路径：fetch 200 → 有效授权地址 → `window.location.assign`
- **推论**：用户症状（按钮恢复且无任何提示）在当前源码分支下无法由「失败分支」产生——要么 `assign` 后页面重载（状态重置），要么浏览器运行的不是当前源码产物。此为待区分假说，**不当作确认根因**

**本轮改动（可见诊断，不新增跳转绕过）**：

- `chaoxing-oauth-client.ts`：`loginWithChaoxingOAuth` 接受可选 `onStage` 回调，六个阶段（fetch-start / fetch-network-error / fetch-http-error / authorize-url-ok / authorize-url-invalid / nav-assign）逐阶段上报，仅状态与 HTTP 状态码，不含 URL/token/授权码
- `platform-chaoxing-login.tsx`：实时渲染阶段文案（阶段1/2/3 中文标签）、`data-login-diag="login-diag-20261010-a"` 版本标志（data 属性可被用户在 DOM 检查确认）、`nav-assign` 后 3 秒未跳转的可见提示；错误分类提示保留
- 诊断信息全部用户可见，不以 sessionStorage 持久性假定浏览器行为

**产物验证（经域名实际服务确认）**：

- 版本标志 `login-diag-20261010-a` 存在于域名服务的 chunk `ed9b81af51d599c1.js`
- 六个阶段标识符全部存在于该 chunk；组件 JSX（`data-stage`/`data-login-diag`/`login-stage-hint`）存在于 chunk `2e9cb1db8738bf42.js`
- 首页 HTML（200）同时引用两个 chunk 且 SSR 渲染登录入口
- typecheck / eslint 0 错误

**浏览器验收判据（用户点击用）**：

1. 强刷首页 → DevTools Elements 检查登录卡片容器应有 `data-login-diag="login-diag-20261010-a"`（确认新产物已加载；若无此属性则浏览器缓存旧 chunk）
2. 点击「使用超星账号进入」→ 观察按钮下方阶段文案：
   - 停在「阶段1失败」→ 请求层问题（网络/网关），报具体 HTTP 状态码
   - 到「阶段2：已获取授权地址」后无下文 → fetch 成功但 assign 不可达（浏览器/网关拦截顶层导航）
   - 到「阶段3：正在跳转超星授权页」且 3 秒未跳转 → 出现可见提示，确认顶层导航被环境拦截
3. **未验边界**：完整 OAuth（含 assign 实际跳转、扫码授权、exchange、session 落地）**仍未验证**；本轮仅为诊断可见化，不声明登录已修复

### 草稿功能授权：严格交集恢复

`/api/teacher/case-drafts`（`src/app/api/teacher/case-drafts/route.ts` GET L20 / POST L37）与页面 `/teacher/case-drafts` 均恢复为：**应用层教师角色（`requireAuth(request, 'teacher')` / `requirePageUser('teacher')`）AND 数据库白名单（`app_is_teacher` RPC）**，非 OR、非仅白名单。

实测（`scripts/verify-case-drafts.ts`，12/0）：

- 非双重授权探针B（DB 白名单通过、应用层 role=student）：GET 草稿 **403**、POST precheck **403**、页面 **307 → /student**
- 学生A：GET/POST **403**；匿名 **401**
- Data API 直插（学生 **403**）、直读（学生 0 行、匿名 401）——RLS 层独立有效
- 真实服务重启（PID 变化）后 fail-closed 不漂移：探针B **403**、学生 **403**

**未验项（如实）**：双重授权教师（应用层教师角色 + 数据库白名单同时满足）的 HTTP 保存/列表/重启复读——当前沙箱无此类样本（白名单探针B无应用层教师元数据）。此前 16/0 为白名单单一判定下的结果，不能冒充严格交集的成功链路。Data API 层（RLS）单独记录如上。

### AI 测试：官方 SDK 错误类覆盖补充

`tests/coze-ai.test.ts` 新增官方 `coder-coding-dev-sdk` 错误类断言（当前文本链路实际抛出的类型）：429/401/403/400/408/502/503/无状态码/NetworkError 分类、限流退避重试（attempts=2、sleep≥base）、认证错误不重试（attempts=1、sleep=0）。与旧 `coze-coding-dev-sdk` 对照断言并存。**单测 84/0 / 4 skip 全绿**。


## 2026-10-09 预览身份入口安全关闭（止血）


### 背景与根因


真实浏览器复验（45d718b 之后）确认：退出登录后刷新 `/teacher` 仍显示「评委预览教师」。app.log 取证实证沙箱网关行为：**网关会向无 Cookie 请求回放其 Cookie jar 中最近一次 Set-Cookie 的有效预览 Cookie**（退出下发的 `Max-Age=0` 清除头无法阻止网关重放旧的有效值）。角色后缀 Cookie + 冲突 fail-closed 可防双角色串用，但**无法防单一旧有效 Cookie 的网关回放**——应用侧任何 Cookie 方案都无法对抗该平台层行为。


### 止血措施（收紧演示访问，未扩大任何权限）


1. 运行环境开关：`.env.local` 中 `ENABLE_UI_PREVIEW` 由 `true` 改为 **`false`**（该文件被 gitignore，属运行时配置，不入库）
2. 源码层确认（既有实现，无需改动即遵守开关）：
   - `src/app/api/preview/login/route.ts` L6：开关关闭返回 **404**
   - `src/app/api/preview/switch-role/route.ts` L12：开关关闭拒绝切换（**403**）
   - `src/lib/preview-auth.ts` L91 `readPreviewUser`：开关关闭一律返回 null（**服务端拒绝，非仅隐藏按钮**）
   - `src/app/page.tsx` L12/L51-52：首页预览按钮受 `isPreviewEnabled()` 条件渲染，关闭后不再显示
3. 保留正式超星账号登录（`PlatformChaoxingLogin` 平台代理链路）及其原有权限，未改动任何真实角色/RLS/鉴权边界


### 脱敏 HTTP 断言（实测通过，2026-10-09 19:45 UTC）


重载方式：`touch src/server.ts` 触发既有 `tsx watch`（PID 345，08:33:56 启动）热重载。


| 断言 | 本地直连 | 网关域名链路 |
|------|----------|--------------|
| `POST /api/preview/switch-role`（旧角色 Cookie） | **403** 拒绝 | — |
| `GET /api/preview/login?role=student` | **404** | **404** |
| `GET /student`（携带旧教师+学生+旧单名三种 Cookie 名） | **307 → 登录首页** | **307 → 登录首页** |
| `GET /teacher`（携带旧教师 Cookie） | **307 → 登录首页** | **307 → 登录首页** |


**结论**：`readPreviewUser` 在开关关闭下不认任何预览 Cookie（包括网关回放的旧有效值），预览身份已完全失效；仅平台账号登录可用。


### 平台限制证据（等待平台解决）


- 网关 Cookie 回放：退出请求下发清除头后，网关仍对后续无 Cookie 请求注入旧有效预览 Cookie（app.log 多次实证：`GET /` 在浏览器 jar 为空时携带 `luojia_peds_preview` 到达）
- 浏览器强制刷新无法清除 HttpOnly Cookie，且网关回放使退出语义在平台层不可靠
- 因此预览身份入口保持关闭，直到平台网关支持可靠的 Cookie 清除/不复放语义。届时将 `ENABLE_UI_PREVIEW` 恢复 `true` 即可重新启用（源码链路完整保留）。


### 后续 390px 学生 UI 验收说明


在当前止血状态下，学生端 UI 验收需使用**真实超星学生账号**登录后进行（平台账号登录为唯一入口）；预览身份入口已安全关闭，无法用于 UI 验收。


## 2026-10-10 补充：OSCE 事实投影证据门控（迁移 20261010120000）


### 整改范围（无权限扩大/删除/发布）


1. **facts 投影改依据「已执行操作证据」**：此前 `case_snapshot_get_facts` 的阶段投影读受保护 `stage` 列，但学生可经 owner_update 直改 stage 列逐格推进后读全量 facts。现改为依据 state 内证据（`unlockedEvidence` 的 SOURCE_EX_/EX_ 码解锁查体事实；`orderedTests` 非空解锁检查事实），直改 stage 列不再解锁任何额外事实。
2. **reference 完成门控补真实 FINISH_SESSION 事件**：直改 `status='completed'` 无 FINISH 事件（单向量）→ 返回 null；仅伪造 FINISH 事件而 status 仍 active（单向量）→ 返回 null。
3. 学生 DOC 资源访问（`/api/cases/[id]/resource`）403 拦截，教师保留全量读取；OSCE 模式 agent turn 事件-阶段门控（沉浸式教学自由探索不变）。


### 实测验证（verify-rls-e2e.ts，81/0 pass）


- 单向量攻击全拦截：直改 stage / 直改 status / 仅伪造事件 → 投影不变、对照 null
- 组合伪造（completed + 伪 FINISH 事件）**属既有「提前交卷」边界**：Data API 层学生自行完成会话与 finish 路由产物不可区分（与攻击1根因同源）。代价受 guard 强制：会话永久完结不可回退（SESSION_STATUS_REGRESSION），且 OSCE 评分只认可信事件链，解锁对照不改变评分。脚本以「行为记录」断言如实记录，不作安全断言。
- 验证脚本修正：探针残留自愈清理改教师身份删除（学生无 DELETE 策略属防刷分设计）；取题空数组改防御性退出并给出定位信息；单向量攻击移至 active 会话上测试（时序 bug）。
- 静态检查 typecheck/lint 通过；单测 88/0 pass（4 项跳过为 Coze live 联调，环境依赖，与本次无关）。


### 未验边界（如实记录）


1. 真实浏览器端交互验收（需真实超星账号）
2. 跨租户会话隔离验证
3. 平台正式部署环境的完整链路验证


## 2026-10-10 收尾验收：reference 收紧后的 finish 降级链与运行时实证

### 构建与重启（真实产物证据）

- `pnpm run build` 成功，BUILD_ID 由 `_ff7_vx7EhS7QrBNgQCvn` 更新为 `G9qELajNO0SLYE4ql8_l0`；经既有 tsx watch 入口触发真实重启（app.log 06:09:45 Restarting → 06:09:47 ready）。
- `/api/health/integrations`：`app: ready`、`database: connected`、AI `configured`（平台注入凭据）。
- `ENABLE_UI_PREVIEW=false` 生效：`/api/preview/login` 返回 404（服务端拒绝，非仅隐藏按钮）。

### reference=null 收紧语义的降级验证（注入式回归 + HTTP 断言）

- **注入式回归（tests/finish-null-reference.test.ts，3/3 pass，内存 Repository 不碰外部服务、不伪造 JWT/cookie）**：
  - 合法 finish（reference=null）→ 报告生成 → 再读取报告全链路无异常、幂等（二次 finish 返回既有报告）；
  - 报告**无诊断/处置标准答案回填**（reference 字段为空，过程反馈不含「标准诊断/参考答案」字样）；
  - 总分严格等于六维过程证据分项之和（评分仅来自明确过程反馈）；无过程证据只得过程低分（查体/检查维度 0 分）；
  - 学生 B 读学生 A 报告被拒。
- **HTTP 断言（scripts/verify-finish-http-assertions.ts，本地直连 12/12 pass，凭据运行时随机生成不打印）**：
  - 匿名访问 sessions/reports/cases/quiz 全部 401；学生 B 读 A 会话 404（不泄露存在性）；读不存在报告 404；非白名单用户访问教师接口 403；探针数据已清理。
- **正式评分语义如实记录**：reference 收紧后学生报告仅含过程反馈分；正式评分（含诊断对照评分）仍为阻断项，待平台可信服务端写通道方案（A/B/C）由用户选型，未默认任何方案。

### 教师合法读取 reference/answers

- 数据库层教师直读 RLS 策略保留（`case_snapshot_answers` 仅 `app_is_teacher()`）；沙箱当前无合法教师样本（应用层超星教师元数据 + 数据库白名单双重授权均需满足），**教师正向 HTTP 读取标未验**。

### 剩余已知边界（不写全部完成）

1. **facts 伪证据边界**：`state.unlockedEvidence`/`orderedTests` 仍在学生 owner_update 可写范围内——学生伪造证据码仍可经 facts RPC 读到查体/检查事实（教学性事实，非诊断答案）。诊断/处置对照（reference/answers）已收紧为教师专用，不受此影响。彻底闭合需服务端事件链判定证据真实性（与正式评分 A/B/C 选型同源），待用户决定。
2. 真实浏览器端交互验收（需真实超星账号）、跨租户隔离、平台正式部署链路。
3. 网关域名链路 Cookie 剥离（平台限制，见前述章节），本轮 HTTP 断言均在本地直连完成。
