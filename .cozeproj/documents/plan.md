# 教师端/学生端角色切换 + 关卡全开放

## 概述

为教师和测试账号提供全页面可见的角色切换入口（含训练页），支持随时在教师端/学生端之间切换；同时临时解锁所有 OSCE 阶段导航限制，允许自由跳转。平台为 web。

## 技术方案

| 维度 | 选择 | 理由 |
|------|------|------|
| 角色切换 UI | 浮动按钮组件 | 训练页 AppShell 跳过导航栏，浮动按钮可在全页面渲染 |
| 切换机制 | 服务端路由跳转 | 教师访问 /student 已由 `canAccessRole('teacher','student')` 放行，无需新 API |
| 预览用户切换 | 新增 POST /api/preview/switch-role | 预览用户角色固定在 cookie，需服务端改写 |
| 关卡解锁 | 环境变量 `LOCK_STAGES` | `LOCK_STAGES≠'true'` 时跳过阶段校验，默认全开放，可随时恢复 |
| 身份判定 | 无改动 | fid 1385 已由 `isTestTeacherFid` 识别为教师（可切换），fid 1024 走正常角色检测 |

## 功能模块

### 1. 角色切换浮动按钮 `RoleSwitchFloat`
- 服务端组件，仅在 `user.role === 'teacher'` 时渲染
- 固定定位（右下角），z-index 高于训练页内容
- 文案："切换到学生端" / "切换到教师端"，根据当前路径判断目标
- 在 `app-shell.tsx` 的训练页 early-return 分支中渲染，非训练页保持现有 header 切换入口

### 2. 预览角色切换 API `POST /api/preview/switch-role`
- 请求体：`{ role: 'student' | 'teacher' }`
- 仅预览用户可调用；重写 preview cookie 的 role 字段
- 成功后返回 `nextUrl`，前端 `router.replace(nextUrl)`

### 3. 预览角色切换按钮（客户端）
- 预览用户（`user.isPreview === true`）在浮动按钮区显示角色切换
- 调用 `/api/preview/switch-role` 后跳转目标端首页

### 4. 关卡全开放
- `agent-engine.ts` 的 `validateStageNavigation`：当 `process.env.LOCK_STAGES !== 'true'` 时直接返回（跳过校验）
- 默认全开放，设 `LOCK_STAGES=true` 可恢复阶段锁定

## 是否有原型设计

否（项目已完成首次开发，本次为小功能迭代）

## 实施步骤

1. 创建 `RoleSwitchFloat` 组件并在 `app-shell.tsx` 训练页分支渲染，非训练页保持现有切换入口 — `src/components/role-switch-float.tsx`、`src/components/app-shell.tsx`
2. 新增预览角色切换 API 与客户端调用逻辑 — `src/app/api/preview/switch-role/route.ts`、`src/components/role-switch-float.tsx`
3. 解除 OSCE 阶段导航锁定（环境变量控制） — `src/lib/agent-engine.ts`
4. 类型检查 + lint + test_run 管线验证
