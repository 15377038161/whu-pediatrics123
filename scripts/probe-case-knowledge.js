#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 病例→知识库映射探测脚本（v2）
 * - 查询词只用病例名（不带后缀），topK=5，阈值放宽 0.2
 * - 从召回内容中提取 "病例 ID: teacher-xxx" 与 p.cldisk.com 图片 URL 作为可追溯证据
 * 用法：NODE_PATH=/usr/local/lib/node_modules node scripts/probe-case-knowledge.js [输出路径]
 */
const fs = require('node:fs');
const path = require('node:path');
const { KnowledgeClient, Config } = require('coder-coding-dev-sdk');

const KB_DOC = '3821591';
const KB_IMAGE = '3821625';

const catalogSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/domain/teacher-case-catalog.ts'), 'utf8');
const linksSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/domain/teacher-case-links.ts'), 'utf8');

const items = [];
const blockRe = /\{\s*"id":\s*"([^"]+)"[\s\S]*?"name":\s*"([^"]+)"[\s\S]*?"category":\s*"([^"]+)"[\s\S]*?"folder":\s*(null|"[^"]*")[\s\S]*?"mediaCount":\s*(\d+),[\s\S]*?"documentCount":\s*(\d+),[\s\S]*?"status":\s*"([^"]+)",[\s\S]*?"source":\s*"([^"]+)"\s*\}/g;
let m;
while ((m = blockRe.exec(catalogSrc)) !== null) {
  items.push({ id: m[1], name: m[2], category: m[3], folder: m[4] === 'null' ? null : JSON.parse(m[4]), mediaCount: +m[5], documentCount: +m[6], status: m[7], source: m[8] });
}
const links = {};
const linkRe = /'([^']+)':\s*\{\s*sourceId:\s*'([^']+)',\s*relation:\s*'([^']+)'\s*\}/g;
while ((m = linkRe.exec(linksSrc)) !== null) {
  links[m[1]] = { sourceId: m[2], relation: m[3] };
}

function extractCaseIds(content) {
  if (!content) return [];
  const ids = new Set();
  const re = /teacher-[^\s，。、"”]+/g;
  let mm;
  while ((mm = re.exec(content)) !== null) ids.add(mm[0]);
  return [...ids];
}

function countImageUrls(content) {
  if (!content) return 0;
  return (content.match(/https:\/\/p\.cldisk\.com\/[^\s)!，。]+/g) || []).length;
}

async function probe(client, kbId, query) {
  const r = await client.recall({ query, knowledgeBaseIds: [kbId], topK: 5, recallThreshold: 0.2 });
  return r.results.map(item => ({
    title: item.title,
    snippet: (item.content || '').slice(0, 250),
    caseIds: extractCaseIds(item.content),
    imageUrls: countImageUrls(item.content),
  }));
}

(async () => {
  const client = new KnowledgeClient(new Config());
  const out = [];
  const failures = [];
  for (const item of items) {
    const entry = {
      caseId: item.id,
      caseName: item.name,
      category: item.category,
      folder: item.folder,
      status: item.status,
      source: item.source,
      linkedTo: links[item.id] || null,
      docRecall: [],
      imageRecall: [],
      docMatched: false,
      docMatchKind: null, // 'case-id' | 'name' 
      imageUrlsFound: 0,
    };
    try { entry.docRecall = await probe(client, KB_DOC, item.name); } catch (e) { failures.push([item.id, 'doc', e.message]); }
    try { entry.imageRecall = await probe(client, KB_IMAGE, item.name); } catch (e) { failures.push([item.id, 'image', e.message]); }
    entry.docMatched = entry.docRecall.some(r => r.caseIds.includes(item.id));
    if (entry.docMatched) entry.docMatchKind = 'case-id';
    else if (entry.docRecall.some(r => (r.title && r.title.includes(item.name)))) {
      entry.docMatched = true; entry.docMatchKind = 'title-name';
    }
    entry.imageUrlsFound = entry.docRecall.reduce((s, r) => s + r.imageUrls, 0);
    out.push(entry);
    process.stderr.write(`[probe] ${item.id} doc=${entry.docMatched}(${entry.docMatchKind || '-'}) imgs=${entry.imageUrlsFound}\n`);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    kbDoc: KB_DOC,
    kbImage: KB_IMAGE,
    totalCases: out.length,
    summary: {
      docDirect: out.filter(e => e.docMatched).length,
      withFolder: out.filter(e => e.folder).length,
      catalogOnly: out.filter(e => e.status === 'catalog-only').length,
      aliasedOrSubtype: out.filter(e => e.linkedTo).length,
      noSourceAtAll: out.filter(e => !e.folder && !e.linkedTo).map(e => e.caseId),
      failures,
    },
    cases: out,
  };
  const target = process.argv[2] || path.resolve(__dirname, '../docs/case-knowledge-map.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2));
  console.log('WROTE', target, 'total=', report.totalCases);
  console.log('SUMMARY', JSON.stringify(report.summary));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
