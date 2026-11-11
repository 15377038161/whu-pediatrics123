import type { NoteSectionKey } from './medical-note';
import { NOTE_PRIMARY_VERSION, notePrimaryErrors } from './note-primary-contract';
import type { TeachingPackage, TeachingRubricItem } from './teaching-package';

/** Case-specific concept synonyms used only to recognise concise student wording, never as patient facts. */
const CONCEPT_GROUPS: string[][] = [
  ['发热', '发烧'], ['咳嗽'], ['犬吠样咳嗽', '犬吠样', '空空样咳嗽'], ['声音嘶哑', '声嘶'],
  ['吸气性喉鸣', '喉鸣'], ['呼吸困难', '呼吸费力', '气促', '喘憋'], ['三凹征'], ['发绀', '青紫'],
  ['喘息', '喘鸣'], ['哮鸣音'], ['啰音'], ['呼吸音'], ['多饮'], ['多尿'], ['体重下降', '消瘦'],
  ['乏力', '没力气'], ['恶心'], ['呕吐'], ['腹痛'], ['腹泻', '拉肚子'], ['尿量'], ['少尿'], ['无尿'],
  ['水肿'], ['血尿'], ['蛋白尿'], ['黄疸', '黄染'], ['胆红素'], ['皮疹'], ['瘀点', '瘀斑'], ['出血'],
  ['抽搐', '惊厥'], ['意识', '神志'], ['精神'], ['喂养', '吃奶', '进食'], ['出生'], ['胎龄'], ['接种', '疫苗'],
  ['既往'], ['过敏'], ['家族史', '家族'], ['血糖'], ['血酮', '酮体'], ['尿酮'], ['血气'], ['酸碱', '酸中毒'],
  ['血钾', '钾离子'], ['血钠', '钠离子'], ['电解质'], ['胰岛素'], ['补液', '液体疗法'], ['补钾'],
  ['脑水肿'], ['抗感染', '抗菌', '抗生素'], ['氧疗', '吸氧'], ['通气'], ['雾化'], ['激素', '糖皮质激素'],
  ['光疗'], ['换血'], ['输血'], ['心电监护', '心电监测'], ['血压'], ['心率'], ['体温'], ['呼吸频率'],
  ['血氧', 'SpO2'], ['白细胞', 'WBC'], ['血红蛋白', 'Hb'], ['血小板', 'PLT'], ['C反应蛋白', 'CRP'],
  ['降钙素原', 'PCT'], ['血培养'], ['尿培养'], ['脑脊液'], ['胸部X线', '胸片'], ['胸部CT'],
  ['心电图'], ['心脏超声', '超声心动图'], ['腹部超声', '腹部B超'], ['肾功能'], ['肝功能'],
  ['复查', '复评', '监测'], ['随访', '复诊'], ['住院'], ['转诊'], ['饮食'], ['口服'],
];
const UNKNOWN_TERMS = ['原资料未记录', '原材料未单独记录', '未单独记录', '未记录', '未提及', '待核实', '不详', '无法确认'];
const DURATION_TERMS = ['起病', '病程', '持续', '变化', '进展', '加重', '缓解', '治疗后', '用药后', '时间'];

function conceptGroups(text: string, limit = 4): string[][] {
  if (/未单独记录|原资料未记录|资料未记载|未提及/.test(text)) return [UNKNOWN_TERMS];
  const lower = text.toLowerCase();
  const found = CONCEPT_GROUPS
    .filter(group => group.some(term => lower.includes(term.toLowerCase())))
    .sort((left, right) => {
      const index = (group: string[]) => Math.min(...group.map(term => {
        const position = lower.indexOf(term.toLowerCase());
        return position < 0 ? Number.MAX_SAFE_INTEGER : position;
      }));
      return index(left) - index(right);
    })
    .slice(0, limit);
  const values = text.match(/[0-9０-９一二三四五六七八九十半]+(?:\.\d+)?\s*(?:天|小时|周|个月|岁|℃|mmol\/L|g\/L|mmHg|次\/分|%)/gi) ?? [];
  for (const value of values.slice(0, 2)) {
    if (found.length >= limit) break;
    const compact = value.replace(/\s+/g, '');
    found.push([value, compact]);
  }
  if (found.length) return found;
  const fragment = text.split(/[。；;\n]/).map(item => item.trim()).find(item => item.length >= 2);
  return fragment ? [[fragment.slice(0, 24)]] : [];
}

