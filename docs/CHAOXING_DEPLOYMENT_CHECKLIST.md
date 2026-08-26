# 超星身份验证部署清单

> 本清单确保超星 OAuth 在 Coze 部署环境中正常工作
> 
> **项目**: 珞珈儿科智训
> **文档版本**: 1.0
> **最后更新**: 2026-08-26

---

## 状态总览

### ✅ 已完成项

1. **代码实现完整**
   - ✅ `/api/auth/chaoxing` - 发起授权
   - ✅ `/api/auth/callback/chaoxing` - OAuth 回调
   - ✅ 超星 token 和用户信息客户端
   - ✅ 签名登录上下文（10分钟过期）
   - ✅ Supabase 用户创建与绑定
   - ✅ 角色权限映射
   - ✅ 错误处理与分类

2. **安全措施**
   - ✅ AppSecret 仅在服务端
   - ✅ HttpOnly、Secure、SameSite=Lax Cookie
   - ✅ 签名登录上下文防 CSRF
   - ✅ 安全 next 路径校验
   - ✅ code 只使用一次
   - ✅ 虚拟邮箱（SHA-256 哈希 openid）

3. **数据库**
   - ✅ Supabase 已配置并连接
   - ✅ 迁移已执行（16张表 + RLS）
   - ✅ profiles、external_identities、cohort_members 表就绪

---

## 🔧 部署前必须配置的环境变量

### 生产环境变量清单

```bash
# === Supabase（平台自动注入）===
COZE_SUPABASE_URL=<自动注入>
COZE_SUPABASE_ANON_KEY=<自动注入>
COZE_SUPABASE_SERVICE_ROLE_KEY=<自动注入>

# === 运行环境（平台自动注入）===
COZE_PROJECT_ENV=PROD
COZE_PROJECT_DOMAIN_DEFAULT=<生产域名，如 https://your-app.coze.site>

# === 超星 OAuth（必须手动配置）===
ENABLE_CHAOXING_AUTH=true
CHAOXING_APPID=<超星分配的正式 AppID>
CHAOXING_SECRET=<超星分配的正式 AppSecret，存密钥管理>
CHAOXING_FIDS=<武汉大学 FID，多个用逗号分隔，如 "1024,1385">
CHAOXING_REDIRECT_URI=<完整回调地址，如 https://your-app.coze.site/api/auth/callback/chaoxing>
CHAOXING_TEACHER_UIDS=<教师白名单 UID，逗号分隔，空则无教师权限>

# === 可选配置 ===
ENABLE_UI_PREVIEW=false
ENABLE_AI_FIXTURE=false
```

### 🚨 关键配置注意事项

#### 1. `CHAOXING_REDIRECT_URI` 配置规则

**必须满足：**
- ✅ 使用 `HTTPS` 协议（生产环境）
- ✅ 完整 URL（协议+域名+路径）
- ✅ 路径必须是 `/api/auth/callback/chaoxing`
- ✅ 与超星后台登记的**逐字符一致**（包括末尾斜杠）
- ✅ 使用 Coze 分配的正式域名，不是预览域名

**错误示例：**
```bash
❌ http://localhost:3000/api/auth/callback/chaoxing  # HTTP 不安全
❌ /api/auth/callback/chaoxing  # 缺少协议和域名
❌ https://d457e582-760a-4e62-b4bb-6a6e04049bf2.dev.coze.site/...  # 预览域名
❌ https://your-app.coze.site/api/auth/callback/chaoxing/  # 末尾多了斜杠
```

**正确示例：**
```bash
✅ https://your-app.coze.site/api/auth/callback/chaoxing
✅ https://luojia-peds.whu.edu.cn/api/auth/callback/chaoxing
```

#### 2. `CHAOXING_FIDS` - 机构白名单

```bash
# 单个机构
CHAOXING_FIDS=1024

# 多个机构（带名称）
CHAOXING_FIDS=1024:武汉大学,1385:武汉大学医学院

# 多个机构（仅 FID）
CHAOXING_FIDS=1024,1385
```

