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

## 用户偏好与长期约束

- 包管理器强制 pnpm，禁止 npm/yarn
- 移动端优先设计，桌面端响应式重排
- 所有密钥仅配置在环境变量中，不得进入 Git/截图/日志
- 本地预览使用进程内存保存会话，正式环境必须启用 Coze 数据库

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
