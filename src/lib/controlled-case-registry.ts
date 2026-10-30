export interface BundleReference { sourceId: string; version: string; fileId: string; sha256: string }
// Approved server-side object references. Keep referenced historical entries when publishing newer versions.
export const controlledCaseBundles: BundleReference[] = [{
  sourceId: 'teacher-1型糖尿病伴有酮症酸中毒', version: 'dcdf43acad052794',
  fileId: 'bfe15e31c59e4f9cc99e63837781cad0',
  sha256: '70685fddab754d3514593c2ae56feed0c5262c9460c5601c30d3321cc998b4de',
}];
