export interface TeacherCaseCatalogItem {
  id: string;
  name: string;
  category: string;
  folder: string | null;
  mediaCount: number;
  documentCount: number;
  status: 'materials-indexed' | 'catalog-only' | 'folder-only';
  source: 'list' | 'folder';
}

export const TEACHER_CASE_CATALOG: TeacherCaseCatalogItem[] = [
  {
    "id": "teacher-单纯肥胖症",
    "name": "单纯肥胖症",
    "category": "营养性疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-新生儿呼吸窘迫综合征",
    "name": "新生儿呼吸窘迫综合征",
    "category": "新生儿与新生儿疾病",
    "folder": "knowledge/儿科常见病/新生儿疾病/新生儿呼吸窘迫综合征",
    "mediaCount": 85,
    "documentCount": 1,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-新生儿败血症",
    "name": "新生儿败血症",
    "category": "新生儿与新生儿疾病",
    "folder": "knowledge/儿科常见病/新生儿疾病/新生儿败血症",
    "mediaCount": 4,
    "documentCount": 3,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-新生儿高胆红素血症",
    "name": "新生儿高胆红素血症",
    "category": "新生儿与新生儿疾病",
    "folder": "knowledge/儿科常见病/新生儿疾病/新生儿高胆红素血症",
    "mediaCount": 81,
    "documentCount": 1,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-新生儿abo溶血性黄疸",
    "name": "新生儿ABO溶血性黄疸",
    "category": "新生儿与新生儿疾病",
    "folder": "knowledge/儿科常见病/新生儿疾病/新生儿ABO溶血性黄疸",
    "mediaCount": 336,
    "documentCount": 2,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-新生儿rh溶血性黄疸",
    "name": "新生儿RH溶血性黄疸",
    "category": "新生儿与新生儿疾病",
    "folder": "knowledge/儿科常见病/新生儿疾病/新生儿RH溶血性黄疸",
    "mediaCount": 0,
    "documentCount": 1,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-新生儿肺炎",
    "name": "新生儿肺炎",
    "category": "新生儿与新生儿疾病",
    "folder": "knowledge/儿科常见病/新生儿疾病/新生儿肺炎",
    "mediaCount": 3,
    "documentCount": 1,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-新生儿胎粪吸入肺炎",
    "name": "新生儿胎粪吸入肺炎",
    "category": "新生儿与新生儿疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-新生儿化脓性脑膜炎",
    "name": "新生儿化脓性脑膜炎",
    "category": "新生儿与新生儿疾病",
    "folder": "knowledge/儿科常见病/新生儿疾病/新生儿化脓性脑膜炎",
    "mediaCount": 0,
    "documentCount": 1,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-新生儿重度窒息",
    "name": "新生儿重度窒息",
    "category": "新生儿与新生儿疾病",
    "folder": "knowledge/儿科常见病/新生儿疾病/新生儿重度窒息",
    "mediaCount": 163,
    "documentCount": 1,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-新生儿脑梗死",
    "name": "新生儿脑梗死",
    "category": "新生儿与新生儿疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-先天性肾上腺皮质增生症",
    "name": "先天性肾上腺皮质增生症",
    "category": "新生儿与新生儿疾病",
    "folder": "knowledge/儿科常见病/新生儿疾病/先天性肾上腺皮质增生症",
    "mediaCount": 475,
    "documentCount": 5,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-新生儿缺血缺氧性脑病",
    "name": "新生儿缺血缺氧性脑病",
    "category": "新生儿与新生儿疾病",
    "folder": "knowledge/儿科常见病/新生儿疾病/新生儿缺血缺氧性脑病",
    "mediaCount": 1333,
    "documentCount": 4,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-风湿热",
    "name": "风湿热",
    "category": "免疫性疾病",
    "folder": "knowledge/儿科常见病/免疫系统疾病/风湿热",
    "mediaCount": 10,
    "documentCount": 6,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-过敏性紫癜",
    "name": "过敏性紫癜",
    "category": "免疫性疾病",
    "folder": "knowledge/儿科常见病/免疫系统疾病/过敏性紫癜",
    "mediaCount": 2,
    "documentCount": 1,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-川崎病",
    "name": "川崎病",
    "category": "免疫性疾病",
    "folder": "knowledge/儿科常见病/免疫系统疾病/川崎病",
    "mediaCount": 5,
    "documentCount": 4,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-传染行单核细胞增多症",
    "name": "传染行单核细胞增多症",
    "category": "感染性疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-轮状病毒性肠炎",
    "name": "轮状病毒性肠炎",
    "category": "消化系统疾病",
    "folder": "knowledge/儿科常见病/消化系统疾病/轮状病毒性肠炎",
    "mediaCount": 0,
    "documentCount": 3,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-细菌性肠炎",
    "name": "细菌性肠炎",
    "category": "消化系统疾病",
    "folder": "knowledge/儿科常见病/消化系统疾病/细菌性肠炎",
    "mediaCount": 3,
    "documentCount": 2,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-婴儿胆汁淤积症-巨细胞病毒",
    "name": "婴儿胆汁淤积症（巨细胞病毒）",
    "category": "消化系统疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-急性喉炎",
    "name": "急性喉炎",
    "category": "呼吸系统疾病",
    "folder": "knowledge/儿科常见病/消化系统疾病/急性喉炎",
    "mediaCount": 0,
    "documentCount": 2,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-异物吸入性窒息",
    "name": "异物吸入性窒息",
    "category": "呼吸系统疾病",
    "folder": "knowledge/儿科常见病/呼吸系统疾病/异物吸入性窒息",
    "mediaCount": 517,
    "documentCount": 3,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-急性喘息性支气管炎",
    "name": "急性喘息性支气管炎",
    "category": "呼吸系统疾病",
    "folder": "knowledge/儿科常见病/呼吸系统疾病/急性喘息性支气管炎",
    "mediaCount": 1,
    "documentCount": 3,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-毛细支气管炎",
    "name": "毛细支气管炎",
    "category": "呼吸系统疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-支气管哮喘",
    "name": "支气管哮喘",
    "category": "呼吸系统疾病",
    "folder": "knowledge/儿科常见病/呼吸系统疾病/支气管哮喘",
    "mediaCount": 0,
    "documentCount": 2,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-支气管肺炎",
    "name": "支气管肺炎",
    "category": "呼吸系统疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-大叶性肺炎",
    "name": "大叶性肺炎",
    "category": "呼吸系统疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-肺炎支原体性肺炎",
    "name": "肺炎支原体性肺炎",
    "category": "呼吸系统疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-心律失常-阵发性室上性心动过速",
    "name": "心律失常（阵发性室上性心动过速）",
    "category": "心血管系统疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-暴发性心肌炎",
    "name": "暴发性心肌炎",
    "category": "心血管系统疾病",
    "folder": "knowledge/儿科常见病/心血管系统/暴发性心肌炎",
    "mediaCount": 5971,
    "documentCount": 5,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-急性肾小球肾炎",
    "name": "急性肾小球肾炎",
    "category": "泌尿系统疾病",
    "folder": "knowledge/儿科常见病/泌尿系统疾病/急性肾小球肾炎",
    "mediaCount": 0,
    "documentCount": 1,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-肾病综合征",
    "name": "肾病综合征",
    "category": "泌尿系统疾病",
    "folder": "knowledge/儿科常见病/泌尿系统疾病/肾病综合征",
    "mediaCount": 4,
    "documentCount": 3,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-泌尿道感染",
    "name": "泌尿道感染",
    "category": "泌尿系统疾病",
    "folder": "knowledge/儿科常见病/泌尿系统疾病/泌尿道感染",
    "mediaCount": 2,
    "documentCount": 2,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-急性肾衰竭",
    "name": "急性肾衰竭",
    "category": "泌尿系统疾病",
    "folder": "knowledge/儿科常见病/泌尿系统疾病/急性肾衰竭",
    "mediaCount": 3692,
    "documentCount": 7,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-再生障碍性贫血",
    "name": "再生障碍性贫血",
    "category": "造血系统疾病",
    "folder": "knowledge/儿科常见病/血液系统疾病/再生障碍性贫血",
    "mediaCount": 6,
    "documentCount": 3,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-蚕豆病",
    "name": "蚕豆病",
    "category": "造血系统疾病",
    "folder": "knowledge/儿科常见病/血液系统疾病/蚕豆病",
    "mediaCount": 0,
    "documentCount": 1,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-特发性血小板减少性紫癜",
    "name": "特发性血小板减少性紫癜",
    "category": "造血系统疾病",
    "folder": "knowledge/儿科常见病/血液系统疾病/特发性血小板减少性紫癜",
    "mediaCount": 2,
    "documentCount": 1,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-急性白血病",
    "name": "急性白血病",
    "category": "造血系统疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-噬血细胞综合征",
    "name": "噬血细胞综合征",
    "category": "造血系统疾病",
    "folder": "knowledge/儿科常见病/血液系统疾病/噬血细胞综合征",
    "mediaCount": 0,
    "documentCount": 9,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-发热性惊厥",
    "name": "发热性惊厥",
    "category": "神经系统",
    "folder": "knowledge/儿科常见病/神经系统疾病/发热性惊厥",
    "mediaCount": 87,
    "documentCount": 4,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-癫痫",
    "name": "癫痫",
    "category": "神经系统",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-病毒性脑炎",
    "name": "病毒性脑炎",
    "category": "神经系统",
    "folder": "knowledge/儿科常见病/神经系统疾病/病毒性脑炎",
    "mediaCount": 1904,
    "documentCount": 5,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-化脓性脑膜炎",
    "name": "化脓性脑膜炎",
    "category": "神经系统",
    "folder": "knowledge/儿科常见病/神经系统疾病/化脓性脑膜炎",
    "mediaCount": 1094,
    "documentCount": 4,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-结核性脑炎",
    "name": "结核性脑炎",
    "category": "神经系统",
    "folder": "knowledge/儿科常见病/神经系统疾病/结核性脑炎",
    "mediaCount": 1088,
    "documentCount": 6,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-格林巴利综合征",
    "name": "格林巴利综合征",
    "category": "神经系统",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-先天性肌无力综合征",
    "name": "先天性肌无力综合征",
    "category": "神经系统",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-生长激素缺乏症-矮小症",
    "name": "生长激素缺乏症、矮小症",
    "category": "内分泌疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-中枢性尿崩症",
    "name": "中枢性尿崩症",
    "category": "内分泌疾病",
    "folder": "knowledge/儿科常见病/内分泌系统/中枢性尿崩症",
    "mediaCount": 1811,
    "documentCount": 4,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-外周性性早熟",
    "name": "外周性性早熟",
    "category": "内分泌疾病",
    "folder": "knowledge/儿科常见病/内分泌系统/外周性性早熟",
    "mediaCount": 0,
    "documentCount": 5,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-中枢性性早熟",
    "name": "中枢性性早熟",
    "category": "内分泌疾病",
    "folder": "knowledge/儿科常见病/内分泌系统/中枢性性早熟",
    "mediaCount": 2,
    "documentCount": 3,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-i型糖尿病伴有酮症酸中毒",
    "name": "I型糖尿病伴有酮症酸中毒",
    "category": "内分泌疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-肝豆状核变性",
    "name": "肝豆状核变性",
    "category": "遗传性疾病",
    "folder": "knowledge/儿科常见病/遗传性疾病/肝豆状核变性",
    "mediaCount": 2020,
    "documentCount": 4,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-糖原贮积病",
    "name": "糖原贮积病",
    "category": "遗传性疾病",
    "folder": null,
    "mediaCount": 0,
    "documentCount": 0,
    "status": "catalog-only",
    "source": "list"
  },
  {
    "id": "teacher-急性百草枯中毒",
    "name": "急性百草枯中毒",
    "category": "急性中毒",
    "folder": "knowledge/儿科常见病/急性中毒/急性百草枯中毒",
    "mediaCount": 3687,
    "documentCount": 8,
    "status": "materials-indexed",
    "source": "list"
  },
  {
    "id": "teacher-1型糖尿病伴有酮症酸中毒",
    "name": "1型糖尿病伴有酮症酸中毒",
    "category": "内分泌系统",
    "folder": "knowledge/儿科常见病/内分泌系统/1型糖尿病伴有酮症酸中毒",
    "mediaCount": 1,
    "documentCount": 3,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-矮小症",
    "name": "矮小症",
    "category": "内分泌系统",
    "folder": "knowledge/儿科常见病/内分泌系统/矮小症",
    "mediaCount": 3,
    "documentCount": 3,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-急性毛细支气管炎",
    "name": "急性毛细支气管炎",
    "category": "呼吸系统疾病",
    "folder": "knowledge/儿科常见病/呼吸系统疾病/急性毛细支气管炎",
    "mediaCount": 1,
    "documentCount": 2,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-肺不张",
    "name": "肺不张",
    "category": "呼吸系统疾病",
    "folder": "knowledge/儿科常见病/呼吸系统疾病/肺不张",
    "mediaCount": 480,
    "documentCount": 2,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-肺炎支原体肺炎",
    "name": "肺炎支原体肺炎",
    "category": "呼吸系统疾病",
    "folder": "knowledge/儿科常见病/呼吸系统疾病/肺炎支原体肺炎",
    "mediaCount": 547,
    "documentCount": 2,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-重症肺炎",
    "name": "重症肺炎",
    "category": "呼吸系统疾病",
    "folder": "knowledge/儿科常见病/呼吸系统疾病/重症肺炎",
    "mediaCount": 331,
    "documentCount": 4,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-心律失常-室上性心动过速",
    "name": "心律失常 室上性心动过速",
    "category": "心血管系统",
    "folder": "knowledge/儿科常见病/心血管系统/心律失常 室上性心动过速",
    "mediaCount": 6,
    "documentCount": 2,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-传染性单核细胞增多症",
    "name": "传染性单核细胞增多症",
    "category": "感染性疾病",
    "folder": "knowledge/儿科常见病/感染性疾病/传染性单核细胞增多症",
    "mediaCount": 1,
    "documentCount": 3,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-新生儿胎粪吸入性肺炎",
    "name": "新生儿胎粪吸入性肺炎",
    "category": "新生儿疾病",
    "folder": "knowledge/儿科常见病/新生儿疾病/新生儿胎粪吸入性肺炎",
    "mediaCount": 2,
    "documentCount": 1,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-婴儿胆汁淤积症-巨细胞病毒感染",
    "name": "婴儿胆汁淤积症（巨细胞病毒感染）",
    "category": "消化系统疾病",
    "folder": "knowledge/儿科常见病/消化系统疾病/婴儿胆汁淤积症（巨细胞病毒感染）",
    "mediaCount": 305,
    "documentCount": 4,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-中枢神经系统脱髓鞘病",
    "name": "中枢神经系统脱髓鞘病",
    "category": "神经系统疾病",
    "folder": "knowledge/儿科常见病/神经系统疾病/中枢神经系统脱髓鞘病",
    "mediaCount": 633,
    "documentCount": 5,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-先天性肌无力",
    "name": "先天性肌无力",
    "category": "神经系统疾病",
    "folder": "knowledge/儿科常见病/神经系统疾病/先天性肌无力",
    "mediaCount": 869,
    "documentCount": 8,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-癫痫全面性发作阵挛性发作",
    "name": "癫痫全面性发作阵挛性发作",
    "category": "神经系统疾病",
    "folder": "knowledge/儿科常见病/神经系统疾病/癫痫全面性发作阵挛性发作",
    "mediaCount": 1441,
    "documentCount": 3,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-儿童-肥胖症",
    "name": "儿童 肥胖症",
    "category": "营养性疾病",
    "folder": "knowledge/儿科常见病/营养性疾病/儿童 肥胖症",
    "mediaCount": 124,
    "documentCount": 4,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-急性白血病-急性淋巴细胞白血病",
    "name": "急性白血病-急性淋巴细胞白血病",
    "category": "血液系统疾病",
    "folder": "knowledge/儿科常见病/血液系统疾病/急性白血病-急性淋巴细胞白血病",
    "mediaCount": 10,
    "documentCount": 2,
    "status": "folder-only",
    "source": "folder"
  },
  {
    "id": "teacher-糖原贮积病iv型",
    "name": "糖原贮积病IV型",
    "category": "遗传性疾病",
    "folder": "knowledge/儿科常见病/遗传性疾病/糖原贮积病IV型",
    "mediaCount": 167,
    "documentCount": 5,
    "status": "folder-only",
    "source": "folder"
  }
];
