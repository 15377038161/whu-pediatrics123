## 项目概述

珞珈儿科智训（luojia-pediatrics-agent）：面向武汉大学儿科学教学与教育智能体竞赛的移动端优先全栈 Web 应用。以统一儿科教学智能体贯穿问诊、查体、辅助检查、诊断处置、沟通、OSCE 和学情分析。

## 技术栈

- **框架**：Next.js 16（App Router）
- **语言**：TypeScript 5（strict）
- **UI**：React 19 + Tailwind CSS v4 + Lucide Icons
- **数据库/认证**：Supabase（@supabase/ssr + @supabase/supabase-js）
- **AI SDK**：coze-coding-dev-sdk
- **校验**：Zod
- **构建**：tsup（服务端独立打包）、pnpm
- **运行时**：Node.js >= 20

## 目录结构

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # API Routes（agent/auth/cases/diag/engagement/health/internal/quiz/reports/sessions/teacher）
│   ├── about/              # 关于页
│   ├── auth/               # 认证页
│   ├── student/            # 学生端页面
│   ├── teacher/            # 教师端页面
│   ├── layout.tsx          # 根布局
│   ├── page.tsx            # 首页
│   └── globals.css         # 全局样式
├── components/             # 共享组件（case-library 病例库卡片/搜索/分页在此）
├── domain/                 # 业务领域（病例目录、病例事实、规则、case-classification 多维分类）
├── lib/                    # 工具库（智能体引擎等）
└── server.ts               # 生产环境自定义服务器（node:http + next）
supabase/migrations/        # 数据表、索引、RLS
docs/                       # 实施方案文档
demo/                       # 旧静态原型（非运行入口）
scripts/                    # 构建/文档生成脚本 + 预览脚本
tests/                      # 测试
```

## 关键入口 / 核心模块

- `src/domain/case-catalog.ts`：公开病例目录
- `src/domain/case.ts`：版本化病例事实、体征规则、检查结果
- `src/lib/agent-engine.ts`：统一智能体状态机与确定性临床规则
- `src/lib/coze-ai.ts`：Coze 原生 AI 统一接入层（配置、错误分类、超时/重试弹性调用）
- `src/lib/quiz-pool.ts`：43 题安全题库（取题/判分/复盘全走 SECURITY DEFINER RPC，答案仅判分后可见）
- 使用统计（2026-10-11 最小实现）：`supabase/migrations/20261011100000_session_engagement_events.sql`（事件表/活跃区间表 + RLS + 4 个教师统计 RPC）；`POST /api/engagement`（学生事件上报：服务端身份+时间+client_event_id 幂等）；`GET /api/teacher/usage-stats`（教师统计：明细/汇总/趋势/分布，`?format=csv` 脱敏导出）；埋点 `src/lib/engagement-tracker.ts` + `src/components/student-engagement.tsx`（学生布局）+ 训练页 session_start/end；教师页 `/teacher/usage-stats`。有效时长口径：仅页面可见且活跃（idle/多标签其他标签/挂机不计入），区间由 `engagement_record_event` RPC 服务端派生，学生无直插权限；统计 join profiles 仅 student 角色（探针/联调账号天然排除）；练习成绩输出带"非正式成绩"标识。专项验收脚本 `scripts/verify-usage-stats.ts`（14 项负测/幂等/越权）；口径与未验收项见 `docs/使用统计口径与验收.md`
- `src/app/api/quiz/`：题库三路由（`questions` 取题、`answer` 幂等判分、`review` 本人错题复盘）
- `src/lib/preview-auth.ts`：预览身份 HMAC Cookie（生产 fail-closed：无 `PREVIEW_SIGNING_SECRET` 则禁用）
- 教师病例导入与上下架（2026-10-14）：`src/lib/teacher-case-import.ts`（本地受控 JSON → schema 校验 → sha256 版本指纹 → 教师身份幂等双写 `case_snapshot_facts/answers`，服务端读文件客户端零患者原文）；`src/lib/case-publication.ts` + `case_publication` 表（迁移 20261014100000）：无行=已发布缺省开放，下架 published=false 可恢复停用（不删原文/历史会话），学生新建会话 403 `CASE_UNPUBLISHED`、学生目录过滤，教师豁免（应用层角色 OR `app_is_teacher` 白名单）；教师 API `/api/teacher/case-publication` + 面板组件挂 `/teacher/case-drafts`；`src/lib/teacher-case-data.ts` 的 `readTeacherCaseData` 本地版本与绑定版本不一致时优先恢复绑定缓存快照、无匹配返回 null（防漂移）。初始化/导入脚本：`bootstrap-teacher-import-probe.ts`（一次性探针引导）、`run-case53-import.ts`（教师身份导入+复核）、`fix-hoarseness-row.ts`（损坏行修复）；验收 `verify-case53-init-publication.ts`（内容保真+守卫闭环）。**探针撤销（2026-10-09 如实口径）**：教师白名单条目已删除（app_is_teacher 恒 false，RLS 教师特权切断）；账号/会话未确认注销（凭据文件随 /tmp 清理丢失，signOut 未执行——只可声称白名单已撤销，勿写成账号冻结）；`revoke-teacher-import-probe.ts` 为标准撤销流程模板，禁止为补测重置密码/删账号/伪造 JWT
- `src/lib/format-date.ts`：确定性日期格式化（固定 `Asia/Shanghai` + 完整 Intl 选项），**组件内禁止裸用 `toLocaleString/toLocaleDateString/toLocaleTimeString`**（SSR/CSR 时区差异会触发 React 水合错误 #418/#423），一律改用 `formatDateTime/formatDate/formatTime`
- `src/app/api/`：认证、会话、智能体、题库、报告、教师查询、同步接口
- `src/server.ts`：生产环境入口（build 后 `node dist/server.js` 启动）

## 运行与预览

- **开发模式**：`pnpm dev`（默认 127.0.0.1:8765）
- **预览模式**：通过 `scripts/build.sh` + `scripts/run.sh`，端口从 `.preview` 读取（expose_port = 5000），绑定 0.0.0.0
- **构建**：`pnpm build`（next build + tsup 打包 server.ts）
- **生产启动**：`pnpm start`（node dist/server.js）
- **验证**：`pnpm validate`（typecheck + lint + test）
- **环境变量**：`.env`（业务配置：Supabase 凭据 + 超星 OAuth，参考 `.env.example`）、`.env.local`（仅 preview 覆盖，Next.js 中优先级高于 `.env`，禁止在其中放空值业务变量，否则会覆盖 `.env` 的有效值）

## 数据库与认证集成状态

- **鉴权链路（网关域名下，2026-10 改造）**：平台网关在边界将 `Authorization` 重命名为 `x-sandbox-authorization` 并**剥离全部 Cookie**，SSR Cookie 会话在网关域名下不可达（`/api/diag/auth-headers` 实证）。现行链路：
  - **浏览器端**：会话由官方 Supabase SDK 管理在 localStorage（`src/lib/supabase-browser.ts`，`persistSession` + `autoRefreshToken`）；OAuth exchange 后直接 `setSession` 落地；所有需登录态的请求经 `src/lib/authed-api.ts` 的 `authedFetch`（自动附 `Authorization: Bearer <token>`，401 清会话跳登录页）；`authedFetchRaw` 供二进制资源（媒体元素无法带 header，需 blob + objectURL 渲染）
  - **服务端**：`src/lib/request-auth.ts` 统一从 `x-sandbox-authorization`/`authorization` 头读 token 并 `getUser()` 网络校验（禁止仅解码信任）；校验失败一律 401 不回退 cookie；header 与非预览 cookie 身份不同 → 403 `IDENTITY_CONFLICT`；无头时回退 cookie（本地直连 SSR/预览路径）
  - **页面守卫**：student/teacher 布局改为客户端门控（`src/components/auth-gate.tsx` 的 `GatedAppShell`，挂载后经 `/api/auth/me` 校验）；含用户数据的页面（student 首页/报告、teacher 首页/会话详情）已客户端化，SSR HTML 不含任何用户数据（防未鉴权抓取）；静态说明页去 SSR 守卫；登录页由 `LoginSelfHeal` 检测 SDK 会话后按角色自动跳转
  - **媒体资源**：`case-resource-panel.tsx` 经 `authedFetchRaw` 取 blob 后渲染，不再依赖 cookie
- **Supabase 已实例化**：数据库变量由平台注入（`COZE_SUPABASE_URL`/`COZE_SUPABASE_ANON_KEY`/`COZE_SUPABASE_SERVICE_ROLE_KEY`），本地开发通过 `coze_workload_identity` 的 `get_project_env_vars()` 获取
- **迁移已执行**：`supabase/migrations/202608230001_pediatrics_agent.sql`（16 张业务表 + RLS）与 `supabase/migrations/202609010001_case_categories_symptom_terms.sql`（病例分类/症状字典/病例-症状关联 + 索引 + RLS + 种子，共 21 张表）均已在平台数据库按顺序执行。变更表结构必须新增带时间戳前缀的迁移文件，禁止改动已执行的历史迁移；新环境部署必须按时间戳顺序执行全部迁移
- **数据库弹性封装**：`src/lib/supabase-client.ts` 提供 `withDatabaseRetry`（默认 3 次、300ms 指数退避，仅重试网络类/5xx 错误），`src/lib/repository.ts` 所有读路径已接入，写路径保持单次执行；`/api/health/integrations` 的 `database` 字段为真实连通性探测（`connected`/`configured_unreachable`/`waiting_for_coze_database`）
- **超星 OAuth 已实现**：
  - **代码完整**：发起授权、OAuth回调、用户创建与绑定、角色权限映射、错误处理全部就绪
  - **配置灵活**：支持显式配置 `CHAOXING_REDIRECT_URI` 或自动从 `COZE_PROJECT_DOMAIN_DEFAULT` 生成
  - **安全措施**：AppSecret 仅服务端、HttpOnly Cookie、签名登录上下文、虚拟邮箱（SHA-256）
  - **部署流程**：参考 `docs/CHAOXING_DEPLOYMENT_CHECKLIST.md` 和 `docs/CHAOXING_PRODUCTION_CONFIG.md`
  - **验证脚本**：运行 `node scripts/verify-chaoxing-config.js` 检查配置
- **部署域名**：`COZE_PROJECT_DOMAIN_DEFAULT` 由平台注入，回调地址可自动从其生成

## Coze 原生 AI 集成

- **唯一文本 AI 调用点**：`src/lib/role-agent.ts` 的 SP 角色应答生成（调用链 `POST /api/agent/turn` → `runAgentTurn` → `handleQuestion` → `renderRoleReply`）。评分/报告/临床规则按教学设计保持确定性，不接入生成式 AI
- **角色模型**：默认 `doubao-seed-2-0-pro-260215`（可通过 `COZE_AI_ROLE_MODEL` 覆盖），temperature 0.45；人设提示词要求患儿用儿语词/断续含糊/可给误导性自我判断，家长焦急口语化/可给外行推测判断，均不用医学术语
- **语音播报（TTS）与语音输入（ASR）：阶段 D（2026-10-21，提交 498eaa4 与 D-验收-01 修复）已按平台新 SDK 交付轮次式语音链**。SDK 升级至 `coder-coding-dev-sdk@1.0.0-20261019.d5eff68`（TTSClient/ASRClient/AudioClient，仅服务端调用，密钥不进浏览器）。服务端三路由 `/api/speech/{capabilities,asr,tts}`（requireAuth+会话归属校验；能力探测为真实三段——listVoices+最小 TTS 合成+回灌 ASR，listVoices 成功不推断 ASR/TTS 可用；括注与不能言语患儿消息不合成；家长音色按病例已知照护者性别配置，未知明确回退平台默认音色）。前端 voice-input（录音→转写→确认/编辑→发送）+ role-audio-player（队列播报）+ communication-call（模拟通话）；工作台语音/文字切换，失败回退文字。验收状态：服务端 SDK 真实调用与路由守卫已验（合成预览身份直调，非真实 OAuth 多身份）；真实浏览器链路/真实麦克风/移动端/专业审核待验收——详见 `docs/SPEECH_INTEGRATION.md` 验收状态表与 `验收记录.md` 第二十二节。2026-10-09 的旧取消指令与旧 SDK 404 取证保留历史语境（仅说明旧接入方式不可用，不推断平台全部语音能力）。查体真实音效（SPRSound 啰音/哮鸣音）与视频播放不受影响
- **统一走 `src/lib/coze-ai.ts`**：新增任何 AI 调用必须经 `invokeCozeAI`（内置单次超时、指数退避重试、错误分类），禁止在业务代码直接 `new LLMClient` 或硬编码域名/密钥
- **凭据与域名**：默认取平台注入的 `COZE_WORKLOAD_IDENTITY_API_KEY` / `COZE_INTEGRATION_BASE_URL`；可选覆盖 `COZE_AI_API_KEY` / `COZE_AI_BASE_URL`；弹性参数 `COZE_AI_TIMEOUT_MS`(30s) / `COZE_AI_MAX_ATTEMPTS`(3) / `COZE_AI_RETRY_BASE_MS`(600)。密钥只进环境变量，不进代码/日志
- **降级契约**：模型失败（重试耗尽/鉴权/解析失败）→ `reply=null` + `runtime.execution='model_fallback'`（含 `errorKind`/`attempts`），引擎回退确定性事实应答，问诊轮次永不中断
- **请求头透传**：API Route 必须用 `HeaderUtils.extractForwardHeaders(request.headers)` 并经 `runAgentTurn` 的 `forwardHeaders` 选项传入（需 SDK ≥ 0.7.10）
- **测试**：单元 `tests/coze-ai.test.ts`（注入式，不耗配额）；真实集成 `AI_LIVE_TEST=1 pnpm exec tsx --test tests/coze-ai-live.test.ts`（功能+压力，消耗模型配额，按需执行）
- **改造记录**：`docs/AI_MIGRATION_REPORT.md`（改造清单、错误处理矩阵、测试报告）

## 用户偏好与长期约束

- 包管理器强制 pnpm，禁止 npm/yarn
- 移动端优先设计，桌面端响应式重排
- 所有密钥仅配置在环境变量中，不得进入 Git/截图/日志
- 本地预览使用进程内存保存会话，正式环境必须启用 Coze 数据库
- 旧游客（评委预览）登录入口已随登录入口升级删除（2026-10-15）：`src/lib/preview-auth.ts` 仅保留 HMAC Cookie 读路径（logout/health 检查引用），`ENABLE_UI_PREVIEW` 不再控制登录入口
- 登录页收敛（2026-10-14 老师批注）：起始页标语发回「练一次，会接诊」（`src/app/page.tsx` 硬编码），删除介绍段与「儿童不是成人的缩影」段；取消双端入口卡两步流程，登录面板直接提供超星一键+邮箱密码登录，教师入口为面板右上角小按钮（`button.login-teacher-corner`，仅记录 sessionStorage 入口意图，不预授权角色）；角色仍由服务端 `/api/auth/me` 判定，学生身份走教师意图登录被拒并自动回退学生路径

## 安全测试约定（2026-10-12 凭据泄露处置后固化）

- **凭据不得出现在 CLI 参数/命令文本/console 输出/截图中**（含 access_token/refresh_token/密码）。验收脚本输出仅限脱敏计数、状态码、布尔与 sessionId 等非秘密定位符。
- **凭据输入通道**仅两种：0600 权限临时 JSON 文件（`--cred-file`）或受控环境变量（如 `RLS_PROBE_*`/`PERSIST_PROBE_*`，缺省 fail-closed 退出，无默认回退）。参考 `scripts/probe-credentials.ts` 与 `scripts/verify-restart-persistence.ts`。
- **跨进程只传非秘密定位符**：凭据文件路径、sessionId、脱敏指纹。token 临时落盘必须 `0o600`，用后即删（业务证据保留，凭据不保留）。
- **测试账号治理**：清理/验证类脚本复用既有探针账号（不再默认 signup 扩散测试用户）；一次性诊断脚本跑完即删，不入 git。
- **冷启动恢复验证（2026-10-10）**：`scripts/verify-coldstart-restore.ts`（合成 PostgREST 上游 + 子进程 spawn 独立进程，31 断言）与 `scripts/verify-coldstart-real-platform.ts`（真实平台学生演示身份，11 断言，凭据经 /tmp 受控文件）。子进程环境必须剔除 CODER_*/COZE_* 真实注入再指向本地上游；真实平台脚本结束执行 signOut(global)。
- **会话收尾**：真实 Auth 测试结束对测试账号执行 `signOut(scope=global)` 撤销全部 refresh 会话；不删账号/业务数据、不修改 JWT 策略、不动教师白名单。
- **access JWT 边界（如实表述）**：平台无单令牌 access 撤销机制（无状态 JWT，TTL 3600s），signOut 仅撤销 refresh；文档禁止声称"退出立即撤销所有 access token"。
- **泄露事件处理**：先官方通道撤销（signOut global + 验证 refresh 被拒），再修脚本凭据通道，秘密扫描仅输出路径+计数/类型（禁止显示匹配内容）；已进入聊天日志的历史泄露不可通过删本地文件消除，必须如实记录。

## 常见问题和预防

- `server.ts` 中默认绑定 `127.0.0.1`，预览时需通过 `--hostname 0.0.0.0` 覆盖
- Next.js dev 模式端口需通过 CLI 参数指定，不能依赖 package.json 中的 script
- Supabase 未配置时（无 COZE_SUPABASE_URL），应用使用进程内存 fallback，仅用于演示
- `.env.local` 中禁止保留空值的 `CHAOXING_*`/`COZE_SUPABASE_*` 变量——Next.js 加载顺序 `.env.local` 优先，空值会覆盖 `.env` 中的真实凭据导致 401
- **超星身份验证部署**：
  - 部署前运行 `node scripts/verify-chaoxing-config.js` 验证配置
  - 回调地址必须在超星后台和环境变量中**逐字符一致**（包括协议、域名、路径）
  - 生产环境必须使用 HTTPS
  - `CHAOXING_SECRET` 必须存储在密钥管理中，不得出现在代码/日志中
  - 教师权限基于 `CHAOXING_TEACHER_UIDS` 白名单，空值 = 全部学生权限
  - 首次部署后立即用测试学生和教师账号验证完整登录流程

## 2026-10-19 登录入口更新

用户最新手绘要求优先：登录面板依次为学生端／教师端切换、常显账号密码、登录、超星一键登录；删除旧折叠表单与右上角入口。账号密码仅用于本平台邮箱账号，超星认证走官方 OAuth，未核实获准的密码接口前不收集超星密码。入口只影响落点、不授予角色。

学生首页最新要求：手机也使用三列九宫格，每页9例；点击整张卡片进入接诊，不显示独立接诊按钮。“更多”独立展开资料说明及其他训练模式，必须避免误触默认接诊。保持完整主诉与键盘链接操作，不能用截断主诉换取整齐。使用说明见 docs/STUDENT_HOME_UI.md。
