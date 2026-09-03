# 珞珈儿科智训 · 设计风格与动效规范（AI 重设计提示词包）

> 版本 v1.0 ｜ 2026-08-27 ｜ 方向 B「童趣守护」
> 用途：将本文档（或文末「一段式提示词」）直接投喂给任何 AI / 设计工具，重现或演化本套 UI 设计基因。

---

## 1. 整体风格总结

**一句话**：儿童医院的墙绘 × 专业临床带教的温度感——**童趣守护（Playful Guardian）**。

| 维度 | 定调 |
|------|------|
| 情感基调 | 温暖、轻盈、可信赖；对患儿是游戏化守护，对学生是严谨教练 |
| 视觉气质 | 大圆角 + 软阴影 + 高明度低饱和色；信息密度克制，每屏一个主任务 |
| 图形语言 | 患儿/精灵用几何化 SVG（圆+矩形拼贴），扁平微立体；禁用 emoji 与写实插画 |
| 医疗感表达 | 用「守护蓝」传递专业，用 ECG 心电线、听诊器等临床符号做氛围点缀，不用冷冰冰的白色器械风 |
| 权威背书 | 珞珈印章 / 武大标识等元素做低饱和处理，融入而不抢戏 |

**关键词（喂 AI 用）**：Playful Guardian, pediatric medical education, warm & trustworthy, rounded soft UI, high-lightness low-saturation, one primary action per screen, geometric SVG illustration, mobile-first 390pt。

---

## 2. 配色系统（完整 Token）

### 2.1 色板

| 角色 | 色值 | 语义 |
|------|------|------|
| Primary 天空蓝 | `#4EB7E8` | 守护、专业；主按钮 / 激活态 / 链接 / 品牌 |
| Primary-Deep | `#2E93C4` | 小字号场景的加深主色（对比度补救） |
| Secondary 嫩芽绿 | `#80D88C` | 成长、成功、进度、正向反馈 |
| Accent 奶油黄 | `#FFD66B` | 荣誉徽章、激励高亮、装饰点缀 |
| Warm 暖橙 | `#F2A93B` | **仅限**限时倒计时、告警、失分强调 |
| Danger 珊瑚红 | `#E26D6D` | 错误、失分、危险操作 |
| Ink 墨色 | `#2A2F3A` | 标题与正文 |
| Muted 灰 | `#6B7280` | 辅助说明、meta 信息 |
| BG 浅云白 | `#F5FAFF` | 页面底色 |
| Surface 纯白 | `#FFFFFF` | 卡片、顶栏、弹层 |
| Surface-Soft | `#EAF2F8` | 输入框底、次级容器、头像底 |

### 2.2 用色规则

- 同屏高饱和色 ≤2 个（主色 + 辅色）；暖橙是「稀缺资源」，出现即代表紧急。
- 主按钮白字 on `#4EB7E8` 对比度 ≈2.6:1 → 只用于 ≥15pt 粗体；小字一律 `#2E93C4`。
- 语义色不承担装饰功能；状态必须「颜色 + 图标/文字」双通道表达（色盲友好）。

### 2.3 CSS 变量（直接粘贴）

```css
:root {
  /* 色彩 */
  --c-primary: #4EB7E8;
  --c-primary-deep: #2E93C4;
  --c-secondary: #80D88C;
  --c-accent: #FFD66B;
  --c-warm: #F2A93B;
  --c-danger: #E26D6D;
  --c-ink: #2A2F3A;
  --c-muted: #6B7280;
  --c-bg: #F5FAFF;
  --c-surface: #FFFFFF;
  --c-surface-soft: #EAF2F8;
  /* 形状 */
  --r-card: 16px;  --r-btn: 12px;  --r-chip: 8px;
  /* 阴影 */
  --sh-card: 0 4px 16px rgba(42,47,58,.06);
  --sh-float: 0 8px 32px rgba(42,47,58,.12);
  /* 动效 */
  --ease-out: cubic-bezier(.22,1,.36,1);
  --dur-fast: 120ms;  --dur-base: 200ms;  --dur-slow: 320ms;
}
```

---

## 3. 字体 · 间距 · 布局基线

