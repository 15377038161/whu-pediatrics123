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
│   ├── api/                # API Routes（agent/auth/cases/health/internal/preview/reports/sessions/teacher）
│   ├── about/              # 关于页
│   ├── auth/               # 认证页
│   ├── student/            # 学生端页面
│   ├── teacher/            # 教师端页面
│   ├── layout.tsx          # 根布局
│   ├── page.tsx            # 首页
│   └── globals.css         # 全局样式
├── components/             # 共享组件
├── domain/                 # 业务领域（病例目录、病例事实、规则）
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
- `src/app/api/`：认证、会话、智能体、报告、教师查询、同步接口
- `src/server.ts`：生产环境入口（build 后 `node dist/server.js` 启动）

## 运行与预览

- **开发模式**：`pnpm dev`（默认 127.0.0.1:8765）
- **预览模式**：通过 `scripts/build.sh` + `scripts/run.sh`，端口从 `.preview` 读取（expose_port = 5000），绑定 0.0.0.0
- **构建**：`pnpm build`（next build + tsup 打包 server.ts）
- **生产启动**：`pnpm start`（node dist/server.js）
- **验证**：`pnpm validate`（typecheck + lint + test）
- **环境变量**：`.env`（业务配置：Supabase 凭据 + 超星 OAuth，参考 `.env.example`）、`.env.local`（仅 preview 覆盖，Next.js 中优先级高于 `.env`，禁止在其中放空值业务变量，否则会覆盖 `.env` 的有效值）

## 数据库与认证集成状态

- **Supabase 已实例化**：数据库变量由平台注入（`COZE_SUPABASE_URL`/`COZE_SUPABASE_ANON_KEY`/`COZE_SUPABASE_SERVICE_ROLE_KEY`），本地开发通过 `coze_workload_identity` 的 `get_project_env_vars()` 获取
- **迁移已执行**：`supabase/migrations/202608230001_pediatrics_agent.sql` 已在目标数据库执行（16 张业务表 + RLS）。变更表结构必须新增带时间戳前缀的迁移文件，禁止改动已执行的历史迁移
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
- **语音播报（TTS）**：`src/lib/tts.ts` + `POST /api/tts`，患儿音色 `saturn_zh_female_keainvsheng_tob`（女童声），家长音色 `zh_female_santongyongns_saturn_bigtts`（妈妈声），旁白音色 `zh_female_xiaohe_uranus_bigtts`；客户端 `training-workspace.tsx` 走 TTS 播报、失败回退浏览器 `speechSynthesis`；TTS 也经 `coze-ai.ts` 的 `getAIConfig()` 共享鉴权
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
- 游客（评委预览）登录入口由 `ENABLE_UI_PREVIEW=true` 显式开启，任何环境（含生产）均可用；默认关闭。部署环境需在平台环境变量中配置该开关（`.env`/`.env.local` 均被 gitignore，不会进入部署）

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
