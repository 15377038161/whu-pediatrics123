import { CASE_CATALOG, RETIRED_SIMULATION_PROFILES } from '../../src/domain/case-catalog';

// Historical deterministic-engine tests explicitly register their synthetic fixtures
// in their own test process. Production catalogues and retirement tests never import this.
for (const profile of RETIRED_SIMULATION_PROFILES) {
  if (!CASE_CATALOG.some(item => item.id === profile.id)) CASE_CATALOG.push(profile);
}
