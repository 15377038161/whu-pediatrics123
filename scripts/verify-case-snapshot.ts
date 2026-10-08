/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 快照链路验证：直接调用 ensureCaseSnapshot → readTeacherCaseData 回退，
 * 验证「本地 teaching-cases 缺失 → 知识库召回 → 结构化快照 → 教学数据可用」。
 * 运行：pnpm tsx scripts/verify-case-snapshot.ts
 */
import { ensureCaseSnapshot, getSnapshotMedia } from '../src/lib/case-snapshot';
import { readTeacherCaseData } from '../src/lib/teacher-case-data';

async function main() {
  const cases = ['teacher-新生儿呼吸窘迫综合征', 'teacher-川崎病', 'teacher-新生儿败血症'];
  let pass = 0;
  let fail = 0;
  for (const caseId of cases) {
    const snapshot = await ensureCaseSnapshot(caseId);
    if (!snapshot) {
      console.log(`FAIL ${caseId}: ensureCaseSnapshot 返回 null（未召回到内容）`);
      fail += 1;
      continue;
    }
    const media = getSnapshotMedia(caseId);
    const data = readTeacherCaseData(caseId);
    // 媒体 URL 属 best-effort：仅部分病例的文档分片含影像册 URL，不作为硬性通过条件。
    const checks = [
      ['chunkCount > 0', snapshot.meta.chunkCount > 0],
      ['sections.history 非空', Boolean(snapshot.data.sections.history)],
      ['诊断/处置至少一段', Boolean(snapshot.data.sections.diagnosis || snapshot.data.sections.plan)],
      ['readTeacherCaseData 回退读取成功', data !== null],
    ] as const;
    const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failed.length === 0) {
      pass += 1;
      console.log(`PASS ${caseId}: chunks=${snapshot.meta.chunkCount} age=${snapshot.data.age} sex=${snapshot.data.sex} media=${media.length} complaint="${snapshot.data.complaint.slice(0, 30)}"`);
    } else {
      fail += 1;
      console.log(`FAIL ${caseId}: 未通过 ${failed.join('、')}`);
    }
  }
  console.log(`\n结果: pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => { console.error('FATAL', error); process.exit(1); });
