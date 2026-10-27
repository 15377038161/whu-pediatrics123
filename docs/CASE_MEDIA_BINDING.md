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

私有持久化：新增迁移 `20261027114509_case_snapshot_private_binding_config.sql` 在既有教师专用 `case_snapshot_answers` 增加可空 `binding_config`，保存精确版本的 `testMedia/examMedia/testRelease`。普通facts载荷仍不含这些字段；不改RLS/GRANT/RPC、不自动回填旧版本。迁移要求精确tenant、既有answers表及RLS已开启。未执行该迁移时，带配置的导入在写facts之前失败；无配置旧病例不新增列依赖。已存在同版本但缺配置或内容不同的行报 `SNAPSHOT_BINDING_CONFIG_MISSING_OR_CONFLICT`，不得记为unchanged或静默填旧历史。

发布仍待配套：持久化只是第一段，学生受控释放/恢复与行级结果解码尚未接上新私有列，不得声称图片链已修复或直接导入上线。不能仅将三字段加入现有facts对象：当前学生RPC在裁剪sections后仍返回其他顶层字段，会提前暴露未释放媒体。后续必须配套按归属/版本/操作/阶段保护投影、结果解码及冷恢复回归。旧图已授权与新代码发布分别记录。

隔离验证：`pnpm exec tsx --test tests/case-binding-persistence.test.ts` 实际执行PostgreSQL迁移及jsonb往返，检查旧NULL不变、合成学生RLS拒绝、教师读取、权限不变、重放与错误tenant拒绝。它不证明生产迁移或真实OAuth身份验收。
