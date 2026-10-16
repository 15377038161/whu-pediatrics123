# 神经系统四病例：超星 Coder 待审核导入

## 已确认范围

本批四份标准化资料作为独立新病例，仅保存教师待审核草稿，不覆盖同病种旧病例，不写入运行时病例事实或答案，不向学生发布，不进入随机池。

四个独立标识：

- `intake-neurology-20261016-viral-encephalitis`
- `intake-neurology-20261016-epilepsy`
- `intake-neurology-20261016-febrile-seizure`
- `intake-neurology-20261016-bacterial-meningitis`

草稿版本统一 `intake-20261016-v1`。同 ID、同版本重复导入不得覆盖；修订须另增版本。

发热性惊厥年龄、性别、主诉已由用户确认：女、1岁3月、发热伴咳嗽2天，抽搐1次。其他矛盾原文仅供审核，不自动采用某一说法。

## 资料传递与保存

病例正文不进入 Git，不放 public，不写进 migration。受控交接文件 `coder-neurology-drafts-20261016.txt` 由项目聊天附件单独传递；顶层为 batchId、operation、items。每个 item 含现有草稿 API 的 sourceName、draftVersion、desensitized、mediaReviewed、payload。

源文档中的明确患者姓名已替换，未对全文及内嵌媒体完成医学与隐私审核，所以 desensitized、mediaReviewed 均保持 false；不导入内嵌图片。原件 SHA256、待审核问题和用户决定记录在教师草稿 documents 中。

复用 `src/lib/case-draft-import.ts` 的解析、预检、保存机制和 `/api/teacher/case-drafts`，草稿表为 `case_draft_imports`，数据库状态固定 draft。目录外 ID 在现有契约下仅可保存草稿，这是本批预期行为，不为消除提示而加入学生目录或建立别名。

## Coder 执行与验收

1. 拉取 GitHub `deploy-4a1c946`，核对当前改动后快进，禁止强制覆盖。
2. 读取附件并核对四个 ID、版本、用户确认值及待审核项。仅通过已授权教师会话正常 API，或平台明确允许的管理员业务数据通道写入草稿；不得获取服务角色密钥、伪造 JWT 或放宽 RLS。
3. 回查四条真实数据库记录：独立 ID、固定 draft、source_name、完整 payload、审核状态 false；重复导入不新增或覆盖，旧病例和会话不变。
4. 在正式域名教师病例草稿页面确认四条可见；学生目录仍不含这四个 ID。不能把本地文件、合成测试或聊天执行计划当作线上入库完成。
5. 若只保存业务数据，无需重复部署；若发现阻碍正常导入的代码缺陷，做最小修复、对应测试、validate/build，并部署后再验收。真实资料不可进入公开仓库或测试夹具。

## 待审核边界

病毒性脑炎的手术史、过敏史与部分诊断证据；癫痫的分型、脑电图单位与教学结论；发热性惊厥的出生史、家族史等混合记录；化脓性脑膜炎的喂养史、药物剂量上下文，均需资料老师核对。本轮不补造、不制定新评分规则。
