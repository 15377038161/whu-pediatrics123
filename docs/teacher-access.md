# 教师权限受控管理说明（teacher_emails 白名单）

本文档说明本项目的教师授权机制、受控授权/撤销流程与安全边界。历史邮箱白名单仍由管理员经平台正规管理通道（db_execute）维护。2026-10-19 新增项目管理员界面：按 cxid 查找候选、核对具体账号后写入按内部用户 UUID 绑定的授权，普通教师无授权能力。新流程与班级范围见 [班级与教师权限管理](CLASSROOM_MANAGEMENT.md)。下文旧验收记录保留其当时范围。

资料同步须应用 `20261015161000_profile_identity_server_role.sql`：旧参数 `p_app_role` 仅保留签名兼容，新行统计分类由服务端 `app_is_teacher()` 派生，不采信调用方角色。既有行分类不自动重写；新增或撤销教师后管理员应按统计口径复核 profiles 分类。`requireUser` 与 `requireAuth` 共用身份解析器，均保留 header/cookie 身份冲突拒绝规则。

## 一、机制（应用 / API / RLS 同源判定）

| 层 | 判定 | 实现 |
|----|------|------|
| 数据层（RLS） | `app_is_teacher()` | 既有 RPC（SECURITY DEFINER, STABLE）：`SELECT EXISTS (SELECT 1 FROM teacher_emails te WHERE lower(te.email) = lower(auth.jwt()->>'email'))` |
| 应用/API 层 | `applyTeacherWhitelistGate`（`src/lib/request-auth.ts`） | 以当前会话自身 token 调用同一 `app_is_teacher` RPC，经纯函数 `resolveWhitelistTeacherRole` 决策后统一 `requireAuth`/`requireUser` 门禁 |

安全规则（均已实现并有负测覆盖，见 `tests/teacher-whitelist-gate.test.ts`）：

1. **不信任客户端传参**：email/uid/role 一律不采信；白名单判定完全来自服务端 RPC（JWT 由 Supabase 签发，邮箱声明不可伪造）。
2. **邮箱所有权核验**：以服务端 `getUser()` 的 `email_confirmed_at` 字段为准（不读用户可改写的 `user_metadata.email_verified`）。白名单命中但邮箱未确认（如他人抢注白名单邮箱的未验证账号）一律不提升。
3. **fail-closed**：RPC 调用失败/异常/无 token/未配置数据库 → 不提升。
4. **仅恢复既有授权**：本轮未新增任何授权记录；门禁变更只是让既有白名单教师在应用层与数据层一致放行。

## 二、受控授权流程（邮箱已验证，SQL 已备，未执行）

目标账号的真实姓名/cxid/内部用户 ID/绑定邮箱均为**受控值，不写入本仓库**（仅存于平台管理通道记录与当次授权沟通中），本文以占位符表示：`<REALNAME>`、`<CXID>`、`<BOUND_EMAIL>`、`<USER_UUID>`。

绑定证据链（2026-10-15，核对结果存于受控记录）：

1. **服务端自视图实证**：账户所有者真实浏览器登录（教师入口 → 平台超星 OAuth，自动跳转 `/student`，姓名/头像正常），经 `/api/auth/me`（200）读取服务端响应：`chaoxingUid=<CXID>`、`displayName=<REALNAME>`、**绑定邮箱 `<BOUND_EMAIL>`**（平台代理超星 OAuth 首建的服务端字段，非 user_metadata 猜测）、`role=student`、`studentNo=null`、唯一用户 id `<USER_UUID>`。
2. **profiles 一致性核对（管理员只读查询）**：`chaoxing_uid='<CXID>'` → profiles 匹配 1 条、绑定内部用户唯一（distinct 1/1），且该行 `id` 与自视图用户 id 完全一致；该邮箱当前**不在** `teacher_emails` 白名单（`already_whitelisted=false`）。
3. **浏览器实证**：头像 `photo.chaoxing.com/p/<CXID>_80` 实际加载成功；有 9 条真实训练记录。

