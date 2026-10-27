/** Shared source-topic matching; indices must match persisted SOURCE_HX_N evidence. */
export const SOURCE_HISTORY_TOPICS = [
 {label:'起病与病程',question:/多久|什么时候|几天|开始|起病/,source:/天|周|月|小时|分钟|起病|出现/},
 {label:'发热与处理',question:/发烧|发热|体温|退烧/,source:/发热|发烧|体温|退热/},
 {label:'一般状态、进食及排泄',question:/精神|吃饭|食欲|吃东西|饮食|睡|喝水|大小便|小便/,source:/精神|饮食|食欲|睡眠|小便|大便|吃奶|喂养|尿/},
 {label:'出生、喂养与生长发育',question:/出生|早产|胎龄|怀孕|发育|生长|喂养/,source:/胎|产|出生|窒息|喂养|发育|生长/},
 {label:'既往、过敏、接种及家族史',question:/以前|既往|住院|过敏|疫苗|接种|家族/,source:/既往|平素|过敏|接种|家族|否认/},
 {label:'已用药物与院外处理',question:/吃药|用药|治疗|处理|在家|药/,source:/治疗|用药|予|在家|药|处理/},
 {label:'呼吸相关症状',question:/喘|憋|呼吸|咳|痰/,source:/喘|呼吸|憋|咳|痰/},
 {label:'水肿及尿液变化',question:/水肿|肿|浮肿|尿|血尿/,source:/肿|浮肿|尿/},
 {label:'疼痛及消化道症状',question:/疼|痛|肚子|呕吐|腹泻|拉肚子/,source:/痛|腹|呕吐|腹泻|大便/},
 {label:'神经、意识与肢体功能',question:/抽搐|惊厥|发作|意识|昏迷|无力|麻木|行走/,source:/抽搐|惊厥|发作|意识|昏迷|无力|麻木|行走/},
 {label:'黄疸、皮肤及出血',question:/黄|皮疹|皮肤|出血/,source:/黄|皮疹|皮肤|出血/},
];
export const sourceHistorySentences = (history: string) => history.split(/[。；;\n]/).filter(line=>line.trim());
