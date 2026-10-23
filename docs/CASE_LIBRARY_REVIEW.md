# 首页病例库全流程审核进展记录

依据：`docs/20261021_首页病例库全流程审核任务书_Claude.md`（v1.1，66 条标准、6 阶段交付）。本文件为可提交的脱敏汇总与进展记录；私有审核工作区在 `outputs/case-library-review/20261021/`（gitignore，不入库）。本文件不含患者正文。

审核意见原件状态：《审核意见处理说明》原件随沙箱重置丢失，缺失登记占位见 `docs/20261021_审核意见处理说明.md`（非原文）；恢复前"按原审核意见逐条核对"环节标记未验证。

## 1. 四状态总览（互不代替，如实记录）

| 状态 | 当前批次结果 | 说明 |
|---|---|---|
| 内容已整理 | 未开始（0/70 例） | 第一阶段盘点完成不等于内容整理；逐例审核待原件回传 |
| 运行已验证 | 未验证（本批次 0/70） | 历史批次 e2e 证据（50 all-pass / 17 gated-403 / 3 null）为账本口径存档，本批次未重跑；运行验收待第四阶段实测 |
| 教师试用已发布 | 未发布 | 未执行发布动作；发布准入与访问验收按任务书第 17 节执行 |
| 医学已审核 | 0（无教师确认记录） | 医学审核率 0/70；不从历史发布或试用次数推断 |

## 2. 第一阶段（范围与材料盘点）结果

执行时间：2026-10-22。工具：`scripts/audit-case-library-scope.ts`（只读对账，入库）+ `db_execute` 只读查询 + `scripts/gen-materials-ledger-20261022.py`（受限登记生成，一次性）。私有产物：`outputs/case-library-review/20261021/scope.json`（70 行范围表）、`materials.jsonl`（70 行受限材料登记）、`materials-inventory.json`（受限登记汇总）。

### 2.1 范围对账（四源一致）

- 教师目录 `TEACHER_CASE_CATALOG` 70 = 首页条目 `TEACHER_PUBLIC_ENTRIES` 70 = 稳定公开 UUID 映射 `CASE_PUBLIC_IDS` 70 = 就绪账本 70 行。无全局缺口（globalDiscrepancies 为空）。
- 学生首页目录总数 72 = 教师 70 + 合成前缀 2（`peds-respiratory-001` flagship-fixture、`peds-wheeze-002` demo-pending-review）。
- 关联类型：independent 53 / subtype 8 / alias 6 / no_source 3；别名亚型映射 `TEACHER_CASE_LINKS` 14 条全部对账一致。
- 首页标题形态：67 条为接诊摘要（年龄/性别/主诉），3 条为中性目录（no_source）。
- 发布状态（真实库 `case_publication` 只读对账）：67 发布 / 3 软下架（缺原始接诊资料的 catalog-only 条目，2026-10-15 下架，理由登记在库）。与账本一致。
- 材料计数（教师目录生成器历史口径）：媒体 29,309 / 文档 174。

### 2.2 账本（case-readiness-register）degraded 漂移证据

账本 `_meta` 自述 degraded（逐例核对台账 `case-audit-ledger.json` 与《病例台账》md 随沙箱重置丢失，逐例行复用上次生成结果）。本轮对账实证漂移：

- 17 行 catalogStatus 漂移：账本记 `pending-review` 17 行，当前教师目录已无该分支（历史待审项已归档重分类：materials-indexed 27→37、catalog-only 14→17、folder-only 12→16、pending-review 17→0）。
- 21 行 publishedVersion 漂移：账本记录的版本哈希不在真实库版本集中（如 `teacher-新生儿败血症` 账本 20e4658d… vs 库 ba6ff4f3…）；另发现同一版本哈希跨两病例复用 3 组（如 4390fa16… 同时记于两条目、0ed5b913… 两组、eb180d62… 两组），疑似 degraded 复用旧行的版本赋值缺陷，待台账原件回传后重算核实。
- **修复处置（2026-10-22，R1-REG-01 可重算部分已闭环）**：`scripts/audit-case-readiness.ts` degraded 分支由「全量复用旧行」改为「合并重算」——代码目录与快照来源列（relation/sourceCaseId/catalogStatus/sourcePath/published/publishedVersion/historicalVersions/blockers）按当前代码与快照重算；台账/核对来源列（audit/readiness/e2eResult/supportedModes/ageKnown/ageBand/sexKnown/dimensionChars/avatarReady/ledgerMarker/reviewer/reviewedAt）复用旧值不丢失核对轨迹；新增 `auditBoundVersion` 字段保留台账丢失前 audit.version 绑定值（21 例，批 1-4 全部 audit 行，实证为当时本地内容指纹而非库版本）。修复后重跑：口径对账 PASS（70 行、53/8/6/3、已核对 18/53、pending_review 17、下架 3），复跑 scope 对账**行漂移 0 / 全局缺口 0**（catalogStatus 与当前目录一致 17/37/16，publishedVersion 全部为库版本）。教师凭据全文导出（export-case-review-package.ts）按重算后库版本执行，修复前 21 例按台账指纹导出将无法命中库行的问题同步消除。
- 残留待办：3 组版本哈希跨病例复用的根因判定依赖丢失的台账原件；readiness 的 pending_review 17 行为 audit 时代状态（当时的目录 pending-review 已归档重分类），其现行内容未重新逐例核对，不以归档重分类冒充已复核；台账原件回传后重跑恢复全量核对。

