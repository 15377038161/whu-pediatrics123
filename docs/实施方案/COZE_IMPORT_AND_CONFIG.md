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
2. 开通项目数据库，分别在开发环境和生产环境执行 `supabase/migrations/202608230001_pediatrics_agent.sql`。
3. 配置 `COZE_SUPABASE_URL`、`COZE_SUPABASE_ANON_KEY`、`COZE_SUPABASE_SERVICE_ROLE_KEY`。
4. 开发环境可临时配置 `COZE_PROJECT_ENV=DEV` 与 `ENABLE_UI_PREVIEW=true`；生产环境必须为 `COZE_PROJECT_ENV=PROD`，且将预览开关设为 `false` 或不配置。
5. 首次先以 `ENABLE_CHAOXING_AUTH=false` 部署，取得正式 HTTPS 域名。

## 3. 上线门槛

- `/api/health/integrations` 中应用和数据库状态正常。
- 生产页面不出现评委预览入口。
- 超星真实学生和教师各登录一次，角色及 FID 正确。
- 教师跨课程群组请求返回 403，学生读取他人会话返回 403。
- 表单同步先写一条测试记录，在超星页面人工核对字段后再补投积压事件。

未完成真实凭据联调前，发布说明必须写“超星认证/表单待授权联调”。
