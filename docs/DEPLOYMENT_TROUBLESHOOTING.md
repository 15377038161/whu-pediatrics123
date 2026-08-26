# 部署错误排查指南

> **错误**: `code=200100013 message=Git 仓库异常，请检查是否有 git 嵌套等情况`

---

## 问题诊断

运行诊断脚本：

```bash
node scripts/diagnose-deploy.js
```

该脚本会自动检查：
- Git 嵌套问题
- Git 子模块
- 大文件
- 必需文件
- .gitignore 配置

---

## 常见原因与解决方案

### 1. Git 嵌套问题

**症状**: 项目中存在多个 .git 目录

**检查**:
```bash
find . -name ".git" -type d
```

应该只输出 `./.git`，如果有其他输出，说明存在嵌套。

**解决**:
```bash
# 删除嵌套的 .git 目录（保留根目录的）
find . -name ".git" -type d ! -path "./.git" -exec rm -rf {} +

# 提交更改
git add .
git commit -m "chore: 移除嵌套 git 目录"
git push origin main
```

### 2. node_modules 未被忽略

**症状**: node_modules 被 Git 追踪

**检查**:
```bash
git ls-files node_modules/ | head -5
```

如果有输出，说明 node_modules 被追踪了。

**解决**:
```bash
# 确保 .gitignore 包含 node_modules/
echo "node_modules/" >> .gitignore

# 从 Git 中移除但保留文件
git rm -r --cached node_modules/

# 提交更改
git add .gitignore
git commit -m "chore: 从 Git 中移除 node_modules"
git push origin main
```

### 3. .next 或 dist 被追踪

**症状**: 构建产物被 Git 追踪

**检查**:
```bash
git ls-files .next/ dist/ | head -5
```

**解决**:
```bash
# 确保 .gitignore 包含构建目录
cat >> .gitignore << 'EOF'
.next/
dist/
EOF

# 从 Git 中移除
git rm -r --cached .next/ dist/

# 提交更改
git add .gitignore
git commit -m "chore: 从 Git 中移除构建产物"
git push origin main
```

### 4. Git 子模块问题

**症状**: 项目包含 .gitmodules 文件

**检查**:
```bash
ls -la .gitmodules
git submodule status
```

**解决**:
```bash
# 如果不需要子模块
git submodule deinit -f .
rm -rf .git/modules/*
rm .gitmodules

git add .
git commit -m "chore: 移除 Git 子模块"
git push origin main
```

### 5. 大文件问题

**症状**: 仓库包含大于 100MB 的文件

**检查**:
```bash
find . -type f -size +10M ! -path "./node_modules/*" ! -path "./.git/*"
```

**解决**:
```bash
# 方案 A: 如果文件应该被忽略
echo "<大文件路径>" >> .gitignore
git rm --cached <大文件路径>

# 方案 B: 如果文件已提交到历史
# 使用 git filter-branch 或 BFG Repo-Cleaner 清理历史

# 提交更改
git add .gitignore
git commit -m "chore: 从 Git 中移除大文件"
git push origin main
```

### 6. Git 缓存问题

**症状**: .gitignore 已更新但文件仍被追踪

**解决**:
```bash
# 清理 Git 缓存
git rm -r --cached .

# 重新添加所有文件（.gitignore 会生效）
git add .

# 提交更改
git commit -m "chore: 清理 Git 缓存"
git push origin main
```

### 7. 分支同步问题

**症状**: 本地分支与远程分支不同步

**检查**:
```bash
git status
git log origin/main..HEAD --oneline
```

**解决**:
```bash
# 推送所有未推送的提交
git push origin main

# 如果需要强制推送（⚠️ 谨慎使用）
# git push origin main --force
```

---

## 完整清理流程

如果以上方法都不奏效，尝试完整清理：

```bash
# 1. 备份当前代码（如果有未提交的重要更改）
cp -r /workspace/projects /tmp/projects-backup

# 2. 确保 .gitignore 完整
cat > .gitignore << 'EOF'
node_modules/
.next/
dist/
.env
.env.local
.env.*.local
*.log
.DS_Store
.preview
EOF

# 3. 清理 Git 缓存
git rm -r --cached .

# 4. 删除构建产物
rm -rf node_modules .next dist

# 5. 重新添加文件
git add .

# 6. 提交
git commit -m "chore: 完整清理 Git 缓存和忽略文件"

# 7. 推送
git push origin main

# 8. 重新安装依赖（不要提交）
pnpm install
```

---

## 验证修复

修复后，运行诊断脚本验证：

```bash
node scripts/diagnose-deploy.js
```

应该看到：

```
✅ 未发现问题！项目可以部署。
```

然后在 Coze 平台重新触发部署。

---

## Coze 平台特定注意事项

### 1. 确保 .coze 文件正确

```bash
cat .coze
```

应该包含：
- `[project]` - sub_id, name, project_type
- `[deploy]` - build, run
- `[subprojects]` - path = ["."]

### 2. 确保部署脚本存在且可执行

```bash
ls -la .cozeproj/scripts/
```

应该包含：
- `deploy_build.sh`
- `deploy_run.sh`

### 3. 检查分支名称

Coze 默认部署 `main` 分支，确保：

```bash
git branch --show-current
# 应输出: main
```

---

## 联系支持

如果以上方法都无法解决问题：

1. **收集信息**:
   ```bash
   # 运行诊断
   node scripts/diagnose-deploy.js > deploy-diagnosis.txt
   
   # 查看 Git 状态
   git status > git-status.txt
   
   # 查看最近提交
   git log --oneline -10 > git-log.txt
   ```

2. **提供给 Coze 支持团队**:
   - 部署错误的完整日志
   - deploy-diagnosis.txt
   - git-status.txt
   - git-log.txt
   - 项目的 GitHub 仓库链接

---

## 预防措施

### 1. 保持 .gitignore 完整

始终包含：
```
node_modules/
.next/
dist/
*.log
.env.local
```

### 2. 部署前检查

添加到 package.json:
```json
{
  "scripts": {
    "predeploy": "node scripts/diagnose-deploy.js"
  }
}
```

### 3. 定期清理

```bash
# 每次构建前
rm -rf .next dist

# 定期检查大文件
find . -type f -size +10M ! -path "./node_modules/*" ! -path "./.git/*"
```

---

**最后更新**: 2026-08-26  
**维护者**: 湖北服务部
