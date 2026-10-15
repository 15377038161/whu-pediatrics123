import admissionSummaries from './admission-summaries.json';
import { patientAppearance } from './patient-appearance';
const summaries: Record<string, { age: string; sex: string; complaint: string }> = admissionSummaries;
// 学生侧公开病例目录（防透题收敛，2026-10-12 第一批任务1）：
// - 教师病例条目为客户端安全的中性目录（学科+序号），病种名/源病种名不进入本文件；
//   服务端按 id 解析原始事实（src/lib/teacher-case-data.ts），完成后经报告 caseTitle 释放病种名。
// - 本文件可被客户端组件引入（当前唯一目录来源：student 首页、病例库、训练台、报告列表），
//   仅允许脱敏接诊摘要（年龄、性别、主诉），禁止诊断、检查结果或完整患者事实。
// - 教师目录变更后运行 node scripts/gen-public-case-catalog.mjs 重新生成教师条目段。

export interface PublicCaseProfile {
  id: string;
  version: number;
  title: string;
  subtitle: string;
  category: string;
  presentingSymptoms: string[];
  age: string;
  sex: '男' | '女' | '待核验';
  difficulty: string;
  expectedMinutes: number;
  patientName: string;
  patientImage: string;
  patientAlt: string;
  contentStatus: 'flagship-fixture' | 'demo-pending-review' | 'teacher-materials-indexed' | 'teacher-catalog-only' | 'teacher-folder-only';
  /** 教师病例：与源病例的名称关系（alias 同名异拼 / subtype 具体亚型；null=无关联）。 */
  sourceRelation: 'alias' | 'subtype' | null;
  mediaCount?: number;
  documentCount?: number;
}

/** 教师条目精简结构（生成器产出，仅目录元数据）。 */
interface TeacherPublicEntry {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  sourceRelation: 'alias' | 'subtype' | null;
  contentStatus: PublicCaseProfile['contentStatus'];
  mediaCount: number;
  documentCount: number;
}

