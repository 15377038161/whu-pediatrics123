# 语音接入核验记录（SPEECH_INTEGRATION）

> 方案第 6.1 节要求的实施前核验记录。核验对象：超星开发平台 `coder-coding-dev-sdk` 音频能力
> （TTSClient / ASRClient / AudioClient），核验版本 `1.0.0-20261019.d5eff68`（含语音客户端的
> 升级版；项目已升级依赖并经 `pnpm validate` 与真实 TTS→ASR 闭环冒烟验证）。
> 证据来源为项目内平台技能文档与沙箱真实 CLI 调用
> （`coder-coding-ai audio voices` 实测返回 16 音色，供应商 bytedance）。
> 阶段 D 验收状态与口径结论见文末「阶段 D 验收状态」一节与 `验收记录.md` 第二十二节。

## 核验结论总表（方案 6.1）

| 核验项 | 结论（真实证据） |
|---|---|
| ASR 输入 | `ASRClient.recognize({ url })` 或 `{ base64Data, format }` 直传；格式 wav / mp3 / ogg_opus / m4a；时长 ≤ 2 小时、文件 ≤ 100MB；**非流式轮次式**，返回 `{ text, duration?, utterances? }`，无实时片段与置信度流 |
| TTS 输出 | `TTSClient.synthesize({ text 或 ssml, speaker, audioFormat, sampleRate, speechRate, loudnessRate })`；格式 mp3 / pcm / ogg_opus；采样率 8000–48000Hz；返回**平台签名 audioUrl**；**非流式**。SDK 契约（`TTSResponse`）仅含 `audioUrl`/`audioSize`，**无过期时间字段**——有效期按平台实际行为，不作「默认 24 小时」等固定假设（该表述曾为无依据推断，已于 D-验收-01 修正）；过期表现为下载失败，前端按需重新合成 |
| 音色 | `AudioClient.listVoices()` 动态返回（实测 16 个：通用/有声阅读/视频配音/角色扮演 4 类，供应商 bytedance）；音色跟随供应商启停，**不硬编码音色清单**，映射音色不可用时回退平台默认音色（`AudioDefaults.SPEAKER`） |
| 鉴权 | 仅服务端调用（`coder-coding-dev-sdk`，平台注入凭据）；密钥与配额校验在平台侧，**浏览器直连不可用**；服务端转发上下文用 `extractForwardHeaders` 透传链路头；项目密钥不进浏览器 |
| 网络 | 普通 HTTPS 轮次调用，**平台未提供低延迟双向流 / WebSocket 实时协议**；签名 URL 可直接嵌入 `<audio>` 或喂给 ASR，无需处理防盗链 |
| 费用与并发 | 配额与并发由平台侧管理；多供应商按优先级自动路由与故障降级；**Mock 模式**（`{ enabled: true }` / CLI `--mock`）联调不消耗真实配额 |
| 数据 | 合成音频为平台签名 URL（SDK 契约无过期字段，不假设固定有效期；下载失败即按需重合成）；**原始录音默认不长期保存**（前端按轮采集 base64 直传识别，不落地对象存储）；需要回放原音的场景必须先明确用途、保留期与用户同意，再设计受控存储 |
| 真实最小链路 | 麦克风（浏览器 WAV 采集）→ base64 上传 `/api/speech/asr` → 学生确认/编辑转写 → 既有 `/api/agent/turn`（ASK_QUESTION / SEND_COMMUNICATION，不另建临床逻辑）→ 角色文字消息 → `/api/speech/tts`（按 messageId 取已校验消息文本）→ 签名 audioUrl → 浏览器队列播放 |

## 首批交互形态（方案 6.1/6.2 判定）

平台仅支持普通音频上传/合成，**首批采用轮次式语音**：

```
录音 → 结束 → 识别 → 显示转写 → 学生确认/编辑 → 发送（复用既有事件与幂等键）→ 角色文字 → 按队列播音
```

不承诺实时双工、自然轮替与打断；模拟通话界面如实显示"按轮录音"状态，不显示虚假的"持续聆听"。

## 服务端路由约定

| 路由 | 说明 |
|---|---|
| `GET /api/speech/capabilities` | 服务端**真实三段探测**：`listVoices()`（音色列表）+ 最小真实 TTS 合成 + 回灌 ASR 识别——**listVoices 成功不推断 ASR/TTS 可用**（D-验收-01 修正）；探测失败如实返回 unavailable，前端据此隐藏语音入口——**启用状态不来自前端常量** |
| `POST /api/speech/asr` | `{ base64Data, format }` → `{ text }`；登录用户可调；单文件 ≤ 10MB；失败返回可重试标记 |
| `POST /api/speech/tts` | `{ sessionId, messageId }` → `{ audioUrl }`；**文本只取学生本人会话中已存在的角色消息**（TTS 不能自己生成新事实）；会话归属校验；不能言语患儿的纯括注消息返回 NOT_SPEAKABLE（不当婴儿台词守卫） |