### 步骤

1. **确认绑定邮箱**（已完成）：`<BOUND_EMAIL>`，来源为服务端 `/api/auth/me` 自视图响应。
2. **账户所有者当次授权确认**：每次新增授权都必须收到明确同意回复后方可执行下一步。2026-10-15 本次目标账户已收到确认并完成授权；真实身份仅保存在受控数据库审计记录，不进入 Git。
3. **管理员执行授权**（唯一写入通道：平台 db_execute；执行前以受控记录核对邮箱与已验证值一致，替换占位符后执行）：

```sql
-- 通用操作模板（不是待执行任务；占位符须替换为当次确认、已核对的目标）
insert into teacher_emails (email, note)
values (
  '<BOUND_EMAIL>',
  '教师授权：<REALNAME>（cxid <CXID>，平台超星 OAuth 真实浏览器实证 2026-10-15；服务端 /api/auth/me 自视图验证绑定邮箱；绑定唯一内部用户 <USER_UUID>）'
)
on conflict (email) do nothing;
-- 复核唯一绑定后，仅同步目标账户的统计分类，避免将教师计入学生使用统计。
update profiles set app_role = 'teacher'
where id = '<USER_UUID>'::uuid and chaoxing_uid = '<CXID>';
```

4. **回查验证**：账户所有者重新登录 → `/api/auth/me` 返回 `role=teacher` → `/teacher` 工作台可用、教师 API 200；任意学生账号访问教师 API 403。

### 撤销（随时可执行，立即生效于下一个请求）

```sql
delete from teacher_emails where email = '<BOUND_EMAIL>';
update profiles set app_role = 'student'
where id = '<USER_UUID>'::uuid and chaoxing_uid = '<CXID>';
-- 回查：该账号 /api/auth/me 返回 role=student，教师 API 403
```

审计：`teacher_emails.note` 字段记录授权对象/依据/时间；应用请求日志不含授权写入路径，授权变更仅存在于平台管理通道记录中。

### 2026-10-15 正式环境验收

- 正式域名已发布 `d77eb3d`，部署日志显示应用启动正常。
- 本次目标绑定唯一（1/1）；白名单新增 1 条，目标 profiles 分类更新 1 行，未改 Auth 元数据。
- 当前真实登录会话 `/api/auth/me` 返回 200、`role=teacher`；学情工作台、使用统计、病例管理页面加载成功；病例发布、草稿、导入查询接口均返回 200。
- 使用统计明细不包含本次教师；3 个缺原始资料病例仍下架。本轮未进行病例新增或重新上架操作。
- 当前平台会话未返回手机号与真实学号/工号，不能以 cxid 冒充。头像地址可加载，未设置个性头像时显示平台默认头像。
- 新用户首次创建 profiles 的真实 INSERT 分支尚未实测；已有账户授权及读取验证不能代替该项。授权前该账号作为学生访问教师页面被拒；本轮没有新增另一学生身份的线上回归。

## 三、安全边界与已知风险

- **当前资料 cxid 不可直接作为授权键**：`user_metadata.cxid` 可由用户自行改写，不能凭它匹配教师授权。当前接入使用已验证账号的服务端邮箱声明与受控白名单；将来只有获得不可由用户改写的服务端 cxid 绑定后，才可评估直接按该绑定授权。
- **抢注风险**：若白名单邮箱尚无已确认账户，他人可能在开放注册下抢注。授权前必须确认该邮箱已完成所有权确认（`email_confirmed_at`）；门禁已将该核验作为硬性前置条件。
- **auth.users 平台边界**：应用与 Agent 不读不写 `auth.users`（含 app_metadata/管理 API/SERVICE_ROLE 密钥，均为平台安全约束禁止项）；不通过 search_path、动态 SQL、触发器等任何变体绕过。
- **预览身份不参与**：预览教师角色由签名 Cookie 承担（生产 fail-closed），与白名单机制无关。
