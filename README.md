# 珞珈儿科智训

面向武汉大学儿科学教学与教育智能体竞赛的移动端优先全栈应用。系统以一个统一儿科教学智能体贯穿问诊、查体、辅助检查、诊断处置、沟通、OSCE 和学情分析，不是多个互不关联的静态页面。

## 当前实现状态

- 已实现：男童旗舰病例与女童演示病例、版本化病例目录、统一 `AgentEvent` 接口、动态患儿/家长应答、医生干预、确定性查体规则、辅助检查、诊疗决策、沟通、证据评分、学生报告、教师只读端、移动/桌面响应式界面。
- 已实现：童趣但不幼稚的儿科视觉系统、轻量首页氛围动效、6 步训练闭环、4 类带明确 `focus` 的专项训练、输入框旁按需方向提示、训练自动保存与退出确认、实时增量病例记录、报告趋势概览和教师班级概览。
- 问诊与沟通合并为持续会话中心：学生可在训练中的查体、检查、诊断和处置阶段随时返回继续追问或解释沟通；界面不提供“请患儿回答/请家长暂不插话/安抚患儿”等代答按钮，智能体从学生原话识别沟通干预，并把正式风险解释作为独立证据评分。OSCE 仍保留阶段顺序限制。
- 患儿与家长的新回复默认使用浏览器中文语音自动播报，每条角色消息支持单独重播，问诊面板可随时静音；文字始终保留，语音能力不影响病例事实与评分。
- 服务端 TTS（`/api/tts` → 平台网关 TTS 端点）当前不可用（2026-10-09 实测取证）：网关对 SDK 的 `/api/v3/tts/unidirectional` 及全部合理路径变体均返回 404，同网关 LLM 与搜索端点正常，判定为平台网关未开通 TTS 模型端点（官方 coder-coding-dev-sdk 1.0.0 亦无 TTS 能力），非路径配置错误。处置：`src/lib/tts.ts` 对 404 启用进程级熔断（10 分钟 TTL，到期自动放行重试），失败日志明确标注"端点未开通"而非瞬时故障；`synthesizeSpeech` 返回 null 时路由返回 502 `TTS_UNAVAILABLE`，前端语音播报由浏览器 Web Speech API 承担（患儿/家长角色以 pitch/rate 差异区分，年龄化表达不受影响）。未接入外部 TTS 服务、未放宽 `/api/tts` 认证（匿名 401 实测）。平台开通端点后无需改代码即自动恢复。降级链路实测：`scripts/test-tts.ts` → `DEGRADE_CHAIN_PASS`（404 → null + 熔断 + 二次调用 0ms 立即降级）。- 查体阶段桌面端采用“左侧任务与器材—中央患儿—右侧实时记录”布局；点击“手卫生”会直接完成准备动作并显示完成态，其余器材再与患儿部位进行匹配。
- 移动端查体以患儿模型为主画面，器材与实时证据通过底部标签抽屉随时展开；选择器材后自动回到患儿热区，避免在多个独立页面之间往返。
- 每次查体操作都会在患儿模型旁即时显示器材、部位与规则解锁结果：对应热区高亮，男童肺炎病例播放 SPRSound 真实儿科细湿啰音，女童喘息病例播放真实儿科哮鸣音，并显示对应波形；其他结果使用语音播报且均可手动重播，文字结果始终来自版本化病例规则。
- 超星 FID 1385 作为竞赛测试机构获得教师权限，可在学生端与教师端双向切换；普通武汉大学学生只保留学生端入口。常规教师仍需同时满足超星教师角色与 `CHAOXING_TEACHER_UIDS` 白名单。
- 已实现：Coze 原生模型只负责标准化患儿/家长角色表达；提示词强制事实边界、年龄化表达、家长插话状态、未知信息不编造和提示词注入隔离。查体结果、临床规则和正式评分仍由确定性代码控制。
- 已实现：Coze PostgreSQL 数据迁移与 RLS、超星 OAuth 服务端适配器、超星表单可靠同步队列、临时知识来源追踪、集成健康状态。
- 全部教师病例已开放：54 条病种清单与 53 个实际目录双向登记为 70 条记录，加原有 2 个示例，学生病例库共 72 个入口。支持搜索、系统筛选、引导训练、沉浸式教学与 OSCE 练习。
- 全部 53 个资料目录接入真实正文；14 条清单异名或具体亚型通过 `teacher-case-links.ts` 明确关联，67 条教师记录有来源。新生儿脑梗死、支气管肺炎、格林巴利综合征没有独立原始正文，入口开放为自主研习，不编造患者事实。
- 173 份 Word/PDF 与 1 份病例分享 PPT 已提取可读文本（含转换后的 19 份旧版 Word）；正文按病史、查体、辅助检查、诊断、诊疗经过拆分。4 段 AVI 视频转换为 MP4，通过登录校验与分段读取提供。学生资料面板分页浏览全部资源，不再只显示前 80 项。
- 教师资料病例复用现有会话与 UI，查体、检查项目随病例变化；生命体征仅取原文，缺失显示“未记录”，提交处置不会统一改变血氧。报告标明“过程完成度”，提供原病例诊断和诊疗经过对照，临床正确性待教师复核；原有两个示例的评分保持独立。历史占位会话自动清理虚构事实并升级为资料驱动病例 v2。
- 待外部联调：Coze 项目数据库、超星 APPID/APPKEY/FID、超星表单写入接口。未取得凭据前，界面和文档均保持“等待授权联调”状态。
- 评委预览身份默认关闭；按部署需要显式配置 `ENABLE_UI_PREVIEW=true` 后可在任意环境开放，生产启用时必须同时配置高强度 `PREVIEW_SIGNING_SECRET`。当前沙箱保持 `ENABLE_UI_PREVIEW=false`，服务端直接拒绝预览身份（`/api/preview/login` 404）。
- 参考答案收紧（2026-10-10）：`case_snapshot_get_reference` RPC 学生路径一律返回 `null`，诊断/处置对照仅教师可读（RLS 直读保留）。学生 finish 报告无标准答案回填，评分仅为过程证据反馈；正式评分（含诊断对照评分）为阻断项，待平台可信服务端写通道方案选型。已知边界：`state.unlockedEvidence`/`orderedTests` 仍在学生可写范围内，伪造证据码可读到查体/检查类教学事实（不含诊断答案），彻底闭合与正式评分选型同源待定。
- 使用统计（2026-10-11 最小实现）：学生学习事件埋点（`POST /api/engagement`，服务端真实身份+时间+幂等）与有效活跃区间（仅页面可见且活跃，隐藏页/多标签/挂机不计入，服务端派生）；教师统计页 `/teacher/usage-stats`（明细/汇总/日活趋势/病例模式分布，日期/学生/病例筛选，脱敏 CSV 导出，练习分带"非正式成绩"标识）。口径与验收见 `docs/使用统计口径与验收.md`。
- 平台构建退出 137 诊断与资源约束修复（2026-10-13）：平台部署日志显示 Turbopack Compiled successfully 33.1s 后在 "Collecting page data using 63 workers" 阶段被 SIGKILL（exit 137）。取证：沙箱 cgroup 限制为 6GiB 内存（v1 `memory.limit_in_bytes=6442450944`，无 swap）+ 2 核 CPU quota，`max_usage_in_bytes` 已打满上限、`oom_kill=1`、dmesg 存在同 pod cgroup 的 `CONSTRAINT_MEMCG` oom-kill 记录（含 next-server 进程）；63 workers 的来源是 Next 16.1.1 默认 `os.cpus().length - 1`（64 线程宿主 - 1），静态收集阶段并发拉起 63 个 worker 与 6GiB memcg 上限冲突。137 仅证明 SIGKILL，15:20 平台侧那次的 kill 无法在本地沙箱直接取证，结论为"与 memcg OOM 高度吻合（本地同 cgroup 历史佐证）"而非断言。修复：`next.config.ts` 设 `experimental.cpus=2`（Next 16.1.1 官方支持的静态收集 worker 数配置，匹配实际 2 核 quota），构建期生效、运行时无影响，未忽略任何构建错误、未弱化类型/权限检查。本地生产同构复现：`pnpm run build` 退出码 0、37s、"Collecting page data using 2 workers" 确认生效、BUILD_ID 与 dist/server.js 均产出。本地证据 ≠ 平台部署证据：真实平台构建是否恢复以用户授权后重新触发部署的结果为准，本轮未触发部署。
- 统计口径复核与证据补全（2026-10-13）：8 项口径与安全缺口修复（北京自然日时区/跨日裁剪分摊/caseId 贯穿时长/completed-in_progress-abandoned 三分/心跳归并窗口 45s+区间封顶 3600s/detail 白名单双层校验/CSV 注入防护/周活与薄弱项与下钻补齐，迁移 `20261013100000`）；账户标记合规修正——`account_kind` 的 test 仅授予有受控创建证据的探针账号（git 追踪脚本 signup 创建），`dbg`/`routeB` 等无溯源账号回退 unknown，real=0 不做自动标记（迁移 `20261013110000`/`20261013120000`，DB 实况 test=6/unknown=7）；深度验收 `scripts/verify-usage-stats-deep.ts` 19/19 通过（≥90s 真实心跳归并、跨 tab 幂等、停止上报后区间上限、detail 白名单负测零落库、跨日裁剪语义复算）；`pnpm run build` 真实构建通过。教师真实账号正测维持未验收（无凭据不假冒）。
- 教师导入界面、版本选择规则与安全负测（2026-10-13 第五轮）：①教师端可操作界面（`teacher-case-import-panel.tsx` 接入 `/teacher/case-drafts` 页）："导入已审核 53 份病例"按钮（confirm 二次确认）+ 执行中/成功/失败反馈 + 仅教师可见来源覆盖诊断（loaded/pending/missing_local/no_source + 本地/DB 版本指纹对照 + 教师侧健康计数），零患者原文/零密钥展示，经 authedFetch 调用，用户不再手动调 API。②GET 诊断端点（`GET /api/teacher/case-import` → `diagnoseTeacherCaseImport`）：本地 53 JSON 版本指纹与 DB 导入版本逐例对照，与 POST 同一 requireTeacher 门（401/403/503 分层）。③版本选择规则实装（`case-version-select.ts`，repository.createSession 改用）——权威稳定序：本地完整审核内容哈希 > DB 导入版本 > 召回快照指纹，修正第四轮"仅当召回无版本才查 DB"的缺陷（召回已有不完整版本不能挡住 DB 完整导入版本）；旧会话按已绑定版本恢复不漂移；全无则资料不足。④注入式单测 9/9（tests/case-version-select.test.ts）：DB 与召回并存、教师直读、本地权威优先、无本地冷启动、恢复失败不回退、预览隔离、旧会话固定版本。⑤安全负测：anon Data API 对 counts/latest_version/get_facts RPC 均 42501、facts 表拒直读、status 仅枚举；路由层 GET/POST 匿名 401；**学生侧负测无受控凭据未验证（凭据已清理不新建账号，RLS 兜底已由 anon 42501 佐证，学生 JWT 路径待真实凭据补测）**。⑥口径校对：前述"106/106 通过"系简写（实际 102 pass/4 skip），本轮起统一写全数字；validate 115 项（111 pass/4 skip/0 fail）、build 通过、API 冒烟 3/3（不替代冷启动实测与教师正测）。**实际写库仍为 0**：界面/端点/规则就绪，"导入"按钮待用户以正常教师身份登录验收后点击执行。未上传原文到第三方、未新建表/账号、未放宽权限、未触发部署、本地提交 only 不 push。详见 `验收记录.md`。
- 教师导入通道、冷启动恢复与健康端点最小化（2026-10-13 第四轮）：①迁移 `20261013150000`（已执行+审计）——`case_knowledge_health_counts` 收紧为仅教师（撤销 anon/PUBLIC 执行 + 函数体 `app_is_teacher` 守卫，审计实况 anon_exec=false/auth_exec=true/public_exec=false）；新增公开最小枚举 RPC `case_knowledge_status`（仅返回 empty/partial/ready/unavailable，零业务计数零病例 ID）与冷启动版本 RPC `case_snapshot_latest_version`（仅 authenticated，仅版本指纹文本）。②健康端点 `/api/health/integrations` 最小化：`caseKnowledge` 仅返回 `{localFiles: present|missing, recall, persisted: ready|partial|empty|unknown}`，移除文件计数/持久化计数（教师侧详细计数走收紧后 RPC 仅教师可查，preheat 脚本教师 token 兼容不变）。③教师导入入口 `POST /api/teacher/case-import`（`src/lib/teacher-case-import.ts`）：服务端读本地受控产物 53 JSON → recordSchema 校验 → sha256 版本指纹（与召回快照同算法）→ 教师身份双写 facts+answers（幂等 upsert 不覆盖既有装载）；鉴权同 case-drafts 严格交集（requireAuth teacher AND app_is_teacher），客户端零患者原文/零 role 自填。④冷启动恢复实装（`repository.createSession`）：本地文件与召回缓存均无版本时经 `case_snapshot_latest_version` 绑定 DB 导入版本；教师直读一次成型完整事实，学生经既有受控 RPC `case_snapshot_get_facts` 恢复（会话归属+版本绑定+病例匹配校验），失败保持"资料不足"不回退漂移数据（**版本选择权威序已在第五轮修正为本地完整审核哈希 > DB 导入版本 > 召回快照**）。验证：type-check/lint 0 错误、`pnpm test` 106 项（102 pass/4 skip/0 fail）、本地生产构建通过、冒烟健康端点仅枚举/教师导入路由匿名 401（API 覆盖 3/3）。**边界如实标注：代码就绪≠已导入——53 例持久化待真实教师登录后执行导入（或部署后 preheat 教师凭据模式），当前健康端点 `persisted: 'empty'` 如实反映现状；未上传原文到第三方、未新建表/未放宽权限、本地提交 only 不 push。详见 `验收记录.md`。**
- 路径 A 实施：知识库召回重建 + 教师预热与健康状态（2026-10-13 第三轮）：用户授权路径 A（知识库召回 + 教师预热，零新增数据目的地）。新增健康计数 RPC `case_knowledge_health_counts`（迁移 `20261013140000`，SECURITY DEFINER 仅返回聚合计数 180/0/0 实测一致，无病例内容，未改历史未放宽表 RLS；**第四轮已收紧为仅教师可执行**）；`/api/health/integrations` 新增 `caseKnowledge` 维度（localCaseFiles/recall/persisted 计数，替代"静默资料不足"，实测 localCaseFiles=53、persisted=0/0；**第四轮已最小化为仅枚举状态**）；新增 `scripts/preheat-case-snapshots.ts`（`--verify-only` 免教师凭据只读验证；默认模式教师凭据 fail-closed + role=teacher 校验 + 逐例双写持久缓存 + 健康计数复核，绝不 signup/改密/打印凭据）。**路径 A 能力边界（verify-only 实测，2026-10-13 第四轮修正表述）：31/53 召回构建且 facts 分段完整；22/53 失败经三轮对照实验（topK 10→20、阈值 0.2→0.1、强定向 query）定稿为知识库召回内容形态边界（摘要卡片无段落标题，unclassified 4k~13k 字符），非截断非规则缺陷。召回重建不完整≠知识库内原文缺失：22/53 失败仅指召回通道的分段构建结果，53 份受控交接 TXT 与其 build:cases 产物 JSON（本地 `knowledge/teaching-cases/`，gitignored）为完整来源基准，不据此断言库内原文缺失。路径 A 单独不覆盖全部病例，剩余 22 例走路径 B（受控 TXT + build:cases）或教师导入通道（第四轮）装载**。生产预热：部署后 `pnpm tsx scripts/preheat-case-snapshots.ts --cred-file <0600>`（教师凭据经受控通道），或教师登录后 `POST /api/teacher/case-import` 导入本地受控产物。教师预热默认模式因无真实教师凭据未执行写库，仅完成 verify-only 只读验证。详见 `验收记录.md`。
- 53 受控来源接入教学运行（2026-10-12，全量验收 2026-10-13）：用户确认 53 份受控交接 TXT 为老师提供的已审核教学材料（凭据 `user-confirmed-teacher-reviewed` 记录于每份运行时文件）。`pnpm build:cases` 从 `knowledge/受控交接/` 程序化生成 `recordSchema` 兼容的运行时教学事实（含原件 sha256、章节行号证据定位、缺字段保持 unknown 不推断；肝豆状核变性 sex 原文未记录）。14 别名映射 canonical（6 拼写变体 + 8 亚型/异名，13 唯一目标全部在册）、3 无独立来源维持资料不足、2 演示 fixture 分离。**全量真实 API 验收（2026-10-13，`scripts/verify-case53-real-api.ts` 重写）：53/53 逐病例 建会话→问诊/查体/检查/诊断/处置→finish→会话恢复→报告恢复 ALL_PASS（58/58 断言，版本绑定 53/53，真实 DB 持久化非内存引擎）**；旧版“17/17”实为 7 例抽样且 turn 不检查状态码（SUBMIT_PLAN 409 被 guard 单步推进约束拒绝后被静默吞掉，脚本缺陷已修正并如实记录）。验收探针：`bootstrap-case53-probe.ts` 一次性引导（0600 凭据文件、account_kind='test' 不污染统计），验收脚本一律复用不 signup。部署环境重新装载：受控 TXT 放入 `knowledge/受控交接/` 后执行 `pnpm build:cases && pnpm verify:53cases` 即可，无需 DB 迁移或权限变更（详见 `docs/病例交接与草稿矩阵报告.md` 第六节）。**生产装载边界：`knowledge/` 整目录 gitignored，生产须私有挂载 `PEDIATRICS_KNOWLEDGE_ROOT` 或受控 TXT + build:cases 重建；server 启动无 knowledge 存在性校验，缺失时会话走“资料不足”降级（不崩溃不补造）；沙箱本地 53 份存在≠生产已装载。**
- 构建状态更正（2026-10-12）：`next` 始终在 `dependencies` 中（此前"从 devDependencies 移入"的说法无证据支持，已更正）。本地构建通过。
- 部署构建修复（2026-10-12 第二轮）：部署日志 `next: not found`（退出码 127）已在全新目录复现实证——根因是部署平台判定"构建脚本自带依赖安装，跳过部署阶段安装"后直接执行 `pnpm run build`，而旧 build 脚本不自含安装，全新环境 node_modules 缺失。修复：build 脚本改为 `pnpm install --frozen-lockfile && next build && tsup ...`；同时修复第二个构建阻断——`verify-case53-real-api.ts`/`verify-restart-persistence.ts` 无 import/export 处于全局作用域，`baseUrl` 顶层重声明触发 next build 类型检查失败（TS2441 同名冲突），已加 `export {}` 模块标记。全新目录（git archive HEAD + 修复文件）完整复现部署构建通过（全部路由产出 + dist/server.js 生成），typecheck/lint/13 项 API 冒烟全过。
- 真实 API 链路修复（2026-10-12 第二轮）：53 病例纯内存引擎验收后，真实 DB 链路下 finish 500 的两个根因已修复——① `ability_profiles`/`sync_outbox` 无学生直写策略（RLS 42501，此前预览内存模式掩盖），新增受控 RPC `report_side_effects_save`（迁移 `20261012100000`，校验登录+会话归属+完成态+报告已合法写入，不放宽 RLS）；② 新注册学生无 `profiles` 行导致外键失败，RPC 升级签名自动补建（迁移 `20261012110000`，幂等、角色固定 student、不触碰教师白名单）；废弃 4 参数旧重载已清理（迁移 `20261012120000`）。真实学生 A/B 账号全 HTTP 栈验收 `pnpm tsx scripts/verify-case53-real-api.ts` **17/17 通过**（7 代表病例全链路+隔离+恢复）；重启持久化 `scripts/verify-restart-persistence.ts` 两阶段两进程验证 **PERSISTENCE_PASS**。详见 `验收记录.md`。
- 沙箱代理跳转说明：重定向 Location 必须是对外 `https` 绝对 URL（`getRealOrigin` 优先读平台注入的 `CODER_PROJECTS_DOMAIN`），自定义 server 会在出口统一补全相对 Location。禁止回退到网关→容器内部链路的 `x-forwarded-proto`（http），否则浏览器从 https 跟随 http 跳转会触发网关代理前缀双层拼接导致 404。

