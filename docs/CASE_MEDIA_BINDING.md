# 病例图片受控绑定

本聊天用户已确认教师材料使用授权。脚本不再要求逐图隐私批准作为补全或受控教师试用的前置条件；授权不表示已做视觉核对或医学确认。仍须亲自核对正确病例、时点、检查用途及触发操作，不能批量填写虚假用途批准。

`scripts/case-audit/bind-case-media.mts <spec.json>` 复用既有StorageClient与受控存储。每个images[]包含file/testId/caption/sourcePath/source/review；sourcePath为私有原件实际路径。source区分：

若材料已经存在同项目存储，可附`existingFileId`复用登记，避免重复上传。仍执行完整原件/候选/用途核对，并通过SDK `getFile`取得短期链接、实际下载核对全部字节；仅文件名相同、拿到ID、浏览器能解码或本地有一份同名文件均不够。所有复用对象必须在任何新上传前校验完；任一失败整批停止，不自动改为重新上传。链接不输出或写入收据。复用读取限20秒、长度不得超过已核原图，错误只报`MEDIA_REGISTERED_MISMATCH`。

- 独立图：`{kind: "standalone-image", originalSha256, locatorSha256}`。locatorSha256取绝对原件路径以正斜杠规范化后的UTF-8 SHA256；实际读取原件并核对完整字节与上传内容一致，不填写DOCX来源。
- DOCX内嵌图：`{kind: "document-embedded", documentSha256, archiveEntry: "word/media/image1.png"}`。实际读取源文件核SHA，并解出指定ZIP条目逐字节比较。PDF图片尚无该工具的来源校验器，不能伪装为DOCX条目。

review保存caseId/candidateSha256/source/testId/imageSha256/captionSha256，以及真实用途核对人reviewer、reviewedAt、purposeStatus: approved、usageAuthorized: true。authorization包含basis: user-confirmed-teacher-authorization、confirmedAt和指向本次人工确认的reference；privacyStatus可缺省或如实unreviewed，不自动写approved。source必须与本图一致，任何候选/图注/触发/原件变动都须重新核对，不沿用旧收据。旧sourceDocxSha256及强制隐私批准格式停止使用，旧私有spec需依据真实来源重建，不能机械补假字段。

整批核验通过才创建StorageClient，上传复用预检内存字节。收据/spec/原图/叠加层均留Git忽略的私有目录；输出叠加层每个provenance保留来源和收据，候选原件不改。日志只输出数量、哈希前缀和操作ID。生成叠加层不代表已导入、实际显示或全流程通过，仍按新版本及历史绑定规则验收。

回归：`pnpm exec tsx --test tests/media-binding-review.test.ts`。覆盖教师确认授权且视觉未审可通过、独立图无需DOCX、缺授权/用途未核/候选图注触发变动拒绝，以及真实源字节/定位和DOCX错条目拒绝；测试材料全为合成，不用于真实素材。

图库同时处理签名链接请求失败及图片网络/解码失败，显示“重新加载图片”按钮。按钮仅重新调用当前会话已释放媒体的签名链接API，不重跑查体或检查下单。会话ID与fileId共同作为组件身份，切换会话重新取链接，卸载后旧请求不得写回。2026-10-27受控浏览器合成组件检查已复现旧版破图无重试入口，修复后两种失败均可显式重取并实际显示合成图；这不代表真实存储、OAuth或病例原图显示已验。

大量序列图按每组6张查看，仅为当前组请求签名链接；不是只给所有图片加lazy属性后仍同时请求整套链接。切换会话回到首组。合成浏览器8张图检查：首组6次请求、下一组新增2次，其他真实序列的用途仍待审核。

