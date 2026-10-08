import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest, NextResponse } from 'next/server';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { GET as getResource } from '@/app/api/cases/[id]/resource/route';
import { GET as getResources } from '@/app/api/cases/[id]/resources/route';
import { PREVIEW_COOKIE, setPreviewCookie } from '@/lib/preview-auth';
import { getTeacherCaseResourceRoot } from '@/lib/teacher-case-resources';

const id = 'teacher-支气管哮喘';

function request(url: string, role: 'student' | 'teacher'): NextRequest {
  const response = NextResponse.json({});
  setPreviewCookie(response, role);
  const cookie = response.cookies.get(PREVIEW_COOKIE);
  return new NextRequest(url, { headers: { cookie: `${PREVIEW_COOKIE}=${cookie?.value}` } });
}

test('教师清单和病例目录双向覆盖，编码ID和异名均可关联资料', () => {
  assert.equal(TEACHER_CASE_CATALOG.length, 70);
  assert.equal(TEACHER_CASE_CATALOG.filter((item) => item.source === 'list').length, 54);
  assert.equal(TEACHER_CASE_CATALOG.filter((item) => item.status === 'materials-indexed').length, 37);
  assert.equal(TEACHER_CASE_CATALOG.filter((item) => item.status === 'catalog-only').length, 17);
  assert.equal(TEACHER_CASE_CATALOG.filter((item) => item.status === 'folder-only').length, 16);
  assert.equal(new Set(TEACHER_CASE_CATALOG.map((item) => item.id)).size, 70);
  assert.equal(getTeacherCaseResourceRoot('teacher-../outside'), null);
  assert.equal(getTeacherCaseResourceRoot(encodeURIComponent(id)), getTeacherCaseResourceRoot(id));
  assert.equal(getTeacherCaseResourceRoot('teacher-肺炎支原体性肺炎'), getTeacherCaseResourceRoot('teacher-肺炎支原体肺炎'));
});

test('登录学生可访问病例资料，文档提供脱敏文本，未登录和越界请求被拒绝', async () => {
  const oldPreview = process.env.ENABLE_UI_PREVIEW;
  const oldRoot = process.env.PEDIATRICS_KNOWLEDGE_ROOT;
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pediatrics-resources-'));
  process.env.ENABLE_UI_PREVIEW = 'true';
  process.env.PEDIATRICS_KNOWLEDGE_ROOT = temp;
  try {
    const caseRoot = path.join(temp, '儿科常见病', '呼吸系统疾病', '支气管哮喘');
    await mkdir(caseRoot, { recursive: true });
    await writeFile(path.join(caseRoot, 'sample.jpg'), Buffer.from([1, 2, 3, 4]));
    await writeFile(path.join(caseRoot, 'sample.doc'), Buffer.from('原始姓名：测试身份'));
    await mkdir(path.join(temp, 'teaching-cases'));
    await writeFile(path.join(temp, 'teaching-cases', `${id}.json`), JSON.stringify({ caseId: id, sourceName: '支气管哮喘', sourceDocument: '病例正文', age: '9岁', sex: '男', complaint: '咳嗽3天',
      sections: { history: '咳嗽3天。既往无药物过敏史。', exam: '双肺哮鸣音。', tests: '血常规正常。', diagnosis: '支气管哮喘', plan: '原病例诊疗经过' },
      vitals: { temperature: 36.5, heartRate: 90, respiratoryRate: 22, spo2: 96 }, documents: [{ source: 'sample.doc', text: '[身份信息已隐去]。咳嗽3天。', sha256: 'fixture' }] }));
    await writeFile(path.join(temp, 'outside.jpg'), Buffer.from([9]));
    const context = { params: Promise.resolve({ id }) };
    assert.equal((await getResources(new NextRequest(`http://localhost/api/cases/${id}/resources`), context)).status, 401);
    assert.equal((await getResources(request(`http://localhost/api/cases/${id}/resources`, 'student'), context)).status, 200);
    const listing = await getResources(request(`http://localhost/api/cases/${id}/resources`, 'teacher'), context);
    assert.equal(listing.status, 200);
    const payload = await listing.json();
    assert.ok(payload.data.some((item: { path: string }) => item.path === 'sample.jpg'));
    const encodedListing = await getResources(request(`http://localhost/api/cases/${encodeURIComponent(id)}/resources`, 'teacher'), { params: Promise.resolve({ id: encodeURIComponent(id) }) });
    assert.equal(encodedListing.status, 200);
    assert.equal((await encodedListing.json()).data.length, 2);
    const fileUrl = `http://localhost/api/cases/${id}/resource?path=sample.jpg`;
    assert.equal((await getResource(request(fileUrl, 'student'), context)).status, 200);
    const document = await getResource(request(`http://localhost/api/cases/${id}/resource?path=sample.doc`, 'student'), context);
    assert.equal(document.status, 200);
    assert.equal(await document.text(), '[身份信息已隐去]。咳嗽3天。');
    const teacherRequest = request(fileUrl, 'teacher');
    teacherRequest.headers.set('range', 'bytes=1-2');
    const file = await getResource(teacherRequest, context);
    assert.equal(file.status, 206);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from([2, 3]));
    const outside = await getResource(request(`http://localhost/api/cases/${id}/resource?path=${encodeURIComponent('../../../outside.jpg')}`, 'teacher'), context);
    assert.equal(outside.status, 404);
  } finally {
    await rm(temp, { recursive: true, force: true });
    if (oldPreview === undefined) delete process.env.ENABLE_UI_PREVIEW; else process.env.ENABLE_UI_PREVIEW = oldPreview;
    if (oldRoot === undefined) delete process.env.PEDIATRICS_KNOWLEDGE_ROOT; else process.env.PEDIATRICS_KNOWLEDGE_ROOT = oldRoot;
  }
});
