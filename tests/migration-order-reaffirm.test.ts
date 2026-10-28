import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 迁移顺序收口静态验证（缺口A）：
 *  背景：安全修复函数最初落在 20261011160000，但历史迁移 20261015100000
 *  （restore_tests_ordered_gate 的旧版 get_facts：orderedTests>0 即返回全部 sections.tests）
 *  时间戳更晚——从零按时间戳重放时，20261015100000 会以其旧版 get_facts 覆盖修复，
 *  最终函数回到「一次下单暴露全部 tests 全文」的泄露形态。
 *  收口迁移 20261016000000 时间戳 > 20261015100000，重申四个函数的最终安全版。
 *  本测试只读迁移文件做静态重放模拟（不执行 SQL、不触碰数据库）：
 *   1) 重放模拟：按文件名序（=时间戳序）依次应用 create or replace function 定义，后定义覆盖先定义；
 *   2) 最终态断言：四个函数的最终版必须含安全标记（无 tests 全文泄露）；
 *   3) 中间态取证：20261015100000 之后、20261016000000 之前确实为泄露形态（证明收口必要性）；
 *   4) 逐字一致：收口迁移与 20261011160000 的函数体逐字相同（幂等重定义，对已按正确顺序
 *      执行过的环境无行为变化）；
 *   5) 历史文件未改动：20261015100000 仍是旧门控原文（不批量重写历史快照）。 */

const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

interface FunctionDef {
  name: string;
  args: string;
  body: string;
}

function extractFunctionDefs(sql: string): FunctionDef[] {
  const defs: FunctionDef[] = [];
  // Later migrations also use uppercase statements and named dollar quotes.
  const re = /create\s+or\s+replace\s+function\s+([a-z_]+)\s*\(([^)]*)\)[\s\S]*?\bas\s+(\$[a-z_0-9]*\$)([\s\S]*?)\3;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    defs.push({ name: m[1].toLowerCase(), args: m[2].replace(/\s+/g, ' ').trim(), body: m[4] });
  }
  return defs;
}

const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
assert.ok(migrationFiles.length > 0, '迁移目录为空');

/** 按文件名序重放：返回 [每个函数的最终定义, 每个函数被应用的历史记录] */
function replay(): { final: Map<string, FunctionDef>; history: Map<string, Array<{ file: string; def: FunctionDef }>> } {
  const final = new Map<string, FunctionDef>();
  const history = new Map<string, Array<{ file: string; def: FunctionDef }>>();
  for (const file of migrationFiles) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const def of extractFunctionDefs(sql)) {
      final.set(def.name, def);
      if (!history.has(def.name)) history.set(def.name, []);
      history.get(def.name)!.push({ file, def });
    }
  }
  return { final, history };
}

const LEAK_GATED_MARKER = "if not v_has_tests then"; // 旧门控：orderedTests>0 才剥（泄露形态标记）
const SECURE_STRIP_MARKER = "v_sections := v_sections - 'tests';"; // 安全版：训练中无条件剥 tests
const ORDERED_CHECK_MARKER = "where o.tid = p_test_id"; // get_test 已下单验证
const IDEMPOTENT_MARKER = "? p_test_id"; // record 幂等追加
const WHITELIST_MARKER = "v_whitelist"; // label 白名单

const NAMES = {
  record: 'case_snapshot_record_test_order',
  getTest: 'case_snapshot_get_test',
  listTests: 'case_snapshot_list_tests',
  getFacts: 'case_snapshot_get_facts',
} as const;

test('重放最终态：get_facts 训练中无条件剥离 tests（无 orderedTests 门控泄露）', () => {
  const { final } = replay();
  const def = final.get(NAMES.getFacts);
  assert.ok(def, '最终态缺少 case_snapshot_get_facts');
  assert.ok(def.body.includes(SECURE_STRIP_MARKER), '最终 get_facts 必须无条件剥离 tests 段');
  assert.ok(!def.body.includes(LEAK_GATED_MARKER), '最终 get_facts 不得保留旧版 v_has_tests 门控（泄露形态）');
  assert.ok(!/\bv_has_tests\b/.test(def.body), '最终 get_facts 不得声明 v_has_tests');
  // 完成态全文复盘保留；diagnosis/plan 永不从 facts 返回
  assert.ok(def.body.includes("FINISH_SESSION"), '完成态双条件（FINISH_SESSION 事件）保留');
  assert.ok(def.body.includes("- 'diagnosis' - 'plan'"), 'diagnosis/plan 永不从 facts 返回');
  // 归属/版本/病例三重守卫保留
  assert.ok(def.body.includes('v_row.user_id is distinct from auth.uid()'), '归属守卫（受保护 user_id 列）保留');
  assert.ok(def.body.includes("sourceSnapshotVersion"), '版本绑定校验保留');
});

test('重放最终态：get_test 含已下单验证；list_tests 含白名单 label；record 幂等原子', () => {
  const { final } = replay();
  const getTest = final.get(NAMES.getTest);
  assert.ok(getTest, '最终态缺少 case_snapshot_get_test');
  assert.ok(getTest.body.includes(ORDERED_CHECK_MARKER), 'get_test 必须验证 p_test_id ∈ orderedTests');
  assert.ok(getTest.body.includes(WHITELIST_MARKER), 'get_test label 必须白名单匹配');

  const listTests = final.get(NAMES.listTests);
  assert.ok(listTests, '最终态缺少 case_snapshot_list_tests');
  assert.ok(listTests.body.includes(WHITELIST_MARKER), 'list_tests label 必须白名单匹配');

  const record = final.get(NAMES.record);
  assert.ok(record, '最终态缺少 case_snapshot_record_test_order');
  assert.ok(record.body.includes(IDEMPOTENT_MARKER), 'record 必须幂等原子追加（已存在不重复）');
  assert.ok(record.body.includes('FINISH_SESSION'), 'record 完成态拒绝写入保留');
});

