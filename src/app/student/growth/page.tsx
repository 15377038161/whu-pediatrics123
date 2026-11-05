import { Baby, Ruler, Table2 } from 'lucide-react';
import { MedicalBackdrop } from '@/components/medical-backdrop';
import { GrowthAssessmentCalculator } from '@/components/growth-assessment-calculator';
import styles from '@/components/growth-assessment.module.css';
import {
  FONTANEL_FACTS,
  GROWTH_ANCHORS,
  MILESTONES,
  MOTOR_MNEMONIC,
  UPPER_ARM_FACTS,
  ageLabel,
} from '@/domain/growth-assessment';

export const metadata = { title: '生长发育评估 · 珞珈儿科智训' };

/**
 * 执业医师实践技能第二站的生长发育评估：双向确定性计算，不经模型。
 * 页面参考表直接来自 src/domain/growth-assessment.ts 的同一份教材锚点，避免正文与计算各写一套数据。
 */
export default function GrowthAssessmentPage() {
  return (
    <MedicalBackdrop>
      <p className="eyebrow">执业医师实践技能 · 第二站</p>
      <h1 className="page-title"><Baby size={22} aria-hidden="true" /> 生长发育评估</h1>
      <p className="page-lead">按月龄推算体重、身高、头围、胸围、乳牙与前囟的教材典型值，逐步展示公式手算；也可反过来按实测值内插月龄区间。超出教材适用范围一律拒绝，不外推。</p>

      <GrowthAssessmentCalculator />

      <section className="report-section" style={{ marginTop: 16 }}>
        <h2><Table2 size={18} aria-hidden="true" /> 教材体格生长锚点（{GROWTH_ANCHORS.length} 档，0–10 岁）</h2>
        <div className={styles.tableScroll}>
          <table className={styles.anchorTable}>
            <thead>
              <tr>
                <th scope="col">年龄</th>
                <th scope="col">月龄</th>
                <th scope="col">体重 kg</th>
                <th scope="col">身高 cm</th>
                <th scope="col">头围 cm</th>
              </tr>
            </thead>
            <tbody>
              {GROWTH_ANCHORS.map((anchor) => (
                <tr key={anchor.ageMonths}>
                  <th scope="row">{ageLabel(anchor.ageMonths)}</th>
                  <td>{anchor.ageMonths}</td>
                  <td>{anchor.weightKg}</td>
                  <td>{anchor.heightCm}</td>
                  <td>{anchor.headCm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="report-section" style={{ marginTop: 16 }}>
        <h2><Ruler size={18} aria-hidden="true" /> 运动与语言发育里程碑（{MILESTONES.length} 条）</h2>
        <p style={{ margin: '0 0 10px', color: '#607471', fontSize: 14, lineHeight: 1.8 }}>口诀：{MOTOR_MNEMONIC}。里程碑为群体常模，允许个体前后波动；明显落后须结合神经系统查体与发育量表评估。</p>
        <div className={styles.tableScroll}>
          <table className={styles.anchorTable}>
            <thead>
              <tr>
                <th scope="col">年龄</th>
                <th scope="col">运动发育</th>
                <th scope="col">语言发育</th>
              </tr>
            </thead>
            <tbody>
              {MILESTONES.map((item) => (
                <tr key={item.ageMonths}>
                  <th scope="row">{item.ageLabel}</th>
                  <td style={{ whiteSpace: 'normal', textAlign: 'left' }}>{item.motor}</td>
                  <td style={{ whiteSpace: 'normal', textAlign: 'left' }}>{item.language}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="report-section" style={{ marginTop: 16 }}>
        <h2>骨骼与营养相关测量要点</h2>
        <div className={styles.facts}>
          <div>
            <strong>前囟与颅骨缝</strong>
            {FONTANEL_FACTS}
          </div>
          <div>
            <strong>上臂围（5 岁以下营养筛查）</strong>
            {UPPER_ARM_FACTS}
          </div>
        </div>
      </section>
    </MedicalBackdrop>
  );
}
