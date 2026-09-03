# Coze 导入与配置

## 1. 生成导入包

在项目根目录执行：

```powershell
pnpm validate
pnpm build
pnpm bundle
```

产物位于 `deliverables/珞珈儿科智训_Coze全栈工程.zip`。脚本仅打包运行源码、锁文件、数据库迁移和实施文档，不包含 `.env*`、用户数据、构建缓存、依赖、旧 `demo/` 或本地 QA 文件。

## 2. 首次导入

1. 在 Coze 创建“编程项目”，选择导入本地 ZIP。
2. 开通项目数据库，在开发环境和生产环境**按顺序**执行两个迁移（缺一不可）：
   1. `supabase/migrations/202608230001_pediatrics_agent.sql`：16 张基础业务表 + 索引 + RLS。
   2. `supabase/migrations/202609010001_case_categories_symptom_terms.sql`：病例分类（大类/小类）、症状字典、病例-症状关联表 + 索引 + RLS + 种子数据，并为 `cases`、`knowledge_documents` 挂接分类外键。
3. 配置 `COZE_SUPABASE_URL`、`COZE_SUPABASE_ANON_KEY`、`COZE_SUPABASE_SERVICE_ROLE_KEY`（平台开通数据库后自动注入，无需手填密钥）。
4. 开发环境可临时配置 `COZE_PROJECT_ENV=DEV` 与 `ENABLE_UI_PREVIEW=true`；生产环境必须为 `COZE_PROJECT_ENV=PROD`，且将预览开关设为 `false` 或不配置。
5. 首次先以 `ENABLE_CHAOXING_AUTH=false` 部署，取得正式 HTTPS 域名，再按 `docs/CHAOXING_DEPLOYMENT_CHECKLIST.md` 配置超星认证。

## 3. 部署结构核对（当前代码已满足）

| 项目 | 约定 | 位置 |
| --- | --- | --- |
| 构建脚本 | `pnpm install` + `pnpm run build` | `.cozeproj/scripts/deploy_build.sh` |
| 启动脚本 | `node dist/server.js`，端口 `DEPLOY_RUN_PORT`（默认 5000），绑定 `0.0.0.0` | `.cozeproj/scripts/deploy_run.sh` |
| 服务入口 | 读取 `HOSTNAME`/`PORT` 环境变量，默认 `127.0.0.1:5000` | `src/server.ts` |
| 包管理 | 强制 pnpm（`only-allow pnpm`），`packageManager: pnpm@9.0.0` | `package.json` |
| 质量门槛 | `pnpm validate`（typecheck + lint + test）、`pnpm predeploy`（validate + 超星配置校验） | `package.json` scripts |
| Node 版本 | `>= 20` | `package.json` engines |

## 4. 环境变量参数清单

### 平台自动注入（不需手工配置）

| 变量 | 用途 |
| --- | --- |
| `COZE_SUPABASE_URL` / `COZE_SUPABASE_ANON_KEY` / `COZE_SUPABASE_SERVICE_ROLE_KEY` | Supabase 连接凭据，开通项目数据库后注入 |
| `COZE_WORKLOAD_IDENTITY_API_KEY` / `COZE_INTEGRATION_BASE_URL` | Coze 原生 AI 凭据与域名（TTS 与角色应答共用） |
| `COZE_PROJECT_DOMAIN_DEFAULT` | 运行时域名，用于自动生成超星回调地址 |
| `COZE_PROJECT_ENV` | `DEV` / `PROD`，平台注入 |
| `DEPLOY_RUN_PORT` | 部署运行端口，默认 5000 |

### 业务配置（按需填写，全部只进环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ENABLE_UI_PREVIEW` | 空（关闭） | 评委预览入口总开关；生产建议关闭 |
| `ENABLE_AI_FIXTURE` | 空（关闭） | 本地演示用固定应答；生产关闭 |
| `PREVIEW_SIGNING_SECRET` | 无 | 预览登录上下文签名密钥，开启预览时必填长随机值 |
| `ENABLE_CHAOXING_AUTH` | 凭据完整时默认启用 | 显式关闭填 `false` |
| `CHAOXING_APPID` / `CHAOXING_SECRET` | 无 | 超星开放平台应用凭据；Secret 仅存密钥管理 |
| `CHAOXING_FIDS` | 无 | 允许登录的机构 FID，逗号分隔，可带名称 |
| `CHAOXING_PREFERRED_FID` | `1385` | 多裸 FID 共按钮时的优先识别机构 |
| `CHAOXING_REDIRECT_URI` | 空（自动从域名生成） | 必须与超星后台登记逐字符一致 |
| `CHAOXING_TEACHER_UIDS` | 空 | 白名单外机构的教师 UID；空 = 全部学生权限 |
| `CHAOXING_PROVIDER_TEACHER_FIDS` | `1024` | 直接采信超星教师/学生角色的机构 |
| `CHAOXING_TEST_TEACHER_FIDS` | `1385` | 可双端进入的竞赛测试单位 |
| `CHAOXING_FORM_WRITE_URL` / `CHAOXING_FORM_WRITE_TOKEN` / `CHAOXING_FORM_ID` / `SYNC_WORKER_SECRET` | 空 | 超星表单回写，官方接口开通前留空 |
| `COZE_AI_ROLE_MODEL` | `doubao-seed-2-0-pro-260215` | 角色应答模型，可选覆盖 |
| `COZE_AI_API_KEY` / `COZE_AI_BASE_URL` | 空（用平台注入） | 仅在需要显式密钥/域名时配置 |
| `COZE_AI_TIMEOUT_MS` / `COZE_AI_MAX_ATTEMPTS` / `COZE_AI_RETRY_BASE_MS` | `30000` / `3` / `600` | AI 调用弹性参数 |

## 5. 上线门槛

- `/api/health/integrations` 中 `database` 返回 `connected`（真实探测）；若返回 `configured_unreachable` 检查数据库开通状态，`waiting_for_coze_database` 表示凭据未注入。
- 生产页面不出现评委预览入口。
- 超星真实学生和教师各登录一次，角色及 FID 正确。
- 教师跨课程群组请求返回 403，学生读取他人会话返回 403。
- 表单同步先写一条测试记录，在超星页面人工核对字段后再补投积压事件。

未完成真实凭据联调前，发布说明必须写“超星认证/表单待授权联调”。
