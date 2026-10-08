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

- [ ] **Próg gwiazdy w `positionCorrectionFor` (talent.ts)** — klif: PG tuż pod
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
- [ ] **Audyt etykiet „Fix B”** — kod gotowy, czeka na Twój przegląd (niedoszacowanie obrony).
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

## Kolejność prac (decyzja 2026-10-08)

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

## Etap 2. Symulacje — TERAZ

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
      w `src/components/dailyProgress.ts`. Na samym końcu. (S)
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
- [ ] **Daily dla Mini** — każdego dnia inny limit FGA, zbanowani gracze, tematy. Podstawa gotowa:
      dzienne ziarno i `dailyProgress.ts`. (M)
- [ ] **Playtest całego trybu + lista poprawek** (S)

### 3.3 All-Time Draft

- [ ] **Playtest pod kątem spójności z resztą** (S)
- [ ] **Ton wyniku według miejsca** — ten sam co w Mini.
- [ ] **Tempo draftu AI (AI-4)** — naprawione tylko zawieszanie w połowie draftu. (S)
- [ ] **Daily dla All-Time** — limit FGA, bany, „the bomb”. (M)
- [ ] **Wyłączyć narzędzia kalibracji przed wypuszczeniem** — `AUTO_FINISH_FOR_TESTING` i
      `TEAM_EXPORT_FOR_TESTING` = false w `src/components/testingFlags.ts`. (S)
- [ ] **Playtest całego trybu + lista poprawek** (S)
- [ ] **Free agents po drafcie — osobna sesja, razem z kołami ratunkowymi** (2026-10-08): po 9.
      rundzie ekran „Free agency”: do 3 graczy spośród niewybranych, łącznie do 6 caps; ławka 10–12.
      Pytania na tę sesję: (1) 6 caps osobny budżet czy z niewydanych caps? (2) czy ławka 10–12
      liczy się do Bench score? (3) AI też podpisuje? (M)
- [ ] **Koła ratunkowe — osobna sesja** (ustalone 2026-10-07, makieta zaakceptowana:
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
