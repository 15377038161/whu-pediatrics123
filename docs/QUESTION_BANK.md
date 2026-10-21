# AI 题库闭环（教师生成 → 审核发布 → 学生练习 → 错题复盘 → 报告并入）

阶段 F / D09 / W09（2026-10-22，基线 0315b52）。教师用 AI 按主题生成题集草稿，逐题审核编辑后按班级范围或全平台发布；学生对已发布题集开始练习批次、续答、提交判分、错题复盘；练习记录并入统一报告列表。既有 43 题「单题速练」legacy 链路原样保留，两套并存互不影响。

## 使用流程

教师端（`/teacher/question-banks`，导航「AI 题库」）：

1. 新建题集：填写标题、主题（topic）与说明；新题集初始为 `draft` 状态，仅创建者可见。
2. AI 生成草稿：对已有题集调用生成接口（填写主题、题目数量等参数），生成题目一律以 `review_status = draft` 落库——AI 输出**不直接对学生可见，也不能跳过审核发布**。
3. 逐题审核编辑：可修改题干、选项、答案、解析；修改选项必须连带重新提交答案（答案必须是选项之一，选项不得重复）。审核动作为 `approved` / `rejected`，可删除不需要的题目。
4. 发布：发布前校验至少存在一道 `approved` 题目；发布原子冻结一份版本快照（`question_bank_versions`），学生此后永远按该快照作答——教师后续再改题目不影响进行中与已完成的批次。发布时选择可见范围：
   - `own_class`（默认）：仅本班学生可见；
   - `platform`：全平台可见，需项目管理员身份（`app_is_project_admin()`），普通教师调用被拒。
5. 发布后可下线（`retired`）：学生不再能基于该题集新建批次；进行中批次与历史记录、报告并入数据保留。

学生端（`/student/quiz`，双模式页签）：

1. 「题集练习」页签：列出对本人可见的已发布题集（本班 + 平台范围），显示题数、本人完成情况与最好成绩口径。
2. 开始练习：对同一题集同时只允许一个进行中批次；已有进行中批次时默认续答，也可显式 `fresh=true` 放弃旧批次（旧批次记 `abandoned`）重新开始。
3. 作答：逐题提交，服务端判分（确定性比对，非客户端自报）；**首次提交即终局**——重复提交同一题不刷分、不改答案；作答前接口不返回 answer/explanation，首次提交后才释放该题解析。
4. 错题复盘：批次内答错的题目集中展示复盘（学生自己的作答与正确答案、解析）；未作答题目不泄露答案。
5. 报告并入：`/student/reports` 报告列表并入题集练习批次记录（独立分区，明确标注非临床评分口径，不与临床过程分混合）。

## 权限与可信边界

- 教师仅能管理**自己创建**的题集（owner_id 归属校验在应用层与 RLS 双层强制）；跨教师访问返回拒绝，不以空结果冒充授权成功。
- 平台级发布（`visibility = 'platform'`）与既有 43 题维护（`quiz_questions` 写权限）收敛到项目管理员；本批同步**收紧既有宽泛教师写策略**（经用户授权）：
  - `quiz_questions`：教师 for-all 写 → 教师只读 + 项目管理员写；
  - `quiz_assignments`：教师 for-all 写 → 教师只读（分配/判分只能经既有受控 RPC）。
- 学生不可直读 `bank_items`（答案列）与 `question_bank_versions`（快照内答案）；取题、判分、批次详情全部经 SECURITY DEFINER RPC 投影，作答前不返回 answer/explanation。
- 作答归属与幂等在 RPC 内强制：非本人批次拒绝、关闭批次拒绝（`ATTEMPT_CLOSED`）、重复提交幂等返回首答结果。
- AI 生成结果仅为草稿素材，医学正确性由教师审核把关；系统不把 AI 输出自动标记为已审核，不假造审核标记。

## 数据与权限

迁移 `20261022000000_question_banks.sql`、`20261022000100_quiz_attempt_list_mine.sql`（均已在租户执行成功）：

- `question_banks`：题集（owner、标题、主题、status：draft/ready_for_review/published/retired，visibility：own_class/platform）。
- `bank_items`：题目条目，含 answer/explanation（学生不可直读）；review_status：draft/approved/rejected。
- `question_bank_versions`：发布时原子冻结的题目快照（答案冻结在快照内），批次绑定版本号，教师后续编辑不影响既有批次。
- `quiz_attempts`：练习批次（in_progress/completed/abandoned）；唯一约束保证同一学生对同一题集至多一个进行中批次。
- `attempt_answers`：批次作答记录，首次提交终局，`is_correct` 由服务端判分写入。
- 受控 RPC：`quiz_bank_list_student`（学生可见题集摘要）/ `quiz_attempt_start`（续答优先 + 一次进行中）/ `quiz_attempt_answer`（归属 + 幂等判分 + 完成迁移）/ `quiz_attempt_state`（本人批次详情投影）/ `quiz_bank_publish`（审核校验 + 版本冻结原子发布）/ `quiz_attempt_list_mine`（本人批次列表，统一报告数据源）。
- 不改历史迁移、不动既有 43 题与已答数据（legacy 链保持原样可用）、不删既有 restrictive 策略。

## API

均经既有 Bearer 鉴权与 getUser 网络校验；响应统一 `ok/fail` 契约，不透传数据库异常。

| 接口 | 说明 | 权限 |
|---|---|---|
| GET/POST /api/teacher/question-banks | 题集列表 / 新建 | 教师（仅本人题集） |
| GET/PATCH/DELETE /api/teacher/question-banks/:id | 题集详情 / 改标题说明主题 / 删除（仅草稿态） | 本题集 owner |
| POST /api/teacher/question-banks/:id/generate | AI 生成草稿题目（全部 draft 态落库） | 本题集 owner |
| PATCH/DELETE /api/teacher/question-banks/:id/items/:itemId | 编辑审核题目（approve/reject/改题）/ 删除 | 本题集 owner |
| POST /api/teacher/question-banks/:id/publish | 发布（冻结版本快照；visibility 可选） | owner；platform 范围需项目管理员 |
| GET /api/quiz/banks | 学生可见题集列表 | 已登录学生 |
| GET/POST /api/quiz/attempts | 批次列表 / 开始或续答（bankId，fresh 可选） | 已登录学生，仅本人 |
| GET /api/quiz/attempts/:id | 批次详情（作答前不返回 answer/explanation） | 已登录学生，仅本人 |
| POST /api/quiz/attempts/:id/answer | 提交单题（itemId, answer；首次提交终局幂等） | 已登录学生，仅本人 |

既有 legacy 接口（`/api/quiz/questions`、`/api/quiz/answer`、`/api/quiz/review`）与 43 题数据不变，继续服务「单题速练」页签。

## 部署与验收

1. 迁移已执行：`20261022000000_question_banks.sql`、`20261022000100_quiz_attempt_list_mine.sql`；不要修改历史迁移。
2. `pnpm validate`（含 `tests/question-bank.test.ts` 11 项）、`pnpm build`。
3. 已完成的无凭据冒烟：匿名访问教师题库接口与学生批次接口均 401 `AUTH_REQUIRED`；未登录访问 `/teacher/question-banks` 页面 307 回登录。
4. 待真实凭据验收（如实保留）：真实教师账号下的生成→审核→发布正向流、真实学生从取题到错题复盘的浏览器级交互、班级范围可见性跨班负测、平台发布的管理员路径。本轮无凭据未假冒身份执行上述正测。
