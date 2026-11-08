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
 * Immutable private generations; reads require PEDIATRICS_TRAINING_RECOVERY=object-storage.
 * Source/teaching versions are checked independently. No database binding is changed.
 */
export const controlledTrainingContentBundles: ControlledTrainingContentReference[] = [
  {
    "fileId": "f38b7a140f96283493b2b3bce97bb271",
    "sha256": "093a32a35beac4d07a9597871fa1dc63266a1030f71b15272fd10bfc72b7fd3b",
    "bytes": 2342278,
    "archive": "peds-training-content-6688ba483378dc352fd0.zip",
    "media": [
      {
        "fileId": "5c65c56220120988361a9796b414b125",
        "sha256": "99115d51fd37794baf9702d9e3be54d4382407132bd3d6be0d3fd1ab373e3c2a",
        "bytes": 38155799,
        "archive": "peds-training-media-6688ba483378dc352fd0-01.zip"
      },
      {
        "fileId": "f40ce2592eff30cf09c3e39d7d41dc03",
        "sha256": "493b73fb1f047adbba4c517b2ac3d265f51b6f94b7311a64dddf193a4029df5b",
        "bytes": 38243862,
        "archive": "peds-training-media-6688ba483378dc352fd0-02.zip"
      },
      {
        "fileId": "8fbc92f92b585fb8d60d50240dc57dec",
        "sha256": "81981bb8782490d509f758ca9fbeb18e97189c5ecbff8bd3828f9ec81b78b175",
        "bytes": 24247769,
        "archive": "peds-training-media-6688ba483378dc352fd0-03.zip"
      }
    ],
    "expected": {
      "entries": 67,
      "sources": 53,
      "media": 1042
    }
  },
  {
  "fileId": "09fac0d4ade8d9163986aca1f3e7a693",
  "sha256": "ea489f2758b91a88143f98d63372245016526305602a9274866cb24c9488e6e7",
  "bytes": 2429015,
  "archive": "peds-training-content-661e313de274f2658394.zip",
  "media": [
    {
      "fileId": "5c65c56220120988361a9796b414b125",
      "sha256": "99115d51fd37794baf9702d9e3be54d4382407132bd3d6be0d3fd1ab373e3c2a",
      "bytes": 38155799,
      "archive": "peds-training-media-6688ba483378dc352fd0-01.zip"
    },
    {
      "fileId": "f40ce2592eff30cf09c3e39d7d41dc03",
      "sha256": "493b73fb1f047adbba4c517b2ac3d265f51b6f94b7311a64dddf193a4029df5b",
      "bytes": 38243862,
      "archive": "peds-training-media-6688ba483378dc352fd0-02.zip"
    },
    {
      "fileId": "8fbc92f92b585fb8d60d50240dc57dec",
      "sha256": "81981bb8782490d509f758ca9fbeb18e97189c5ecbff8bd3828f9ec81b78b175",
      "bytes": 24247769,
      "archive": "peds-training-media-6688ba483378dc352fd0-03.zip"
    }
  ],
  "expected": {
    "entries": 67,
    "sources": 53,
    "media": 1042
  }
}
];
