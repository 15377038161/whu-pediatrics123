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
  },
  {
    "fileId": "b37347b447106d3d71b944ad4141fe2e",
    "sha256": "ac80bbdd249f7117ef60c163683bd2e62ef8277eed82213e26db98eb2f5196f1",
    "bytes": 2512433,
    "archive": "peds-training-content-9cfa247812b5692fcfea.zip",
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
    "fileId": "10f75697b96a43a01f13ab55a8488b6d",
    "sha256": "14fd708e62c4c1db29f417c95501344e316138899b3ac209f5e527102871af85",
    "bytes": 2528707,
    "archive": "peds-training-content-2bba728c34d527fa742a.zip",
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
    "fileId": "33e8d1212bad24ab78113e9886e7164d",
    "sha256": "64acd82c3f9501ef5798d542b845de92b40c9ce4a5ca139fca22da22f06b1b0f",
    "bytes": 2613165,
    "archive": "peds-training-content-bbe3ab592fb27874858b.zip",
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
    "fileId": "8c846e4cbada3c017d07ae7f4f3373ae",
    "archive": "peds-training-content-5d77ebb9f5281f977a6a.zip",
    "bytes": 2636652,
    "sha256": "60eb2ae471461978ad83f6c26b7c8d1b75531905ca3a291644e9e84695411de9",
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
    "fileId": "41046386a7ea75bb0cebb525256eeb09",
    "archive": "peds-training-content-a56189cfabd49778cc23.zip",
    "bytes": 2642822,
    "sha256": "8f1bbe2ae6cded9a85ee573961b89b86fa32b63efb1efcdca10db55ae50b0c88",
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
    "fileId": "3b59208715cc0d1f53bae8ebd216917a",
    "archive": "peds-training-content-d53e3599344c0e05366b.zip",
    "bytes": 2967221,
    "sha256": "02559b9d0e390b6b8b110b13f29533d26d7344179d0c1b0a2d246d7212732d8d",
    "media": [
      {
        "fileId": "92a2f7fe82e77bfd0cd301a8329dbf8c",
        "sha256": "164d7c7a6cf88ae004db57813d8de83b7ad300c0989022a20138bf0c6a86bce5",
        "bytes": 38155799,
        "archive": "peds-training-media-d53e3599344c0e05366b-01.zip"
      },
      {
        "fileId": "228f5a51161b983fb8460c706dc0d73e",
        "sha256": "f4de7c22424d01887ee80b54ad14e5fc02ca5ec7fc75279bcd70d1259b2c63be",
        "bytes": 38243862,
        "archive": "peds-training-media-d53e3599344c0e05366b-02.zip"
      },
      {
        "fileId": "1b3e5978918dad599b520eae744133e1",
        "sha256": "8652e0e561c6d3a64b4c3d3999a564fbf0829feabf2ebd14e629022ebd1b53cd",
        "bytes": 24247769,
        "archive": "peds-training-media-d53e3599344c0e05366b-03.zip"
      }
    ],
    "expected": {
      "entries": 67,
      "sources": 53,
      "media": 1042
    }
  },
  {
    "fileId": "fa63b92466bd41481c7031846fa4c4f7",
    "archive": "peds-training-content-ab62cb5491a46fce456d.zip",
    "bytes": 2969706,
    "sha256": "8425b13310b50b96b1167cef263277f81cae043ccac91247caf356bfa94adfad",
    "media": [
      {
        "fileId": "c3bf9d3fae0041bf45118ce6ccf8214c",
        "sha256": "f98e6e8a38c39a873212d86016a206824d5283a3377fd9e49df69696975965ae",
        "bytes": 38155799,
        "archive": "peds-training-media-ab62cb5491a46fce456d-01.zip"
      },
      {
        "fileId": "9e91165ab0ba9dcb0fccce051f2c248f",
        "sha256": "2575fccc2d022c3d27c2c26ceb2b9f65608c88afb0d071a433c89031dbd1d103",
        "bytes": 38243862,
        "archive": "peds-training-media-ab62cb5491a46fce456d-02.zip"
      },
      {
        "fileId": "34ab2cbbb84f9dcdc442fcc51563b142",
        "sha256": "56f8d103be29f8d9de506d3049e4ca131ceaeae04fbb48b13ffaf2ff3395d052",
        "bytes": 24247769,
        "archive": "peds-training-media-ab62cb5491a46fce456d-03.zip"
      }
    ],
    "expected": {
      "entries": 67,
      "sources": 53,
      "media": 1042
    }
  },
  {
    "fileId": "4611dbb97147e28c43568e4bd520c190",
    "archive": "peds-training-content-8e613a5b589563710e74.zip",
    "bytes": 2993700,
    "sha256": "44d3eba5c471005c9972581db078071f882682f6509ae4d32fb5a303793fca3f",
    "media": [
      {
        "fileId": "5b11630454c17edf28b6ce634461fc98",
        "sha256": "7064a98d6af3377eb4c065910bb72dc3ae4d12734474661ea122ec45126e75f3",
        "bytes": 38155799,
        "archive": "peds-training-media-8e613a5b589563710e74-01.zip"
      },
      {
        "fileId": "6c5d05a94cecb8d6f23e4b15efefe84a",
        "sha256": "c5783057cd8e17e1335d1122fb2fbb7bd790f98ccf5b25c0fd85a75080661139",
        "bytes": 38243862,
        "archive": "peds-training-media-8e613a5b589563710e74-02.zip"
      },
      {
        "fileId": "74cb4d262f0d5097c01c2c839566dbc0",
        "sha256": "d284a326a1e0f1cd0a406c3b979a5e68d6af61a814960e3460da027608ad1a1f",
        "bytes": 24247769,
        "archive": "peds-training-media-8e613a5b589563710e74-03.zip"
      }
    ],
    "expected": {
      "entries": 67,
      "sources": 53,
      "media": 1042
    }
  }
];
