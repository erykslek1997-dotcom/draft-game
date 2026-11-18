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
- AI (quick, 4 drafty, głośne): gorzej — starter poza pozycją 9% → 25%, gwiazdy 90+ spadają dalej (90. centyl 15 → 34). Pełny test 10 draftów w toku.
- Wade / Oscar pomijani w drafcie: to cap (Wade 2008-10 20.8 FGA na ~11 średnio na gracza), nie etykieta.

## 2. Atak za nisko (pkt 5) — diagnoza
Curry + Klay + Butler + Mobley + Russell bez ławki: atak 67 (raw 79). Składniki: O-TAL 84, spacing 100 (sufit — rzut Curry'ego nic więcej nie daje), pick-and-roll 50, spójność +0.9. Shaq + Haliburton: 88 (atak na kosz 100, pick-and-roll 87, spójność +5.7, zbiórki w ataku +6.4). Wniosek: Offense to prawie średnia O-TAL + bonusy za grę w pomalowanym; brak nagrody za grawitację elitarnego strzelca ponad sufit spacingu → pkt 6 („Curry rozwiązuje wszystko”) nie istnieje w silniku.

## 3. D-TAL z cech (`DT_SKILL`)
Odczyt z cech (obwodowi 0.45 POA + 0.35 help + 0.2 aktywność; wysocy 0.45 rim + 0.3 help + 0.15 zbiórka + 0.1 aktywność), na skali D-TAL według pozycji. r z dzisiejszym D-TAL 0.73-0.81.
Przy 0.5 nie naprawia przypadków z listy: George 2016-18 62 → 53, Bridges 2019-21 64 → 54, Jokić 63 → 41; Manu z 85 → 80-81 (sufit znika), Caruso 95 → 85. Sędzia w toku.