## 本地运行

1. 将 `.env.example` 复制为 `.env.local`，生成新的 `PREVIEW_SIGNING_SECRET`。
2. 安装依赖：`pnpm install --frozen-lockfile`。
3. 启动：`pnpm dev`，访问 `http://127.0.0.1:8765/`。
4. 验证：`pnpm validate`、`pnpm build`。

本地预览默认使用进程内存保存会话，仅用于 UI 与业务演示。正式环境必须启用 Coze 数据库，不得以预览数据冒充持久化结果。

## 目录

- `src/domain/case-catalog.ts`：不含隐藏病史的公开病例目录；新增病例先在此登记展示信息。
- `src/domain/teacher-case-catalog.ts`：由 `scripts/generate-teacher-case-catalog.py` 从病种清单和实际目录双向生成的资料登记表。
- `src/domain/teacher-case-links.ts`：异名和具体亚型映射，不把不同亚型病例合并成一份虚构病历。
- `src/lib/teacher-case-data.ts`：读取私有知识库中的教学文本，校验数据格式与病例来源。
- `src/domain/content.ts`：儿科学教学内容总览（病例库、OSCE 考站、专项训练、资源库四大方向）与内容检索函数；规划中的病例与资源以 `planned` 登记，教师审核通过后再落地为正式病例版本。
- `src/domain/case.ts`：版本化病例事实、体征规则和检查结果；教师材料到位后在此新增或升级病例版本。
- `src/lib/agent-engine.ts`：统一智能体状态机与确定性临床规则。
- `src/lib/role-agent.ts`：患儿/家长角色提示词、结构化响应校验与确定性降级。
- `src/app/api/`：认证、会话、智能体、报告、教师只读查询和同步接口。
- `src/components/`：移动端优先、桌面重排的统一组件树。
- `public/media/brand/wuhan-university-logo.png`：武汉大学官网品牌下载包中的标准双色校徽。
- `public/media/brand/chaoxing-logo.png`：超星官方登录站点使用的品牌图标。
- `supabase/migrations/`：数据表、索引和行级权限。
- `docs/实施方案/`：架构、UI、接口联调、验收和导入文档。
- `docs/实施方案/病例资料覆盖核对.md`：覆盖结果、资料生成、开放规则和运行验收方式。
- `demo/`：旧静态原型的历史说明，不再作为运行入口。

