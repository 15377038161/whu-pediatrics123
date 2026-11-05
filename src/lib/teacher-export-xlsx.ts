import type { TeacherStudentProfile, TeacherStudentSummary } from '@/lib/repository';
import { formatDateTime, modeLabel, scoreBasisLabel } from '@/lib/teacher-export-csv';
import { maskName, maskStudentNo } from '@/lib/usage-stats-csv';
import type { XlsxSheetSpec } from '@/lib/xlsx-writer';

/**
 * 教师分模块导出 Excel 版（学情总表 / 学生档案），与 teacher-export-csv 同一份数据与脱敏口径。
 *
 * 与 CSV 版的唯一结构差异：得分列写成真正的数字（null 留空）而不是「未评分」文本，
 * 这样老师可以直接在 Excel 里求和、排序、做透视表；「未评分」改由相邻的「评分状态」列承载，
 * 信息不丢（总分 0 不代表能力 0 分，未评分必须与 0 分区分开）。
 */

const STUDENTS_NOTES: readonly string[] = [
  '口径说明：最近得分沿用学情首页口径（未评分报告与过程分不计入）；待复核＝最近报告 pending_review 且无复核留痕。',
  '训练次数＝教师可见训练会话总数（含进行中）；报告数＝可见报告总数；正式成绩以教师复核留痕为准。',
  '姓名与学号已脱敏（页面可见明文，导出统一脱敏）。',
];

const PROFILE_NOTES: readonly string[] = [
  '口径说明：得分列为报告折算视图，未评分留空并在「评分状态」列标注；正式成绩与重练次数见「病例进度」表。',
  '报告状态/已复核为复核流转信息（pending_review 且无留痕＝待复核）。',
  '数据与学生档案页一致，由同一服务端聚合方法授权；姓名与学号已脱敏。',
];

export function buildStudentsSheets(students: readonly TeacherStudentSummary[]): XlsxSheetSpec[] {
  return [{
    name: '学情总表',
    notes: STUDENTS_NOTES,
    columns: [
      { header: '学生(脱敏)' },
      { header: '学号(脱敏)' },
      { header: '班级' },
      { header: '训练次数', kind: 'number' },
      { header: '报告数', kind: 'number' },
      { header: '最近得分', kind: 'number' },
      { header: '最近得分口径' },
      { header: '最近模式' },
      { header: '待复核' },
      { header: '最近活跃' },
    ],
    rows: students.map((student) => [
      maskName(student.displayName),
      maskStudentNo(student.studentNo ?? ''),
      student.cohortName ?? '未归属当前班级',
      student.trainCount,
      student.reportCount,
      student.latestScore,
      scoreBasisLabel(student.latestScoreBasis),
      modeLabel(student.latestMode),
      student.latestPendingReview ? '待复核' : null,
      formatDateTime(student.lastActiveAt),
    ]),
  }];
}

export function buildProfileSheets(profile: TeacherStudentProfile): XlsxSheetSpec[] {
  return [
    {
      name: '学生概要',
      notes: PROFILE_NOTES,
      columns: [{ header: '项目' }, { header: '内容' }],
      rows: [
        ['学生(脱敏)', maskName(profile.student.displayName)],
        ['学号(脱敏)', maskStudentNo(profile.student.studentNo ?? '')],
        ['班级', profile.student.cohortName ?? '未归属当前班级'],
      ],
    },
    {
      name: '训练明细',
      notes: PROFILE_NOTES,
      columns: [
        { header: '训练开始' },
        { header: '最近更新' },
        { header: '类型' },
        { header: '病例' },
        { header: '会话状态' },
        { header: '得分', kind: 'number' },
        { header: '得分口径' },
        { header: '评分状态' },
        { header: '报告状态' },
        { header: '已复核' },
      ],
      rows: profile.sessions.map((session) => [
        formatDateTime(session.startedAt),
        formatDateTime(session.updatedAt),
        modeLabel(session.mode),
        session.caseId ?? '病例未标注',
        session.status ?? null,
        session.totalScore,
        scoreBasisLabel(session.scoreBasis),
        session.totalScore === null ? '未评分' : session.scoreBasis === 'process' ? '过程完成度分' : '已评分',
        session.reportStatus ?? null,
        session.reviewed ? '是' : '否',
      ]),
    },
    {
      name: '病例进度',
      notes: PROFILE_NOTES,
      columns: [
        { header: '病例' },
        { header: '编号', kind: 'number' },
        { header: '训练次数', kind: 'number' },
        { header: '完成次数', kind: 'number' },
        { header: '报告数', kind: 'number' },
        { header: '正式成绩', kind: 'number' },
        { header: '重练次数', kind: 'number' },
        { header: '待复核数', kind: 'number' },
        { header: '最近训练' },
      ],
      rows: profile.caseProgress.map((progress) => [
        progress.caseLabel,
        progress.indexNumber,
        progress.trainCount,
        progress.completedCount,
        progress.reportCount,
        progress.officialScore,
        progress.retakeCount,
        progress.pendingReviewCount,
        formatDateTime(progress.latestAt),
      ]),
    },
  ];
}
