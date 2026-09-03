begin;

-- 病例分类（大类 → 小类，案例库“一类一例”的层级结构）
create table public.case_categories (
  id text primary key,
  parent_id text references public.case_categories(id) on delete cascade,
  kind text not null check (kind in ('major', 'minor')),
  name text not null,
  sort_order integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  unique (parent_id, name)
);

-- 儿科症状字典（名称、口语别名、所属系统；仅收录术语与别名，不收录诊疗建议）
create table public.symptom_terms (
  code text primary key,
  name text not null,
  aliases text[] not null default '{}',
  body_system text,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 病例 ↔ 分类、病例 ↔ 症状 关联
alter table public.cases add column category_id text references public.case_categories(id);

create table public.case_symptoms (
  case_id text not null references public.cases(id) on delete cascade,
  symptom_code text not null references public.symptom_terms(code) on delete cascade,
  is_presenting boolean not null default false,
  primary key (case_id, symptom_code)
);

-- 诊疗指南挂接疾病分类
alter table public.knowledge_documents add column category_id text references public.case_categories(id);

create index case_categories_parent_idx on public.case_categories(parent_id);
create index cases_category_idx on public.cases(category_id);
create index case_symptoms_symptom_idx on public.case_symptoms(symptom_code);
create index symptom_terms_aliases_idx on public.symptom_terms using gin (aliases);
create index knowledge_documents_category_idx on public.knowledge_documents(category_id);

alter table public.case_categories enable row level security;
alter table public.symptom_terms enable row level security;
alter table public.case_symptoms enable row level security;

create policy case_categories_read on public.case_categories for select to authenticated using (true);
create policy symptom_terms_read on public.symptom_terms for select to authenticated using (true);
create policy case_symptoms_published_read on public.case_symptoms for select to authenticated
  using (exists (select 1 from public.cases c where c.id = case_id and c.status = 'published'));

-- 大类种子（与《案例库与专项训练库_材料需求清单》一致）
insert into public.case_categories (id, parent_id, kind, name, sort_order) values
  ('cat-respiratory', null, 'major', '呼吸系统', 1),
  ('cat-gi', null, 'major', '消化系统', 2),
  ('cat-infect', null, 'major', '感染/传染病', 3),
  ('cat-neonate', null, 'major', '新生儿科', 4),
  ('cat-nephro', null, 'major', '泌尿系统', 5),
  ('cat-hema', null, 'major', '血液系统', 6),
  ('cat-neuro', null, 'major', '神经系统', 7),
  ('cat-cardio', null, 'major', '循环系统', 8),
  ('cat-endo', null, 'major', '内分泌系统', 9),
  ('cat-whu', null, 'major', '武汉大学特色', 10)
on conflict (id) do nothing;

-- 小类种子（首轮 13 个，一类一例）
insert into public.case_categories (id, parent_id, kind, name, sort_order, note) values
  ('cat-respiratory-mycoplasma', 'cat-respiratory', 'minor', '肺炎·支原体', 1, '国家考核方案样题可直接收录'),
  ('cat-respiratory-bacterial', 'cat-respiratory', 'minor', '肺炎·细菌性', 2, null),
  ('cat-respiratory-wheeze', 'cat-respiratory', 'minor', '喘息性疾病', 3, '毛细支气管炎/哮喘发作任选'),
  ('cat-gi-diarrhea', 'cat-gi', 'minor', '小儿腹泻病', 1, '突出脱水程度评估'),
  ('cat-infect-exanthem', 'cat-infect', 'minor', '急性传染病', 1, '麻疹/水痘/手足口病任选其一，需写明隔离与上报要求'),
  ('cat-neonate-jaundice', 'cat-neonate', 'minor', '新生儿黄疸', 1, '注意日龄分层判断'),
  ('cat-nephro-glomerular', 'cat-nephro', 'minor', '肾小球疾病', 1, '急性肾炎/肾病综合征任选'),
  ('cat-hema-anemia', 'cat-hema', 'minor', '贫血', 1, '缺铁性贫血等'),
  ('cat-neuro-convulsion', 'cat-neuro', 'minor', '惊厥性疾病', 1, '热性惊厥等'),
  ('cat-neuro-cns-infection', 'cat-neuro', 'minor', '颅内感染', 2, '病毒性脑炎等'),
  ('cat-cardio-myocarditis', 'cat-cardio', 'minor', '心肌炎', 1, '可换本大类其他常见病'),
  ('cat-endo-diabetes', 'cat-endo', 'minor', '儿童糖尿病', 1, '可换本大类其他常见病'),
  ('cat-whu-special', 'cat-whu', 'minor', '少见/特色病例', 1, '武汉大学人民医院儿科优势亚专科的特色病例，病种由老师选定')
on conflict (id) do nothing;

-- 症状字典种子（术语与口语别名，供患儿/家长话术匹配；不含诊疗建议）
insert into public.symptom_terms (code, name, aliases, body_system, sort_order) values
  ('fever', '发热', array['发烧','体温高','身上烫'], '全身', 1),
  ('cough', '咳嗽', array['干咳','有痰的咳','犬吠样咳','一阵一阵咳'], '呼吸系统', 2),
  ('wheeze', '喘息', array['喘','呼噜呼噜','拉风箱的声音'], '呼吸系统', 3),
  ('tachypnea', '呼吸急促', array['气促','呼吸快','喘不上气'], '呼吸系统', 4),
  ('diarrhea', '腹泻', array['拉肚子','稀便','水样便'], '消化系统', 5),
  ('vomiting', '呕吐', array['吐奶','吐了','喷射状吐'], '消化系统', 6),
  ('abdominal-pain', '腹痛', array['肚子疼','肚子不舒服','阵发性哭闹'], '消化系统', 7),
  ('bloody-stool', '血便', array['大便带血','果酱样大便'], '消化系统', 8),
  ('rash', '皮疹', array['出疹子','红点','疱疹','风团'], '皮肤', 9),
  ('convulsion', '惊厥', array['抽搐','抽风','眼睛上翻','四肢发硬'], '神经系统', 10),
  ('jaundice', '黄疸', array['皮肤黄','脸发黄'], '肝胆', 11),
  ('pallor', '面色苍白', array['脸色白','没有血色'], '血液系统', 12),
  ('edema', '水肿', array['肿','眼皮肿','腿肿'], '泌尿系统', 13),
  ('oliguria', '尿量减少', array['尿少','半天不尿'], '泌尿系统', 14),
  ('heart-murmur', '心脏杂音', array['心脏有杂音'], '循环系统', 15),
  ('lethargy', '精神萎靡', array['精神不好','蔫蔫的','嗜睡','叫不醒'], '全身', 16)
on conflict (code) do nothing;

-- 已上线病例回填分类与主诉症状（主诉症状取自病例目录公开发布信息）
update public.cases set category_id = 'cat-respiratory-wheeze' where id = 'peds-respiratory-001' and category_id is null;

insert into public.case_symptoms (case_id, symptom_code, is_presenting)
select 'peds-respiratory-001', code, true
from unnest(array['fever', 'cough', 'tachypnea']) as code
where exists (select 1 from public.cases where id = 'peds-respiratory-001')
on conflict (case_id, symptom_code) do nothing;

commit;
