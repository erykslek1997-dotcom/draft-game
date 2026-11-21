# Do naprawy

## Stan na 2026-11-20 i plan
**Przyszły tydzień:** ostatnie poprawki wyborów AI, potem algorytm oceny (atak szerokich składów, obrona bez wyróżnień, systemy liderów), na końcu symulacja meczów pod ocenę.

**W grze od 2026-11-20:**
- Cap 110; AI trzyma piątkę w 80/110 capu (`TOP5_SHARE`, skaluje się w daily) — dla gracza tylko łączny cap.
- Ławka AI: szablon ról (obwodowy z rzutem/rozgrywaniem, 3&D, broniący wysoki — nie dwóch bez rzutu) od TAL 60; plan płaci za rezerwowych < 68; nikt z minutami < TAL 62; glue tylko przy ciasnym capie.
- Rotacja AI: grywalny dziewiąty do 10 min; słaby zmiennik (< 60) ≤ 9 min; lepszy zmiennik zabiera słabszemu do 10 min (Payton 12 → 22).
- Ocena: reguła drugiej piątki (ławka bez strzelca / bez rozgrywającego / dwóch wysokich bez rzutu −1 każde); D-TAL względem pozycji; planer AI powtarzalny.
- Efekt (12 draftów, rotacja z gry): słabi rezerwowi 10+ min 9% → 1-2%, ławka TAL 69.9 → ~72-73. Sędziowie: SRS 0.841, piątki 0.572, D-TAL 0.829, sim 0.62.

**Zostało — AI:**
- Zmiennik na dwie pozycje gra 24-30 min (Kyle Anderson 30) — struktura 3 zmienników na 5 pozycji.
- Starzy gracze z niepewnymi danymi w piątkach (Schayes, Gola).
- Glue zmuszone do grania przy dziurze w kształcie (Rambis 39 min) — poprawka w `AI_NO_WEAK`, do potwierdzenia na draftach.

**Zostało — ocena:**
- Wilt TAL 89 (najlepszy okres 1966-68), Russell 89, West 91 — legendy sprzed 1974 nisko, przez to Wilt idzie w 2. rundzie (jedyny all-timer spadający po poprawce legend; 4 z 60 legend-wyborów po 16. miejscu to wszystko Wilt).
- Atak szerokich składów za nisko (Cheyenne 63-68 vs SGA + Jokić 82-90): skala O-TAL graczy, nie limit piłki (bez limitu 73 vs 85).
- Obrona bez wyróżnień ponad limitem 84 (Mbah a Moute 89, Hayes 91, Ward 89).
- Systemy liderów, pojedyncze oceny (Parker 2006-08, Dumars, Rodman).
- Symulacja meczów nie zna nowych zmian oceny (0.66 → 0.62).
- Testy: `testDefensiveHuntability` (stary błąd), `testCalls` za wolny.

# Historia (2026-11-19)

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

## Z draftu 1627088049 (2026-11-19) — zostało
- ~~**Wade vs Klay**~~ — ok według użytkownika: Klay ma realny bonus dopasowania z Currym i Draymondem (Warriors), więc remis z Wade'em jest uczciwy.
- ~~**Rotacja Syracuse**~~ — decyzje użytkownika, nie błąd: Lopez 30 min dla spacingu przy Wadzie, Curry chwilę na SG w ustawieniu z dwoma rozgrywającymi.
- **Atak szerokich składów za nisko:** Cheyenne (Frazier / Butler / Middleton / Nowitzki / Hakeem) 63, Miami (Jordan / Billups / Pierce) 68, a Mobile (SGA / Bell / C. Robinson / McHale / Jokić) 90.
- **Obrona Little Rock 92** (Kidd 2008-10 / White / Bird / Millsap / Wilt) i przewaga 3 pkt — chyba za dużo.
- **AI — dopasowanie przy podobnej wartości:** Marion (17.5 capu) obok LeBrona i Howarda zamiast strzelca klasy Allena / George'a.
- **AI — gwiazdy spadają:** Dončić 63., McGrady 57., Harden 48., Carter 101.
- **AI — śmieci:** Tom Gola (12.7 capu), Don Buse TAL 41 gra 19 min.

