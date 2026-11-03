import './fixtures/legacy-engine-catalog';
/**
 * 语音路由鉴权与归属回归（阶段 D 补验 D-验收-01）：
 *  - 匿名门禁：三路由无登录态均 401；
 *  - 登录后本人会话成功路径：能力探测 200、ASR 真实音频经路由识别、TTS 本人会话角色消息合成；
 *  - 守卫经路由：学生本人发言不播报（422 NOT_SPEAKABLE）、消息不存在（404）；
 *  - 会话隔离：本人另一会话中查不到第一会话消息（404）；
 *  - 跨用户拒绝：教师身份（合法受控预览身份）访问学生会话 TTS → 403 PERMISSION_DENIED
 *    （D-核查-02 fail-closed：督导读取不延伸为跨用户合成）；教师本人会话合成保留 → 200；
 *    仓库层另一学生上下文取本人会话 → FORBIDDEN（路由级第二名学生请求需真实第二身份，列待验收）。
 *
 * 身份：仅使用既有预览受控身份（ENABLE_UI_PREVIEW + setPreviewCookie），不注册新账号、
 * 不伪造 JWT、不放宽 RLS。ASR/TTS 成功路径为真实平台调用（探测文本为中性语句，不含患者数据；
 * 签名 URL 不打印）。角色消息经 ENABLE_AI_FIXTURE 模式产生，不经真实 LLM。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest, NextResponse } from 'next/server';
import { Config, TTSClient } from 'coder-coding-dev-sdk';
import { setPreviewCookie } from '../src/lib/preview-auth';
import { POST as createSession } from '../src/app/api/sessions/route';
import { POST as agentTurn } from '../src/app/api/agent/turn/route';
import { GET as speechCapabilities } from '../src/app/api/speech/capabilities/route';
import { POST as speechAsr } from '../src/app/api/speech/asr/route';
import { POST as speechTts } from '../src/app/api/speech/tts/route';
import { GET as studentVoiceGet, POST as studentVoicePost } from '../src/app/api/sessions/[id]/voice/route';
import { AgentRepository } from '../src/lib/repository';
import { encodeWavBytes } from '../src/lib/audio-pcm';
import { isSpeechCapabilities } from '@/domain/speech-contract';

test('语音路由匿名门禁：无登录态均 401', async () => {
  const post = (path: string, body: unknown) =>
    new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const voiceParams = { params: Promise.resolve({ id: 'x' }) };
  assert.equal((await speechCapabilities(new NextRequest('http://localhost/api/speech/capabilities'))).status, 401);
  assert.equal((await speechAsr(post('/api/speech/asr', { base64Data: 'AAAA', format: 'wav' }))).status, 401);
  assert.equal((await speechTts(post('/api/speech/tts', { sessionId: 'x', messageId: 'y' }))).status, 401);
  assert.equal((await studentVoicePost(post('/api/sessions/x/voice', {}), voiceParams)).status, 401);
  assert.equal((await studentVoiceGet(new NextRequest('http://localhost/api/sessions/x/voice?messageId=y'), voiceParams)).status, 401);
});

test('语音路由登录后链路：本人会话成功路径、守卫与会话隔离、跨用户拒绝', {
  skip: process.env.SPEECH_LIVE_TEST === '1' ? false : '需显式设置 SPEECH_LIVE_TEST=1 并注入既有平台配置；合成身份直调不等于真实 OAuth/HTTP 验收',
}, async () => {
  const saved = { preview: process.env.ENABLE_UI_PREVIEW, fixture: process.env.ENABLE_AI_FIXTURE };
  process.env.ENABLE_UI_PREVIEW = 'true';
  process.env.ENABLE_AI_FIXTURE = 'true';
  try {
    const studentResp = NextResponse.json({});
    setPreviewCookie(studentResp, 'student');
    const teacherResp = NextResponse.json({});
    setPreviewCookie(teacherResp, 'teacher');
    const studentCookie = studentResp.cookies.get('luojia_peds_preview_student');
    const teacherCookie = teacherResp.cookies.get('luojia_peds_preview_teacher');
    assert.ok(studentCookie && teacherCookie);
    const requestFor = (cookie: { name: string; value: string }) => (path: string, body?: unknown) =>
      new NextRequest(`http://localhost${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { cookie: `${cookie.name}=${cookie.value}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const asStudent = requestFor(studentCookie);
    const asTeacher = requestFor(teacherCookie);

    // 1. 能力探测成功路径：200 + 契约形状（服务端含真实最小 TTS/ASR 探测；可用性取决于供应商）
    const capsResp = await speechCapabilities(asStudent('/api/speech/capabilities'));
    assert.equal(capsResp.status, 200);
    const caps = (await capsResp.json()).data;
    assert.ok(isSpeechCapabilities(caps), '能力探测响应必须符合契约形状');

    // 2. 创建本人会话并产生角色消息（fixture 模式不经真实 LLM；发热意图 preferredActor=parent）
    const created = await createSession(asStudent('/api/sessions', { mode: 'guided', caseId: 'peds-respiratory-001', clientRequestId: crypto.randomUUID() }));
    assert.equal(created.status, 201);
    const session = (await created.json()).data;
    const turnResp = await agentTurn(asStudent('/api/agent/turn', {
      sessionId: session.id,
      clientEventId: crypto.randomUUID(),
      event: { type: 'ASK_QUESTION', data: { text: '最高体温是多少？吃过退烧药吗？' } },
    }));
    assert.equal(turnResp.status, 200);
    const repo = new AgentRepository({ id: 'preview-student-001', role: 'student', displayName: '评委预览学生', studentNo: 'PREVIEW-001', provider: 'preview', chaoxingUid: null, accessToken: null });
    const fresh = await repo.getSession(session.id);
    const parentMessage = fresh.messages.find((item) => item.actor === 'parent');
    const studentMessage = fresh.messages.find((item) => item.actor === 'student');
    assert.ok(parentMessage, '问诊后应存在家长角色消息');
    assert.ok(studentMessage, '问诊后应存在学生发言记录');

    // 3. ASR 成功路径：真实合成中性探测音频 → 经路由识别（关键词符合；识别文本脱敏不输出）
    const synth = await new TTSClient(new Config()).synthesize({
      text: '语音能力核验，路由路径。',
      speaker: 'coder:female:default',
      audioFormat: 'mp3',
      sampleRate: 24000,
    });
    const audioResp = await fetch(synth.audioUrl);
    assert.ok(audioResp.ok, '探测音频应可下载');
    const audioB64 = Buffer.from(await audioResp.arrayBuffer()).toString('base64');
    const asrResp = await speechAsr(asStudent('/api/speech/asr', { base64Data: audioB64, format: 'mp3' }));
    assert.equal(asrResp.status, 200);
    const asrData = (await asrResp.json()).data;
    assert.equal(typeof asrData.text, 'string');
    assert.ok(asrData.text.length > 0, '识别文本应为非空');
    assert.ok(asrData.text.includes('核验') || asrData.text.includes('语音'), '识别应命中中性探测关键词');

    // 3b. 真实学生语音闭环：TTS 生成 PCM → WAV → 本人路由 ASR + 对象存储 →
    //     确认发送后元数据落库 → 只能按本人会话消息获取真实录音地址。不 Mock ASR/Storage。
    const pcmSynth = await new TTSClient(new Config()).synthesize({
      text: '语音消息上传与播放核验。',
      speaker: 'coder:female:default',
      audioFormat: 'pcm',
      sampleRate: 16000,
    });
    const pcmAudioResp = await fetch(pcmSynth.audioUrl);
    assert.ok(pcmAudioResp.ok, 'PCM 探测音频应可下载');
    const pcmBytes = new Uint8Array(await pcmAudioResp.arrayBuffer());
    assert.ok(pcmBytes.byteLength >= 2 && pcmBytes.byteLength % 2 === 0, 'PCM 应为 16bit 样本');
    const pcmView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
    const pcm = new Float32Array(pcmBytes.byteLength / 2);
    for (let index = 0; index < pcm.length; index += 1) pcm[index] = pcmView.getInt16(index * 2, true) / 0x8000;
    const wavBytes = encodeWavBytes(pcm, 16000);
    const durationMs = Math.round((pcm.length / 16000) * 1000);
    assert.ok(durationMs >= 250 && durationMs <= 30000, '探测录音时长应在路由范围内');
    const voiceForm = new FormData();
    voiceForm.append('audio', new File([wavBytes], 'voice-probe.wav', { type: 'audio/wav' }));
    voiceForm.append('durationMs', String(durationMs));
    const voiceRequest = new NextRequest(`http://localhost/api/sessions/${session.id}/voice`, {
      method: 'POST',
      headers: { cookie: `${studentCookie.name}=${studentCookie.value}` },
      body: voiceForm,
    });
    const voiceResp = await studentVoicePost(voiceRequest, { params: Promise.resolve({ id: session.id }) });
    assert.equal(voiceResp.status, 200);
    const voiceData = (await voiceResp.json()).data;
    assert.ok(voiceData.text.length > 0, '语音消息路由应返回真实 ASR 文本');
    assert.ok(voiceData.audioFileId === null || typeof voiceData.audioFileId === 'string');
    assert.equal(voiceData.audioDurationMs, durationMs);

    // 存储可用时继续验证完整语音消息闭环；存储不可用时必须真实降级，不能伪造 fileId。
    if (typeof voiceData.audioFileId === 'string') {
    assert.equal(voiceData.storageWarning, undefined);
    const voiceTurnResp = await agentTurn(asStudent('/api/agent/turn', {
      sessionId: session.id,
      clientEventId: crypto.randomUUID(),
      event: {
        type: 'ASK_QUESTION',
        data: {
          text: voiceData.text,
          speech: {
            inputMode: 'voice',
            asrRawText: voiceData.text,
            transcriptEdited: false,
            audioFileId: voiceData.audioFileId,
            audioDurationMs: durationMs,
          },
        },
      },
    }));
    assert.equal(voiceTurnResp.status, 200);
    const voiceFresh = await repo.getSession(session.id);
    const storedVoiceMessage = voiceFresh.messages.find((item) => item.audioFileId === voiceData.audioFileId);
    assert.ok(storedVoiceMessage, '确认发送后应持久化真实录音元数据');
    assert.equal(storedVoiceMessage.audioDurationMs, durationMs);
    assert.equal(storedVoiceMessage.asrRawText, voiceData.text);

    const playbackResp = await studentVoiceGet(
      asStudent(`/api/sessions/${session.id}/voice?messageId=${storedVoiceMessage.id}`),
      { params: Promise.resolve({ id: session.id }) },
    );
    assert.equal(playbackResp.status, 200);
    const playbackData = (await playbackResp.json()).data;
    assert.equal(typeof playbackData.audioUrl, 'string');
    const recordingResp = await fetch(playbackData.audioUrl);
    assert.ok(recordingResp.ok, '签名录音地址应可下载');
    assert.ok((await recordingResp.arrayBuffer()).byteLength > 44, '下载内容应为非空 WAV');
    const teacherVoiceRead = await studentVoiceGet(
      asTeacher(`/api/sessions/${session.id}/voice?messageId=${storedVoiceMessage.id}`),
      { params: Promise.resolve({ id: session.id }) },
    );
    assert.equal(teacherVoiceRead.status, 403);
    } else {
      assert.equal(voiceData.audioFileId, null);
      assert.match(voiceData.storageWarning, /录音暂时无法保存/);
    }
    // 归属拒绝必须在任何存储结果之前成立，不能用督导读取权限上传或获取他人录音。
    const teacherVoiceReadDenied = await studentVoiceGet(
      asTeacher(`/api/sessions/${session.id}/voice?messageId=${studentMessage.id}`),
      { params: Promise.resolve({ id: session.id }) },
    );
    assert.equal(teacherVoiceReadDenied.status, 403);
    const teacherVoiceWriteDenied = await studentVoicePost(
      asTeacher(`/api/sessions/${session.id}/voice`, {}),
      { params: Promise.resolve({ id: session.id }) },
    );
    assert.equal(teacherVoiceWriteDenied.status, 403);

    // 4. TTS 成功路径：本人会话家长消息 → 200 + 签名 URL（脱敏不输出）
    const ttsResp = await speechTts(asStudent('/api/speech/tts', { sessionId: session.id, messageId: parentMessage.id }));
    assert.equal(ttsResp.status, 200);
    const ttsData = (await ttsResp.json()).data;
    assert.equal(typeof ttsData.audioUrl, 'string');
    assert.ok(ttsData.audioUrl.length > 0);

    // 5. 守卫经路由：学生本人发言不参与角色播报 → 422 NOT_SPEAKABLE
    const studentTts = await speechTts(asStudent('/api/speech/tts', { sessionId: session.id, messageId: studentMessage.id }));
    assert.equal(studentTts.status, 422);
    assert.equal((await studentTts.json()).error.code, 'NOT_SPEAKABLE');

    // 6. 不存在的消息 → 404 MESSAGE_NOT_FOUND
    const missingMsg = await speechTts(asStudent('/api/speech/tts', { sessionId: session.id, messageId: 'no-such-message' }));
    assert.equal(missingMsg.status, 404);
    assert.equal((await missingMsg.json()).error.code, 'MESSAGE_NOT_FOUND');

    // 7. 会话隔离：本人第二会话中查第一会话消息 → 404（消息查找按会话归属隔离）
    const second = await createSession(asStudent('/api/sessions', { mode: 'guided', caseId: 'peds-wheeze-002', clientRequestId: crypto.randomUUID() }));
    assert.equal(second.status, 201);
    const secondId = (await second.json()).data.id;
    const crossSession = await speechTts(asStudent('/api/speech/tts', { sessionId: secondId, messageId: parentMessage.id }));
    assert.equal(crossSession.status, 404);
    assert.equal((await crossSession.json()).error.code, 'MESSAGE_NOT_FOUND');

    // 8. 教师他人会话拒绝（D-核查-02 fail-closed 修复后断言）：教师督导读取语义
    //    （getSession/RLS teacher_select 同源）只授予"读"，不延伸为跨用户语音合成——
    //    教师为学生消息请求 TTS → 403 PERMISSION_DENIED。不靠改断言过测：路由已加显式
    //    本人归属限制（session.userId === 当前用户），教师跨用户督导语音需阶段 E 明确
    //    范围后专门授权；当前无可信班级范围授权服务，不以宽泛 role 绕过。
    const teacherCrossUser = await speechTts(asTeacher('/api/speech/tts', { sessionId: session.id, messageId: parentMessage.id }));
    assert.equal(teacherCrossUser.status, 403);
    assert.equal((await teacherCrossUser.json()).error.code, 'PERMISSION_DENIED');

    // 8b. 教师本人会话训练保留：教师创建本人会话问诊产生角色消息后，为本人消息合成 → 200
    const teacherSessionResp = await createSession(asTeacher('/api/sessions', { mode: 'guided', caseId: 'peds-respiratory-001', clientRequestId: crypto.randomUUID() }));
    assert.equal(teacherSessionResp.status, 201);
    const teacherSession = (await teacherSessionResp.json()).data;
    const teacherTurn = await agentTurn(asTeacher('/api/agent/turn', {
      sessionId: teacherSession.id,
      clientEventId: crypto.randomUUID(),
      event: { type: 'ASK_QUESTION', data: { text: '孩子精神状态怎么样？' } },
    }));
    assert.equal(teacherTurn.status, 200);
    const teacherRepo = new AgentRepository({ id: 'preview-teacher-001', role: 'teacher', displayName: '评委预览教师', studentNo: null, chaoxingUid: null, provider: 'preview', accessToken: null });
    const teacherFresh = await teacherRepo.getSession(teacherSession.id);
    const teacherParentMessage = teacherFresh.messages.find((item) => item.actor === 'parent');
    assert.ok(teacherParentMessage, '教师本人会话问诊后应存在家长角色消息');
    const teacherOwn = await speechTts(asTeacher('/api/speech/tts', { sessionId: teacherSession.id, messageId: teacherParentMessage.id }));
    assert.equal(teacherOwn.status, 200);
    assert.equal(typeof (await teacherOwn.json()).data.audioUrl, 'string');

    // 9. 跨学生归属拒绝（仓库层，与既有 workflow-route 模式一致）：另一学生上下文 → FORBIDDEN
    //    路由级第二名学生 HTTP 请求需真实第二身份，列待验收（不注册新账号/伪造 JWT）
    const other = new AgentRepository({ id: 'preview-other-student', role: 'student', displayName: '合成另一学生', studentNo: null, chaoxingUid: null, provider: 'preview', accessToken: null });
    await assert.rejects(other.getSession(session.id), /FORBIDDEN/);
  } finally {
    if (saved.preview === undefined) delete process.env.ENABLE_UI_PREVIEW; else process.env.ENABLE_UI_PREVIEW = saved.preview;
    if (saved.fixture === undefined) delete process.env.ENABLE_AI_FIXTURE; else process.env.ENABLE_AI_FIXTURE = saved.fixture;
  }
});