### 2.3 真实库只读盘点（2026-10-22，未写入库）

- `case_snapshot_facts` 56 行 / 53 唯一源病例；`case_snapshot_answers` 56 行 / 53 病例。
- 多版本病例 3 例：NRDS（当前 8d5321f1…，历史 85ef9072…，人工 override 固定）；2026-10-21 新增版本 2 例（`teacher-儿童-肥胖症` d5f9b92b…、`teacher-心律失常-室上性心动过速` 637b5db0…）——快照文件已按其自身规范补齐该 2 行（`docs/case-snapshot-versions.json`）。
- 当前版本归属（多版本中会话绑定哪个）未在本阶段判定，以运行验收实测为准。
- facts 载荷设计上不含媒体数组（`buildFactsPayload` 防透题排除，`src/lib/case-snapshot.ts`）。
- 全表唯一 1 处 sections 内嵌引用形态：`teacher-心律失常-室上性心动过速` 新版本 637b5db0… 病史段末尾以未闭合外链图片引用 `![](https://p.` 截断结尾——既是文本截断缺陷证据，也不构成可用媒体引用；原始资料归属与语义待教师核实，已登记为问题（问题 ID：R1-DB-01）。**2026-10-22 第四十五节完成 DB 侧取证闭环（两表同源截断、tests 段空、召回分片组装不完整、冷启动绑定风险），证据与影响面见第 7.1 节。**

### 2.4 材料总账（受限口径登记，如实记录缺口）

- **文件级总账（J01）无法建立**：材料原件根目录 `knowledge/`（含 `儿科常见病/`、`teaching-media/` 转码目录）不在沙箱（gitignore 私有目录，沙箱重置丢失），无法枚举文件、计算哈希、登记格式与读取状态。媒体 29,309 / 文档 174 为目录生成器历史口径计数，未经 readdir 复核，按"缺失登记"处理，不冒充已登记。
- 材料登记率（受限口径）：70/70 条目已登记目录计数与 DB 版本计数；文件级 0/29,309 媒体 + 0/174 文档。
- 材料安置率：未开始（依赖文件级总账）。
- **语义核验覆盖率：0%**（本阶段未查看、播放或阅读任何材料内容；仅目录计数与 DB 元数据对账）。
- 运行时材料服务行为：`getTeacherCaseResourceRoot` 在 knowledge/ 缺失时优雅降级为无资源（与 catalog-only 行为一致，不 500），与部署环境核对（L05）待第四阶段实测。

## 3. 第二阶段（端到端样板）可行性评估

判定：**当前不可行，阻断根因如实记录**。

- 任务书第 9 节要求第二阶段"选择原件和媒体较丰富的一例"完成第 8 节全部十项并实际走通训练与复盘。其输入依赖：材料原件（文件级总账、语义阅读、媒体触发核验）、审核意见原件（逐条对照）、逐例核对台账（账本重算）。三者均已随沙箱重置丢失（knowledge/、outputs/、docs 未跟踪台账文件）。
- 不伪造原则（任务书第 6 节、第 23 节）：不能用 DB facts 残余文本冒充原件阅读，不能以结构填写冒充样板完成，不能以"整批教师试用"绕过。
- 可继续推进的独立工作（不依赖原件）：已完成第一阶段；可做第 13 节代码切入点静态定位复核、问题 R1-DB-01 类 DB 侧证据收集、账本骨架与 range 表维护。逐例内容审核、补充设计、媒体接入须待原件回传。
- 用户侧待办（阻断解除条件）：重新上传《审核意见处理说明》原件；回传 knowledge/ 原件目录（或授权以部署环境实际材料为盘点对象）；回传逐例核对台账原件（`case-audit-ledger.json`、《病例台账》md）以恢复账本重算。

