import { Calculator, ShieldAlert } from 'lucide-react';
import { MedicalBackdrop } from '@/components/medical-backdrop';
import { PediatricDosingCalculator } from '@/components/pediatric-dosing-calculator';
import { DOSING_DRUGS, GENERAL_SAFETY_NOTES } from '@/domain/pediatric-dosing';

export const metadata = { title: '用药剂量计算 · 珞珈儿科智训' };

/**
 * 执业医师实践技能第二站的用药剂量计算：确定性计算 + 手算过程，不经模型。
 * 收录表以外的药品一律拒绝，避免用未核实数据充当教学标准答案。
 */
export default function DosingPage() {
  return (
    <MedicalBackdrop>
      <p className="eyebrow">执业医师实践技能 · 第二站</p>
      <h1 className="page-title"><Calculator size={22} aria-hidden="true" /> 儿科用药剂量计算</h1>
      <p className="page-lead">按实测体重与月龄给出教材与说明书口径的剂量范围，并逐步展示手算过程；封顶项逐条列出，被禁用或超范围的情形直接拒绝，不外推、不猜剂量。</p>

      <PediatricDosingCalculator />

      <section className="report-section" style={{ marginTop: 16 }}>
        <h2>收录药品（{DOSING_DRUGS.length} 种）</h2>
        <div className="entry-list" style={{ marginTop: 10 }}>
          {DOSING_DRUGS.map((drug) => (
            <div className="entry" key={drug.id}>
              <span className="entry-mark"><Calculator aria-hidden="true" /></span>
              <h3>{drug.name} · {drug.drugClass}</h3>
              <p>{drug.summary}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="report-section" style={{ marginTop: 16 }}>
        <h2><ShieldAlert size={18} aria-hidden="true" /> 通用安全条目</h2>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.9, fontSize: 14 }}>
          {GENERAL_SAFETY_NOTES.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </section>
    </MedicalBackdrop>
  );
}
