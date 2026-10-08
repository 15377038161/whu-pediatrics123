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
