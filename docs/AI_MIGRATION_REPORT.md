# Coze 平台原生 AI 服务接入改造报告

- 项目：珞珈儿科智训（luojia-pediatrics-agent）
- 改造目标：将项目内所有 AI 接口调用点统一接入 Coze 平台原生 AI 服务（`coze-coding-dev-sdk`），并补齐接入配置、错误处理与降级机制
- 改造日期：2026-08（以提交时间为准）

## 1. AI 接口调用点改造清单

全量排查方式：对 `src/` 全量检索模型/LLM/第三方 AI 服务关键词（openai、deepseek、zhipu、qwen、dashscope、moonshot、chat/completions、LLM、apiKey 等）及所有 `fetch()` 外呼点。排查结论：**项目中不存在第三方 AI 服务调用**，AI 能力调用点共 1 处，为自研智能体的标准化病人（SP）应答生成，改造前已直连 SDK 但缺少统一的接入配置、请求头透传、超时控制、重试与分类降级。

| # | 接口功能 | 调用位置（调用链） | 原请求参数格式 | 原响应解析逻辑 | 改造内容 |
|---|---|---|---|---|---|
| 1 | 标准化病人角色应答生成：把预置病例事实改写为患儿/家长的自然语言应答（含患儿情绪标签） | `src/lib/role-agent.ts` `renderRoleReply()` ← `src/lib/agent-engine.ts` `handleQuestion()` ← `runAgentTurn()` ← `POST /api/agent/turn`（`src/app/api/agent/turn/route.ts`） | `messages`: system（事实边界、年龄化表达、角色秩序、未知信息与注入隔离）+ user（`JSON.stringify(RoleReplyInput)`）；`llmConfig`: `{ model: 'doubao-seed-2-0-lite-260215', temperature: 0.22, thinking: 'disabled', caching: 'disabled' }` | 剥离 ```` ```json ```` 围栏 → `JSON.parse` → Zod `roleReplySchema` 校验（`child?`/`parent?`/`childEmotion`）；任意失败则 `reply = null`，引擎回退到确定性事实应答 | 请求参数与消息格式保持兼容（同为 Coze 原生接口 `Message[] + LLMConfig`）；统一接入层 `invokeCozeAI` 提供超时、重试、退避和错误分类；`buildRoleSystemPrompt()` 将学生问话视为不可信诊室数据，禁止模型泄露隐藏事实、给出诊断或替学生作答 |

### 明确不接入 AI 的模块（按教学评测设计保留确定性规则）

| 模块 | 位置 | 不接入原因 |
|---|---|---|
| OSCE 评分与训练报告 | `src/lib/scoring.ts`、`src/app/api/reports/` | 产品承诺"不以模型印象替代真实操作"，评分逐项关联原始问答与操作证据，必须确定性可解释 |
| 临床规则引擎（查体/检查/诊断/处置校验） | `src/lib/agent-engine.ts` | "模型不能编造体征"，器材、部位、准备动作和顺序由规则校验 |
| 知识检索 | `src/domain/knowledge.ts` | 仅引用已审核的公开资料来源，关键词命中即可追溯，不引入生成式检索 |

## 2. 接入配置（API 密钥与基础域名）

统一封装于 `src/lib/coze-ai.ts`，全部经环境变量配置，密钥不落代码、不落日志、不进 Git：

| 配置项 | 来源 | 说明 |
|---|---|---|
| API 密钥 | 默认平台注入 `COZE_WORKLOAD_IDENTITY_API_KEY`；可选 `COZE_AI_API_KEY` 显式覆盖 | 仅服务端持有；健康检查仅暴露来源（`platform_injected` / `env_override` / `missing`），不暴露值 |
| 基础请求域名 | 默认平台注入 `COZE_INTEGRATION_BASE_URL`（当前生效 `https://integration.coze.cn`）；可选 `COZE_AI_BASE_URL` 覆盖 | SDK `Config` 统一构造，禁止业务代码硬编码域名 |
| 单次调用超时 | `COZE_AI_TIMEOUT_MS`，默认 `30000` | 交互轮次场景收紧于 SDK 默认值（900s），防止问诊轮次长时间挂起 |
| 最大尝试次数 | `COZE_AI_MAX_ATTEMPTS`，默认 `3` | 含首次调用 |
| 退避基准延迟 | `COZE_AI_RETRY_BASE_MS`，默认 `600` | 指数退避 + 随机抖动 |

