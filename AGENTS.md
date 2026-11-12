## 2026-11-09 最新交付约定（优先于下方历史阶段说明）

- 用户本轮要求制作完整接力包并转交 Coder；交付后 Coder 可继续剩余业务实现与资料制作，Codex 停止主动写入，不再坚持旧阶段“Coder 只能运维”的分工。接收前重新确认单一写入者，自动化 67-5 保持暂停。
- 当前以电脑端为优先。最高优先级依次为：最终 AI 综合复盘、查体详细内容、查体交互；其后再处理其他功能。
- 先读 `docs/CODER_HANDOFF_20261109.md` 及交付包 `00_manifest.json`；不要用旧 Qoder 交接或 main 分支名推断最新代码/资料版本。历史材料只作证据，不作为当前待办重新执行。
- 新足底示教图已备好但尚未接入画布，不能称为已完成足底交互。新查体代次已上传私有对象存储，安装、真实新会话绑定仍需按交付步骤验证；旧会话不能自动改绑。
- 最终综合复盘已实现，首次真实模型调用返回 rate_limited；真实生成、持久化和刷新验收未通过。不能将合成 SDK 测试当作模型可用，也不因时间经过反复耗额重试。
- 继续保留本地/云端已有改动、原件与版本；不发布正式线上、不改账号/凭据/RLS、不重算旧成绩、不删除旧 ZIP，不请求用户在聊天粘贴密钥。

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
- 教师授权快照恢复（2026-11-05）：`src/lib/case-snapshot-archive.ts` 从 `case_snapshot_facts/answers` 重建受控源文件，重算 `case-content-v2` 指纹并要求双表版本一致；只补缺失文件，不覆盖不同已核验版本，数据库只读。`POST /api/teacher/case-snapshot-archive`（教师鉴权）+ `case-package-import-panel.tsx` 恢复入口；清单 `knowledge/case-package-manifest.json`（67 入口/53 源/61 版本）。本次恢复 61 个可核验版本；DKA 活动绑定 `dcdf43acad052794` 无法重算，保留绑定并以 `85de76a667884e12` 作为源文件，告警记录在 `review-records/case-snapshot-archive-20261105.json`。测试 `tests/case-snapshot-archive.test.ts`
- 教师病例统一索引视图（2026-10-29 批次2）：`src/lib/teacher-case-index.ts`（服务端聚合「编号+诊断+完整主诉」三要素；诊断=目录病名，主诉经 `CASE_PUBLIC_IDS` 映射 `admission-summaries.json`；「诊断待确认/主诉待补充/编号#—」三槽位独立失联回退，纯函数 `resolveTeacherCaseIndexEntry` 可负测）；`GET /api/teacher/case-index`（`requireAuth(request, 'teacher')` 教师鉴权）；`TeacherDashboard` 索引行三要素渲染（读取失败降级沿用客户端目录）+ `/teacher/cases/[id]` 详情页补完整主诉。**安全边界：`CASE_PUBLIC_IDS`（teacher-id↔case-uuid 防透题映射）仅服务端使用，下发条目只含 teacherId 不含 case-uuid；客户端仅 type-only 导入（编译后擦除），严禁改为值导入**；测试 `tests/teacher-case-index.test.ts`（67条完整性/编号连续/回退规则/路由权限合成Auth/防透题断言）
- 学生档案「学生→病例→单次训练」三级进度（2026-10-29 批次3）：`src/lib/repository.ts` 的 `TeacherStudentProfile.caseProgress`（`buildCaseProgress` 服务端纯函数聚合：学生×病例→训练次数/完成数/报告数/最近已评分得分；未评分与过程分不计入，沿用学情首页口径；空/空白 caseId 归「病例未标注」兜底组；组按最近训练时间倒序）；`teacherCaseMeta`（caseId 经 `resolveCaseId` 归一兼容 case-uuid 混入 → 目录病名+编号，未收录回退原始 id）；`getStudentProfile` preview/DB 双分支同步（Entry 增 caseId/status；DB 分支行级可见性仍全由 RLS 决定）；`/teacher/students/[id]` 按病例分组渲染+组内单次训练下钻（证据链至 `/teacher/sessions/[id]`）。**`previewSeedUsers` 种子病例修复：批次1退役合成旗舰（`peds-respiratory-001` 已不在公开目录）后 `createInitialSession` 默认 caseId 必抛 `CASE_NOT_FOUND`，已改用教师目录首例（fail-closed `TEACHER_CASE_CATALOG_EMPTY`），否则 preview 学情列表/学生档案全链路 500**；测试 `tests/teacher-student-profile.test.ts`（聚合契约/过程分排除/空输入/uuid归一回退/preview集成含未标注组/学生403+未知学生404）。**已知环境现象：node --test 默认并发下重测试偶发 SIGKILL（三轮全量失败项互不重复、单跑均过，资源压力偶发非代码回归），全量基线用 `--test-concurrency=2` 取证：465/460 pass/0 fail/5 skip**
- `src/lib/format-date.ts`：确定性日期格式化（固定 `Asia/Shanghai` + 完整 Intl 选项），**组件内禁止裸用 `toLocaleString/toLocaleDateString/toLocaleTimeString`**（SSR/CSR 时区差异会触发 React 水合错误 #418/#423），一律改用 `formatDateTime/formatDate/formatTime`
- 病历书写专项（2026-10-29 批次6）：迁移 `20261029170500_note_writing_submissions.sql`（两表+RLS）；领域层 `src/domain/medical-note.ts`（NOTE_TEMPLATE 模板/分区完备性/内容规范化/schema 校验纯函数）；API `/api/notes`（草稿/提交/列表/详情）+ `/api/notes/[id]/review`（AI 审阅 SSE 流式）+ `/api/teacher/students/[id]/notes`（教师查看）；学生页 `/student/notes/[sessionId]` + 训练报告入口 + 教师端病历区块。测试 `tests/medical-note.test.ts` 等 4 文件 18 用例
- 独立技能学习模块（2026-10-30 批次7）：`supabase/migrations/20261030100000_skill_learning_catalog.sql`（skills 表 + learning_resources.skill_id 关联 + resource_progress.completed_at 完成标记 + skill_catalog_student RPC + resource_list_student 输出扩展 skillId/completedAt）；领域层 `src/domain/skill-learning.ts`（8 项儿科 OSCE 技能种子 slug、完成阈值 0.9、isResourcePositionComplete/skillProgressLabel/sortSkillCatalog 纯函数）；`GET /api/skills`（requireAuth 学生/教师通用，学生视角含可见资源数与完成数聚合）；学生页 `/student/skills`（技能目录+资源清单+完成度进度条，资源点击跳 `/student/resources?resourceId=`，资源页经 Suspense+useSearchParams 接线自动打开详情）；教师端 `learning-resource-manager.tsx` 元数据表单技能绑定下拉+列表技能徽标。**边界：完成度仅展示（观看位置达时长 90% 由服务端 RPC 标记），不当掌握程度、不入临床评分**。注意 `SkillCatalogItem` 类型经 `src/lib/learning-resource.ts` re-export（前端统一从此导入）。测试 `tests/skill-learning.test.ts`
- 教师现场考核评分（2026-10-30 批次8）：迁移 `20261030110000_skill_assessment.sql`（3 表 + 2 RPC + 40 项评分种子：8 技能 × 5 观察项，教师不可增删）；领域层 `src/domain/skill-assessment.ts` + repository `src/lib/skill-assessment.ts`（逐项三档打分 2 达标/1 部分/0 未达标，NULL=未观察不计分，汇总 0-100；发布制 draft→publish、撤回、补考生成新记录关联原考核、历史保留）；教师 API `/api/teacher/skill-assessments`（列表/新建/详情/保存草稿/发布/撤回/补考）+ 学生 `GET /api/skill-assessments` + 评分表 `GET /api/skills/[skillId]/rubric`；教师页 `/teacher/skill-assessments`（手机评分、草稿自动保存）+ 学生成绩区块 `student-skill-scores.tsx`（挂 `/student/skills`）。**边界：现场考核成绩独立于 OSCE 模拟参考评分与训练报告成绩，不互换算、不入 AI 生成**。测试 `tests/skill-assessment.test.ts`（9 用例），RLS 验证 `scripts/verify-skill-assessment-rls.ts`（匿名拒绝已 PASS，authenticated 组待凭据环境重跑）
- `src/app/api/`：认证、会话、智能体、题库、报告、教师查询、同步接口
- `src/server.ts`：生产环境入口（build 后 `node dist/server.js` 启动）

