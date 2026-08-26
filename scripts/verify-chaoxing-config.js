#!/usr/bin/env node

/**
 * 超星OAuth配置验证脚本
 * 
 * 用途：
 * - 验证环境变量配置的完整性和正确性
 * - 在部署前快速检查配置问题
 * - 提供清晰的错误提示和修复建议
 * 
 * 运行：node scripts/verify-chaoxing-config.js
 */

const REQUIRED_VARS = {
  ENABLE_CHAOXING_AUTH: {
    required: true,
    validate: (val) => val === 'true' || val === 'false',
    message: '必须设置为 true 或 false'
  },
  CHAOXING_APPID: {
    required: (env) => env.ENABLE_CHAOXING_AUTH === 'true',
    validate: (val) => val && val.length >= 32,
    message: '必须是超星分配的32位以上字符串'
  },
  CHAOXING_SECRET: {
    required: (env) => env.ENABLE_CHAOXING_AUTH === 'true',
    validate: (val) => val && val.length >= 8,
    message: '必须是超星分配的密钥，长度至少8位',
    sensitive: true
  },
  CHAOXING_FIDS: {
    required: (env) => env.ENABLE_CHAOXING_AUTH === 'true',
    validate: (val) => {
      if (!val) return false;
      const fids = val.split(',').map(item => item.trim()).filter(Boolean);
      return fids.length > 0 && fids.every(fid => {
        const [id] = fid.split(':');
        return /^\d+$/.test(id.trim());
      });
    },
    message: '格式：数字FID（如 1024）或 FID:名称（如 1024:武汉大学），多个用逗号分隔'
  },
  CHAOXING_REDIRECT_URI: {
    required: false, // Can be auto-generated
    validate: (val, env) => {
      if (!val && env.COZE_PROJECT_DOMAIN_DEFAULT) return true; // Auto-generated
      if (!val) return false;
      try {
        const url = new URL(val);
        return url.protocol === 'https:' && url.pathname === '/api/auth/callback/chaoxing';
      } catch {
        return false;
      }
    },
    message: '必须是完整HTTPS URL，路径为 /api/auth/callback/chaoxing；或留空由 COZE_PROJECT_DOMAIN_DEFAULT 自动生成'
  },
  COZE_PROJECT_DOMAIN_DEFAULT: {
    required: (env) => env.ENABLE_CHAOXING_AUTH === 'true' && !env.CHAOXING_REDIRECT_URI,
    validate: (val) => {
      if (!val) return false;
      const normalized = val.startsWith('http') ? val : `https://${val}`;
      try {
        new URL(normalized);
        return true;
      } catch {
        return false;
      }
    },
    message: '生产环境必须配置，格式如 https://your-app.coze.site 或 your-app.coze.site'
  }
};

function getEnv(key) {
  return process.env[key]?.trim() || '';
}

function checkRequired(key, rule, env) {
  if (typeof rule.required === 'function') {
    return rule.required(env);
  }
  return rule.required;
}

function validateConfig() {
  const errors = [];
  const warnings = [];
  const env = {};

  // Load environment
  for (const key of Object.keys(REQUIRED_VARS)) {
    env[key] = getEnv(key);
  }

  console.log('🔍 验证超星OAuth配置...\n');

  // Check each variable
  for (const [key, rule] of Object.entries(REQUIRED_VARS)) {
    const value = env[key];
    const isRequired = checkRequired(key, rule, env);

    if (isRequired && !value) {
      errors.push(`❌ ${key}: 缺失（${rule.message}）`);
      continue;
    }

    if (value && rule.validate && !rule.validate(value, env)) {
      errors.push(`❌ ${key}: 格式错误（${rule.message}）`);
      continue;
    }

    if (value) {
      const display = rule.sensitive ? `${value.slice(0, 4)}****${value.slice(-4)}` : value;
      console.log(`✅ ${key}: ${display}`);
    } else if (!isRequired) {
      console.log(`⚠️  ${key}: 未配置（可选）`);
    }
  }

  // Additional checks
  console.log('\n🔍 额外检查...\n');

  // Check callback URI consistency
  if (env.ENABLE_CHAOXING_AUTH === 'true') {
    let effectiveCallback;
    if (env.CHAOXING_REDIRECT_URI) {
      effectiveCallback = env.CHAOXING_REDIRECT_URI;
      console.log(`📍 回调地址（显式配置）: ${effectiveCallback}`);
    } else if (env.COZE_PROJECT_DOMAIN_DEFAULT) {
      const domain = env.COZE_PROJECT_DOMAIN_DEFAULT.startsWith('http') 
        ? env.COZE_PROJECT_DOMAIN_DEFAULT 
        : `https://${env.COZE_PROJECT_DOMAIN_DEFAULT}`;
      effectiveCallback = `${domain}/api/auth/callback/chaoxing`;
      console.log(`📍 回调地址（自动生成）: ${effectiveCallback}`);
    } else {
      errors.push('❌ 无法确定回调地址：CHAOXING_REDIRECT_URI 和 COZE_PROJECT_DOMAIN_DEFAULT 都未配置');
    }

    if (effectiveCallback) {
      if (!effectiveCallback.startsWith('https://')) {
        warnings.push(`⚠️  回调地址未使用HTTPS（生产环境必须使用HTTPS）: ${effectiveCallback}`);
      }
      console.log(`\n⚠️  请确认该回调地址已在超星开放平台后台登记（必须逐字符一致）:\n   ${effectiveCallback}\n`);
    }

    // Check teacher UIDs
    const teacherUids = env.CHAOXING_TEACHER_UIDS;
    if (!teacherUids) {
      warnings.push('⚠️  CHAOXING_TEACHER_UIDS 未配置，所有用户将只有学生权限');
    } else {
      const uids = teacherUids.split(',').map(uid => uid.trim()).filter(Boolean);
      console.log(`👨‍🏫 教师UID白名单: ${uids.length} 个（${uids.join(', ')}）`);
    }

    // Check Supabase
    if (!env.COZE_SUPABASE_URL || !env.COZE_SUPABASE_ANON_KEY || !env.COZE_SUPABASE_SERVICE_ROLE_KEY) {
      errors.push('❌ Supabase 配置缺失（COZE_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY）');
    } else {
      console.log('✅ Supabase 配置完整');
    }
  }

  // Print results
  console.log('\n' + '='.repeat(60));
  
  if (env.ENABLE_CHAOXING_AUTH !== 'true') {
    console.log('\n📢 超星认证未启用（ENABLE_CHAOXING_AUTH=false）');
    console.log('   如需启用，请配置所有必需变量并设置 ENABLE_CHAOXING_AUTH=true\n');
    return 0;
  }

  if (warnings.length > 0) {
    console.log('\n⚠️  警告:\n');
    warnings.forEach(w => console.log(`   ${w}`));
  }

  if (errors.length > 0) {
    console.log('\n❌ 配置错误:\n');
    errors.forEach(e => console.log(`   ${e}`));
    console.log('\n请修复以上错误后再部署。\n');
    return 1;
  }

  console.log('\n✅ 配置验证通过！\n');
  console.log('📋 部署前清单:');
  console.log('   1. 确认回调地址已在超星后台登记');
  console.log('   2. 确认 CHAOXING_SECRET 已存储在密钥管理中');
  console.log('   3. 准备测试学生和教师账号');
  console.log('   4. 部署后立即进行登录测试');
  console.log();

  return 0;
}

// Run validation
process.exit(validateConfig());
