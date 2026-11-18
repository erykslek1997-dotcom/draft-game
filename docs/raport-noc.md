# Raport z nocy (2026-11-18/19)

Wszystko za przełącznikami, domyślnie wyłączone. Liczby: sędziowie quick (`scripts/judge.sh`), przypadki kontrolne (`scripts/controlCases.ts`, 12 sprawdzeń).

## Stan wyjściowy (base1118)
SRS 0.842 / 0.836 · sim R² 0.67 · D-TAL 0.825 · piątki 0.548 · AI: sd 2.89 · kontrolne 8/12.

## 0. Narzędzia
- `scripts/controlCases.ts` — 14 składów z oceny, 12 oczekiwań. Dziś 8/12. Nie przechodzą: Giannis + Horford > Giannis + Wallace; Curry i Dončić > Stockton; atak Stocktona < atak Curry'ego.

## 1. Etykiety → dane
| Przełącznik | Co | Sędziowie | Kontrolne |
|---|---|---|---|
| `SKILL_USAGE` | posiadanie piłki: USG% (tracking / BBRef od 1978) × samodzielność, zamiast etykiety; fit.ts przed 1997 + AI | SRS 0.841 / 0.836, sim 0.68, piątki 0.548 — bez zmian | 8/12 |
| + `SKILL_PNR` `SKILL_TAL` `SKILL_AI` (wszystkie) | rozgrywający w pick-and-rollu i rolowanie z cech; 4 bramki w TAL; 4 bramki ról AI | SRS 0.841 / 0.837, sim 0.67, D-TAL 0.825, piątki 0.549 — bez zmian | 8/12 |
- TAL przy `SKILL_TAL`: 1272 okien z 10 962 zmienia się o ≥ 0.5; 80+ średnio +0.07. W górę m.in. Lowry 2007-09 64→71, DeRozan 2021-23 58→65, Arizin 1957-59 72→78; w dół Marques Johnson 1980-82 78→73, Josh Howard 2003-05 65→60. Poprawione po drodze: Carmelo +8 (zwolnienie z kary za dużo rzutów — teraz tylko dla nie-kreatorów), Wembanyama −6 (bramka „finiszer” — teraz z prawdziwego % asystowanych rzutów).
- AI, pełny test 10 draftów (wszystkie cztery przełączniki): Overall 77.96 → 78.38, sd 2.96 → 2.72 (dalej od celu 3-3.5), gwiazdy 90+ spadają dalej w drafcie (90. centyl numeru wyboru 20 → 32, najgorszy 84 → 68). **Etykiety w AI (`SKILL_AI` + `SKILL_USAGE`) pogarszają draft gwiazd** — rekomendacja: włączyć `SKILL_TAL` i `SKILL_PNR` (sędziowie bez zmian), AI zostawić na etykietach do osobnego dostrojenia.
- Wade / Oscar pomijani w drafcie: to cap (Wade 2008-10 20.8 FGA na ~11 średnio na gracza), nie etykieta.

