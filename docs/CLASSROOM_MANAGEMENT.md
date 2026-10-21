# 班级与教师权限管理

## 使用流程

- 登录页按手绘顺序展示学生端／教师端、账号、密码、登录、超星一键登录，账号密码表单不折叠；选择入口不改变实际身份。
- 账号密码框仅用于已有的本平台邮箱账号。超星账号走官方 OAuth 授权页；已登录超星时可直接授权，未登录时在超星页面完成账号密码验证。当前没有核实到本项目获准使用的超星密码直登 API，不能把超星密码转发到邮箱认证接口，也不能把 cxid 拼成邮箱后宣称支持超星密码登录。公开接入依据：https://auth.open.chaoxing.com/open/doc/list/yluywps0/zpsakobd/u58aqj3r 。
- 教师端“班级管理”：填写名称创建班级，选择班级，从 Excel 复制包含表头的名单粘贴，或上传 UTF-8 CSV，预览后确认导入。列为“姓名、cxid、学号”，两个编号至少填一个，前导零保留。单批最多 500 人，不接收 JSON。
- 学生端班级规则（2026-10-21 起替代「学生申请—教师审批」流程）：登录后「我的班级」首次自选班级；不选可跳过进入游客班（无正式归属的逻辑分组，本人训练不受影响）；名单唯一可靠匹配自动入班（不扣换班次数）；此后允许自助换班一次（换班次数计入 `student_class_state.self_change_count`）。学生不会看到别人的名单或归属记录。
- 教师端「班级管理」：创建班级、导入名单（保留）、归档班级；不再有申请审批卡片。旧申请—审批接口已停用（返回明确拒绝），历史申请数据保留只读。
- 管理员在“班级管理 → 教师权限”输入 cxid 查找已经登录过的账号，核对姓名、绑定邮箱和账号标识，勾选确认后开通。授权固定绑定选定的内部账号，不对所有声称相同 cxid 的账号自动生效。普通教师不能开通其他教师。
- 撤销入口只处理本界面新增的授权；历史平台邮箱白名单仍通过原受控管理通道维护。管理员不能在此撤销自身或其他管理员。

## 身份可信边界

平台审计确认：`external_identities` 为空且学生可以自插；`profiles.chaoxing_uid` 及用户资料 cxid 可自行修改，不能作为权限或自动匹配依据。

`class_sync_identity()` 仅从已验证 JWT 的服务端 `app_metadata.chaoxing` 读取可信 cxid、学号与机构号。学号自动匹配必须有一致的非空机构号；任一可信字段与名单矛盾时不自动绑定。用户资料中的 cxid 仅用于管理员查找候选，不代表身份已验证。账号邮箱来自签发的 JWT，自称姓名用于展示，不作为唯一匹配依据。

**当前平台没有可信编号的账号不会自动分班**，2026-10-21 起改为首次自选／跳过进游客班／唯一可靠匹配自动入班／一次换班的自助流程；旧「学生申请—教师审批」接口已停用（`class_request_join`/`class_review_request` 撤销执行权限，函数与 `class_join_requests` 表及数据保留只读兼容历史）。名单匹配自动入班仅当可信编号恰好唯一命中一个正式班级且学生尚无 onboarding 状态时固化归属（`auto_match`，不扣换班次数）；多班同时命中不自动归班，由学生首次选班裁决。归属变更全部写入 `class_membership_history` 审计轨迹（不可删除），同一幂等 requestId 重复提交不重复执行、不重复扣次数。不能把现有可编辑 cxid 的命中描述为自动分班验收成功。

导入遇到重复编号、同编号不同姓名或矛盾字段会整体拒绝，保留旧名单与绑定，不静默覆盖。批准申请只在本班建立成员关系，不将学生自行填报的编号升级为全局可信身份。

## 数据与权限

