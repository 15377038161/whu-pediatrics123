import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  ENTRY_STATUS_LABELS,
  EXAM_STATIONS,
  KNOWN_GAPS,
  PEDIATRIC_EXTRAS,
  type StationEntry,
} from '../src/domain/exam-stations';

/** 把站内入口的 href 映射到 Next.js App Router 的路由文件，验证入口不是死链。 */
function routeFileExists(href: string): boolean {
  const pathname = href.split('?')[0].replace(/^\//, '');
  const base = path.join(process.cwd(), 'src', 'app', pathname);
  return existsSync(path.join(base, 'page.tsx')) || existsSync(path.join(base, 'route.ts'));
}

const allEntries: StationEntry[] = [
  ...EXAM_STATIONS.flatMap((station) => station.entries),
  ...PEDIATRIC_EXTRAS.entries,
];

test('三站齐全且 id 唯一', () => {
  assert.equal(EXAM_STATIONS.length, 3);
  assert.deepEqual(EXAM_STATIONS.map((s) => s.id), ['station-1', 'station-2', 'station-3']);
  assert.equal(new Set(EXAM_STATIONS.map((s) => s.name)).size, 3);
});

test('每个站内入口都指向真实存在的路由，不留死链', () => {
  for (const entry of allEntries) {
    assert.ok(routeFileExists(entry.href), `入口 ${entry.href}（${entry.label}）找不到对应的 page.tsx`);
  }
});

test('状态标签覆盖三种状态，且 partial/missing 必须写清缺口', () => {
  assert.deepEqual(Object.keys(ENTRY_STATUS_LABELS).sort(), ['missing', 'partial', 'ready']);
  for (const entry of allEntries) {
    assert.ok(ENTRY_STATUS_LABELS[entry.status], `未定义状态标签：${entry.status}`);
    assert.ok(entry.detail.trim().length >= 10, `入口「${entry.label}」的 detail 过于笼统`);
    if (entry.status === 'partial' || entry.status === 'missing') {
      assert.ok(entry.detail.trim().length >= 15, `未完成项「${entry.label}」必须写清缺什么`);
    }
  }
});

test('每一站都写明官方考法与本平台缺口', () => {
  for (const station of EXAM_STATIONS) {
    assert.ok(station.officialScope.trim().length > 20, `${station.name} 缺少考什么`);
    assert.ok(station.officialMethod.trim().length > 10, `${station.name} 缺少怎么考`);
    assert.ok(station.gap.trim().length > 10, `${station.name} 缺少缺口说明`);
    assert.ok(station.entries.length > 0, `${station.name} 没有入口`);
  }
});

test('科室加练不混入三站，且必须声明不属于执医考项', () => {
  assert.ok(!EXAM_STATIONS.some((s) => s.name.includes('加练')));
  assert.match(PEDIATRIC_EXTRAS.note, /不作为独立考项|非执医三站/);
  assert.ok(PEDIATRIC_EXTRAS.entries.length >= 2);
});

test('已知缺口清单非空且每条都具体', () => {
  assert.ok(KNOWN_GAPS.length >= 4);
  for (const gap of KNOWN_GAPS) {
    assert.ok(gap.trim().length >= 12, `缺口描述过于笼统：${gap}`);
  }
});

test('入口不得重复链接同一标签', () => {
  const labels = allEntries.map((entry) => entry.label);
  assert.equal(new Set(labels).size, labels.length);
});