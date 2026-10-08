from pathlib import Path
import json
import pandas as pd

ROOT = Path('knowledge/儿科常见病')
XLSX = ROOT / '儿科病例库--普通病种清单.xlsx'
OUTPUT = Path('src/domain/teacher-case-catalog.ts')

table = pd.read_excel(XLSX, header=None)
rows = []
category = '未分类'
case_folders = sorted((path for path in ROOT.glob('*/*') if path.is_dir()), key=lambda path: str(path))
directories = {path.name: path for path in case_folders}
if len(directories) != len(case_folders):
    raise ValueError('不同分类下存在同名病例目录，请先确认映射关系')

def entry(name, category, folder, source):
    files = (p for p in folder.rglob('*') if p.is_file()) if folder else ()
    media_count = 0
    document_count = 0
    for file in files:
        ext = file.suffix.lower()
        media_count += ext in {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp3', '.wav', '.avi', '.mp4', '.mov'}
        document_count += ext in {'.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xlsx'}
    safe_id = 'teacher-' + ''.join(ch if ch.isalnum() else '-' for ch in name).strip('-').lower()
    status = 'materials-indexed' if source == 'list' and folder else 'catalog-only' if source == 'list' else 'folder-only'
    return {'id': safe_id, 'name': name, 'category': category, 'folder': folder.as_posix() if folder else None,
            'mediaCount': media_count, 'documentCount': document_count, 'status': status, 'source': source}

for _, row in table.iloc[2:].iterrows():
    name = str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else ''
    if not name or name == 'nan':
        continue
    if pd.notna(row.iloc[1]) and str(row.iloc[1]).strip() not in ('', 'nan'):
        category = str(row.iloc[1]).strip()
    folder = directories.get(name)
    rows.append(entry(name, category, folder, 'list'))

listed_names = {item['name'] for item in rows}
for folder in case_folders:
    if folder.name not in listed_names:
        rows.append(entry(folder.name, folder.parent.name, folder, 'folder'))

if len({item['id'] for item in rows}) != len(rows):
    raise ValueError('病例 ID 冲突，请人工核对名称')

OUTPUT.write_text('export interface TeacherCaseCatalogItem {\n  id: string;\n  name: string;\n  category: string;\n  folder: string | null;\n  mediaCount: number;\n  documentCount: number;\n  status: \'materials-indexed\' | \'catalog-only\' | \'folder-only\';\n  source: \'list\' | \'folder\';\n}\n\nexport const TEACHER_CASE_CATALOG: TeacherCaseCatalogItem[] = ' + json.dumps(rows, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
print(f'generated {len(rows)} entries: {sum(item["status"] == "materials-indexed" for item in rows)} exact, {sum(item["status"] == "catalog-only" for item in rows)} catalog-only, {sum(item["status"] == "folder-only" for item in rows)} folder-only')