#### 3. `CHAOXING_TEACHER_UIDS` - 教师权限白名单

**当前实现逻辑：**
```typescript
// 同时满足两个条件才授予教师权限：
// 1. 超星返回的角色中包含"教师"关键词
// 2. UID 在白名单中
```

**配置示例：**
```bash
# 无教师权限（所有用户都是学生）
CHAOXING_TEACHER_UIDS=

# 单个教师
CHAOXING_TEACHER_UIDS=12345678

# 多个教师
CHAOXING_TEACHER_UIDS=12345678,87654321,11223344
```

**⚠️ 重要：**
- 空值 = 无人有教师权限
- 必须获取**测试教师的真实 UID**，不能猜测
- 测试时先用学生账号验证，再用教师账号验证权限

---

## 📋 部署前验收清单

### Phase 1: 配置验证

- [ ] **1.1** 在 Coze 平台配置所有必需环境变量
- [ ] **1.2** 确认 `CHAOXING_SECRET` 存储在密钥管理中（不在代码/日志/截图）
- [ ] **1.3** 获取 Coze 分配的正式域名（`COZE_PROJECT_DOMAIN_DEFAULT`）
- [ ] **1.4** 在超星开放平台后台登记**完全一致**的回调地址
- [ ] **1.5** 获取测试学生和测试教师的**真实账号和 UID**
- [ ] **1.6** 配置 `CHAOXING_TEACHER_UIDS` 包含测试教师 UID

### Phase 2: 部署验证

- [ ] **2.1** 推送代码到 Coze 绑定的 Git 仓库
- [ ] **2.2** 触发部署并等待完成
- [ ] **2.3** 确认部署日志中没有构建错误
- [ ] **2.4** 访问生产域名首页，确认页面正常加载
- [ ] **2.5** 检查 `/api/health` 端点返回 200

### Phase 3: OAuth 流程测试

#### 测试环境
- 浏览器：Chrome（最新版）、Safari（最新版）
- 设备：桌面 + 移动端
- 网络：正常网络（非 VPN）

#### 学生账号测试

- [ ] **3.1** 点击"使用学习通身份进入"按钮
- [ ] **3.2** 成功跳转到超星授权页
  - 检查 URL 包含 `auth.chaoxing.com`
  - 检查 `appid`、`redirect_uri`、`scope`、`state` 参数
- [ ] **3.3** 使用**测试学生账号**登录超星
- [ ] **3.4** 授权后成功回调到应用
- [ ] **3.5** 自动跳转到 `/student` 学生工作区
- [ ] **3.6** 访问 `/api/auth/me`，确认返回：
  ```json
  {
    "user": {
      "id": "uuid",
      "email": "chaoxing_<hash>@oauth.invalid",
      "app_metadata": {
        "provider": "chaoxing",
        "app": { "role": "student" }
      }
    },
    "capabilities": {
      "studentWorkspace": true,
      "teacherWorkspace": false
    }
  }
  ```
- [ ] **3.7** 尝试访问 `/teacher` - 应返回 403 或重定向
- [ ] **3.8** 刷新页面，会话保持（不需要重新登录）
- [ ] **3.9** 点击退出，会话清除
- [ ] **3.10** 退出后访问 `/student` - 应重定向到登录页

#### 教师账号测试

- [ ] **3.11** 使用**测试教师账号**登录
- [ ] **3.12** 访问 `/api/auth/me`，确认返回：
  ```json
  {
    "user": {
      "app_metadata": {
        "app": { "role": "teacher" }
      }
    },
    "capabilities": {
      "studentWorkspace": true,
      "teacherWorkspace": true,
      "teacherPractice": true
    }
  }
  ```
- [ ] **3.13** 可以访问 `/teacher` 教师工作台
- [ ] **3.14** 可以切换到学习体验（`/student`）

#### 并发测试

- [ ] **3.15** 双击登录按钮 - 不会创建重复用户
- [ ] **3.16** 两个标签页同时登录 - 只创建一个会话

### Phase 4: 异常场景测试

