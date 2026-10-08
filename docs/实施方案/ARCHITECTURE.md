# 珞珈儿科智训架构说明

## 1. 单一智能体业务链

```text
学生文字/临床操作
        ↓
POST /api/agent/turn（AgentEvent）
        ↓
统一病例会话状态 SessionState
        ↓
角色调度 ─ 查体规则 ─ 知识检索 ─ 安全校验 ─ OSCE评分
        ↓
多角色消息、证据解锁、教学反馈、技能与来源摘要
        ↓
Coze PostgreSQL → sync_outbox → 超星表单
```

问诊、查体、辅助检查、诊断、处置和沟通共享 `sessionId + caseVersion + state`。专项训练和 OSCE 只是同一内核的模式约束，不复制病例逻辑。

病例通过版本化目录注册，首版包含男童旗舰病例与女童演示病例。创建会话时写入 `caseId + caseVersion`，角色应答、体征规则、检查结果和患儿素材均从该病例版本加载。后续教师材料到位时新增病例配置与素材，不复制训练页面，也不修改统一智能体事件协议。未经教师审核的内容必须显示“演示病例 · 待教师审核”。

## 2. 核心边界

- 大模型：只把服务器提供的病例事实改写成符合年龄与情绪的表达；调用失败时使用确定性预置事实。
- 运行审计：`agent_call_records` 仅保存技能轨迹、模型/回退状态和耗时，不保存提示词、完整响应或内部思维过程。
- 查体：`准备动作 + 器材 + 部位 + 顺序` 完全由规则校验，模型不能生成体征。
- 评分：只读取会话中的真实 `ClinicalEvent` 和已解锁证据，逐项生成得分和扣分依据。
- 知识：保留来源 URL、机构、日期和审核状态；公开资料仅作测试参考，高风险剂量不能在教师审核前进入评分标准。
- 教师：只有查询接口，无发布、编辑、改分或评语写入接口。

## 3. 关键代码

- `src/domain/agent.ts`：公共事件和数据契约。
- `src/domain/case.ts`：旗舰病例 v1 和临床规则。
- `src/lib/agent-engine.ts`：统一状态机。
- `src/lib/role-agent.ts`：受约束的患儿/家长语言模拟。
- `src/lib/scoring.ts`：证据化六维评分。
- `src/lib/repository.ts`：预览内存适配器与 Coze PostgreSQL 适配器。
- `src/lib/chaoxing-sync.ts`：可靠同步、幂等与重试。
- `src/domain/teacher-case-links.ts`：清单异名及具体亚型关联，保留真实资料来源。
- `src/lib/teacher-case-data.ts`：私有 `knowledge/teaching-cases/` 的格式校验与读取。

全部教师病例已向学生开放。教师资料病例 v2 仍使用同一 `SessionState` 与 `AgentEvent`，额外携带不包含检查答案的 `caseOptions`。服务端从原始病例衍生文本按阶段检索病史、查体和检查记录；客户端按病例展示选项。未知生命体征为 `null`。教师资料没有独立临床量表时，报告 `scoreBasis='process'`、`status='pending_review'`，只评价环节记录完成度，诊疗正确性由教师复核。原有两个示例仍使用自身临床量表。

学生资料访问经过登录校验，文档返回身份字段已隐去的文本；教师保留原稿核对能力。所有素材留在私有知识库，不作为公开静态资源。旧版视频通过离线 FFmpeg 转为 MP4，接口支持 Range，避免一次读取大文件。

## 4. 失败语义

- 模型失败：保留操作，使用病例预置回答，不产生新事实。
- OSCE 到时：冻结当前证据并生成报告。
- 表单凭据缺失：事件留在 `sync_outbox`，错误标记 `WAITING_FOR_CHAOXING_AUTHORIZATION`。
- 数据库未配置：正式业务接口返回明确错误；非生产评委预览使用隔离内存数据。
