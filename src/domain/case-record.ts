import type { AgentMessage, ClinicalEvent, SessionState } from '@/domain/agent';

export type CaseRecordCategory = 'history' | 'exam' | 'test';

export interface CaseRecordAnswer {
  actor: 'parent' | 'child';
  content: string;
}

export interface CaseRecordEntry {
  event: ClinicalEvent;
  category: CaseRecordCategory;
  question: string | null;
  answers: CaseRecordAnswer[];
}

const sourceQuestionPrefix = '依据病例正文回答：';
const unknownQuestionPrefix = '问诊记录：';
const unknownQuestionSuffix = '；该信息尚未获得';

/** 只从服务端已释放的会话事件与消息整理记录，不读取病例包或未解锁原文。 */
export function getCaseRecordEntries(session: Pick<SessionState, 'events' | 'messages'>): CaseRecordEntry[] {
  const usedStudentMessageIds = new Set<string>();
  return session.events
    .filter((event) => event.evidenceCodes.length > 0 || event.type === 'ORDER_TEST')
    .map((event) => {
      const category: CaseRecordCategory = event.type === 'ASK_QUESTION'||event.type==='SEND_COMMUNICATION'&&event.summary.startsWith('沟通交流：')
        ? 'history'
        : event.type === 'ORDER_TEST' ? 'test' : 'exam';
      if (category !== 'history') return { event, category, question: null, answers: [] };

      const question = sourceHistoryQuestion(event.summary);
      if (!question) return { event, category, question: null, answers: [] };
      const studentMessage = session.messages.find((item) => (
        item.actor === 'student'
        && item.content === question
        && !usedStudentMessageIds.has(item.id)
        && item.createdAt <= event.createdAt
      )) ?? session.messages.find((item) => (
        item.actor === 'student' && item.content === question && !usedStudentMessageIds.has(item.id)
      ));
      if (!studentMessage) return { event, category, question, answers: [] };
      usedStudentMessageIds.add(studentMessage.id);
      return { event, category, question, answers: answersAfterStudent(session.messages, studentMessage) };
    });
}

export function searchCaseRecordEntries(entries: CaseRecordEntry[], category: CaseRecordCategory | 'all', query: string): CaseRecordEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  return entries.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false;
    if (!normalizedQuery) return true;
    return [entry.event.summary, entry.question ?? '', ...entry.answers.map((answer) => answer.content)]
      .join('\n').toLocaleLowerCase('zh-CN').includes(normalizedQuery);
  });
}

function sourceHistoryQuestion(summary: string): string | null {
  if (summary.startsWith('沟通交流：')) return summary.slice('沟通交流：'.length).trim() || null;
  if (summary.startsWith(sourceQuestionPrefix)) return summary.slice(sourceQuestionPrefix.length).trim() || null;
  if (summary.startsWith(unknownQuestionPrefix) && summary.endsWith(unknownQuestionSuffix)) {
    return summary.slice(unknownQuestionPrefix.length, -unknownQuestionSuffix.length).trim() || null;
  }
  return null;
}

function answersAfterStudent(messages: AgentMessage[], studentMessage: AgentMessage): CaseRecordAnswer[] {
  const start = messages.findIndex((item) => item.id === studentMessage.id);
  if (start < 0) return [];
  const answers: CaseRecordAnswer[] = [];
  for (const item of messages.slice(start + 1)) {
    if (item.actor !== 'parent' && item.actor !== 'child') break;
    answers.push({ actor: item.actor, content: item.content });
  }
  return answers;
}
