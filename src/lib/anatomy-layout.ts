import { Box3, Vector3 } from 'three';
import { anatomyRegionOrder } from '../domain/anatomy-structures';

export interface AnatomyBounds { id: string; region: string; box: Box3 }
export interface AnatomySection { region: string; box: Box3 }

export function fitAnatomyDistance(box: Box3, verticalFov: number, aspect: number) {
  const size=box.getSize(new Vector3());
  const tangent=Math.tan(verticalFov*Math.PI/360);
  return Math.max(.15, Math.max(size.y/(2*tangent),size.x/(2*tangent*aspect))*1.12+size.z/2);
}

/** 依据实际包围盒排版，只平移结构，不修改形状、比例、旋转或组内相对关系。 */
export function layoutAnatomy(items: AnatomyBounds[], aspect: number) {
  const offsets = new Map<string, Vector3>();
  const sections: AnatomySection[] = [];
  const gap = .085;
  const blocks = anatomyRegionOrder.flatMap(region => {
    const members = items.filter(item => item.region === region);
    if (!members.length) return [];
    const area = members.reduce((sum, item) => {
      const size = item.box.getSize(new Vector3());
      return sum + Math.max(size.x + gap, .22) * Math.max(size.y + gap, .18);
    }, 0);
    const width = Math.max(.6, Math.sqrt(area * 1.3), ...members.map(item => item.box.getSize(new Vector3()).x + gap));
    let x = 0, y = .16, rowHeight = 0, usedWidth = 0;
    const centers = new Map<string, Vector3>();
    for (const item of members) {
      const size = item.box.getSize(new Vector3());
      const cellWidth = Math.max(size.x + gap, .22), cellHeight = Math.max(size.y + gap, .18);
      if (x > 0 && x + cellWidth > width) { x = 0; y += rowHeight; rowHeight = 0; }
      centers.set(item.id, new Vector3(x + cellWidth / 2, -y - cellHeight / 2, 0));
      x += cellWidth; usedWidth = Math.max(usedWidth, x); rowHeight = Math.max(rowHeight, cellHeight);
    }
    return [{ region, members, centers, width: usedWidth, height: y + rowHeight }];
  });
  const columns = Math.min(blocks.length, aspect < .85 ? 2 : 3);
  const columnWidth = Math.max(0, ...blocks.map(block => block.width)) + .2;
  let rowY = 0;
  for (let start = 0; start < blocks.length; start += columns) {
    const row = blocks.slice(start, start + columns);
    row.forEach((block, column) => {
      const origin = new Vector3(column * columnWidth, -rowY, 0);
      sections.push({ region: block.region, box: new Box3(new Vector3(origin.x, origin.y - block.height, 0), new Vector3(origin.x + block.width, origin.y, 0)) });
      for (const item of block.members) offsets.set(item.id, block.centers.get(item.id)!.clone().add(origin).sub(item.box.getCenter(new Vector3())));
    });
    rowY += Math.max(...row.map(block => block.height)) + .2;
  }
  const box = new Box3();
  for (const item of items) box.union(item.box.clone().translate(offsets.get(item.id)!));
  for (const section of sections) box.union(section.box);
  const center = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
  for (const offset of offsets.values()) offset.sub(center);
  for (const section of sections) section.box.translate(center.clone().negate());
  return { offsets, sections };
}
