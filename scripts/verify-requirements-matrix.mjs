import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const content = readFileSync(new URL('../docs/实施方案/20261013_需求与验收矩阵.md', import.meta.url), 'utf8');
const rows = content.split('\n').filter(line => /^\| R\d{2} \|/.test(line));
const ids = rows.map(row => row.split('|')[1].trim());
assert.equal(rows.length, 18);
assert.equal(new Set(ids).size, 18);
for (const row of rows) {
  const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
  assert.equal(cells.length, 7);
  assert.ok(cells.every(Boolean));
  assert.match(cells[1], /^[A-F]$/);
  assert.match(cells[2], /^P[012]$/);
}
console.log('需求矩阵验证：18项，ID唯一、来源/验收/状态完整。');
