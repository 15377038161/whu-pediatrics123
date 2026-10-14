// 仅合成演示数据，用于本地浏览器布局测试；不读取私有病例/凭据、不连接数据库。
import { writeFileSync, mkdirSync } from 'node:fs';
import { createInitialSession } from '../src/lib/agent-engine';
import { buildReport } from '../src/lib/scoring';
import { CASE_CATALOG } from '../src/domain/case-catalog';
const session = createInitialSession('ui-synthetic-student', 'guided');
session.decision = { diagnosis: '合成学生判断', summary: '浏览器布局测试的合成摘要', diagnosisBasis: '合成病例的已采集病史和体征', differentials: '' };
const report = buildReport(session, 'ui-report');
mkdirSync('outputs/ui', { recursive: true });
writeFileSync('outputs/ui/fixtures.json', JSON.stringify({ session, report, catalog: CASE_CATALOG.slice(0, 2) }));
console.log('UI合成数据已准备（2个演示目录，无私有患者资料）。');