## 外部边界

所有密钥只配置在 Coze 开发/生产环境变量中。不要将 `.env.local`、令牌、用户数据、数据库导出、浏览器 Cookie 或授权请求头放入 Git、截图、日志或导入 ZIP。
原始 `knowledge/` 与 `output/case-drafts/` 被 Git 忽略，不放入 `public/` 或公开代码包。生产环境须私有挂载完整 `knowledge/` 到 `PEDIATRICS_KNOWLEDGE_ROOT`（包含 `儿科常见病/`、`teaching-cases/`、`teaching-media/`）；代码包本身不包含病例素材。资料接口 `/api/cases/[id]/resources` 与 `/api/cases/[id]/resource?path=...` 允许已登录学生和教师，未登录返回 401。学生文档返回身份字段已隐去的教学文本，教师可以核对原始文件；影像和音视频从受鉴权接口读取。

## 病例资料生成与验收

GitHub `main` 拉取与 Coder 上线步骤见 [GitHub 与 Coder 部署交接](docs/实施方案/GITHUB_CODER_DEPLOY.md)，代码与私有病例资料须分别部署。

## 教师病例草稿导入

教师（需同时满足**应用层教师角色**与**数据库 `teacher_emails` 白名单**的严格交集）可在教师端导航「病例草稿」页粘贴结构化 JSON 病例资料，预校验后保存为草稿。使用步骤：

