import assert from 'node:assert/strict';
import test from 'node:test';
import { EXAM_LOCATIONS } from '../src/domain/source-exam-contract';
import { allowedPostures } from '../src/domain/patient-appearance';
import {
  BUTTON_HEIGHT, EXAM_REGIONS, MIN_BUTTON_SEPARATION, REGION_TRIGGER_WIDTH, STAGE_BOTTOM_SLACK, STAGE_TOP_SLACK,
  SUPINE_ONLY_PARTS, buttonSeparation, fanAngle, fanItemBox, fanRadius, partLabel, regionAnchor, regionForPart,
  type ExamRegion,
} from '../src/domain/exam-regions';

const locationIds: readonly string[] = EXAM_LOCATIONS.map(([id]) => id);
const POSTURES = ['standing', 'supine'] as const;
/**
 * 覆盖真实会出现的患儿图框：手机竖屏最窄档到桌面上限，三种素材比例（957:1644  standing、
 * 832:1216 幼儿、1:1 新生儿）都各取窄宽两档。
 * 每档带上 allowedPostures 派生的可用体位——新生儿素材只有卧位图，站姿方图是不可达组合，
 * 拿它当失败样例会逼着几何迁就一个渲染不出来的画面。
 * 300px 一档必须有：iPhone SE/mini 视口 320px 减去舞台左右各 10px 内边距正好是 300px，
 * 而工作台里图框还是按高度反推宽度（.training-shell .patient-figure{height:100%}），窄档只会更常见。
 */
const FIGURES: ReadonlyArray<{ name: string; width: number; height: number; postures: readonly string[] }> = [
  { name: '手机竖屏', width: 240, height: 412, postures: allowedPostures('6岁') },
  { name: '手机大屏', width: 280, height: 482, postures: allowedPostures('6岁') },
  { name: '小屏视口', width: 300, height: 515, postures: allowedPostures('6岁') },
  { name: '平板', width: 320, height: 550, postures: allowedPostures('6岁') },
  { name: '桌面上限', width: 360, height: 618, postures: allowedPostures('6岁') },
  { name: '幼儿图窄', width: 300, height: 439, postures: allowedPostures('2岁') },
  { name: '幼儿图宽', width: 360, height: 526, postures: allowedPostures('2岁') },
  { name: '新生儿方图', width: 340, height: 340, postures: allowedPostures('3天') },
  { name: '新生儿窄方图', width: 300, height: 300, postures: allowedPostures('3天') },
];

test('6 大区覆盖全部子部位，且每个子部位只归属一个大区', () => {
  assert.equal(EXAM_REGIONS.length, 6);
  const owned = EXAM_REGIONS.flatMap((region) => [...region.parts]);
  assert.equal(new Set(owned).size, owned.length, '子部位被两个大区重复收录会让学生点到两次');
  assert.deepEqual([...owned].sort(), [...locationIds].sort());
  for (const region of EXAM_REGIONS) {
    assert.equal(regionForPart(region.parts[0])?.id, region.id);
    assert.ok(region.parts.length >= 3 && region.parts.length <= 7, `${region.id} 放射扇形按钮数超出手机可点范围`);
  }
});

test('10 个旧部位 id 全部保留原名，在飞会话的已解锁证据码不作废', () => {
  for (const legacy of ['forehead', 'mouth', 'neck', 'chest', 'upper-arm', 'skin', 'abdomen', 'finger', 'hands', 'limbs']) {
    assert.ok(locationIds.includes(legacy), legacy);
    assert.ok(regionForPart(legacy), `${legacy} 未归入任何大区`);
  }
  assert.equal(locationIds.length, 24);
});

test('partLabel 全覆盖且不返回空串，未收录 id 原样回退暴露数据缺口', () => {
  for (const [id, label] of EXAM_LOCATIONS) {
    assert.equal(partLabel(id), label);
    assert.ok(label.trim().length > 0, id);
  }
  assert.equal(partLabel('no-such-part'), 'no-such-part');
  assert.equal(regionForPart('no-such-part'), null);
});

test('仰卧位限定部位都在册，且不含站姿即可完成的部位', () => {
  for (const part of SUPINE_ONLY_PARTS) {
    assert.ok(locationIds.includes(part), part);
    assert.ok(['abdomen', 'liver-spleen', 'groin'].includes(part), `${part} 不需要强制仰卧`);
  }
  for (const standing of ['chest', 'chest-lung', 'chest-heart', 'neck', 'limbs', 'spine']) {
    assert.equal(SUPINE_ONLY_PARTS.has(standing), false, standing);
  }
});

