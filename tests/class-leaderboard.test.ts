import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildClassLeaderboard } from '../src/lib/class-leaderboard';
import { publicCaseId } from '../src/lib/case-identity';

const members = [
  { userId: '00000000-0000-4000-8000-000000000001', name: 'A' },
  { userId: '00000000-0000-4000-8000-000000000002', name: 'B' },
  { userId: '00000000-0000-4000-8000-000000000003', name: 'C' },
  { userId: '00000000-0000-4000-8000-000000000004', name: 'D' },
];

describe('班级积分榜领域聚合', () => {
  it('公开 UUID/内部 ID、别名与亚型按 sourceId 合并，每源只取最高分，同分采用 1、1、3 排名', () => {
    const result = buildClassLeaderboard('00000000-0000-4000-8000-000000000010', {
      members,
      scores: [
        // A：DKA 三种 ID 是同一来源，最高 85；肺炎支原体别名最高 80，共 165。
        { userId: members[0].userId, caseId: 'teacher-i型糖尿病伴有酮症酸中毒', score: 70 },
        { userId: members[0].userId, caseId: publicCaseId('teacher-i型糖尿病伴有酮症酸中毒'), score: 85 },
        { userId: members[0].userId, caseId: 'teacher-1型糖尿病伴有酮症酸中毒', score: 80 },
        { userId: members[0].userId, caseId: 'teacher-肺炎支原体性肺炎', score: 75 },
        { userId: members[0].userId, caseId: 'teacher-肺炎支原体肺炎', score: 80 },
        // B：肥胖症与单纯肥胖症同归一，最高 95，加呼吸病例 70，同为 165。
        { userId: members[1].userId, caseId: 'teacher-儿童-肥胖症', score: 90 },
        { userId: members[1].userId, caseId: 'teacher-单纯肥胖症', score: 95 },
        { userId: members[1].userId, caseId: 'peds-respiratory-001', score: 70 },
        { userId: members[2].userId, caseId: 'peds-respiratory-001', score: 80 },
        // RPC 以外的用户不能混入班级榜单。
        { userId: '00000000-0000-4000-8000-000000000099', caseId: 'peds-respiratory-001', score: 100 },
      ],
    });

    assert.equal(result.scoreBasis, 'clinical_process');
    assert.equal(result.tieRule, 'competition');
    assert.deepEqual(result.entries.map(({ userId, rank, points, sourceCount }) => ({ userId, rank, points, sourceCount })), [
      { userId: members[0].userId, rank: 1, points: 165, sourceCount: 2 },
      { userId: members[1].userId, rank: 1, points: 165, sourceCount: 2 },
      { userId: members[2].userId, rank: 3, points: 80, sourceCount: 1 },
      { userId: members[3].userId, rank: 4, points: 0, sourceCount: 0 },
    ]);
  });

  it('无成绩学生保留在榜单，非法分数或越界分数被拒绝', () => {
    const empty = buildClassLeaderboard('00000000-0000-4000-8000-000000000010', { members: [members[3]], scores: [] });
    assert.deepEqual(empty.entries[0], { ...members[3], rank: 1, points: 0, sourceCount: 0 });
    assert.throws(() => buildClassLeaderboard('00000000-0000-4000-8000-000000000010', {
      members: [members[0]],
      scores: [{ userId: members[0].userId, caseId: 'peds-respiratory-001', score: 101 }],
    }));
  });
});
