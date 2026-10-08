// Exact spelling variants and source subtypes. Subtypes retain their actual title.
export const TEACHER_CASE_LINKS: Record<string, { sourceId: string; relation: 'alias' | 'subtype' }> = {
  'teacher-单纯肥胖症': { sourceId: 'teacher-儿童-肥胖症', relation: 'subtype' },
  'teacher-新生儿胎粪吸入肺炎': { sourceId: 'teacher-新生儿胎粪吸入性肺炎', relation: 'alias' },
  'teacher-传染行单核细胞增多症': { sourceId: 'teacher-传染性单核细胞增多症', relation: 'alias' },
  'teacher-婴儿胆汁淤积症-巨细胞病毒': { sourceId: 'teacher-婴儿胆汁淤积症-巨细胞病毒感染', relation: 'alias' },
  'teacher-毛细支气管炎': { sourceId: 'teacher-急性毛细支气管炎', relation: 'subtype' },
  'teacher-大叶性肺炎': { sourceId: 'teacher-肺炎支原体肺炎', relation: 'subtype' },
  'teacher-肺炎支原体性肺炎': { sourceId: 'teacher-肺炎支原体肺炎', relation: 'alias' },
  'teacher-心律失常-阵发性室上性心动过速': { sourceId: 'teacher-心律失常-室上性心动过速', relation: 'subtype' },
  'teacher-急性白血病': { sourceId: 'teacher-急性白血病-急性淋巴细胞白血病', relation: 'subtype' },
  'teacher-癫痫': { sourceId: 'teacher-癫痫全面性发作阵挛性发作', relation: 'subtype' },
  'teacher-先天性肌无力综合征': { sourceId: 'teacher-先天性肌无力', relation: 'alias' },
  'teacher-生长激素缺乏症-矮小症': { sourceId: 'teacher-矮小症', relation: 'subtype' },
  'teacher-i型糖尿病伴有酮症酸中毒': { sourceId: 'teacher-1型糖尿病伴有酮症酸中毒', relation: 'alias' },
  'teacher-糖原贮积病': { sourceId: 'teacher-糖原贮积病iv型', relation: 'subtype' },
};
