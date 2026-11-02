import assert from 'node:assert/strict';
import test from 'node:test';
import { platformForwardHeaders } from '@/lib/platform-forward-headers';
test('verified application JWT must not override the SDK service credential; trace context is retained',()=>{
 const h=new Headers({authorization:'Bearer synthetic-app-token','x-request-id':'fixture','cookie':'not-forwarded'});
 const result=platformForwardHeaders(h,'synthetic-app-token');
 assert.equal(result.authorization,undefined);assert.equal(result['x-request-id'],'fixture');assert.equal(result.cookie,undefined);
});
test('a distinct platform authorization is preserved, and sandbox application headers are not forwarded',()=>{
 const result=platformForwardHeaders(new Headers({authorization:'Bearer synthetic-platform-token','x-sandbox-authorization':'Bearer synthetic-app-token'}),'synthetic-app-token');
 assert.equal(result.authorization,'Bearer synthetic-platform-token');assert.equal(result['x-sandbox-authorization'],undefined);
});
