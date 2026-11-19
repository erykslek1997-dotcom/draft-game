# Do naprawy (z przeglądu draftów, 2026-11-19)

Każda zmiana za przełącznikiem → sędziowie + przypadki kontrolne (`scripts/controlCases.ts`, dziś 12/16) + licznik (`scripts/_oddities.ts`) → decyzja użytkownika. Przykłady: `docs/lineup-principles.md`.

**Główny wniosek z przeglądu:** piątki bywają dobre, a ławka prawie zawsze psuje odbiór; AI buduje ogólnie słabe drużyny, więc solidne składy (Kidd + Hakeem) lądują w czołówce. Najpierw AI i ławka.

## 1. AI w drafcie (priorytet)
Wspólna przyczyna: AI wycenia gracza jedną liczbą (TAL / koszt w capie), a nie tym, co da tej drużynie.
- **Zły okres kariery:** Kawhi 2013-15 (TAL 92, O 63, 11.3 FGA) zamiast 2015-17 (TAL 95, O 96, 16.5 FGA). 3 pkt TAL ukrywa 33 pkt ataku. Z Kawhim 2015-17 (i tańszym zmiennikiem C zamiast Holmgrena) — „najlepszy AI drafted skład”.
- **Tani w capie, drogi w piłce:** Stockton przy Wade + Garnett. Cap liczy rzuty, rozgrywający kosztuje piłkę.
- **Drogi zmiennik, który mało gra:** Howard za Hakeemem / za Wembanyamą, Walton za Gasolem (14 min). Tani zmiennik (Ben Wallace za Duncanem) jest ok.
- **Ławka:** po wydaniu capu najtańsi, nie najbardziej przydatni — bez ataku (Chuck Hayes, Thybulle mimo kary `benchOffense`), TAL 37-60 (Duhon, Temple, Prigioni, Bonner), bez PG i bez rzutu.
- **Gwiazdy pomijane:** Wade 95 przez 30-50 wyborów w każdym drafcie; mnożnik potrzeby pozycji przewyższa różnicę talentu (`AI_NEED=0.5` — mieszane, odrzucone).
- **Starzy gracze:** Dolph Schayes 1951-53 w piątce, Bob Kauffman 1971-73 21 min — kara za niepewne dane nie działa.

## 2. Rotacja — minuty
- **Gwiazda C gra za mało, słabszy C resztę:** Wembanyama 24 (Chandler 24), Duncan 23-24 (Nenê 25, Rollins 24), Davis 12 na C (Lanier 36) — najczęstszy błąd.
- **Lepszy rezerwowy siedzi, słabszy gra:** Butler 30 z ławki, a Schayes w piątce; Tucker 23 vs Anunoby 12; Thybulle 24 vs Howard 12; Rivers 25 vs Butler 15; Hill 24 vs Kirilenko 14; Fisher 24 vs Russell 13.
- **Gracz nie na swojej pozycji / okruchy:** Prigioni 16 min na SG (trzy razy), Fisher 1 min na SF, Dantley 1 min na SG. Sprawdzone: Prigioni ma w danych pełną drugą pozycję SG; wyższy próg „przydatnej zmiany” (`ROT_BENCH_FLOOR` 55 → 65) oddaje jego minuty Gregowi Anthony'emu (63), a Mullin 1997-99 ma limit 24 min — na tej ławce nie ma lepszego zmiennika obwodu, to problem draftu (pkt 1).
- **Zasada z wzorców użytkownika:** piątka to najlepszych pięciu, pozycje dopasowane do nich (Bird na PF, Butler na SF); słaby rezerwowy gra tylko zastępstwo; lepszy rezerwowy może grać więcej niż starter tej pozycji. Wzorce: Nash / Barkley / Duncan i Chicago (Bird / Butler) w `lineup-principles.md`.

## 3. Ocena drugiego składu
Silnik liczy spacing i rozgrywanie głównie dla piątki. Brak PG z ławki (Paul / Klay; na prawdziwych piątkach „brak PG” −1.31), brak rzutu z ławki (Bird / Allen / Holiday).

