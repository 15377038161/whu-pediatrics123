# 超星OAuth生产环境配置

> ⚠️ **安全警告**: 本文档包含敏感配置信息，请勿提交到公开仓库

---

## 超星凭据配置

```bash
CHAOXING_APPID=<chaoxing-appid>
CHAOXING_SECRET=<仅在Coze密钥管理中配置>
```

**重要提醒：**
- ✅ AppID 可以在前端代码中使用（作为 URL 参数）
- ❌ AppSecret 必须仅存储在服务端环境变量中
- ❌ 不要将 Secret 提交到 Git
- ❌ 不要在日志、截图、文档中泄露 Secret

---

## 部署环境完整配置

### 步骤 1: 在 Coze 平台配置环境变量

进入项目设置 → 环境变量，添加以下配置：

```bash
# ============ 超星OAuth配置 ============
ENABLE_CHAOXING_AUTH=true
CHAOXING_APPID=<chaoxing-appid>
CHAOXING_SECRET=<仅在Coze密钥管理中配置>

# ============ 机构配置 ============
# 武汉大学 FID（需要向超星或校方确认）
CHAOXING_FIDS=1024,1385
CHAOXING_PREFERRED_FID=1385

# ============ 回调地址配置 ============
# 格式：https://<Coze分配的域名>/api/auth/callback/chaoxing
# 注意：必须与超星后台登记的完全一致
CHAOXING_REDIRECT_URI=https://<待填写正式域名>/api/auth/callback/chaoxing

# ============ 教师权限配置 ============
# 教师UID白名单（逗号分隔）
# 空值 = 所有用户都是学生权限
# 需要通过测试登录获取真实UID后填写
CHAOXING_TEACHER_UIDS=

# 直接采用超星教师/学生角色的机构；默认武汉大学 FID 1024
CHAOXING_PROVIDER_TEACHER_FIDS=1024

# 竞赛测试单位账号：可进入学生端与教师端；普通武汉大学学生不会命中
CHAOXING_TEST_TEACHER_FIDS=1385

# ============ 可选配置 ============
ENABLE_UI_PREVIEW=false
ENABLE_AI_FIXTURE=false
```

### 步骤 2: 获取并配置正式域名

1. 在 Coze 平台部署后，系统会自动分配域名
2. 记录分配的域名（格式如：`https://your-project-id.coze.site`）
3. 更新 `CHAOXING_REDIRECT_URI` 为完整回调地址

**示例：**
```bash
# 假设 Coze 分配的域名是 https://luojia-pediatrics.coze.site
CHAOXING_REDIRECT_URI=https://luojia-pediatrics.coze.site/api/auth/callback/chaoxing
```

### 步骤 3: 在超星开放平台配置回调地址