test('同栏大区锚点纵向间距不小于按钮高度，常驻 6 个按钮本身不重叠', () => {
  for (const posture of POSTURES) {
    for (const side of ['left', 'right'] as const) {
      const tops = EXAM_REGIONS.filter((region) => region.side === side)
        .map((region) => region.anchorTop[posture === 'supine' ? 1 : 0])
        .sort((a, b) => a - b);
      for (let i = 1; i < tops.length; i += 1) {
        // 最不利图框高 340px（新生儿方图）：百分比差要换算成像素仍够一个点击目标。
        assert.ok((tops[i] - tops[i - 1]) / 100 * 340 >= BUTTON_HEIGHT, `${side} 栏 ${posture} 第 ${i} 个锚点与前一个只差 ${(tops[i] - tops[i - 1])}%`);
      }
    }
  }
});

test('扇形一律朝患儿图中线张开，弧上等分且奇偶错开半径', () => {
  for (const region of EXAM_REGIONS) {
    const inward = Math.cos((region.arcCenter * Math.PI) / 180);
    assert.ok(region.side === 'left' ? inward > 0 : inward < 0, `${region.id} 弧心朝图外张开会被 overflow:hidden 裁掉`);
    const angles = region.parts.map((_, index) => fanAngle(region, index));
    assert.ok(Math.abs(angles[0] - (region.arcCenter - region.arcSpan / 2)) < 1e-9);
    assert.ok(Math.abs(angles.at(-1)! - (region.arcCenter + region.arcSpan / 2)) < 1e-9);
    for (let i = 1; i < angles.length; i += 1) assert.ok(angles[i] > angles[i - 1], `${region.id} 弧上角度非递增`);
    assert.equal(fanRadius(region, 0, 300), fanRadius(region, 2, 300));
    // 错档半径只是拉开相邻按钮的手段之一，弧张得够开时可以为 0（chest/abdomen/vitals-prep 就是 0）。
    // 真正不能退让的是相邻两颗在弧上分开：按最窄图框复算，空隙不足就是手机上点错。
    assert.ok(region.radiusStagger >= 0, `${region.id} 错档半径为负会把奇数颗拉回内圈`);
    for (let i = 1; i < region.parts.length; i += 1) {
      const gap = buttonSeparation(fanItemBox(region, i - 1, 240, 412, 'standing'), fanItemBox(region, i, 240, 412, 'standing'));
      assert.ok(gap >= MIN_BUTTON_SEPARATION, `${region.id} 弧上第 ${i - 1}/${i} 颗空隙仅 ${gap.toFixed(2)}px，错档或张角不够`);
    }
    // 半径必须随图框同比缩放：固定 px 在窄图框里占比更大，正是按钮横穿中线压住对侧大区的根因。
    assert.ok(Math.abs(fanRadius(region, 0, 600) - fanRadius(region, 0, 300) * 2) < 1e-6, `${region.id} 半径不随图框宽度线性缩放`);
  }
  assert.equal(fanAngle({ ...EXAM_REGIONS[0], parts: ['neck'] }, 0), EXAM_REGIONS[0].arcCenter);
});

/** 两个矩形是否按点击目标判定重叠（留 1px 容差，忽略亚像素相邻）。 */
function overlaps(a: { centerX: number; centerY: number; width: number; height: number }, b: { centerX: number; centerY: number; width: number; height: number }): boolean {
  return Math.abs(a.centerX - b.centerX) < (a.width + b.width) / 2 - 1 && Math.abs(a.centerY - b.centerY) < (a.height + b.height) / 2 - 1;
}

function triggerBox(region: ExamRegion, width: number, height: number, posture: 'standing' | 'supine') {
  const anchor = regionAnchor(region, width, height, posture);
  return { centerX: anchor.x, centerY: anchor.y, width: REGION_TRIGGER_WIDTH, height: BUTTON_HEIGHT };
}