- **字体**：Inter（拉丁/数字）+ 系统中文栈（PingFang SC / 思源黑体回退）；标题行高 1.3，正文 1.5。
- **字阶**：11 / 12 / 13 / 15 / 16 / 18 / 20 / 24（移动端正文 ≥13，正文标准 15 Bold 18 Bold 20 Display 24）
- **间距**：4pt 栅格；页面 padding 16，卡片 padding 14–16，模块 gap 16。
- **移动端**：390 基准单列流，顶栏 56pt + 底部导航 56pt+安全区；触控目标 ≥44pt。
- **桌面端**：≥1024 左侧固定导航 220pt + 主区 max-1280；训练场景用双面板（患儿固定 360pt + 对话弹性）。

---

## 4. 动效系统（CSS 提示词，12 场景）

> 动效总原则：**克制、有因**。全局 200ms + ease-out 为基准；只对「状态变化」和「注意力引导」做动效；装饰性动效仅登录页一处（ECG）。

### 4.1 ECG 心电线循环描边（仅登录页氛围）
```css
@keyframes ecg-draw { to { stroke-dashoffset: -600; } }
.ecg-path {
  stroke-dasharray: 600;
  animation: ecg-draw 2.4s linear infinite;
}
@keyframes ecg-glow {
  0%,100% { filter: drop-shadow(0 0 2px rgba(78,183,232,.35)); }
  50%     { filter: drop-shadow(0 0 7px rgba(78,183,232,.85)); }
}
.ecg-path { animation: ecg-draw 2.4s linear infinite, ecg-glow 2.4s ease-in-out infinite; }
```

### 4.2 当前阶段脉冲（训练台步骤指示器）
```css
@keyframes stage-pulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(78,183,232,.45); }
  60%     { box-shadow: 0 0 0 8px rgba(78,183,232,0); }
}
.stage--current { animation: stage-pulse 2s var(--ease-out) infinite; }
```

### 4.3 对话气泡上屏（问诊/查体对话）
```css
@keyframes bubble-in {
  from { opacity: 0; transform: translateY(8px) scale(.96); }
  to   { opacity: 1; transform: none; }
}
.bubble { animation: bubble-in var(--dur-base) var(--ease-out) both; }
.bubble--student { transform-origin: 100% 100%; } /* 学生气泡从右下生长 */
```

### 4.4 AI 提示插入（120ms 快速淡入，不打断输入）
```css
@keyframes hint-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}
.hint-chip { animation: hint-in 120ms ease-out both; }
```

### 4.5 OSCE 倒计时最后 30 秒告警（暖橙脉冲 + 放大）
```css
@keyframes timer-urgent {
  0%,100% { color: var(--c-warm); transform: scale(1); }
  50%     { color: var(--c-danger); transform: scale(1.08); }
}
.timer--urgent { animation: timer-urgent 1s ease-in-out infinite; }
```

### 4.6 卡片悬浮 / 按压反馈
```css
.card {
  transition: transform var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-base) var(--ease-out);
}
.card:hover  { transform: translateY(-2px); box-shadow: var(--sh-float); }
.card:active { transform: translateY(0) scale(.98); }
```

### 4.7 主按钮按压 + 禁用
```css
.btn { transition: transform var(--dur-fast) var(--ease-out), opacity var(--dur-fast); }
.btn:active:not(:disabled) { transform: scale(.96); }
.btn:disabled { opacity: .55; cursor: not-allowed; }
```

### 4.8 就绪度 / 进度条增长
```css
@keyframes progress-fill { from { width: 0; } }
.progress-value { animation: progress-fill 600ms var(--ease-out) both; }
```

### 4.9 骨架屏 shimmer（加载态）
```css
@keyframes shimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }
.skeleton {
  background: linear-gradient(90deg, #EAF2F8 25%, #F5FAFF 37%, #EAF2F8 63%);
  background-size: 200% 100%;
  border-radius: var(--r-chip);
  animation: shimmer 1.4s linear infinite;
}
```

### 4.10 底部导航切换弹跳（激活项图标）
```css
@keyframes nav-pop {
  0%   { transform: translateY(0); }
  40%  { transform: translateY(-4px); }
  100% { transform: translateY(0); }
}
.nav-item.is-active .nav-icon { animation: nav-pop 240ms var(--ease-out); }
```