function point(
  id: string,
  section: TeachingRubricItem['section'],
  level: TeachingRubricItem['level'],
  label: string,
  maxScore: number,
  fullAnswer: string,
  sourceLocator: string,
  concepts: string[][],
  noteSection?: NoteSectionKey,
  noteComponent?: 'diagnosis' | 'basis',
): TeachingRubricItem {
  return {
    id, section, level, label, maxScore, fullAnswer, sourceLocator, concepts,
    evidenceCodes: [], partialAnswer: '方向正确，但尚缺本条必要条件；只给本条一半分。',
    incorrectAnswer: '遗漏、否定应做事项、写入相反或危险措施，或仅有无法识别的套话。',
    safetyCritical: /安全|危重|气道|血钾|意识|禁忌/.test(label), unsafePhrases: [],
    ...(noteSection ? { noteSection } : {}), ...(noteComponent ? { noteComponent } : {}),
  };
}

/** Exact tenth-point allocation; no silent normalisation of the published total. */
function allocate(items: TeachingRubricItem[], target: number): TeachingRubricItem[] {
  if (!items.length) return [];
  const total = items.reduce((sum, item) => sum + item.maxScore, 0);
  if (total <= 0) throw new Error('RUBRIC_SOURCE_TOTAL_INVALID');
  const targetUnits = Math.round(target * 10);
  const units = items.map(item => Math.floor(item.maxScore / total * targetUnits + 1e-8));
  let remaining = targetUnits - units.reduce((sum, value) => sum + value, 0);
  const order = items.map((item, index) => ({
    index,
    fraction: item.maxScore / total * targetUnits - units[index],
  })).sort((left, right) => right.fraction - left.fraction);
  for (const candidate of order) {
    if (remaining <= 0) break;
    units[candidate.index]++;
    remaining--;
  }
  if (remaining !== 0 || units.some(value => value <= 0)) throw new Error('RUBRIC_ALLOCATION_INVALID');
  return items.map((item, index) => ({ ...item, maxScore: units[index] / 10 }));
}

function scaled(
  rubric: TeachingRubricItem[],
  section: TeachingRubricItem['section'],
  level: TeachingRubricItem['level'],
  target: number,
): TeachingRubricItem[] {
  return allocate(rubric.filter(item => item.section === section && item.level === level), target);
}

function withNoteSection(item: TeachingRubricItem, noteSection: NoteSectionKey, id = `note-${item.id}`): TeachingRubricItem {
  return { ...item, id, section: 'note', noteSection, evidenceCodes: [] };
}

/**
 * Convert the existing case-authored rubric without replacing its clinical content by a universal template.
 * Process evidence codes stay on process items; final-note items grade only their own submitted section.
 */