test('扇形子部位按钮在任何图框尺寸下都不越出可点范围、不互相重叠、不压自己的触发器', () => {
  // 体位绑定必须真实存在，否则下面的过滤等于没测新生儿方图。
  assert.deepEqual(FIGURES.at(-1)!.postures, ['supine']);
  const failures: string[] = [];
  for (const { name, width, height, postures } of FIGURES) {
    for (const posture of POSTURES.filter((value) => postures.includes(value))) {
      for (const region of EXAM_REGIONS) {
        const boxes = region.parts.map((part, index) => ({ part, box: fanItemBox(region, index, width, height, posture) }));
        for (const { part, box } of boxes) {
          // 横向必须留在图框内：舞台左右内边距只有 10px，探出去就被 overflow:hidden 裁成点不到。
          if (box.centerX - box.width / 2 < 0 || box.centerX + box.width / 2 > width) {
            failures.push(`${name}/${posture}/${region.id}/${part} 横向越出图框`);
          }
          // 纵向按舞台内边距余量判定：图框展开时 overflow:visible，真正会裁切的是外层舞台。
          if (box.centerY - box.height / 2 < -STAGE_TOP_SLACK || box.centerY + box.height / 2 > height + STAGE_BOTTOM_SLACK) {
            failures.push(`${name}/${posture}/${region.id}/${part} 纵向越出舞台可点范围`);
          }
          if (box.width < BUTTON_HEIGHT || box.height < BUTTON_HEIGHT) {
            failures.push(`${name}/${posture}/${region.id}/${part} 点击目标不足 44px（${box.width.toFixed(0)}×${box.height}）`);
          }
        }
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            if (overlaps(boxes[i].box, boxes[j].box)) failures.push(`${name}/${posture}/${region.id} ${boxes[i].part}×${boxes[j].part} 重叠`);
            // 不吃容差的真实空隙：1px 容差曾把 0.4px 的真重叠判成合法，边缘相咬的按钮手机上会点错。
            const gap = buttonSeparation(boxes[i].box, boxes[j].box);
            if (gap < MIN_BUTTON_SEPARATION) failures.push(`${name}/${posture}/${region.id} ${boxes[i].part}×${boxes[j].part} 空隙仅 ${gap.toFixed(2)}px`);
          }
        }
        // 扇形按钮压住自己那颗大区触发器，学生就点不到「收起」。
        const own = triggerBox(region, width, height, posture);
        for (const { part, box } of boxes) {
          if (overlaps(box, own)) failures.push(`${name}/${posture}/${region.id}/${part} 压住自己的大区触发器`);
          const gap = buttonSeparation(box, own);
          if (gap < MIN_BUTTON_SEPARATION) failures.push(`${name}/${posture}/${region.id}/${part} 与触发器空隙仅 ${gap.toFixed(2)}px`);
        }
      }
    }
  }
  assert.deepEqual(failures, []);
});

/**
 * 实测棘轮值（9 档图框 × 可用体位 × 6 大区全枚举）：27 处。
 * 25 处出自 rg-head-neck——它是唯一 7 子部位的大区、且子部位名最长（浅表淋巴结 5 字），
 * 扇形最大：浅表淋巴结>体征准备(14)、鼻>胸部(4)、耳>胸部(2)、鼻>腹部(2)、
 * 浅表淋巴结>皮肤全身(2)、颈>体征准备(1)；另 2 处是 rg-chest 的胸廓>腹部。
 * 不锁 0 是因为求解时量化过取舍：压 covers 会把最紧的一对按钮空隙从 4.7px 往 2px 以下挤，
 * 误触风险比「多几处要先收起再切换」更贴近老师提的「部位多了容易重叠、学生不好点」。
 * 数字往上涨才说明几何退化了；空隙下限另由 MIN_BUTTON_SEPARATION 独立守住。
 */
const COVERS_BUDGET = 27;

/**
 * 棘轮：扇形按钮盖住「别的」大区触发器不是硬失败——被盖住的那颗已淡出到 38%，
 * 上层扇形按钮 z-index 更高且自带部位名，点到的就是它写着的那个部位，不会静默走成另一项。
 * 但数量越多说明扇形越 sprawl，所以把当前求解出的最好值锁死，几何一改坏就会红。
 */
test('扇形盖住其他大区触发器的次数不超过求解出的上限', () => {
  const covers: string[] = [];
  for (const { name, width, height, postures } of FIGURES) {
    for (const posture of POSTURES.filter((value) => postures.includes(value))) {
      for (const region of EXAM_REGIONS) {
        for (const other of EXAM_REGIONS) {
          if (other.id === region.id) continue;
          const target = triggerBox(other, width, height, posture);
          region.parts.forEach((part, index) => {
            if (overlaps(fanItemBox(region, index, width, height, posture), target)) covers.push(`${name}/${posture}/${region.id}/${part}>${other.label}`);
          });
        }
      }
    }
  }
  assert.ok(covers.length <= COVERS_BUDGET, `盖住其他大区触发器 ${covers.length} 处，超过上限 ${COVERS_BUDGET}：\n${covers.join('\n')}`);
});