复用 `cohorts/cohort_members`；新增 `owner_id`、名单、申请、账号声明快照、按账号绑定的教师授权、管理员和授权审计表。历史默认班级及训练记录的 `cohort_id` 不改写。平台 `cohorts.is_active` 为 integer，历史建库文件为 boolean，本轮不强制修改线上字段类型，真值与写入同时兼容两种来源。

2026-10-21 起班级规则改造新增（迁移 `20261021000000_class_self_onboarding.sql`）：

- `student_class_state`（学生唯一当前主班级、onboarding 状态、换班次数）与 `class_membership_history`（归属区间审计轨迹，`auto_match`/`legacy_backfill`/`initial_select`/`skip_guest`/`change_once` 五种来源，幂等 requestId 唯一约束）均不可客户端直写，只经 SECURITY DEFINER 受控 RPC 变更。
- 受控 RPC：`class_initial_select`（首次自选）、`class_skip_guest`（跳过进游客班）、`class_change_once`（一次换班，次数超限拒绝）、`class_archive`（教师归档班级）；`class_sync_identity` 尾部追加 `class_ensure_state`（名单唯一可靠匹配自动入班）。
- 归属期间判定 `app_member_at()` 与教师训练可见口径 `app_can_view_training()`：教师仅可见学生归属其管理的启用班级期间产生的训练数据（方案 10.5），restrictive 策略 `class_period_*` 叠加收紧（不删既有策略）覆盖训练会话/报告/消息/操作/调用记录/活跃事件与区间/已作答题库分配。
- `app_can_view_student()` 扩展历史归属分支（迁移 `20261021000100_teacher_student_index.sql`）：学生换班离开后，原班教师对其归属期间数据保留只读；教师学情首页的班级清单与学生当前归属映射统一经 `teacher_student_index()` 受控聚合出口读取（教师对自建新班级的 `cohort_members` 直读受既有 permissive 策略约束）。

- `app_is_teacher()` 保留旧邮箱白名单，增加仅匹配 `auth.uid()` 的教师授权。
- `app_is_project_admin()` 需要既有教师资格及管理员表记录；本应用没有新增管理员或自提权接口。首次管理员通过平台正式管理通道绑定已核对的内部用户 UUID，不把真实账号写进 Git。
- `app_manages_class()` 仅管理员或仍有教师资格的本班创建者可用。
- `app_can_view_student()`：管理员沿用全局学情；普通教师仅可见本人创建、仍启用班级的已入班学生。
- 既有宽泛教师策略额外受 restrictive RLS 限制，覆盖 profiles、会话、报告、消息、操作、调用记录、能力、题库分配、活跃事件与区间。成员表同样限制；撤销学生直接插入成员的权限，防止跳过审核。
- 7 个 `teacher_stats_*` SECURITY DEFINER RPC 显式限制学生范围，汇总与明细使用相同规则。指定跨班 userId 返回拒绝，不以空结果冒充授权成功。
- 病例原文、题库答案门控、媒体审核与身份验证链不变。普通教师没有班级时看不到学生学情，这是正确空状态。

## API

均经原有 Bearer 鉴权及 getUser 网络校验；不依赖网关 Cookie，不接受请求体角色。

| 接口 | 参数 | 权限 |
|---|---|---|
| GET /api/classes | classId 可选 | 学生仅班级选项和本人申请；教师仅所属班级，管理员全局 |
| POST /api/classes | create: name | 教师 |
| POST /api/classes | import: classId, rows | 本班教师／管理员，前端已转成受控结构 |
| POST /api/classes | initial_select: cohortId, requestId | 已登录学生，仅本人，首次自选 |
| POST /api/classes | skip: requestId | 已登录学生，仅本人，跳过进游客班 |
| POST /api/classes | change_once: cohortId, requestId | 已登录学生，仅本人，限一次 |
| POST /api/classes | archive: classId, confirmed=true | 本班教师／管理员 |
| GET /api/teacher/students/:id | 学生档案（归属历史+学情概览） | 教师（app_can_view_student，含历史归属期间） |
| GET /api/teacher/case-drafts | 历史草稿列表/详情（只读） | 白名单教师（D08 收口，写路径 410） |
| GET /api/teacher/case-import | 来源覆盖/版本诊断（只读） | 白名单教师（D08 收口，写路径 410） |
| GET /api/teacher/access | cxid 可选 | 仅管理员 |
| POST /api/teacher/access | grant: userId,cxid,confirmed=true | 仅管理员，绑定具体账号 |
| POST /api/teacher/access | revoke: userId,confirmed=true | 仅管理员，保留撤销及审计记录 |

