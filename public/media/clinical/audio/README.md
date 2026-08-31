# 儿科听诊音频来源

`pediatric-fine-crackles-right.mp3` 是真实儿科肺部听诊录音的 2.3 秒节选，用于旗舰肺炎病例的右侧肺部细湿啰音教学反馈。

- 数据集：SPRSound — Open-Source SJTU Paediatric Respiratory Sound Database
- 原始文件：`BioCAS2022/test2022_wav/41087486_3.8_0_p4_232.wav`
- 标注文件：`BioCAS2022/test2022_json/intra_test_json/41087486_3.8_0_p4_232.json`
- 标注：3.8 岁男童，右侧肺区 `p4`，`Fine Crackle` 事件 3248–5259 ms，记录级标注 `DAS`
- 处理：截取 3.10–5.40 秒，首尾各增加 50 ms 淡入淡出，转为 MP3；未合成或改变病理声音内容
- 作者/发布方：Q. Zhang 等，上海交通大学研究团队与上海儿童医学中心
- 来源：https://github.com/SJTU-YONGFU-RESEARCH-GRP/SPRSound
- 许可：CC BY 4.0，https://creativecommons.org/licenses/by/4.0/

该录音仅用于标准化患儿教学模拟，不代表当前屏幕人物的真实录音，也不用于真实医疗诊断。

`pediatric-wheeze.mp3` 是真实儿科肺部听诊录音的 3.9 秒节选，用于女童喘息病例的哮鸣音教学反馈。

- 原始文件：`BioCAS2022/test2022_wav/41243139_5.1_1_p2_3557.wav`
- 标注文件：`BioCAS2022/test2022_json/inter_test_json/41243139_5.1_1_p2_3557.json`
- 标注：5.1 岁女童，左侧肺区 `p2`，包含 `Wheeze` 事件 102–1486 ms、2625–3788 ms，记录级标注 `CAS`
- 处理：截取 0–3.90 秒，首尾各增加 50 ms 淡入淡出，转为 MP3；未合成或改变病理声音内容
- 来源、作者与许可同上（SPRSound，CC BY 4.0）

该片段用于说明哮鸣音音色；界面中的“双肺弥漫性哮鸣音”范围结论仍由版本化病例规则提供，不能从这一个听诊点位录音单独推断。
