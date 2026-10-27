# 病例图片受控绑定

`scripts/case-audit/bind-case-media.mts` 只供既有授权对象存储的受控导入使用，不自动检查图片隐私或确认医学用途。原图提取、使用权限、全图隐私及检查操作对应关系须先有真实审核记录，不得批量写“approved”代替审核。

每个 `images[]` 除 `file/testId/caption`，必须提供私有 `review` 收据，包含：

- `caseId`、`candidateSha256`、`sourceDocumentSha256`、`testId`，精确对应入口、候选、原件和触发操作。
- `imageSha256`，对应即将上传的完整图片字节；`captionSha256`，对应图注原始字符串的UTF-8字节。
- `reviewer`、ISO `reviewedAt`、`privacyStatus: approved`、`usageAuthorized: true`、`purposeStatus: approved`。这是已有审核的记录，不是脚本的审核结论。

所有图片先完成整批检查才创建 `StorageClient`。任一收据缺失、图片/图注/候选/来源/操作变化则拒绝整批，避免前几张已上传才发现后续未审核。当前仅接受PNG/JPEG，图片名不能跨目录。实际上传复用预检过的内存字节，避免读文件两次导致批准内容与上传内容不同。存储名使用图片哈希，控制台只输出数量、哈希短前缀与操作ID，不输出原文件名、患者事实或访问链接。

收据、spec、叠加层及原图仍是私有材料，存放Git忽略目录，不纳入公共仓库。脚本不会更改候选原件；生成叠加层也不代表生产导入或学生实际显示通过。仍需按新版本导入、操作解锁、授权加载、实际显示、解释与报告关联逐项验收。旧历史会话继续绑定原版本。

回归：`pnpm exec tsx --test tests/media-binding-review.test.ts`，覆盖缺审核、未批准隐私/用途/权限、图片更换、候选/来源/图注/触发变化。合成收据仅用于本地测试，不得用于真实图片。
