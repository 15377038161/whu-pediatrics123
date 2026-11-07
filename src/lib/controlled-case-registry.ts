export interface BundleReference { sourceId: string; version: string; fileId: string; sha256: string }

export interface ControlledArchiveReference {
  fileId: string;
  sha256: string;
  bytes: number;
  archive: string;
}

/** A content archive and its separately stored media archives form one immutable generation. */
export interface ControlledTrainingContentReference extends ControlledArchiveReference {
  media: ControlledArchiveReference[];
  expected?: { entries: number; sources: number; media: number };
}

// Approved server-side object references. Keep referenced historical entries when publishing newer versions.
export const controlledCaseBundles: BundleReference[] = [{
  sourceId: 'teacher-1型糖尿病伴有酮症酸中毒', version: 'dcdf43acad052794',
  fileId: 'bfe15e31c59e4f9cc99e63837781cad0',
  sha256: '70685fddab754d3514593c2ae56feed0c5262c9460c5601c30d3321cc998b4de',
}];

/**
 * Multi-source recovery stays dormant until an exact, reviewed object reference is registered.
 * An empty registry performs no storage reads and cannot change current or historical sessions.
 */
export const controlledTrainingContentBundles: ControlledTrainingContentReference[] = [];