## 2. Atak za nisko (pkt 5) — diagnoza
Curry + Klay + Butler + Mobley + Russell bez ławki: atak 67 (raw 79). Składniki: O-TAL 84, spacing 100 (sufit — rzut Curry'ego nic więcej nie daje), pick-and-roll 50, spójność +0.9. Shaq + Haliburton: 88 (atak na kosz 100, pick-and-roll 87, spójność +5.7, zbiórki w ataku +6.4). Wniosek: Offense to prawie średnia O-TAL + bonusy za grę w pomalowanym; brak nagrody za grawitację elitarnego strzelca ponad sufit spacingu → pkt 6 („Curry rozwiązuje wszystko”) nie istnieje w silniku.

## 3. D-TAL z cech (`DT_SKILL`)
Odczyt z cech (obwodowi 0.45 POA + 0.35 help + 0.2 aktywność; wysocy 0.45 rim + 0.3 help + 0.15 zbiórka + 0.1 aktywność), na skali D-TAL według pozycji. r z dzisiejszym D-TAL 0.73-0.81.
Przy 0.5 nie naprawia przypadków z listy: George 2016-18 62 → 53, Bridges 2019-21 64 → 54, Jokić 63 → 41; Manu z 85 → 80-81 (sufit znika), Caruso 95 → 85.
**Sędzia (0.5): D-TAL 0.825 → 0.810, sim 0.67 → 0.64, SRS 0.842 → 0.843, piątki 0.548 → 0.546. Odrzucam** — z tymi wagami cechy obronne gorzej przewidują prawdziwą obronę niż obecny D-TAL. Skoki George'a / Iguodali z listy też nie znikają. Potem wagi dopasowane do prawdziwego DRtg (`scripts/_dfit.ts`, 375 sezonów 1998+, fit parzyste / test nieparzyste): obecny D-TAL r 0.788; same cechy 0.742; D-TAL + cechy 0.792 (+0.004). Prawie całą wagę bierze `help` (częściowo z on/off, czyli z wyników drużyny — błędne koło); point of attack i rim protect ~0. **Wniosek: dane nie uzasadniają D-TAL z cech.** Skoki George'a / Iguodali naprawiać wygładzaniem sąsiednich okien (`NEIGHBOUR_WINDOW_SHARE`), nie cechami — do decyzji.

## 4. Czy zasady z oceny widać w prawdziwych danych? (przed budową mechanizmu)
**Drużyny 1998+** (`scripts/_offfeat.ts`, 511 sezonów, cechy pierwszej piątki vs to, czego surowy Offense nie łapie w prawdziwym ORtg): wszystkie |r| ≤ 0.10 i niestabilne parzyste/nieparzyste — elitarny strzelec, liczba niestrzelających, obciążenie piłką, trzeci z piłką, drugi atakujący kosz (+0.10, odwrotnie niż zasada), drugi post, najlepszy kreator, obwodowy bez rzutu i piłki.
**Prawdziwe piątki 2007-08+** (`measureLineups.ts`, 150+ min, net na 100 vs Overall):
| Zasada | n | efekt | |
|---|---|---|---|
| trzech dominujących piłkę | 5 | +0.92 ± 1.97 | za mało |
| dwóch atakujących kosz bez rzutu | 74 | +0.27 ± 0.77 | brak |
| dwóch post-scorerów | 253 | −0.41 ± 0.43 | kierunek zgodny, w szumie |
| obwodowy bez piłki i rzutu | 204 | −0.36 ± 0.56 | kierunek zgodny, w szumie |
| elitarny strzelec + dwóch niestrzelających wysokich | 114 | +0.65 ± 0.70 | kierunek zgodny (Curry), w szumie |
| dwóch słabych obrońców obwodu | 509 | −0.30 ± 0.33 | kierunek zgodny, w szumie |
| starter poziomu ławki (TAL < 70) | 1005 | −0.03 ± 0.23 | brak |
| brak samodzielnego kreatora (sufit) | 296 | −0.12 ± 0.44 | brak |
| (istniejąca) trzech+ niestrzelających | 388 | −0.84 ± 0.36 | realny koszt — silnik już go liczy |

**Wniosek:** dane NBA nie potwierdzają ani nie obalają zasad — kierunki zwykle zgodne, efekty małe. Najpewniej dlatego, że prawdziwe drużyny rzadko budują takie konflikty (Magic + Wade, dwóch C MVP nie istnieją). Zasady z oceny to więc wiedza ekspercka do składów all-time, a nie coś, co da się skalibrować na NBA. Propozycja: wprowadzać je małymi wagami (rzędu tych kierunków: 0.3-0.7 pkt na 100), tak żeby nie psuły sędziów, i sprawdzać przypadkami kontrolnymi — decyzja użytkownika.

## 5. Mechanizm reguł z oceny (`REVIEW_W`, `src/engine/reviewRules.ts`)
Reguły z piątki, każda ±`REVIEW_W` pkt Overall:
− tłok w pomalowanym (dwóch trzymających piłkę przy koszu bez rzutu: Wade + Giannis, Embiid + Duncan), − trzech dominujących piłkę (Magic + Wade + Dirk, Jokić + Carter + Brunson), − obwodowy bez piłki i bez rzutu (Alvin), − drugi słaby obrońca obwodu, − starter poziomu ławki (TAL < 70 albo skrzydłowy z O < 50: Caruso), + elitarny strzelec z piłką (Curry, Dončić) kasuje koszt niestrzelających wysokich-zasłoniarzy.
Uwaga: cecha `post` mierzy strefę, nie post-up (Nash 97, Shaq 9) — dlatego „tłok” liczony z rim pressure + brak spot-upu + piłka.
Kontrolne: W=0 8/12 → W=1 9/12, W=2 9/12. Dalej nie przechodzą: Giannis + Horford > + Wallace, Dončić > Stockton, atak Stocktona < Curry'ego — to już sam Offense (pkt 2 diagnozy), nie reguły.

## 6. Minuty (LeBron 16 z 40 na PF)
Nie błąd, tylko zamierzone: gwiazda pokrywa inną pozycję, gdy siada tamtejszy starter. LeBron we wszystkich czterech drużynach z 10 draftów: PG 10-12 min + PF 26-29 (albo SF 24 + PF 16). Strona pokazywała to jako „16m (razem 40m)”. Do oceny użytkownika, czy LeBron jako zmiennik PG jest ok.
Sędziowie przy W=1 (quick): SRS 0.842 / 0.838 (base 0.836), sim 0.67, D-TAL 0.825, piątki 0.550 (base 0.548) — bez szkody, lekko lepiej. AI (quick): starter z TAL < 60 na 10+ min 26% → 19%, starter poza pozycją 9% → 13%.

## 7. Zestaw rekomendowany: `REVIEW_W=1 SKILL_TAL=1 SKILL_PNR=1`
Sędziowie (quick): SRS 0.842 / 0.839 (base 0.842 / 0.836), sim 0.66 (0.67), D-TAL 0.825, piątki 0.551 (0.548).
AI, pełny test 10 draftów: Overall 77.57 (base 77.96), sd 2.98 (2.96), starter TAL < 60 na 10+ min 24% (26%), gwiazdy 90+: 90. centyl wyboru 20 (20), najgorszy 86 (84). Kontrolne 9/12 (8/12).
Czyli: nie psuje niczego, lekko pomaga piątkom i starterom; nie rozwiązuje ataku Curry'ego (to osobny problem Offense).

## 8. Dlaczego AI omija gwiazdy (Wade, Oscar) i bierze role playerów
Licznik (`scripts/_oddities.ts`, poprawiony: raz na pominiętego gracza), 10 draftów: Wade 95 pomijany w **każdym** drafcie, zwykle od ~#24 do #56-79 (do 49 wyborów); Oscar 92 od ~#45-74 do #80; Kareem 97 do #13-28; LeBron 105 nie idzie z #1.
Ślad wyceny (`scripts/_wadeWhy.ts`, seed 104, hook `__aiScoredHook` w `aiDrafter.ts`):
- pick 30 (roster: LeBron): Stockton 156.7 > Wade 151.1 (5. miejsce) — blisko.
- pick 40 (Bird, Green): Carter 221.5, Billups 219.9 (`gmProfileBonus` +14..16), Klay 216.3 > Wade 211.3 (11.).
- pick 55: Artest 79 TAL → `talentTerm` 253 (need × 3.2), Anunoby 77 → 241, Marion 85 → 256.
**Wniosek:** potrzeba pozycji mnoży talent (`rampedNeed` 1.4-3.2), a do tego profil GM (+14..16) i szum tablicy (±14). Różnica 16 TAL (Wade 95 vs Artest 79) przegrywa z samym mnożnikiem potrzeby. To jest mechanizm „AI wypełnia role zamiast brać talent”. Propozycja na rano (do decyzji): ograniczyć mnożnik potrzeby (np. ≤ 1.5× albo addytywnie) i zmniejszyć profil GM / szum dla talentu 90+; zmierzyć licznikiem + `measureRosterSense` + kontrolnymi.