### 4.11 弹层进出场（训练中断确认等模态）
```css
@keyframes modal-in {
  from { opacity: 0; transform: scale(.92) translateY(12px); }
  to   { opacity: 1; transform: none; }
}
@keyframes overlay-in { from { opacity: 0; } to { opacity: 1; } }
.modal-overlay { animation: overlay-in var(--dur-fast) ease-out both; background: rgba(42,47,58,.92); }
.modal-card { animation: modal-in var(--dur-base) var(--ease-out) both; }
```

### 4.12 得分 / 徽章揭晓（Accent 黄星星爆开）
```css
@keyframes star-burst {
  0%   { transform: scale(0) rotate(-30deg); opacity: 0; }
  60%  { transform: scale(1.15) rotate(6deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); }
}
.badge-reveal { animation: star-burst 480ms var(--ease-out) both; }
```

### 4.13 全局降级（无障碍，必须保留）
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
```

---

## 5. 动效优先级（资源有限时砍的顺序）

1. **必保**：气泡上屏、按钮按压、弹层、倒计时告警（功能性反馈）
2. **应保**：阶段脉冲、进度条增长、骨架屏（状态可见性）
3. **可选**：导航弹跳、星星爆开（愉悦感）
4. **唯一装饰**：登录页 ECG 循环——全站仅此一处循环型动效

---

## 6. 一段式提示词（复制粘贴给其他 AI 直接用）

```
请为「珞珈儿科智训」（儿科临床教学 AI 应用，面向医学生）设计完整 UI。

【风格】童趣守护 Playful Guardian：儿童医院墙绘的温度 × 专业临床带教的严谨。
大圆角软阴影、高明度低饱和、每屏仅一个主任务；插画用几何化 SVG（圆+矩形拼贴的患儿/精灵），
扁平微立体，禁用 emoji 与写实风格。移动端优先（390pt 基准），桌面端左导航+双面板。

【配色】主色天空蓝 #4EB7E8（守护/主按钮/激活态），辅色嫩芽绿 #80D88C（成长/成功/进度），
点缀奶油黄 #FFD66B（徽章/激励），暖橙 #F2A93B 只用于限时告警，珊瑚红 #E26D6D 用于错误失分，
墨色 #2A2F3A 正文，底色浅云白 #F5FAFF，卡片纯白，输入底 #EAF2F8。
同屏高饱和色不超过 2 个；暖橙稀缺使用。

【规格】圆角：卡片16/按钮12/标签8；阴影 0 4px 16px rgba(42,47,58,.06)；
间距 4pt 栅格，页面 padding 16；字体 Inter+系统中文，字阶 11/12/13/15/16/18/20/24，
正文 15 行高 1.5；触控目标 ≥44pt。

【动效】克制有因，基准 200ms cubic-bezier(.22,1,.36,1)：对话气泡上浮淡入、
当前阶段主色脉冲扩散、OSCE 倒计时最后 30 秒暖橙放大告警、弹层 scale+上移进场、
卡片悬浮上浮 2px、进度条 600ms 增长、骨架屏 shimmer、AI 提示条 120ms 快速淡入。
唯一循环装饰动效：登录页 ECG 心电线描边流动。必须支持 prefers-reduced-motion 降级。

【氛围】像儿童候诊区的墙绘，但教的是严谨临床思维——问诊与查体在同一工作台可自由往返切换，
用「采集清单+就绪度」替代线性步骤条，评分约束放在报告证据层而非交互阻断层。
```

---

## 7. 与现有资产的衔接

- 画布完整设计稿：Ardot 文件 `719272038216163`（19 个节点，含设计系统规范屏 `3:670`）
- 全部切图：`output/design-slices/`（19 张 2x PNG）
- 规范文档：`docs/UI设计规范.md`、`docs/设计优化说明文档.md`、`docs/用户操作动线与可用性验证.md`
- 换 AI 重设计后，建议回传产出与本提示词包做一致性走查（对照 `docs/UI设计规范.md` §9 清单）。
