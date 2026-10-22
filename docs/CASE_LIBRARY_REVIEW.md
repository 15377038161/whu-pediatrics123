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
- 全表唯一 1 处 sections 内嵌引用形态：`teacher-心律失常-室上性心动过速` 新版本 637b5db0… 病史段末尾以未闭合外链图片引用 `![](https://p.` 截断结尾——既是文本截断缺陷证据，也不构成可用媒体引用；原始资料归属与语义待教师核实，已登记为问题（问题 ID：R1-DB-01）。

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
| R1-DB-01 | A05 | 心律失常-室上速新版本病史段末尾未闭合外链图片引用截断 | 已登记，待教师核实原始资料归属 |
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

## 5. 私有审核工作区结构（按实际可写目录登记）

```text
outputs/case-library-review/20261021/
  scope.json                  # 范围表（70 行，含漂移证据）
  materials.jsonl             # 逐例受限材料登记（70 行）
  materials-inventory.json    # 受限登记汇总（覆盖率口径）
```

历史私有断点（2026-10-21 前的 cases/、evidence/、teacher-feedback/）随沙箱重置丢失，未恢复；后续阶段按任务书第 12 节结构增量重建，不另开第二套台账。