## 4. Atak — dokończyć
- Wartość spacingu dla gwiazdy: przy LeBronie Billups + Manu + rzucający wysocy vs Payton + Russell — atak ma się różnić ≥ 8 (dziś 5).
- Jordan dalej niżej niż przeładowane składy.

## 5. Systemy liderów (mała strata, nie kara — „działa, ale nie maksymalizuje”)
- PnR-PG potrzebuje lob threat: Paul + Kareem, Dončić + Hakeem.
- Post C potrzebuje rzucającego PF: Shaq + Kemp, Kareem + Bobby Jones, Hakeem + Nenê, Duncan + Rodman.
- Curry potrzebuje point forwarda (Draymond, Iguodala, Butler).
- Konflikty liderów: Harden + Wade, Harden + Shaq, Dončić + Giannis.
- Pary, które działają: Stockton + Malone, Draymond + Klay, Wade + Garnett + Lopez, Billups + Manu + LeBron, Malone + Porziņģis (obrona).

## 6. Pojedyncze oceny graczy
- Za nisko w obronie: Dumars (All-Defensive, D 21-65), Rodman 1993-95 66, George 2019-21 62, Iguodala 2014-16 63, Bridges 2019-21 64. Sprawdzić podłogę za All-Defensive.
- Podejrzane: Tony Parker 2006-08 TAL 66 (MVP finałów 2007), Schayes 1951-53 TAL 77, Charlie Ward D 89, Kawhi 2013-15 TAL 92 przy O 63.

## 7. Na koniec
- Symulacja meczów — dostosować raz, gdy oceny składów będą ok (sim R² 0.66 → 0.63 po zmianach w ataku).
- `testDefensiveHuntability` nie przechodzi (sprzed zmian); `testRotationEditable` — sprawdzić osobno.

## Już zrobione (2026-11-19)
- **AI: wybór okresu kariery** (`AI_WIN_OTAL=15`, `AI_WIN_OW=0.3`): okresy „równe poza ceną” tylko przy podobnym ataku, a oddany atak kosztuje. Kawhi 2015-17 zamiast 2013-15. 10 draftów: zróżnicowanie 3.13 → 3.41, 90. centyl wyboru gwiazd 90+ 25 → 22.
- **Efekt rotacji na tych samych draftach (401-402):** „lepszy na ławce niż starter” 5.5 → 2.5 na draft, „drogi zmiennik TAL 80+ ≤ 16 min” 1.5 → 0.5, słabi starterzy 5.5 → 5.0.
- **Odrzucone:** `AI_BENCH_WASTE=1` (kara w drafcie za zablokowanego zmiennika) — drogi zmiennik 0.5 → 1.5, gorzej.
- **Rotacja (część pkt 2):** gwiazda może zaczynać na pozycji, którą gra w pełni (Bird na PF → Butler w piątce, Schayes poza nią); dodatek za własną pozycję 18 → 10 (Butler 27 na SF, Williams 11 na SG). Odtwarza oba wzorce użytkownika prawie co do minuty. Piątki 0.551 → **0.559**, SRS 0.843 / 0.840, test rotacji ok.
- **Atak:** bez dodatku za spójność, limit piłki 0.5, łagodna podłoga gwiazdy 0.15. SRS 0.844 / 0.839, piątki 0.551, atak vs ORtg 0.766 → 0.770. Jordan 63 → 69, Curry 67 → 70, Shaq + Harden 93 → 83.
- **Reguły z oceny** (`reviewRules.ts`): tłok w pomalowanym, trzech z piłką, obwodowy bez piłki i rzutu, drugi słaby obrońca obwodu, starter poziomu ławki, niestrzelający rozgrywający obok gwiazdy, brak floor generala, + elitarny strzelec z piłką.
- **Etykiety → dane** w TAL i pick-and-rollu.