test('中间态取证：20261015100000 重放后 get_facts 确为泄露形态（证明收口必要性）', () => {
  // 截止 20261015100000（不含收口迁移 20261016000000）重放
  let mid: FunctionDef | undefined;
  for (const file of migrationFiles) {
    if (file >= '20261016000000_case_tests_rpc_reaffirm.sql') continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const def of extractFunctionDefs(sql)) {
      if (def.name === NAMES.getFacts) mid = def;
    }
  }
  assert.ok(mid, '中间态缺少 get_facts');
  assert.ok(mid.body.includes(LEAK_GATED_MARKER), '中间态应为旧门控形态（orderedTests>0 即返回全文）');
});

test('收口迁移时间戳 > 20261015100000，且历史迁移文件未被改动', () => {
  const reaffirm = migrationFiles.find((f) => f.startsWith('20261016000000'));
  assert.ok(reaffirm, '缺少收口迁移 20261016000000_case_tests_rpc_reaffirm.sql');
  assert.ok(reaffirm > '20261015100000_restore_tests_ordered_gate.sql', '收口迁移必须晚于 20261015100000');
  // 历史迁移 20261015100000 仍是旧门控原文（含 v_has_tests 门控），未被重写为安全版
  const restoreSql = readFileSync(join(MIGRATIONS_DIR, '20261015100000_restore_tests_ordered_gate.sql'), 'utf8');
  assert.ok(restoreSql.includes(LEAK_GATED_MARKER), '历史迁移 20261015100000 不应被改动（仍是旧门控原文）');
});

test('收口迁移函数体与 20261011160000 逐字一致（幂等重定义，无行为变化）', () => {
  const sourceSql = readFileSync(join(MIGRATIONS_DIR, '20261011160000_case_test_order_persist.sql'), 'utf8');
  const reaffirmSql = readFileSync(join(MIGRATIONS_DIR, '20261016000000_case_tests_rpc_reaffirm.sql'), 'utf8');
  const sourceDefs = new Map(extractFunctionDefs(sourceSql).map((d) => [d.name, d]));
  const reaffirmDefs = extractFunctionDefs(reaffirmSql);
  assert.equal(reaffirmDefs.length, 4, '收口迁移必须重申全部四个函数');
  for (const def of reaffirmDefs) {
    const src = sourceDefs.get(def.name);
    assert.ok(src, `收口迁移函数 ${def.name} 在源头迁移中不存在`);
    assert.equal(def.args, src.args, `${def.name} 参数签名必须一致`);
    assert.equal(def.body, src.body, `${def.name} 函数体必须与 20261011160000 逐字一致`);
  }
});

test('收口迁移权限：四个函数均 revoke public/anon、仅 authenticated', () => {
  const reaffirmSql = readFileSync(join(MIGRATIONS_DIR, '20261016000000_case_tests_rpc_reaffirm.sql'), 'utf8');
  for (const name of Object.values(NAMES)) {
    assert.ok(reaffirmSql.includes(`revoke all on function ${name}`), `${name} 必须 revoke`);
    const grantRe = new RegExp(`grant execute on function ${name}\\([^)]*\\) to authenticated;`);
    assert.ok(grantRe.test(reaffirmSql), `${name} 必须仅授权 authenticated`);
  }
});

test('SQL 白名单与 src/domain/case.ts TRUSTED_TEST_NAMES 同步', () => {
  const caseSrc = readFileSync(join(__dirname, '..', 'src', 'domain', 'case.ts'), 'utf8');
  const m = caseSrc.match(/TRUSTED_TEST_NAMES[^=]*=\s*\[([\s\S]*?)\]\s*(?:as|;)/);
  assert.ok(m, 'src/domain/case.ts 缺少 TRUSTED_TEST_NAMES');
  const tsNames = Array.from(m[1].matchAll(/'([^']+)'/g)).map((x) => x[1]);
  assert.ok(tsNames.length > 0);
  const {final}=replay();
  for (const name of [NAMES.getTest,NAMES.listTests]) {
    const body=final.get(name)?.body;assert.ok(body);
    const whitelistBlocks=Array.from(body.matchAll(/v_whitelist text\[\] := array\[([\s\S]*?)\];/g));
    assert.equal(whitelistBlocks.length,1,`${name}最终定义必须含一处白名单`);
    const sqlNames=Array.from(whitelistBlocks[0][1].matchAll(/'([^']+)'/g)).map(x=>x[1]);
    assert.deepEqual(sqlNames,tsNames,'最终SQL白名单必须与TS白名单逐项一致（顺序含），历史迁移不改写');
  }
});

test('重放解析包含大写与命名dollar quote，不能漏掉后续迁移',()=>{
 const defs=extractFunctionDefs('CREATE OR REPLACE FUNCTION latest_fn(a text) RETURNS text LANGUAGE sql AS $function$ SELECT a; $function$;');
 assert.deepEqual(defs,[{name:'latest_fn',args:'a text',body:' SELECT a; '}]);
 const {history}=replay();
 for(const name of [NAMES.getTest,NAMES.listTests])assert.equal(history.get(name)?.at(-1)?.file,'20261028033510_case_pet_ct_test_label.sql');
});
