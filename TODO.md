# TODO — Draft Game

Żywy backlog. Edytuj ten plik bezpośrednio, kiedy coś zostanie zdecydowane, wypuszczone albo nowo
otwarte — to jedno miejsce do sprawdzenia "co się dzieje z tym projektem".

**Kolejność (2026-09-30, Twoja decyzja): najpierw kalibracja silnika — to punkt wyjścia całości.
Po wstępnych testach silnika i Twojej akceptacji robimy porządnie symulacje (mecze i playoffy na
silniku). Dopiero potem pojedyncze „pierdoły” w trybach, po kolei: Draw Five → Mini Draft →
All-Time Draft, każdy zakończony playtestem.**

Trudność: **S** = kilka godzin, **M** = jedna runda zmian, **L** = kilka rund.

---

## Etap 1. Kalibracja silnika — ZAKOŃCZONY (2026-10-02)

Jak pracujemy: grasz pełny draft (All-Time) przyciskiem testowym **AUTO-FINISH**, oceniasz każdą
drużynę w tabeli wyników i zgłaszasz, co się nie zgadza; poprawiamy i powtarzamy.

- [x] **Przycisk testowy AUTO-FINISH w pełnym drafcie** (2026-09-30) — „Auto-finish (testing)” nad
      planszą: dokańcza draft (Twoje picki też robi AI), buduje rotację i od razu pokazuje wyniki,
      ok. 15 s. Flaga `AUTO_FINISH_FOR_TESTING` w `src/components/testingFlags.ts`. (S)
- [x] **Eksport wszystkich składów** (2026-09-30) — „Export all teams (testing)” na dole ekranu
      wyników kopiuje każdą drużynę (oceny, składniki, lata graczy, minuty, O/D/SPC) do schowka;
      wklejasz do czatu. Flaga `TEAM_EXPORT_FOR_TESTING` (`testingFlags.ts`). U mnie to samo robi
      `npm run calibrate:report` (wylosowane ligi) i `npm run calibrate:reference` (Twoje drużyny
      z sesji 1 + Twoje werdykty jako testy).
- [x] **Sesja kalibracyjna 1** (2026-09-30), wprowadzone:
  1. Offense: O-TAL drużyny ważony gwiazdami (30/24/18/15/13%), większa waga talentu w bloku
     ataku, „cap za słabego ofensywnie startera” zamieniony na karę proporcjonalną; paski
     składników w tej samej skali co kafelek; atak i obrona mają równy rozrzut (76 ± 8).
  2. D-TAL: podłoga dla uznanych obrońców (All-Defense/DPOY) i dla potwierdzonych danymi obrońców
     obręczy (Lopez 66 → 74–82, Turner 59 → 76, Claxton 59 → 76, R. Williams 60 → 82,
     Bridges 66 → 74, Malone 1997-99 75 → 88). Bird / McAdoo / McMillan bez zmian — dane (All-D) je wspierają; do
     ponownej oceny, jeśli dalej wyglądają za wysoko.
  3. Rotacja: kara za small-ball (skrzydłowy na PF/C ponad 12 min), bonusy nie „chowają” już kar
     powyżej 100.
  4. Defense 69 dla Pippen/Wallace — po poprawkach D-TAL ~75; kara za Nasha zostaje.
  5. Fit: nowa składowa „pairing” (pick-and-roll: rozgrywający + rolujący/rzucający wysoki,
     skalowana jakością rozgrywającego), większa waga kreacji, mniejsza obrony; kara za dwóch
     punktujących wysokich bez rzutu (Giannis + Kareem).
  6. Ranking przestał być ustalany przez samą obronę (efekt punktu 1).
  7. Spacing: niższy sufit przy dwóch nierzucających starterach (65/58); bonus „elitarnego
     silnika” tylko dla silnika, który sam rzuca.
  8. Spacing gracza: nadwyżka celności ponad 41.5% uzupełnia brak objętości (Nash 85 → 95).
  9. „Defense-first” tylko gdy obrona ≥ atak + 5.
  10. Remisy w rankingu i rozstawieniu rozstrzyga dokładna ocena; szanse na tytuł mocniej
      oparte na ocenie ogólnej (0.85).
  11. (Etap 2) Rotacja sytuacyjna (strzelec / obrońca na jednej pozycji) — niezrobione, czeka.
  12. TAL powyżej 99 wyświetlany jako „99+”.
  - Pierdoły: nazwisko w linii „spot minutes” w rotacji. Zdjęcia Kidda, Harpera i ~260 innych to
    zaślepka z cdn.nba.com — sieć środowiska blokuje pobranie innych; potrzebne źródło zdjęć.
- [x] **Sesja kalibracyjna 2** (2026-09-30), wprowadzone:
  1. Obrona liczona podwójnie: „Hunt resistance” i „spójność obrony” wychodzą z wag Fit (są już
     w Defense). Atak i obrona mapowane na jedną skalę (74 ± 9).
  2. Rotacja przepisana: minuty liczone naraz dla całej drużyny (`engine/minuteAllocation.ts`,
     min-cost flow) z limitami zdrowia i tieru, minimami dla gwiazd, grą dwie pozycje od swojej
     tylko w ostateczności. Test `testRotationInvariants.ts` na 48 drużynach: 0 naruszeń.
  3. D-TAL: podłoga „statystyki elitarne + dane potwierdzają” (Kirilenko 2002-04 71 → 90),
     podłoga „dane neutralne” dla graczy z przeciętnymi statystykami (Batum 2012-14 39 → 48).
     Jaylen Brown 2023-25 O-TAL 67 zostaje — skuteczność poniżej ligi w tych latach.
  4. Notatka „block-camping center” nie łapie już podających i rzucających z półdystansu wysokich
     (Walton, Duncan, Mourning); zostaje dla czystych graczy tyłem do kosza (Shaq, Howard, Hakeem).
  5. Eksport: styl w nawiasie bez odrzuconego „Defense-first”.
- [x] **Sesja kalibracyjna 3** (2026-09-30), wprowadzone:
  1. Pick-and-roll: rozgrywający-podający typu „Secondary Ball Handler” (Lowry, Conley) liczy się
     jako prowadzący akcję — wcześniej drużyny z nimi miały strukturę 0.
  2. Ręczna kalibracja rzutu z półdystansu dla graczy sprzed 1997 (brak danych stref):
     `PRE_ZONE_MIDRANGE_SPACING` w `src/engine/midrangeGravity.ts` (West 75, Jordan 75, McAdoo 72,
     Gervin 70, Malone 60, Oscar 60, Ewing 55, Hakeem 45, Kareem 25…). Tylko spacing drużyny, nie
     TAL — do poprawiania wedle uznania; wartości widać w eksporcie jako SPC(team).
  3. Billups 2007-09 D-TAL 26 — zgodne z danymi (DDPM −1,5, RAPTOR −0,7); bez zmian.
  4. Rozkład minut Magica (24 PG + 8 SG + 8 SF) — OK, bez zmian.
