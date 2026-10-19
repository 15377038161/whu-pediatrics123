/** 真实平台只读权限回归；凭据仅从受限文件读取，复用既有测试账号，不 signup。 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const configSchema=z.object({
  appOrigin:z.string().url(), supabaseUrl:z.string().url(), anonKey:z.string().min(1), tenantId:z.string().min(1),
  student:z.object({email:z.literal('student-test@luojia.dev'),password:z.string().min(1)}),
  teacher:z.object({email:z.literal('teacher-test@luojia.dev'),password:z.string().min(1)}),
  otherUserId:z.string().uuid(), otherClassId:z.string().uuid().optional(),
});
async function main() {
  const index=process.argv.indexOf('--cred-file');
  if(index<0 || !process.argv[index+1]) throw new Error('CREDENTIAL_FILE_REQUIRED');
  const file=process.argv[index+1];
  if(process.platform!=='win32' && ((await stat(file)).mode&0o077)!==0) throw new Error('CREDENTIAL_FILE_PERMISSIONS');
  const config=configSchema.parse(JSON.parse(await readFile(file,'utf8')));
  const origin=new URL(config.appOrigin);
  if(origin.protocol!=='https:' || !origin.hostname.endsWith('.cxiagents.com')) throw new Error('TARGET_NOT_ALLOWED');
  const clients:SupabaseClient[]=[];
  const checks:{name:string;status:number;pass:boolean}[]=[];
  const tokens:Record<string,string>={};
  try {
    for(const role of ['student','teacher'] as const) {
      const db=createClient(config.supabaseUrl,config.anonKey,{global:{headers:{'X-Instance-ID':config.tenantId}},auth:{persistSession:false,autoRefreshToken:false}});
      clients.push(db);
      const result=await db.auth.signInWithPassword(config[role]);
      if(result.error || !result.data.session) throw new Error('TEST_ACCOUNT_LOGIN_FAILED');
      tokens[role]=result.data.session.access_token;
    }
    async function check(name:string,path:string,expected:number,role?:'student'|'teacher',body?:object) {
      const response=await fetch(new URL(path,origin),{method:body?'POST':'GET',headers:{'content-type':'application/json',...(role?{Authorization:`Bearer ${tokens[role]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
      const payload=await response.json().catch(()=>null);
      checks.push({name,status:response.status,pass:response.status===expected});
      assert.equal(response.status,expected,name);
      return payload;
    }
    await check('anonymous_classes','/api/classes',401);
    await check('anonymous_teacher_access','/api/teacher/access',401);
    for(const role of ['student','teacher'] as const) {
      const me=await check(`${role}_me`,'/api/auth/me',200,role);
      assert.equal(me.data.user.role,role);
      await check(`${role}_no_admin_access`,'/api/teacher/access',403,role);
      const workspace=await check(`${role}_workspace`,'/api/classes',200,role);
      assert.equal(workspace.data.isAdmin,false);
      if(role==='student') { assert.deepEqual(workspace.data.members,[]); assert.deepEqual(workspace.data.roster,[]); }
    }
    await check('student_cannot_create','/api/classes',403,'student',{action:'create',name:'权限负测，不应创建'});
    await check('student_cannot_review','/api/classes',403,'student',{action:'review',requestId:'00000000-0000-4000-8000-000000000000',approve:false});
    await check('teacher_scoped_stats','/api/teacher/usage-stats',200,'teacher');
    await check('teacher_other_user_stats_denied',`/api/teacher/usage-stats?userId=${config.otherUserId}`,403,'teacher');
    if(config.otherClassId) await check('teacher_other_class_denied',`/api/classes?classId=${config.otherClassId}`,403,'teacher');
    console.log(JSON.stringify({checks,passed:checks.length,failed:0}));
  } finally {
    const revoked=await Promise.all(clients.map(async client=>{try{return !(await client.auth.signOut({scope:'global'})).error;}catch{return false;}}));
    console.log(JSON.stringify({testRefreshSessionsRevoked:revoked.every(Boolean)}));
    // signOut 撤销 refresh 会话，既有 access JWT 仍受原 TTL 约束。
  }
}
main().catch(()=>{console.error('CLASSROOM_ACCESS_VERIFICATION_FAILED');process.exitCode=1;});