1. 以教师身份登录（首页「使用超星账号进入」，需真实超星教师账号），进入教师端「病例草稿」页（`/teacher/case-drafts`）。
2. 点击「填入示例模板」，按模板补齐必填字段（年龄/性别/主诉/病史/查体/辅助检查/诊断/诊疗计划）；缺失字段会在预校验中如实列出，系统不自动补造患者事实。
3. 勾选「正文已确认脱敏」与「媒体已审核」后先「预校验」确认无问题，再「保存草稿」。
4. 修订时递增草稿版本（如 `v1` → `v2`）：旧版本不会被覆盖，同一版本重复导入会被明确拒绝。
5. 学生发布流程本阶段未实现：草稿仅教师可见，与运行中病例事实（`case_snapshot_*`）完全隔离，不进入学生训练。

技术边界：草稿表 `case_draft_imports` 仅教师可读/插入（RLS `app_is_teacher()`），无 UPDATE/DELETE 权限防篡改；API 与页面授权为严格交集（`requireAuth('teacher')` AND 白名单 RPC），fail-closed。3 个无独立来源病种（新生儿脑梗死、支气管肺炎、格林巴利综合征）保持待补状态。验收脚本：`pnpm tsx scripts/verify-case-drafts.ts`（12 项断言：非双重授权探针 403/307 拒绝、学生匿名越权拒绝、RLS 直插直读拒绝、真实服务重启后 fail-closed 不漂移）。**如实声明**：双重授权教师的 HTTP 保存/列表/重启复读在沙箱无样本，标注「未验」；Data API 层（RLS）已单独实测。

资料准备依赖 Python（`scripts/requirements-cases.txt`）、LibreOffice（旧版 Word 转换）、FFmpeg（视频转码）。安装后执行 `pnpm prepare:cases`；流程仅生成教学衍生文件，不修改原件。先前生成的旧版 Word 与 MP4 会被复用。

`pnpm verify:cases` 对本地 `127.0.0.1:8876` 的独立学生预览逐例执行完整流程，并检查素材访问。验证服务应显式设置 `ENABLE_UI_PREVIEW=true`、`ENABLE_AI_FIXTURE=true` 和随机 `PREVIEW_SIGNING_SECRET`；脚本禁止连接远程地址，避免写入正式学情库。详情见覆盖核对文档。