// 本段由 scripts/gen-public-case-catalog.mjs 生成（教师目录变更后需重新生成）：
// 教师病例条目为客户端安全中性目录——病种名/源病种名不进入本文件（防透题），
// 服务端按 id 解析原始事实（teacher-case-data），完成后经报告 caseTitle 释放病种名。
export const TEACHER_PUBLIC_ENTRIES: TeacherPublicEntry[] = [
  { id: "case-5a51b3c9-ea4a-4c1b-96f8-20a9b59e44b7", title: "营养性疾病 · 真实病例 01", subtitle: "关联真实亚型病例", category: "营养性疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-07b7d551-eb5c-47c8-9bb6-c55bb8869862", title: "新生儿与新生儿疾病 · 真实病例 01", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 85, documentCount: 1 },
  { id: "case-e750c5ff-d229-43a6-8314-2e633cacdc32", title: "新生儿与新生儿疾病 · 真实病例 02", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 4, documentCount: 3 },
  { id: "case-3797738a-1df1-4b5f-a982-bc48fa70ab52", title: "新生儿与新生儿疾病 · 真实病例 03", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 81, documentCount: 1 },
  { id: "case-d90e0254-6e2d-4016-9a0b-837c97005642", title: "新生儿与新生儿疾病 · 真实病例 04", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 336, documentCount: 2 },
  { id: "case-87fc430b-dd4e-4aa4-8437-aab1d4b840ab", title: "新生儿与新生儿疾病 · 真实病例 05", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 1 },
  { id: "case-261bbab2-9c2a-4c11-a9e3-988506741501", title: "新生儿与新生儿疾病 · 真实病例 06", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 3, documentCount: 1 },
  { id: "case-57ba1841-4e5b-485a-9b2a-8576a819a078", title: "新生儿与新生儿疾病 · 真实病例 07", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-db73006d-d876-4bea-bcbd-b9e8e1c1f907", title: "新生儿与新生儿疾病 · 真实病例 08", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 1 },
  { id: "case-0ea1580f-cfa1-4df9-893c-689eac1e5542", title: "新生儿与新生儿疾病 · 真实病例 09", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 163, documentCount: 1 },
  { id: "case-3f7233bb-9d2f-4554-b6b0-e6ce25024ea3", title: "新生儿与新生儿疾病 · 真实病例 10", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-05779155-1092-4607-a3d2-966ffc0fc718", title: "新生儿与新生儿疾病 · 真实病例 11", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 475, documentCount: 5 },
  { id: "case-46edc151-c7ef-4629-bfe0-1b6ecf6cfd57", title: "新生儿与新生儿疾病 · 真实病例 12", subtitle: "教师病例学习", category: "新生儿与新生儿疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1333, documentCount: 4 },
  { id: "case-e78cc1a1-1ee6-4305-bb42-399526ba139f", title: "免疫性疾病 · 真实病例 01", subtitle: "教师病例学习", category: "免疫性疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 10, documentCount: 6 },
  { id: "case-1c69a787-23f6-48f4-957a-1d44603e34d5", title: "免疫性疾病 · 真实病例 02", subtitle: "教师病例学习", category: "免疫性疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 2, documentCount: 1 },
  { id: "case-74392eef-a2ed-4c55-bafb-10ad7a7d474e", title: "免疫性疾病 · 真实病例 03", subtitle: "教师病例学习", category: "免疫性疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 5, documentCount: 4 },
  { id: "case-13fd5366-b7be-4dcc-8c2a-e00d28384b8c", title: "感染性疾病 · 真实病例 01", subtitle: "教师病例学习", category: "感染性疾病", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-f4d1d221-7d2e-4d18-b932-3e21274f3384", title: "消化系统疾病 · 真实病例 01", subtitle: "教师病例学习", category: "消化系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 3 },
  { id: "case-4892a278-1087-4947-a7ce-5ee3d27e910a", title: "消化系统疾病 · 真实病例 02", subtitle: "教师病例学习", category: "消化系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 3, documentCount: 2 },
  { id: "case-4d3ae886-e69b-4820-bc66-f5687506e26d", title: "消化系统疾病 · 真实病例 03", subtitle: "教师病例学习", category: "消化系统疾病", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-ead58f14-f79e-42bd-a52e-8e29bb9ba0da", title: "呼吸系统疾病 · 真实病例 01", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 2 },
  { id: "case-426e7756-2b7d-4c8e-a8f9-204a78105c2a", title: "呼吸系统疾病 · 真实病例 02", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 517, documentCount: 3 },
  { id: "case-53188ccd-1658-45f1-b0ec-5dd257a11676", title: "呼吸系统疾病 · 真实病例 03", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1, documentCount: 3 },
  { id: "case-171082d2-069e-46f7-8c4c-4cdaa5dacdf2", title: "呼吸系统疾病 · 真实病例 04", subtitle: "关联真实亚型病例", category: "呼吸系统疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-dd7c9327-fd9c-44db-bb24-614b4a50b58f", title: "呼吸系统疾病 · 真实病例 05", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 2 },
  { id: "case-9651f03b-8e9e-4fe7-9f51-b75ddbd1edd8", title: "呼吸系统疾病 · 真实病例 06", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-3a061e58-1306-4f33-be6b-c6ffa7917c87", title: "呼吸系统疾病 · 真实病例 07", subtitle: "关联真实亚型病例", category: "呼吸系统疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-ea9a434b-2f3c-41bc-a7b4-52c9ab3a52ea", title: "呼吸系统疾病 · 真实病例 08", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-d1d70aa5-eb74-4a74-8fb3-43b86f9804fa", title: "心血管系统疾病 · 真实病例 01", subtitle: "关联真实亚型病例", category: "心血管系统疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-e5d1cf25-c837-477f-b1bc-e42833d5ede5", title: "心血管系统疾病 · 真实病例 02", subtitle: "教师病例学习", category: "心血管系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 5971, documentCount: 5 },
  { id: "case-7dca12d4-c9e3-425f-9d2a-37d354a45d64", title: "泌尿系统疾病 · 真实病例 01", subtitle: "教师病例学习", category: "泌尿系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 1 },
  { id: "case-d7a6c222-26c2-47e2-90c3-caf409d78145", title: "泌尿系统疾病 · 真实病例 02", subtitle: "教师病例学习", category: "泌尿系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 4, documentCount: 3 },
  { id: "case-cdc10410-c8fb-4e54-903d-818c7ec93718", title: "泌尿系统疾病 · 真实病例 03", subtitle: "教师病例学习", category: "泌尿系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 2, documentCount: 2 },
  { id: "case-6d3b5195-2419-4734-be1e-a09ea948fe61", title: "泌尿系统疾病 · 真实病例 04", subtitle: "教师病例学习", category: "泌尿系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 3692, documentCount: 7 },
  { id: "case-5708dd67-b1c6-4fe0-a1dd-b79b53a0d521", title: "造血系统疾病 · 真实病例 01", subtitle: "教师病例学习", category: "造血系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 6, documentCount: 3 },
  { id: "case-92175c25-7eb2-4d22-a56c-21ef21b1be23", title: "造血系统疾病 · 真实病例 02", subtitle: "教师病例学习", category: "造血系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 1 },
  { id: "case-677d408e-a6a6-4e8d-ab06-a1365f15d97b", title: "造血系统疾病 · 真实病例 03", subtitle: "教师病例学习", category: "造血系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 2, documentCount: 1 },
  { id: "case-934c97ab-fe0c-4908-91ba-12ec837e4668", title: "造血系统疾病 · 真实病例 04", subtitle: "关联真实亚型病例", category: "造血系统疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-b6cc9ec3-74c5-47e6-bb03-ebd64b3b1bc6", title: "造血系统疾病 · 真实病例 05", subtitle: "教师病例学习", category: "造血系统疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 9 },
  { id: "case-42e1a808-2021-4b85-a8e2-edae74a9b299", title: "神经系统 · 真实病例 01", subtitle: "教师病例学习", category: "神经系统", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 87, documentCount: 4 },
  { id: "case-f4869d4e-d88b-475b-8e04-b6d299979062", title: "神经系统 · 真实病例 02", subtitle: "关联真实亚型病例", category: "神经系统", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-e708a448-8b01-4dfb-ae6b-b447ec2e4af3", title: "神经系统 · 真实病例 03", subtitle: "教师病例学习", category: "神经系统", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1904, documentCount: 5 },
  { id: "case-50acf9bc-a130-460d-a760-d67d0b5402f7", title: "神经系统 · 真实病例 04", subtitle: "教师病例学习", category: "神经系统", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1094, documentCount: 4 },
  { id: "case-cc4701b3-87f1-40ba-9c77-0beacf546c48", title: "神经系统 · 真实病例 05", subtitle: "教师病例学习", category: "神经系统", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1088, documentCount: 6 },
  { id: "case-5dc2a192-cda2-43d1-b547-c07908384ff9", title: "神经系统 · 真实病例 06", subtitle: "教师病例学习", category: "神经系统", sourceRelation: null, contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-9c03399f-1652-48f2-8c02-ceaca7a3d8a9", title: "神经系统 · 真实病例 07", subtitle: "教师病例学习", category: "神经系统", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-12c7efe2-9eb0-4283-b346-e4f96c0a663e", title: "内分泌疾病 · 真实病例 01", subtitle: "关联真实亚型病例", category: "内分泌疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-eb0abf40-2029-4490-8241-d4a98b94c6e4", title: "内分泌疾病 · 真实病例 02", subtitle: "教师病例学习", category: "内分泌疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 1811, documentCount: 4 },
  { id: "case-47e5a1f9-cb51-4b8b-bd7b-d9f224acd7b4", title: "内分泌疾病 · 真实病例 03", subtitle: "教师病例学习", category: "内分泌疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 0, documentCount: 5 },
  { id: "case-328109f0-8558-4a2b-9182-79ff2b5fe56d", title: "内分泌疾病 · 真实病例 04", subtitle: "教师病例学习", category: "内分泌疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 2, documentCount: 3 },
  { id: "case-da29f881-d2b2-410b-bd22-65de0fc1bb13", title: "内分泌疾病 · 真实病例 05", subtitle: "教师病例学习", category: "内分泌疾病", sourceRelation: "alias", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-8a7f2780-dd26-46cd-a96c-bee9ece1a6db", title: "遗传性疾病 · 真实病例 01", subtitle: "教师病例学习", category: "遗传性疾病", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 2020, documentCount: 4 },
  { id: "case-5197c841-12f4-4c6d-b3a9-f816fb68d91a", title: "遗传性疾病 · 真实病例 02", subtitle: "关联真实亚型病例", category: "遗传性疾病", sourceRelation: "subtype", contentStatus: 'teacher-catalog-only', mediaCount: 0, documentCount: 0 },
  { id: "case-647368e2-9bfa-463c-97c2-db8d867354a8", title: "急性中毒 · 真实病例 01", subtitle: "教师病例学习", category: "急性中毒", sourceRelation: null, contentStatus: 'teacher-materials-indexed', mediaCount: 3687, documentCount: 8 },
  { id: "case-beb0c090-f6be-4c20-bd79-d21544d88354", title: "内分泌疾病 · 真实病例 06", subtitle: "教师病例学习", category: "内分泌系统", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 1, documentCount: 3 },
  { id: "case-c3633068-d383-4b2e-a48a-2c53c6679e4a", title: "内分泌疾病 · 真实病例 07", subtitle: "教师病例学习", category: "内分泌系统", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 3, documentCount: 3 },
  { id: "case-25e26c63-3f38-4c27-9ea9-eda221c876d9", title: "呼吸系统疾病 · 真实病例 09", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 1, documentCount: 2 },
  { id: "case-6ba63d64-1a19-4765-a2ab-4ae687d5dd9a", title: "呼吸系统疾病 · 真实病例 10", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 480, documentCount: 2 },
  { id: "case-280837cf-54c4-4930-b40d-977ced5c1827", title: "呼吸系统疾病 · 真实病例 11", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 547, documentCount: 2 },
  { id: "case-47ea44a1-3edd-40a0-8d9b-7ca2dbfcaf5a", title: "呼吸系统疾病 · 真实病例 12", subtitle: "教师病例学习", category: "呼吸系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 331, documentCount: 4 },
  { id: "case-e3b0b49e-7b0a-4b97-a5c5-5e72b3604172", title: "心血管系统疾病 · 真实病例 03", subtitle: "教师病例学习", category: "心血管系统", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 6, documentCount: 2 },
  { id: "case-d7cb30cb-b1a5-477b-bb41-7833f3438887", title: "感染性疾病 · 真实病例 02", subtitle: "教师病例学习", category: "感染性疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 1, documentCount: 3 },
  { id: "case-fd688a62-f962-4048-ac59-da64b5be9657", title: "新生儿与新生儿疾病 · 真实病例 13", subtitle: "教师病例学习", category: "新生儿疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 2, documentCount: 1 },
  { id: "case-c47e726a-cd18-49ee-bc20-faa4d6ed566b", title: "消化系统疾病 · 真实病例 04", subtitle: "教师病例学习", category: "消化系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 305, documentCount: 4 },
  { id: "case-ef1adfc7-4097-4c41-9b3d-27777fec5c63", title: "神经系统 · 真实病例 08", subtitle: "教师病例学习", category: "神经系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 633, documentCount: 5 },
  { id: "case-5dedff4c-1766-4f40-bd23-ab03662617d6", title: "神经系统 · 真实病例 09", subtitle: "教师病例学习", category: "神经系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 869, documentCount: 8 },
  { id: "case-31db42f5-fcf2-4213-8675-8656b3b9e1b0", title: "神经系统 · 真实病例 10", subtitle: "教师病例学习", category: "神经系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 1441, documentCount: 3 },
  { id: "case-a3a869a1-23ca-40db-a47c-2bf731f0d1e6", title: "营养性疾病 · 真实病例 02", subtitle: "教师病例学习", category: "营养性疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 124, documentCount: 4 },
  { id: "case-3e0c843f-b420-4646-889f-352eb34d8e93", title: "造血系统疾病 · 真实病例 06", subtitle: "教师病例学习", category: "血液系统疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 10, documentCount: 2 },
  { id: "case-b115e85f-f023-4de5-ae96-dc4e788ad227", title: "遗传性疾病 · 真实病例 03", subtitle: "教师病例学习", category: "遗传性疾病", sourceRelation: null, contentStatus: 'teacher-folder-only', mediaCount: 167, documentCount: 5 },
];

export const CASE_CATALOG: PublicCaseProfile[] = [
  {
    id: 'peds-respiratory-001',
    version: 1,
    title: '3岁男童发热、咳嗽伴气促',
    subtitle: '儿童呼吸系统模拟病例',
    category: '呼吸系统',
    presentingSymptoms: ['发热', '咳嗽', '呼吸急促'],
    age: '3岁2个月',
    sex: '男',
    difficulty: '基础进阶',
    expectedMinutes: 12,
    patientName: '小宇',
    patientImage: '/media/clinical/virtual-child-front.png',
    patientAlt: '3岁虚拟男童正面站立于儿科诊室，精神欠佳、呼吸较快',
    contentStatus: 'flagship-fixture',
    sourceRelation: null,
  },
  {
    id: 'peds-wheeze-002',
    version: 1,
    title: '5岁女童发热、咳嗽伴喘息',
    subtitle: '儿童呼吸系统模拟病例',
    category: '呼吸系统',
    presentingSymptoms: ['发热', '咳嗽', '喘息'],
    age: '5岁4个月',
    sex: '女',
    difficulty: '基础进阶',
    expectedMinutes: 12,
    patientName: '小宁',
    patientImage: '/media/clinical/virtual-child-girl-standing-v2.png',
    patientAlt: '5岁虚拟女童正面站立于儿科诊室，轻度紧张并伴呼吸稍快',
    contentStatus: 'demo-pending-review',
    sourceRelation: null,
  },
  ...TEACHER_PUBLIC_ENTRIES.map((item): PublicCaseProfile => ({
    id: item.id,
    version: 1,
    title: summaries[item.id] ? `${summaries[item.id].age}${summaries[item.id].sex === '男' ? '男童' : summaries[item.id].sex === '女' ? '女童' : '患儿'}，${summaries[item.id].complaint}` : item.title,
    subtitle: item.subtitle,
    category: item.category,
    presentingSymptoms: summaries[item.id] ? [summaries[item.id].complaint] : [],
    age: summaries[item.id]?.age ?? '待核验',
    sex: summaries[item.id]?.sex === '男' ? '男' : summaries[item.id]?.sex === '女' ? '女' : '待核验',
    difficulty: item.contentStatus === 'teacher-catalog-only' && item.sourceRelation === null ? '病种自主研习' : '真实案例学习',
    expectedMinutes: 0,
    patientName: '小朋友',
    patientImage: patientAppearance(summaries[item.id]?.sex ?? '待核验','standing',item.id).src ?? '/media/clinical/virtual-child-unclassified.svg',
    patientAlt: '用于检查部位定位的教学示意模型，不代表原病例患儿外貌',
    contentStatus: item.contentStatus,
    sourceRelation: item.sourceRelation,
    mediaCount: item.mediaCount,
    documentCount: item.documentCount,
  })),
];

export function getPublicCase(caseId: string): PublicCaseProfile {
  const caseProfile = CASE_CATALOG.find((item) => item.id === caseId);
  if (!caseProfile) throw new Error('CASE_NOT_FOUND');
  return caseProfile;
}

/**
 * 目录外 caseId 降级查询（历史报告/归档会话展示用）：
 * 返回 null 而非抛错，调用方降级展示病例 ID；训练核心链路仍走 getPublicCase 硬防线。
 */
export function findPublicCase(caseId: string): PublicCaseProfile | null {
  return CASE_CATALOG.find((item) => item.id === caseId) ?? null;
}

export function isTrainableCase(caseId: string): boolean {
  return CASE_CATALOG.some((item) => item.id === caseId);
}
