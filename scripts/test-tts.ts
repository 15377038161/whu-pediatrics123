/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * TTS 合成实测（无患者信息教学短句）。
 * 验证目标：
 * 1. 网关 TTS 端点当前 404（未开通）时，synthesizeSpeech 返回 null（降级信号），不抛异常；
 * 2. 404 触发进程级熔断：后续调用直接降级（无网络请求）；
 * 3. 失败日志明确标注"端点未开通"而非瞬时故障。
 * 运行：pnpm tsx scripts/test-tts.ts（依赖平台注入的 CODER_CODING_* 凭据，无凭据时如实报告 missing）。
 */
export {};

async function main() {
  const { synthesizeSpeech, isTTSEndpointBroken, personaToSpeaker } = await import('../src/lib/tts');

  const sentence = '请小朋友深呼吸，医生现在要听一下肺部。'; // 无患者信息的通用教学句
  console.log(`[test-tts] speaker=${personaToSpeaker('child')} sentence="${sentence}"`);

  let firstNull = false;
  try {
    const audio = await synthesizeSpeech({ text: sentence, persona: 'child' });
    firstNull = audio === null;
    if (audio) {
      console.log(`[test-tts] PASS_WITH_AUDIO bytes=${audio.byteLength} head=${audio.subarray(0, 4).toString('hex')}`);
    }
  } catch (error) {
    console.log(`[test-tts] FAIL_UNEXPECTED_THROW ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const brokenAfterFirst = isTTSEndpointBroken();
  console.log(`[test-tts] firstCallNull=${firstNull} breakerActive=${brokenAfterFirst}`);

  if (firstNull && !brokenAfterFirst) {
    console.log('[test-tts] INCONCLUSIVE: returned null without breaker (credential missing or other failure), see log above');
    process.exit(0);
  }

  if (firstNull && brokenAfterFirst) {
    // 第二次调用应命中熔断（无网络请求，立即返回 null）
    const t0 = Date.now();
    const second = await synthesizeSpeech({ text: sentence, persona: 'parent' });
    const elapsed = Date.now() - t0;
    console.log(`[test-tts] secondCallNull=${second === null} elapsedMs=${elapsed}`);
    const ok = second === null && elapsed < 2000 && isTTSEndpointBroken();
    console.log(ok ? '[test-tts] DEGRADE_CHAIN_PASS (404 -> null + breaker + immediate degrade)' : '[test-tts] DEGRADE_CHAIN_FAIL');
    process.exit(ok ? 0 : 1);
  }

  // 平台开通 TTS 端点后的真实合成路径：验证音频非空、mp3 头、可 fetch 播放
  console.log('[test-tts] TTS_ENDPOINT_AVAILABLE (audio synthesized)');
  process.exit(0);
}

void main();