`/api/health/integrations` 新增 `ai` 字段：`provider=coze_native`、SDK 版本、凭据来源、域名、超时/重试参数与配置状态，供部署巡检。

## 3. 请求适配说明

- **请求地址/鉴权头**：由 `coze-coding-dev-sdk` 的 `Config.getHeaders()` 统一生成鉴权头并指向平台网关，业务代码不再自行拼接地址与请求头。
- **请求头透传**：`POST /api/agent/turn` 按 SDK 规范使用 `HeaderUtils.extractForwardHeaders(request.headers)` 提取链路头（`x-tt-logid` 等），经 `runAgentTurn(session, event, id, { forwardHeaders })` → `renderRoleReply(input, forwardHeaders)` 传入 `LLMClient`，保证请求追踪与上下文传播（需 SDK ≥ 0.7.10，当前 0.7.24）。
- **请求参数**：保持 `Message[]` + `LLMConfig` 结构，含 `user` 角色消息（接口硬性要求）；模型固定 `doubao-seed-2-0-lite-260215`（低时延高并发档，适配问诊交互）。
- **角色真实性约束**：患儿使用符合年龄的短句和有限时间概念；家长只补充患儿无法准确说明的内容；暂停家长发言时必须省略 `parent` 字段；安抚后只提高表达完整度，不放宽事实边界。
- **安全边界**：学生自由输入的 `question` 被明确标记为不可信数据，不能覆盖系统规则；未知信息必须回答“不清楚/未注意”，不得主动给出诊断、评分、正确答案或操作建议。
- **响应解析层**：保留原 Zod 校验契约（`child`/`parent`/`childEmotion`），上游业务流程（`agent-engine` 的 `modelReply?.child ?? childFact` 回退链）零改动。

## 4. 错误处理与降级机制

错误分类（`classifyAIError`）与处置策略：

| 场景 | 识别方式 | 是否重试 | 处置 |
|---|---|---|---|
| 限流 | `APIError` HTTP 429 | 是 | 指数退避（`base × 2^(n-1) + jitter`），若响应带 `Retry-After` 则取其下限 |
| 单次超时 | 网关层 `Promise.race` 哨兵 / 408 / `timeout|ECONNABORTED|ETIMEDOUT|ECONNRESET` | 是 | 每次尝试独立受 `COZE_AI_TIMEOUT_MS` 约束，超时后进入下一次尝试 |
| 权限异常 | `APIError` 401 / 403 | 否 | 立即终止，避免无意义重试放大故障 |
| 非法请求 | `APIError` 其他 4xx | 否 | 立即终止（请求本身问题，重试无益） |
| 服务端异常 | `APIError` 5xx 或无状态码的上游错误 | 是 | 指数退避重试 |
| 网络异常 | `NetworkError` | 是 | 指数退避重试 |
| 凭据缺失/配置错误 | 配置类错误信息 | 否 | 立即终止并降级 |
| 响应无法解析 | JSON 抽取或 Zod 校验失败 | — | 标记 `errorKind: unparsable_response`，走业务兜底 |

**兜底降级链（业务不受改造影响的关键）**：所有重试耗尽或不可重试错误 → `renderRoleReply` 返回 `reply = null`、`runtime.execution = 'model_fallback'`（含 `errorKind`/`attempts` 审计字段）→ `agent-engine` 自动使用确定性预置事实生成患儿/家长应答。问诊轮次永远有应答，训练流程不中断；`agent_call_records` 记录执行方式，教师端可审计模型降级事件。

