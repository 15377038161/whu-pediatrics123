# 本地教学包接口与版本契约

复用现有 `/api/sessions`、`/api/agent/turn`、`/api/sessions/[id]/finish` 和 `/api/sessions/[id]/media`，不增设平行引擎、不新增数据库迁移。新增状态随现有 `training_sessions.state` 保存。

## 会话内部状态

`sourceSnapshotVersion` 固定原始病例版本；`teachingPackageVersion` 固定教学补充版本。只有新会话且两者匹配才绑定本地包。历史会话缺少教学版本时仍按原资料读取。已绑定的旧包保留，更新当前索引不会改变旧会话。

`roleState` 在私有病例包中登记年龄与明确意识/语言受限的角色约束，不能将婴儿或原记录不能交流的患儿编成能完整答话。

`dialogueMemory` 包含当前主题、实际披露事实编号、待澄清问题和已有顾虑，仅服务端使用，学生投影删除。角色规划、未披露事实、答案、原件路径均不下发。`examPosition` 记录实际体位；`examPosture` 保留原始人物素材/历史事件的站立或仰卧语义。

新包中 `ASK_QUESTION` 与 `SEND_COMMUNICATION` 共用同一角色管线，按本轮内容识别补问和解释；阶段不会回退。解释只提供已披露事实并累计 `communication`，不能用纯礼貌回应获取病史分。

## 查体事件

```json
{
  "type": "EXAM_ACTION",
  "data": {
    "toolId": "stethoscope",
    "bodyPartId": "right-lung-back",
    "posture": "supine",
    "position": "lateral",
    "location": {"side":"right","aspect":"back"}
  }
}
```

`position` 可为 `standing/supine/sitting/lateral/prone`；`location.side` 可为 `left/right/both/midline`。新增字段可选，旧事件仍可解释。新包的 `allowedPositions` 决定实际体位可达性；原 `postures` 保留旧素材和历史规则。服务端核对部位、左右前后、体位及准备条件，失败不释放结果或媒体。

旧粗部位编号不自动扩充成新的分区阳性所见。同一原始整体记录可供不同局部入口回看，但结果标明范围限制，评分使用同一证据码去重。未独立分区的资料不能自动定位到某个肺野。

## 检查与媒体

沿用文本申请 `ORDER_TEST`，检查目录不下发学生。当前申请解析到教学包中的固定结果，结果随事件释放。旧 `testId` 也从当前绑定教学定义中解析。重复申请回看同一结果，不重复得证据。

新包的内部 `testRequests` 记录每个独立申请幂等键、项目、目的和时点；学生会话投影删除。最终反馈才输出每项申请次数与目的。重复按钮提交沿用同一幂等键时不累计次数，新的复查意图仍只回看固定教学结果，不冒充新标本数值。

`ClinicalEvent.testReport` 只在对应检查结果实际释放后附加：检查名、标本说明、原始指标/数值/单位/时点、参考信息及来源。未申请时不下发；单位或标本原文未注明时明确说明，不凭经验填成患者数据。

媒体标识为 `training-media:<sha256>`。接口先验证身份、会话归属和已释放登记，再核对私有PNG哈希、大小；返回中性图注及图片数据，不返回原件路径、含诊断的文件名或下载原件入口。没有释放的标识不可探测。

## 结束后的评分

`TrainingReport.teachingFeedback` 保存教学版本、基础/提高得分、可评价满分、逐项状态、可接受表达和检查必要性说明。它不覆盖 `totalScore`，也不参与正式成绩同步和历史重算。素材缺失、病历读取失败等记录为 `not_assessable`。

每点仅100%/50%/0%三档；实际事实证据不足时不能以模型引用或“提交过”代替。关键安全点识别明确危险表达，正确拒绝危险措施不因此扣分。具体规则与例子随包版本固定。

## 图片点选查体交互

人物大部位与局部照片定位点调用同一个EXAM_ACTION，不新增接口或客户端答案表。器材栏不按当前部位预先过滤；服务端对新包和仅有源记录的会话均区分器材错配与资料缺失。腋温、额温、耳温使用独立编号和图像。OSCE保持临床方向提示关闭，客户端可显示服务端已公开的操作失败事件摘要，不能下发未释放体征或标准答案。

照片坐标属于通用素材元数据，不能当成病例体征。照片、部位、器材改变后当前结果卡清空，已释放事件留在同一会话记录。详细实施见EXAM_INTERACTION.md。

## 教师核验原件下载

既有`POST /api/teacher/case-snapshot-archive`接受`RESTORE_AND_EXPORT_CASE_SOURCES`确认短语。沿用服务端getUser身份校验、教师角色、现有白名单及用户身份RLS客户端；只查固定53份来源，逐版本重算双表指纹。先按原规则恢复私有源文件，再返回`application/zip`附件。普通恢复请求仍只返回脱敏计数，不接收客户端病例正文或文件路径。

附件包含当前来源、可核验版本档案、固定包清单和逐文件哈希；不导出任意服务器文件。响应使用`private, no-store`与中性文件名，`X-Content-SHA256`、`X-Case-Source-Count`和`X-Case-Version-Count`用于下载核对。来源缺失、冲突或指纹不符时不给出原件包。该入口仅供授权教师把原件保存到受控本地，学生接口不提供此下载。
# 私有运行代次恢复

预览配置`PEDIATRICS_TRAINING_RECOVERY=object-storage`时，沿用`ensureControlledCaseBundle`从代码登记的不可变对象恢复来源及教学包；只接受各自重算一致的版本。该设置仅控制私有文件读取，不授权数据库导入、发布或历史重评。源已恢复但教学包未恢复时继续核验教学代次；不将16位源版本误传为20位教学版本。媒体分包以全部登记成员校验后再释放单项像素，客户端仍只接收当前会话已释放的中性媒体标识。


## 单画布与重复查体

沿用 `EXAM_ACTION`。成功事件增加可选 `examAction`：toolId、bodyPartId、position、location（side/aspect）、prepared、phase；失败事件另记failure类别。它只描述实际发生的操作，不下发隐藏配对矩阵。旧事件无此字段时不自动补定位。相同操作重复请求返回 `repeated:true`、`feedback:null`、空newMessages，不再添加临床事件；同clientEventId重试也使用此标识。客户端据此禁止重新弹窗和播报，历史结果从记录抽屉读取。

新会话先完成受控代次来源加载，再选择来源版本；显式活动绑定始终优先，恢复来源不能覆盖它。恢复注册按代次顺序执行，已加载旧代次不阻止后续新代次核验。此过程不写活动绑定或历史成绩。
