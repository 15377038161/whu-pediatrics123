"""Synthetic end-to-end source preparation; no patient originals or service access."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('prepare_cases_test_target', SCRIPTS / 'prepare-teacher-cases.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DemographicsPreparationTest(unittest.TestCase):
    def prepare(self, sentence):
        with tempfile.TemporaryDirectory(prefix='case-demographics-') as folder:
            root = Path(folder)
            drafts = root / 'drafts'
            drafts.mkdir()
            output = root / 'prepared'
            links = root / 'links.ts'
            links.write_text('export const LINKS = {};', encoding='utf-8')
            case_id = 'teacher-synthetic-demographics'
            draft = {'documents': [{'source': str(root / 'source.doc'), 'text': '入院情况：\n1.' + sentence + '；\n2.合成主诉；', 'sha256': 'synthetic-source'}]}
            (drafts / (case_id + '.json')).write_text(json.dumps(draft, ensure_ascii=False), encoding='utf-8')
            catalog = [{'id': case_id, 'name': '合成病例', 'folder': str(root)}]
            with patch.object(module, 'OUTPUT', output), patch.object(module, 'LINKS', links), patch.object(module.extractor, 'OUTPUT', drafts), patch.object(module.extractor, 'read_catalog', return_value=catalog), contextlib.redirect_stdout(io.StringIO()):
                module.main()
            return json.loads((output / (case_id + '.json')).read_text(encoding='utf-8'))

    def test_patient_forms_reach_generated_candidate(self):
        for sentence, expected in [('患者，女童，5岁', '女'), ('患者，男童，5岁', '男'), ('患儿，女婴，1天', '女'), ('性别：女性。年龄：5岁', '女')]:
            with self.subTest(form=sentence):
                self.assertEqual(self.prepare(sentence)['sex'], expected)

    def test_family_members_and_unknown_are_not_patient_sex(self):
        for sentence in ['患者女儿代诉：父亲发热', '母亲，女，30岁，代诉', '性别：性别未记录']:
            with self.subTest(form=sentence):
                self.assertEqual(self.prepare(sentence)['sex'], '性别未记录')

if __name__ == '__main__':
    unittest.main()