export function buildNotePrimaryRubric(pack: TeachingPackage): TeachingRubricItem[] {
  const old = pack.rubric;
  const note: TeachingRubricItem[] = [];
  const reference = pack.referenceNote;

  note.push(point(
    'note-chief-complaint', 'note', 'basic', '主诉：主要症状与持续时间', 3,
    reference.chiefComplaint, 'referenceNote.chiefComplaint', conceptGroups(reference.chiefComplaint), 'chiefComplaint',
  ));

  const oldHistory = old.filter(item => item.section === 'history' && item.level === 'basic');
  const presentItems = (oldHistory.length ? oldHistory : [point('history-fallback', 'history', 'basic', '现病史', 1, reference.presentIllness, 'referenceNote.presentIllness', conceptGroups(reference.presentIllness))])
    .map(item => {
      const facts = pack.historyFacts.filter(fact => item.evidenceCodes.includes(fact.id));
      const answer = facts.map(fact => fact.text).join('；') || reference.presentIllness;
      return point(
        `note-present-${item.id}`, 'note', 'basic', `现病史：${item.label.replace(/^问清/, '')}`, item.maxScore,
        answer, 'referenceNote.presentIllness', conceptGroups(answer), 'presentIllness',
      );
    });
  note.push(...allocate(presentItems, 10));
  const oldHistoryAdvanced = old.find(item => item.section === 'history' && item.level === 'advanced');
  note.push(point(
    'note-present-course', 'note', 'advanced', '现病史：病程演变与诊治经过', 2,
    reference.presentIllness, 'referenceNote.presentIllness',
    [...(oldHistoryAdvanced?.concepts.length ? oldHistoryAdvanced.concepts : [DURATION_TERMS])], 'presentIllness',
  ));

  for (const [noteSection, label] of [
    ['pastHistory', '既往史'], ['personalHistory', '个人史'], ['familyHistory', '家族史'],
  ] as const) {
    const answer = reference[noteSection];
    note.push(point(`note-${noteSection}`, 'note', 'basic', `${label}：记录本例资料或明确未记录`, 2,
      answer, `referenceNote.${noteSection}`, conceptGroups(answer), noteSection));
  }

  const oldExams = old.filter(item => item.section === 'exam' && item.level === 'basic' && item.id !== 'exam-prep');
  const physicalItems = (oldExams.length ? oldExams : [point('exam-fallback', 'exam', 'basic', '体格检查', 1, reference.physicalExam, 'referenceNote.physicalExam', conceptGroups(reference.physicalExam))])
    .map(item => {
      const exam = pack.exams.find(candidate => item.evidenceCodes.includes(candidate.evidenceCode));
      const answer = exam?.origin === 'source' ? exam.result : reference.physicalExam;
      return point(`note-physical-${item.id}`, 'note', 'basic', `体格检查：${item.label}`, item.maxScore,
        answer, exam?.sourceLocator ?? 'referenceNote.physicalExam', conceptGroups(answer), 'physicalExam');
    });
  note.push(...allocate(physicalItems, 6));
  note.push(point(
    'note-physical-interpretation', 'note', 'advanced', '体格检查：临床含义与来源边界', 2,
    reference.physicalExam, 'referenceNote.physicalExam',
    [...conceptGroups(reference.physicalExam, 2), ['提示', '支持', '考虑', '符合', '结合', '鉴别']], 'physicalExam',
  ));

  const sourceTests = pack.tests.filter(test => test.origin === 'source')
    .sort((left, right) => Number(right.necessity === 'essential') - Number(left.necessity === 'essential')).slice(0, 4);
  const auxiliaryItems = (sourceTests.length ? sourceTests : [null]).map((test, index) => {
    const answer = test?.result ?? reference.auxiliaryTests;
    return point(`note-auxiliary-${index}`, 'note', 'basic', test ? `辅助检查：${test.label}` : '辅助检查：原资料状态',
      1, answer, test?.sourceLocator ?? 'referenceNote.auxiliaryTests', conceptGroups(answer), 'auxiliaryTests');
  });
  note.push(...allocate(auxiliaryItems, 4));
  note.push(point(
    'note-auxiliary-interpretation', 'note', 'advanced', '辅助检查：用途、局限与结果来源', 2,
    reference.auxiliaryTests, 'referenceNote.auxiliaryTests',
    [['诊断', '鉴别', '评估', '监测'], ['结合', '局限', '不能', '不能排除'], ['原记录', '教学模拟', '参考', '待回报', '未做', '未查']],
    'auxiliaryTests',
  ));

  const oldDiagnosis = old.find(item => item.id === 'diagnosis-primary');
  const diagnosis = oldDiagnosis
    ? { ...withNoteSection(oldDiagnosis, 'preliminaryDiagnosis', 'note-diagnosis-primary'), level: 'basic' as const, maxScore: 4, noteComponent: 'diagnosis' as const }
    : point('note-diagnosis-primary', 'note', 'basic', '主要诊断', 4, reference.preliminaryDiagnosis,
      'referenceNote.preliminaryDiagnosis', conceptGroups(reference.preliminaryDiagnosis), 'preliminaryDiagnosis', 'diagnosis');
  note.push(diagnosis);
  note.push(point('note-diagnosis-complete', 'note', 'advanced', '诊断完整性与病情分层', 1,
    reference.preliminaryDiagnosis, 'referenceNote.preliminaryDiagnosis', conceptGroups(reference.preliminaryDiagnosis, 3),
    'preliminaryDiagnosis', 'diagnosis'));
  const evidenceAnswer = [reference.presentIllness, reference.physicalExam, reference.auxiliaryTests].filter(Boolean).join('；');
  note.push(point('note-diagnosis-basis', 'note', 'basic', '主要诊断的本例依据', 4,
    evidenceAnswer, 'referenceNote.diagnosisBasis', conceptGroups(evidenceAnswer, 4), 'preliminaryDiagnosis', 'basis'));
  note.push(point('note-diagnosis-reasoning', 'note', 'advanced', '诊断依据与诊断结论相互支撑', 1,
    evidenceAnswer, 'referenceNote.diagnosisBasis',
    [...conceptGroups(evidenceAnswer, 2), ['依据', '支持', '符合', '提示', '考虑', '因此']], 'preliminaryDiagnosis', 'basis'));

  const oldDifferential = old.find(item => item.id === 'diagnosis-differential');
  note.push(point('note-differential-names', 'note', 'basic', '列出本例相关鉴别诊断', 3,
    reference.differentialDiagnosis, 'referenceNote.differentialDiagnosis',
    oldDifferential?.concepts.length ? oldDifferential.concepts : conceptGroups(reference.differentialDiagnosis), 'differentialDiagnosis'));
  note.push(point('note-differential-reasoning', 'note', 'advanced', '说明鉴别依据而非只列病名', 2,
    reference.differentialDiagnosis, 'referenceNote.differentialDiagnosis',
    [...(oldDifferential?.concepts.length ? oldDifferential.concepts : conceptGroups(reference.differentialDiagnosis)),
      ['依据', '鉴别', '区别', '不同', '支持', '排除', '结合']], 'differentialDiagnosis'));

  const treatmentItems = old.filter(item => item.section === 'plan' && item.level === 'basic')
    .map(item => withNoteSection(item, 'treatmentPlan', `note-treatment-${item.id}`));
  if (treatmentItems.length) note.push(...allocate(treatmentItems, 8));
  else note.push(point('note-treatment-plan', 'note', 'basic', '本例诊疗计划', 8,
    reference.treatmentPlan, 'referenceNote.treatmentPlan', conceptGroups(reference.treatmentPlan), 'treatmentPlan'));
  const oldReassessment = old.find(item => item.id === 'plan-reassess');
  note.push(point('note-treatment-reassessment', 'note', 'advanced', '复评、监测与升级处置安排', 2,
    reference.treatmentPlan, 'referenceNote.treatmentPlan',
    oldReassessment?.concepts.length ? oldReassessment.concepts : conceptGroups(reference.treatmentPlan), 'treatmentPlan'));

  const process = [
    ...scaled(old, 'history', 'basic', 8),
    ...scaled(old, 'history', 'advanced', 2),
    ...scaled(old, 'exam', 'basic', 10),
    ...scaled(old, 'exam', 'advanced', 2),
    ...scaled(old, 'tests', 'basic', 4),
    ...scaled(old, 'tests', 'advanced', 2),
    ...scaled(old, 'plan', 'basic', 6),
    ...scaled(old, 'plan', 'advanced', 2),
  ];
  const communication = old.find(item => item.section === 'communication' && item.level === 'basic');
  const communicationAdvanced = old.find(item => item.section === 'communication' && item.level === 'advanced');
  if (communication) {
    process.push({
      ...communication, maxScore: 4,
      concepts: [...communication.concepts, ...(communicationAdvanced?.concepts ?? [])],
    });
  }

  const noteReportSections: Partial<Record<NoteSectionKey, TeachingRubricItem['section']>> = {
    presentIllness: 'history', physicalExam: 'exam', auxiliaryTests: 'tests',
    preliminaryDiagnosis: 'diagnosis', differentialDiagnosis: 'diagnosis', treatmentPlan: 'plan',
  };
  const result = [...note, ...process].map(item => {
    const withConcepts = item.id !== 'exam-interpret' && !item.concepts.length
      ? { ...item, concepts: conceptGroups(item.fullAnswer) }
      : item;
    const reportSection = item.section === 'note' && item.noteSection ? noteReportSections[item.noteSection] : undefined;
    return reportSection ? { ...withConcepts, reportSection } : withConcepts;
  });
  const errors = notePrimaryErrors(result);
  if (errors.length) throw new Error(`${NOTE_PRIMARY_VERSION}:${pack.caseId}:${errors.join(',')}`);
  if (new Set(result.map(item => item.id)).size !== result.length) throw new Error(`RUBRIC_ID_DUPLICATE:${pack.caseId}`);
  return result;
}