## Analiza wyborów AI (3 drafty z 2026-11-19, `scripts/_favs.ts`)
- **Sieroty — gwiazdy na jednej pozycji znikają z tablicy:** Barkley prime (88-92, 13-16 rzutów) niewybrany w 2 z 3 draftów, Grant Hill 1995-97 (86), Alvin Robertson (81-83), Bobby Jones 1976-85 (78-82), Butler prime (87; brany jest tylko tani 2012-14, TAL 71), Mutombo prime (78-83; brany tylko 2004-07 za 2 rzuty), Tyson Chandler / DeAndre Jordan / Robert Williams (77). Przyczyna: zasada struktury „gwiazda na zajętej pozycji grałaby z ławki — poza tablicą” + „wybrany starter trzyma miejsce”. Gdy większość drużyn ma już PF / SF, Barkley i Hill nie są na tablicy nikogo.
- **Ulubieńcy:** te same nazwiska w każdym drafcie w tym samym miejscu (Marion 34-48, Batum 81-84, Amen Thompson 85-87, O'Neale 89-95, Prigioni 99-118, Chuck Hayes, Greg Anthony, Ostertag, Andersen) i ten sam zestaw glue na końcu (Ryan Bowen, Johnny High, T.R. Dunn, Temple, Cage, Lang, Looney, Aşık) — przy lepszym glue na tablicy (Mark Eaton 54, Przybilla 54, Kornet 52).
- **Ławka:** dostępni lepsi na tej samej pozycji za tyle samo rzutów prawie przy każdym słabym wyborze (Delon Wright 57 przy Lowrym 2008-10 74; Splitter 67 przy Chandlerze / DeAndre / R. Williamsie 77; Nenê / Kukoč / Hot Rod przy Bobbym Jonesie 78-82).

## Już zrobione (2026-11-19)
- **Curry + Wade** (`REV_STAR`, `PNR_BEST_LEAD`): elitarny strzelec z miejsca nie liczy się jako trzeci gracz z piłką ani jako „silnik” dla reguły zbędnego rozgrywającego (Draymond przy Currym to point forward); współgwiazda nie jest zbędnym rozgrywającym; pick-and-roll przez lepszego z dwóch prowadzących. Syracuse 78 → 82. Sim 0.62 → 0.65, SRS 0.843, piątki 0.559, słabi rezerwowi 34% → 27%.
- **Podłoga ataku dla dwóch gwiazd** (`OFF_PAIR_W=0.35`): LeBron + McGrady 63 → 70. Sędziowie bez zmian.
- **Koszt drugiego gracza z piłką ze spacingiem** (`BH_SHOOT=0.6`): z dwóch chcących piłki ten lepiej rzucający z miejsca gra bez niej i kosztuje mniej. Billups obok LeBrona 0.69 → 0.00, Stockton 0.69 → 0.26; Stockton obok Wade + Garnett 1.29 → 0.76. SRS 0.844 / 0.841, sim 0.61, trzech+ PG 16% → 11%. (Kolejność wyborów — Stockton przed Wade'em — zostaje: wymaga planowania składu przez AI.)
- **AI: wybór okresu kariery** (`AI_WIN_OTAL=15`, `AI_WIN_OW=0.3`): okresy „równe poza ceną” tylko przy podobnym ataku, a oddany atak kosztuje. Kawhi 2015-17 zamiast 2013-15. 10 draftów: zróżnicowanie 3.13 → 3.41, 90. centyl wyboru gwiazd 90+ 25 → 22.
- **Efekt rotacji na tych samych draftach (401-402):** „lepszy na ławce niż starter” 5.5 → 2.5 na draft, „drogi zmiennik TAL 80+ ≤ 16 min” 1.5 → 0.5, słabi starterzy 5.5 → 5.0.
- **Odrzucone:** `AI_BENCH_WASTE=1` (kara w drafcie za zablokowanego zmiennika) — drogi zmiennik 0.5 → 1.5, gorzej.
- **Rotacja (część pkt 2):** gwiazda może zaczynać na pozycji, którą gra w pełni (Bird na PF → Butler w piątce, Schayes poza nią); dodatek za własną pozycję 18 → 10 (Butler 27 na SF, Williams 11 na SG). Odtwarza oba wzorce użytkownika prawie co do minuty. Piątki 0.551 → **0.559**, SRS 0.843 / 0.840, test rotacji ok.
- **Atak:** bez dodatku za spójność, limit piłki 0.5, łagodna podłoga gwiazdy 0.15. SRS 0.844 / 0.839, piątki 0.551, atak vs ORtg 0.766 → 0.770. Jordan 63 → 69, Curry 67 → 70, Shaq + Harden 93 → 83.
- **Reguły z oceny** (`reviewRules.ts`): tłok w pomalowanym, trzech z piłką, obwodowy bez piłki i rzutu, drugi słaby obrońca obwodu, starter poziomu ławki, niestrzelający rozgrywający obok gwiazdy, brak floor generala, + elitarny strzelec z piłką.
- **Etykiety → dane** w TAL i pick-and-rollu.

## Odkryte 2026-11-19 (po przejściu na AI jak w grze)
- **Planowanie AI nie jest powtarzalne:** ten sam draft dwa razy w jednym procesie różni się od 3. wyboru (Bird vs Garnett) — pamięci podręczne planera. Skutki: weryfikacja dziennego draftu na serwerze nie odtworzy planowanych wyborów (oznacza „ai-diverged”, nie usuwa wyniku); tryb wieloosobowy, jeśli liczy na identyczne wybory AI u wszystkich, może się rozjechać. Weryfikacja dalej odtwarza bez planowania (`verifyDaily.ts`). Do naprawy: planer deterministyczny (czyszczenie / klucze pamięci podręcznej).
