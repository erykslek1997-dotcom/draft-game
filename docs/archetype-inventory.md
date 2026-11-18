# Archetypes → traits: inventory (2026-11-18)

The user: archetypes were set at an earlier level of data and stats knowledge; rebuild them for this
engine from the ground up, attack and defense. Plan: replace the one-label switch
(`offensiveArchetype`, `defensiveRole`) with continuous traits computed from data, one engine use at
a time, each measured on the judges and agreed with the user before it goes in. The label can stay
for display.

Where the engine reads a label today, grouped by the trait it actually needs.

## Attack

| Trait it needs | Where (file: what) |
|---|---|
| **Shot creation / self-creation** | `spacing.ts` ARCHETYPE_SELF_CREATION (Shot Creator 1, PBH 0.85, SBH 0.55); `scoring.ts` PRIMARY_CREATOR_ARCHETYPES floor, creator check (l.323); `fit.ts` self-creation proxy floor (l.636), load (l.1173); `talent.ts` EFFICIENCY_SELF_CREATION (Roll & Cut Big); `selfCreationSimilarity.ts` archetype prior; `aiDrafter.ts` HIGH_USAGE_ARCHETYPE_WEIGHT, isSelfCreatorArchetype, non-elite creator cap (l.1272), ELITE_PERIMETER_ENGINE |
| **Ball handling / initiating** | `pairwiseFit.ts` initiator factor (l.324), two handlers (l.54, l.74); `positionCompetence.ts` PG_HANDLERS, CREATORS (playing PG/SF off position); `talent.ts` PLAYMAKER_ARCHETYPES (l.652); `championshipArchetype.ts` creator weights |
| **Rim pressure / finishing** | `rimPressure.ts` ARCH_ELIGIBILITY (Post 1.0, Roll & Cut 1.0, Versatile 0.85, Athletic Finisher 0.5) and PROXY_ARCHETYPES; `aiDrafter.ts` Slasher (l.1240) |
| **Post scoring** | `scoring.ts` Post Scorer fallback (l.480); `fit.ts` same (l.628); `pairwiseFit.ts` post pairs, helio-post (l.131, 163, 253); `aiDrafter.ts` (l.1096, 1231) |
| **Screening: roll vs pop** | `pairwiseFit.ts` ROLL_SCREENER_ARCHETYPES, pop = Stretch/Versatile Big (l.337-338), roller non-spacer (l.179) |
| **Off-ball shooting (movement / spot-up)** | `offBallProfile.ts` assigns Movement / Off Screen / Stationary from shot data; `aiDrafter.ts` OFF_BALL_SHOOTER cap (l.1280); `portability.ts` SPACING_ARCHETYPES bonus |
| **Style mix** | `pairwiseFit.ts` STYLE_BUCKET (l.208) |
| **Portability** | `portability.ts` big types (l.346-348); `portabilityCorrection.ts` shooter + wing defender, post/versatile big, stretch + anchor |

## Defense

| Trait it needs | Where (file: what) |
|---|---|
| **Rim protection** | `schema.ts` RIM_PROTECTOR_ROLES; `scoring.ts` isStrongRimProtector; `liveDefense.ts` rimRole (l.66); `defensiveHuntability.ts` anchor cover, D-TAL by role (l.101-153); `defensiveCohesion.ts` RIM_ROLES; `fit.ts` rim layer (l.997); `aiDrafter.ts` lacksRimProtection need; `netRatingProjection.ts`; `championshipArchetype.ts` rim anchors |
| **Point of attack (on the ball)** | `fit.ts` POA layer (l.977-978); `defensiveCohesion.ts` POA (l.320); `defense.ts` role weights |
| **Wing / perimeter stopping** | `schema.ts` PERIMETER_DEFENDER_ROLES; `scoring.ts` isStrongPerimeterDefender; `defensiveTalent.ts` PERIMETER_STOPPER_ROLES floor (l.434-463); `defensiveCohesion.ts` WING_ROLES; `fit.ts` wing layer (l.985); `aiDrafter.ts` perimeter need |
| **Switching / versatility** | `fit.ts` SWITCHABILITY_ROLE_SCORE (l.779); `liveDefense.ts` versatile (l.88); `fit.ts` Switch Big layer |
| **Help / rotations** | `fit.ts` Helper layer (l.989) |
| **Low activity (a defender to hide)** | `defensiveTalent.ts` team-D floor off for Low Activity (l.596); `championshipArchetype.ts` |
| **Role → D-TAL weights** | `defense.ts` role scores (Anchor 9, POA 8, Wing 7 ... Low Activity 0) |

## How labels are set today

- `src/data/players.ts` (180 refs), `historicalRimPressureEvidence.ts`, `defensiveRoleProfiles.ts`: hand-set and profile data.
- `roleFitShadow.ts` / `roleAudit.ts` / `roleAudit.json` (2026-10-23): defensive role audited from data at load.
- `offBallProfile.ts`: off-ball shooter type from shot data.
- `draftPool.ts`: a few name patches.
- Display only: `components/cardRoles.ts`, `ResultsScreen.tsx`, `insights*`, `deskCalls.ts`, `styleLines.ts`.

## Proposed traits (0-100, from data available in each era)

Attack: self-creation, ball handling, rim pressure, post scoring, roll threat, pop / stretch,
off-ball movement shooting, spot-up shooting. Defense: rim protection, point of attack, wing
stopping, switchability, help / rotations, activity.

Order of work: traits computed and checked on real teams and fives first; then each use above moves
from label to trait separately, measured; the label rules that turn out redundant go last.
