import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpandableNote } from '@/components/expandable-note';

/**
 * C3「小字太多」整改契约：说明类文字统一收进可展开备注，首屏只留触发器。
 * 展开态是纯前端交互，这里用静态渲染验证「默认收起 + 正文已在 DOM + 无障碍属性齐全」，
 * 并以源码断言锁住三处接线（训练页说明、阶段提示、报告说明）与已废弃的 AI 补全口径。
 */

function note(props: Partial<Omit<ComponentProps<typeof ExpandableNote>, 'children'>> = {}, body = '评分口径说明正文') {
  return renderToStaticMarkup(createElement(ExpandableNote, { label: '评分口径', ...props }, createElement('p', null, body)));
}

const projectRoot = resolve(__dirname, '..');
const readSource = (relativePath: string) => readFileSync(resolve(projectRoot, relativePath), 'utf8');

test('默认收起：触发器 aria-expanded=false，浮层 hidden，首屏不铺小字', () => {
  const html = note();
  assert.match(html, /<button[^>]*aria-expanded="false"/);
  assert.match(html, /<div[^>]*role="note"[^>]*hidden=""/, '说明浮层必须默认隐藏，否则等于没收纳');
});

test('正文仍在 DOM 内，展开无需二次请求；浮层带 role=note 与同名 aria-label', () => {
  const html = note({}, '可评价满分不含无法评价项');
  assert.ok(html.includes('可评价满分不含无法评价项'), '展开后直接显示，不依赖异步加载');
  assert.match(html, /role="note"[^>]*aria-label="评分口径"/);
  const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
  assert.ok(controls && html.includes(`id="${controls}"`), 'aria-controls 必须指向真实存在的浮层 id');
});

test('icon 变体用 aria-label 承载文字，pill 变体把标签显示出来', () => {
  const icon = note({ variant: 'icon' });
  assert.match(icon, /<button[^>]*aria-label="评分口径"/);
  assert.ok(!icon.includes('>评分口径<'), 'icon 变体不在触发器上重复渲染文字');
  const pill = note();
  assert.ok(pill.includes('评分口径'), 'pill 变体的触发器文字可见');
});

test('align 控制浮层方向，避免靠左触发器的浮层溢出屏幕', () => {
  assert.match(note(), /class="note-panel-wrap"/, '默认右对齐（贴工具栏右侧）');
  assert.match(note({ align: 'start' }), /class="note-panel-wrap note-panel-start"/);
});

test('className 透传，便于按位置补外边距', () => {
  assert.match(note({ className: 'note-spaced' }), /class="expandable-note note-spaced"/);
});

test('训练页说明改为如实口径，不再声称缺项由 AI 补全', () => {
  const source = readSource('src/components/training-workspace.tsx');
  assert.ok(!source.includes('可由AI补全'), 'B5 已关闭生成通道，旧文案会误导学生');
  assert.ok(source.includes('本病例资料未提供该项结果'), '必须说明资料未提供时的真实行为');
  assert.match(source, /<ExpandableNote variant="icon" label="教学说明">/);
});

test('阶段提示：查体关联项与诊断依据的核验说明收进备注，阻塞原因保持常显', () => {
  const source = readSource('src/components/training-workspace.tsx');
  assert.match(source, /<ExpandableNote label="选项从哪来？" align="start">/);
  assert.match(source, /<ExpandableNote label="怎么关联？" align="start">/);
  assert.match(source, /examEvidenceCount === 0 && <p className="form-hint" role="note">完成至少一项有效查体操作并勾选关联项后才能提交观察。/, '提交被阻塞的原因不能藏进折叠备注');
});

test('报告说明：量表与口径收进备注，未评分说明仍常显', () => {
  const source = readSource('src/components/report-view.tsx');
  assert.match(source, /<ExpandableNote label="评分口径与量表" align="start" className="note-spaced">/);
  assert.match(source, /unscoredReason && <p[^>]*role="note">未评分说明/, '没有分数时必须直接给出原因');
  assert.ok(!source.includes('fontSize: 13, opacity: 0.75 }}>评分量表'), '旧的长串内联小字已移除');
});

test('样式：旧 .training-info 规则下线，备注浮层不改变周边版面高度', () => {
  const css = readSource('src/app/globals.css');
  assert.ok(!css.includes('.training-info'), '旧 details 说明面板样式已无引用');
  assert.match(css, /\.note-panel-wrap \{ position:absolute;/);
  assert.match(css, /\.note-panel \{[^}]*font-size:13px;/, '展开后正文不小于 13px');
  assert.match(css, /\.training-toolbar > \.expandable-note,/);
});
