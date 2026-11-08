# 67例资料制作与复验

私有材料及生成物不得进入Git/public。目录、Word和JSON均为教师资料；学生仅经既有鉴权与结果释放接口获得当前步骤内容。

## 制作顺序

1. 保留原件并记录53份源文件SHA256。通过教师目录和关联表产生67入口，登记每例原始版本和关联差异。
2. `pnpm exec tsx scripts/training/inventory-media.ts` 建立受控图片清单。`prepare-media.py` 从系列和DOCX中选取候选、OCR及裁剪；候选不能直接进入学生结果。
3. 图面核对后由 `finalize-media.py` 明确选择、排除、修正检查方式。图像定位必须区分CT、MRI、X线、超声和脑电等；不以一种图冒充另一种。保留原图哈希、处理副本哈希、裁剪范围和遮挡次数。原始绝对路径只在受控工作记录中，不交付客户端。
4. `pnpm exec tsx scripts/training/build-packages.ts` 生成本地安装包与67份JSON。新包将病史分成更小事实，保留时间、数值、否定与角色信息；治疗内容保留原记录，教学安全与鉴别另列，不擅改原患者用药剂量。
5. `render-report-images.py` 将既有客观结果或参考说明排为图，再运行 `build-packages.ts` 绑定。图中明确区分原始重排、模拟与参考，不把参考范围当成患者结果。
6. `pnpm exec tsx scripts/training/export-assets.ts` 整理11实体器材、4操作示意、20基础人物组合、实际用到的备选人物及局部SVG。新增AI素材不冒充患者照片，尚未医学审定的状态必须保留。
7. `build-documents.py` 用与运行时相同的JSON制作67份Word；同一整体原文可合并描述，完整局部矩阵留在JSON。每份包括人物、完整原记录、问法与知情边界、查体操作/反应、检查资料、诊疗、参考病历、每点评分和来源。
8. `render-documents.py` 调用文档工具的Word渲染器，全量渲染并记录每页检查；`verify-packages.ts` 验证版本、数量、量表、部位器材、媒体和原件未改；`verify-media.py` 做处理后OCR复检。

Python产物脚本使用随应用提供的文档运行时（python-docx、Pillow、pypdf）；Word渲染需要LibreOffice及Poppler，图像OCR需要Tesseract及chi_sim/eng。上述脚本默认Windows本地工具位置，换机器时按实际安装调整脚本工具路径，不改病例数据。

## 内容契约

每个教学包通过 `teachingPackageSchema` 校验。`origin` 必须明确为 `source`、`teaching-simulation` 或 `reference`。新内容更新包哈希后写成新文件；不覆盖已经绑定的包。

与服务器版本接入前，先通过原有教师快照恢复入口重算源文件指纹，再下载到受控本地目录比对。`compare-source-sets.ts <本地knowledge根目录> <服务器导出knowledge根目录> <私有输出.json>` 只输出版本及差异字段名称，不输出患者正文。指纹不同不能直接改教学包的sourceVersion冒充匹配；临床事实、绑定和来源差异须分别调查。DKA已有不可重算的激活版本须保留，不以最新可核验文件覆盖它。

`build-packages.ts`沿用`PEDIATRICS_KNOWLEDGE_ROOT`读取来源，`PEDIATRICS_TRAINING_PACKAGE_ROOT`指定新包目录，`PEDIATRICS_TRAINING_DELIVERY_ROOT`指定新的JSON/Word交付目录，`PEDIATRICS_TRAINING_AUTHORING_ROOT`指定图片索引、报告图索引、构建摘要和Word渲染记录目录。制作服务器适配版本时四个目录显式指向隔离位置；报告排图、Word制作和渲染脚本沿用这些变量。保留原资料、历史包和现有索引，不就地替换原来的67份文件。

私有运行资料使用`package-runtime.py --runtime <新版runtime> --knowledge <核验来源根目录> --output <新目录>`制作，不包含业务代码或让Coder实现/发布的提示词。`install-runtime.ts <分包目录> <项目knowledge内的新代次目录> --verify-only`先验证全部来源、教学版本、媒体及哈希；去掉`--verify-only`后只写该隔离代次，已有不同内容即拒绝，最后写索引，不改数据库或历史绑定。生产代码通过GitHub接收，私有分包经用户授权的项目私有文件通道传输，不经聊天附件或公开仓库。旧`build-coder-handoff.py`已退役并在本地备份，不再生成混合代码与原件的旧交接包。

沙箱工作区中被Git忽略的文件不等于有持久化保障。必须另验对象存储或受控私有挂载的重建路径；同一沙箱进程重启成功不能代替沙箱重新初始化后的恢复验收。

当前服务器适配代次的原图复用要求来源共享已核验原文且年龄/性别一致，3个存在人口资料差异的来源暂不复用旧图；检查文字和数值图按新来源重新生成。此为来源与格式核验，不能称作医学审定。分包通过`controlled-case-registry.ts`登记不可变对象、大小和SHA256，预览需显式配置`PEDIATRICS_TRAINING_RECOVERY=object-storage`，禁止将此开关当成绕过源/教学版本校验的手段。

教师源文件恢复的运行审计写在私有`knowledge/source-recovery-audits/<sha256>.json`，每次内容独立保存，不再覆盖Git中的旧日期审计记录。原有审计作为历史证据保留。

正常补充须核对病情。存在休克、低灌注、发绀、明显水肿、脱水、瘫痪等可能影响全身表现时，缺少局部证据优先给操作/参考说明，不能填成无异常。特殊检查无法可靠模拟时不补患者数值。模拟影像只示教，不考核其不能可靠表达的细微征象。

现有一例来源未记录性别，保留中性占位和文字设定，不自行指定男女照片。来源资料与补充文案未经逐例医学审定；不能把格式、哈希和工程测试通过写成临床审核通过。

教师下载步骤：从教师端“病例草稿”进入“固定病例包换版”，点击“恢复并下载核验原件”。接口按当前教师可见双表重新核验，原件包直接下载到受控本地；不要使用聊天附件、公开GitHub或公开文件目录传递。下载后核对响应的SHA256和包内文件清单，再运行来源差异比对。

## 复验命令

```powershell
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm exec tsx --test --test-concurrency=2 tests/*.test.ts
pnpm exec tsx scripts/training/verify-packages.ts
pnpm exec tsx scripts/training/validate-dialogues.ts
```

对话复验包括三个代表病例各20轮及第10轮后的序列化恢复；模型未配置时必须保留真实降级状态，不能把注入式单元测试或降级对话当作真实模型验收。浏览器复验应记录是否使用合成身份/请求适配器，分别验证手机、桌面、结果图和最终报告。

## 查体制作矩阵

使用 `pnpm exec tsx scripts/training/build-exam-matrix.ts <私有runtime> <outputs下目录>` 导出中文CSV及JSON。每例必须同时列重点操作、可接受同组操作、原记录/固定模拟/仅参考、具体所见、正常模板、动作反应、体位和源/教学双版本。准备操作独立列出；不能把EX_PREP当作局部器材配对。矩阵完整不表示所有参考行已变为患者正常结果。

否定词（如无发绀、无水肿）不应被关键词命中为全身异常。制作器仅修正风险判定，不改原文；重新生成必须使用新教学版本并保留旧版。Word制作摘要输出到PEDIATRICS_TRAINING_AUTHORING_ROOT，避免新代次覆盖旧制作审计。

通用素材导出仅包含人物、器材、背部示教模板和当前定位元数据，旧局部SVG画面已退役。教学矩阵、来源文件和完整答案禁止上传Git或放入public。
