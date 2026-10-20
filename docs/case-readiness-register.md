# 唯一病例就绪账本（总表）

> 由 `scripts/audit-case-readiness.ts` 生成，数据源与缺口说明见 `case-readiness-register.json` 的 `_meta`。
> 核查原则：非空 ≠ 可用；未知不伪装已完成（unaudited 不标 ready）。

## 汇总（70 目录条目）

- 关系分布：亚型 8、独立来源 53、别名 6、无独立来源 3
- 已逐例核对：18/53 独立来源
- 确缺待医学审核（pending_review，仅 guided）：17 条目
- 下架（published=false）：3
- 角色能力（communicationProfile）：未建（阶段 B）；评分量表：未审定

## 逐条目

| 条目 | 关系 | 源病例 | 年龄段 | 性别 | 当前版本 | 发布 | 开放模式 | 核对批次 | 五维就绪 | 待办摘要 |
|---|---|---|---|---|---|---|---|---|---|---|
| teacher-单纯肥胖症 | 亚型 | teacher-儿童-肥胖症 | 学龄前 | 女 | 18b825c3bfd5434f | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | 别名/亚型入口：与源病例同步门控（同一患者不因别名绕过） |
| teacher-新生儿呼吸窘迫综合征 | 独立来源 | teacher-新生儿呼吸窘迫综合征 | 新生儿 | 男 | 8d5321f1154d2841 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | ⚠历史缺陷版本 85ef9072 待清理；新生儿形象；历史版本待教师清理：85ef9072fd59c67b |
| teacher-新生儿败血症 | 独立来源 | teacher-新生儿败血症 | 新生儿 | 女 | 20e4658d06d72824 | 是 | guided/osce/immersive | 批3 | 史✓/体✓/检✓/诊✓/处✓ | 历史版本待教师清理：ba6ff4f30655d524 |
| teacher-新生儿高胆红素血症 | 独立来源 | teacher-新生儿高胆红素血症 | 新生儿 | 男 | 8a7724a74b465cc1 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-新生儿abo溶血性黄疸 | 独立来源 | teacher-新生儿abo溶血性黄疸 | 新生儿 | 女 | 799eeacc74c8e2e8 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-新生儿rh溶血性黄疸 | 独立来源 | teacher-新生儿rh溶血性黄疸 | 新生儿 | 女 | b120df7f4b28beb8 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-新生儿肺炎 | 独立来源 | teacher-新生儿肺炎 | 新生儿 | 男 | a98d8c7a1671d1d3 | 是 | guided/osce/immersive | 批1 | 史✓/体✓/检✓/诊✓/处✓ | 历史版本待教师清理：648a7efc210d32dd |
| teacher-新生儿胎粪吸入肺炎 | 别名 | teacher-新生儿胎粪吸入性肺炎 | 新生儿 | 男 | 55828f717978227c | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | 别名/亚型入口：与源病例同步门控（同一患者不因别名绕过） |
| teacher-新生儿化脓性脑膜炎 | 独立来源 | teacher-新生儿化脓性脑膜炎 | 新生儿 | 男 | 96d3d6b9515e4666 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | ⚠诊断短；新生儿形象 |
| teacher-新生儿重度窒息 | 独立来源 | teacher-新生儿重度窒息 | 新生儿 | 女 | fe0762eac61f2676 | 是 | guided | 批3 | 史审/体审/检审/诊审/处审 | ⚠处置薄；新生儿形象；历史版本待教师清理：d347ceb4969d7c4a |
| teacher-新生儿脑梗死 | 无独立来源 | — | 未知 | 未知 | — | 否 | — | — | — | — |
| teacher-先天性肾上腺皮质增生症 | 独立来源 | teacher-先天性肾上腺皮质增生症 | 新生儿 | 男 | 8d1ea7d227b17979 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-新生儿缺血缺氧性脑病 | 独立来源 | teacher-新生儿缺血缺氧性脑病 | 新生儿 | 女 | 6306ffc9e114a015 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-风湿热 | 独立来源 | teacher-风湿热 | 学龄 | 男 | d36b0b1bcddbe629 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-过敏性紫癜 | 独立来源 | teacher-过敏性紫癜 | 学龄前 | 女 | 7ffd3c2f5c698e3b | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-川崎病 | 独立来源 | teacher-川崎病 | 学龄前 | 女 | 525495d4f805994a | 是 | guided/osce/immersive | 批1 | 史✓/体✓/检✓/诊✓/处✓ | 历史版本待教师清理：8cd8a5ccd5bdf5a2 |
| teacher-传染行单核细胞增多症 | 别名 | teacher-传染性单核细胞增多症 | 学龄前 | 男 | 10e83a645846eff2 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | 别名/亚型入口：与源病例同步门控（同一患者不因别名绕过） |
| teacher-轮状病毒性肠炎 | 独立来源 | teacher-轮状病毒性肠炎 | 幼儿 | 男 | 45a8ee52b88b1ebf | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-细菌性肠炎 | 独立来源 | teacher-细菌性肠炎 | 学龄 | 女 | 1218280b60feada6 | 是 | guided | 批2 | 史审/体审/检审/诊审/处审 | ⚠诊断短；历史版本待教师清理：7c286b5da4f91057 |
| teacher-婴儿胆汁淤积症-巨细胞病毒 | 别名 | teacher-婴儿胆汁淤积症-巨细胞病毒感染 | 婴儿 | 女 | 25a0f80506133d5c | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | 别名/亚型入口：与源病例同步门控（同一患者不因别名绕过） |
| teacher-急性喉炎 | 独立来源 | teacher-急性喉炎 | 学龄 | 女 | add55543e88cae23 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | ⚠年龄表述异常（源文如此） |
| teacher-异物吸入性窒息 | 独立来源 | teacher-异物吸入性窒息 | 学龄前 | 女 | 6e397a61cbd651c3 | 是 | guided | 批4 | 史审/体审/检审/诊审/处审 | ⚠处置薄；历史版本待教师清理：b57d983b82200002 |
| teacher-急性喘息性支气管炎 | 独立来源 | teacher-急性喘息性支气管炎 | 幼儿 | 男 | 4ddec398e66a6213 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-毛细支气管炎 | 亚型 | teacher-急性毛细支气管炎 | 婴儿 | 女 | 0ed5b913086fc73e | 是 | guided | 批2 | 史审/体审/检审/诊审/处审 | ⚠处置薄；别名/亚型入口：与源病例同步门控（同一患者不因别名绕过）；历史版本待教师清理：937f381d7c89b16c |
| teacher-支气管哮喘 | 独立来源 | teacher-支气管哮喘 | 学龄 | 男 | 6a10e39bb398b5b6 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-支气管肺炎 | 无独立来源 | — | 未知 | 未知 | — | 否 | — | — | — | — |
| teacher-大叶性肺炎 | 亚型 | teacher-肺炎支原体肺炎 | 学龄前 | 男 | d16631476ef3c965 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | 别名/亚型入口：与源病例同步门控（同一患者不因别名绕过） |
| teacher-肺炎支原体性肺炎 | 别名 | teacher-肺炎支原体肺炎 | 学龄前 | 男 | d16631476ef3c965 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | 别名/亚型入口：与源病例同步门控（同一患者不因别名绕过） |
| teacher-心律失常-阵发性室上性心动过速 | 亚型 | teacher-心律失常-室上性心动过速 | 学龄前 | 女 | eb180d62f8f1a47a | 是 | guided | 批4 | 史审/体审/检审/诊审/处审 | 别名/亚型入口：与源病例同步门控（同一患者不因别名绕过）；历史版本待教师清理：9fa788c10d325939 |
| teacher-暴发性心肌炎 | 独立来源 | teacher-暴发性心肌炎 | 学龄 | 男 | 19c6487c44e1f5e7 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-急性肾小球肾炎 | 独立来源 | teacher-急性肾小球肾炎 | 学龄 | 男 | f98f0bec00d664a9 | 是 | guided | 批3 | 史审/体审/检审/诊审/处审 | ⚠处置薄；历史版本待教师清理：0db76fcf293fe441 |
| teacher-肾病综合征 | 独立来源 | teacher-肾病综合征 | 青少年 | 男 | ac3af2f55656d4fc | 是 | guided | 批4 | 史审/体审/检审/诊审/处审 | ⚠处置薄；历史版本待教师清理：e8fa77f3bc669e86 |
| teacher-泌尿道感染 | 独立来源 | teacher-泌尿道感染 | 婴儿 | 女 | 692d50dd37bd74f6 | 是 | guided | 批2 | 史审/体审/检审/诊审/处审 | ⚠处置薄；历史版本待教师清理：812f3c5b37549719 |
| teacher-急性肾衰竭 | 独立来源 | teacher-急性肾衰竭 | 青少年 | 女 | d14766665c62f1c3 | 是 | guided/osce/immersive | 批2 | 史✓/体✓/检✓/诊✓/处✓ | ⚠与急性百草枯中毒同主诉/年龄/性别，疑似同源待教师核实；历史版本待教师清理：badc42df6709443c |
| teacher-再生障碍性贫血 | 独立来源 | teacher-再生障碍性贫血 | 学龄 | 男 | ee465e1ff5f76fa8 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-蚕豆病 | 独立来源 | teacher-蚕豆病 | 学龄 | 男 | f51901e4e053d18b | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-特发性血小板减少性紫癜 | 独立来源 | teacher-特发性血小板减少性紫癜 | 幼儿 | 女 | 22b8ea646a77d2a1 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-急性白血病 | 亚型 | teacher-急性白血病-急性淋巴细胞白血病 | 学龄前 | 女 | 9a3a424375515bd2 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | 别名/亚型入口：与源病例同步门控（同一患者不因别名绕过） |
| teacher-噬血细胞综合征 | 独立来源 | teacher-噬血细胞综合征 | 青少年 | 男 | fa81a91c1b37787f | 是 | guided | 批3 | 史审/体审/检审/诊审/处审 | 历史版本待教师清理：a40eb0e54c531107 |
| teacher-发热性惊厥 | 独立来源 | teacher-发热性惊厥 | 幼儿 | 女 | a456e1cdae39ecd9 | 是 | guided | 批3 | 史审/体审/检审/诊审/处审 | 历史版本待教师清理：2614d5ea1c95bb0c |
| teacher-癫痫 | 亚型 | teacher-癫痫全面性发作阵挛性发作 | 幼儿 | 男 | 66e00d2f540f7664 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | 别名/亚型入口：与源病例同步门控（同一患者不因别名绕过） |
| teacher-病毒性脑炎 | 独立来源 | teacher-病毒性脑炎 | 学龄 | 男 | dd2d029b834e6383 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-化脓性脑膜炎 | 独立来源 | teacher-化脓性脑膜炎 | 婴儿 | 男 | ffc45e9843882f2c | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-结核性脑炎 | 独立来源 | teacher-结核性脑炎 | 婴儿 | 男 | 9dd5fee2944a8d48 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | ⚠检查薄、处置超长 |
| teacher-格林巴利综合征 | 无独立来源 | — | 未知 | 未知 | — | 否 | — | — | — | — |
| teacher-先天性肌无力综合征 | 别名 | teacher-先天性肌无力 | 新生儿 | 女 | 9c3c5dd47b9d027e | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | ⚠病史/检查超长分段待核；新生儿用学龄形象；别名/亚型入口：与源病例同步门控（同一患者不因别名绕过） |
| teacher-生长激素缺乏症-矮小症 | 亚型 | teacher-矮小症 | 学龄 | 女 | 4390fa1612f5d806 | 是 | guided | 批2 | 史审/体审/检审/诊审/处审 | ⚠处置薄；别名/亚型入口：与源病例同步门控（同一患者不因别名绕过）；历史版本待教师清理：cb4a4521eebc47af |
| teacher-中枢性尿崩症 | 独立来源 | teacher-中枢性尿崩症 | 青少年 | 女 | 02f9277959fcccac | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-外周性性早熟 | 独立来源 | teacher-外周性性早熟 | 幼儿 | 女 | d90cf0fb82e5e57d | 是 | guided | 批4 | 史审/体审/检审/诊审/处审 | ⚠处置薄；历史版本待教师清理：13517aacdc8cabe3 |
| teacher-中枢性性早熟 | 独立来源 | teacher-中枢性性早熟 | 学龄 | 女 | 51939eea6c648ccf | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-i型糖尿病伴有酮症酸中毒 | 别名 | teacher-1型糖尿病伴有酮症酸中毒 | 学龄前 | 女 | 04b58216f1700203 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | 别名/亚型入口：与源病例同步门控（同一患者不因别名绕过） |
| teacher-肝豆状核变性 | 独立来源 | teacher-肝豆状核变性 | 学龄前 | 未知 | 65dba709cdc5ea66 | 是 | guided | 批1 | 史审/体审/检审/诊审/处审 | ⚠性别未记录（必要缺项→第一批候选）；诊断短；历史版本待教师清理：7342c7f700e41153 |
| teacher-糖原贮积病 | 亚型 | teacher-糖原贮积病iv型 | 婴儿 | 女 | f32b47d0ac055c45 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | ⚠诊断短；别名/亚型入口：与源病例同步门控（同一患者不因别名绕过） |
| teacher-急性百草枯中毒 | 独立来源 | teacher-急性百草枯中毒 | 青少年 | 女 | 69e5d67d0dd687cc | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | ⚠与急性肾衰竭主诉完全相同，疑似同源 |
| teacher-1型糖尿病伴有酮症酸中毒 | 独立来源 | teacher-1型糖尿病伴有酮症酸中毒 | 学龄前 | 女 | 04b58216f1700203 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-矮小症 | 独立来源 | teacher-矮小症 | 学龄 | 女 | 4390fa1612f5d806 | 是 | guided | 批2 | 史审/体审/检审/诊审/处审 | ⚠处置薄；历史版本待教师清理：cb4a4521eebc47af |
| teacher-急性毛细支气管炎 | 独立来源 | teacher-急性毛细支气管炎 | 婴儿 | 女 | 0ed5b913086fc73e | 是 | guided | 批2 | 史审/体审/检审/诊审/处审 | ⚠处置薄；历史版本待教师清理：937f381d7c89b16c |
| teacher-肺不张 | 独立来源 | teacher-肺不张 | 学龄 | 女 | 94ac7501f5cc2e6a | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-肺炎支原体肺炎 | 独立来源 | teacher-肺炎支原体肺炎 | 学龄前 | 男 | d16631476ef3c965 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-重症肺炎 | 独立来源 | teacher-重症肺炎 | 幼儿 | 女 | 80c38de40850b79d | 是 | guided | 批4 | 史审/体审/检审/诊审/处审 | 历史版本待教师清理：ee7096e365194f5e |
| teacher-心律失常-室上性心动过速 | 独立来源 | teacher-心律失常-室上性心动过速 | 学龄前 | 女 | eb180d62f8f1a47a | 是 | guided | 批4 | 史审/体审/检审/诊审/处审 | 历史版本待教师清理：9fa788c10d325939 |
| teacher-传染性单核细胞增多症 | 独立来源 | teacher-传染性单核细胞增多症 | 学龄前 | 男 | 10e83a645846eff2 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-新生儿胎粪吸入性肺炎 | 独立来源 | teacher-新生儿胎粪吸入性肺炎 | 新生儿 | 男 | 55828f717978227c | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-婴儿胆汁淤积症-巨细胞病毒感染 | 独立来源 | teacher-婴儿胆汁淤积症-巨细胞病毒感染 | 婴儿 | 女 | 25a0f80506133d5c | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-中枢神经系统脱髓鞘病 | 独立来源 | teacher-中枢神经系统脱髓鞘病 | 学龄前 | 女 | 384c043e5c538028 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-先天性肌无力 | 独立来源 | teacher-先天性肌无力 | 新生儿 | 女 | 9c3c5dd47b9d027e | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | ⚠病史/检查超长分段待核；新生儿用学龄形象 |
| teacher-癫痫全面性发作阵挛性发作 | 独立来源 | teacher-癫痫全面性发作阵挛性发作 | 幼儿 | 男 | 66e00d2f540f7664 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-儿童-肥胖症 | 独立来源 | teacher-儿童-肥胖症 | 学龄前 | 女 | 18b825c3bfd5434f | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-急性白血病-急性淋巴细胞白血病 | 独立来源 | teacher-急性白血病-急性淋巴细胞白血病 | 学龄前 | 女 | 9a3a424375515bd2 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | — |
| teacher-糖原贮积病iv型 | 独立来源 | teacher-糖原贮积病iv型 | 婴儿 | 女 | f32b47d0ac055c45 | 是 | guided/osce/immersive | — | 史—/体—/检—/诊—/处— | ⚠诊断短 |