- [ ] **4.1** 用户取消授权 - 显示友好错误页
- [ ] **4.2** code 过期（5分钟后） - 提示重新登录
- [ ] **4.3** 回调 URL 篡改 - 超星拒绝（10003 错误）
- [ ] **4.4** 非白名单 FID - 后端拒绝（institution_mismatch）
- [ ] **4.5** 恶意 next 参数（`?next=//evil.com`） - 被过滤
- [ ] **4.6** 超星服务超时 - 10秒内返回错误页

### Phase 5: 安全测试

- [ ] **5.1** 浏览器控制台/网络日志 - 无 `CHAOXING_SECRET`
- [ ] **5.2** 页面源码 - 无敏感凭据
- [ ] **5.3** 前端无法读取 HttpOnly Cookie
- [ ] **5.4** `/api/auth/me` 响应 - 无超星 token/openid
- [ ] **5.5** 日志文件 - 无 code/token/完整个人信息

### Phase 6: 数据库验证

- [ ] **6.1** 登录后检查 Supabase
  - `auth.users` 表有新用户
  - `email` 格式为 `chaoxing_<hash>@oauth.invalid`
  - `app_metadata` 包含超星身份信息
- [ ] **6.2** `profiles` 表有对应记录
  - `app_role` 正确（student/teacher）
  - `chaoxing_uid` 正确
  - `institution_fid` 正确
- [ ] **6.3** `external_identities` 表有绑定记录
- [ ] **6.4** `cohort_members` 表有班级成员记录
- [ ] **6.5** 再次登录 - 不创建重复记录，更新 `last_login_at`

---

## 🔍 故障排查速查表

### 问题：点击登录无反应

**检查：**
1. 浏览器控制台是否有 JS 错误
2. Network 面板是否有 `/api/auth/chaoxing` 请求
3. 按钮是否被遮挡或 disabled

**解决：**
```bash
# 直接访问授权端点
curl -i "https://your-app.coze.site/api/auth/chaoxing?next=/student"
# 应返回 302 跳转到超星
```

### 问题：跳转后超星报错 10003（redirect_uri 不一致）

**原因：** 环境变量中的 `CHAOXING_REDIRECT_URI` 与超星后台不一致

**检查：**
1. 查看实际跳转的 URL：`https://auth.chaoxing.com/connect/oauth2/authorize?...&redirect_uri=<实际值>`
2. 登录超星开放平台后台，查看登记的回调地址
3. 逐字符对比（包括协议、域名、端口、路径、斜杠）

**解决：**
```bash
# 更新环境变量使其完全一致
CHAOXING_REDIRECT_URI=https://your-app.coze.site/api/auth/callback/chaoxing

# 重新部署
git push origin main
```

### 问题：回调后报错 "oauth_failed"

**可能原因：**
- code 已过期（超过5分钟）
- code 已被使用
- AppSecret 错误

**检查服务端日志：**
```bash
# 查找错误日志
grep "超星登录回调失败" logs/app.log
```

**解决：**
1. 重新发起登录流程（获取新 code）
2. 确认 `CHAOXING_SECRET` 正确且无前后空格
3. 确认 AppID 和 Secret 属于同一应用

### 问题：学生被识别为教师（或反之）

**检查：**
```bash
# 查看用户的真实 roleId
# 在成功登录后，检查 Supabase auth.users 表的 app_metadata.chaoxing.role
```

**解决：**
```bash
# 更新教师白名单
CHAOXING_TEACHER_UIDS=<正确的教师 UID 列表>

# 撤销受影响用户的会话，要求重新登录
# 或直接删除 Supabase 中的测试用户记录
```

### 问题：登录后立即跳回登录页

**原因：** 会话 Cookie 未设置成功

**检查：**
1. 浏览器开发者工具 → Application → Cookies
2. 查找 `sb-*-auth-token` Cookie
3. 确认 Cookie 的 Domain、Path、Secure、SameSite 属性

