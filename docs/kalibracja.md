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

## Lista na środę 2026-11-25 (ustalona z użytkownikiem 2026-11-21)
1. **Ocena vs symulacja meczów** — #1 ma 8% na tytuł, #3 (obrona 88) 38%, Curry-team <1%. Dopasować wagi ataku / obrony / ławki / spacingu w sim i ocenie do prawdziwych wyników (SRS / ORtg / DRtg), nie do siebie.
2. **Skala ataku graczy + gwiazdy z piłką** — pięciu solidnych vs dwóch po 100; Westbrook / Harden / Oscar za mocno karani jako drugi gracz z piłką.
3. **Nakładające się kary za piłkę** (skład użytkownika Porter / Wade / Pierce / Wembanyama / Shaq: talent 89 — najwyższy w lidze — a 12. miejsce, 81.5). Ten sam problem liczony 5-6 razy: limit piłki w ataku (`OFF_BALL`), „za dużo ról z piłką” w Fit (`demandBalance`, 2.68 > 1.9), trzy systemy naraz (`offensiveSystemOverloadPenalty`), PnR-PG obok gry tyłem (pairing note Porter–Shaq), reguły z oceny (trzech z piłką, tłok w pomalowanym).
   Uwagi użytkownika:
   - limit piłki i „za dużo ról” karzą graczy, którzy grają bez piłki (Porter, Pierce rzucają za 3 — portability ok) → udział w piłce zmniejszać rzutem z miejsca (`OFF_BALL_SHOOT`, `BH_SHOOT`), nie liczyć ich jak Westbrooka;
   - minuty gwiazd rozkładają się na 48 minut, nie grają cały czas razem → koszt piłki liczyć po wspólnych minutach, nie po piątce;
   - **spróbować usunąć kary „systemy” i „dopasowania” (Porter–Shaq) — może wyjdzie na plus.**
   Sprawdzian: sędziowie + Heat 2006, Lakers 2001, Warriors 2017 + ten skład.
4. **Drużyny z Jordanem** — Long Beach 78 (atak 68 przy Jordanie O 99): rozbić na części.
5. **Automatyczna rotacja gracza** — Cincinnati: Haliburton 7 + 20, Cooper 5 + 5.

## (stary plan — zastąpiony listą wyżej)
1. **Ocena vs symulacja** — zmierzyć na 32 drużynach AI (2 drafty), które części oceny symulacja waży inaczej (atak / obrona / ławka / spacing); dostroić jedną albo drugą stronę do prawdziwych wyników (SRS / ORtg / DRtg), nie do siebie nawzajem.
2. **Skala ataku graczy** — pięciu solidnych vs dwóch po 100; gwiazdy z piłką (Westbrook, Harden, Oscar) za mocno karane jako drugi gracz z piłką.
3. **Drużyny z Jordanem** — rozbić ocenę Long Beach na części.
4. Odłożone opcje: `DT_NOREC_CAP` (bez efektu), `AI_STAR_GAP` (wymusza gwiazdy kosztem drużyn).
