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
   **Zrobione 2026-11-21:** `OFF_BALL_SHOOT` 0 → 0.5 (strzelec z miejsca traci połowę udziału w piłce w limicie piłki; atak vs ORtg 0.7713 → 0.7725 w obu połowach), `REV_OFFBALL_SPOT` 90 → 65 (reguła „trzech z piłką” nie liczy strzelców 65+), kary w Fit „trzy systemy” i „za dużo ról z piłką” wyłączone (`FIT_SYSOVER=0`, `FIT_CROWD=0`; sędziowie bez zmian). Sędziowie: SRS 0.838, piątki 0.572 bez zmian; sim 0.63 → 0.61 (sim tego nie widzi — punkt 1). Skład użytkownika 81.5 → 82.6.
   Rozkład minut gwiazd: starterzy grają ~36 min, więc dwie gwiazdy są razem ~24-30 z 48 min — liczenie piłki po wspólnych minutach ≈ niższy limit piłki. `OFF_BALL` 0.5 → 0.35: atak vs ORtg 0.7725 → 0.7727, skład użytkownika 82.6 → 82.8 (minimalne) — do pakietu w środę. Prawdziwe rozkładanie gwiazd na zmiany w rotacji (staggering) — osobny pomysł na później.
4. **Drużyny z Jordanem** — Long Beach 78 (atak 68 przy Jordanie O 99): rozbić na części.
5. **Automatyczna rotacja gracza** — Cincinnati: Haliburton 7 + 20, Cooper 5 + 5.

6. **Obrona all-defensive niedoceniona (draft 307382012, Cheyenne)** — Wade, Duncan, Horford, Millsap, J. Williams to gracze z All-Defensive, a obrona tylko 78 (11. z 16), spójność 52. Silnik liczy D-TAL niżej niż karta: J. Williams 67 (karta 81), Horford 70 (karta 79). Spójność: eliteShell 0, completeness 0, średnia D 69 (ciągnie Haliburton 23). Sprawdzić: (a) różnica karta vs silnik dla nowszych skrzydłowych / wysokich, (b) czy brak typowego PoA ma tak duży koszt przy Wadzie 80 na obwodzie. Skrypt: `scripts/_chy.ts`.
   **Zrobione 2026-11-21:** przyczyna — obrona okna mieszana w 25% z sąsiednimi oknami (`DT_NEIGH`): J. Williams 2023-25 ciągnięty w dół przez debiutanckie 2022-24 (39). `DT_NEIGH` 0.25 → 0: obrona vs DRtg 0.8103 → 0.8128 (obie połowy w górę), SRS 0.838 → 0.839, D-TAL 0.829 → 0.833, piątki 0.572 → 0.573. Williams 67 → 76, Horford 70 → 72, Wade 80 → 83; Cheyenne 75.9 → 77.0.
7. **Spacing Millsapa 43** — 3P ok. 33% przy 3-4 próbach na mecz; użytkownik: „C+, odrobina spacingu jest”. Sprawdzić skalę spacingu dla wysokich rzucających okazjonalnie.
8. **Limit piątki AI (Anchorage 1-81)** — `TOP5_SLOT_FLOOR` (rezerwa capów na niewybranych starterów); wynik testu niżej.

## (stary plan — zastąpiony listą wyżej)
1. **Ocena vs symulacja** — zmierzyć na 32 drużynach AI (2 drafty), które części oceny symulacja waży inaczej (atak / obrona / ławka / spacing); dostroić jedną albo drugą stronę do prawdziwych wyników (SRS / ORtg / DRtg), nie do siebie nawzajem.
2. **Skala ataku graczy** — pięciu solidnych vs dwóch po 100; gwiazdy z piłką (Westbrook, Harden, Oscar) za mocno karane jako drugi gracz z piłką.
3. **Drużyny z Jordanem** — rozbić ocenę Long Beach na części.
4. Odłożone opcje: `DT_NOREC_CAP` (bez efektu), `AI_STAR_GAP` (wymusza gwiazdy kosztem drużyn).
