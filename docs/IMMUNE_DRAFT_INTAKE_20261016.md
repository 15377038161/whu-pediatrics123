# 风湿免疫三病例：超星 Coder 待审核入库

## 范围与数据边界

沿用用户确认的独立新增、先全部待审核规则。本批为川崎病、风湿热、过敏性紫癜三份教师资料，不覆盖同病种旧病例，不发布给学生，不写入运行时事实或答案，不修改随机接诊池。

| 独立病例 ID | 草稿版本 |
| --- | --- |
| intake-immune-20261016-kawasaki | intake-20261016-v1 |
| intake-immune-20261016-rheumatic-fever | intake-20261016-v1 |
| intake-immune-20261016-iga-vasculitis | intake-20261016-v1 |

原件、文字提取、来源 SHA256、结构化数据及审核问题仅保存在 Git 忽略的 `knowledge/intake/2026-10-16-immune/` 和 `outputs/new-cases-20261016-immune/`，不进入仓库、public、迁移或测试夹具。源文档中重复出现的不明编号在传递文本中隐去，原件保持不变。内嵌图片未确认隐私及教学授权，不导入学生媒体。

## 线上保存与验收方式

三例通过正式域名真实教师登录页面直接填入原 JSON，并点击现有草稿保存按钮，均已返回保存成功。复用 `/api/teacher/case-drafts` 与 `case_draft_imports`；status 固定 draft，desensitized/media_reviewed 均 false。没有业务代码或数据库结构变化，不需要为数据保存重复部署。

独立 ID 暂不在学生目录，是本批待审核契约预期状态；不能为消除预检提示而增加学生入口或挂接旧病例别名。来源材料与用户入库决定放在草稿 documents，医学冲突仅记录、不自动改写或用于评分。

Coder 收尾限定为：精确补全本批三个 ID+版本的中文 source_name；只读回查 13 字段内容指纹与本地归一化数据匹配；核对 draft、未审核状态、旧稿未变。禁止大段正文经模型重写后进入 SQL。

完整性口径：caseId、age、sex、complaint、五段 sections（history/exam/tests/diagnosis/plan）、两份 documents 的 source/text，共 13 项字符串，按固定顺序以 chr(31) 连接后做 MD5。校验仅证明传递一致，不表示医学审核通过。

正式页面需确认三例中文名称、版本和审核状态；重复提交同 ID+版本不得覆盖旧稿；原病例发布状态、历史训练及上一批神经系统草稿保留。

## 待审核

医学审核教师和日期尚未填写。材料中的日期、单位、病史与查体时间线、概括与检验值、鉴别依据与已有检查记录等差异随草稿保存，需由资料老师核对。药物方案保持来源记录，不自动生成处方或评分标准。