## 运行与预览

- **开发模式**：`pnpm dev`（默认 127.0.0.1:8765）
- **预览模式**：通过 `scripts/build.sh` + `scripts/run.sh`，端口从 `.preview` 读取（expose_port = 5000），绑定 0.0.0.0
- **构建**：`pnpm build`（next build + tsup 打包 server.ts）
- **生产启动**：`pnpm start`（node dist/server.js）
- **验证**：`pnpm validate`（typecheck + lint + test）
- **环境变量**：`.env`（业务配置：Supabase 凭据 + 超星 OAuth，参考 `.env.example`）、`.env.local`（仅 preview 覆盖，Next.js 中优先级高于 `.env`，禁止在其中放空值业务变量，否则会覆盖 `.env` 的有效值）
- **本地教学代次验收**：仅可在本地预览进程显式设置 `PEDIATRICS_TRAINING_PREFER_LOCAL=1`，使新会话跳过数据库活动来源优先级并绑定已安装的本地完整来源/教学包；默认不设置，生产禁止设置。旧会话始终按原绑定版本读取，本地包仍须通过完整来源版本、内容指纹与教学包哈希校验，不得以该开关绕过版本守卫

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

- **文本 AI 调用点**：`src/lib/role-agent.ts` 生成SP角色应答；`src/lib/test-result-supplement.ts`（2026-11-02 接入，**2026-11-05 按老师执医三站要求关闭生成通道**）只从绑定版本原始报告逐字摘录申请对应的单项，原始资料没有结果时不生成、不编造、不补全，学生只能选择做/不做并得到「本病例资料未提供该项结果」；历史 origin=generated 记录不再复用。全部经`invokeCozeAI`，见`docs/TEST_RESULT_AI.md`。评分、报告评价和原始临床规则仍保持确定性，不让模型改分或改原件。
- **角色模型**：默认 `doubao-seed-1-8-251228`（可通过 `COZE_AI_ROLE_MODEL` 覆盖），temperature 0.45；人设提示词要求患儿用儿语词/断续含糊/可给误导性自我判断，家长焦急口语化/可给外行推测判断，均不用医学术语
- **语音播报（TTS）与语音输入（ASR）：阶段 D（2026-10-21，提交 498eaa4 与 D-验收-01 修复）已按平台新 SDK 交付轮次式语音链**。SDK 升级至 `coder-coding-dev-sdk@1.0.0-20261019.d5eff68`（TTSClient/ASRClient/AudioClient，仅服务端调用，密钥不进浏览器）。服务端三路由 `/api/speech/{capabilities,asr,tts}`（requireAuth+**显式本人归属校验**——tts 要求 `session.userId === 当前用户`，教师督导读取不延伸为跨用户合成（他人会话 403 PERMISSION_DENIED），教师本人会话合成保留；能力探测为真实三段——listVoices+最小 TTS 合成+回灌 ASR，listVoices 成功不推断 ASR/TTS 可用；括注与不能言语患儿消息不合成；家长音色按病例已知照护者性别配置，未知明确回退平台默认音色）。前端 ConversationComposer 统一问诊与专项沟通的微信/QQ 式单行输入区，语音/键盘同位切换且共用受控草稿；roleAudioMuted 默认 true，页面加载不自动探测、合成或录音，开启播报不补播历史，仅对开启后新到达的角色消息请求 TTS，关闭立即停止并清空队列。voice-hold-button（按住说话/松开识别/上滑取消/真实音量波形）仅在学生主动按住时申请麦克风，松手仅识别回填，确认/编辑后才发送；conversation-thread 负责统一气泡与流式呈现，voice-message-button 播放学生真实录音，communication-call 复用同一输入组件。新增 `POST/GET /api/sessions/[id]/voice`（显式本人归属校验、WAV ASR、对象存储 fileId 与限时播放链接）；上传失败只降级为文字消息，不伪造语音气泡。验收状态：服务端 SDK 真实调用与路由守卫已验（合成预览身份直调，非真实 OAuth 多身份）；真实浏览器链路/真实麦克风/移动端/专业审核待验收——详见 `docs/SPEECH_INTEGRATION.md` 验收状态表与 `验收记录.md` 第二十二节。2026-10-09 的旧取消指令与旧 SDK 404 取证保留历史语境（仅说明旧接入方式不可用，不推断平台全部语音能力）。查体真实音效（SPRSound 啰音/哮鸣音）与视频播放不受影响
- **统一走 `src/lib/coze-ai.ts`**：新增任何 AI 调用必须经 `invokeCozeAI`（内置单次超时、指数退避重试、错误分类），禁止在业务代码直接 `new LLMClient` 或硬编码域名/密钥
- **凭据与域名**：默认取平台注入的 `COZE_WORKLOAD_IDENTITY_API_KEY` / `COZE_INTEGRATION_BASE_URL`；可选覆盖 `COZE_AI_API_KEY` / `COZE_AI_BASE_URL`；弹性参数 `COZE_AI_TIMEOUT_MS`(30s) / `COZE_AI_MAX_ATTEMPTS`(3) / `COZE_AI_RETRY_BASE_MS`(600)。密钥只进环境变量，不进代码/日志
- **降级契约**：模型失败（重试耗尽/鉴权/解析失败）→ `reply=null` + `runtime.execution='model_fallback'`（含 `errorKind`/`attempts`），引擎回退确定性事实应答，问诊轮次永不中断
- **请求头透传**：API Route 使用 `platformForwardHeaders(request.headers, user.accessToken)` 保留官方追踪/平台上下文并剔除应用用户JWT，随后经 `runAgentTurn` 的 `forwardHeaders` 选项传入（需 SDK ≥ 0.7.10）
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
- **聊天凭据红线（2026-10-23 安全收口固化）**：① 不请求/引导用户在聊天中粘贴 PAT、SSH 私钥或任何凭据明文；② 不检索、恢复、复现历史令牌或会话秘密（环境变量回捞、文件系统检索、会话记录反查一律禁止）；③ 不再使用任何已在聊天中出现过的凭据；④ push 保持受控授权阻塞——仅当用户自行完成安全授权（如自行配置 credential helper 或自行添加 Deploy key）后执行，不代为创建任何授权；已暴露令牌（如 `github_pat_11CA…UhCk`）有效性与撤销状态未知，不声称已撤销，仅脱敏记录并指引用户在 GitHub 官方设置核验撤销。
- **租户 schema 显式限定（2026-10-23 安全收口固化，源于 F02 pg_policies 越界读取事件）**：多租户共享实例上的一切数据库查询、函数/触发器/策略审计联表，必须显式限定本项目租户 schema `tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema`；系统视图（pg_policies/pg_proc 等）返回全库行时只以本项目签名精确匹配，禁止跨租户读取/分析/保存；不重查其他 tenant，不触碰/清理/留存其他租户业务数据；平台守卫拒绝带 schema 前缀表名时改用无前缀表名 + 审计侧过滤，不绕过守卫。

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
- **沙箱预览服务跑生产 build 模式（关键，2026-10-29 批次6验证时确认）**：
  - `src/server.ts` 硬编码 `const dev = false`，沙箱 dev server 实际服务 `.next` 生产构建产物，tsx watch 只负责重启进程、不重编译路由清单
  - **新增/删除 API 路由（route.ts）或页面后必须执行 `pnpm build` 才能生效**，否则新路由表现为 404（旧路由正常）
  - 禁止删除 `.next` 目录——会导致 server 启动崩溃（"Could not find a production build"）且 tsx watch 反复重启失败
  - 全量单测避免一次性 `pnpm test`（90+ 测试文件并发会超时/被杀，exitCode -1），可按字母序分两批：`npx tsx --test tests/[a-l]*.test.ts` 与 `npx tsx --test tests/[m-z]*.test.ts`（2026-10-30 批次7实测 96s+60s，合计 492 用例 0 失败）

## 2026-10-19 登录入口更新

用户最新手绘要求优先：登录面板依次为学生端／教师端切换、常显账号密码、登录、超星一键登录；删除旧折叠表单与右上角入口。账号密码仅用于本平台邮箱账号，超星认证走官方 OAuth，未核实获准的密码接口前不收集超星密码。入口只影响落点、不授予角色。

学生首页最新要求：手机也使用三列九宫格，每页9例；点击整张卡片进入接诊，不显示独立接诊按钮。“更多”独立展开资料说明及其他训练模式，必须避免误触默认接诊。保持完整主诉与键盘链接操作，不能用截断主诉换取整齐。使用说明见 docs/STUDENT_HOME_UI.md。
