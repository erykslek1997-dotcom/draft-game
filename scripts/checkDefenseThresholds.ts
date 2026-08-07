import { draftPool } from '../src/data/draftPool';
import { computeDefensiveImpact } from '../src/engine/talent';
import { RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES } from '../src/data/schema';

const RIM_THRESHOLD = 18;
const PERIMETER_THRESHOLD = 10;

const rimTagged = draftPool.filter((p) => RIM_PROTECTOR_ROLES.includes(p.defensiveRole as (typeof RIM_PROTECTOR_ROLES)[number]));
const perimTagged = draftPool.filter((p) =>
  PERIMETER_DEFENDER_ROLES.includes(p.defensiveRole as (typeof PERIMETER_DEFENDER_ROLES)[number]),
);

function report(label: string, tagged: typeof draftPool, threshold: number) {
  const impacts = tagged.map(computeDefensiveImpact).sort((a, b) => a - b);
  const passCount = impacts.filter((i) => i >= threshold).length;
  const median = impacts[Math.floor(impacts.length / 2)];
  console.log(
    `${label}: tagged=${tagged.length}, pass magnitude gate (>=${threshold})=${passCount} (${((passCount / tagged.length) * 100).toFixed(0)}%), median impact=${median.toFixed(1)}, min=${impacts[0].toFixed(1)}, max=${impacts[impacts.length - 1].toFixed(1)}`,
  );
}

report('Rim protector roles', rimTagged, RIM_THRESHOLD);
report('Perimeter defender roles', perimTagged, PERIMETER_THRESHOLD);
