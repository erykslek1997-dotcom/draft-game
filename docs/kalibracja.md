# Kalibracja algorytmu oceny — start 2026-11-21, wnioski: środa 2026-11-25, 5:00

## Narzędzia (szybkie, na prawdziwych drużynach)
- `scripts/_offjudge.ts` — atak vs prawdziwy ORtg (600 drużyn, ~1 min). Dziś 0.7713.
- `scripts/_defjudge.ts` — obrona vs prawdziwy DRtg (~1 min). Dziś 0.8103.
- `bash scripts/judge.sh <nazwa> --compare=<nazwa>` — SRS 0.838, sim 0.64, D-TAL 0.829, piątki 0.572 (~5 min).
- `scripts/_draft2.ts <seeds>` + `scripts/_rotcmp.ts`, `measureRosterSense.ts 12` — drafty AI jak w grze.

## Draft użytkownika 3556759956 (2026-11-21) — co widać
| # | Drużyna | Ocena | Tytuł (sim) | Uwagi |
|---|---|---|---|---|
| 1 | Fresno (Price / Manu / Battier / LeBron / Walton) | 85.1 | 8% | ławka 90 |
| 2 | Cincinnati (CP3 / D. Green / Marion / Davis / Porziņģis) | 84.7 | 23% | fit 90, rotacja 90 (Haliburton 7 + 20, Cooper 5 + 5) |
| 3 | Raleigh (Kidd / Korver / George / Draymond / Hakeem) | 84.3 | **38%** | obrona 88, atak 70 |
| 6 | Little Rock (Curry / Klay / Iguodala / McHale / Embiid) | 83.0 | **<1%** | spacing 100 |
| 15 | Long Beach (Lowry / **Jordan** / G. Wallace / Odom / Russell) | 78.2 | <1% | atak 68, spacing 45 |
| 16 | Denver (West …) | 75.0 | 0% | |

**Wnioski robocze:**
1. **Ocena i symulacja się rozjeżdżają**: #1 ma 8% na tytuł, #3 — 38%, #6 z Currym <1%. Symulacja ceni obronę dużo bardziej niż ocena (Raleigh: obrona 88, atak 70 → faworyt). Największa niespójność gry.
2. **Drużyny z Jordanem znowu nisko** (Long Beach 78, atak 68 przy Jordanie O 99) — Odom 69 w piątce, Russell O 57, spacing 45. Do sprawdzenia: czy to kara za spacing / tłok, czy realnie słaby skład.
3. **Rotacja Cincinnati 90** — dziwne minuty (Haliburton 7 na PG + 20 na SG, Cooper 5 + 5) — sprawdzić automatyczną rotację gracza.

## Plan na poniedziałek–wtorek
1. **Ocena vs symulacja** — zmierzyć na 32 drużynach AI (2 drafty), które części oceny symulacja waży inaczej (atak / obrona / ławka / spacing); dostroić jedną albo drugą stronę do prawdziwych wyników (SRS / ORtg / DRtg), nie do siebie nawzajem.
2. **Skala ataku graczy** — pięciu solidnych vs dwóch po 100; gwiazdy z piłką (Westbrook, Harden, Oscar) za mocno karane jako drugi gracz z piłką.
3. **Drużyny z Jordanem** — rozbić ocenę Long Beach na części.
4. Odłożone opcje: `DT_NOREC_CAP` (bez efektu), `AI_STAR_GAP` (wymusza gwiazdy kosztem drużyn).
