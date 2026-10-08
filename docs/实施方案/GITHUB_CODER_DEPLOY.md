# GitHub 拉取与 Coder 部署交接

## 代码版本

仓库：`https://github.com/15377038161/whu-pediatrics123`，部署分支：`main`。

先确认 Coder 的实际项目目录及未提交修改。有未提交修改时先保留，不使用 `reset --hard` 或覆盖用户文件。干净工作区执行：

```sh
git fetch origin
git switch main
git pull --ff-only origin main
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm validate
pnpm build
```

部署前记录实际提交号，与 GitHub `main` 一致才算拉取完成。部署目标不是 Git 仓库时，使用 Coder 的仓库导入或当前代码打包流程，不强行在旧目录执行 `git pull`。

## 必须单独提供的病例资料

GitHub 不包含真实病历、患者图片、音视频、生成的教学正文和 `.env`。仅拉取代码能显示全部 72 个入口，**不等于真实病例资料已经部署**。

资料准备机器已执行 `pnpm prepare:cases` 时，直接私有导入以下完整目录即可，服务器无需再次安装文档转换工具：

```text
<私有知识库根目录>/
├── 儿科常见病/       原始分类、病例目录及文件，保留中文文件名
├── teaching-cases/   53 份结构化教学 JSON
└── teaching-media/   已转码的 MP4
```

在 Coder 项目部署配置中设置 `PEDIATRICS_KNOWLEDGE_ROOT` 为该根目录的实际绝对路径。目录必须在生产运行环境持久可读；只上传到临时开发沙箱或构建缓存不算完成。不得放入 `public/` 或 GitHub，不得将原始病例转为无需登录的公开链接。

67 条教师病例目录记录关联 53 个真实资料目录；新生儿脑梗死、支气管肺炎、格林巴利综合征暂为自主研习入口，不补造病史，也不套用肺炎病例事实。

## 环境及启动

- 保留当前平台数据库、AI、超星认证环境变量，不用 `.env.example` 的空值覆盖已有凭据。
- 正式教学关闭 `ENABLE_AI_FIXTURE`；它只用于固定应答验证。AI 使用平台注入凭据或服务端环境配置，不把密钥提交仓库。
- 正式教学使用持久数据库，检查 `/api/health/integrations` 中 `database=connected`，不能用进程内存替代。
- 预览入口默认关闭；确需评委预览时显式开启 `ENABLE_UI_PREVIEW=true` 并设置高强度 `PREVIEW_SIGNING_SECRET`。
- 使用现有 `.cozeproj/scripts/deploy_build.sh` 和 `deploy_run.sh`。其他平台按 `pnpm build` 后 `node dist/server.js` 启动，设置平台要求的端口和 `HOSTNAME=0.0.0.0`。
- 不修改已执行的数据库迁移，不改超星回调地址，除非域名确实变化并完成后台同步。

## 上线验收与回报

1. 报告 GitHub 提交号、Coder 拉取提交号、实际部署版本及正式访问地址，不以“已拉取”代替“已发布”。
2. 学生病例库显示全部 72 个入口，问诊、沉浸式教学、OSCE 练习入口仍在。
3. 抽查肾病综合征：问诊和查体取真实正文，非肺炎占位事实；未记录生命体征显示“未记录”。
4. 抽查癫痫资料的图片分页，急性百草枯中毒资料的视频实际播放；学生文档显示教学文本，未登录访问资料返回 401。
5. 教师资料病例报告标明过程完成度、临床正确性待教师复核；原有两个示例保留独立评分。
6. 实际测试学生和教师登录、数据库持久化以及手机布局；关闭模拟固定应答后，再验证真实模型应答和语音服务。

`pnpm verify:cases` 只允许本地回环地址，用于独立测试环境。不要改成正式域名批量执行，避免生成正式学情记录。缺少私有资料或平台凭据时明确报告阻塞项，不声称病例、AI 或认证已经上线验收。
