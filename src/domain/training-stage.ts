import type { PracticeFocus, SessionMode, Stage } from '@/domain/agent';

export function isStandaloneCommunicationPractice(
  mode: SessionMode,
  practiceFocus?: PracticeFocus | null,
): boolean {
  return mode === 'practice' && practiceFocus === 'communication';
}

/**
 * 普通训练把病史采集和家长沟通呈现为同一个“沟通”环节。
 * 内部仍保留 history/communication 两个阶段，避免改变既有会话事件与评分。
 */
export function stageForTrainingNavigation(
  stage: Stage,
  mode: SessionMode,
  practiceFocus?: PracticeFocus | null,
): Stage {
  return stage === 'communication' && !isStandaloneCommunicationPractice(mode, practiceFocus)
    ? 'history'
    : stage;
}