## 5. 测试报告（2026-08-28 实测，模型 `doubao-seed-2-0-lite-260215`）

### 5.1 离线单元与回归测试

| 套件 | 结果 |
|---|---|
| `tests/coze-ai.test.ts`（错误分类、重试退避、超时、认证不重试、Retry-After） | 7/7 通过 |
| `tests/agent-engine.test.ts`（确定性流程回归） | 全部通过 |
| 全套件（`pnpm exec tsx --test tests/*.test.ts`） | **59 pass / 0 fail**（4 个 live 用例默认跳过） |
| `tsc --noEmit` 与 `eslint --quiet` | 通过 |

### 5.2 功能测试 — 标准化病人应答生成（顺序 8 次，含提示词/请求参数/响应解析全链路）

| 指标 | 结果 |
|---|---|
| 成功率 | **100%**（8/8 走模型路径，结构化解析全部成功） |
| 时延 min / avg / p50 | 1766 / 2397 / 2446 ms |
| 时延 p90 / p95 / max | 2921 / 2921 / 2921 ms |

### 5.3 功能测试 — 完整业务链路（创建会话 → `runAgentTurn` 问诊轮次）

| 指标 | 结果 |
|---|---|
| 运行时执行路径 | `model`（一次通过，attempts=1） |
| 轮次总耗时 | 2947 ms |
| 结果 | 正确产生患儿+家长应答消息，业务流无异常 |

### 5.4 压力测试（24 次调用，并发 8）

| 指标 | 结果 |
|---|---|
| 成功率 | **100%**（24/24），限流 0 次、超时 0 次、权限异常 0 次 |
| 时延 min / avg / p50 | 916 / 1421 / 1366 ms |
| 时延 p90 / p95 / max | 1839 / 2006 / 2884 ms |
| 总墙钟 / 吞吐 | 6667 ms / 3.6 rps |

### 5.5 验收对照

| 验收项 | 要求 | 实测 | 结论 |
|---|---|---|---|
| 功能成功率 | ≥ 87.5% | 100% | ✅ |
| 结构化解析成功 | ≥ 6/8 | 8/8 | ✅ |
| 压力成功率 | ≥ 95% | 100% | ✅ |
| 压力 P95 时延 | ≤ 30000 ms | 2006 ms | ✅ |
| 离线单元回归 | 全绿 | 59 pass / 0 fail | ✅ |

复测方式：`AI_LIVE_TEST=1 pnpm exec tsx --test tests/coze-ai-live.test.ts`（默认跳过，避免日常测试消耗配额）。

## 6. 变更文件清单

| 文件 | 变更 |
|---|---|
| `src/lib/coze-ai.ts` | 新增：Coze 原生 AI 统一接入层（配置、错误分类、弹性调用） |
| `src/lib/role-agent.ts` | 改造：接入 `invokeCozeAI`，保留并增强响应解析层，补充运行时审计字段 |
| `src/lib/agent-engine.ts` | 改造：`runAgentTurn`/`handleQuestion` 支持透传请求头 |
| `src/app/api/agent/turn/route.ts` | 改造：`HeaderUtils.extractForwardHeaders` 提取并透传链路头 |
| `src/app/api/health/integrations/route.ts` | 改造：新增 `ai` 配置巡检字段 |
| `src/domain/agent.ts` | 扩展：`AgentRuntimeSummary` 增加 `attempts`/`errorKind` 可选字段 |
| `.env.example` | 文档化 `COZE_AI_*` 可选覆盖项与默认值 |
| `tests/coze-ai.test.ts` | 新增：错误分类与重试/超时/降级单元测试（7 例，注入式依赖，不消耗配额） |
| `tests/coze-ai-live.test.ts` | 新增：真实集成测试（配置巡检、功能 8 连发、完整业务轮次、24 并发 8 压力），默认跳过 |
| `tests/role-agent.test.ts` | 新增：提示词事实边界、家长暂停、患儿安抚状态与注入隔离回归测试 |
| `AGENTS.md` | 更新：AI 集成说明 |