## 4. 问题清单（本阶段新增）

| 问题 ID | 标准编号 | 现象 | 状态 |
|---|---|---|---|
| R1-DB-01 | A05 | 心律失常-室上速新版本病史段末尾未闭合外链图片引用截断 | **DB 侧取证已闭环（2026-10-22，见第 7.1 节）**：两表同源截断、新版本 tests 段空（0 字符 vs 旧版 3934）、来源为「知识库召回（3821591，3 个分片）」组装不完整、截断版本按 created_at 为最新存在被冷启动绑定风险；原件归属与语义核实、修复方案待教师 |
| R1-UI-01 | 第 14 节 | 任务书要求的最简教师使用说明固定文案未在任何入口交付；「该例新增内容和来源」中的新增内容清单未建立（依赖逐例内容整理 0/70） | 未交付登记（见第 7.2 节）；固定文案交付不依赖原件回传，可随教师试用阶段实施 |
| R1-VER-01 | 第 18 节 | 任务书断言的算法 v2 统一改造（`case-data-version.ts`，覆盖固定事实/原文/召回媒体 URL）未到达本仓库：文件不存在、git 全历史无提交；当前本地/导入/召回三链仍为 v1 documents-sha256 聚合算法（原件未变时修订字段仍认成同版的缺陷算法） | **三层均无实证（2026-10-22 远端核查，见第 8 节/第四十七节）**：本仓库本地全历史、GitHub 远端三分支全部引用（fetch 后搜索零命中、本地与远端零差异）、沙箱工作树均无该文件——改动仅可能存在于用户本地未推送环境；回传二选一：推送后本侧 fetch 落地核验，或直接提供文件内容/commit |
| R1-UI-02 | 第 16 节 | 教师试用页面开始/复盘的模拟性质说明与重点医学项「待老师医学审核」就近提示未交付（src/**.tsx 全无匹配） | 未交付登记（见第 8 节）；与 R1-UI-01 同批随教师试用阶段实施 |
| R1-REG-01 | J01 | 账本 degraded：17 行 status、21 行版本与真实库不符；3 组版本哈希跨病例复用 | **可重算部分已修复（2026-10-22）**：合并重算后行漂移 0，auditBoundVersion 保留 21 例台账绑定值证据；跨病例复用根因判定与 readiness 17 行现行内容复核待台账原件回传重算 |
| R1-MAT-01 | J01/J02 | 文件级材料总账无法建立（原件不在沙箱） | 阻断登记，待原件回传 |
| R1-DOC-01 | — | 审核意见处理说明原件丢失 | 缺失登记占位已建，待重传 |

## 6. 任务书第 13 节代码切入点静态复核（2026-10-22）

静态复核仅确认代码存在性与任务书断言一致，**不代表全链路运行验收**（运行验证按第四阶段实测；版本漂移后需重新定位）。

- 患者形象 `src/domain/patient-appearance.ts`（70 行）：`patientAppearance(sex, posture, caseId, ageKnown?)` 接收 ageKnown；`isYoungInfant`（≤1 岁新生儿/婴儿）只用同性别卧位素材、请求站立也按卧位返回（行 27-49）；`allowedPostures` 该月龄仅仰卧（行 39-43）；年龄缺失/解析失败走通用儿童素材（行 45-50）。任务书断言（2026-10-21 同步后）与当前代码一致。其他年龄段形象语义未审核（B02 待逐例人工复核）。
- 阶段门控 `src/lib/agent-engine.ts`（839 行）：`validateStageNavigation`（行 197）、`validateEventStage`（行 213）、`NAVIGATE_STAGE` 分支（行 246、809-812）均在位；viewStage 回看不修改业务 stage（行 812 注释明确"stage 列单向不变，DB 防回退触发器语义保持"）。任务书第 4 节表述与当前代码一致。
- 教师数据读取链 `src/lib/teacher-case-data.ts`（63 行）：`readTeacherCaseData` 读 `knowledge/teaching-cases/<sourceId>.json`——knowledge/ 缺失时本地同步读取链降级（与 R1-MAT-01 同根因）；版本指纹独立计算用于会话绑定一致性校验。
- 导入与版本指纹 `src/lib/teacher-case-import.ts`（245 行）：`computeImportVersion`（行 55）内容指纹、DB 侧版本查询取最新（行 120-125）、upsert `ignoreDuplicates` 幂等不覆盖已装载版本（行 19）。指纹是否覆盖实际教学内容变化（任务书第 13 节提醒项）需运行验证，静态确认机制在位。
- verify 脚本链 7 个全部在位：`verify-case-field-evidence.ts`、`verify-case-source-coverage.ts`、`verify-case-library.ts`、`verify-53-cases-e2e.ts`、`extract-case-drafts.py`、`prepare-teacher-cases.py`、`build-runtime-cases-from-handover.py`。旧脚本通过只证明其覆盖规则，不证明完整接诊体验达标（任务书第 13 节口径维持）。

## 7. 第四十五节：R1-DB-01 DB 侧取证闭环 + 第 14 节静态复核 + 材料包重跑（2026-10-22）

### 7.1 R1-DB-01 DB 侧取证闭环（仅 DB 只读，不冒充原件阅读）

- 截断实证：新版本 637b5db0… 的 facts 载荷（969 字符）以未闭合图片引用 `![](https://p.` 结尾（位置 859，全载荷出现 1 次）；同版本 answers.documents（1489 字符）同样含该模式（位置 1344）——**两表同源截断**，指向装载入库之前的召回/组装层，非 DB 序列化层问题。
- 截断段语义：上下文为血气分析报告单转录（「分析仪序列号/SC 批号/SP 序列号/不能计算-缺失温度」等仪器字段），末尾本应为图片 URL，被切断在 `https://p.` 前缀。
- 段级对比（facts sections 长度）：新版本 history 499（截断结尾）/ exam 147 / **tests 0（整段空）**；旧版本 9fa788c1… history 526 / exam 346 / tests 3934——新版本显著缩水且辅助检查段整段缺失。账本 dimensionChars（526/346/3934）与旧版本段长一致，为账本版本口径佐证。
- 来源标注：新版本 sourceDocument=「知识库召回（3821591，3 个分片）」；旧版本=「心律失常-室上性心动过速.txt」——新版本来自知识库召回组装，疑似 3 分片组装不完整（分片边界切断图片 URL 且 tests 分片未拼入）。此为 DB 元数据证据推断，组装过程原件核对与语义判定待教师。
- 媒体数组：两版本 answers.media 均为空数组，DB 侧无可用媒体引用登记。
- **冷启动绑定风险（静态代码 + DB 元数据推断，运行实测待第四阶段）**：冷启动版本解析链 `resolveTeacherCaseVersion`（local 缺失 → db）经 RPC `case_snapshot_latest_version`（迁移 20261013150000，`order by created_at desc limit 1`）取最新——新版本 637b5db0（created_at 2026-10-21 04:40）晚于旧版本 9fa788c1（2026-10-09 11:20），本地 knowledge/ 缺失场景（当前沙箱）下冷启动会话将绑定**截断版本**。账本/快照文件口径（publishedVersion=9fa788c1）与冷启动 RPC 口径（637b5db0）分歧；快照文件 _meta 已声明「当前版本归属以运行验收实测为准」，本节将「截断版本可能被冷启动绑定」升级登记为 R1-DB-01 影响面。
- 处置边界：不删除、不覆盖、不新建版本（教师导入通道 upsert ignoreDuplicates 幂等保护已装载版本）；原件核实与修复方案待教师决定。

### 7.2 第 14 节（教师最简使用说明）代码切入点静态复核

- **固定引文使用说明文本未在任何入口交付**：任务书第 14 节引文（「这是待审核的教学模拟版本……请从学生入口逐例接诊……」）在 src/** 与导出包均无匹配，仅存在于任务书原件——登记缺口 R1-UI-01，第 14 节交付状态=未交付。
- 教师逐例入口在位：①`/teacher` 工作台（病例资料盘点 + 70 条目录链接）；②`/teacher/cases/[id]` 详情页（目录元数据只读、来源名、「以学生方式进入病例」链接、CaseResourcePanel 原始资料经 `/api/cases/[id]/resources` 鉴权下发）；③审核材料包 `docs/case-review-package/`（70 例逐例审核表 + INDEX）。
- 「方便查看该例新增内容和来源」：现有入口展示来源名与原始资料目录；**新增内容（设计补充项）清单不存在**——依赖逐例内容整理（0/70，待原件回传），如实登记未交付，不以现有入口冒充满足第 14 节。
- `docs/用户侧验收执行手册.md` 为用户侧验收执行手册（V02-V05/L01/E03/K02-K03/E05），非任务书第 14 节定义的教师试用最简说明；其 K02-K03 步骤覆盖教师凭据导出操作。

### 7.3 审核材料包版本指纹漂移重跑消除

- 发现：材料包为第四十二节产物（生成时间 2026-10-22T02:23:37Z），早于第四十四节账本修复——版本指纹列仍为修复前台账指纹口径（如文件 61 记 `eb180d62f8f1a47a`，即 R1-REG-01 跨病例复用 3 组哈希之一），教师按此口径核对将指向不存在版本。
- 处置：重跑 `pnpm exec tsx scripts/export-case-review-package.ts --offline`（exit=0），70 个逐例审核表 + INDEX.md 全部重新生成；文件 61 现为发布版本 9fa788c1…（重算库版本）/ 历史版本 637b5db0…，INDEX 全表同步为重算后库版本口径。
- 口径：offline 骨架仍仅含元数据（病例全文需教师凭据导出，属用户侧/第四阶段）；骨架生成时间戳更新为本批重跑时刻；教师凭据全文导出按重算后 publishedVersion 命中库行的正确性收益维持第四十四节登记。

## 8. 任务书第 15-24 节代码切入点静态复核（2026-10-22，第四十六节）

静态复核仅确认代码存在性与任务书断言的一致性，**不代表运行验收**。基线 HEAD=b83d794（工作树干净）。

- **第 15 节（外部方法参考）**：无代码切入点；ASPE/INACSL 链接核实维持任务书 2026-10-21 口径，本批不重复核验。
- **第 16 节（医学补充风险分级）**：模拟性质说明文案（「待医学审核」「教学示例」「教学模拟」）在 src/**.tsx 全无匹配——教师试用页面开始/复盘说明与重点项就近提示未交付，登记 R1-UI-02（与 R1-UI-01 同批随教师试用阶段实施）。
- **第 17 节（教师试用访问验收）**：①`src/lib/case-publication.ts` 断言一致——无行=已发布（缺省开放）、published=false 行=下架、教师豁免（应用层 role='teacher' OR 数据库白名单 isTeacherByWhitelist）；②`src/lib/case-admission.ts` 断言一致——verifiedComplaint 主诉核验 + 年龄过滤（待核验/未记录）+ 五段完整度（history/exam/tests/diagnosis/plan 非空）+ demo-pending-review 排除；③`trial_batch`/feature flag/试用批次机制全库无匹配——确认非已实现的试用批次隔离（任务书自知口径）；试用隔离为第四阶段教师试用时的最小改动待办，非本批实施。
- **第 18 节（版本定位符）——唯一断言不符项，登记 R1-VER-01**：任务书断言「2026-10-21 续做已统一本地读取、导入及召回为 `case-data-version.ts` 的算法 v2」——该文件在本仓库不存在且 git 全历史无提交（用户侧 GitHub 同步实施的改动未到达本沙箱）。当前实际算法：`computeImportVersion`（teacher-case-import.ts 行 55）= documents sha256 聚合哈希截 16 位，即任务书自己指出的 v1 缺陷算法（原件未变时修订字段可能仍认成同版）；召回链版本一致性靠注释声明。contentDigest/releaseId/content_digest/release_id 在 src 与 migrations 全无匹配（任务书如实声明「待实施数据契约」，一致）；反馈记录载体（caseId+caseVersion+releaseId+环节）无对应表/接口（缺口，实施时按第 23 节不预设新表原则决策）。处置：待用户侧确认算法 v2 改动的推送状态；已推送则拉取核验，未推送则待原件回传后按第 18 节契约重新实施或等待回传。**2026-10-22 远端核查（第四十七节）**：`git fetch origin` 成功后全引用搜索（本地分支 + origin/codex/immersive-pediatric-agent + origin/main + origin/deploy-4a1c946）零命中，本地与远端零差异（HEAD..origin 为 0，main/deploy 分支亦无独有提交）——**远端 GitHub 亦无该改动，三层（本地全历史/远端全部引用/沙箱工作树）均无实证**；任务书声称的算法 v2 改动仅可能存在于用户本地未推送环境，回传路径二选一：用户推送后本侧 fetch 落地核验，或直接提供文件内容/commit。本侧不擅自按任务书描述重建算法（避免与未到达的用户侧改动冲突）。
- **第 19 节（逐环节失败与降级）**：①角色模型失败降级路径在位——role-agent.ts `renderRoleReply`：凭据缺失走 deterministic、调用/解析失败走 model_fallback（reply=null 由调用方确定性事实应答兜底），`runtime.execution`（deterministic/model/model_fallback）+ errorKind 记录实际执行路径、console.warn 落日志——满足「记录实际执行路径，不声称模型正常」；②确定性降级与模型路径共用同一份角色能力配置——agent-engine.ts 行 341 传入 communicationProfile，发言计划按 childCapable 分支（行 347-350）对不能言语患儿一律家长代答+仅 nonverbal 括注，方案 8.4 断言成立；不能言语患儿强制拦截在位（模型违规输出 child 也拦截，role-agent.ts）；③媒体类降级（听诊音频/查体视频/影像/检查服务失败）依赖材料原件与运行环境——阻断登记（与 R1-MAT-01 同根因），第四阶段实测；每项故障的受控模拟验证未做（待原件/运行环境）。
- **第 20 节（隐私、材料使用条件）**：4 个建议名称工具（audit-case-materials/validate-all-cases/scan-privacy-leaks/publish-teacher-trial）确认不存在于 scripts/（第 23 节「不预设新工具」断言一致）；逐文件隐私检查（姓名/病案号/日期相对化/元数据/OCR）依赖材料原件——阻断登记（R1-MAT-01 同根因），原件回传后执行。
- **第 21 节（并发修改）**：操作要求非代码切入点；本批基线登记 HEAD=b83d794、工作树干净；私有材料哈希不可计算（原件缺失）如实登记。
- **第 22 节（测试分层）**：tests/ 60 个测试文件在位（含改造方案第 17.5 节点名的 role-agent/speech-contract/patient-appearance/class-roster/class-management/classroom-database/quiz-scoring 等）；verify 脚本链 7 个在位（第四十四节已核对）；「53」命名脚本（verify-53-cases-e2e/verify-case53-real-api）仍在——其分母口径（53 唯一源病例）与账本 70 条目/53 源病例的关系需运行验证时按任务书第 22 节核对，不从账本读取的硬编码清单届时调整；执行预算（60s/30s/10min）为操作要求，实测时记录。
- **第 23 节（工具/数据扩展约束）**：①4 个建议名称脚本不存在（见第 20 节）——无冒充已存在命令；②`teacher_approved`/`medical_verified` 在 src/lib 与 migrations 全无匹配——未采用混同递进状态（四状态分别记录与账本 reviewer 字段模式一致）；③审核元数据放既有账本（case-readiness-register）符合「先放既有私有台账」原则。
- **第 24 节（完成边界）**：声明性内容无代码切入点；「不能把本文规定当作已有功能」口径与本批复核结论互为印证（R1-VER-01/R1-UI-02/R1-UI-01 等缺口即为该声明的事实体现）。

## 5. 私有审核工作区结构（按实际可写目录登记）

```text
outputs/case-library-review/20261021/
  scope.json                  # 范围表（70 行，含漂移证据）
  materials.jsonl             # 逐例受限材料登记（70 行）
  materials-inventory.json    # 受限登记汇总（覆盖率口径）
```

历史私有断点（2026-10-21 前的 cases/、evidence/、teacher-feedback/）随沙箱重置丢失，未恢复；后续阶段按任务书第 12 节结构增量重建，不另开第二套台账。

## 9. merge dc3048f 落地核验与 R1-VER-01 / R1-DOC-01 解除登记（2026-10-23，第四十八节）

基线 HEAD=`361a2ec`（工作树干净）→ `git fetch origin` 新增 1 提交 `dc3048f`（fix(cases): preserve source versions and unblock teacher-case exam observations）→ merge 执行 exit 0 无冲突，merge commit **`f51d9b4`**（双亲 `361a2ec` + `dc3048f`）。第 8 节（第四十六节）复核记录保持原样，本节仅追加落地后的更新登记。

- **R1-VER-01 解除**：第 8 节登记的「三层无实证」（本地全历史/远端全部引用/沙箱工作树均无 `case-data-version.ts`）已由用户侧推送解除——算法 v2 文件随 merge 到达（49 行纯函数，显式字段顺序 + CRLF 规范化 + 媒体绑定参与），且 `teacher-case-data.ts` 已删除任务书第 18 节指出的 v1 缺陷算法 `computeLocalVersion`（documents sha256 聚合哈希截 16 位）改调共享 `computeCaseDataVersion`；本地读取/教师导入/召回快照三链统一经源码与 diff 双重核实（非仅任务书声称）。第 8 节关于「不擅自按任务书描述重建算法」的处置承诺已兑现：等待到达后核验，未自行重建。
- **三项修复核验**：①SOURCE_EX_ 来源查体证据判定统一为 `src/domain/exam-evidence.ts` 的 `isExamResultEvidence`，引擎观察提交（`agent-engine.ts`）与前端勾选（`training-workspace.tsx`）共用同一函数，来源病例查体专项可关联已取得结果，伪造/未解锁来源证据两道校验保留；②观察关联 `linkedEvidence` 上限 10→32（`validation.ts`），逐项原查体事件与解锁结果服务端核验未放宽；③沟通专项简报不再向所有病例预设肺部感染/低氧/已氧疗，改为严格使用本会话已提供资料，configVersion 3→4。
- **R1-DOC-01 解除**：《审核意见处理说明》原件（18 条逐条处理表）随 dc3048f 到达 `docs/实施方案/20261021_审核意见处理说明.md`（与本地根目录缺失登记占位不同路径，两副本共存），与任务书 v1.1 引用（建议脚本名声明、teacher_approved/medical_verified 不混同）交叉印证一致；根目录占位已更新为「原件到达登记」并保留 2026-10-22 历史缺失登记全文。逐条闭环核对的内容工作自本登记起具备执行前提，核对结果另节登记，不因原件到达自动视为已完成。
- **沙箱验证真实退出码**：`tsc --noEmit` exit 0；lint 项目口径（`eslint . --quiet`）exit 0（另跑严格口径 `--max-warnings=0` exit 1：77 条 warnings 全部位于 `scripts/` 工具脚本，为既有代码风格项，未为跑绿改动任何脚本）；全量测试 385 项 = 381 通过 / 0 失败 / 4 跳过（135.6s；4 项跳过均为 `AI_LIVE_TEST=1` 门槛 live 集成测试；语音路由测试在本沙箱因注入密钥环境变量真实通过，与用户本地无密钥 1 失败记录为不同环境如实记录，均未改密钥或跳过伪造）；`pnpm build` exit 0（Next.js + tsup 服务端打包）。全量路由复验（504=72×7）沙箱侧已跑完，真实退出码 1：49 通过 / 390 缺料仅引导过程 / 3 OSCE 预期拒绝 / 62 项 OSCE create 失败（均为教师来源病例）。根因判定为环境差异——沙箱无 `knowledge/` 源材料，同一 commit `dc3048f` 在用户侧有材料环境实测 0 失败（483/18/3/0，为用户侧证据文件验收依据）；沙箱结果不作为内容通过/失败依据。观察项：源材料缺失时 OSCE create 走失败路径而非「资料不足」预期拒绝（3 个已知缺料 guard 正确），缺料下 OSCE create 拒绝路径是否加固留待教师试用阶段评估，本批不改动代码。
- **阻断如实登记（新增 R1-MAT-02）**：本会话两份上传原件（嗜血细胞综合征.docx、蚕豆病.docx）云盘 objectId 失效、解析 taskId 不合法，原件不可达；ITP（特发性血小板减少性紫癜）原件用户 2026-10-23 表示已补传，但该次上传的文件引用未到达本沙箱会话上下文（会话存档无对应条目），下载与 SHA256 核实（9e7a3a19…）仍不可执行，待重新送达可访问引用后补验。SHA256 核实（00104f83…/93ed1dde…/9e7a3a19…）与三病例附件审查重建在本沙箱会话不可执行；`knowledge/` 不在沙箱（私有隔离，预期），无源 JSON 可增量合并。用户侧证据文件（CASE_LIBRARY_LOCAL_EVIDENCE.md 2026-10-23 节）记录其私有环境已完成三份标准化表接入——沙箱侧不重复、不伪造，待原件重新上传后补验 SHA256 并继续接入审查。
- **边界**：本轮无数据库写入、无发布、无 RLS/权限改动、未部署真实学生、未创建账号、原件与私有材料未入 Git；commit 不 push。