1. 登录 [超星微服务开放平台](https://auth.open.chaoxing.com/)
2. 找到 AppID `<chaoxing-appid>` 对应的应用
3. 配置授权回调地址：
   - **PC端运行地址**: `https://luojia-pediatrics.coze.site`
   - **PC端回调地址**: `https://luojia-pediatrics.coze.site/api/auth/callback/chaoxing`
   - **移动端回调地址**: `https://luojia-pediatrics.coze.site/api/auth/callback/chaoxing`

⚠️ **关键注意事项：**
- 协议必须是 `https://`（生产环境）
- 末尾不要加斜杠 `/`
- 必须逐字符完全一致

### 步骤 4: 配置教师权限

**当前逻辑：**
```typescript
// 满足任一规则即授予教师权限，并可在学生端/教师端之间切换：
// 1. 机构 FID 位于 CHAOXING_TEST_TEACHER_FIDS（竞赛测试账号默认 1385）；或
// 2. FID 1024 且超星返回教师/管理员角色；或
// 3. 其他机构的超星教师角色匹配且 UID 位于 CHAOXING_TEACHER_UIDS。
// 普通武汉大学学生不满足上述规则，只能进入学生端且不会显示教师端入口。
```

**配置流程：**

1. **核对教师身份**（必须先完成前3步）：
   ```bash
   # 方法1：让教师测试登录，在服务端日志查看
   # 日志示例：
   # "超星身份信息": { "uid": "12345678", "name": "张老师", ... }
   
   # 方法2：在 Supabase 查看
   # 表：auth.users
   # 字段：app_metadata -> chaoxing -> uid
   ```

2. **其他机构按需更新白名单**（FID 1024 教师不需要 UID 白名单）：
   ```bash
   # 单个教师
   CHAOXING_TEACHER_UIDS=12345678
   
   # 多个教师（逗号分隔，无空格）
   CHAOXING_TEACHER_UIDS=12345678,87654321,11223344
   ```

3. **重新部署**以应用新配置

4. **测试双端切换**：分别使用 1385 单位账号、1024 教师账号和 1024 学生账号登录。前两者在头像旁应看到切换入口，1024 学生不得出现入口且不得访问 `/teacher`。

已有会话若曾被保存为学生，进入教师端时会自动把 `profiles`、`cohort_members` 与 `external_identities` 的角色同步为教师，避免界面身份已恢复但教师学情查询仍因旧成员角色报错。教师切换到学生端进行训练时继续使用教师成员身份，不会被错误要求改回学生成员。

---

## 快速验证清单

### 1. 环境变量验证

```bash
# 在部署后的服务器上验证（通过 Coze 控制台日志）
echo "ENABLE_CHAOXING_AUTH=$ENABLE_CHAOXING_AUTH"
echo "CHAOXING_APPID=$CHAOXING_APPID"
echo "CHAOXING_SECRET length=${#CHAOXING_SECRET}"  # 只显示长度，不显示值
echo "CHAOXING_REDIRECT_URI=$CHAOXING_REDIRECT_URI"
```

### 2. OAuth 流程验证

**学生账号测试：**
1. 访问 `https://<正式域名>/`
2. 点击"使用学习通身份进入"
3. 应跳转到 `https://auth.chaoxing.com/connect/oauth2/authorize?...`
4. 使用测试学生账号登录超星
5. 应自动回调到应用并进入 `/student`
6. 访问 `https://<正式域名>/api/auth/me`
7. 应返回：
   ```json
   {
     "user": {
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

**教师账号测试：**
1. 先用教师账号登录，获取 UID
2. 配置 `CHAOXING_TEACHER_UIDS`
3. 重新部署
4. 教师账号重新登录
5. `app_metadata.app.role` 应为 `"teacher"`
6. `capabilities.teacherWorkspace` 应为 `true`

### 3. 错误场景验证

测试以下场景应显示友好错误页：
- ✅ 用户取消授权
- ✅ code 过期（等待5分钟后刷新回调页）
- ✅ 非白名单机构（使用其他学校账号）

---

## 故障排查速查

### 问题：10003 回调地址不一致

**检查清单：**
```bash
# 1. 查看实际跳转的回调地址
# 访问授权页面，查看 URL 参数 redirect_uri 的值

# 2. 查看环境变量配置
echo $CHAOXING_REDIRECT_URI

# 3. 登录超星后台查看登记的回调地址

# 4. 对比三者是否完全一致（逐字符）
```

**解决方案：**
```bash
# 更新环境变量
CHAOXING_REDIRECT_URI=https://<正式域名>/api/auth/callback/chaoxing

# 更新超星后台配置
# 登录后台手动修改

# 重新部署应用
git push origin main
```

### 问题：10017 code 无效

**可能原因：**
- code 已过期（>5分钟）
- code 已被使用过
- 网络延迟导致超时

**解决方案：**
- 重新发起登录流程（不要刷新回调页）
- 检查服务器时间是否准确
- 减少回调处理的耗时操作

### 问题：无法获取用户信息

**检查清单：**
```bash
# 1. 确认 AppSecret 正确（无前后空格）
echo "[$CHAOXING_SECRET]"  # 应无方括号外的空格

# 2. 确认 FID 配置正确
echo $CHAOXING_FIDS

# 3. 确认测试账号属于配置的 FID
# 在超星后台查看测试账号的机构信息
```

### 问题：教师无法访问教师功能

**诊断步骤：**
```bash
# 1. 确认教师 UID 在白名单中
echo $CHAOXING_TEACHER_UIDS

# 2. 查看用户的实际 app_metadata
# 在 Supabase -> Authentication -> Users 中查看

# 3. 确认超星返回的角色信息
# 查看服务端日志中的 "超星身份信息"
```

**解决方案：**
```bash
# 更新教师白名单
CHAOXING_TEACHER_UIDS=<正确的UID列表>

# 撤销该用户的会话
# 在 Supabase -> Authentication -> Users -> 删除该用户

# 要求用户重新登录
```

---

## 安全检查清单

部署前必须确认：

- [ ] `CHAOXING_SECRET` 已存储在 Coze 密钥管理中（不在代码里）
- [ ] `.env` 文件已加入 `.gitignore`
- [ ] 代码中没有硬编码的 Secret
- [ ] 生产环境使用 HTTPS
- [ ] Cookie 设置了 `Secure`、`HttpOnly`、`SameSite=Lax`
- [ ] 回调地址与超星后台完全一致
- [ ] FID 白名单已正确配置
- [ ] 教师权限已正确配置（或有意留空）
- [ ] 错误日志不包含敏感信息（code、token、openid）

---

## 监控与告警

**建议监控的指标：**

1. **登录成功率**
   ```sql
   -- 统计最近1小时的登录情况
   SELECT 
     COUNT(*) as total_attempts,
     COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as recent_success
   FROM auth.users
   WHERE email LIKE 'chaoxing_%@oauth.invalid';
   ```

2. **错误率**
   - 监控日志中 "超星登录回调失败" 的频率
   - 阈值：> 5% 触发告警

3. **响应时间**
   - 从点击登录到进入工作区的总耗时
   - 目标：< 3秒
   - 阈值：> 10秒触发告警

**告警通知：**
- 登录失败率 > 5%
- 配置错误（config_missing）> 0
- Supabase 连接失败 > 0
- 重复用户创建 > 0

---

## 联系方式

**超星技术支持：**
- 开放平台文档：https://auth.open.chaoxing.com/
- 技术咨询：（待补充）

**项目技术支持：**
- 开发团队：湖北服务部
- 应急联系人：（待补充）

---

**文档版本**: 1.0  
**最后更新**: 2026-08-26  
**状态**: 待部署验证
