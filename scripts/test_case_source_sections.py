"""Synthetic regression cases; no private patient material is committed."""
import unittest
from case_source_sections import split_case_sections


class CaseSourceSectionsTest(unittest.TestCase):
    def test_admission_test_narrative_stays_in_treatment_course(self):
        result = split_case_sections('主诉：合成病例\n辅助检查：初诊结果甲\n诊断：教学诊断\n诊疗经过\n入院后完善相关检查：随访结果乙\n给予教学处置。')
        self.assertIn('初诊结果甲', result['tests'])
        self.assertNotIn('随访结果乙', result['tests'])
        self.assertIn('随访结果乙', result['plan'])
        self.assertIn('给予教学处置。', result['plan'])

    def test_explicit_test_heading_can_end_treatment_section(self):
        result = split_case_sections('治疗方案：教学方案\n三、辅助检查：明确新章节\n诊断：教学诊断')
        self.assertIn('明确新章节', result['tests'])
        self.assertNotIn('明确新章节', result['plan'])
        self.assertIn('教学诊断', result['diagnosis'])

    def test_admission_tests_before_treatment_remain_tests(self):
        result = split_case_sections('主诉：合成病例\n入院后完善相关检查：初诊结果\n诊疗经过：教学处置')
        self.assertIn('初诊结果', result['tests'])
        self.assertIn('教学处置', result['plan'])

    def test_numbered_diagnosis_and_exam_boundaries_are_preserved(self):
        result = split_case_sections('现病史：合成病史\n二、诊断 教学诊断\n三、查体：教学体征\n四、出院医嘱：教学建议')
        self.assertIn('教学诊断', result['diagnosis'])
        self.assertIn('教学体征', result['exam'])
        self.assertIn('教学建议', result['plan'])

    def test_normalized_input_lines_are_not_lost_or_duplicated(self):
        text = ' 主诉：合成病例 \n\n诊疗经过\n入院后相关检查：合成结果\n  后续观察。 '
        result = split_case_sections(text)
        expected = sorted(line.strip() for line in text.splitlines() if line.strip())
        actual = sorted(line for section in result.values() for line in section.splitlines())
        self.assertEqual(actual, expected)


if __name__ == '__main__':
    unittest.main()