## 角色音色映射（稳定、不克隆真人）

同一角色同一病例使用稳定音色；**家长音色按病例已知照护者性别选择**（`CommunicationProfile.caregiverGender`），未知时**明确回退平台默认音色**（`AudioDefaults.SPEAKER`）并记日志，不装作已知身份（D-验收-01 修正：不再一律女性）；映射音色经 `listVoices()` 确认可用，不可用依次回退平台默认音色：

| 角色 | 音色 | 说明 |
|---|---|---|
| 患儿（女） | `coder:female:cute` | 成年配音演播的角色音，非克隆真实儿童声音 |
| 患儿（男） | `coder:male:cheerful` | 同上 |
| 家长（照护者为女性） | `coder:female:canan` | 知性家长音（按病例已知照护者性别配置） |
| 家长（照护者为男性） | `coder:male:elegant` | 儒雅家长音（同上） |
| 家长（照护者性别未知） | `AudioDefaults.SPEAKER`（平台默认） | 明确回退，不猜测身份 |
| 带教旁白（tutor） | `coder:male:default` | 云舟 |

不能言语患儿（阶段 B `childCapable=false`）一律由家长代答，患儿只保留合适的非言语括注表现；患儿语义台词与纯括注消息均不进入语音合成。

## 消息语音元数据（方案 11 章记录扩展）

学生语音提问经确认发送后，消息记录扩展 `inputMode: 'voice'`、`asrRawText`（ASR 原文）、`transcriptEdited`（是否编辑过转写）；报告只评价确认后的语义内容。语音速度、口音、ASR 错误不进入能力评分。

## 阶段 D 验收状态（2026-10-21，D-验收-01 补验 + D-边界-01 安全收尾后）

阶段 D 当前状态：**代码已提交（498eaa4 与本批修复改动），真实业务验收部分完成，整体待核查**。详细记录见 `验收记录.md` 第二十二节，本节仅列口径结论。

| 验收项 | 状态 | 口径 |
|---|---|---|
| 服务端 SDK 真实调用（TTS、ASR 各自独立调用） | 已验 | `scripts/verify-speech-sdk-smoke.ts` 真实调用平台 SDK；脱敏输出只记音频格式/字节数/识别符合性，不记签名 URL、令牌或患者原文；真实退出码 0 |
| TTS 回灌 ASR 闭环 | 已验（服务端供应商链路） | **只证明服务端调用链路可用，不能代替真实麦克风/手机或受鉴权业务路由的浏览器链路** |
| 语音路由匿名门禁（未登录 401） | 已验 | **只证明匿名拒绝，不证明会话归属已验** |
| 语音路由登录后本人会话成功路径 + 守卫（NOT_SPEAKABLE 422 / MESSAGE_NOT_FOUND 404）+ 跨会话隔离（404） | 已验（路由函数直调） | 经 `ENABLE_UI_PREVIEW` 合成预览身份直调路由函数——**不算真实 OAuth/HTTP 多身份验收**；真实 HTTP 层多身份待验收 |
| 仓库层跨学生拒绝 | 已验 | 既有模式回归（FORBIDDEN），与 RLS 同源 |
| 教师访问学生语音消息返回 200 | 已验行为，**权限正确性未审** | 设计允许督导语义（与 RLS `teacher_select` 同源）；**需按本人/可信班级范围审查后才能确认权限正确，不能仅凭 200 断言** |
| 普通/专项/OSCE/immersive 四模式交流入口共用语音链 | 已验（源码共链） | 四模式经同一 `conversationContent` / `CommunicationCall` 渲染分支；**浏览器实测未完成** |
| 真实浏览器语音链（能力探测渲染/语音输入/无麦克风降级/文字回退续训/角色播报/模拟通话） | **未验收** | D-验收-01 曾违规新建探针账号实测（0/1 PASS，本就失败），**不计入已授权验收**；`verify-browser-speech-ui.mjs` 已改 fail-closed，需用户提供既有且授权的受控身份后重测 |
| 真实麦克风录音 → ASR | 未验收 | 沙箱无麦克风设备，无法实测；不 mock 冒充 |
| 手机端听感 / 390px 移动端语音 UI | 未验收 | 无真机、无声卡、单视口未复验 |
| 语音链路医学教学合理性（专业审核） | 未验收 | 需专业审核 |

**仍需用户处理的具体项**：① 提供既有且经授权的受控学生身份凭据（或授权指定账号）用于浏览器链路验收；② 处置 D-验收-01 违规创建的探针账号（UID `80a57bbb-b434-4084-a726-b6bfd29d9d5e`，refresh 会话已撤销、账号与数据保留，删除/保留由用户决定）；③ 真实设备（带麦克风/扬声器/手机）验收；④ 教师督导访问学生语音的本人/可信班级范围权限审查；⑤ 语音链路专业（医学教学）审核。
