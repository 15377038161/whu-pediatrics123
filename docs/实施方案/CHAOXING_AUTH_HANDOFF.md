# 超星身份认证联调交接

## 已完成代码

- `/api/auth/chaoxing`：生成授权地址并保存签名返回路径。
- `/api/auth/callback/chaoxing`：服务端交换令牌、读取身份、校验 FID、创建/映射 Coze 用户会话。
- 教师身份同时要求超星教师角色与 `CHAOXING_TEACHER_UIDS` 服务端白名单。
- 授权码、令牌和 APPKEY 不返回浏览器，不输出日志。

## 需要项目负责人操作

1. 在 Coze 导入并部署，复制正式 HTTPS 域名。
2. 进入武汉大学超星开放平台，新建自建应用。
3. PC 地址、移动地址填写正式域名；回调填写 `https://正式域名/api/auth/callback/chaoxing`。
4. 获取 APPID、APPKEY 和武汉大学 FID，仅录入 Coze 环境变量。
5. 设置：`CHAOXING_APPID`、`CHAOXING_SECRET`、`CHAOXING_FIDS`、`CHAOXING_REDIRECT_URI`。凭据完整时认证默认启用；只有需要临时关闭时才设置 `ENABLE_CHAOXING_AUTH=false`。
6. 将允许查看课程群组的教师 UID 写入 `CHAOXING_TEACHER_UIDS`（逗号分隔），重新部署。

`CHAOXING_FIDS` 支持两种写法：

- `1024,1385`：登录页只显示一个按钮，回调时按配置顺序识别账号所属机构。
- `1024:武汉大学,1385:机构名称`：登录页显示机构选择框，并严格校验所选机构。

不要配置多个裸 FID 后再强制前端传 `fid`，否则普通登录按钮会在跳转超星前被服务端拒绝。

## 正常结果与失败排查

- 正常：学生进入 `/student`，白名单教师进入 `/teacher`。
- `config_missing`：检查开关和五项变量，尤其回调必须为 HTTPS 且与后台完全一致。
- `institution_mismatch`：账号不属于允许机构，或具名多机构模式下没有选择机构。
- `oauth_expired`：登录上下文已过期或回调机构与发起登录时不一致，返回登录页重新发起授权。
- 教师进入学生端：核对提供方角色字段及服务端教师 UID 白名单。
- 回调过期：重新从登录页发起，不复用旧授权链接。