私有持久化：新增迁移 `20261027114509_case_snapshot_private_binding_config.sql` 在既有教师专用 `case_snapshot_answers` 增加可空 `binding_config`，保存精确版本的 `testMedia/examMedia/testRelease`。普通facts载荷仍不含这些字段；不改RLS/GRANT/RPC、不自动回填旧版本。迁移要求精确tenant、既有answers表及RLS已开启。未执行该迁移时，带配置的导入在写facts之前失败；无配置旧病例不新增列依赖。已存在同版本但缺配置或内容不同的行报 `SNAPSHOT_BINDING_CONFIG_MISSING_OR_CONFLICT`，不得记为unchanged或静默填旧历史。

检查结果释放：迁移 `20261027124136_case_test_private_media_release.sql` 只替换既有 `case_snapshot_get_test`，保留本人会话、入口、精确版本、已下单及固定来源映射，ACL不变。私有配置从answers关联读取；未到配置的回报阶段（含未知阶段）仅返回待回报及说明，不返回结果或媒体。到阶段后只返回该已下单项目的结果和图片fileId/类型/图注，不返回其他项目或存储URL。应用解码与引擎保留待回报单据，待回报不解锁证据、不挂图；再次申请实际获准后才随事件挂载图。一般facts投影仍不带绑定配置。

查体图片：迁移 `20261027134242_case_exam_media_evidence_projection.sql` 保留既有facts RPC归属/入口/版本守卫与ACL，只从私有配置投影已保存的正确EXAM_ACTION对应图片。必须同时存在对应unlockedEvidence与事件evidenceCodes；手卫生、错误操作及其他查体图不释放。遗留facts若误含绑定字段也先剥离，再按证据加入已释放examMedia；URL和额外属性不进入投影。完成会话也不自动放出未执行操作的图片。

读取会话时，repository按精确绑定版本把这些媒体补到已有正确事件，保留事件ID，不创建操作、证据或替换历史事件已冻结媒体。有效来源查体写入后，turn响应重新读取同一repository投影，立即显示获准图片；普通刷新及复盘使用同一读取路径。教师督导保持既有RLS授权的私有读取，学生不使用教师全量缓存。

报告新生成时保存sourceSnapshotVersion，评分关联图片仅回放该报告eventIds对应的已释放事件，并再次核同一sessionId与材料版本。版本冲突不显示图片，可显式重试；历史报告无材料版本时明确提示，不按当前库猜图。不使用报告页面绕过媒体签名链接API。

发布仍待真实验收：上述链路已在隔离Postgres、独立进程磁盘重开和合成浏览器组件验证；生产数据库冷恢复、真实OAuth、对象存储实际访问及原图用途尚未验收；教师使用授权已确认，不得称全库可直接上线。部署须核当前实际迁移状态，依次执行入口/来源键修复→私有列→检查媒体释放→查体证据投影；不能凭本地测试假定生产已执行。

隔离验证：`pnpm exec tsx --test tests/case-binding-persistence.test.ts` 实际执行PostgreSQL迁移及jsonb往返，检查旧NULL不变、合成学生RLS拒绝、教师读取、权限不变、重放与错误tenant拒绝。它不证明生产迁移或真实OAuth身份验收。

检查释放回归：`pnpm exec tsx --test tests/case-test-media-release.test.ts tests/test-order-failure.test.ts` 覆盖14关联入口、错归属/入口/版本/未下单/匿名、待回报无结果无图、到阶段仅本项图片、普通facts无绑定、URL剥离、ACL不变和迁移重放。使用隔离PGlite及合成RPC缝，重复绑定读取不等于生产进程冷重启。

查体投影回归：`pnpm exec tsx --test tests/case-exam-media-projection.test.ts`。磁盘冷恢复使用两个独立命令：先 `pnpm exec tsx scripts/verify-case-media-coldstart-local.ts seed output/<新的合成数据库目录>`，进程退出后再以 `reopen` 与同一目录运行。脚本拒绝重置已存在库，只允许output内部路径，剔除真实平台配置；适配器仅监听127.0.0.1临时端口，使用非JWT合成标记，不调用真实身份或存储服务。重开覆盖实际RPC→SDK→repository→引擎→事件保存/再读→报告版本及事件关联，同时存在的其他版本不会替换旧图。这是本地工程证据。
