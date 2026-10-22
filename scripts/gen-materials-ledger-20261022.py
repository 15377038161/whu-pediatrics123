#!/usr/bin/env python3
# 阶段1材料总账受限口径登记生成器（一次性，只读）：
# 输入：outputs/case-library-review/20261021/scope.json（阶段1范围表）、docs/case-snapshot-versions.json（真实库只读快照）
# 输出：outputs/case-library-review/20261021/materials.jsonl（逐例受限登记 70 行）、materials-inventory.json（受限登记汇总）
# 口径：knowledge/ 原件目录不在沙箱（gitignore，沙箱重置丢失），文件级登记（路径/哈希/格式，J01 级）无法建立；
# 本登记只含：目录计数快照（生成器历史口径）+ DB facts/answers 版本计数（只读查询 2026-10-22）+ 缺失如实标注。
# 语义核验覆盖率 0%：本登记未查看、播放、阅读任何材料内容。
import json
from pathlib import Path

OUT = Path('outputs/case-library-review/20261021')
scope = json.loads((OUT / 'scope.json').read_text(encoding='utf-8'))
snapshot = json.loads(Path('docs/case-snapshot-versions.json').read_text(encoding='utf-8'))

versions_by_case: dict[str, list[str]] = {}
for v in snapshot['versions']:
    versions_by_case.setdefault(v['case_id' if 'case_id' in v else 'caseId'], []).append(v['version'])

# DB 只读盘点结果（2026-10-22，db_execute 工具执行）：
# - case_snapshot_facts：56 行 / 53 唯一 case_id
# - case_snapshot_answers：56 行 / 53 唯一 case_id
# - facts 载荷设计上不含媒体数组（buildFactsPayload 防透题排除，见 src/lib/case-snapshot.ts）
# - sections 内嵌引用形态全表仅 1 处（见 inventory.dbEmbeddedRefFinding）
db_inventory = {
    'queriedAt': '2026-10-22',
    'queryMode': '只读（SELECT），未写入库',
    'caseSnapshotFacts': {'rows': 56, 'distinctCases': 53},
    'caseSnapshotAnswers': {'rows': 56, 'distinctCases': 53},
    'factsMediaArray': '不存在（设计上排除：buildFactsPayload 不含 media/documents，防透题）',
    'dbEmbeddedRefFinding': {
        'caseId': 'teacher-心律失常-室上性心动过速',
        'version': '637b5db0183de8f0',
        'section': 'history',
        'finding': '全表唯一 1 处内嵌引用形态：病史段末尾以未闭合外链图片引用 ![](https://p. 截断结尾（URL 不完整、无闭括号）。既是截断缺陷证据，也不构成可用媒体引用；语义与原始资料归属待教师核实。',
    },
}

rows = []
for r in scope['rows']:
    source_id = r['sourceCaseId']
    versions = versions_by_case.get(source_id, []) if source_id else []
    rows.append({
        'publicCaseId': r['publicCaseId'],
        'sourceCaseId': source_id,
        'name': r['name'],
        'catalogMediaCount': r['mediaCount'],
        'catalogDocumentCount': r['documentCount'],
        'countBasis': '教师目录生成器历史口径（scripts/gen-public-case-catalog.mjs 消费 TEACHER_CASE_CATALOG）；knowledge/ 不在沙箱，无法 readdir 复核',
        'dbFactVersions': versions,
        'knowledgeDirMissing': True,
        'fileLevelLedger': '无法建立（原件不在沙箱：路径/哈希/格式/读取状态 J01 级字段不可登记；原件回传后重盘）',
        'semanticVerification': 'not-attempted（未查看/播放/阅读任何材料内容）',
    })

inventory = {
    'generatedAt': '2026-10-22',
    'scope': '阶段1材料总账·受限登记口径（任务书 v1.1 第 9 节第一阶段 + 第 11 节覆盖率口径）',
    'restrictions': [
        'knowledge/ 原件目录不在沙箱（.gitignore 私有目录，沙箱重置丢失）：文件级总账（J01）无法建立，目录计数为生成器历史口径快照，未经 readdir 复核',
        'DB facts 载荷设计上不含媒体数组（防透题）：DB 侧媒体引用盘点结论 = 无媒体引用字段 + 全表仅 1 处截断外链形态（见 dbEmbeddedRefFinding）',
        'teaching-media 转码目录（getPlayableTeacherResource，.avi/.mov→mp4）同在 knowledge/ 下，同样缺失',
    ],
    'dbInventory': db_inventory,
    'totals': {
        'cases': len(rows),
        'catalogMediaCountTotal': sum(r['catalogMediaCount'] for r in rows),
        'catalogDocumentCountTotal': sum(r['catalogDocumentCount'] for r in rows),
        'casesWithDbFacts': sum(1 for r in rows if r['dbFactVersions']),
        'casesWithoutSource': sum(1 for r in rows if not r['sourceCaseId']),
    },
    'coverage': {
        '范围覆盖率': '70/70 首页条目已登记（100%）',
        '材料登记率': '受限口径：70/70 条目已登记目录计数与 DB 版本计数；文件级登记 0/29309 媒体 + 0/174 文档（原件不在沙箱，无法建立，如实登记为缺失而非 0%）',
        '材料安置率': '未开始（需要文件级总账，原件回传后执行）',
        '语义核验覆盖率': '0%（未查看、播放或阅读任何材料内容；仅目录计数与 DB 元数据对账）',
    },
}

(OUT / 'materials.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')
(OUT / 'materials-inventory.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'rows': len(rows), 'totals': inventory['totals'], 'coverage': inventory['coverage']}, ensure_ascii=False, indent=2))