**解决：**
```bash
# 确认环境变量
COZE_PROJECT_DOMAIN_DEFAULT=https://your-app.coze.site  # 必须 HTTPS

# 检查 X-Forwarded-Proto 和 X-Forwarded-Host 头是否正确传递
curl -H "X-Forwarded-Proto: https" -H "X-Forwarded-Host: your-app.coze.site" \
  "https://your-app.coze.site/api/auth/me"
```

### 问题：Supabase 连接失败

**检查：**
```bash
# 测试 Supabase 连接
curl -H "apikey: $COZE_SUPABASE_ANON_KEY" \
  "$COZE_SUPABASE_URL/rest/v1/"
# 应返回 200
```

**解决：**
1. 确认三个 Supabase 环境变量都已配置
2. 确认变量值属于同一个 Supabase 项目
3. 确认迁移已执行（检查表是否存在）

---

## 🚀 上线步骤

### 1. 准备阶段

```bash
# 1.1 确认当前环境变量
cat .env | grep CHAOXING

# 1.2 本地测试（使用预览凭据）
pnpm install
pnpm run validate  # typecheck + lint + test
pnpm run build     # 确保构建成功

# 1.3 提交代码
git add .
git commit -m "feat: 完善超星身份验证，准备部署"
git push origin main
```

### 2. 超星平台配置

1. 登录超星微服务开放平台
2. 找到对应应用
3. 配置回调地址：
   - PC端：`https://<正式域名>/api/auth/callback/chaoxing`
   - 移动端：`https://<正式域名>/api/auth/callback/chaoxing`
4. 确认 FID 白名单已配置
5. 确认 scope 包含 `snsapi_base`

### 3. Coze 平台部署

1. 进入 Coze 项目控制台
2. 配置生产环境变量（参考上方清单）
3. 触发部署
4. 等待部署完成
5. 记录分配的生产域名

### 4. 验证与监控

```bash
# 4.1 健康检查
curl https://your-app.coze.site/api/health
# 应返回 {"status":"ok"}

# 4.2 测试登录流程（使用测试账号）
# - 学生账号：完整走一遍 Phase 3 测试
# - 教师账号：完整走一遍 Phase 3 测试

# 4.3 监控错误日志
# 在 Coze 控制台查看应用日志，关注：
# - "超星登录回调失败"
# - "无法发起超星登录"
# - HTTP 4xx/5xx 错误
```

### 5. 回滚准备

**如果出现严重问题，立即回滚：**

```bash
# 方案 A：关闭超星认证
ENABLE_CHAOXING_AUTH=false

# 方案 B：回滚到上一个稳定版本
git revert <commit-hash>
git push origin main
```

---

## 📊 关键指标监控

### 成功指标

- **登录成功率** > 95%
- **平均登录耗时** < 3秒（从点击到进入工作区）
- **会话保持率** > 99%（刷新页面不需要重新登录）

### 告警阈值

- `oauth_failed` 错误 > 5% → 检查超星服务
- `config_missing` 错误 > 0 → 立即检查环境变量
- `session_failed` 错误 > 1% → 检查 Supabase 连接
- 重复用户创建 > 0 → 检查唯一约束

---

## 📚 相关文档

- [超星平台数据库对接与身份验证登录系统_实施说明](../assets/超星平台数据库对接与身份验证登录系统_实施说明_20260826164026996.md)
- [AGENTS.md](../AGENTS.md) - 项目架构与运行说明
- [超星开放平台文档](https://auth.open.chaoxing.com/)

---

## ✅ 最终确认

- [ ] 已完成所有验收清单项
- [ ] 测试学生和教师账号都能正常登录
- [ ] 权限控制正确（学生不能访问教师功能）
- [ ] 生产环境变量已正确配置
- [ ] 超星后台回调地址已登记
- [ ] 已准备回滚方案
- [ ] 已设置监控告警

**签署：**

- 开发负责人：__________ 日期：__________
- 测试负责人：__________ 日期：__________
- 项目负责人：__________ 日期：__________

---

**最后更新**: 2026-08-26  
**文档版本**: 1.0  
**维护者**: AI Coding Agent