- [x] **Sesja kalibracyjna 4** (2026-09-30), wprowadzone:
  1. Minuty 39–40 prawie nieopłacalne — gwiazda gra 40 tylko przy braku zmiennika na pozycji.
  2. FIT bez progów: pick-and-roll, kreacja i spacing liczone w sposób ciągły (bez skoków 0↔80
     i „jeden kreator kasuje dwóch nie-strzelców”); spacing na tej samej wartości co Spacing
     drużyny (z półdystansem). Prowadzący PnR bez rzutu (Simmons) daje słabszą akcję.
  3. Rim pressure drużyny: 100 miało 41/64 drużyn, teraz 17/64.
  4. Do zrobienia: AI draftu ocenia wybór po pozycji i asystach, nie po realnej zmianie FIT/ofensywy
     (Baron Davis obok Wade'a i KD).
- [x] **Sesja kalibracyjna 4, ciąg dalszy** (2026-09-30), wprowadzone: kara za dwóch ball-dominant
  gdy jeden nie rzuca (Oscar + LeBron); minimum minut poziomu tylko dla startera (Howard/Whiteside);
  AI liczy tylko prawdziwych wysokich jako zmienników pod koszem (mniej small-ballu); jedna liczba
  spacingu w całym podsumowaniu; płynna osłona nierzucającego centra i ograniczony „gravity lift”
  (Penny + Wallace 83 → 64).
- [x] **Sesja kalibracyjna 5** (2026-09-30), wprowadzone:
  1. Holiday 2016-25: tag obronny Point of Attack.
  2. Role obronne i „weak link” = 40% tag/statystyki + 60% D-TAL (Towns 93 → 58, Miller jako weak
     link 91 → 65, Holiday PoA 91).
  3. Reguła Curry'ego: limit za nie-strzelców 80 (dwóch) / 70 (trzech+); Dayton 93 → 80,
     Charlotte 93 → 70.
  4. Starter z uwzględnieniem spacingu: przy piątce ze spacingiem < 60 rezerwowy wchodzi, jeśli traci
     ≤ 5 talentu i podnosi średni spacing o 8+ (Green zamiast Amena Thompsona).
  5. Kara za dwóch „shot first” pierwszych opcji (do 8 pkt FIT, trzeci do 4); rozgrywający się nie
     liczą, wybitni podający (Bird, Wade) częściowo. Syracuse FIT 80 → 72.
  6. D-TAL drużynowy: All-D/DPOY działają też na sąsiednie sezony, 25% z sąsiednich okresów (George
     2016-18 57 → 71, Bell 2004-06 30 → 71). TAL i tiery bez zmian.
  7. Premia 3&D (+3 FIT, max 5) i zwolnienie z kary za słabego startera (Cleveland FIT 77 → 80).
  8. AI: rezerwa limitu na wolne miejsce 6 → 5 FGA — słabi starterzy 8 → 6 na 64 drużyny, talent
     84,6 → 85,8, ocena ogólna 79,3 → 79,9. Zostaje: 1/64 przypadków gwiazdy na ławce (Robinson).
  9. Słaby spacing częściowo równoważony grą pod koszem (rim pressure, zbiórka, warunki) — nie przy
     dwóch nierzucających strzelcach pod koszem (Giannis + Kareem).
  10. Butler: dane o półdystansie poprawne (3,8–4,1 rzutu/mecz przy 37–41%). **Do decyzji:** skoki
      spacingu (Butler 55 → 41) biorą się ze schodkowej skali rzutu za 3, która liczy też TAL —
      płynna skala zmieniłaby TAL wszystkich strzelców.
- [x] **Kolejne sesje kalibracyjne: Twoja ocena drużyn → poprawki** (2026-10-01/02) — kompetencje
  pozycyjne per 36, limity minut i porządki w rotacji, AI wybiera pod wynik drużyny (lookahead od
  5. picku), obrona łączy odporność na hunting i spójność, ochrona obręczy z liczb, warstwy obrony
  na trzech różnych starterach, próg D-TAL dla zgodnie dodatnich danych, audyt wszystkich ról
  z rolami dodatkowymi w Fit (#155–#162).
- [x] **Akceptacja silnika** — 2026-10-02, Twoje „Silnik faza 1 zakończona”.

Otwarte tematy silnika — na później (bierzemy, gdy wyjdą w grze albo w symulacjach):

- [x] **Próg gwiazdy w `positionCorrectionFor` (talent.ts)** — (2026-10-28: naprawione wcześniej płynnym mieszaniem `STAR_GATE_BLEND_HALF`; Mark Price 1991-95 to teraz 76 → 79 → 73, bez skoku.) Stare: — klif: PG tuż pod
      `ALL_STAR_TAL_FLOOR` dostaje pełny bonus za spacing (~×1.15), tuż nad nim nie. Mark Price
      1993-95 przeskoczył 70 → 84 przy zmianie premii self-creation o 0.11. Opisane w kodzie jako
      odłożone („star-gate untangle”).
- [ ] **Rim pressure — lista zweryfikowanych slasherów** (2026-09-25). Sprzed 1997 obwodowi dostają
      rim pressure z modelu box score (`perimeterRimProxy` w rimPressure.ts); gracze z listy
      `historicalRimPressureEvidence.ts` (Jordan, Dominique, Baylor) są porównywani z prawdziwymi
      slasherami od 1997. Do decyzji: kolejni udokumentowani (Drexler? Dr. J?). Słaby punkt:
      wymuszanie fauli przy rzutach z dystansu (Harden) — nie w modelu.
- [ ] **Wpływ playoffs na TAL** — przemyśleć od nowa; kara/bonus za playoffs powinna być widoczna
      w ocenach offense i defense, nie tylko w TAL.
- [ ] **Waga TE-1** — korelacja talentScore↔głos człowieka 0.54 (nie 0.82). Zaakceptować czy
      przekalibrować przy więcej niż n=15 realnych draftów?
- [ ] **Wykładnik wartości picku AI-1** — potrzebuje „czucia” z rozgrywki.
- [ ] **Kolizja tier-floor Hartenstein/Tucker** — `STARTER_ELIGIBLE_TIERS` + kara down-slide 0.12×;
      Tucker nadal tier-gated w każdym realnym spanie. Poluzować próg dla realnych drugich pozycji czy
      pozwolić dużym różnicom fit przebić próg?
- [ ] **Taper mmStruct post-hub** (wymiar „struktury niedopasowania” w offenseScore).
- [x] **Audyt etykiet „Fix B”** — (2026-10-28: nie da się ustalić, o jaki kod chodziło; najbliższy jest audyt ról z 2026-10-02, już w grze. Zastąpione krokiem 3 „Obrona (D-TAL)” w kolejności prac tygodni 2–3.)
- [ ] **Rim pressure całej drużyny w offenseScore** — dziś poprawka per gracz ledwo rusza sumy
      drużynowe (+1).
- [ ] **Rozszerzenie rejestrów Movement Shooter / rim pressure** — małe, nazwane dodatki.
- [ ] **Luki źródła danych** — historyczny APM realnie od 1994 (sprawdzić inne zakładki
      „Historical APM Grid.xlsx” niż „All Scaled”); atletyczność bez graczy z lat 50.
- [x] **Pula draftu (2026-10-01)** — pełna pula (wszystkie okresy, `spanPoolMode: 'full'`) +
      223 graczy po 1997, których nie było (802 okresy, `scripts/addPost1997Players.ts`); gracze
      sprzed 1997 bez zmian. 100 draftów: 0 przekroczeń limitu, średnia drużyna 79.3 (było 79.4),
      3+ C 33% (było 37%), czas picku ~+5%. Pomijane gwiazdy (Iverson, King…) zaakceptowane.
- [x] **Standard startera (2026-10-01)** — starter z TAL < 65 jest OK tylko jako role player z
      TAL ≥ 50, spacing ≥ 55 i D-TAL ≥ 56 (`starterStandard.ts`, Twoje oceny 29 przypadków).
      AI: dziura (pusta pozycja lub starter poniżej standardu) daje +1.0 need od 5. picku, a gust
      GM-a liczy się w połowie dla graczy, którzy dziury nie łatają. Wynik: kara w Offense dla
      nieuzasadnionych. 100 draftów: nieuzasadnieni starterzy 58 → 27, TAL < 50 7 → 2. Dobór
      okresów po drafcie zawsze zostawia okres z draftu (Carter/Tatum nie spadają o 25 TAL).
- [x] **Jakość ławek (2026-10-01)** — zasada pokrycia (zmiennik TAL ≥ 55 na obwód i dla dużych,
      rundy z ≥ 2 pickami), rezerwa 6 FGA na wolne miejsce, dobór okresów zachowuje pozycję i
      standard startera. 200 draftów: ławka 60.8 → 61.8 (najsłabsze 10%: 54.3 → 56.5), bez
      zmiennika na obwodzie 358 → 24, bez dużego 558 → 195, 3+ C 1044 → 626, wynik 79.58 → 79.76,
      piątka −0.49 TAL. Zostaje: brak zmiennika PG (~620 drużyn; obwód liczony razem).
- [x] **„Bo Outlaw” (2026-10-01)** — wybór piątki zna standard startera: uzasadniony role player
      startuje mimo tieru (Ingles 'Sixth Man'), a starter poniżej standardu jest wyceniany niżej
      o lukę do 65 TAL (Ward przed McMillanem, Ingles przed Outlawem). 200 draftów: nieuzasadnieni
      starterzy 23 → 14, TAL < 50 2 → 0, bez PG w składzie 8 → 3. Reszta to składy bez zmienników
      na obwodzie (gwiazda PF/C gra na SG/SF, na jej pozycję wchodzi zmiennik), 2 na 16 000.
- [x] **Brak zmiennika PG** — nie jest realnym problemem: minuty na PG grają prawie wyłącznie
      gracze z realną pozycją PG (0.01 min/drużynę poza pozycją); zmiennikiem są starterzy SG z PG.
- [x] **Limit minut (2026-10-01, wariant 3b)** — opuszczone mecze nie skracają minut w meczu
      (limit wytrzymałości usunięty, zostaje tylko DNP); wytrzymałość obniża wartość w ocenie
      drużyny (×1 od 90 pkt, −0.3%/pkt, min 0.91); realne minuty/mecz (+2, od 1996-97) tylko
      podnoszą limit tieru. 200 draftów: odcinki < 6 min 373 → 54, gracze na 3+ pozycjach
      42 → 22, starterzy < 16 min u siebie 50 → 6, najsłabsza drużyna 62.6 → 68.5.
- [x] **Minuty gwiazd z realnych playoffów (2026-10-01, opcja 1)** — limit gwiazd (od All-star)
      = realne minuty/mecz w playoffach (≥ 8 meczów), inaczej RS + 2, inaczej tier; maks. 40; limit
      jest miękki (kara: +1–2 min prawie zero, +3–4 odczuwalna, >+4 mocna). Embiid 2019-21 33 min, Giannis 34, Kawhi 35, LeBron 38.
      Koszt (z miękkim limitem): wynik 79.72 → 79.50, śmieciowe minuty 6.1 → 8.1, krótkie odcinki 54 → 123. Naturalny PG
      startuje na PG; minuty nieparzyste (urozmaicenie ±1).
- [ ] **Metadane kart dla nowych graczy** — `npm run build:card-metadata` wymaga lokalnych danych
      (`C:\Users\Eryks\Desktop\player-data`); 223 nowych graczy nie ma drużyn na kartach ani zdjęć.

### AI draftu: bezpiecznik dla spadających gwiazd (2026-10-29) — WRÓCIĆ, gdyby coś się rozjechało

Playtest: Porter, Butler i Porziņģis w 2. rundzie, Kawhi do 23, CP3 do 42, Malone do 55, Barkley do
112, Nash leżący do ~100; gracz składał absurdalne piątki z gwiazd, które spadły. Przyczyna: wartość
AI = talent × potrzeba pozycyjna, a mnożnik potrzeby dochodzi do 5–6×, plus kary za capy, gust GM-a
i szum (±20). Pomiary (`scripts/measureStarPower.ts`, 6 draftów samej AI na wariant):

- obecna AI: 27 wyborów na draft z graczem lepszym o 8+ TAL na stole, najgorszy spadek gwiazdy 73
  miejsca, Overall drużyn AI 80,8;
- bezpiecznik (gracz, którego TAL stawia rundę przed bieżącym wyborem, idzie od razu): 11 · 21 ·
  79,3; po 1,5 rundy: 19 · 27 · 80,1; po 2 rundach: 25 · 35 · 80,3;
- bez efektu (odrzucone): gwiazdy w pierwszych 3 wyborach (`starPhase`), ocena drużyny od 2. wyboru
  (`lookahead`), limit mnożnika potrzeby 1,5/2/2,5, zwolnienie z kary za drugiego rozgrywającego
  od TAL 88.

Decyzja użytkownika: drobny spadek siły AI jest OK, jeśli blokuje graczowi absurdalne piątki —
bezpiecznik po 1 rundzie. Brany na siłę kosztował fit −5 i spacing −4 (gwiazdy, które nie pasują),
więc ostatecznie gwiazda wchodzi tylko, jeśli jej drużyna (dopełniona najlepszymi dostępnymi) ma
ocenę najwyżej 0,5 niższą niż przy normalnym wyborze („ma brać gwiazdy które pasują, nic na siłę”).
Wersja końcowa: 15,7 wyborów z lepszym o 8+ na stole, najgorszy spadek 32, Overall AI 80,5
(margines 0: 17,2 · 34 · 80,4; margines 1: 15,5 · 32 · 80,2).
Live draft (eksport 3114492529, „bez szału, na siłę to strasznie”): dół tabeli z mocnymi piątkami i
resztkami na ławce (Long Beach 72, Detroit 74, Knoxville 75) — bezpiecznik przesunięty na 3 rundy
(`fallSlack` 48): łapie tylko absurdy (Barkley przy 112, Nash przy 100), zwykły draft robi kara za
drugiego rozgrywającego (sama: najgorszy spadek 33, Overall 80,8). Do obejrzenia: McAdoo 1975-77
TAL 95 (19. w puli) i jego półdystans 72 z dawnej listy (nie przeglądany) — po spacingu sprzed linii
(0 → 61) AI bierze go w 2. rundzie; obniżyć rzut albo talent (decyzja użytkownika). Kara za drugiego rozgrywającego idzie za kosztem posiadania piłki z oceny
drużyny (`ballHandling.ts`, AST% i USG%), nie za „7+ asyst” (LeBron, Bird, Jokić w składzie nie
znaczą, że drugi rozgrywający jest zbędny). **Jeśli AI zacznie draftować dziwnie** (za mocne
drużyny AI, gwiazdy na siłę obok siebie, trzech centrów, za słabe ławki): wrócić tutaj, przełączniki
w `AI_STAR_RULES` (aiDrafter.ts), pomiar `npx tsx scripts/measureStarPower.ts 6`.

### Znane, zaakceptowane ograniczenia (nie odgrzewać bez nowych dowodów)

- **Więcej gry pod koszem niż w NBA** (2026-10-08): punkty z pomalowanego 55.9 / 100 posiadań vs
  NBA 47.7 — w składach all-time to normalne (decyzja użytkownika).

- LeBron 2008-10 w Cleveland czytany jako szczyt kariery, ponad Miami — dziura architektoniczna
  (sygnał czysto defensywny); nazwany wyjątek odrzucony.
- Systemowe niedoszacowanie PG/C sprzed 1997 (Russell, Cousy…) — realne, wymaga osobnej sesji.

### Polityka: ręczna kalibracja „greatest peaks” (ustalone 2026-09-06)

Gdy gracz ma kilka spanów remisujących na ogólnym TAL, AI draftu wybiera reprezentanta zależnie od
kontekstu picku. **Nie budujemy ogólnego algorytmu** — ręcznie przypinamy
`USER_VALIDATED_PEAK_SPANS` (`aiDrafter.ts`), gdy span jest Pareto-lepszy (nigdy gorszy, czasem
lepszy na O-TAL i D-TAL). Prawdziwe kompromisy zostają bez wpisu.

- Przypięte: Harden 2018-20, Shaq 1999-01, Jordan 1987-89, Duncan 2001-03, Garnett 2002-04,
  Davis 2017-19, Jokić 2021-23.
- Świadomie bez wpisu: Bird, Hakeem, Robinson, Giannis.
- Nieuzgodnione: starsza lista `GREATEST_PEAK_DRAFT_TIERS` ma Giannisa 2020-22 i Jordana 1988-90,
  inaczej niż `USER_VALIDATED_PEAK_SPANS`; sezony MVP Giannisa (TAL 90) czytają się niżej niż
  mistrzowskie (TAL 98).

---

- [ ] **Porządna kalibracja rzutu z półdystansu sprzed 1997** (po akceptacji silnika, przed
      symulacjami) — dziś `PRE_ZONE_MIDRANGE_SPACING` w `src/engine/midrangeGravity.ts` to ręczna
      lista ~70 graczy z wartościami „z reputacji”. Do zrobienia porządnie: pełny przegląd
      graczy sprzed 1996-97 bez danych stref (nie tylko top O-TAL), źródło dla każdej wartości
      (opisy, highlighty, % z gry w strefach tam, gdzie da się odtworzyć), spójność z danymi po
      1997 (KG, Webber, Malone 1996-98), przegląd razem z Tobą. Rozważyć też to samo dla
      rzutu za 3 przed 1979-80 (brak linii — West, Oscar, Havlicek). (M)

## Plan do launchu: 7 tygodni (decyzja 2026-10-22) — obowiązuje

| Tydzień | Zakres |
|---|---|
| 1 | ✅ zakończony (wydanie nocne, telefon) |
| 2 | Listy Eryka 1–3: błędy UI, poprawki TAL, oceny AI |
| 3 | Listy 2–4: dokończenie TAL i AI, silnik symulacji, panel ekspertów |
| 4 | Backend (Supabase lub Firebase, bez domeny na start): konta (e-mail / Google), daily na koncie (seria, historia, przeniesienie zapisu z przeglądarki), tabela dzienna z weryfikacją wyniku na serwerze (seed + picki przeliczone silnikiem), jeden wynik na dzień, limity; przegląd bezpieczeństwa |
| 5 | Brand, domena (+ przepięcie logowania), „pokonaj wynik znajomego”, wstępne testy na większej grupie |
| 6 | Strategia SM, testy kont i tabeli przez ludzi, poprawki przed launchem, wyłączenie trybów testowych |
| 7 | Zapas na poprawki → launch (ok. 2. tydzień grudnia) |

MP na start = wariant (b): bez serwera gry — duel na linkach (jest) + tabela dzienna. Pełne MP po launchu.
Zasada tygodni 2–3: z list bierzemy tylko to, co gracz poczuje; reszta „po launchu”.

**Tydzień 6 — dopracować teksty „Copy result” / udostępniania (Eryk 2026-10-28: „jest ok, ale trzeba je dopracować”):** wszystkie tryby (Draw Five, Mini z linią turnieju i ✅/❌, All-Time, Bomb), jednolity format, długość, emoji, nazwa marki po rebrandzie (Beast Court). Makieta startowa: `docs/mockups/mini-tournament-share.html`.

**Do skończenia (Eryk 2026-10-29: „końcowy ekran share został do skończenia”):** karta do udostępnienia (Post) po sezonie. Zrobione: stała szerokość 512 px skalowana jako jeden obraz, ławka jako niski rząd małych twarzy (nazwisko + pozycja, pod spodem ppg · min), okno od dołu, zapis z limitem czasu i „✓ Saved”. Zostało: twarze starterów w wysokich pudełkach (4:5 rozciąga rząd starterów — próba z twarzą na całą wysokość została cofnięta, „źle wygląda”), puste miejsce na karcie. Najpierw szybka strona testowa z samą kartą (bez przechodzenia sezonu), potem makieta 2–3 wariantów.
**Tydzień 6 — jedna skala rozmiarów fontów (Eryk 2026-10-29: „jakaś spójność wielkości fontów?”):** w CSS wydania nocnego jest 34 różnych rozmiarów (7…120 px), wiele prawie takich samych (10 / 10,5 / 11 / 11,5; 12 / 12,5; 17 / 18 / 19; 26 / 28 / 30 / 32; 36 / 38 / 40). Kroje mają jasne role (Barlow Condensed: nagłówki, nazwiska, etykiety; Inter: tekst; JetBrains Mono: liczby), do uporządkowania są tylko rozmiary. Plan: tokeny `--fs-*` (11 / 12 / 13 / 14 / 16 / 18 / 20 / 24 / 28 / 34 / 48 / 64, 88 i 120 bez zmian), każdy rozmiar do najbliższego stopnia (zmiany 1–2 px), potem zrzuty głównych ekranów (telefon 390 px i desktop 1280 px) przed i po. Przy okazji jedna zasada dla lat i minut (jak w rosterach od PR #272: „14-16 · 34m”, ta sama czcionka i rozmiar) także w pozostałych miejscach: lista draftu (`yrs-btn`), karta zawodnika, ławka na starych kartach (`bn-y` 10 px obok 12 px minut).
**Playtest 2026-10-29 (UI, telefon; Eryk: „spisz wszystko”, nic jeszcze nie zrobione):**
  1. **Your team (draft):** wiersz Shaqa ma 6 poziomów (badge nagród na całą szerokość); 8 pustych wierszy „Pick #…” zajmuje pół ekranu; dziura w ocenach po „3PT F”; rotacja zaczyna się nisko, a „+” wychodzi za prawą krawędź; nieaktywny „Play the season” zajmuje miejsce.
  2. **Strzałka w nagłówku** cofa do menu głównego. Ma być: z Your team → z powrotem do draftu; z draftu → menu z potwierdzeniem „Leave draft?”.
  3. **Karty „Your nine”** ucinają długie nazwiska („Thomps…”): gdy nazwisko się nie mieści → imię/ksywka („Klay”). Ucięte ogonki liter („Billups”, „Holmgren”), za mały line-height.
  4. **Nagłówek okna lat zawodnika** (Your team · His years) nierówny: zdjęcie 64 px jak w karcie zawodnika, obok nazwisko, pod nim pozycja i lata, równy odstęp od nadtytułu.
  5. **Główny opis pod werdyktem** (wyniki): dziś pierwszy pasujący detektor („Two layers: Kawhi on the wing, Chet at the rim”, `insights.ts:948`), Shaqa brak. Ma mówić o dwóch najlepszych graczach i mocniej wybrzmiewać; detektor obrony niżej, do „Why you won”.
  6. **Talent 73 (C)** przy Shaq 97 / Kawhi 97 / Billups 82 / Klay 77 / Chet 70 (w grze): surowo ~83–85, a od 2026-10-28 wyświetlanie jest na skali obrony (średnia AI 85,3, SD 3,3 → 85 = 73, 83 = 68). Dwóch gości w szczycie + trzech solidnych czyta się jak „średni skład”. Do decyzji (z pomiarem): inna skala wyświetlania albo większa waga dwóch najlepszych.
  7. **Rim pressure 59 z Shaqiem:** średnia z piątki (Shaq 100, Chet 26, Kawhi 16, Billups 0, Klay 0) → 71 w silniku → 59 na ekranie. Dominujący gracz ginie w średniej. Billups z 0 podejrzany (wejścia, rzuty wolne) — sprawdzić.
  8. (niski priorytet) **Season profile + przypis** na dole metryk wyglądają na doklejone: Season profile jako normalny wiersz (etykieta, „Balanced contender”, liczby Regular season 99 · Playoffs 93, zdanie szarym podpisem); przypis o Role coverage do podpowiedzi przy wierszu; bez kreski nad „Hide all metrics & inputs”.
  9. **Profil gracza w sezonie** (np. Jokić): pełny ekran przy 3 linijkach treści (skutek reguły `.nt .dlg` pełny ekran z PR #272). Krótkie okna jako panel od dołu, pełny ekran tylko dla długich (karta z draftu, lista telefonów). FG% ucięte na krawędzi — tabela ma się mieścić. Opcjonalnie: ostatnie 5 meczów / TAL i oceny.
  10. **Zakładki Your season:** „The playoffs” (aktywna) ucięta. Krótsza nazwa („Playoffs” / „Play-in”), zakładki bez ramek (patrz 12), w razie czego przewijanie z aktywną w widoku. Przy okazji: „Watch the 8-seed game” łamie się na 2 linie obok „Sim to the playoffs”; wynik przegranego (132) jaśniejszy od nazwy — wyrównać.
  11. **Okno drużyny w sezonie** (Boise): nie zajmuje całego ekranu (prześwituje strona, drugi pasek przewijania — inna klasa niż reguła pełnego ekranu); przyklejony nagłówek ucina „DEFENSE”/„LAST FIVE”; tabela szersza niż ekran; nazwiska łamią się na 2–3 linie, pozycja raz obok, raz pod. Wiersz gracza w jednej linii (pozycja małą szarą obok), kolumna G znika, gdy wszyscy mają tyle samo meczów, liczby mniejszą czcionką, bez przewijania w bok; pogrubienie lidera we wszystkich kolumnach albo w żadnej.
  12. **Jeden wygląd przełączników/zakładek** jak filtr pozycji w drafcie (`.ptabs`, `draft.css:216`): zakładki Your season (dziś ramki), Season/Playoffs przy Your team (dziś wpięte w kreskę nagłówka sekcji — „niepotrzebna ta kreska”, ma być osobny wiersz), mecz na żywo (`seg`, `tabs`, `tabs2`), How to play (`sw2`). Jeden wspólny komponent.
  13. **Karta do udostępnienia (Post)** rozjeżdża się na telefonie: ławka nachodzi na starterów („BENCH” na twarzy Billupsa, ucięte podpisy), Batum/O'Neal w rzędzie starterów, Holmgren w ławce (zawinięty układ), dół ucięty (linia nagród), „Saving…” nie wraca. Karta w stałym układzie (szerokość obrazka), na telefonie skalowana jako całość; sprawdzić zapis i dodać stan „Saved”/błąd. Niespójność: Talent 85 na karcie vs 73 na wynikach — ujednolicić razem z punktem 6.

**Kolejność prac TAL / AI / silnik, tygodnie 2–3 (Claude, 2026-10-28; Eryk: „ułóż tak, żeby tobie było najlepiej”).** Zasada: najpierw pomiar i dane, potem wejścia TAL, potem struktura oceny, na końcu to, co tylko czyta oceny. Każdy krok: przykłady przed/po dla Eryka, test Spearmana z rankingami ludzi, `npm test`.
1. **Narzędzie pomiaru** „ocena vs symulacja sezonu” (+ raport D-TAL vs DBPM/STL%/BLK%/hustle) — bez niego każda zmiana wag to zgadywanie.
2. **Wczytanie nowych danych do silnika**: BBRef Advanced (gracze, drużyny 1973-2026), NBA.com (hustle, strefy obrony, on/off) jako pliki danych silnika, tak jak dziś RAPTOR/BPM2.
3. **Obrona (D-TAL)**: audyt niedoszacowanej i przeszacowanej obrony na nowych danych (zastępuje niejasny „Fix B”), waga danych realnych dla skrzydłowych, statystyki na posiadanie zamiast na mecz, waga wg minut na mecz (próg ~24 mpg), gracze od brudnej roboty / hustle.
   - **Audyt 2026-10-28 (`scripts/auditDTal.ts`, `scripts/measureDTal.ts`)**: sędzia = prawdziwa obrona 907 drużyn 1974-2026 (DRtg względem ligi, D-TAL ważony minutami). D-TAL r 0,77 z obroną drużyn, równo we wszystkich erach (DBPM 0,91, ale DBPM ma wbudowaną korektę na drużynę, więc to porównanie jest na korzyść DBPM). Ridge per zawodnik, ile obrona jego drużyn daje ponad D-TAL (rzetelność połówek sezonów 0,33-0,39, więc liczą się grupy, nie nazwiska): **elitarni kotwicy niedoszacowani** (Anchor Big +4..+5 D-TAL, pasmo D-TAL 85+ +5..+7; Duncan, Robinson, Ewing, Yao, Gobert, KG); **obwodowi z renomą przeszacowani** (Point of Attack -2,5..-3,7, Chaser -2..-3, pasmo 70-85 -2..-3; Kobe, Christie, Payton, Kirilenko, Marion) — to samo co w porównaniu z BBRef (D-TAL powyżej danych u Dumarsa, Payton, Kobe), czyli kredyt za All-Defense/renomę dla obwodowych jest za hojny; centrzy ogółem +1..+2, SF -1..-1,5. Minuty: 35+ mpg -1,3, 24-30 +1,0 — małe, ściąganie wg minut nie jest pilne. Dirk/Batum: dane drużynowe nie potwierdzają podniesienia Batuma (Dirk +4, Batum -2). Hustle (deflections, contests) nic nie dodaje ponad box; strefa przy koszu (+0,10) i on/off (+0,17) dodają — kandydaci na nowe wejścia. **Uwaga (Eryk 2026-10-28, Marion):** audyt drużynowy nie jest dobrym sędzią dla graczy z ręczną korektą ani dla tych, których drużyny miały słabą obronę wokół nich (Marion: +10 ręcznie; audyt wyliczył mu dokładnie −10); po wyrzuceniu graczy z korektami ręcznymi i listą hustle wnioski się trzymają (Chaser −3,3, Point of Attack −4,4, pasmo 70-85 −3,1, kotwice +5, pasmo 85+ +6,2; `--skip-named`). **Wynik próby poprawy (2026-10-28, ślad `scripts/traceDTal.ts`, sweepy w `auditDTal.ts`):** w paśmie D-TAL 70-89 94% obwodowych bierze wartość z kredytu za All-Defense (średnio +5,9 vs +3,2 dla bigów), ale zmiana kredytu (udział 0,6→0,3) i sufitu progu uznania (88→82) NIE rusza wyniku audytu (Chaser −3,3 i Point of Attack −4,4 bez zmiany) — to nie ta dźwignia. Po wyrzuceniu playoffów różnica zostaje (Chaser −3,0, PoA −3,9, pasmo 70-85 spada do −1,0, czyli ok. 2 pkt tego pasma to człon playoffów). Wagi przechwytów/bloków (×4,5 oba → 3,5/5,5 … 2,5/6,5) i wag ról (PoA 8→0, Anchor 9→14) zmniejszają różnicę Chaser/PoA tylko o ok. 0,5-1,5 pkt i obniżają ogólną zgodność z obroną drużyn (r 0,770 → 0,755-0,764, przy nieprzeliczonej drabince). Waga D-TAL dla bigów i obwodowych w obronie drużyny jest prawie równa (−0,28 vs −0,25 na punkt), więc nie ma podstaw do przeważenia obrony drużyny według pozycji. **Wniosek: D-TAL jest dobrze skalibrowany (r 0,77 z obroną drużyn, równo w erach i pozycjach); różnice grupowe ±3-5 są małe, próbki małe (16-41 graczy), rzetelność nazwisk 0,35 — bez prostej, bezpiecznej poprawki. Zostawić D-TAL, dołożyć co najwyżej strefę przy koszu i on/off jako źródła (korelacja z resztą 0,10 i 0,17) przy okazji kroku 4.** Dalej: Offense (największy zysk).
   - **Audyt pozycji 2026-10-28 (`scripts/auditPositions.ts`; Eryk: Tatum/Cam Johnson to PF-y, a all-time grają SF):** „pozycja all-time” z tego, co gracz robi na boisku — prosta dopasowana na latach 1980-2008 (pozycja BBRef, PG 1 … C 5) ze wzrostu i wskaźników względem sezonu (DRB%, ORB%, AST%, BLK%, STL%, USG%, 3PAr), R² 0,83, skalibrowana na średnie pozycji. Tag minus pozycja all-time: w latach 1974-2017 ~0 na każdej pozycji, **w 2018-2026 PF +0,37** (skrzydłowi tagowani jako PF), PG -0,40 (duzi kreatorzy: Luka, SGA, Cade — role PG, zostają). PF od 2010 grający SF: 295 spanów / 100 graczy (LeBron 2011-14, Butler 2021-25, Draymond, George 2022-25, Horford 2015-19, Melo, Siakam, Millsap, Anunoby, Barnes, Gordon, Ingram, Cam Johnson, McDaniels, Camara, Grant, Covington…); `functionalPosition` łapie 143 z nich, i to tylko dla D-TAL. Tatum jest już SF we wszystkich spanach. Przed/po jako SF: O-TAL zwykle spada (Butler 91→80, George 82→73, Ingram 83→74), D-TAL rośnie u obrońców (Draymond 90→98, Millsap 73→86, Covington 72→86), TAL zmienia się mało (-6…+6). Do decyzji: (a) pozycja all-time jako pozycja oceny (jak `ratingSpan`) dla PF→SF od 2010, (b) tylko SF jako pozycja naturalna w `positionCompetence` (draft/rotacja bez kary), (c) oba.
   - **Pozycje — wprowadzone 2026-10-28:** Eryk przejrzał w artefakcie „Przegląd pozycji” wszystkich graczy z TAL 55+ (212 graczy, 570 okien zmienionych; SG→PG 122, SF→SG 89, PF→SF 85, C→PF 74, PF→C 59…). Zapis: `src/data/positionDecisions.json` (po id spanu), stosowane przy ładowaniu puli (`positionDecisions.ts`), stary tag zostaje jako pozycja drugorzędna, wielopozycyjność (`positionCompetence.json`) bez zmian. Zostało: 336 graczy poniżej TAL 55 (propozycje gotowe w artefakcie, do decyzji: przyjąć hurtem czy przeglądać).
   - **Imiennicy i wzrost — 2026-10-28 (Eryk: „Henderson i Dunleavy, stary z ojcem wymieszany”, „Larry Johnson miał 6'3?”):** w puli 7 par różnych ludzi pod jednym nazwiskiem (id BBRef je rozróżniały) — rozdzielone w `personNames.ts`: Mike Dunleavy Sr., Gerald Henderson Sr., Jim Paxson Sr., Eddie A. Johnson, George L. Johnson, Charles Jones (Louisville), Reggie Williams (VMI). Wzrost/waga (`buildHeightLookup.ts`) liczone po osobie, której lata kariery pasują do okien, zamiast „pierwszy wiersz wygrywa”: Larry Johnson 6'3"→6'7", Glen Rice 6'6"→6'8", Charles Smith 6'4"→6'10", Bobby Jones 6'7"→6'9", Eddie Johnson, Dee Brown, Johnny Davis, Mike James; parser CSV gubił wiersze z przecinkiem w cudzysłowie (Harkless i Yabusele „ważyli” 79). Każdy gracz z puli ma teraz wzrost. Przy okazji: `buildRuntimeSpanLookups.ts` liczył dostępność na już przefiltrowanej puli, więc co druga przebudowa przywracała Embiida 2023-25 — naprawione.
   - **Pozycje, wnioski z 212 decyzji Eryka (2026-10-28, `scripts/auditPositions.ts`):** (1) 94% zmian u gracza to to samo przejście — decyzja jest per gracz, nie per okno. (2) Model proponował zmianę w 588 oknach, przyjęte 66%: SG→PG 84%, SF→SG 84%, C→PF 70%, SG→SF 70%, PF→SF 69%, PG→SG 63%, SF→PF 62%, PF→C 47% (Stretch Big zostaje PF; PF→C przyjmowany dla cięższych, Post Scorer/Roll & Cut). (3) Skoki o dwie pozycje (C→SF, PF→SG, SF→C) Eryk zawsze skracał do jednej. (4) W 172 oknach bez propozycji Eryk zmieniał pozycję: głównie SG→PG (odczyt ~1,6, próg Eryka 0,55 zamiast 0,75). (5) Progi dopasowane do wyborów wychodzą ~0,75 prawie wszędzie; v2 (SG→PG 0,55, PF→C 0,9, Stretch Big bez PF→C, skok max 1) = 82,7% zgodności vs 81,6% — reszta to osąd o graczu, nie liczba. Wniosek: dla pozostałych graczy (TAL<55) proponować z pewnością z historii akceptacji (wysoka ≥80% do hurtowego przyjęcia, niska do przeglądu).
   - **Pozycje — zamknięte 2026-10-28:** przegląd zakończony na decyzji Eryka („praktycznie bez znaczenia i za dużo czasu”). Wczytane do gry (`positionDecisions.json`, 1126 okien): 296 graczy zdecydowanych przez Eryka (w tym wysoka pewność przyjęta hurtem: 63), LeBron SF + PF w Miami; pozostałych 262 graczy dostało najczęstszą pozycję ze swoich okien (zmiana 348 z 1502 okien, głównie C→PF, SF→PF, PF→C). Poza przeglądem zostały tagi graczy, których model nigdy nie oznaczył; mieszane tagi tam zostają. Wzorzec AI (`aiPickRegression.baseline.json`) przepięty po zmianie.
4. **Reszta wejść TAL**: próg gwiazdy w `positionCorrectionFor`, Hartenstein/Tucker, spacing graczy sprzed linii za 3, półdystans sprzed 1997, lista slasherów, rejestry Movement Shooter, ściąganie do średniej wg próby (spacing, TS%, playmaking, rim, FT%, zbiórki).
   - **Atak, wdrożone 2026-10-28:** mismatch ×1,5 (0,118→0,167, reszta wag przeskalowana do sumy 1) i połowa premii/kary za zbiórki w ataku (`OFFENSIVE_GLASS_SHARE` 0,5). Miary (`measureOffense.ts`, `measureScoreVsSim.ts`): Offense↔atak w meczu R² 0,20→0,28, ↔prawdziwe piątki 0,223→0,226, Overall↔mecz R² 0,53→0,57. Wagi dopasowane „na całość” (R² 0,54) odrzucone jako przeuczone (10 parametrów, 96 drużyn); bonus „core”, bonus gwiazdy i self-creation zostają. Realny zysk wobec prawdziwych piątek jest mały — ocena ataku jest tu blisko sufitu składników.
   - **Krok 4, wyniki 2026-10-28:** (1) klif progu gwiazdy — już naprawiony. (2) Hartenstein/Tucker — decyzja projektowa (poluzować próg „starter-eligible” dla 3&D z TAL 40-50?), dane jej nie rozstrzygną; czeka na Eryka. (3) **Ściąganie 3P% do średniej wg próby: zmierzone, NIE wdrożone.** Przewidywanie 3P% w następnym, niezachodzącym oknie (5488 par, 1980+): błąd surowy 20,95, ściągnięcie do średniej pozycji (K=200 rzutów) 13,4, do średniej graczy o tym samym wolumenie i z tej samej ery (K=300) 12,25 (−42%). Prior musi zależeć od wolumenu (rzadko rzucający są słabsi niż średnia pozycji: grupa 0,5-1 3PA w latach 80. trafiała 32,5% przy 36% dla pozycji). Próba w kodzie (`spacing.ts`, `shrunkThreePct`) zadziałała dla szumu (B.J. Armstrong 50% przy 0,2 3PA: spacing 56→15), ale zawodnicy z ~1 3PA/mecz i 28% (Aguirre, Isiah Thomas) skaczą 24→55, bo twarda bramka `MIN_VOLUME_FOR_ACCURACY = 1` przepuszcza ich ze średnią skutecznością; wymaga płynnej bramki wolumenu i przeliczenia drabinek (`scripts/spacingPercentiles.ts`) razem. (4) Spacing sprzed linii za 3, półdystans sprzed 1997, lista slasherów, rejestry Movement Shooter — dane nie rozstrzygają, to nazwane dodatki od Eryka.
5. **Jedna skala** Talent/Offense/Defense + „droga od talentu do wyniku” (po krokach 3–4, bo zmienia się sam talent); przeliczenie progów A–F.
6. **Struktura oceny**: kara za polowanie z pokryciem przez core, kara za zbiórki w ataku, lift z limitem i dwóch shot-first, gwiazda wymagająca spacingu, rim pressure całej drużyny, taper mmStruct, wpływ playoffów.
   - **Metodyka kroku 6 (2026-10-28, ustalona przed zmianami):** każdy podpunkt przechodzi trzy sędziów i jedną bramkę.
     (A) **Mecz** — `measureScoreVsSim.ts --save=pre6` raz przed 6.1, potem `--compare=pre6` po każdej zmianie; warunek: R² Overall↔margines nie spada, nachylenie (pkt meczu na pkt Overall) w paśmie ±10%.
     (B) **Real** — `lineups5.json` ma ORtg *i* DRtg (2007-08+, 300+ min, ~370 piątek): obrona → DRtg względem ligi vs Defense; atak → ORtg vs Offense (`measureOffense.ts`). Dla 6.1 nowy pomiar: reszta DRtg ponad średni D-TAL piątki vs kara za polowanie, osobno dla piątek z i bez „krycia” (wing stopper / POA / kotwica); jeśli piątki z kryciem realnie tracą mniej, niż mówi kara — jest podstawa do ulgi, a jej wielkość bierzemy z danych, nie z głowy.
     (C) **Pary kontrolne w meczu** — ten sam skład z graczem X i z przeciętnym zastępcą (ten sam koszt TAL ±2): różnica w marginesie meczu vs różnica w ocenie. 6.1: Nash/Sexton obok Kawhi+Howard+Bell; 6.2: Harden+Kobe vs Harden+wing 3&D; 6.3: Giannis z 2 vs 4 strzelcami; 6.5: Luka/Harden hub vs ten sam bez hubu. Zmiana jest dobra, gdy ocena przesuwa się w stronę różnicy z meczu.
     Bramka: wszystkie parametry nowej zmiany ustawione z (B)/(C), maks. 1–2 nowe stałe na podpunkt (przeuczenie: odrzucone 10-parametrowe dopasowanie z kroku 4); przypadki Eryka jako kontrola, nie cel dopasowania; potem `npm run test:fast`, Spearman z rankingami ludzi, wzorzec AI dopiero na końcu 6.3. Wyniki każdego podpunktu jako tabela przed/po (Overall, Offense, Defense, mecz) dla Eryka.
   - **Krok 6 — wyniki 2026-10-28 (na branchu, nie na main):** sędziowie: 962 sezony NBA (ORtg/SRS), 955 piątek NBA.com 2013+, ligi testowe w mechanice meczu.
     - 6.1 polowanie: krycie także przez elitarnego obrońcę obwodowego (D-TAL 88+, łącznie maks. −55%), ławka 0,4→0,7, headroom najsłabszego startera ±3→±6. Polowania nie usuwamy (bez kary gorzej z meczem: R² 0,58→0,55). Nash+Kawhi+Howard: Defense 75→78.
     - 6.2 zmienione na **dwóch graczy z piłką** (czas z piłką NBA.com; drugi 18%+ = −2,3 ORtg; drugi strzelec z usage 27%+ = +0,9): `ballHandling.ts`, ta sama kara w meczu i w Overall. Harden+Westbrook/Paul/Nash −1,5…−1,8 Overall, Harden+Kobe −0,3.
     - 6.3 kara „gwiazda potrzebuje spacingu” — dane na nie. Obcięcie spacingu (0,17→0,04, mecz 1→0,3) **cofnięte**: liczone na wszystkich erach; od 1996-97 (Eryk: mierzyć od 96-97, wcześniej brak dokładności) 10 pkt spacingu = ~1,9 pkt O-TAL w realu, mecz daje ~0,6 → w kroku 8 podnieść, zależnie od ery/archetypu (gwiazda podkoszowa +0,12, rozgrywający +0,44, kreator +0,67, strzelec +0,39 ORtg na 10 pkt spacingu kolegów). Test postu (`measurePostSpacing.ts`): ten sam center ze strzelcami obok dostaje piłkę w poście rzadziej (−0,28/36), skuteczność bez zmian.
     - Zasada pomiaru od teraz: real od sezonu 1996-97 (`FROM=1997`).
     - 6.4 rim pressure drużyny w Offense 0,085→0 (+0,06 ORtg/10 pkt w realu); mecz bez zmian.
     - 6.5 taper mismatch przy hubie — dane odwrotnie, bez zmian.
     - 6.6 składnik playoffów w TAL ×⅓ (powtarzalność między oknami r 0,15); FMVP bez zmian; rankingi ludzi bez pogorszenia (Backpicks 0,795→0,809).
     - Audyt metryk (`auditMetrics.ts`): ławka .113→.17, rotacja .078→.039. Overall↔real SRS 0,752→0,758, ↔mecz 0,736→0,747. Ery: brak błędu (po wyrównaniu na sezon gradient znika). Wzorzec AI przepięty (16/30, zatwierdzone).
     - **Do kroku 8 (mecz):** talent waży w meczu za mało (real 2,3×, mecz 0,8× wagi w Overall), obrona za dużo (1,65×); premia huba z bonusu rozgrywającego za straty (+2,3 vs ≈0 w realu; zamienić na realny TOV%); spacing wg archetypu gwiazdy (Post Scorer ≈0, strzelcy/Stretch Big +0,4–0,5 na 10 pkt); mecz karze gwiazdę na kosz przy słabym spacingu bez pokrycia w realu; poprawa rzutów kolegów w realu ~0,1 pkt na pkt (silnik ~1,2) — tylko razem w meczu i ocenie.
   - **Krok 8 — wyniki 2026-10-28 (na branchu, PR #265; Eryk: „zrób wszystko, rano sprawdzę”):**
     - Spacing w meczu (siła, kanały, archetyp) i premia huba (bonus rozgrywającego): żadna zmiana nie poprawia meczu ponad szum (mecz↔real r ~0,65, sufit danych), każda psuje zgodność oceny z meczem — bez zmian, po launchu ewentualnie przebudowa spacingu jako jednego mechanizmu.
     - Asysty: podający wybierany wg realnego AST% zamiast asyst z karty (karta zawyżała skrzydłowych percentylem pozycji: LeBron 6,8→9,4); błąd udziału w asystach drużyny 2,19→1,39 pkt, archetypy w ±1,1. Poziom drużyn realny (24,7 ast, 57% po asyście, rozrzut 17–33 wg składu). Punkty i zbiórki w porządku (błąd udziału 1,4–1,5).
     - Tempo: posiadania z tempa obu drużyn (styl graczy z `spanPace.json` ×1,78 + ¼ ery); drużyny z draftu 94–102 (średnio 98,3).
     - Mecz piątek (Draw Five, daily): 4×9 min (`FIVE_GAME_MINUTES = 36`), margines silnika skalowany do długości; 91 pkt na drużynę, faworyt 86%, 23% meczów do 5 pkt (48 min: 121 pkt, 90%). Zegar, kursy i komentarz czytają długość meczu.
     - Mecz na żywo a silnik (`measureNudge.ts`): sama mechanika daje 84% marginesu silnika (r 0,80), przechył średnio 0,019 z dopuszczalnych 0,3 — mecz już stoi na silniku, bez zmian.
7. **To, co czyta oceny**: detektory i opisy panelu (AST% zamiast APG, obrona vs Cohesion), wybór okna przez AI z kosztem, wykładnik wartości picku AI, siła AI, waga TE-1.
8. **Symulacja meczu**: punkty w meczu samych piątek / krótszy mecz, asysty wg roli, tempo, mecz na żywo mocniej na silniku, korelacja silnik ↔ symulacja.
9. **Panel ekspertów** (The room) — na końcu, bo opisuje gotowe oceny; zakres do ustalenia z Erykiem.

**Tydzień 3 — jedna spójna skala ocen (2026-10-24, decyzja: nie robimy teraz):** Talent 87 przy Offense 70 i Defense 62 wygląda dla nowego gracza jak błąd. Przyczyna: Talent to średnia pięciu starterów, a Offense i Defense są przeliczone na skalę ze średnią 74 i dodają spacing, mismatche, hunt resistance itd. Plan: (1) wszystkie trzy na jednej skali (średnia 74) — rusza progi A–F i dotychczasowe wyniki, więc razem z listą silnika; (2) „droga od talentu do wyniku" przy Offense i Defense (np. talent ofensywny 85 → spacing −6, kosz −5 → 70); (3) podział Talentu na atak i obronę. Punkty 2–3 to głównie wyświetlanie. Etykiety („Star power" / „razem") jako szybka łatka — Eryk: to tylko łatka.
  - Dwie osobne przyczyny rozjazdu Talent ↔ Offense/Defense: (a) Talent nie jest na skali Offense/Defense (średnia 74, odchylenie ~9; surowy atak jest przeliczany wzorem 74 + (surowy − 85) × 9,3/8,5); (b) atak dokłada ponad talent spacing, mismatche i zbiórki w ataku.
  - Zbiórki w ataku: kara do −7 pkt (z-score ucięty na 2,5; średnia 8,9, SD 1,2 na piątkę) bije w obwodowe składy, które nie są modelowane w kontrze (powrót do obrony). Teraz: pokazać wiersz „Zbiórki w ataku" w Offense details. Tydzień 3: zmniejszyć karę (np. maks. −3) albo dać kredyt w obronie; po zmianie przeliczyć skalę i testy.
  - Kara za polowanie (hunt penalty) a „pokrycie” przez core (Eryk, 2026-10-24, przykład: Nash 39 min + Sexton, razem 48 min na PG; obok Kawhi D 98, Howard D 94 DPOY, Bell D 84 → Defense 69, po zamianie obu na przeciętnych ~79): słaby obrońca płaci dwa razy (średnia D-TAL + kara nieliniowa), a bonus za mocnych jest ucięty kolanem. Dziś łagodzi to tylko `anchorDampening` — wyłącznie rim protector (D-TAL ≥ 88, maks. −35% kary). Pomysł: uogólnić na „pokrycie”: elitarny wing stopper / obrońca na piłkę (POA) też zmniejsza karę (np. łączny limit ~−55%), do tego mierzenie na symulacji (ten sam skład z Nashem i bez, net rating vs kara w pkt). Do zrobienia razem z listą silnika, tydzień 3.
  - Konflikty w składzie karane za słabo (Eryk, eksport seed 2230129059): (1) Long Beach #2 z Hardenem 2016-18 i Kobem 2007-09 (obaj „shot-first first option”): Overall 83,6 = 0,5 Quality 86,5 + 0,5 Fit-Offense-Defense 74,8 + obciążenie piłki +0,4 + **lift +2,5**; Aspen #3 (Fit 79, Offense 87) ma lift −1,3 i bez lifta prowadziłby o ~3 pkt. Konflikt kosztuje tylko Fit 67 i karę −4 w składzie (~−0,7 w Overall); obciążenie piłki daje +0,4, bo wzorzec to typowa piątka z draftu. (2) Little Rock #4 z Giannisem (Spacing 51, Offense 73, Defense 88): brak spacingu ≈ −2,5 pkt w Overall (spacing 18% ataku ≈ −1,6, „Spacing caps overall fit” −5 w Fit ≈ −0,9), tonie przy Defense 88; Giannis (atak na kosz 100 przy Spacing 35) wymaga rozstawienia, a silnik liczy brak rzucających osobno od stylu gwiazdy. Do zrobienia: lift z limitem na posiadania (drugi gracz z dużym usage dodaje mało), mocniejsza kara za dwóch shot-first first option (~−2…−3 w Overall), wzorzec usage z realnych drużyn, połączenie „gwiazda wymagająca spacingu” + niski spacing. **Najpierw pomiar na symulacji sezonu** (czy te składy naprawdę wygrywają tyle co wynika z oceny), żeby nie rozjechać oceny i symulacji.
  - Cheyenne #11 (Eryk, ten sam eksport): (a) Conley wzięty w oknie 2022-24 (TAL 75, D 56, tanie 8,8 caps) zamiast szczytu z All-Defense — AI przy wyborze okna nie liczy, ile słabsze okno kosztuje drużynę; (b) detektory `NO_TRUE_PLAYMAKER` (próg 6,5 APG) i `ELITE_FLOOR_GENERAL` (10,5 APG) czytają surowe asysty na mecz, a silnik daje Conleyowi PM 89 — panel mówi „brak rozgrywającego”, ocena co innego. Zamiana na ten sam wskaźnik playmakingu co w silniku / asysty na 100 posiadań z usage. (c) Panel chwali obronę („ELITE_DEFENSIVE_LAYERING 0,94”), a Defense 68 przy Cohesion 31 — opisy i liczby powinny czytać te same dane.
  - D-TAL: Dirk 2002-04 (58) wyżej niż Batum 2020-22 (55), choć dane realne mówią odwrotnie (RAPTOR def 1,33 vs 2,04, BPM2 0,71 vs 1,42, nadwyżka −0,37 vs +0,48). Powód: baza to box (wpływ obronny 29,9 vs 15,0 — zbiórki i bloki Dirka), dane realne to tylko mała korekta. Do rozważenia: większa waga danych realnych tam, gdzie są kompletne, zwłaszcza dla wingów (box nie widzi ich obrony).
  - D-TAL z boxscore'u: dziś `defensiveBoxParts` bierze steals i bloki na MECZ (z korektą tempa ery), a zbiórki wg pozycji — bez minut i posiadań. Propozycja Eryka: na 36 minut / 100 posiadań z uwzględnieniem minut (żeby gracz z 22 min nie tracił do gracza z 36), z zasadą Eryka (2026-10-24): im mniej minut, tym mniejszy wpływ — gracz z 8 min nie jest porównywalny z graczem z 36, ale od ok. 24 min statystyki liczą się już w pełni (na 36 min / 100 posiadań). Wzór główny (lepszy od progów): ściąganie do średniej proporcjonalnie do ŁĄCZNYCH minut w oknie (mecze × mpg): wynik = (minuty × tempo + K × średnia pozycji) / (minuty + K), K ≈ 1500 min do ustawienia na puli; K może być większe dla steals/bloków niż dla zbiórek; prior = dane realne (RAPTOR/BPM2), gdy gracz je ma, zamiast średniej pozycji; wyspecjalizowany obrońca z ławki (blokujący center) nie powinien być spłaszczony — bonus roli osobno. Alternatywa do porównania: klamra((mpg − 8) / (24 − 8), 0, 1) jako waga, progi 8 i 24 do przemierzenia na puli. Sprawdzić na parze Dirk/Batum i na całej puli (rozkład D-TAL po zmianie).
  - Gdzie jeszcze zastosować ściąganie do średniej wg próby (przegląd 2026-10-24, kolejność wg wartości): (1) **D-TAL**: steals/bloki na mecz w `defensiveBoxParts` — próba = minuty; (2) **Spacing**: 3P% ważone próbą — dziś twardy próg `MIN_VOLUME_FOR_ACCURACY = 1` (3PA/mecz) w spacing.ts; zamiast progu próba = 3PA × mecze, prior = średnia pozycji (+ próg `REAL_VOLUME_FLOOR_FOR_WALKING_GRAVITY` jako płynny); (3) **Efektywność (TS%)** w talent.ts (~920) i portability.ts (255/338/424): dziś `lowUsageEfficiencyFactor(fga)` — twardy czynnik; zamiast tego próba = FGA × mecze; (4) **Playmaking po APG**: `effectivePlaymakingApg`, `passShare`, detektory insights (NO_TRUE_PLAYMAKER, ELITE_FLOOR_GENERAL) — asysty na 100 posiadań + próba = minuty; (5) **Rim pressure**: progi ppg na mecz (rimPressure.ts ~125, 276, `scoringVolumeFactor`) — per-36 + próba; (6) **FT%** (istniejący pomysł FT% w silniku): próba = FTA; (7) zbiórki (talent.ts 723): per-36 + próba. `teamGlass`/`defenderProfile` już liczą per-36 — precedens do skopiowania.
  - KOREKTA (2026-10-24): minuty i mecze mamy dla WSZYSTKICH lat — `src/data/raw/playerSeasonStats.csv` (25 519 wierszy 1947-2026: games, numMinutes, pts, ast, blk, stl, FGA/3PA/FTA, orb/drb, pf, tov; brak minut tylko w 657 wierszach, głównie lata 40.-60.) + `playerSeasonTeams.csv` (zespół, mecze, minuty). `usage.json` (mpg, USG%) jest tylko od 1996-97. Czyli zmiana „próba = minuty / próby” nie wymaga nowego źródła; do łączenia po `personId`/nazwie jest już resolver. Każda zmiana wejść TAL musi przejść ten sam test na rankingach ludzi co dotąd (Spearman z top-5 TAL), nie tylko test jednostkowy.
  - **Dane do zebrania (lista dla Eryka, 2026-10-24).** Mamy już: `raw/playerSeasonStats.csv` (1947-2026), `playerSeasonTeams.csv`, `players_bio.csv`, `wingspan.csv`, `teamAdvanced.csv` (tylko 217 drużyn), `leagueAverages.csv`, oraz NBA.com 2015-16+ (`raw/nbaStats`: defense overall/rim/3pt, passing, drives, catch&shoot, pull-up, playtypes gracz i drużyna, team advanced/misc) i awards (RAPTOR, DARKO, BPM2, APM, matchup defense, zone efficiency). Brakuje i dałoby największy zysk: (1) **tempo i ORtg/DRtg/SRS dla KAŻDEJ drużyny i sezonu** (BBRef „Team Misc” / „League Index”, 1950-51+, najlepiej 1973-74+) — baza do posiadań (minuty → posiadania) i do prawdziwych wyników drużyn do kalibracji oceny; (2) **BBRef Advanced per sezon** (USG%, AST%, STL%, BLK%, TRB%, ORB%, DRB%, TS%, BPM, VORP; USG% od 1977-78, BPM od 1973-74); (3) **składy zespołów z minutami** (kto grał ile w prawdziwych drużynach, np. BBRef „Roster/Per Game” per drużyna) — żeby porównywać wynik silnika dla realnych składów z realnym bilansem; (4) **NBA.com on/off i lineups** (5-osobowe jednostki, net rating, minuty) od 2007-08, a play-by-play od 1996-97 — walidacja Fit/hunting/cohesion na prawdziwych piątkach; (5) **NBA.com hustle** (deflections, contested shots, screen assists, loose balls) 2015-16+, **tracking rebounds** (contested/chances), **touches i time of possession**, **speed & distance**, **defense dashboard po strefach** — wymiar obrony i zbiórek dla skrzydłowych (to jest luka Batuma); (6) **clutch** (ostatnie 5 min, różnica ≤5); (7) **wiek** (players_bio ma daty urodzenia, ale brak wieku w oknie) i **stan zdrowia/kontuzje** (liczba meczów jest, ale nie powód nieobecności); (8) **nagrody** poza obecnymi: All-NBA tier, All-Rookie, MIP, 6MOY (sixth man) — do tagów roli.
  - **Logika do poprawy — zbiorczo (tydzień 3, kolejność wg wartości):** (1) jedna skala Talent/Offense/Defense + „droga od talentu do wyniku”; (2) kara za polowanie z pokryciem przez core (wing stopper i POA, nie tylko rim); (3) kara za zbiórki w ataku (z-score ucięty na 2,5, max −7) — zmniejszyć lub dać kredyt w obronie; (4) lift z limitem na posiadania i mocniejsza kara za dwóch shot-first; (5) gwiazda wymagająca spacingu + niski spacing (Giannis); (6) ściąganie do średniej wg próby (minuty, próby, rzuty wolne) w D-TAL, spacingu, TS%, playmakingu, rim pressure, zbiórkach; (7) większa waga danych realnych dla skrzydłowych (D-TAL Batum/Dirk); (8) detektory i opisy czytają te same oceny co silnik (playmaking, obrona vs Cohesion); (9) wybór okna przez AI uwzględnia koszt słabszego okna (Conley); (10) jedno narzędzie pomiaru „ocena kontra symulacja sezonu” puszczane przed każdą zmianą wag, żeby ocena nie rozjechała się z grą.
  - **Skrypt NBA.com (tydzień 2/3):** rozszerzyć istniejący `scripts/fetch_nba_stats_browser.js` (konsola przeglądarki na nba.com/stats; Python odpada — stats.nba.com wiesza `requests`), tą samą konstrukcją (`get`, `add`, pauza 800 ms, jeden `nba_stats.json`). Dodać: (4) `leaguedashlineups` (jednostki 5-osobowe, net rating, minuty) i `teamplayeronoffsummary` (on/off graczy) od 2007-08; (5) `leaguehustlestatsplayer` (deflections, contested shots, screen assists, loose balls), `leaguedashptstats` z `Rebounding`, `Possessions`, `SpeedDistance`, `leaguedashptdefend` po strefach — od 2015-16 (część już jest w pliku). **Stan (2026-10-28): napisany `scripts/fetch_nba_stats_extra.js` (osobny plik, drugi zestaw: lineups, on/off, hustle, tracking rebounds/possessions/speed, strefy obrony, clutch; tryb TEST = jeden sezon 2023-24, potem TEST=false na pełne pobranie).** Plan: pisze Claude, Eryk puszcza na jednym sezonie i wkleja pierwsze linie / błąd, poprawka, dopiero wtedy pełne pobranie. Środowisko Claude nie ma dostępu do stats.nba.com (proxy 403), więc nie da się przetestować na miejscu.
  - Przypadek testowy: Lillard 2019-21, Ginóbili 2005-07, Durant 2012-14, Green 2015-17, Gasol 2014-16 (+ Chalmers, O'Neale): O-TAL 81, spacing 86, playmaking 89, mismatch 54, kosz 69, bonusy +9 i +6 → surowe 95 → 85 po skali → −7 zbiórki = 78 (u Eryka w grze 70, słabsze okna).

## Marka i nazwa — brief roboczy (2026-10-24, do tygodnia 5; Eryk przygotowuje wcześniej)

**Skąd gra:** liga „all-time draft” grana przez znajomych od 2019 roku — start 16 osób, szczyt 32, dziś znów 16. Gra wyrosła z kilku lat prawdziwego draftowania, nie z pomysłu na aplikację. To jest historia założycieli i główny wyróżnik.
**Pozycjonowanie:** „nie quiz — draft”. Całą grą są decyzje (kogo wziąć, które okno lat, za ile caps, kogo zostawić rywalom), a nie wybór z losowo wyświetlonego składu. Dziewięciu graczy z ławką i rotacją, cap, AI jako GM-owie (16 drużyn), ocena składu (atak, obrona, spacing, fit, ławka) z komentarzem panelu, symulacja sezonu i playoffów, dzienne wyzwania.
**Konkurenci (z wyszukiwania, wg opisów; Eryk grał w „82-0 Pro Basketball Draft” i ocenia naszą grę jako „inny poziom”):** Draft 82-0 / 82-0 Pro Basketball Draft (piątka, perfekcyjny sezon, tryb salary cap), GOAT Lab (dzienna gra w przeglądarce), Basketball GOAT (App Store), iKnoBall All-Time Sports Draft (dzienne wyzwanie, pojedynki), NBA NOW (większy mobilny GM), Legend Five: Basketball Draft (tylko App Store, opis po chińsku — Eryk: zerowe zagrożenie).
**Nazwa — stan:** „FBL” odrzucone (opisowe, wprowadza w błąd, krótkie skróty zajęte); „16-0” odrzucone (za bardzo kojarzy się z 82-0); „Greatest 5” — Eryk: nie buduje marki na przyszłość; **„GOATS” — kierunek faworyta Eryka** (można zbudować cały świat: stado, maskotka, „najlepsza drużyna wszech czasów”). Ryzyka GOATS: słowo „GOAT” jest wszędzie w sportowych aplikacjach (trudno się wyróżnić), a GOAT (1661, Inc.) ma zarejestrowane znaki (m.in. odzież, klasa 25) i pilnuje ich (sprzeciw wobec Green Goat LLC, 2022) — dlatego raczej „GOATS” + własny dopisek (np. League/Draft/FC), nie samo słowo. Drugi kierunek: słownictwo kultury lig (War Room, Commissioner, Draft Night, Big Board). Obecna robocza nazwa: Draftverse (w wyszukiwaniu brak kolizji dokładnej, są podobne brzmieniowo: Dragverse, Chronicles of Dragonverse, Draft Battle).
**Nazwa — runda 2 (2026-10-24):** odrzucone: Goats of War (parodia God of War, „war” nie pasuje do gry), Goats of Ball („ball” niejednoznaczne, skojarzenie wg Eryka), Hoop Gods (zarejestrowany znak THEHOOPGODS, klasa 41, gry koszykarskie), Heat Check (zajęte: aplikacja statystyk i esport Miami Heat), Einherjar/Aristeia/Yuga (zajęte), Greatest 5 (nie buduje marki), Pantheon (pospolite, wymaga dopisku). Z języków starożytnych: Delectus (łac. wybór/pobór — draft; w wyszukiwaniu wolne), Lugal (sum. „wielki człowiek”), Kleroterion (gr. maszyna do losowania — jako nazwa funkcji losowania kolejności, nie marki). **Najważniejsze odkrycie: „Zwierzyniec”** — liga Eryka nazywa tak dyskusje w czasie draftu (mało merytoryki, dużo emocjonalnego pickowania). Daje świat marki razem z GOATS (koza to zwierzę): „your skład is GOAT’ed”, „Get GOATed”. Eryk: poprzednie nazwy nie miały koszykarskiego vibe’u — nazwa ma łączyć zwierzyniec/GOATS z koszykarskim słownictwem (hoop, hardwood, paint, rim, bench). Kandydaci: **Hoop Zoo** (rym, koszykarskie; dokładnej nazwy nie znalazłem), Hardwood Herd (niebezpieczne — Wisconsin Herd, zespół G League), Menagerie (tłum. Zwierzyńca), GOATed (brak dokładnej nazwy, ale w kategorii są GOAT Lab, Basketball GOAT, Goat Draft Fantasy Sports — real-money DFS), Bench Mob (slang koszykarski, „mob” = stado). Hasła: „Get GOATed”, „Your squad is GOATed”, „Settle it”.
**Nazwa — decyzja robocza (2026-10-24): BEAST COURT** (Eryk: „klasa”). Marka = Beast Court; nazwa funkcji **Beast Board** (zastępuje „Big Board”: własny ranking graczy w drafcie). Wyszło z: Zwierzyniec (nazwa dyskusji w lidze Eryka) → GOATS/„GOATed” → „Beast” (pochwała, bestie = karty graczy) + „Court” (koszykarski, miejsce akcji, gra słów „Beast Court is in session” przy werdykcie). Hasła: „Get GOATed”, „Your squad is GOATed”, „Settle it”. Odrzucone w tej rundzie: Hoop Zoo (nie działa na Eryka), Hoop Titans (generyczne), Hoop Beasts / Hardwood Beasts / Draft Beasts / Beast Draft (zbyt blisko HOOPBEAST), Beast Hoops/Beastball/Beast Break/Beast Paint/Beast Run (słabsze od Court). Sąsiedzi: Beast League: Ball Brawl (Acid Labs, zręcznościowa gra PvP z „Beasts” — inna kategoria, ale pilnować), Beast Board nie występuje, Beast Court nie występuje w wyszukiwaniu.
**Najważniejsze sprawdzenie przed nazwą:** USPTO — zgłoszenie **HOOPBEAST** (nr 97923151, maj 2023): zakres towarów/usług i właściciel (czy obejmuje gry/rozrywkę, klasy 9, 28, 41); spór Russell Brands (Spalding) kontra firmy MrBeasta o znak „The Beast” dla koszy (sprzęt, nie gry) — pokazuje, że „Beast” w koszykówce bywa pilnowane. Do tego: domeny beastcourt.com / .app / .gg / .io, konta (X, Instagram, TikTok, YouTube, Reddit), App Store i Google Play, EUIPO i WIPO (klasy 9, 28, 41, 25), test „powiedz na głos”, plus sprawdzenie, czy „Court” w znaku nie koliduje z „Beast League”.
**Archiwum burzy mózgów nazw (2026-10-24; wszystko niesprawdzone prawnie — tylko wyszukiwanie w sieci):**
- *Starożytne języki:* gr. Kleros (los), Kleroterion (ateńska maszyna losująca — dobra na nazwę funkcji losowania kolejności), Agon (zawody), Arete (doskonałość), Aristeia (zajęte: gra planszowa Corvus Belli), Aeon; łac. Delectus (wybór/pobór; w wyszukiwaniu wolne), Lanista (zarządca gladiatorów; kolizje: Gladiator Manager, gra karciana Lanista, Gladiatory), Princeps (kolizja: gra o Rzymie), Sors, Ludus; sum. Lugal („wielki człowiek”); egip. Maat, Sekhem, Nefer, Sed; sanskr. Vira, Ranga (arena), Krida (gra), Yuga (zajęte: Yuga Labs); staronord. Althing, Saga, Jarl, Valkyrie/Einherjar („wybierająca/wybrani” — Einherjar zajęte przez japońskie gry i God of War); celt. Fianna, Ard Rí; mykeński Wanax, Lawagetas.
- *Slang koszykarski:* Pick (draft + zasłona — podwójne znaczenie), Heat Check (zajęte: aplikacja statystyk i esport Miami Heat), Dime (magazyn), Buckets, Glue guy, Sixth man, Sauce, Run it back (zbyt popularne), The Run, Winners stay / Call next (wolne), Rafters, Chip, Bench Mob.
- *Popkultura:* Hoop Dreams, The Last Dance, Moneyball, Draft Day, Space Jam/Monstars, NBA Jam („He’s on fire”, „Boomshakalaka”), Mike Breen „Bang!”, debata GOAT, Ball Knowledge/Ball Knower, Hot Take, Let him cook. Wniosek: filmy i hasła raczej na hasło/głos gry niż nazwę; „Settle it” jako hasło.
- *Zwierzyniec / zoo:* Menagerie, Bestiary (karty graczy jako wpisy w bestiariuszu), Safari, Jungle, Ark, Habitat, Den, Pen, Barn, The Herd (zajęte: program Colina Cowherda; Wisconsin Herd — G League), Hardwood Herd (odrzucone przez Wisconsin Herd). *Hoops:* court, hardwood, rim, net, glass, paint, key, buckets, baseline.
- *Beast:* Titans, Behemoths, Colossi, Goliaths, Leviathans, Critters, Beasties, Creatures, Monsters/Monstars, Predators, Apex, Alphas (odpada), Brutes, Bruisers.
- *Konkurenci z wyszukiwania:* Draft 82-0 / 82-0 Pro Basketball Draft (Vaulty Studios), GOAT Lab, Basketball GOAT, iKnoBall All-Time Sports Draft, NBA NOW, Build a Hooper, Draft Lab, Pocket GM, Ultimate GM Basketball Manager, Legend Five (tylko Apple, opis po chińsku — Eryk: zerowe zagrożenie), Beast League: Ball Brawl.
- *Pomysł produktowy:* najwyższy werdykt na ekranie wyniku jako „GOATED” (zamiast obecnego zestawu ligowego Wooden Spoon / Lottery Team / Playoff Lock / Contender — te zostają jako niższe poziomy); „Beast Board” zamiast „Big Board”; „Kleroterion” jako nazwa ekranu losowania kolejności; Zwierzyniec jako nazwa czatu/komentarza w drafcie; komentarz na żywo w stylu NBA Jam („He’s on fire”).
**Pomysł na koniec dnia (Eryk, 2026-10-24): GOATS z „all” zamienionym na synonim** (backronim, żeby nazwa miała własne znaczenie): *Greatest Ones Across Time* (czysty, naturalny), *Greatest Of Ages, Teams & Seasons* (S jako liczba mnoga; dokładnie opisuje grę: ery, drużyny, okna sezonów), *Greatest Of Any Team* (T = Team; skład z dowolnych drużyn), *Greatest Of Ages, Together* (T = Together; drużyna z różnych epok). Uwaga: to nie zmienia ryzyka znaku GOAT (1661, Inc.) ani zatłoczenia słowa; może służyć jako podtytuł pod Beast Court albo wyjaśnienie nazwy w „o grze”.
**Do sprawdzenia (Eryk, wcześniej niż tydzień 5):** domeny (.com, .app, .gg) dla 4–5 kandydatów; App Store i Google Play; konta (X, Instagram, TikTok, YouTube, Reddit + subreddit); USPTO, EUIPO, WIPO w klasach 9, 28, 41 i 25 (merch); test „powiedz na głos i niech ktoś zapisze”. Wyszukiwanie z agregatorów to nie opinia prawna — przed rejestracją prawnik od znaków towarowych. Środowisko Claude nie sprawdzi domen ani baz znaków (proxy), robi tylko wyszukiwanie w sieci.

## Plan na 4 tygodnie (decyzja 2026-10-16) — zastąpiony planem 7 tygodni

- **Tydzień 1 — dokładne dokończenie UI.** Wszystkie tryby i ekrany do końca: playtesty spójności
  (Draw Five, Mini, All-Time), ton wyniku według miejsca, reszta otwartych punktów UI z 3.1–3.4
  (stół i karta na wynikach w Draw Five, animacja lotu karty, intro „co gdzie i jak”, duże ekrany).
- **Tydzień 2 — dokończenie UI, jeśli zabraknie kredytów; potem kalibracja:** symulacji (mecz,
  sezon, play-offy), wyborów AI w drafcie, TAL graczy i ocen drużyn.
- **Tydzień 3 — kalibracja** (ciąg dalszy: symulacja / wybory AI / TAL / oceny) **+ dopracowanie
  ekspertów.**
- **Tydzień 4 — definitywne dopracowanie całości + domena i serwer** (wtedy też leaderboard
  daily, globalny ranking; przed startem wyłączyć przełączniki testowe:
  `DAILY_REPLAY_FOR_TESTING`, `AUTO_FINISH_FOR_TESTING`, `TEAM_EXPORT_FOR_TESTING`).
  - **Nowa nazwa projektu** (razem z brand kitem; do tego czasu nazwa w jednym miejscu w kodzie).
    Kierunek „-OAT” (*Of All Time*). Krótka lista: **DOAT** (*Draft Of All Time*), **FLOAT**
    (*Five Legends Of All Time*, floater), **BOAT** (*Best Of All Time*), ewentualnie **HOAT**
    (*Hoopers Of All Time*). Odpadły: GOAT (zajęte), KOAT (stacja TV), VOAT (zamknięty serwis),
    GLOAT, COAT, MOAT. Do sprawdzenia: domeny, sklepy z aplikacjami, znaki towarowe.
    Pomysł poboczny: tryb **WOAT** (*Worst Of All Time*), czyli draft najgorszej piątki.

### Nowy wygląd trybów: „wydanie nocne” (decyzja 2026-10-21)

Stół w perspektywie (PR #252) odrzucony — zamknięty bez merge'a. Zatwierdzony kierunek: ciemne tło
gry + język drukowanego programu meczowego. Makiety wszystkich 9 ekranów Draw Five:
`docs/mockups/draw-five-night/index.html` (ekran przez `#start`, `#pick`, `#ai`, `#ready`,
`#dailyStart`, `#dailyJoker`, `#game`, `#results`, `#dailyResults`).

- **Najpierw przejrzystość i funkcjonalność**, realizm dopiero potem. Nic na siebie nie nachodzi.
- **Bez „AI looku”:** żadnych ramek-pudełek wokół wszystkiego, kolorowych pigułek, małych etykiet
  monospace wersalikami. Sekcje dzielą linie; nagłówki sekcji wersalikami Barlow Condensed nad
  kremową linią; dopiski kursywą (Inter).
- **Kolory, każdy jedno znaczenie** (po audycie 2026-10-21, szczegóły w
  `docs/mockups/draw-five-night/AUDIT.md`): złoty = capy, Joker i trofea; czerwony = „teraz”
  (on the clock, live, tonight) i problem; zielony = dobra wiadomość (atut, wygrana seria, „+”,
  prowadzenie); kolory drużyn tylko na kartach i znaczkach. Twoja drużyna = wiersz w negatywie
  (kremowe tło, ciemny tekst), bez napisu „you”; twoi gracze w statystykach = jasne podświetlenie
  wiersza. Czerwony i zielony zawsze ze znakiem albo słowem (+, −, weak, 4–1).
- **Fonty jak w reszcie gry:** Barlow Condensed (nagłówki, nazwiska), Inter (tekst), JetBrains
  Mono (liczby). Bez Bittera.
- **Układ:** lewa kolumna = winieta z podwójną linią + tablica (ty · cap · AI) + dziennik draftu
  + akcje; prawa = rząd rywala, twoja piątka, „On the clock” z dużym nagłówkiem, ręka kart.
- **Karty jak wydrukowane:** kremowy papier, pełny pasek drużyny, ostre rogi, statystyki w tabelce
  z liniami. Wybrana karta = sama czerwona obwódka (bez drugiej ramki/cienia).
- **Nowe elementy:** Tale of the tape (pojedynki pozycja na pozycję przed Submit), tura AI z jej
  kartami („AI takes”), wyniki jako gazetowy nagłówek + werdykt + profil drużyny w tabeli.
- **Wdrożenie wszystkich trybów za jednym razem** (Draw Five, Mini, All-Time) — najpierw makiety
  każdego trybu w tym stylu. Makiety: `docs/mockups/draw-five-night/` (`index.html` Draw Five,
  `mini.html` Mini, `alltime.html` All-Time).
- **Pasek capów** (2026-10-21, user: „oddzielny pasek w nowym UI, nie wpisanie w pole”): pod
  filtrami w Mini i All-Time suwak zakresu 0–30 z dwoma uchwytami, czerwona kreska „your max”
  (ile możesz wydać na ten wybór), wartość „10–14” albo „any” i reset. Zastępuje tekst „Affordable
  only / Fits this pick” w makiecie; pole „Max caps” z All-Time przechodzi w ten suwak.
- **Pomysł na później: reakcje na żywo** (2026-10-21, user). Lewa kolumna draftu All-Time ma pod
  Big Boardem wolne miejsce — docelowo panel, który reaguje na to, co się dzieje w drafcie (kto
  kogo wziął, twój wybór). Dziś nie ma mechaniki generującej reakcje na żywo (desk.ts buduje głosy
  tylko po drafcie i po 3. wyborze), więc na razie w tym miejscu idzie coś, co już mamy (np. ostatnie
  wybory ligi — zatwierdzone jako wypełniacz, „Latest picks”, tylko na komputerze; na telefonie
  nie pokazujemy), a forma docelowa jest do ustalenia („będzie to coś innego”).
- **Dodatki małym nakładem** (2026-10-21, decyzje usera):
  - **Symulacja sezonu z kalendarzem (na sam koniec prac nad UI, decyzje 2026-10-21):** dziś
    `liveSeason.ts` gra 656 meczów parami (najpierw wszystkie mecze BIS–DUL, potem BIS–KEN…) w tle
    i pokazuje tylko wynik końcowy. Docelowo (user):
    - **Rozpisany kalendarz na cały sezon,** od ~22 października do połowy kwietnia (~175 dni):
      drużyna gra 3–4 razy w tygodniu, nie codziennie (jednego wieczoru ~4–6 meczów); licznik to
      „mecz 23 z 82” i data, nie „dzień”. Każdy mecz liczony
      osobno dzień po dniu (wyniki jak dziś — każdy mecz ma własne ziarno, kolejność ich nie zmienia).
      Tabela, liderzy i twój bilans rosną z dnia na dzień; prędkość i pauza jak w meczu na żywo.
    - **Przerwa co miesiąc:** ekran „miesiąc w skrócie” — tabela z ruchem w górę/dół, twój bilans
      w miesiącu, **MVP ladder** (top 5 z ruchem), **Player of the Month**, najlepszy mecz miesiąca.
      Dalej przyciskiem; w ustawieniach można wyłączyć przystanki.
    - **Głosowanie do All-Star Game:** wyniki głosowania co miesiąc przed ASG (prowadzący na
      pozycjach), w lutym przerwa All-Star: wybór 24 (głosy + wartość gry), draft kapitanów, mecz.
      - [ ] **ASG votes — pod koniec projektu (Eryk 2026-10-28: mały priorytet, na sam koniec)** (2026-10-22, user). Przerwa All-Star, wybór 24, draft
        kapitanów i mecz już są; **samego głosowania nie ma** — dziś 24 to czysta wartość gry.
        Potrzebny model głosów liczony z silnika (nie wymyślone liczby): np. punkty i wygrane
        drużyny z części sezonu + sława zawodnika (tier/era), z ziarnem sezonu. Wtedy: na
        przerwach miesięcznych przed ASG tabela „voting returns” (prowadzący na pozycjach,
        guard/frontcourt × konferencja-odpowiednik, z ruchem od poprzedniego miesiąca, twoi
        gracze podświetleni), a w lutym starterzy z głosów + rezerwy z wartości gry.
    - **Play-in tournament** po sezonie regularnym przed play-offami: miejsca 7–10 (7–8: zwycięzca
      = 7. seed; 9–10: przegrany odpada; przegrany 7–8 z wygranym 9–10 o 8. seed). Mecze pojedyncze,
      do obejrzenia na żywo jak play-offy. Seedy 1–6 bez zmian.
    - Makiety: `alltime.html#simDay` (dzień po dniu: kalendarz miesiąca, 8 meczów dnia, tabela z
      ruchem, MVP ladder), `#monthBreak`, `#asgBreak`, `#playIn`.
  - **Razem z nowym wyglądem:** mecz sezonu i rekordy kariery (najlepszy występ, najwyższe
    zwycięstwo — zapamiętane w trakcie symulacji sezonu; na ekran sezonu i plakat Story);
    wyścig o MVP w trakcie sezonu (top 3 liczone funkcją nagród na statystykach z części sezonu);
    wibracja na telefonie przy twoim wyborze, „on the clock” i końcu meczu (`navigator.vibrate`,
    tylko gdzie działa; wyłączana w ustawieniach razem z dźwiękiem/animacjami).
  - **Mecz na żywo: statystyki i minuty w kwartach** (2026-10-21, user; makieta `alltime.html#liveBox`):
    w zakładce Box score przełącznik Game / Q1–Q4 (bieżąca „now”) i Tulsa / rywal; kolumny MIN,
    PTS, REB, AST, FG, 3PT, PF, +/−; kto jest na boisku (●/○), „Did not play in Q3”. Bez osobnej
    tabeli minut w kwartach (user: niepotrzebna). Silnik już to ma: `moments[].lines` to pełny
    box po każdym posiadaniu, a piątki są znane z góry — kwarty i +/− to różnice migawek.
  - **Faza końcowa:** rekordy i półka z trofeami (localStorage: najlepszy wynik w każdym trybie,
    tytuły, najdłuższa seria; „Nowy rekord” na wynikach); wczorajsza odpowiedź w daily Draw Five
    (najlepsza piątka z ziarna dnia + twój wynik); skróty klawiszowe w drafcie na komputerze
    (1–5 karta, D draft, / szukaj) jako pierdoła.

### Playtest wydania nocnego 2026-10-22 — spisane, do zrobienia

**Telefon — drobne poprawki z 2026-10-23 (do zrobienia, kończymy po całej liście):**
- [x] Lista draftu na zegarze: cap za blisko przycisku „Draft” — odstęp.
- [x] Lista draftu: ucięte statystyki w drugiej linii („27.0 / 1…”) — zwęzić pozycję/lata albo skrócić zapis.
- [x] Okno „His stretches”: cap za blisko przycisku „Use” — odstęp ~12 px.
- [x] Team (po drafcie): tabela rozpycha stronę w lewo, cap poza ekranem — zmieścić tabelę (węższy slot, mniejsze zdjęcie, „change” pod latami), reszta przewija się wewnątrz tabeli.
- [x] Lista draftu (telefon): cap za blisko „Draft”; ucięte statystyki; okno „His stretches”: cap za blisko „Use” (patrz wyżej).
- [x] Sezon › Overview: niższe wiersze Standings (~34 px), żeby tabela i „Playoffs →” mieściły się bez przewijania.
- [x] Sezon › Stats › Players i box score meczu na żywo: przewijanie w bok w swoim pudełku, przyklejona kolumna nazwisk, cień sygnalizujący więcej kolumn (FG, 3P, FT, STL, BLK, TOV, PF).
- [x] Mecz na żywo (telefon): boisko „Last basket” na całą szerokość, wyśrodkowane, ~200 px (tylko boisko, reszta ekranu bez zmian).
- [x] Playoffy: przycisk „On to the semifinals →” w jednej linii (niski); drabinka w zwartych kartach (seria = jedna karta ~56 px, „Sweep”/„Game 7” w tej samej linii).
- [ ] **Drabinka playoffów jak w prawdziwej NBA** (2026-10-23, Eryk — referencja: drzewko 8 drużyn z liniami łączącymi rundy, puchar w środku). Makieta A/B: A = kompaktowe drzewko na całą szerokość telefonu (3 kolumny: QF/SF/Finał, herb + seed + skrót + wynik serii, linie łączące, Twoja seria wyróżniona), B = szersze drzewko z pełnymi nazwami i przewijaniem w bok; PC = to samo szerzej. Razem z makietą matchupu playoffów (patrz niżej).
- [ ] Matchup playoffów: zamiast „Top three” porównanie piątek z facecards (telefon i PC; pod parami pts · reb · ast).
- [x] Plakat sezonu (Post/Story): ławka jako facecards (twarz, nazwisko, ppg), kontrola przy 4 osobach.
- [x] Team po drafcie (telefon): tabela rozpycha stronę, cap poza ekranem — zmieścić tabelę, resztę przewijać wewnątrz.
- [x] **(2026-10-28, zrobione: okno gracza — nagrody zawsze, 6 ocen w kafelkach „?” przed zwiadem, skład na telefonie z liniami nagród i ocen, chipy na liście; makieta `docs/mockups/draft-grades-phone.html`)** brakuje podglądu statystyk od A do F (znikł po zmianie UI) — do zbadania i przywrócenia. Trop: oceny literowe OFF · DEF · 3PT z listy draftu (`src/night/draft.tsx`, `r.grades`, PR #214 „grade tips”) — dziś pokazują się tylko po „Scout”, a na telefonie kolumna jest ukryta (`.plist .c-hide`). Do sprawdzenia z Erykiem, czy chodzi o to, czy o litery w wynikach.


Zasady z playtestu: **Mini wygląda dokładnie jak All-Time, tylko krótszy** (różnice tylko z zasad
trybu); kolumny obok siebie kończą się mniej więcej równo (długie treści zwijane); akcje zaraz pod
treścią, nigdy dociśnięte do dołu i nigdy zdublowane; twoje = krem, nigdy nie przesuwa treści;
złoto tylko capy / Joker / trofea; czerwony i zielony zawsze ze znakiem lub słowem.

**A. Szybkie** (style, teksty, drobna logika — jeden PR)
- [x] Licznik w aside (Cap/Teams/Rounds, Caps left/Cap/Round, Won/Seed/Lost): trzy równe kolumny,
      jedna wielkość i linia bazowa.
- [x] **(2026-10-28: bez górnej linii nad tytułem w aside)** Jedna linia u góry w obu kolumnach (dziś podwójne po lewej i nad kartami „big four”/„Finals”).
- [x] Kremowy wiersz „twój” nie przesuwa treści (`.order16 li.you` padding — i wszystkie inne).
- [x] Loteria: okrągły błysk w obrębie bębna zamiast prostokąta na całym canvasie.
- [x] Capy zawsze z jednym miejscem po przecinku („19.0”, nie „19”) — `fmtCaps`.
- [x] Teksty: „about 11.2 a pick” bez sierotki; „tap to show” → „show list” na komputerze; kropka
      przy latach w liście („2012-14 ·”) — wyjaśnić albo usunąć.
- [x] Twój pick: bez podpowiedzi „X fits best / Y is still on the board”, zostaje „Up to N caps
      on this pick”.
- [x] Okno gracza: tier osobno, oceny w równej siatce (6 / 3×2); ocena A nie złota.
- [x] Plakat: „Daily” tylko po daily; przygaszone kolory drużyn za zdjęciami (też karty „Your roster”).
- [x] Nagrody: „big four” bez pustego miejsca przed finałami (3 karty albo przygaszone Finals MVP).
- [x] Mecz na żywo: odstęp prędkości → przyciski; Play pełny, Skip obrysem; po meczu jedno
      „Watch again” pod „▶ Game N”, bez górnego.
- [x] **(zrobione w #255, sprawdzone w kodzie 2026-10-28)** **Błąd:** po meczu play-offów nagłówek nie liczy właśnie skończonego meczu („lead 2–0”
      zamiast 2–1). Podtytuł bez powtórzeń („beat the Moles 4–1, by 7.2 a game”; „The Sasquatch
      were the better team. Curry did what he could: …”). Score by quarter pod wynikiem w aside.
- [x] Procenty przy kilku próbach („—” zamiast 3P% 50.0 przy 2 próbach).
- [x] Koniec gry: wyraźne „New draft” i „Main menu” (dziś tylko mały link „← Menu”).
- [x] Przerwa miesięczna: bez kolumny ruchu przy pierwszej przerwie; twoi gracze w MVP ladder na
      kremowo; remis „You and the Raccoons had the best month”.
- [x] **(zrobione w #255; 2026-10-28 test 1000 dni `scripts/testDailyJokers.ts`: 1980 Jokerów, 49,6% legend, 0 błędów)** **Daily Draw Five — błąd Jokera:** legenda droższa jako Joker niż face up (Magic 14.4 vs
      14.3). Legenda = wysoki TAL (≈70+ / górne 10% pozycji, nie 6+ All-Star — Sharman ma TAL 56)
      I prawdziwa cena wyraźnie wyższa niż Joker; scrub = dolne 25% TAL I tańszy. Test 1000 dni.
      Okno „Jackpot” z pełnym tłem.

**B. Więcej czasu** (logika / przebudowa na istniejących elementach)
- [x] Loteria: bęben zostaje 1,5–2 s z kulą, potem wynik wchodzi powoli; dalej „Start the draft”.
- [x] Duże ekrany: ramka szersza niż 1360 px i większa skala (1366 / 1920 / 2560).
- [x] Aside przyklejony (sticky) na wszystkich ekranach, akcje pod treścią.
- [x] Rotacja: widoczny uchwyt suwaka na styku (gałka ‖, pole ~24 px, minuty przy przeciąganiu).
- [x] Final standings → rywal: gdzie lepszy, gdzie ty lepszy, „All metrics ▾” (wszystkie wejścia,
      różnica ze znakiem); blok na całą szerokość / atak | obrona.
- [x] Wyniki: The room zwijany (4–5 wypowiedzi + „Read the rest”), kolumny równe; „More”:
      Title structure do krótszej kolumny, „Size vs. position” bez mikropasków.
- [x] Sezon „Tonight”: domyślnie tylko twój mecz, reszta zwinięta, przełącznik Your / All games.
- [x] Przerwa miesięczna: MVP ladder do prawej kolumny, „Your month” w aside.
- [x] Statystyki w trakcie symulacji sezonu (Standings / Stats / Leaders „through <data>”, pauza);
      silnik: sumy po każdej nocy zamiast tylko na koniec miesiąca.
- [x] Statystyki play-offów w trakcie (Regular season / Playoffs „so far”, bez spoilerów).
- [x] Klikalne twarze i karty graczy wszędzie → okno gracza (w sezonie ze statystykami sezonu).
- [x] Mecz na żywo: przywrócić „Key moments” (ostatnie 6 min, przed meczem i w trakcie) i ⅛.
- [x] Box score: piątka, linia „Bench”, ławka po minutach, suma; jeden znacznik „na boisku”.
- [x] Draw Five: animacja rozdania / wyboru / tury AI w jednym języku; AI dostaje to samo
      rozdanie i tempo co ty (dziś cała tura AI 2,6 s), pauza „myśli”, jedna stała tempa.
- [x] Mini = All-Time: wspólny ekran draftu (lista graczy zawsze otwarta, Big Board, Latest picks
      w aside), ten sam board z twarzami (BoardGrid), te same wyniki i karty piątki; „Caps left”.

**C. Nowe plansze** (makieta do akceptacji, potem kod)
- [x] Okno drużyny (klik w herb/nazwę wszędzie): bilans, ocena, piątka + ławka z minutami,
      statystyki sezonu/PO, ostatnie mecze, „ty vs oni”.
- [x] Wyniki draftu po sezonie: blok „Your season” (bilans, PO, mistrz, nagrody, „Open the season”).
- [x] Koniec sezonu: wyraźny blok „Champions” (mistrz z 🏆, finał, Finals MVP z twarzą).
- [x] Plakat i podsumowanie sezonu: ocena draftu (Rating, miejsce, Talent/Off/Def/Spacing/Fit).
- [x] Sezon: duży „twój mecz” w Tonight; „Your month” na przerwie.
- [x] Wyniki daily Draw Five — hierarchia: jeden bohater (mecz + werdykt), twoja piątka vs
      najlepsza, Film room, profil, Jokery na końcu; jeden nagłówek XXL (sprawdzić też Mini/All-Time).
- [ ] Mini: turniej NCAA po drafcie (patrz 3.2 Mini Draft).

**Silnik** (kalibracja, tydzień 2–3 — w Etapie 2): asysty po pozycji zamiast roli; gwiazda z
rozdania jako pułapka w Draw Five; krótszy mecz piątek (30 / 36 min).

**Poprawki PC + telefon (po #255, spisywane 2026-10-22)**
- [x] **Telefon — gęstość (największa wada wersji mobilnej, priorytet 1).** Wszystko jest za duże,
      więc trzeba przewijać; telefon jest blisko oczu, więc można mniejsze i gęściej. Osobna skala
      typografii i odstępów na ≤600 px: nagłówki ekranów (52→~32 px), winieta (34→~24), tally
      (30→~22), tekst 16→14–15, odstępy sekcji 24→12–14, wiersze tabel i list niższe, karty mniejsze.
      Granica czytelności: nic poniżej 11 px. Sprawdzić na 360/390/430 px, że każdy krok mieści się
      na ekranie razem z główną akcją (patrz zasada niżej).
- [x] **Telefon — błąd: strona ucieka w prawo** (sezon, Overview: standings, League leaders, Game of
      the season, Team records dochodzą do prawej krawędzi bez marginesu — coś jest szersze niż ekran
      i cała strona przewija się w bok). Znaleźć element (prawdopodobnie tabela albo linia rzutów),
      ograniczyć go; zasada: nigdzie poziomego przewijania strony. Test automatyczny na 360/390 px:
      `scrollWidth <= innerWidth` na każdym ekranie trasy zrzutów.
- [x] **Telefon — Stats › Players:** tabela wychodzi poza ekran, imiona ucięte z lewej, dalszych
      kolumn nie da się przewinąć. Na telefonie: skrócone nazwiska (T. Porter), kolumny Player · Team ·
      G · PTS · REB · AST (reszta pod „More stats” jako przewijana w obrębie tabeli, nie całej strony),
      pierwsza kolumna przyklejona. Zakładki sezonu (Overview…The playoffs) też wychodzą poza ekran —
      zawijanie albo przewijany pasek z widocznym końcem.
- [x] **Telefon — zasada „jeden krok = jeden ekran” (dotyczy wszystkich trybów).** Dziś trzeba
      przewijać, żeby zobaczyć to, co właśnie się dzieje. Propozycja:
  - każdy stan ekranu ma swój „punkt” (rozdanie → ręka, twój wybór → ręka, tura AI → stół AI,
    mecz → wynik + feed, przerwa → nagłówek); przy zmianie stanu ekran sam przewija się do niego
    (płynnie; przy ograniczonym ruchu od razu);
  - aktywna część + główny przycisk mieszczą się w wysokości ekranu (100svh): mniejsze nagłówki
    i rzędy kontekstu (np. rząd AI i „Your five” w Draw Five jako jeden pasek);
  - główna akcja przyklejona na dole ekranu (Draw / Submit / Play), żeby nie trzeba było jej szukać.
  - Najpierw Draw Five i menu, potem draft (Mini/All-Time), mecz na żywo i sezon.
  - Przykład: loteria (All-Time/Mini) — „Draw the lottery” jest pod bębnem i 16 numerami, trzeba
    przewinąć. Na telefonie: mniejszy bęben, ciaśniejsza winieta i tally, przycisk przyklejony na dole.
  - Przykład: draft (All-Time/Mini) — „Draft board” i „Team · 1/9” są na samym dole, pod całą listą
    graczy. Na telefonie: nad listą (pod nagłówkiem „On the clock”) albo jako przyklejony pasek.
- [x] Menu (telefon): wszystko na jednym ekranie bez przewijania — ciaśniejsza winieta, rzędy trybów,
      dailies i linki na dole.
- [x] Menu: pasek „Draft in progress” za ciasny — tekst łamie się na dwie linie, „Continue” wciśnięte
      obok; drużyna i postęp w jednej linii, „Continue →” z miejscem.
- [x] **Draw Five (telefon) — błąd:** przed „Draw” i w trakcie rozdania karty to cztery wąskie paski obok
      talii (siatka `.stage` = 4 kolumny + 220 px talii); po rozdaniu ręka jest 2×2. Na telefonie:
      talia z „Draw” na górze na całą szerokość, pod nią miejsca na karty 2×2 w tym samym rozmiarze co
      ręka, karty lecą w te miejsca. Przy okazji: „picks next” w rzędzie AI łamie się na trzy linie.
      Zasada: zero przeskoków — od „Draw” przez rozdanie, wybór i turę AI karty stoją w tych samych
      miejscach i rozmiarach. Na PC to samo: dziś talia (220 px) znika po rozdaniu i karty się
      rozszerzają, więc też skacze; sprawdzić nagraniem klatek na 1366 i 390.
- [x] **Wyjście do menu (wszędzie, telefon + PC):** dziś to mały link „← Menu” w różnych miejscach,
      a na telefonie po meczu w ogóle go nie widać (tylko How to play · Settings). Jedno stałe
      miejsce na każdym ekranie: lewy górny róg nad winietą („← Menu”) albo klikalna winieta trybu;
      w trakcie draftu/meczu pytanie „Wyjść? Postęp zostaje zapisany”.
      Propozycja użytkownika (telefon): „← Menu · How to play · Settings” w pustym miejscu po prawej
      od nazwy trybu (wiersz winiety), zamiast osobnej linii pod tally — oszczędza wysokość ekranu.
      **Błąd (telefon):** koniec sezonu (The playoffs po finale) nie ma żadnego wyjścia — New draft,
      Main menu i Back to the results są tylko w aside, który na telefonie jest ukryty. Na telefonie
      te przyciski pod treścią (jak „Play the season” w wynikach). Sprawdzić każdy ekran końcowy
      (wyniki Draw Five/Mini/All-Time, finał sezonu, play-in) pod kątem wyjścia na telefonie.
      Przy okazji „Your path”: notka („through”, „upset of the 2nd seed”) w osobnej linii pod rzędem
      i strzałka nad wynikiem — na telefonie jeden zwarty wiersz.
- [x] Draw Five, koniec meczu (telefon): „See the result” i „Watch again” sklejone — odstęp między
      przyciskami (wspólna zasada dla wszystkich stosów przycisków).
- [x] Draw Five, wyniki (telefon): w mini-kartach piątki długie nazwisko się ucina
      („V. Wembanyama”) — mniejsza czcionka albo zawijanie do dwóch linii, nigdy ucięte.
- [ ] Draw Five: tempo nadal do dopracowania (niski priorytet) — rozdanie, „myśli”, wybór AI.

**Dopisane 2026-10-22 (po grupie B)**
- [x] **Loteria → dwa przyciski:** „Start the draft” i „Study the board” (nazwa robocza). Drugi
      otwiera listę graczy przed draftem: przeglądanie, filtry, gwiazdka na Big Board (wishlista),
      bez wybierania; powrót do „Start the draft”. Big Board z tego kroku przechodzi do draftu.
- [ ] **Hunting — przebudowa mechaniki — PO LAUNCHU (Eryk 2026-10-28: obecną wyrzucić, przebudowa po launchu).** Obecna nie działa tak, jak powinna.
      Użytkownik opisze, jak to wygląda w rzeczywistości; pytania od Claude'a: kto wybiera cel
      (rozgrywający w PnR czy izolacja), jak ofensywa wciąga słabego obrońcę do akcji (zasłona
      gracza, którego kryje, ghost screen, re-screen), jak broni się obrona (switch / drop / hedge /
      blitz, scram switch, podwojenie, chowanie słabego na najsłabszym strzelcu, strefa), ile to
      kosztuje atak (zegar, przewidywalność, mniej ruchu), kto potrafi huntować (izolacja, PnR),
      różnica sezon vs play-offy, przykłady serii (np. Rockets 2018 na Curry'ego) i źródła danych
      (NBA.com matchups od 2017-18, Synergy ISO/PnR PPP).
- [ ] **Transmisja meczu żywsza (silnik + teksty) — na później (Eryk 2026-10-28).** Dziś relacja jest sztywna. Brakuje:
  - a) **Signature moves gwiazd:** „Dirk one-legged fadeaway from 14 ft over the defender's
       hand”. Z play-by-play NBA (od 1996-97) da się wyciągnąć typ rzutu (fadeaway, turnaround,
       step-back, pull-up, driving layup, hook, alley-oop, putback), odległość i udział każdego
       typu dla gracza w sezonie → tendencje per span. Przed 1996 bez pbp: krótka ręczna lista
       ruchów legend (skyhook Kareema, Dream Shake Hakeema, baby hook Magica, fadeaway Jordana).
  - b) **Momenty z emocją:** and-one („tough bucket at the rim — AND ONE!”), blok + kontra,
       wsad nad kimś, seria, trójka na prowadzenie, rzut z faulem w końcówce. And-one i rzuty
       z faulem też policzalne z pbp (trafienie + faul przy rzucie + 1 wolny).
  - c) **Reakcja na zegar:** szybki punkt w kontrze („early bucket in transition”, czas od zmiany
       posiadania), trudny rzut z końcówki 24 s („beats the shot clock with a tough fadeaway”),
       buzzer-beater na koniec kwarty, końcówka meczu. Z pbp: udział gracza w kontrze i w późnym
       zegarze.
  - d) **Nawiązania do rzeczywistości:** zagrania wyciągnięte z pbp (ulubione strefy, ulubiony
       podający, typowe zakończenia), opisane tak, żeby pasowały do tej ligi, nie do dat.
  - Źródło: play-by-play (shufinskiy/nba_data, już używane do Warriors 2014–25). Najpierw sprawdzić
    pokrycie typów rzutów po sezonach, potem plik tendencji per span w `src/data/`.

## Kolejność prac (decyzja 2026-10-10, zastąpiona planem 4 tygodni)

**Decyzja 2026-10-15 (wieczór):** intro All-Time Draft i kalibracja siły AI — na sam koniec;
eksperci z imionami — zrobione w osobnym czacie (stan 2026-10-16); dopracowanie w tygodniu 3.

### Playtest meczu na żywo 2026-10-15 (wieczór) — ZROBIONE (PR #230, #231)

1. „Game 2” mało widoczne — duży przycisk następnego meczu pod wynikiem końcowym i na dole arkusza;
   na telefonie środek tablicy w osobnym rzędzie.
2. Intro przed meczem — wynik poprzedniego meczu i stan serii (w meczu 1 runda i rozstawienie),
   obie piątki PG–C, przycisk „Tip-off”.
3. Same pozytywy w relacji — pudła (kto zebrał) i straty, cichszym wierszem (`GamePlay.minor`;
   bez nowych losowań, wyniki meczów bez zmian).
4. Klik poza oknem zamykał symulację — już nie; Esc wychodzi z meczu do drabinki.
5. 3P% dobrych strzelców za niskie — rzuty pod koniec zegara liczone podwójnie (PR #230);
   strzelcy z draftu −1,45 → ~−0,5 pkt proc. względem własnych; 3PA w podstawowych kolumnach,
   3P% przy < 1 próbie na mecz przygaszone.
6. „Bardziej komentowany mecz” — komentator (`src/engine/gameCalls.ts`): 30/40/50 pkt (20 tylko w
   1. połowie), double/triple-double, serie trafień i pudeł, „ostatnie 9 pkt drużyny”, susze,
   największe prowadzenie, odrobione 10+, ostatnie 2 minuty, skuteczność do przerwy; ~1 linia na
   9 zagrań, max 2 po jednym zagraniu. Zagrania w kilku wersjach słownych. Test
   `scripts/testGameCalls.ts`.
7. Klik w zawodnika w box score — otwiera jego kartę ze statystykami sezonu.

Pomysły na dalej (niezamówione): linie po kwartach bogatsze niż „kto wygrał kwartę + najlepszy
strzelec”; komentarz do Daily (dziś te same linie, strona „You”).

### Playtest 2026-10-15 (spisane — zrobione poza intro)

Numeracja użytkownika (11 nie było). **Zrobione 2026-10-15:** Simcast 7, 8, 10 (PR #222); draft 2, 3, 4
(PR #223); wyniki i sezon 5, 6, 9, 13 (PR #224). **Otwarte: 1 (intro).**

**All-Time Draft**
1. Za dużo się dzieje na starcie — krótkie intro „co gdzie i jak” przy pierwszym wejściu: tablica,
   lista graczy, Big Board, zakładka Team, capy (np. 4–5 kroków z podświetleniem, do pominięcia,
   tylko raz; do ponownego otwarcia z „?”).
2. Filtr FGA (capów) w liście graczy — pole „Max caps”, w które można wpisać np. 10, i lista pokazuje
   tylko graczy za tyle lub mniej (dziś tylko „Affordable” i „Cheapest first”; zakres min–max jest
   tylko w trybie deweloperskim). Do tego sortowanie po capach w obie strony.
3. Przełącznik Draft / Team prawie niewidoczny (mały, w rogu obok „?” i „Hide board”) — większe
   zakładki pod tytułem, przy Team licznik np. „Team · 5/9”.
4. Zakładka Team na szerokim ekranie: dużo martwego pola — szeroka dziura między nazwiskiem a „Tier”
   w tabeli składu, pusto pod składem (rotacja po prawej dużo dłuższa). Zwęzić kolumnę gracza,
   oddać miejsce rotacji / układ pół na pół / pod składem coś użytecznego (ławka, oceny drużyny).

**Wyniki, sezon, playoffy**
5. Draft jest na całą szerokość, a podsumowanie po drafcie i okno sezonu nie (sezon max ~1080 px,
   wyniki jeszcze węższe) — te same szerokości co draft.
6. Sezon/playoffy to okno nałożone na wyniki — w tle prześwitują paski ocen, analityk, „What's behind
   each score”. Sezon jako osobny, pełny ekran z nieprzezroczystym tłem.
9. Brak „Share” po sezonie — karta z bilansem, rozstawieniem, wynikiem w playoffach i składem
   (dziś da się udostępnić tylko wynik draftu).
13. Karta „Share” po drafcie dalej „bez jajca” — wygląda jak tabelka z raportu. Propozycja: duże logo
    i nazwa w barwach drużyny, hasło stylu jako tytuł, twarze piątki w rzędzie, miejsce jak trofeum,
    mniej pasków. Projektować razem z punktem 9 (najpierw makieta).

**Mecz na żywo (Simcast)**
7. Wolniejsze tempa: ×½, ×¼, ×⅛ obok ×1, ×2, ×4 (żeby spokojnie czytać relację).
8. W relacji statystyki gracza w meczu w nawiasie, np. „Bryant mid-range jumper (12 pts, 5/12 FG)”;
   przy asyście np. „(Billups 4 ast)”.
10. Zakładka „Match-ups” („X attacked by Y ×2”) nic nie wnosi — usunąć (to, co ważne, czyli
    „They're hunting X” przy 3+ atakach, i tak jest w relacji).

**Pytanie z playtestu (odpowiedziane)**
12. Czy drużyny mają drugi kolor, gdy barwy są podobne? — Tak: `matchupHues` (`teamLogoKit.ts`);
    przy różnicy odcienia < 40° druga drużyna bierze kolejny kolor z logo, a gdy żaden nie pasuje —
    barwę przeciwną.

### Playtest 2026-10-14 (spisane, do zrobienia — użytkownik: „spisuj, nic nie rób”)

Numeracja użytkownika. **Paczka 1 (draft + rotacja) — zrobiona 2026-10-14 (PR #216):** 1–7, 9.
**Paczka 2 (sezon) — zrobiona 2026-10-14:** 8, 12, 13, zapowiedź serii, Watch again ↔ Next game,
podsumowanie po sezonie, faule (PF w statystykach, „fouls out” w relacji), Team po drafcie.
10 — zrobione 2026-10-14: przyczyną była zmiana lat gracza (cała rotacja budowana od nowa); teraz
rotacja zostaje, gracz przechodzi na nowe lata z tymi samymi minutami.
Układ playoffów — zrobiony 2026-10-14 (makieta A „centrum serii”: pasek rund, duża karta serii z
następnym meczem, zapowiedź + kluczowi gracze, mała drabinka; na telefonie przycisk meczu przyklejony
do dołu i zakładki Matchup/Bracket).
11 — przeniesione do punktu 3 (Silnik symulacji) niżej.

**Draft**
1. Brak „usuń / kosz” w drafcie (np. zdjęcie gracza z Big Boardu / z rotacji — do doprecyzowania).
2. Filtr roli zostaje po zmianie pozycji: rola wybrana przy SG (np. Perimeter D) zostaje po
   przełączeniu na C, gdzie nie ma sensu. Przy dodaniu PG i SF działa dobrze. Pomysł: przy zmianie
   pozycji czyścić role, których nowa pozycja nie ma.
3. Strzałki kierunku draftu (wąż): są tylko po lewej stronie — wygląda, jakby pierwsza drużyna
   zawsze miała pierwszy wybór w rundzie. Pokazać kierunek każdej rundy (← / →).
4. Słabo widać, że można zmienić lata (span) — mocniejszy wyróżnik.
5. Rotacja: kliknięcie w pasek gracza powinno wystarczyć (bez celowania w strzałkę).
6. Wybór gracza w rotacji pokazuje natywną listę systemu (`<select>` w `RotationBuilder.tsx`,
   „-- starter --”, „⚠ … (out of position)”) — zrobić własny wybór w stylu gry (twarz, pozycja,
   oznaczenie poza pozycją).
7. Podgląd capów (ile zostało) widoczny cały czas podczas przeglądania graczy.
9. Po odznaczeniu jedynej zaznaczonej pozycji — wracać do „wszystkich”.
10. „Wycofało mi rotację po wyborze gracza” — nie udało się odtworzyć (desktop i telefon,
    rotacja ustawiona po 2 wyborach przetrwała kolejne 4). Dopytać: czy chodzi o wybór w drafcie,
    czy o wybór gracza w liście rotacji; który tryb (All-Time / Mini); który wybór (np. 9.).

**Sezon / playoffy**
8. Sortowanie po FGA w statystykach sezonu (zrobione w stashu: FGA w podstawowych kolumnach,
   3PA i FTA w „More stats”).
12. Klik w nazwisko w sezonie → karta gracza: kim jest, span, kiedy wybrany w drafcie, statystyki
    sezonu (i playoffów).
13. Dało się wyjść z sezonu i trzeba było robić wszystko od nowa — albo zapis, albo brak wyjścia.
    Do tego: automatycznie przewijać na górę (przy przejściach w sezonie).
- Najpierw zapowiedź serii, potem drabinka (zrobione w stashu).
- „Watch again” zamienić miejscem z „Next game” (zrobione w stashu: następny mecz w górnym pasku
  Simcastu, „Watch again” pod spodem).
- Ogólnie: rozmieszczenie elementów w playoffach mało intuicyjne — do przemyślenia (makiety?).
- Po sezonie brakuje podsumowania: skład + wynik (bilans, rozstawienie, wynik w playoffach,
  skład ze statystykami).

**Dopisane później tego dnia**
- „Dlaczego Nash zagrał 29 minut przy ustawionych 39?” — zmierzone: każda różnica ≥ 8 min w 48
  meczach to 6 fauli (wylot); relacja tego nie mówiła. Zrobione: linie „5th foul” / „fouls out” w
  relacji, „Fouled out” w box score, PF w statystykach sezonu.
- Po skończonym drafcie przejście do zakładki Team (zrobione: samo się przełącza + baner na Draft).
- „Caps nachodzą na Change years” (zrobione: koszt tylko w kolumnie Caps, na telefonie „Change”).


1. **UI** — zakres do ustalenia na starcie (kandydaci: ton wyniku według miejsca w Mini/All-Time,
   karta na ekranach wyników Draw Five, stół Draw Five, animacja lotu karty, linia Scouta dla
   graczy Hustle, porządki po playteście).
   - **Nowy widok draftu (makiety zaakceptowane 2026-10-14)** — board z komórkami twarz/pozycja/
     nazwisko, pas „Before you pick again”, przełączniki pozycji, Big Board zamiast kolejki, bez
     Hustle w widoku; zakładka Team (skład z latami + rotacja paskami minut), wybór lat jako sheet.
     Makiety: https://claude.ai/artifact/1gRcJSpbdTv2oqzmnyUjQW. Plan: 6 PR-ów (board → szkielet →
     lista graczy → Big Board → Team → dopasowanie reszty).
   - **Koła ratunkowe (lifelines)** — Draft Desk i ostrzeżenie o rim pressure przestają być darmowe
     i wracają jako lifelines, razem z War Room / Chalk Talk / League Sources (osobny etap).
   - **Widok symulacji meczu w stylu „MyLEAGUE Simcast” (NBA 2K)** — pomysł użytkownika
     2026-10-14: wynik z logami drużyn, kwarta i zegar, boisko w barwach drużyn, wynik po kwartach,
     zakładki Box score / Porównanie drużyn / Match-upy — ale z **relacją na żywo** (play-by-play)
     jako głównym elementem. Dziś mecz na żywo to `src/components/LiveGame.tsx` (tablica, szansa
     wygranej, kwarty, play-by-play, box score) — przebudowa wyglądu, nie nowy silnik.
     Makiety (2026-10-14, prawdziwy mecz z silnika): sekcja „Simcast” na
     https://claude.ai/artifact/1gRcJSpbdTv2oqzmnyUjQW — użytkownik: „wygląda spoko, tylko ważne
     żeby wyważyć czas trwania”. **Tempo** (dziś ~45 s/mecz przy ×1, ~200 akcji, ~0,2 s na akcję —
     relacji nie da się czytać): Q1–Q3 ~12 s na kwartę, w relacji tylko punkty i ważne akcje (reszta
     w zakładce); przerwa po kwarcie 2–3 s z jednym zdaniem; Q4 ~18 s; końcówka na styku (≤2 min,
     ≤8 pkt) ~1 s na akcję, pełna relacja; przy wysokim prowadzeniu samo przyspiesza. Cel: ~55–60 s
     mecz jednostronny, ~80–90 s wyrównany; ×2/×4 proporcjonalnie. W playoffach przy każdym meczu
     „Watch” (całość) i „Key moments” (od połowy Q4, ~20–25 s). Liczby do dostrojenia po graniu.
     **Zrobione 2026-10-14** (`LiveGame.tsx` + `LiveGame.css`): tablica, relacja z twarzami, zakładki
     Box score / Team stats / Match-ups, boisko z ostatnim rzutem, kwarty, „hunting”, liderzy;
     ×1/×2/×4, „Key moments”, przerwy z jednym zdaniem. Zmierzone na 24 meczach: jednostronny
     53–58 s, wyrównany 64–73 s (Q4 22–31 s) — dalsze strojenie po graniu.
   - **Stałe drużyny zamiast losowych (2026-10-14)** — jak największa pula drużyn stworzonych z góry
     (użytkownik: „więcej drużyn, o ile to możliwe”; cel ~40+): nazwa, miasto, własne logo (SVG),
     barwy, poziom (siła AI) i styl GM-a (np. obrona, strzelcy, gwiazdy — podpięte pod istniejące
     profile AI z `aiProfileForSlot`). W drafcie losujemy 15 z puli. **Poziomu ani stylu nie
     pokazujemy graczowi** (decyzja użytkownika). Dziś: `randomTeamNames` w `src/engine/teamNames.ts`.
     **Logo: wariant A (decyzja 2026-10-14)** — system składany zamiast ręcznych maskotek: kształt
     herbu (8) + wzór tła (8) + symbol + 4 barwy, wszystko jako SVG z kodu (cała pula ok. 30 KB, 11 KB po kompresji).
     Symbol pokazuje nazwę (użytkownik: „jak jest Chickens czy Coyotes, to powinno wskazywać na
     to”): 33 płaskie, geometryczne maskotki (kogut, kojot, łoś, sowa…) + 31 symboli ogólnych.
     Makieta 46 drużyn: https://claude.ai/artifact/WG8h8n743G2VNTScyaksV6. Plan: (1) akceptacja
     nazw i barw, (2) PR: katalog + `<TeamLogo>` zamiast `TeamMark`/`.sc-mark`/hasha koloru,
     losowanie 15 z puli z ziarna draftu (naprawia nazwy przy `?draftSeed=` i w pojedynkach),
     opcjonalne `franchiseId` w `Team` (stare zapisy bez zmian), oba `createInitialTeams`
     (All-Time i Mini); sprawdzenie każdej nazwy pod kątem prawdziwych drużyn (dziś losowanie może
     dać np. Charlotte Hornets czy Memphis Grizzlies), (3) PR: styl GM-a przypięty do franczyzy,
     (4) osobno: poziom siły AI — zadanie „Kalibracja siły AI” w punkcie 2 kolejności prac. Twoja drużyna: wybór z
     puli z ponownym losowaniem; nazwy zostają (decyzje użytkownika 2026-10-14).
     **Krok 2 zrobiony (2026-10-14):** `src/data/franchises.ts` (46 drużyn), `teamLogoKit.ts` +
     `TeamLogo.tsx`; logo w menu (karta z kostką zamiast pola tekstowego), loterii, tablicy draftu,
     wynikach, tabeli i drabince sezonu, tablicy meczu (barwy drużyn, przy zderzeniu kolorów druga
     drużyna bierze drugi kolor). Rywale z ziarna draftu; ta sama seed = te same drużyny na tych samych
     miejscach (inna własna drużyna zmienia najwyżej 2 miejsca). Stare zapisy: dawne nazwy dostają
     stary znaczek z kodem. Sprawdzenie nazw: Honolulu Sharks (baseball zimowy 1993–2008) i Portland
     Lumberjacks (liga bowlingowa PBA) istniały — zmienione na Honolulu Tiger Sharks i Portland
     Flannels (użytkownik: „zmień to Sharks i Lumberjacks”). Test: `scripts/testFranchises.ts`.
     **Krok 3 zrobiony (2026-10-14):** styl GM-a przypięty do franczyzy (`draft.ts`
     `aiProfileForTeam`), siła gustu dalej losowana per draft; dawne nazwy — losowanie z ziarna.
     Przy okazji: drabinka playoffów rozjechana od #212 (wspólna klasa `pl-row` z listą graczy).
   - **Eksperci z imionami zamiast „The Coach / The Analyst / The Scout” (2026-10-14) — ZROBIONE w osobnym czacie (2026-10-16); dopracowanie w tygodniu 3** — fikcyjne
     postacie (decyzja: fake names) o wyrazistych archetypach: głośny były gracz („w moich
     czasach…”), trener od obrony, analityk od liczb, stary skaut — każdy z imieniem, nazwiskiem i
     stałym sposobem mówienia. Bez kopiowania prawdziwych osób. Dotyczy Draft Desk (wraca jako
     lifeline) i linii trenera na wynikach.
     **Obsada (użytkownik, 2026-10-14), 12 ekspertów:** Mattia Sosini (nowoczesna koszykówka, nie
     lubi starszej daty), Matt Shyman (obrona), Davyd Solinhakov (twarda koszykówka lat 2000), Jacob
     Binash (lata 80.), Mattheus Jertcheck (wszystko sprzed 2000), Mark Rotation (krótkie ławki),
     Micheal Rightwing (rywal Moonbata: wchodzi razem z nim i prostuje go zdrowym rozsądkiem, bez
     liczb; decyzja użytkownika — bez wątku niskich obrońców), Filippo Batterista (składy two-way), Mikhail
     Prabuckov (fan Kobe), Jake Onoffsky (statystyk; było Jake Bentaylor), Bart Moonbat (głupie,
     pewne siebie opinie — dżoker, nigdy sam; ok. 70% bredzi i ktoś go prostuje, ok. 30% przypadkiem
     ma rację, z głupiego powodu, i ktoś się wtrąca i go broni — decyzja użytkownika „30/70”; racja
     tylko wtedy, gdy silnik naprawdę ocenia ten ruch dobrze, żeby nie wprowadzał w błąd), Igor Bannerman (fan Celtics;
     było Igor Simmons). Dołączyli (2026-10-14): prowadzący **Eric B. Slim** (otwiera, ucisza
     kłótnie, zamyka werdyktem — zastępuje anonimowe „Desk consensus”), **Natalie Novacka** (kapolog:
     cap gracza wobec oceny, okazje i przepłaty), **Jeremy May** (lata 90. i Jordan, rywal
     Prabuckova), **Lex Superteam** (tylko gwiazdy, rywal Rotation i Novackiej), **Zoran Eurostep**
     (gracze spoza USA, rywal Sosiniego). Pesymista od kontuzji (DUR) — na razie nie.
     **Gusta ekspertów (2026-10-15, lista użytkownika):** ulubieni i znienawidzeni gracze każdego eksperta
     oraz drużyny (Rotation: Utah/Lakers, Binash: Lakers, Natalie i Rightwing: Houston) są w
     `src/engine/deskTastes.ts`; zachwyt albo „trash talk” odpowiada ktoś, kto czuje odwrotnie. Davyd: oko
     i finezja z półdystansu; Shyman: krótkie zdania, chłopski rozum; Jertcheck: przekorny, „Look it up”;
     Onoffsky ufa tylko erze play-by-play. Bez wyzwisk homofobicznych.
     Głosy (tiki, sposób argumentowania) inspirowane archiwum ligowego Discorda za zgodą graczy;
     archiwum nie trafia do repozytorium, w kodzie i makiecie są tylko fikcyjne postacie. Na antenie
     3–5 ekspertów + prowadzący; kolejność: wyniki → Draft Desk → wtrącenia (decyzja 2026-10-14). Nazwiska Jake'a i Igora zmienione, bo wskazywały prawdziwe osoby (Ben
     Taylor, Bill Simmons). Makieta: https://claude.ai/artifact/NJFXtxXxKQgtybQPJBbXrc.
     **Pomysł:** zmienny panel jak w studiu — każdy ekspert ma „obiektyw” (ocena składu od −1 do +1
     z jego punktu widzenia + nazwiska jako dowód), na antenę wchodzą 3–5 najsilniejszych opinii (co
     najmniej jedna na plus i jedna na minus), rywale wchodzą parą i sobie odpowiadają (Sosini ↔
     Jertcheck/Binash, Bannerman ↔ Prabuckov, Moonbat ↔ Rightwing (zawsze razem) i Onoffsky
     (liczby). Moonbat co ok. 4. raz. Panel z
     ziarna draftu. Kolejność: (1) ekran wyników Mini/All-Time zamiast Coach/Analyst/Scout
     (`voicesFor`, `QuickFive.tsx`), (2) Draft Desk (`engine/draftDesk.ts`), (3) wtrącenia w pasku w
     trakcie draftu przy wyrazistych momentach (Kobe u kogokolwiek, gracz sprzed 1980, Celtic, niski
     rozgrywający w piątce — komentuje Shyman). Liczby Onoffsky'ego zawsze z danych gracza. Otwarte: liczba ekspertów na
     antenie, częstotliwość Moonbata, kolejność kroków.
   - **Oceny bez kontekstu (2026-10-14)** — Wilt i Oscar mają F w spacingu, bo grali przed linią za 3;
     sama litera tego nie mówi. Pokazać „—” z podpowiedzią „No 3-point line in his era” zamiast F
     dla stretchy sprzed 1979-80. Do tego **podpowiedź przy każdej literce** (użytkownik: „żeby była
     podpowiedź co znaczy dana literka”): po najechaniu / dotknięciu — co mierzy ocena (OFF, DEF,
     3PT, DUR…) i co znaczy dana litera w tej skali. Robimy w PR 6 (dopasowanie reszty). Docelowo
     spacing ery przed linią za 3 w kalibracji V2 (punkt 2).
2. **Kalibracja silnika V2 — „dziady” i Hustle**: gracze dawnych er (spacing F u strzelców sprzed
   linii za 3 — West, Maravich, Barry; D-TAL sprzed 1973-74 bez przechwytów i bloków; X. McDaniel
   D-TAL 22; półdystans i rim pressure sprzed 1997; przegląd starych resztek kalibracji z Etapu 1),
   dopracowanie Hustle, odpowiednik Hustle w ataku, MVP z bilansem do kwadratu, rotacja Filipa
   (KG na trzech pozycjach).
   - **LeBron — ręczna kolejność stretchy (2026-10-14) — zrobione 2026-10-15**: domyślny span i
     najwyższy TAL to 2012-14 (105), potem 2011-13 (104), 2016-18 (103), 2014-16 (102), 2008-10 (101);
     reszta jego okien zostaje przy swoich liczbach, ale najwyżej 100 (2007-09, 2009-11, 2010-12:
     102 → 100). Mechanizm ogólny: `USER_WINDOW_ORDER` w `src/data/userTierCalibration.ts`, test
     `scripts/testWindowOrder.ts`. Baseline picków AI przeliczony (pick #1 ten sam gracz, inny span).
   - [ ] **Kalibracja siły AI — ukryty poziom franczyzy (na koniec; 2026-10-14, użytkownik: „kalibracja siły
     AI do todo”)** — ostatni krok stałych drużyn. Dziś wszystkie drużyny AI draftują tym samym
     algorytmem i różnią się tylko stylem (przypięty do franczyzy, `draft.ts` `aiProfileForTeam`)
     i losową siłą gustu. Do zrobienia: (1) pole `level` w `src/data/franchises.ts` (np. 3–4
     poziomy, ukryte jak styl); (2) wybór dźwigni — kandydaci: szum tablicy (`aiDrafter.ts`
     `BOARD_NOISE_POINTS` 8, `BOARD_NOISE_TEAM_POINTS`), wyłączony lub krótszy lookahead u słabszych,
     rzadsze sięganie po „steal”; najpierw pomiar, która dźwignia daje rozrzut bez dziwnych składów;
     (3) pomiar przed/po na tych samych ligach: `npx tsx scripts/calibrationReport.ts` (8+ seedów;
     punkt odniesienia 2026-10-14: średnia drużyna AI 80,4, sd 2,8, min 73, max 87), szanse na
     tytuł najlepszej drużyny (cel z TODO: ~25–35%), miejsce gracza w Mini/All-Time przy
     typowym drafcie; (4) losowanie 15 z puli pilnuje, żeby nie trafiło samych silnych lub samych
     słabych; (5) testy z progami na próbce draftów AI (`testInsightsSlow`, `testDefenseDistribution`,
     `calibrationReference`) przeliczyć i opisać zmiany jak przy 2026-10-14. Poziomu nie
     pokazujemy graczowi (decyzja użytkownika). (M)
3. **Silnik symulacji** — etap 4b (atak ~66%, rotacja ~34% w meczu), rzuty wolne w ocenie, mecz
   na żywo mocniej na silniku, etap 2b, tempo meczu, kalendarz, balans po symulacjach.
   - **Punkt 11 z playtestu 2026-10-14 (Kirilenko obok Curry'ego) — zamknięty 2026-10-15, to nie
     błąd.** Play-by-play Warriors 2014–25 (shufinskiy/nba_data, piątki odtworzone ze zmian):
     Draymond podaje tyle samo z Currym i bez (11,8 vs 10,8 asysty /100 posiadań, ten sam udział w
     trafieniach kolegów i te same straty; bez Curry'ego w 2019-20 też 8,0 asysty /36). Curry
     zmienia jakość, nie liczbę: 39% asyst Draymonda idzie do Curry'ego, 89% jego asyst to rzut
     spod kosza lub za 3 (bez Curry'ego 78%, z samym Klayem 68%, z samym KD 58%). Draymond to
     własny „passing unicorn” (tylko on rozgrywa jak LeBron/Jokic bez rzucania). W grze Kirilenko
     obok Curry'ego ma najwięcej asyst ze wszystkich rozgrywających (3,1 vs 2,3–3,0) — to zgadza
     się z realnym +~10% u podającego. Skrypty i wyniki w scratchpadzie sesji (`irl/`, `pbp/`).
   - **„Podnosi kolegów” — zrobione 2026-10-15.** Ocena per gracz z realnych sezonów od 1985
     (`scripts/buildTeammateLift.ts`, pośrodku między zmierzonym a ściągniętym do średniej —
     decyzja użytkownika): Nash +1,4 TS, Jokic +1,3, Magic +1,3, Stockton +1,1, Curry +0,8, LeBron
     +0,3, Paul 0, Conley −0,2, Jordan −0,7. W meczu czwórka na boisku podnosi gracza o swoje oceny
     minus to, co dali mu jego prawdziwi koledzy (`LIFT_TUNING`, liga bez zmian). Ta sama czwórka
     obok rozgrywającego vs Conley: Nash +0,9 → +2,4, Stockton +0,1 → +1,5, Iverson −0,7 → +0,2
     (realnie +1,6, +1,3, +0,6). Rozkład kary za posiadania i korekty gwiazdy według rzutów —
     sprawdzony i odrzucony (Nash +0,9 → +0,4).
   - **„Podnosi kolegów” w prognozie silnika — zrobione 2026-10-15.** `matchup.ts` dodaje tę samą
     ocenę dla całej drużyny (minuty z rotacji, 1 pkt TS = ~1,96 pkt na mecz), więc dociąganie w
     meczu już jej nie zabiera. Ta sama czwórka: drużyna Nasha vs Conleya +0,3 → +1,4, Jordana
     +4,3 → +3,6; kształt skuteczności kolegów vs realnie (bez wspólnego przesunięcia) błąd 5,0 →
     2,1. TAL/O-TAL bez zmian (korelacja O-TAL z oceną 0,27, asyst 0,09 — to osobna cecha). Od PR #235 (2026-10-15)
     ocena jest w Overall drużyny (`scoreTeam`, 1/0,85 na punkt), więc znają ją wyniki draftu, AI
     (picki z ławki) i rozstawienie sezonu; AI bierze więcej „podnoszących” (+0,38 → +0,75).
   - **Daily: „równy” mecz — zrobione 2026-10-15.** Kontry w prognozie meczu (PR #228): −3,7 → −1,5
     średnio na 10 dni. Potem faule w prognozie: oczekiwane faule każdego obrońcy trip po tripie
     (na swoim, przy polowaniu na najsłabszym, część pod koszem na obrońcy obręczy, and-one), z nich
     szansa na kłopoty z faulami (`TROUBLE_SOFTEN`) i na bonus drużyny (rzuty wolne po faulu z dala
     od piłki): −1,5 → −0,7, średnio |dzień| 2,1 → 1,6. Reszta (~0,4) to inne mechaniki — granica
     zmierzona z wyłączonymi obiema.
   - **Era a rozegranie — zrobione 2026-10-15 (PR #227).** Asysty przeliczane percentylem w pozycji
     (tylko powyżej mediany, spadki tylko u obwodowych, Jokic poza dzisiejszą skalą — jedyny
     unicorn). Kirilenko 2004-06 4,2 → 5,4, Divac 3,6 → 4,8, Sabonis 2,8 → 4,0, Webber 5,0 → 6,0.

4. **Tryby** — Etap 3 niżej (Draw Five → Mini → All-Time → wspólne).

## Kolejność prac (decyzja 2026-10-08, zastąpiona)

1. Decyzje (zrobione: PR #192, druga połowa wag, free agents do osobnej sesji, tempo).
2. Domknięcie wyglądu: Draft Desk, konstruktor rotacji, wyniki Mini, ton wyniku według miejsca.
3. Mecz bliżej silnika (mecz oddaje ~56% talentu, ~50% ataku/obrony, ~30% rotacji).
4. Silnik podpięty pod symulację sezonu zasadniczego i opcjonalne mecze na żywo w play-offach;
   statystyki graczy, nagrody indywidualne (MVP, DPOY, 6MOY…), All-Star, All-NBA, All-Defensive.
5. Nowe mechaniki: koła ratunkowe + free agents (osobna sesja), tempo.
6. Treść na później (daily dla Mini/All-Time, stół i poziomy AI w Draw Five, typy zagrań i krycia).
7. Gotowość do wypuszczenia (playtesty, dane per tryb, flagi testowe).

## Punkt 3 — mecz bliżej silnika (decyzje 2026-10-08)

Cel ~85–90% różnicy z silnika (talent ≥80%, atak/obrona ≥75%, rotacja ≥60%); podbicie celności
zostaje, ale małe; gwiazdy mogą przebić realne linijki o maks. ~10%. Każdy etap: raport → akcept →
PR. Bezpieczniki: statystyki drużyn jak w NBA, realne linijki gwiazd, testy dwustronne.

Etap 0 (diagnoza, 2026-10-08) — mecz drużynowy ('season', 1,3 pkt na punkt oceny), 960 drużyn:
- Całość 66% (R² 0.50), talent 63%, atak 48%, obrona 57%, rotacja 32%, ławka 110%, składniki fitu
  ≥100%. Podbicie pokrywa średnio 2,9 pkt na mecz.
- Testy podmiany (120 drużyn): wymiana startera 41% (zmiennika 85%), na punkt O-TAL 39%, D-TAL 51%,
  „talent” (premia za gwiazdy) ~21%; gra poza pozycją 47%; +6 min starterom: silnik −1,5, mecz −7,8.
- Limity (kontekst, rozstawienie, modyfikatory, koszt usage, odporność gwiazd, pasma usage) NIE są
  przyczyną — ich wyłączenie nic nie zmienia.
- Przyczyny: mecz wycenia gracza z box score (skuteczność × wolumen), silnik z wpływu. Mecz przecenia
  skuteczność (+10 pkt % za 2 → +1,2 pkt/mecz ponad silnik), nie docenia rozgrywania (−0,45 na asystę),
  graczy sprzed 1980 (−1,0), PG (−2,1), gwiazd O-TAL 90+ (−1,0); brak premii za gwiazdę; efekt obrońcy
  o połowę słabszy; słaba kara za pozycję; zmęczenie w meczu ~5× mocniejsze niż w ocenie.

- [x] **Etap 1+2: kotwica** (2026-10-08) — piątka dostaje korektę skuteczności w stronę oceny silnika
      (atak: O-TAL, skuteczność za 2, punkty, zbiórki, rzuty za 3; obrona: D-TAL rywala), przechwyty
      i bloki ważą mniej. 960 drużyn: mecz oddaje 82% (było 66%), R² 0.63 (0.50), podbicie 2,3 pkt
      (2,9); obrona 92%, atak 68%, talent 69%. Liga bez zmian (121,9 pkt, TS 62,4). Era sprzed 1980:
      87,5% poprawki (było 75%; 100% dawało tylko +0,16 pkt).
- [x] **Etap 3: rotacja** (2026-10-08, zmergowany #197) — zmęczenie w meczu 30% wspólnej krzywej
      (42 min −3% zamiast −10,5%; solver minut bez zmian), kara za grę poza pozycją w ataku ×1,7 i
      nowa w obronie (rywal trafia łatwiej). Testy podmiany: zamiana pozycji 100% (było 48%), +6 min
      starterom 116% (397%); 320 drużyn: mecz oddaje 86%, R² 0.64, podbicie 2,25 pkt.
- [x] **Etap 4a: fit w meczu + dostrojenie kotwicy** (2026-10-08) — fit piątki na boisku (część
      ataku i obrony, jak w silniku) działa w meczu: słaby fit w ataku = mniej podań do rzutu
      (asysty), więcej akcji rozsypanych na koniec zegara, więcej strat; słaby fit w obronie =
      zgubione rotacje (rywal trafia łatwiej, mniej wymuszonych strat, łatwiej polować na najsłabszego).
      Kotwica słabsza dla O-TAL, zbiórek, rzutów za 3 i skuteczności za 2. 960 drużyn: mecz oddaje 91%
      (było 83%), R² 0.69 (0.65), podbicie 2,2 pkt; różnica do silnika nie zależy już od fitu (0.22 →
      0.01). Na 1 SD fitu ataku: +1,9 asysty, −0,75 straty na mecz. Liga bez zmian (121,8 pkt, TS 62,4).
      Chamberlain (−2,3 pkt względem silnika) i Shaq (do −3): to rzuty wolne — z FT 77% Chamberlain
      wraca prawie do silnika (−0,2); wysocy sprzed 1980 jako grupa nie są przesunięci (+0,2).
- [ ] **Etap 4b (może później)** — co jeszcze się rozjeżdża: ocena ataku w meczu ~66% (obrona ~100%),
      rotacja ~34%, zderzenie stylów ~0,5 pkt. Mały zysk za dużo pomiarów — najpierw symulacje.
- [ ] **Rzuty wolne w ocenie silnika (pomysł, do zrobienia później)** — mecz nagradza skuteczność z
      linii (+0,9 pkt/mecz na 1 SD, realistycznie), silnik jej nie liczy. Pomysł: w Offense dodać
      „punkty z linii ponad średnią” = ważone minutami (rzuty wolne na rzut z gry × (FT% − średnia
      ligi)) — gracz, który często staje na linii i trafia, podnosi atak; ten sam składnik osłabia
      zespoły z kiepskimi strzelcami z linii w końcówkach (celowe faule na nich, jak w meczu).
      Przykład (etap 4a): Chamberlain i Shaq tracą w meczu 2–3 pkt względem silnika głównie przez FT%.

## Skalowanie, gra bez piłki, opisy (2026-10-09)

- [x] **Scalability** (#203) — z realnych danych NBA (8217 par zmian usage): strzelec oddający piłkę
      +0,05, kreator −0,1, gracz roli biorący więcej −0,15; tłok −0,3 za każdego kolejnego gracza
      z usage ≥24%. W meczu `SCALE_TUNING` / `OVERLOAD_TUNING`, w ocenie `BALL_LOAD_TUNING` (sezon
      dociąga do oceny, więc koszt musi być też w ocenie).
- [x] **Litera spacingu z realnego 3P%** (#204) — od 1979 limit litery z celności, nie z wolumenu.
- [x] **Etykiety strzelców z realnego ruchu** (#205) — Movement / Off Screen / Stationary z danych
      NBA (OffScreen + Handoff), modelu i listy; Raja Bell → Stationary, Reaves zostaje Stationary.
- [x] **Paczka opisów** (#206) — 24 detektory usunięte (92 → 68): linie sprzeczne z sezonem 8,9% → 0%,
      sprzeczne albo bez efektu 15,5% → 0% (`scripts/validateDescriptions.ts`, 30 draftów / 480
      drużyn). Linie stylu od Scouta (ruch, rogi, cutterzy; lista 55 cutterów), warianty tekstów
      z liczbami, stałe role głosów, historia sezonu w hubie, zapowiedź i werdykt serii,
      „The season agreed / disagreed” na wynikach.
- [ ] **Wartość gry bez piłki (ruch, ścięcia) w ocenie** — WSTRZYMANE: w realnych drużynach
      2016–25 styl nie daje nic ponad talent. Wracać tylko z nowymi danymi. (M)
- [ ] **Strzelcy sprzed linii za 3 mają spacing F** — West, Maravich, Rick Barry: brak danych
      o trójkach → 36. percentyl. Pomysł: spacing z celności z półdystansu / FT% przed 1979-80
      albo neutralna litera. Do decyzji. (S–M)
- [ ] **7 linii ze słabym efektem (walidacja #206)** — ELITE_PRIMARY_CREATOR (na ekranie 199/480,
      najczęstszy), STAR_FGA_COST_HURTS_DEPTH, OFF_BALL_SUPPORT_STRONG, PERIMETER_DEFENSE_BENCH_DEPTH,
      DEAD_NINTH_SLOT_ACCEPTABLE, ELITE_SPACING_WEAK_CREATION, MULTIPLE_HIGH_USAGE_PLAYERS. Przy
      kolejnej rundzie opisów: wyższy próg, inne sformułowanie albo usunięcie; walidacja tym samym
      skryptem. (S)

## Wnioski z ligi D2S2 (Draft Kings, 2026-10-10)

Power Rankings + sezon na 82 mecze dla 15 składów z arkusza (strona-artefakt „D2S2 Power Rankings”,
skrypty w scratchpadzie sesji: arkusz → spany → rotacje → ranking, 20 000 sezonów, jeden sezon).

- [x] **MVP: bilans do kwadratu** (decyzja 2026-10-10; zrobione 2026-10-15 — 8 lig: miejsce drużyny MVP
      1,75 → 1,13, game score pod najlepszą linijką 1,4 → 2,9) — dawniej `mvpValue` w
      `liveSeason.ts` = game score × √(procent zwycięstw), przez co MVP wygrywa ktoś ze słabej
      drużyny (D2S2: Jokić z 9. miejsca, poza playoffami). Zmiana: × (procent zwycięstw)².
      20 sezonów lig AI: średnie miejsce drużyny MVP 2,25 → 1,15, spoza top 8 1 → 0, z drużyny
      nr 1–2 15 → 20 na 20; MVP ma średnio 2,3 game score mniej niż najlepsza linijka ligi (było
      1,0). Wariant liniowy dla porównania: 1,55 / 0 / 18 na 20 / 1,6. Jedna linijka + pełne testy. (S)
- [ ] **Gracze „od brudnej roboty” niedoceniani** (Eryk: Dillon Brooks — bierze najtrudniejsze
      krycie, hustle, „wkurzający” dla rywala). Silnik: Brooks 2024-26 D-TAL 63 („Wing Stopper”),
      bo D-TAL stoi głównie na przechwytach/blokach (0,9 / 0,2) i danych obrony NBA.com. Brakuje:
      trudności krycia (kogo kryje), deflections, contested shots, szarż, loose balls (NBA.com
      hustle od 2016-17; matchup difficulty np. BBall Index). Przed 2016 brak danych → lista jak
      przy cutterach. Najpierw sprawdzić na realnych drużynach, czy to coś daje ponad talent (jak
      styl gry: tam nie dało). Kandydaci: Brooks, Smart, Tony Allen, Beverley, Dort, Bowen, R. Bell. (M)
      Pierwszy ślad (2026-10-10): drużyny Brooksa grały ponad prognozę z box score (BPM) w każdym
      sezonie: MEM 2021 +1,7, 2022 +5,2, 2023 +0,7, HOU 2024 +5,4, 2025 +2,5 (średnio +3,1 pkt na
      mecz). Uwaga: młode, rosnące składy prognoza z zeszłego sezonu też zaniża — trzeba grupy
      kontrolnej. Eryk: Rockety po zamianie Brooksa na KD niewiele zyskały, Suns z nim zamiast
      tankować weszli do playoffów. Ręczne dopracowanie (lista/tier) dopuszczalne.
      Krok 1 (pomiar, 2026-10-10): lista 33 „hustle” obrońców (m.in. Brooks, Smart, T. Allen,
      Dort, Bowen, Rodman, Dumars, Laimbeer, Oakley, Mason, Cooper), 1051 drużyn 1981–2025.
      Drużyna gra ponad prognozę z BPM o +0,52 pkt na mecz na pełnoetatowego takiego gracza
      (t ≈ 2,0, z kontrolą wieku i udziału młodych); test placebo (losowe zestawy graczy roli o
      tym samym BPM): lepiej niż 86% zestawów. Względem prognozy silnika (O-TAL/D-TAL) +0,47
      (t ≈ 1,4) ≈ 10 pkt D-TAL dla takiego gracza. Pojedyncze wyniki szumią (Dort +5,0, Brooks
      +3,3, Smart +2,2 … Caruso −0,7, Tucker −1,7) → premia listowa (tiery), nie per gracz.
      Krok 2 (2026-10-10, lista zaakceptowana, + Ausar Thompson, Suggs, Eason): `hustleDefenders.ts`
      — 26 primary (+8 D-TAL) / 25 partial (+4), do sufitu 85 (wyżej nic), na końcu
      `computeDefensiveTalent` (TAL i tier bez zmian). Brooks 2024-26 63 → 71, Smart 64 → 72,
      McKey 67 → 75. Prognoza silnika na realnych drużynach: niedoszacowanie listy +0,47 → +0,36
      pkt na mecz (premia celowo ostrożna, R² bez zmian).
      Plakietka „Hustle” na zdjęciu gracza + filtr „Hustle” na boardzie (2026-10-10).
- [ ] **Hustle — dopracowanie** (2026-10-10, Eryk) — (1) lista: przegląd nazwisk i tierów (np.
      Rodman nisko przez TAL 44, X. McDaniel D-TAL 22 — sprawdzić dane obrony; Mahorna nie ma w
      puli); (2) siła: premia zamyka ~25% zmierzonej luki (+0,47 → +0,36) — rozważyć +10/+5 albo
      siłę per gracz tam, gdzie dane są pewne; (3) dane NBA.com hustle (deflections, contested
      shots, charges, loose balls; od 2016-17) zamiast samej listy dla nowszych graczy; (4) w
      opisach: linia Scouta o graczu Hustle („takes their best scorer every night”). (M)
- [ ] **Odpowiednik Hustle w ataku** (2026-10-10, Eryk) — gracze, których wartość w ataku box
      score pomija: stawiający zasłony (NBA.com screen assists od 2016-17), łącznicy / szybkie
      podanie (0.5-second decisions), zbierający w ataku, ruch bez piłki, „gravity”. Ta sama
      metoda: lista kandydatów → pomiar na realnych drużynach (czy grają ponad prognozę) →
      placebo → premia listowa do O-TAL + plakietka. Uwaga: styl gry (ruch, ścięcia) na poziomie
      drużyny nic nie dawał ponad talent — sprawdzać na graczach, nie na stylu. (M)
- [ ] **Rotacja Filipa: KG na trzech pozycjach** (u nas w lidze skład skończył ostatni, „może
      niesłusznie”). Silnik: rotacja z arkusza (KG 6 SF / 10 PF / 18 C, Cousins 30 na C, Malone
      34 na PF) kosztuje 2,5 pkt oceny względem auto (KG 36 PF, Malone 32 C) — obrona 54 vs 65;
      w PR 8. miejsce, w sezonie 5. Sprawdzić testami podmiany, czy silnik nie karze za słabo
      rozbijania wysokiego na trzy pozycje i gry Cousinsa jako startera na C. (S–M)
- [ ] **Narzędzie ligi do repo?** — import arkusza (składy + rotacje) → Power Rankings, sezon,
      playoffy, nagrody, statystyki. Dziś w scratchpadzie; przenieść do `scripts/`, jeśli liga
      będzie to robić co draft (15 drużyn: terminarz 6/5 meczów, własna drabinka top 8). (M)

## Etap 2. Symulacje

- [ ] **Mecz samych piątek: za dużo punktów (sprawdzić w kalibracji, tydzień 2–3)** — test
      2026-10-16 (Penny 1994-96, Klay 2015-17, Kawhi 2015-17, Kirilenko 2003-05, AD 2017-19, bez
      zmęczenia): przeciw losowym piątkom z całej puli 133–108 na 48 min (100–81 przy 4×9 min,
      wygrane 94,6%), przeciw losowym mocnym piątkom (TAL 80+) 94–90 przy 4×9 min, wygrane 64%.
      Ok. 133 pkt na 48 min to dużo jak na mecz bez ławki — tempo albo skuteczność w trybie piątek
      (Draw Five, daily) mogą być zawyżone. Porównać z ligą (`seasonBaselines`) i ze średnią w
      sezonie pełnych drużyn.
      - **Krótszy mecz piątek** (2026-10-22, user): 48 minut bez ławki nie ma sensu — skrócić
        mecz Draw Five (zwykły i daily) do **30 albo 36 minut** (4×7,5 / 4×9). Do decyzji po
        pomiarze: odsetek wygranych faworyta, średni wynik i rozrzut przy 30 vs 36 vs 48 (krótszy
        mecz = więcej przypadku), zmęczenie bez zmian; licznik czasu, kwarty, faule (bonus,
        limit fauli) i komentarz przeliczone na krótsze kwarty.
- [ ] **Asysty w sezonie idą po pozycji, nie po roli (kalibracja, tydzień 2–3)** — playtest
      2026-10-22, statystyki po sezonie vs karta gracza (prawdziwy okres): Jordan 1987-89 7.0 →
      3.0, Drexler 1987-89 5.8 → 2.9, Durant 2012-14 5.1 → 2.8, Kobe 2007-09 5.1 → 3.9, McGrady
      2001-03 5.4 → 4.1, Carter → 1.9; w drugą stronę Bird 1983-85 6.6 → 9.0. Kreatorzy na SG/SF
      tracą asysty, część SF/PF zyskuje. Do zbadania: komu mecz daje asystę przy trafieniu
      (liveGame), przeliczenie asyst ery według percentyla w pozycji (modernBox), rola Birda.
      Pomiar: 30 sezonów, średnie |sezon − karta| asyst per pozycja (to samo dla pkt i zb.),
      raport przed/po; bez zmian w silniku bez raportu.
- [ ] **Draw Five: gwiazda z pierwszego rozdania jako pułapka (kalibracja, tydzień 2–3)** —
      playtest 2026-10-22: w rozdaniu Doncic 2024-26 (21.8 capów) — „99% graczy weźmie go
      pierwszym pickiem i jest skazanych na porażkę”; najlepsza piątka planszy bierze na PG
      Blaylocka 1994-96 (14.4), a różnica capów idzie w Barkleya 1989-91 (16.1) zamiast Outlawa
      (4.4). Gra karze oczywisty wybór, a nie zły. Do zbadania: (a) czy silnik nie zaniża
      wartości drogich gwiazd względem capów (cena = rzuty na mecz — Doncic dużo rzuca, więc
      drogi, a ocena za mało za niego daje); (b) jak liczona jest „najlepsza piątka” (pełne
      przeszukanie vs heurystyka) i jak często najlepsza piątka zawiera najdroższą kartę rozdania;
      (c) generator rozdań — czy nie daje gwiazdy, której nie da się „obudować”. Pomiar: 500
      plansz, odsetek najlepszych piątek z najdroższą kartą, średnia strata piątki z najdroższą
      kartą vs najlepsza; cel: gwiazda ma być dobrym wyborem, jeśli dobierzesz resztę z głową.

Decyzje (2026-09-30):
- Sezon zasadniczy szybki (bez odtwarzania meczów); dokładna symulacja dopiero w play-offach.
- Zderzenie stylów drużyn (rim pressure vs ochrona obręczy, spacing vs obwód/switch, gwiazda 1-na-1
  vs najlepszy obrońca, zbiórka/warunki) waży **więcej** — zestawienia mają realnie mieszać
  w play-offach, ocena ogólna zostaje podstawą.
- Kontuzje: **nie**.
- Statystyki graczy z sezonu i nagrody (MVP, DPOY, 6MOY): tak, ale później.
- Mecz na żywo: poziom szczegółu do wyboru przez użytkownika (sam wynik i statystyki meczu albo
  przebieg akcja po akcji).
- Kalibracja losowości na NBA: najlepsza drużyna ~25–35% na tytuł (więcej, gdy wyraźnie odskoczy).
  Faworyt serii zależnie od różnicy oceny (2026-10-02 — w lidze AI czołowa ósemka mieści się w 3–4
  pkt, więc sztywne 75–85% nie ma sensu): przy 1–2 pkt ~55–65%, przy 4+ pkt ~75–85%.

- [ ] **Mecz na żywo mocniej na silniku** — dziś box score jest wyrównywany i przechylany marginesem
      modelu (`liveGame.ts`, `TILT_PER_POINT`); docelowo przebieg meczu z ofensywy/obrony, fitu,
      rotacji i słabości drużyn (kto kogo kryje, kto rzuca w clutchu). Wspólny dla Draw Five i daily.
      (L)
- [x] **Symulacja sezonu i playoffów w draftach** (2026-10-02) — w lidze 1 pkt oceny = 1,3 pkt
      przewagi (było 1,0: sezony 41–41, najlepsza ~50 W); nowa warstwa zderzenia stylów (atak pod
      kosz vs ochrona obręczy, spacing vs obwód/switch, gwiazda vs najlepszy obrońca, zbiórka) —
      połowa w sezonie, całość w playoffach i szansach na tytuł; mecz na żywo bez zmian. Wynik na
      4 ligach AI: najlepsza 53–57 W, najsłabsza 20–33 W; faworyt <1 pkt 54%, 1–2 pkt 64%, 2–4 pkt
      70%, 4+ pkt 84%; tytuł najlepszej 18–60% (średnio ~38%).
- [x] **Tłumaczenie statystyk na dzisiejsze realia** (2026-10-02, `scripts/buildModernBox.ts` →
      `modernBox.json`, `engine/modernBox.ts`; mecz na żywo gra tymi liczbami, ławka testowa
      porównuje z nimi):
      „gramy na zasady obecne”; baza = sezony 2019-20 – 2025-26 (tempo 101.0, TS 57.4%, 2P 53.9%,
      3P 36.1%); spany od 2019 bez zmian. Ilość gry × tempo; zbiórki dodatkowo przez dostępność
      piłek; ponad dzisiejszych liderów (top-3 średnich 3-letnich) połowa nadwyżki. Skuteczność:
      za 2 połowa wzrostu ligowego 2P% (drugą połowę daje spacing w silniku), za 3 realna zmiana
      ligowego 3P%, wolne bez zmian; przed 1980 całość × 0.75 („grali z bandą słabiaków”). Rzuty
      gwiazd: FGA × tempo, ponad dzisiejszego lidera (22.7) tylko 25% nadwyżki — odebrane rzuty idą
      w skuteczność (+0.25 TS za punkt usage) i asysty (jego asysty na rzut). Potem kontekst składu
      (`contextStats.ts`). Wynik: Kobe 2005-07 33.5 pkt, Curry 2014-16 28.7 pkt, Wilt 1966-68 16.4 zb;
      kalibracja sezonu bez zmian (RMSE ~4.5 W).
- [ ] **Etap 2b: silnik ↔ symulacja (korelacja w obie strony)** — decyzja 2026-10-02: „wszystko co
      liczy silnik powinno mieć odzwierciedlenie w symulacji” i odwrotnie (co dzieje się w meczu,
      silnik bierze pod uwagę). Miernik: wielkość wyrównania meczu do marginesu silnika — dąży do
      zera, gdy same mechaniki meczu dają wynik silnika. Każdy etap: raport przed/po + akceptacja.
  - **Etap 0: pomiar (bez zmian w kodzie)** — wagi składników; korelacja każdego składnika z jego
    statystyką (silnik → symulacja); sezony bez wyrównania: ile wyniku dają same mechaniki, który
    składnik symulacja potwierdza (symulacja → silnik); wielkość wyrównania jako start. — ZROBIONY
    2026-10-02 (10 lig × 16, sezon z wyrównaniem i bez): same mechaniki dają ~11% marginesu silnika
    (bez wyrównania wygrane vs silnik: korelacja 0.20, RMSE 9.2 W; z wyrównaniem 0.85 / 4.3 W).
    Mechanicznie działa atak (atak → pkt 0.49; 0.16 pkt bilansu za pkt ataku vs 0.21 w silniku),
    ławka (0.15 vs 0.14), spacing → udział trójek, rim pressure → wolne, kreacja → asysty. Brak
    mechaniki: obrona (−0.06 vs 0.21; ochrona obręczy/obwód nie zmieniają skuteczności rywala),
    zbiórka drużynowa (stałe 26% w ataku; korelacja −0.18), straty i przechwyty (stałe), fit
    (−0.01 vs 0.23), rotacja (0.01 vs 0.11), talent poza atakiem.
  - **Etap 1: fundamenty meczu** — paczka 2 niżej: pkt 1, 2, 3, 4, 6 + trzy poprawki z brancha. —
    ZROBIONY na branchu 2026-10-02/03 (bez merge'a, czeka na akceptację raportu): krzywa zmęczenia
    `fatigue.ts` w meczu (tylko mecze z rotacją) i w `minuteAllocation.ts` (zamiast progu 38 min;
    ciężkie przekroczenie limitu 1.8 → 2.5 wartości); zmiany w meczu rozłożone równo w czasie
    (mecz trzyma minuty z rotacji, średnio ±0.1 min); spacing osobno (±4 pkt) od limitu +2;
    spacing z zasad 35% do 2000-01 (`buildSpanContext.ts`); straty według udziału strat gracza;
    asysty max 75%. Wynik: drużyny z kimś na 40 min 96 → 25 ze 160; same mechaniki 11% → 20%
    marginesu; oceny drużyn średnio −0.06 (max ±1); 27/27 testów (przeliczone: obrona twin towers
    32, weak-link 61 min).
  - **Etap 2: kanały ataku** — margines rozbity na kanały: spacing, rim pressure (rzuty spod
    kosza, wolne), kreacja (asysty, straty składu = pkt 5), self-creation, pairing, kilku graczy
    potrzebujących piłki; czego silnik nie liczy (np. straty) — dodać do silnika.
    Plan 2026-10-07 (każdy krok osobno z raportem). Pomiar kroku 0 (1120 drużyn, oczekiwany
    margines bez nudge'a): mecz oddaje 45% overall; playmaking −0.13 / self-creation −0.18 /
    creation structure −0.26 / championship structure −0.44 pkt na SD (odwrotnie niż silnik),
    rim pressure drużyny 0, rotacja ~0 (mecz nie ma kosztu gry poza pozycją w ataku, a silnik
    liczy go trzy razy; minuty ponad poziom gracza nic w meczu nie kosztują); role coverage 3×
    silniej niż w silniku. NBA atak (BBRef 2019-26): rzuty 68 / straty 16 / zbiórka 14 / faule 2,
    SD TOV% 0.86 (mecz dziś ~0.4).
    1. Prowadzenie piłki → straty (realne straty graczy piątki + jakość rozgrywającego).
    2. Podanie → jakość rzutu (rzut po asyście +3–4 pp za 3; asysty elitarnych podających).
       Zrobione 2026-10-07: udział rzutów po asyście gracza z play-by-play (od 1996-97, wcześniej
       model), przewaga zależna od typu (Korver/Klay duża, Harden ~0). Liga 25.5 ast (58% trafień,
       NBA 59.7%), rozrzut AST% 5.0 pp jak NBA. Efekt drużynowy mały (playmaking 0.32 pkt/SD w
       meczu vs ~0.85 w silniku) — decyzja C: waga playmakingu w silniku do kroku 7.
    3. Self-creation → akcje na końcu zegara (bez kreacji ok. −4 pp, kreator ~0).
    3b. Kanał gwiazdy (decyzja 2026-10-07): najlepszy gracz dostaje więcej piłek w ważnych akcjach
        i utrzymuje skuteczność — żeby championship structure działało jak w silniku.
    4. Pairing / pick and roll; rim pressure drużyny (faule, rzuty spod kosza).
       Decyzja 2026-10-07: pick and roll bez nowej mechaniki — mecz już oddaje 177–190% pairingu
       silnika; w kroku 7 rozważyć wyższą wagę `pairingStructure` w silniku. Rim pressure: zapadanie
       obrony (lepsze trójki po wyjściu spod kosza) + faule obrońców obręczy.
    5. Defensywne części fitu (switchability vs ogrywanie, role coverage).
       Zrobione 2026-10-07: zmiany krycia zmniejszają szukanie słabego ogniwa i dają więcej
       izolacji (końcówki zegara) — switchability 0.03 → 0.34 pkt/SD (85% silnika). Role coverage
       bez zmian w meczu (już 3–4× silnika) — decyzja: w kroku 7 rozważyć wyższą wagę w silniku.
    6. Rotacja — diagnoza wyżej; naprawa do decyzji (koszt gry poza pozycją w ataku / zawodnik
       roli na dużych minutach / jedno z potrójnych karań w silniku). Decyzja 2026-10-07: a + b —
       gra poza pozycją: więcej strat (najbardziej na rozegraniu) i gorsze kończenie pod koszem;
       minuty ponad limit poziomu: dodatkowe zmęczenie (2 min za darmo). Rotacja 0% → 28% silnika,
       minuty ponad limit 0.009 → 0.052 na pkt (silnik 0.108).
    7. Kalibracja całości. 8. Testy dwustronne w `npm test` — zrobione 2026-10-07:
       `scripts/testTwoWay.ts` (tylko pełne `npm test`, ~45 s): mecz bez nudge'a oddaje ≥55% marginesu
       silnika na pkt overall i R² ≥ 0.35 (32 drużyny: 88%, 0.39), kontrasty mechanik (obrona,
       gwiazda, kreacja, rozegranie, spacing, chowanie słabego obrońcy, zbiórka w silniku), widełki
       średnich ligowych. `mechanicsMargin` / `mechanicsPer100` w `liveGame.ts`.
    Dalej (decyzja 2026-10-07): typy akcji i krycia — odłożone. Kolejność: skrypt NBA.com
    (`scripts/fetch_nba_stats.py`, uruchamia użytkownik) → przegląd danych → wnioski → luki silnik ↔
    mecz (self-creation, creation structure, role coverage / pairing druga połowa) → mecz: free agents
    po drafcie (3 graczy za 6 caps; zmiennicy przy faulach), bonus w ostatnich 2 min, tempo → UI
    (przebudowa, „za dużo się dzieje”; potem stopniowo pod tryby gry). Liderzy fauli ~4.5 — zostaje
    (w silnych składach to normalne, decyzja użytkownika).
    7.5. Spacing w meczu (decyzja 2026-10-07: wszystkie trzy części, limit ±6 pp): miejsce z oceny
       spacingu silnika (`teamSpacingValue`) zamiast udziału trójek, odpuszczanie niestrzelców (poniżej
       35), chowanie słabego obrońcy na graczu, który nie wykorzysta mismatchu (Bowen, Battier — nie Simmons czy Rodman; decyzja użytkownika). Spacing ataku 0.08 → 0.27 pkt/SD, spacing
       compatibility 0.04 → 0.58; overall 64% → 66%.
  - **Etap 3: obrona jako mechanika** (plan 2026-10-02, decyzje otwarte oznaczone „?”). Zasada:
    przeciętna obrona = zero efektu (średnie ligi bez zmian); siła tak, by same mechaniki dawały
    obronie ~0.21 pkt bilansu za pkt oceny (dziś −0.06); wyrównanie zostaje jako zabezpieczenie.
    1. Krycie jak trener: 120 przydziałów piątki, najgroźniejszy atakujący (usage × O-TAL) na
       najlepszego obrońcę w granicach tego, kogo może kryć (pozycje, role obronne; Pippen bierze
       mocnego PG). Rzut: 50% bezpośredni obrońca, 50% pomoc piątki.
    Budżet (decyzja 2026-10-07, z danych NBA 2019-26 — „cztery czynniki” 210 drużyn tłumaczą
    99% różnic w DRtg: rzuty 62%, straty 28%, zbiórka 7%, faule 3%): **60 / 28 / 8 / 4**. Rozrzut
    (najlepsze 10% obron): eFG rywala −1.8 pp, wymuszone straty +1.3, DRB% +1.9, FT/FGA rywala −2.3 pp
    (`raw/teamAdvanced.csv`).
    2. Rzuty (60% budżetu): spod kosza — najlepszy obrońca
       obręczy na boisku (elitarny −5–8 pp, więcej bloków); półdystans — obrońca + pomoc; za 3 —
       mniej rzutów i celność do −2–3 pp przy dobrym closeoucie (decyzja 2026-10-02).
    3. Straty i przechwyty (28%): nacisk obrońców (przechwyty, D-TAL obwodu) zamiast stałych 12%;
       szybka kontra po przechwycie ~60–65% (ok. 1.3 pkt, kończy przechwytujący/atletyczny), po
       zbiórce w obronie 15% na razie (docelowo zależne od składu i tempa — brak danych).
    4. Zbiórka (8%): szansa na zbiórkę w ataku — zbierający obu piątek zamiast stałych 26%;
       dobitka ~35–40% (zbierający, spod kosza, faule), a jeśli nie — oddanie na obwód i wznowienie
       na 14 s (więcej i celniejsze trójki, mniej strat i asyst).
    5. Słaby strzelec: mecz bierze ocenę spacingu z silnika (`spacing.ts`: ilość + celność +
       wygładzenie + skrócona linia) — do miejsca dla kolegów, odpuszczania (jego obrońca pomaga przy
       koszu, on dostaje wolne trójki) i krycia (na nim chowa się słabego obrońcę).
    6. Ogrywanie słabego obrońcy: realne, nie tylko tekst — część akcji idzie na niego (więcej przy
       słabej hunt resistance); pełna wersja w typach akcji.
    7. Typy akcji i sposoby krycia — pick and roll / izolacja / gra tyłem / rzut z miejsca;
       switch / drop / podwojenie; szukanie zmian (gdy jest kim zasłonić), short roll (Draymond,
       Jokic), drop vs rzut po koźle. Decyzja: po etapach 1 i 3 (każdy krok mierzalny osobno).
    8. Faule (decyzja: od razu): skłonność obrońcy, faule osobiste (problemy z faulami → ławka, 6 = koniec),
       ostrożniejsza obrona, faule drużyny (bonus); faulowanie słabych z linii — później. Czeka na
       `PlayerSeasonStats.csv` (skrypt `nba-staty.zip` wysłany 2026-10-02: faule, zbiórki A/O,
       przechwyty, straty, rzuty — może też posłużyć do średnich ligowych sprzed 1980).
    Druga strona: co mecz pokaże inaczej niż silnik (np. faule zabierające minuty, kontry) — raport
    i decyzja, czy poprawiamy silnik czy mecz.
  - **Etap 4: testy obu kierunków w `npm test`** — korelacje składników + wielkość wyrównania.
- [x] **Paczka „mecz na żywo 2” (= etap 1 i część etapu 2 wyżej) — zrobione w etapie 1** (M–L). Raport
      przed/po przed merge'em. Na branchu (bez merge'a) czekają już: limit +2 pkt z kontekstu,
      udział w akcjach ponad realny tylko w słabym otoczeniu, liniowe zmęczenie od 36 min (1%/min).
  1. **Rosnąca krzywa zmęczenia, wspólna dla meczu i rotacji** — „im więcej minut, tym większa
     kara, żeby silnik sam dawał Jordanowi mniej minut”. Każda minuta ponad 36 (próg
     potwierdzony 2026-10-02) kosztuje coraz więcej: 37. −0.5%, 38. −1%, 39. −1.5%…
     (38 min ≈ −1.5%, 40 ≈ −5%, 42 ≈ −10.5% celności). W meczu zamiast liniowej; w
     `minuteAllocation.ts` jako koszt minuty zamiast progów optimum / 38 min. Dziś gwiazdy grają
     40–42 min, a dzisiejsze gwiazdy 30+ pkt grają ≤36.5. Skutki: oceny drużyn (ławka znaczy
     więcej), AI, testy z minutami (testInsights, rotacja, calibrationReference), werdykty z sesji.
  2. **Spacing osobno od limitu** — limit +2 tylko na udział w akcjach i podania (to one nakładały
     się w piątce gwiazd); spacing z własnym, wyższym limitem (~+4). Dziś limit zjada spacing:
     Jordan ze strzelcami +2.0, bez rzutu +1.1.
  3. **„Spacing z zasad” przed 2001-02** — do 2001 zakaz strefy (obrońca nie mógł czekać
     w trumnie), więc miejsce było i bez trójek. Punkt odniesienia dla tych epok ~ drużyna
     rzucająca dziś ~35% rzutów za 3 (szacunek, do skalibrowania np. na zmianie gry pod koszem po
     legalizacji strefy). Skutek: Jordan obok strzelców zyskuje mniej, obok nierzucających traci
     (dziś zyskuje nawet przy Rodmanie i B. Wallace).
  4. **Straty według gracza** — dziś stratę dostaje się według udziału w rzutach, więc zbierają je
     strzelcy (Jordan 5.9/48 min przy 41% akcji, Kidd 2.0, Simmons 2.1 — odwrotnie niż w
     rzeczywistości). Ma być według realnej części akcji kończącej się stratą (`spanContext.json`).
  5. **Straty według składu** — dziś stałe 12% na akcję (13–14.5 na mecz w każdej piątce). Szansa
     ma wynikać ze strat tej piątki, przeliczonych na dziś względem ligi ich epoki.
  6. **Sufit asyst** — udział trafień z asystą max 85% → ~75% (najlepsze realne drużyny ~70%).
- [x] **Poprawić średnie ligowe sprzed 1980** (zrobione, #177) — `awards/seasonBaselines.json` nie ma wielu sezonów
      (np. 1966-67, 1975-76) i ma błędne wartości (1965-66 TS 54.3%, powinno być ~49%); silnik
      bierze najbliższy znany sezon, więc Wilt/West 1965-68 i Kareem 1970-72 są liczeni od zawyżonej
      bazy. `boxRates.json` też się nie nadaje (suma daje TS 64% w 1962 — niepełne rzuty). Źródło:
      tabela „NBA League Averages” z Basketball-Reference albo statystyki drużyn z Kaggle — do
      dostarczenia przez Ciebie. Wpływa też na obecny silnik (era, TS względem ligi). (S)
- [x] **Symulacja sezonu na silniku** (zmergowane #199–#202, 2026-10-08/09). Decyzje: jeden sezon na draft (ten sam
      draft = ten sam sezon i playoffy, bez „zagraj jeszcze raz”); bez kalendarza na razie; All-Star
      jako ciekawostka po sezonie (lista 24, bez meczu); All-NBA trochę mocniej ze statystyk niż MVP.
  - Etap 1 (silnik): sezon 20 s → ~4 s (para drużyn przygotowana raz na wszystkie mecze; fit.ts
    szybszy ~6×), playoffy na silniku (każdy mecz z ziarnem — da się obejrzeć akcja po akcji, wynik
    ten sam), nagrody: MVP, DPOY, 6MOY, All-NBA 1–3, All-Defense 1–2, All-Stars 24, Finals MVP.
    Garbage time w meczu (4. kwarta, duże prowadzenie: ławki, prowadzący zwalnia) — rozrzut meczu
    wokół marginesu silnika 16,6 → 14,2 pkt (NBA ~13,8), margines bez zmian (nachylenie 0,99).
    45 sezonów (9 lig AI): najlepszy bilans 57,9 W, najsłabszy 22,6 W, wygrane vs silnik RMSE 4,7;
    faworyt serii 1–2 pkt 57%, 2–4 pkt 68%, 4+ pkt 86%; tytuł dla #1 oceny 36%.
    Audyt nagród (18 sezonów): MVP, All-NBA, All-Stars, 6MOY, Finals MVP ok. Obronne poprawione —
    drużyna −1 zamiast −3 za punkt straconej obrony, pełna wartość od 32 min, All-Defense 2 obrońców
    + 3 wysokich, max 3 z jednej drużyny: nikt poniżej 28 min (było 15/180), z 10 najlepszych
    obrońców wypada 2,8 na sezon (5,4). DPOY tylko SF/PF/C, SF z handicapem 4 („w all-time dominują
    wysocy”): 18 sezonów — 15× C, 3× PF.
  - Etap 3 (UI): „Your season” — podsumowanie B, pełne statystyki, drabinka, oglądanie tylko swoich
    meczów playoffów (bez spoilerów), sezon liczony w tle w kawałkach (~4 s).
  - Etap 3b (UI, „mało ciekawe, mało intuicyjne”; „playoffy = nowa część zabawy”): hub sezonu z
    zakładkami (Overview z nagłówkiem i momentami sezonu, Standings, Stats — cała liga z sortowaniem
    i filtrami, liderzy top 10 w 12 kategoriach z minimum prób, double/triple-double, Awards) i
    przycisk „Start the playoffs”; playoffy jako osobny rozdział (makieta A): drabinka na scenie,
    panel serii z porównaniem drużyn i szansą na serię, „Play game N” od razu startuje mecz,
    ekran między rundami („#5 knocks out #4”), koniec drogi albo puchar.
  - Etap 2: makiety UI (Standings / Stats / Awards / Playoffs + mecz na żywo). Etap 3: UI.
  - [ ] Później: kalendarz (kolejki, All-Star w połowie sezonu, przebieg sezonu).
- [ ] **Mecz na żywo na koniec Mini?** — do decyzji: w Mini jest 16 drużyn i wynik to miejsce
      w lidze. (M–L)
- [ ] **Balans po symulacjach** — jak często AI wygrywa, Joker (częstość legendy i leszcza, cena),
      limit capów w daily (`DAILY_CAP_ROOM = 15`). (S–M)

---

## Etap 3. Pierdoły w trybach, po kolei

### 3.1 Draw Five (zwykły + daily)

Jak jest teraz: talia kart zamiast slot machine. Zwykły tryb to gra z AI (Pro), które dostaje z tej
samej talii 4 karty pozycji, które nie przyszły do gracza; na końcu mecz na żywo. Daily: 5 kart na
pozycję, w 1–3 rundach zakryty Joker (legenda albo leszcz, 50/50), mecz z legendarną piątką, streak,
share bez spoilerów. Karta ta sama co w draftach (pas drużyn), rozdawana w ciemno.

- [ ] **Stół** — scena stołu z perspektywą i AI naprzeciwko (makieta „Draw Five Table”), spójna
      z resztą UI: ten sam nagłówek, przyciski, wiersze slotów; capy bez żetonów. (M)
- [ ] **Ta sama karta na ekranach wyników** — wiersze slotów i wyniki w wersji kompaktowej karty. (S–M)
- [ ] **Podpowiedzi — czy w ogóle potrzebne?** Propozycja: miernik potrzeb drużyny albo usunąć.
      Jeśli zostają: dopiero po dociągnięciu kart (dziś widać je przed Draw). (S)
- [ ] **Karty reaktywne, które kuszą** — np. mocna karta, kiedy wydałeś już dużo capów; bez
      dopisku. (M)
- [ ] **Poziomy AI losowe** — Rookie / Pro / Legend losowane na mecz (Rookie z losowością
      i słabością do wielkich nazwisk, Legend bez błędów). Dziś tylko Pro. (M)
- [ ] **Animacja wyboru karty: lot do slotu** — wariant z makiety „Draw Five Card Motion”. (S)
- [ ] **Playtest całego trybu + lista poprawek** (S)
- [ ] **Wyłączyć tryb testowy daily przed wypuszczeniem** — `DAILY_REPLAY_FOR_TESTING = false`
      w `src/components/dailyProgress.ts`. Na samym końcu. Ten sam przełącznik chowa „Reroll the
      day (testing)” pod paskami daily draftów (Mini, All-Time) — losuje inny dzień, grany jak
      dzisiejszy, bez zapisu wyniku, streaku i draftu. (S)
- Później:
  - [ ] Karty taktyki w meczu („Zone defense”, „Clutch timeout”…). (L)
  - [ ] Pojedynek przez link — seed + 5 wyborów w linku, bez serwera. (M)
  - [ ] Multiplayer na żywo — patrz „Później”.

### 3.2 Mini Draft

- [ ] **Playtest pod kątem spójności z Draw Five** — wygląd kart, stół, tempo, dźwięki. (S)
- [ ] **Ton wyniku według miejsca** (odłożone 2026-09-28). W draftach nie da się policzyć
      najlepszej możliwej drużyny (CPU zabiera graczy), więc ton według miejsca: 1. miejsce już dziś
      same pochwały; rozszerzyć na top 3, gdzie słabości tylko jako „co mogłoby zagrozić”. Wspólne
      z All-Time. (M)
- [x] **Daily dla Mini — zrobione 2026-10-16.** Pasek „Daily draft” pod kartą Mini (limit i zasada
      dnia na karcie, wynik i streak po zagraniu), ekran dnia przed loterią, chip zasady w pasku
      draftu, zablokowani gracze przygaszeni z powodem („Lakers · not today”), wynik dnia i „Copy
      today's result” bez nazwisk. Dzień z daty (`src/dailyDraftDay.ts`, bez silnika): limit 65–80,
      blok franczyzy (15 drużyn z największą liczbą topowych graczy) / blok dekady / max 1 MVP+,
      niedziela otwarta. Zasada sprawdzana w `engine/dailyDraft.ts`, limit w stanie draftu
      (`QuickDraftState.capLimit`). Test `scripts/testDailyDraft.ts`. Na później w Mini: narzucony
      gracz, styl dnia.
- [ ] **Playtest całego trybu + lista poprawek** (S)
- [x] **(2026-10-28, zrobione: `src/engine/miniTournament.ts`, `MiniTournamentView.tsx`, przycisk „▶ The tournament” na wynikach Mini; zostaje: wynik turnieju w „Copy today's result” daily i na plakacie)** **Turniej po drafcie, styl NCAA** (2026-10-22, user). Mini dostaje „sezon” jako turniej
      pucharowy 16 drużyn: rozstawienie 1–16 według oceny draftu (Overall), drabinka 1–16, 8–9,
      5–12, 4–13, 6–11, 3–14, 7–10, 2–15; **jeden mecz** w każdej rundzie, przegrany odpada;
      4 rundy (1/8 → ćwierćfinały → Final Four → finał). Mecz na żywo jak w play-offach (ten sam
      komponent, Key moments, Skip), pozostałe mecze rundy liczone i do obejrzenia. Wygląd jak
      play-offy All-Time (ta sama drabinka, okno drużyny, statystyki turnieju, plakat), krótsza
      wersja. Długość meczu taka jak dla piątek (patrz „Krótszy mecz piątek” w Etapie 2). Daily
      Mini: turniej deterministyczny z ziarna dnia, wynik turnieju w „Copy today's result”. (M)

### 3.3 All-Time Draft

- [x] **Okienko ustawień — zrobione 2026-10-16.** ⚙ w menu i w nagłówku draftu (All-Time, Mini):
      szybkość draftowania CPU Calm / Fast / Instant (`src/settings.ts`, `aiSpeed.ts`), zapamiętana
      w przeglądarce. Miejsce na kolejne ustawienia (np. dźwięk loterii).

- [ ] **Playtest pod kątem spójności z resztą** (S)
- [ ] **Ton wyniku według miejsca** — ten sam co w Mini.
- [ ] **Tempo draftu AI (AI-4)** — naprawione tylko zawieszanie w połowie draftu. (S)
- [x] **Daily dla All-Time — zrobione 2026-10-16.** Pasek „Daily draft” pod kartą All-Time, ekran
      dnia przed loterią, chip zasady w pasku statusu, na tablicy najlepsze lata, które zasada
      dopuszcza (blok franczyzy: wiersz przygaszony z „Bucks · not today”). Limit 90–110 dla
      wszystkich (`DraftState.capLimit`, `draftCapLimit`), zasada tylko dla ciebie
      (`DraftState.dailyRule`) — także przy zmianie lat w Team tab (wybór lat czyta lata wybrane
      reszcie składu, więc max 1 MVP+ trzyma się do końca). Daily ma własny zapis
      (`draftSaveSummary.ts`, slot 'daily'): wyjście w trakcie wraca do tego samego draftu, zwykły
      draft go nie nadpisuje. Wynik dnia: miejsce i Overall po drafcie, potem sezon (bilans, miejsce,
      play-offy) — surowe dane pod punkty do leaderboardu. Share tekstem bez nazwisk.
- [x] **The Bomb jako osobne daily — zrobione 2026-10-16** (użytkownik: „osobne daily”, zamiast
      zasady w rotacji). Drugi pasek „💣 Daily bomb” pod kartą All-Time, własne ziarno, limit 90–110,
      bez innej zasady. Bomba (`engine/dailyBomb.ts`): najlepszy okres gracza z TAL 50–65 i ≤14 capów,
      perełka (TAL 78–88) w ~18% dni; runda 5–8. Od pierwszego picku jego capy i slot są zarezerwowane
      (`committedFgas`/`ownSlotsLeft` w draft.ts), poza tablicą dla wszystkich; w jego rundzie karta
      bomby zamiast wyboru (`makeBombPick`). Opis: pozycja, era, styl z etykiet kart
      (`bombDescription.ts`). Nazwisko, lata, tier i oceny ukryte do wyników (`bombMask.ts`: Face,
      FitName, shortenName, boardName, linie Desk, podpowiedzi). Na wynikach odsłonięcie: opis → twarz →
      nazwisko. Submit zablokowany, póki gra < 10 min. Osobny zapis (slot 'bomb'), wynik i streak.
      Na później: sezon w trakcie odsłaniania nie jest ukryty (otwarty przed 3. krokiem pokaże nazwisko).
- [ ] **Wyłączyć narzędzia kalibracji przed wypuszczeniem** — `AUTO_FINISH_FOR_TESTING` i
      `TEAM_EXPORT_FOR_TESTING` = false w `src/components/testingFlags.ts`. (S)
- [ ] **Playtest całego trybu + lista poprawek** (S)
- [ ] **Free agents po drafcie — osobna sesja, razem z kołami ratunkowymi** (2026-10-08): po 9.
      rundzie ekran „Free agency”: do 3 graczy spośród niewybranych, łącznie do 6 caps; ławka 10–12.
      Pytania na tę sesję: (1) 6 caps osobny budżet czy z niewydanych caps? (2) czy ławka 10–12
      liczy się do Bench score? (3) AI też podpisuje? (M)
- [x] **Koła ratunkowe → „Phone the Desk” (zrobione 2026-10-15,** makieta https://claude.ai/artifact/5ZSUn6nxWsoiybnPvmtGDm):
      3 telefony na draft do 6 dyżurnych ekspertów (z ziarna), zawsze 3 nazwiska wg gustu eksperta, War Room
      Onoffsky'ego (12 bez kolejności), plotka Erica (rundy 3–4), Chalk Talk (cały panel), Moonbat za darmo;
      `src/engine/deskCalls.ts`, `src/components/PhoneDesk.tsx`. Pierwotny plan poniżej. (ustalone 2026-10-07, makieta zaakceptowana:
      `mock-cards2-*`). Każde raz na draft, przyciski w rzędzie filtrów w stylu „Affordable”:
  - **War Room** — przez jeden pick board pokazuje tylko ~10–12 graczy, których wybiera Twój
    front office (ranking po tym, ile dany gracz dodaje do oceny składu); pasek „your front office
    cut the board to N players for this pick · Ends after your pick”.
  - **Chalk Talk** — okienko z jednym zdaniem trenera o największej słabości składu (np. brak
    obrony obręczy), z istniejących wykrywaczy słabości.
  - **League Sources** — przycisk aktywny tylko w rundach 3–4 (znika po 4., jeśli niewykorzystany);
    plotka bez nazwisk o tym, na co polują drużyny przed Twoim następnym pickiem („Three teams
    are said to be hunting centers”).
  - Odrzucone: 50/50 („nuda”), Insider („za mocne”). (M)
- [ ] **Tempo meczu** (decyzja 2026-10-08: niewidoczne w wynikach, era ma wpływ). Dziś każdy mecz
      to 200 posiadań; w NBA tempo drużyn różni się o SD ~2.4 posiadania (team_advanced 2015-25).
      Tempo drużyny ze stylu (kontry: przechwyty, zbiórki w obronie, atletyzm; kreatorzy późnego zegara
      zwalniają) i z ery graczy (np. lata 60. ~125 posiadań, przeliczone na dziś łagodnie); mecz ma
      2 × średnią obu drużyn; przewaga oczekiwana bez zmian, zmienia się liczba akcji. (M)
- [x] **Szukanie na boardzie** (2026-10-08): filtr ról i sortowanie (najlepsi / najwięcej za caps /
      najtańsi).

### 3.4 Wspólne dla wszystkich trybów (po trzech trybach)

#### Daily w draftach (Mini, All-Time) — specyfikacja (2026-10-15, w trakcie ustaleń)

**Ustalone (użytkownik 2026-10-15):**
- Wynik porównywalny: **ten sam draft dla wszystkich** — jedno ziarno na dzień (to samo miejsce w
  drafcie, ci sami rywale, to samo AI), jedna próba dziennie, wynik = miejsce na 16 + Overall,
  share bez spoilerów, streak osobno dla każdego trybu (jak Draw Five, `dailyProgress.ts`).
- W menu: przycisk **Daily przy każdym trybie** (nie wspólny panel).
- Zasady dnia: **różne** — nie jeden stały schemat; katalog niżej do przejrzenia i wyboru.
- **Kogo dotyczą (użytkownik 2026-10-15):** limit capów dnia — **równy dla wszystkich** (AI też;
  drafter AI już przyjmuje własny limit, `AiDraftRuleset.capLimit`). **Bany i pozostałe
  ograniczenia — tylko dla użytkownika** (AI draftuje z pełnej puli; zbanowany gracz jest dla
  Ciebie zablokowany z podanym powodem, tak jak dziś pick ponad limit).
- „The bomb”: najpierw spisać dokładnie, jak działa (niżej); wdrożenie po ustaleniu reszty zasad.

**Katalog ograniczeń dnia (propozycje, do wyboru — dzień losuje z wybranych):**
1. *Limit capów dnia* — inny niż zwykle (Mini 55–80 zamiast 70, All-Time 90–110 zamiast 100,9).
2. *Odwrócony limit* — minimum capów (np. piątka ≥ 65): wymusza strzelców z dużą liczbą rzutów.
3. *Blok franczyzy* — nikt, kto kiedykolwiek grał w X (dane: `cardCareerMetadata.json`, 209 z 215
   graczy TAL ≥ 70; np. Lakers wycina 30 z nich).
4. *Wymóg franczyzy* — co najmniej 2 graczy, którzy grali w X.
5. *Blok ery* — bez danej dekady / tylko gracze sprzed 1990 / tylko po 2000 (lata okna gracza).
6. *Top N zbanowanych* — 10 (Mini) / 20 (All-Time) najlepszych graczy dnia nie do wzięcia.
7. *Bez gwiazd na pozycji* — np. żadnego centra TAL 85+.
8. *Pułap gwiazd* — najwyżej 1 gracz z tierem MVP+ w składzie.
9. *Mistrzowie / bez pierścienia* — tylko gracze z tytułem albo tylko bez tytułu (`championships`).
10. *Narzucony gracz* — zaczynasz z konkretnym graczem dnia w składzie (jego capy już zajęte).
11. *Styl* — np. „Splash day”: min. 3 strzelców B+ w spacingu; „Twin towers”: 2 obrońców obręczy.
12. *Miejsce w drafcie dnia* — zawsze ostatni (#16) albo pierwszy (#1) z mniejszym limitem.
13. (All-Time) *Ławka* — rezerwowi muszą grać łącznie ≥ 60 min; albo najwyżej 2 graczy sprzed 1980.
14. (All-Time) *The bomb* — niżej.

Otwarte: ile ograniczeń naraz (1 czy 2), czy Mini i All-Time mają ten sam dzień zasad, czy zasady
widać przed startem (tak — ekran dnia przed loterią), czy dzień może być „bez ograniczeń”.

**Ustalone 2026-10-16 (użytkownik: „brzmi dobrze”):** the bomb to jedna z zasad w rotacji All-Time
(~1–2 razy w tygodniu), nie codziennie; numer w drafcie z ziarna dnia — ten sam dla wszystkich,
co dzień inny, loteria dalej się kręci, ale ląduje na numerze dnia.

**Ustalone 2026-10-16 (użytkownik, po makietach):**
- Zasady dnia **widoczne na karcie trybu** w menu (nie niespodzianka).
- Wynik dnia = **oba**: punkty za miejsce po drafcie **+** punkty za wynik sezonu; razem do
  leaderboardu, kiedy będzie serwer. Do tego czasu oba pokazane lokalnie i w share.
- **Testy AI pod daily (2026-10-16)** — „człowiek” = ten sam drafter co AI, z banem tylko dla
  siebie; limit dla wszystkich. Mini 30 draftów na wariant, All-Time 10.
  - *(b) AI przy mniejszym limicie.* **Mini: bezpiecznie 65–80.** Przy 60 AI się sypie: 13% drużyn
    nie obsadza 5 pozycji (przy 70: 1%), najsłabsza drużyna 38 zamiast 57; przy 55: 23%. Niżej niż 65
    tylko po poprawce AI. **All-Time: 90–110 bez problemu** (wszystkie składy pełne i pod limitem;
    przy 90 najsłabsza drużyna 67 zamiast 73, rozrzut 3,7 zamiast 3,0).
  - *(a) Czy da się wygrać z banem.* Drafter na poziomie AI kończy średnio na 8–10 miejscu z 16
    z banem i bez niego. Mini, limit 70: bez bana śr. 8,9 (4/30 wygranych), blok Lakers 8,5 (2/30),
    max 1 MVP 7,7 (0/30, 5/30 w top 3), blok lat 90. 9,8 (0/30, 1/30 w top 3). All-Time: bez bana
    8,5, Lakers 6,5, lata 90. 9,5, max 1 MVP 9,9. Ban kosztuje 0–1,5 miejsca; najtrudniejszy blok
    ery. Kto draftuje lepiej niż AI, wygra dzień także z banem.
  - *Uwaga:* optymalizacja lat graczy (`optimizeSpans`) potrafi zamienić okno na takie, które łamie
    zasadę (max 1 MVP: raz dało drugiego MVP+). W daily zasada musi obowiązywać też przy zmianie lat
    i w rotacji, nie tylko przy picku.

**Propozycja ustaleń (Claude 2026-10-15, do akceptacji):**
- *Zasady na start:* limit capów dnia, blok franczyzy, blok ery, pułap gwiazd (max 1 MVP+),
  narzucony gracz, styl (Splash day / Twin towers); w All-Time też the bomb. Na później: odwrócony
  limit, top N zbanowanych, mistrzowie / bez pierścienia, miejsce w drafcie dnia, wymóg
  franczyzy, zasady rotacji All-Time.
- *Ile naraz:* limit capów + **jedna** zasada; dwie dopiero później (np. weekendowy „trudny dzień”).
- *Mini i All-Time:* **różne** zasady tego samego dnia.
- *Dzień bez ograniczeń:* raz w tygodniu (np. niedziela) — sam draft z ziarnem dnia.
- *The bomb (2026-10-16: osobne daily, nie zasada w rotacji):* koszt w capach i runda **widoczne od startu**; nazwisko odsłonięte **na wynikach**
  (opis → twarz → nazwisko); w rotacji **min. 10 min**; **perełka ~raz na 5 dni**; jedna bomba,
  nigdy w rundach 1–4.
- *Kolejność budowy:* (1) wspólny silnik zasad dnia (ziarno, limit dla wszystkich, blokada picku z
  powodem, ekran dnia przed loterią) + Mini daily — zrobione; (2) All-Time daily — zrobione
  2026-10-16; (3) the bomb osobno.
- *Makiety:* `docs/mockups/daily-drafts.html` (2026-10-15) — przycisk Daily na karcie trybu, ekran dnia przed loterią, zablokowany
  pick z powodem + pasek zasad w drafcie, the bomb w drafcie i odsłonięcie na wynikach, wynik dnia
  + share bez spoilerów.

**The bomb (All-Time) — jak działa (pomysł użytkownika 2026-09-29, do potwierdzenia):**
- W rundzie dnia (ziarno; propozycja 5–8) **zamiast Twojego wyboru dostajesz ukrytego gracza**.
- Nie wiesz, kto to: widzisz tylko **krótki opis** — pozycja, era, styl (np. „Rezerwowy center z lat
  90., zbiórki i twarde zasłony, rzadko rzuca”), napisany z tych samych cech co opisy kart.
- **Raczej nie będzie to dobry gracz** — pula: role / ławka (propozycja TAL 50–65); otwarte: czy
  raz na kilka dni może trafić się perełka.
- Ten sam dla wszystkich danego dnia (ziarno), AI nie dostaje bomb.
- Otwarte: (1) czy jego koszt w capach widać od początku draftu (żeby dało się planować limit) —
  propozycja: tak, opis + koszt widoczne od startu; (2) kiedy odsłonić nazwisko — propozycja: na
  wynikach; (3) czy w rotacji musi grać (np. min. 10 min) czy można go posadzić na 0 min;
  (4) czy runda jest znana od startu (propozycja: tak, „Round 6: The Bomb”).

- [ ] **Mniejsza paczka danych** — menu już lekkie (2026-10-08: 3.8 MB → 238 kB, stałe składu
      w `rosterConstants.ts`). Zostaje otwarcie trybu: dziś ok. 5 s, na telefonie najdłużej. Jeden
      plik JS: 16,4 MB (3,7 MB po kompresji) po kroku 1 (`compactJson.ts`, 2026-09-27). Dalej:
      rozdzielić dane — Draw Five i Mini Draft potrzebują tylko okien „peak” i gotowych ocen
      (precomputed), pełne okna i surowe dane dopiero All-Time Draft (dynamiczny `import()`); zmierzyć
      wybór planszy Draw Five na telefonie (w Node ok. 1–2 s) i ewentualnie zapisywać go
      w localStorage. (L)
- [ ] **Globalny ranking** — dopiero z serwerem; do tego czasu wyniki tylko lokalnie.
- Po wypuszczeniu gry:
  - [ ] **Skrócenie komentarzy-dziennika** (ustalone 2026-09-27). Komentarze to ~30% linii w `src/`,
        w tym ~1300 datowanych notatek; najwięcej w `talent.ts`, `aiDrafter.ts`, `grades.ts`,
        `scoring.ts`, `rotation.ts`, `defensiveTalent.ts`, `portability.ts`. Zostawić „dlaczego”,
        liczby kalibracji i Twoje decyzje w jednej linijce; wyciąć kronikę. Szacunkowo 6–8 tys. linii
        mniej. Ręcznie, plik po pliku, od `talent.ts`. (L)
  - [ ] **Rejestr nazwanych wyjątków** dla per-gracz override'ów w `talent.ts`/`grades.ts`. (M)

---

## Później

- [ ] **Multiplayer Draw Five na żywo** (2026-09-30, „wolę irl”). Pokój z linku
      (`…/draft-game/#room=ab12`), jedna talia, gracze dobierają na zmianę i widzą ruchy od razu, na
      końcu mecz na żywo. Backend czasu rzeczywistego: darmowy Supabase (albo Firebase) — konto
      zakłada użytkownik, klucz idzie do konfiguracji. Do obsłużenia: poczekalnia, czyja tura,
      rozłączenia, zamknięta karta. Awaryjnie WebRTC przez publiczny PeerJS (bez gwarancji).
      Długoterminowo: multiplayer z taktyką na żywo („that's a long fucking shot”). (L)
- [ ] **Monetyzacja** — kierunek: prywatne ligi, jednorazowa opłata per liga za sezon.
      **Najpierw opinia prawna** o prawdziwych nazwiskach i statystykach NBA w płatnej funkcji — to
      blokuje całą ścieżkę. Zwalidować popyt na darmowych prywatnych ligach przed płatnościami.
- [ ] **Pipeline Playoff BPM z play-by-play** — wstrzymany (zwalidowany dla jednego sezonu z ~28).

## Pomysły / archiwum

- **Skrzynka pomysłów** (2026-09-05/06, nic nie zdecydowane):
  - „Legends Only” — pula ~80–100 ikonicznych nazwisk;
  - „Zgadnij kto lepszy” — trivia na 2 spanach;
  - draft z podpowiedziami (AI sugeruje 3–4 picki);
  - uproszczony ekran wyników (1–2 zdania);
  - darmowa codzienna paczka kart + pasek kolekcji (łączy się z galerią kart z archiwum);
  - „Tego dnia w historii NBA” na stronie głównej;
  - „Squad dnia” w grupie znajomych z wyjaśnieniem i archiwum zwycięzców;
  - „Draft roast”, best-of-3 szybkich starć, wybór 1-na-1;
  - „What If” z realnymi scenariuszami historycznymi;
  - „Odtwórz legendarną drużynę” (częściowo: przeciwnik dnia w daily);
  - ironiczne achievementy („wydraftowałeś drużynę bez ani jednego strzelca”);
  - tryb kariery/dynastii (symulacja sezonu i playoffów już istnieje).
- **Archiwum nieużywanego kodu** (`draftverse-future-ideas.zip`, commit „Archive unused features”,
  2026-09-27): przeglądarka puli graczy, tryb salary-cap (przeglądarka kontraktów), galeria kart
  z nagrodami, wyzwania słynnych drużyn, panel „what if”. Znany problem salary-cap na wypadek powrotu:
  realny cap z lat ~1984-88 był tak mały, że pensje weteranów po przeskalowaniu wybijają ponad klamrę
  (Walton: schyłkowy sezon $58M), a najlepsze lata w oknie kontraktu rookie wychodzą tanio.
- **Jednorazowe skrypty analityczne** (`draftverse-oneoff-scripts.zip`, 2026-09-27): 138 skryptów
  check/audit/calibrate; buildery danych, testy i walidatory zostały w repo.

---

## Historia (wypuszczone)

- **2026-09-30 — Jedna karta gracza:** karta draftu (wariant A) we wszystkich trybach: pas drużyn
  u góry podzielony według sezonów, kody drużyn, lata po najechaniu, twarz w kolorze drużyny; Draw
  Five rozdaje tę samą kartę w ciemno (bez TAL, pozycji i przycisków). Makieta: „One Card”.
- **2026-09-30 — Draw Five:** talia zamiast slot machine; gra z AI z tej samej talii; rozdanie
  z animacją (karta leci i się odwraca); wybory nigdy nie są blokowane przez capy (`slotFloor`,
  dobieranie tanich graczy spoza planszy); mecz na żywo, w którym faworyt o ≥5 pkt zawsze wygrywa, a
  w wyrównanych meczach są kursy i „Upset!”; daily z ukrytymi Jokerami (5 kart na pozycję, 1–3
  Jokery, legenda albo leszcz); granatowy stół, wachlarz, karty Premium, dźwięki (`deckSounds.ts`);
  jedna belka drużyn, wolniejsze rozdanie, wynik dopiero po meczu, animacja ręki AI, „best on the
  board” nigdy niższe niż Twoja piątka. Makiety: artefakty „Draw Five Deck”, „Draw Five Card
  Motion”, „Draw Five Table”.
- **2026-09-28/29 — Daily Slot Machine 2.0:** dzienna kolejność pozycji, przeciwnik dnia
  (`engine/dailyMeta.ts`, `LEGEND_FIVES`), mecz na żywo (`engine/liveGame.ts`,
  `components/LiveGame.tsx`, test `scripts/testLiveGame.ts`), streak z nagrodami 3/7/14/30/100 (tylko
  kosmetyka, liczone wg best), share bez spoilerów, ciaśniejszy limit capów w daily
  (`DAILY_CAP_ROOM`). Makieta: `docs/mockups/daily-slot-machine.html`.
- **2026-09-27/28 — Slot Machine:** jedna plansza dziennie, reaktywne rozdanie (`dealFor`), ocena
  względem „best on the board” (`boardTargets`), bez pułapek i plotek.
- **2026-09-27:** `npm test` w całości zielony; podział testów szybkie/pełne (`npm run test:fast`
  vs `npm test`); czyszczenie martwej konfiguracji detektorów + test `testDetectorIntegrity.ts`.
- **2026-09-25:** luki danych źródłowych naprawione wspólnym resolverem nazwisk
  (`src/data/sourceNameResolver.ts`).
- **2026-09-06/07:** staż (YOS) dla graczy bez wpisu draftowego; brakujący sezon 2025-26 w
  `salaries.json`; Shaq przypięty na 1999-01; wyjątek Skilesa usunięty; stackowanie obrony
  Nash/Kerr/Schrempf zaadresowane (`886ad0b`); dwa zgłoszenia AI draft-value okazały się nie-błędami
  (spany tego samego gracza znikają razem; tańszy span Shaqa to celowy wybór).