接口不向客户端透传数据库异常及 SQL。数据库错误不显示成“没有班级”。

## 部署与验收

1. 备份并核对当前租户实际表、列和既有策略，按顺序执行新增迁移 `20261019023824_classroom_management.sql`、`20261021000000_class_self_onboarding.sql`、`20261021000100_teacher_student_index.sql`，不要修改历史迁移或跨租户查询。前两批迁移已在租户执行成功（见验收记录），`20261021` 两条为本批新增。
2. 首次管理员：通过平台正式管理通道，以当次确认的账号 UUID 写 `project_administrators`。核对其既有教师资格与姓名、邮箱绑定。用户标识、邮箱仅保留在受控管理记录，不在代码中硬编码。
3. 同步代码、`pnpm validate`、`pnpm build`、发布现有正式域名。
4. 管理员刷新登录后，`/api/auth/me` 同步本人账号声明，班级页出现“教师权限”。对方需先登录后才可被查找；学生首次登录经自选班／跳过游客班／名单唯一匹配自动入班，无审批环节。
5. 使用管理员、两个教师、两个学生分别验证未登录拒绝、本班允许、跨班拒绝、名单导入重试、首次选班、跳过游客班、一次换班（二次拒绝）、归档与撤销。不能用本地测试替代真实多身份验收。

本地新增测试在独立 WASM PostgreSQL 运行真实迁移、RLS 和 RPC，覆盖历史 boolean 与平台 integer 两种班级启用字段；仅合成账号，不连接正式数据库，不改真实名单。测试开发依赖 PGlite 不进入业务客户端。

真实平台多身份登录条件不足时，必须在交付记录中逐项标为未验收。没有真实名单时不创建虚构学生或训练记录。本轮不创建班级转移、跨校学生编号统一、课程后台挂载等远期功能。

### 真实接口回归脚本

`pnpm exec tsx scripts/verify-classroom-access.ts --cred-file <受限临时文件路径>` 复用既有学生／教师测试账号；不注册账号，不输出密码、token、姓名或原始响应。包含只读查询与预期拒绝的创建／审核负测请求；结束对这两个测试账号执行 signOut(global)，不触碰真实管理员会话。

受限 JSON 文件字段为 `appOrigin、supabaseUrl、anonKey、tenantId、student.email/password、teacher.email/password、otherUserId`；`otherClassId` 可选，用于跨班拒绝验证。来源只能是当前项目的受控配置与既有测试凭据，禁止把密钥写入示例、命令参数或 Git。Linux 权限为 0600，Windows 须关闭继承并仅授予当前用户访问，用后删除。`otherUserId` 只作为非秘密定位符；脚本只接受既有两个测试邮箱及 HTTPS cxiagents 项目地址，缺字段即退出。

### 网关未登录响应

本地应用未登录返回 401；正式平台实测会把此响应转换为无 Location 的 HTML 302。客户端在 cxiagents 网关域名下发现没有 SDK 会话时直接回登录，避免停在“HTTP 302”错误页；本地 Cookie／预览回退不变。真实接口脚本分开记录实际状态，匿名拒绝接受 401 或不含业务数据的 HTML 302，不把重定向当作鉴权成功。该域名判断仅用于网关会话处理，新增自定义网关域名时须按真实 Cookie/状态码契约调整。
