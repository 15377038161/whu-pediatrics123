# 病例图片受控绑定

`scripts/case-audit/bind-case-media.mts` 只供既有授权对象存储的受控导入使用，不自动检查图片隐私或确认医学用途。原图提取、使用权限、全图隐私及检查操作对应关系须先有真实审核记录，不得批量写“approved”代替审核。

每个 `images[]` 除 `file/testId/caption`，必须提供私有 `review` 收据，包含：

- `caseId`、`candidateSha256`、`sourceDocumentSha256`、`testId`，精确对应入口、候选、原件和触发操作。
- `imageSha256`，对应即将上传的完整图片字节；`captionSha256`，对应图注原始字符串的UTF-8字节。
- `reviewer`、ISO `reviewedAt`、`privacyStatus: approved`、`usageAuthorized: true`、`purposeStatus: approved`。这是已有审核的记录，不是脚本的审核结论。

所有图片先完成整批检查才创建 `StorageClient`。任一收据缺失、图片/图注/候选/来源/操作变化则拒绝整批，避免前几张已上传才发现后续未审核。当前仅接受PNG/JPEG，图片名不能跨目录。实际上传复用预检过的内存字节，避免读文件两次导致批准内容与上传内容不同。存储名使用图片哈希，控制台只输出数量、哈希短前缀与操作ID，不输出原文件名、患者事实或访问链接。

收据、spec、叠加层及原图仍是私有材料，存放Git忽略目录，不纳入公共仓库。脚本不会更改候选原件；生成叠加层也不代表生产导入或学生实际显示通过。仍需按新版本导入、操作解锁、授权加载、实际显示、解释与报告关联逐项验收。旧历史会话继续绑定原版本。

回归：`pnpm exec tsx --test tests/media-binding-review.test.ts`，覆盖缺审核、未批准隐私/用途/权限、图片更换、候选/来源/图注/触发变化。合成收据仅用于本地测试，不得用于真实图片。

图库同时处理签名链接请求失败及图片网络/解码失败，显示“重新加载图片”按钮。按钮仅重新调用当前会话已释放媒体的签名链接API，不重跑查体或检查下单。会话ID与fileId共同作为组件身份，切换会话重新取链接，卸载后旧请求不得写回。2026-10-27受控浏览器合成组件检查已复现旧版破图无重试入口，修复后两种失败均可显式重取并实际显示合成图；这不代表真实存储、OAuth或病例原图显示已验。

大量序列图按每组6张查看，仅为当前组请求签名链接；不是只给所有图片加lazy属性后仍同时请求整套链接。切换会话回到首组。合成浏览器8张图检查：首组6次请求、下一组新增2次，其他真实序列的用途仍待审核。

私有持久化：新增迁移 `20261027114509_case_snapshot_private_binding_config.sql` 在既有教师专用 `case_snapshot_answers` 增加可空 `binding_config`，保存精确版本的 `testMedia/examMedia/testRelease`。普通facts载荷仍不含这些字段；不改RLS/GRANT/RPC、不自动回填旧版本。迁移要求精确tenant、既有answers表及RLS已开启。未执行该迁移时，带配置的导入在写facts之前失败；无配置旧病例不新增列依赖。已存在同版本但缺配置或内容不同的行报 `SNAPSHOT_BINDING_CONFIG_MISSING_OR_CONFLICT`，不得记为unchanged或静默填旧历史。

检查结果释放：迁移 `20261027124136_case_test_private_media_release.sql` 只替换既有 `case_snapshot_get_test`，保留本人会话、入口、精确版本、已下单及固定来源映射，ACL不变。私有配置从answers关联读取；未到配置的回报阶段（含未知阶段）仅返回待回报及说明，不返回结果或媒体。到阶段后只返回该已下单项目的结果和图片fileId/类型/图注，不返回其他项目或存储URL。应用解码与引擎保留待回报单据，待回报不解锁证据、不挂图；再次申请实际获准后才随事件挂载图。一般facts投影仍不带绑定配置。

查体图片：迁移 `20261027134242_case_exam_media_evidence_projection.sql` 保留既有facts RPC归属/入口/版本守卫与ACL，只从私有配置投影已保存的正确EXAM_ACTION对应图片。必须同时存在对应unlockedEvidence与事件evidenceCodes；手卫生、错误操作及其他查体图不释放。遗留facts若误含绑定字段也先剥离，再按证据加入已释放examMedia；URL和额外属性不进入投影。完成会话也不自动放出未执行操作的图片。

读取会话时，repository按精确绑定版本把这些媒体补到已有正确事件，保留事件ID，不创建操作、证据或替换历史事件已冻结媒体。有效来源查体写入后，turn响应重新读取同一repository投影，立即显示获准图片；普通刷新及复盘使用同一读取路径。教师督导保持既有RLS授权的私有读取，学生不使用教师全量缓存。

报告新生成时保存sourceSnapshotVersion，评分关联图片仅回放该报告eventIds对应的已释放事件，并再次核同一sessionId与材料版本。版本冲突不显示图片，可显式重试；历史报告无材料版本时明确提示，不按当前库猜图。不使用报告页面绕过媒体签名链接API。

发布仍待真实验收：上述链路已在隔离Postgres、独立进程磁盘重开和合成浏览器组件验证；生产数据库冷恢复、真实OAuth、对象存储授权及原图隐私/用途尚未验收，不得称全库可直接上线。部署须核当前实际迁移状态，依次执行入口/来源键修复→私有列→检查媒体释放→查体证据投影；不能凭本地测试假定生产已执行。

隔离验证：`pnpm exec tsx --test tests/case-binding-persistence.test.ts` 实际执行PostgreSQL迁移及jsonb往返，检查旧NULL不变、合成学生RLS拒绝、教师读取、权限不变、重放与错误tenant拒绝。它不证明生产迁移或真实OAuth身份验收。

检查释放回归：`pnpm exec tsx --test tests/case-test-media-release.test.ts tests/test-order-failure.test.ts` 覆盖14关联入口、错归属/入口/版本/未下单/匿名、待回报无结果无图、到阶段仅本项图片、普通facts无绑定、URL剥离、ACL不变和迁移重放。使用隔离PGlite及合成RPC缝，重复绑定读取不等于生产进程冷重启。

查体投影回归：`pnpm exec tsx --test tests/case-exam-media-projection.test.ts`。磁盘冷恢复使用两个独立命令：先 `pnpm exec tsx scripts/verify-case-media-coldstart-local.ts seed output/<新的合成数据库目录>`，进程退出后再以 `reopen` 与同一目录运行。脚本拒绝重置已存在库，只允许output内部路径，剔除真实平台配置；适配器仅监听127.0.0.1临时端口，使用非JWT合成标记，不调用真实身份或存储服务。重开覆盖实际RPC→SDK→repository→引擎→事件保存/再读→报告版本及事件关联，同时存在的其他版本不会替换旧图。这是本地工程证据。
