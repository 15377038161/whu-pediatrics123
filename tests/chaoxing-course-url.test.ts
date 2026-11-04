import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseChaoxingCourseUrl } from '../src/lib/chaoxing-course';

describe('学习通课程直达 URL', () => {
  it('仅接受有效的 HTTPS 地址', () => {
    assert.equal(parseChaoxingCourseUrl('https://mooc1.chaoxing.com/course/123.html'), 'https://mooc1.chaoxing.com/course/123.html');
    assert.equal(parseChaoxingCourseUrl('  https://i.chaoxing.com/base?t=course&id=123  '), 'https://i.chaoxing.com/base?t=course&id=123');
  });

  it('空值、非 HTTPS、凭据 URL 与非法地址均不渲染入口', () => {
    for (const value of [undefined, '', '   ', 'http://mooc1.chaoxing.com/course/123', 'javascript:alert(1)', 'https://user:pass@example.com/course', 'not-a-url']) {
      assert.equal(parseChaoxingCourseUrl(value), null);
    }
  });
});
