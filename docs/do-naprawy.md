# Do naprawy (z przeglądu draftów, 2026-11-19)

Kolejność: od tego, co wpływa na najwięcej. Każda zmiana za przełącznikiem → sędziowie + przypadki kontrolne (`scripts/controlCases.ts`) + licznik (`scripts/_oddities.ts`) → decyzja użytkownika. Szczegóły i przykłady: `docs/lineup-principles.md`.

## 1. Atak drużyny (najważniejsze)
**Problem:** atak liczony prawie jak średnia talentu piątki. Gwiazda nie podnosi drużyny, a słabszy atakujący ją ściąga.
- Za nisko: Jordan 1990-92 → **59**, Wade + Garnett + Stockton **62**, Curry **67**, Jokić + McGrady **68**, Kareem + West **69**, Magic + Malone **73**.
- Za wysoko: kolejni gracze z piłką dodają pełny talent — Kobe + Tatum + Love **93** vs Kobe + Anunoby + Rasheed 68 (użytkownik woli drugi).
**Do zrobienia:**
- a) Gwiazda z piłką podnosi atak całej drużyny (nie tylko swoją część średniej).
- b) Malejąca wartość: drugi, trzeci gracz z piłką dodaje do ataku coraz mniej (pkt 9, 10). Dziś reguła „trzech z piłką” daje tylko −1 — za mało.
- c) Strzelec elitarny daje coś ponad maksimum spacingu (Curry).
- Test: przypadki kontrolne — Curry i Dončić wysoko, Anunoby + Rasheed > Tatum + Love, atak Stocktona < Curry'ego.

## 2. Systemy liderów (pkt 6)
Co lider potrzebuje obok siebie:
- Curry: point forward (Draymond, Iguodala, Butler) i zasłoniarze.
- Dončić: wysocy do lobów.
- Shaq, Kareem: PF, który rzuca (nie Kemp, nie Bobby Jones).
- Giannis: czterech strzelców, rzucający C (Lopez).
- Konflikty: Dončić + Hakeem, Shaq + Harden — dwa systemy.
- Pary, które działają: Stockton + Malone, Draymond + Klay, Wade + Garnett + Lopez, Malone + Porziņģis w obronie.

## 3. Rotacja — minuty
- Słabszy rezerwowy gra więcej niż lepszy: Tucker 23 vs Anunoby 12; Thybulle 24 vs Howard 12; Rivers 25 vs Butler 15; Fisher 24 vs Russell 13; Hill 24 vs Kirilenko 14; Outlaw 25 > starter Love na PF.
- Lepszy rezerwowy ma prawo grać więcej niż starter na tej pozycji (Butler 28 vs Williams 20).
- Gwiazdy za mało: Duncan 23 na C, Davis 12 na C (Nenê 36).
- Pojedyncze minuty na innej pozycji: Fisher 1 min na SF; Prigioni 16 min na SG.
- Wzorzec użytkownika (Nash / Barkley / Duncan) w `lineup-principles.md`.

## 4. AI w drafcie
- Drogi zmiennik, który mało gra: Howard za Hakeemem. (Tani — Ben Wallace za Duncanem — jest ok.) Wycena: minuty, które dostanie / koszt.
- Tani w capie, drogi w piłce: Stockton przy Wade + Garnett. Liczyć koszt piłki, nie tylko rzutów.
- Gwiazdy pomijane: Wade 95 w każdym drafcie przez 30-50 wyborów; mnożnik potrzeby pozycji (×1.4-3.2) przewyższa różnicę talentu. (Test `AI_NEED=0.5` — mieszany, odrzucony; trzeba inaczej.)
- Ławka: rezerwowi bez ataku mimo kary `benchOffense` (Chuck Hayes, Thybulle), gracze TAL 37-60 (Duhon, Prigioni, Bonner), za mało PG i rzutu.

## 5. Ocena drugiego składu
- Brak rozgrywającego z ławki (Paul / Klay; Giannis): na prawdziwych piątkach „brak PG” −1.31.
- Brak rzutu z ławki (Bird / Allen / Holiday: Baron Davis, Prince, DeAndre).
- Silnik liczy spacing i rozgrywanie głównie dla piątki.

## 6. Obrona — pojedyncze oceny (pkt 4)
Za nisko, box nie widzi: Dumars (All-Defensive, D 21-65), Paul George 2019-21 62, Iguodala 2014-16 63, Bridges 2019-21 64, Rodman 1993-95 66. Sprawdzić podłogę za nagrody All-Defensive. (D-TAL z cech i wygładzanie — odrzucone przez sędziów.)
Podejrzanie wysoko: Charlie Ward 89.

## 7. Drobne
- Test `testDefensiveHuntability` („all-time defensive shell…”) nie przechodzi — od przed zmian z nocy.
- `testRotationEditable` — przekroczył czas przy równoległym obciążeniu, sprawdzić osobno.

## Już zrobione (2026-11-19)
- **Atak (pkt 1, część):** bez dodatku za spójność (nagradzał drugiego i trzeciego elitarnego strzelca), limit piłki 0.5 (kolejni gracze z piłką liczą się coraz mniej), łagodna podłoga gwiazdy 0.15, skala wyśrodkowana. Sędziowie: SRS 0.844 / 0.839, piątki 0.551, atak vs ORtg 0.766 → 0.770, kontrolne 11/13, AI sd 3.14. Jordan 63 → 69, Curry 67 → 70, Shaq + Harden 93 → 83, Kobe + Tatum + Love 93 → 82 (Anunoby + Rasheed teraz wyżej). Zostaje: Jordan nadal niżej niż przeładowane składy (mocniejsza podłoga psuła dane NBA); Dončić > Stockton i Giannis + Horford > + Wallace nie przechodzą.
- **Symulacja meczów** liczy atak po staremu (sim R² 0.66 → 0.63) — dostosować raz, na końcu, gdy oceny składów będą ok (decyzja użytkownika).
- Reguły z oceny (`reviewRules.ts`, `REVIEW_W=1`): tłok w pomalowanym, trzech z piłką, obwodowy bez piłki i rzutu, drugi słaby obrońca obwodu, starter poziomu ławki, niestrzelający rozgrywający obok gwiazdy, brak floor generala, + elitarny strzelec z piłką.
- Etykiety → dane w TAL i pick-and-rollu (`SKILL_TAL`, `SKILL_PNR`).
