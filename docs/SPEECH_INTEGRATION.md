# 语音接入核验记录（SPEECH_INTEGRATION）

> 方案第 6.1 节要求的实施前核验记录。核验对象：超星开发平台 `coder-coding-dev-sdk` 音频能力
> （TTSClient / ASRClient / AudioClient），核验版本 `1.0.0-20261019.d5eff68`（含语音客户端的
> 升级版；项目已升级依赖并经 `pnpm validate` 与真实 TTS→ASR 闭环冒烟验证）。
> 证据来源为项目内平台技能文档与沙箱真实 CLI 调用
> （`coder-coding-ai audio voices` 实测返回 16 音色，供应商 bytedance）。
> 旧 `speech-contract.ts` 的 unavailable 状态与旧 404 记录保留历史语境，不再代表当前能力。

## 核验结论总表（方案 6.1）

| 核验项 | 结论（真实证据） |
|---|---|
| ASR 输入 | `ASRClient.recognize({ url })` 或 `{ base64Data, format }` 直传；格式 wav / mp3 / ogg_opus / m4a；时长 ≤ 2 小时、文件 ≤ 100MB；**非流式轮次式**，返回 `{ text, duration?, utterances? }`，无实时片段与置信度流 |
| TTS 输出 | `TTSClient.synthesize({ text 或 ssml, speaker, audioFormat, sampleRate, speechRate, loudnessRate })`；格式 mp3 / pcm / ogg_opus；采样率 8000–48000Hz；返回**平台签名 audioUrl（默认 24 小时有效，可重复下载、可缓存）**；**非流式** |
| 音色 | `AudioClient.listVoices()` 动态返回（实测 16 个：通用/有声阅读/视频配音/角色扮演 4 类，供应商 bytedance）；音色跟随供应商启停，**不硬编码音色清单**，映射音色不可用时回退 default |
| 鉴权 | 仅服务端调用（`coder-coding-dev-sdk`，平台注入凭据）；密钥与配额校验在平台侧，**浏览器直连不可用**；服务端转发上下文用 `extractForwardHeaders` 透传链路头；项目密钥不进浏览器 |
| 网络 | 普通 HTTPS 轮次调用，**平台未提供低延迟双向流 / WebSocket 实时协议**；签名 URL 可直接嵌入 `<audio>` 或喂给 ASR，无需处理防盗链 |
| 费用与并发 | 配额与并发由平台侧管理；多供应商按优先级自动路由与故障降级；**Mock 模式**（`{ enabled: true }` / CLI `--mock`）联调不消耗真实配额 |
| 数据 | 合成音频为平台签名 URL，24 小时过期；**原始录音默认不长期保存**（前端按轮采集 base64 直传识别，不落地对象存储）；需要回放原音的场景必须先明确用途、保留期与用户同意，再设计受控存储 |
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
| `GET /api/speech/capabilities` | 服务端真实探测（`listVoices()`）：返回 asr/tts 可用形态与音色数；探测失败如实返回 unavailable，前端据此隐藏语音入口——**启用状态不来自前端常量** |
| `POST /api/speech/asr` | `{ base64Data, format }` → `{ text }`；登录用户可调；单文件 ≤ 10MB；失败返回可重试标记 |
| `POST /api/speech/tts` | `{ sessionId, messageId }` → `{ audioUrl }`；**文本只取学生本人会话中已存在的角色消息**（TTS 不能自己生成新事实）；会话归属校验；不能言语患儿的纯括注消息返回 NOT_SPEAKABLE（不当婴儿台词守卫） |

## 角色音色映射（稳定、不克隆真人）

同一角色同一病例使用稳定音色；映射音色经 `listVoices()` 确认可用，不可用回退 `coder:female:default`：

| 角色 | 音色 | 说明 |
|---|---|---|
| 患儿（女） | `coder:female:cute` | 成年配音演播的角色音，非克隆真实儿童声音 |
| 患儿（男） | `coder:male:cheerful` | 同上 |
| 家长 | `coder:female:canan` | 知性家长音 |
| 带教旁白（tutor） | `coder:male:default` | 云舟 |

不能言语患儿（阶段 B `childCapable=false`）一律由家长代答，患儿仅保留非言语括注；纯括注消息不进入语音合成。

## 消息语音元数据（方案 11 章记录扩展）

学生语音提问经确认发送后，消息记录扩展 `inputMode: 'voice'`、`asrRawText`（ASR 原文）、`transcriptEdited`（是否编辑过转写）；报告只评价确认后的语义内容。语音速度、口音、ASR 错误不进入能力评分。
