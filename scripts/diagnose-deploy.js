#!/usr/bin/env node

/**
 * Coze 部署问题诊断脚本
 * 
 * 用途：检查可能导致部署失败的常见问题
 * 运行：node scripts/diagnose-deploy.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Coze 部署诊断工具\n');
console.log('='.repeat(60) + '\n');

const issues = [];
const warnings = [];

// 1. 检查 Git 状态
console.log('1️⃣  检查 Git 状态...');
try {
  const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
  console.log(`   ✅ 当前分支: ${branch}`);
  
  const status = execSync('git status --short', { encoding: 'utf8' }).trim();
  if (status) {
    warnings.push('工作区有未提交的更改');
    console.log('   ⚠️  工作区有未提交的更改');
  } else {
    console.log('   ✅ 工作区干净');
  }
  
  const unpushed = execSync('git log origin/main..HEAD --oneline', { encoding: 'utf8' }).trim();
  if (unpushed) {
    const lines = unpushed.split('\n').length;
    warnings.push(`有 ${lines} 个未推送的提交`);
    console.log(`   ⚠️  有 ${lines} 个未推送的提交`);
  } else {
    console.log('   ✅ 所有提交已推送');
  }
} catch (e) {
  issues.push('无法读取 Git 状态: ' + e.message);
  console.log('   ❌ Git 状态检查失败');
}

// 2. 检查 Git 嵌套
console.log('\n2️⃣  检查 Git 嵌套...');
try {
  const gitDirs = execSync('find . -name ".git" -type d', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(dir => dir !== './.git');
  
  if (gitDirs.length > 0) {
    issues.push(`发现 ${gitDirs.length} 个嵌套 .git 目录`);
    console.log(`   ❌ 发现 ${gitDirs.length} 个嵌套 .git 目录:`);
    gitDirs.forEach(dir => console.log(`      - ${dir}`));
  } else {
    console.log('   ✅ 无嵌套 .git 目录');
  }
} catch (e) {
  console.log('   ✅ 无嵌套 .git 目录');
}

// 3. 检查 Git 子模块
console.log('\n3️⃣  检查 Git 子模块...');
const gitmodulesPath = path.join(process.cwd(), '.gitmodules');
if (fs.existsSync(gitmodulesPath)) {
  warnings.push('.gitmodules 文件存在');
  console.log('   ⚠️  检测到 .gitmodules 文件');
} else {
  console.log('   ✅ 无 Git 子模块');
}

// 4. 检查 node_modules
console.log('\n4️⃣  检查 node_modules...');
const nodeModulesPath = path.join(process.cwd(), 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  const nodeModulesGit = path.join(nodeModulesPath, '.git');
  if (fs.existsSync(nodeModulesGit)) {
    issues.push('node_modules 中包含 .git 目录');
    console.log('   ❌ node_modules 中包含 .git 目录');
  } else {
    console.log('   ✅ node_modules 正常');
  }
  
  // 检查 node_modules 是否在 .gitignore 中
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    if (!gitignore.includes('node_modules')) {
      warnings.push('node_modules 未在 .gitignore 中');
      console.log('   ⚠️  node_modules 未在 .gitignore 中');
    }
  }
} else {
  console.log('   ℹ️  node_modules 不存在（正常）');
}

// 5. 检查必需文件
console.log('\n5️⃣  检查必需文件...');
const requiredFiles = [
  'package.json',
  'pnpm-lock.yaml',
  '.coze',
  'next.config.ts'
];

for (const file of requiredFiles) {
  const filePath = path.join(process.cwd(), file);
  if (fs.existsSync(filePath)) {
    console.log(`   ✅ ${file}`);
  } else {
    issues.push(`缺少必需文件: ${file}`);
    console.log(`   ❌ ${file} 缺失`);
  }
}

// 6. 检查 .coze 配置
console.log('\n6️⃣  检查 .coze 配置...');
const cozePath = path.join(process.cwd(), '.coze');
if (fs.existsSync(cozePath)) {
  const cozeContent = fs.readFileSync(cozePath, 'utf8');
  
  // 检查必需字段
  const requiredFields = ['project_type', 'sub_id', '[deploy]'];
  for (const field of requiredFields) {
    if (cozeContent.includes(field)) {
      console.log(`   ✅ ${field}`);
    } else {
      issues.push(`.coze 中缺少 ${field}`);
      console.log(`   ❌ ${field} 缺失`);
    }
  }
} else {
  issues.push('.coze 文件不存在');
  console.log('   ❌ .coze 文件不存在');
}

// 7. 检查大文件
console.log('\n7️⃣  检查大文件...');
try {
  const largeFiles = execSync(
    'find . -type f -size +10M ! -path "./node_modules/*" ! -path "./.git/*" 2>/dev/null',
    { encoding: 'utf8' }
  ).trim().split('\n').filter(Boolean);
  
  if (largeFiles.length > 0) {
    warnings.push(`发现 ${largeFiles.length} 个大文件（>10MB）`);
    console.log(`   ⚠️  发现 ${largeFiles.length} 个大文件（>10MB）:`);
    largeFiles.forEach(file => {
      try {
        const size = fs.statSync(file).size;
        const sizeMB = (size / 1024 / 1024).toFixed(2);
        console.log(`      - ${file} (${sizeMB} MB)`);
      } catch (e) {
        // 忽略
      }
    });
  } else {
    console.log('   ✅ 无过大文件');
  }
} catch (e) {
  console.log('   ✅ 无过大文件');
}

// 8. 检查 .gitignore
console.log('\n8️⃣  检查 .gitignore...');
const gitignorePath = path.join(process.cwd(), '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  const expectedPatterns = [
    'node_modules/',
    '.next/',
    'dist/',
    '.env.local'
  ];
  
  for (const pattern of expectedPatterns) {
    if (gitignore.includes(pattern)) {
      console.log(`   ✅ ${pattern}`);
    } else {
      warnings.push(`.gitignore 中缺少 ${pattern}`);
      console.log(`   ⚠️  ${pattern} 未忽略`);
    }
  }
} else {
  warnings.push('.gitignore 不存在');
  console.log('   ⚠️  .gitignore 不存在');
}

// 9. 检查 Git 仓库大小
console.log('\n9️⃣  检查 Git 仓库大小...');
try {
  const gitSize = execSync('du -sh .git', { encoding: 'utf8' }).trim().split('\t')[0];
  console.log(`   ℹ️  .git 目录大小: ${gitSize}`);
  
  const sizeMatch = gitSize.match(/^(\d+(?:\.\d+)?)(M|G)/);
  if (sizeMatch) {
    const size = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2];
    if ((unit === 'M' && size > 100) || unit === 'G') {
      warnings.push(`.git 目录较大 (${gitSize})，可能影响部署速度`);
      console.log(`   ⚠️  .git 目录较大，可能影响部署速度`);
    }
  }
} catch (e) {
  console.log('   ℹ️  无法检查 .git 大小');
}

// 10. 检查环境变量配置
console.log('\n🔟  检查环境变量配置...');
const envExample = path.join(process.cwd(), '.env.example');
if (fs.existsSync(envExample)) {
  console.log('   ✅ .env.example 存在');
} else {
  warnings.push('.env.example 不存在');
  console.log('   ⚠️  .env.example 不存在');
}

const envLocal = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envLocal)) {
  warnings.push('.env.local 存在（应该在 .gitignore 中）');
  console.log('   ⚠️  .env.local 存在');
}

// 总结
console.log('\n' + '='.repeat(60));
console.log('\n📊 诊断总结:\n');

if (issues.length === 0 && warnings.length === 0) {
  console.log('✅ 未发现问题！项目可以部署。\n');
  process.exit(0);
}

if (issues.length > 0) {
  console.log('❌ 发现 ' + issues.length + ' 个严重问题:\n');
  issues.forEach((issue, i) => {
    console.log(`   ${i + 1}. ${issue}`);
  });
  console.log();
}

if (warnings.length > 0) {
  console.log('⚠️  发现 ' + warnings.length + ' 个警告:\n');
  warnings.forEach((warning, i) => {
    console.log(`   ${i + 1}. ${warning}`);
  });
  console.log();
}

console.log('💡 建议:\n');

if (issues.some(i => i.includes('嵌套'))) {
  console.log('   • 删除嵌套的 .git 目录:');
  console.log('     find . -name ".git" -type d ! -path "./.git" -exec rm -rf {} +');
  console.log();
}

if (warnings.some(w => w.includes('未推送'))) {
  console.log('   • 推送未提交的更改:');
  console.log('     git push origin main');
  console.log();
}

if (issues.some(i => i.includes('node_modules'))) {
  console.log('   • 确保 node_modules 在 .gitignore 中');
  console.log('   • 删除 node_modules/.git:');
  console.log('     rm -rf node_modules/.git');
  console.log();
}

console.log('   • 如果问题持续，尝试:');
console.log('     1. 清理 Git 缓存: git rm -r --cached .');
console.log('     2. 重新添加: git add .');
console.log('     3. 提交: git commit -m "chore: clean git cache"');
console.log('     4. 推送: git push origin main');
console.log();

process.exit(issues.length > 0 ? 1 : 0);
