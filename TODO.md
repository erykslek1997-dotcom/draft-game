# TODO — Draft Game

Żywy backlog. Edytuj ten plik bezpośrednio, kiedy coś zostanie zdecydowane, wypuszczone albo nowo
otwarte — to jedno miejsce do sprawdzenia "co się dzieje z tym projektem", zamiast składać to z
pamięci AI albo starych plików handoff.

(Stare pliki `CLAUDE_*_HANDOFF*.md` / `CODEX-REVERT-NOTICE.md` / `SPACING_HANDOFF.md` /
`TEAM_MODEL_V1_SHADOW_*.md` zostały usunięte 2026-09-06 — były jednorazowymi, nieaktualnymi
migawkami z lipca/sierpnia, nic tu od nich nie zależy.)

---

## Przed wypuszczeniem dla znajomych

- [x] **`npm test`/`npm run test:fast` obecnie czerwone** (2026-09-07, `testClosingLineups.ts`) —
      2026-09-27: cały `npm test` przechodzi.

## Następne w kolejce (odłożone 2026-09-27, „zapisz na przyszłość”)

- [ ] **Pomysły na przyszłość (archiwum `draftverse-future-ideas.zip`, usunięte z repo 2026-09-27).**
      Działający, ale nieużywany kod: przeglądarka puli graczy, przeglądarka kontraktów (salary cap),
      galeria kart z nagrodami, wyzwania w stylu słynnych drużyn, panel „what if”. Opis w README
      w archiwum; pliki są też w historii gita (commit „Archive unused features”).
- [ ] **Jednorazowe skrypty analityczne (archiwum `draftverse-oneoff-scripts.zip`, 2026-09-27).**
      138 skryptów check/audit/calibrate/diagnose itp.; buildery danych, testy i walidatory zostały.

- [ ] **Ton wyniku względem miejsca w Mini i All-Time (odłożone 2026-09-28, „zapiszmy to na
      przyszłość”).** W Slot Machine film room ocenia względem najlepszej piątki na planszy: im
      bliżej, tym więcej pochwał, a najniższa oś to „sufit planszy”, nie błąd. W draftach nie da się
      policzyć najlepszej możliwej drużyny (CPU zabiera graczy), więc propozycja: ton według miejsca —
      1. miejsce już dziś same pochwały; rozszerzyć na top 3, gdzie słabości tylko jako „co mogłoby
      zagrozić”.
- [ ] **Wyzwania dnia (daily challenges) dla wszystkich trybów.** Twoje pomysły z 2026-09-26/27:
      - Mini Draft: każdego dnia inny limit FGA i zbanowani gracze.
      - All-Time Draft: to samo plus „the bomb”.
      - Blokady tematyczne, np. zakaz graczy, którzy kiedykolwiek grali w Lakers.
      - [x] Slot Machine: **zrobione 2026-09-28** — karta „Daily Slot Machine” w menu, jedna
        plansza dziennie dla wszystkich (lokalna północ), jedno podejście, seria dni, wynik dnia
        w przeglądarce (`src/components/dailyProgress.ts`). Bez dziennych zasad (limity, bany) —
        na razie tylko wspólna plansza.
      - [x] **Daily Slot Machine 2.0 — wdrożone 2026-09-28** (`engine/dailyMeta.ts`, `dailyGame` w
        `engine/bestFive.ts`, `engine/liveGame.ts`, `components/LiveGame.tsx`, test
        `scripts/testLiveGame.ts`). Jeden mecz, nie seria. Legendy grają na poziomie piątki
        „fan-vote” dnia: różnica z `projectMatchup` (ty vs legendy) minus (fan-vote vs legendy).
        Joker opłacalny w ok. 40–45% dni (pomiar na 90 dniach) — można podkręcić. Makiety:
        `docs/mockups/daily-slot-machine.html` (i artefakt z tej sesji). Decyzje:
        - **Joker** (wariant A): jeden legendarny gracz dnia, pełna cena (jego FGA, bez zniżki),
          pojawia się jako 5. złota karta na swojej pozycji; wyszarzony, gdy brakuje capów
          („Needs 7.4 more caps”). Na ekranie startowym pełna karta, w menu **tylko pozycja**
          („Joker at C”). Silnik dobiera Jokera tak, żeby najlepsza piątka brała go w **~50% dni**.
        - **Kolejność pozycji losowana codziennie**; Joker na dowolnej pozycji, ale nigdy w 1. ani 2.
          rundzie (musi być na czym oszczędzać). Sprawdzić `dealFor`/`boardTargets` przy innej
          kolejności niż PG→C.
        - **Spoiler:** linia Jokera („worth it / too pricey / you passed / right call”) tylko na własnym
          wyniku; w menu następnego dnia „Yesterday's Joker: X — the best five took him / skipped him”.
        - **Share: wariant A** — data, ocena, streak, wynik meczu z przeciwnikiem; nic o składzie ani Jokerze.
        - **Przeciwnik dnia + mecz na żywo:** legendarna piątka (’96 Bulls, ’86 Celtics…), mecz
          akcja po akcji (~35 s, ×2, „Skip to final”), tablica, pasek szansy, kwarty, box score,
          najlepszy gracz. Seed = dzień + skład. Różnica punktów ma pochodzić z silnika
          (`projectMatchup` — sprawdzić, czy działa dla 5 graczy; inaczej z wyniku Slot Machine),
          a fit ma być widoczny w akcjach (spacing, straty przy zbyt wielu „ball-dominant”,
          atakowanie słabego obrońcy, krycie). Makieta liczy tylko ze statystyk, bez fitu.
          **Otwarte:** jeden mecz (rekomendacja) czy seria z na żywo tylko ostatnim meczem.
        - **Streak:** progi 3/7/14/30/100 (płomień, złota dźwignia, złote ramki bębnów, retro
          rewers karty, tablica HoF), tylko kosmetyka, liczone wg **best**, bez freeze.
      - Globalny ranking dopiero z serwerem („będzie”); do tego czasu wynik tylko lokalnie.
      - Makiety tych ekranów są na stronie z mockupami z 2026-09-26.
      Podstawa technicznie jest gotowa: dzienne ziarno (`dayKey`/`hashSeed` w bestFive.ts) i
      deterministyczny wybór planszy (`dailyBoard`), którego można użyć przy wyzwaniach.
- [ ] **Odchudzenie paczki silnika.** Audyt 2026-09-27: jeden plik JS waży 29,8 MB (4,5 MB po
      kompresji) i pobiera się przy wejściu w każdy tryb, także w Roulette. Na telefonie to
      najdłuższe czekanie w grze. Krok 1 zrobiony 2026-09-27: bezstratny zapis kolumnowy danych
      w buildzie (`compactJson.ts`) — 16,4 MB (3,7 MB po kompresji). Dalej:
      - rozdzielić dane: Daily Deal i Mini Draft potrzebują tylko okien „peak” i gotowych ocen
        (precomputed), a pełne okna i surowe dane źródłowe dopiero All-Time Draft (dynamiczny
        `import()`);
      - przy okazji zmierzyć czas wyboru planszy Roulette na telefonie (dziś 0,6 s średnio,
        1,2 s najdłużej w Node) i ewentualnie zapisywać wynik w localStorage.

## Po wstępnym wypuszczeniu gry

- [ ] **Skrócenie komentarzy-dziennika** (ustalone 2026-09-27: „zrobimy to, ale po wstępnym
      wypuszczeniu gry”). Komentarze to ~14,5 tys. z 47,9 tys. linii w `src/` (30%), w tym 1274
      datowanych notatek. Najwięcej w silniku: `talent.ts` 62%, `aiDrafter.ts` 56%, `grades.ts` 54%,
      `scoring.ts` 49%, `rotation.ts` 45%, `defensiveTalent.ts` 61%, `portability.ts` 63%.
      Cel: zostawić „dlaczego” i liczby kalibracji (oraz Twoje decyzje w jednej linijce), wyciąć
      kronikę zmian i powtórzenia — szacunkowo 6–8 tys. linii mniej. Tylko czytelność kodu, gra
      bez zmian; ręcznie, plik po pliku, zaczynając od `talent.ts`.

## Decyzje kalibracyjne czekające na Twoją ocenę

- [ ] **Rim pressure — lista zweryfikowanych slasherów do rozszerzenia** (2026-09-25, "wrócić do
      tego"). Sprzed 1997 obwodowi dostają rim pressure z modelu box score (rzuty wolne z korektą
      na epokę + punkty + FG%, `perimeterRimProxy` w rimPressure.ts). Gracze z listy
      `historicalRimPressureEvidence.ts` (Greatest75: Jordan, Dominique, Baylor) są porównywani tylko
      z prawdziwymi slasherami od 1997 (≥35% rzutów spod kosza). Wyniki: Jordan 86-88 89 / 87-89 87,
      Dominique szczyt 52, Baylor 41. Do decyzji: czy dopisać kolejnych udokumentowanych slasherów
      (Drexler? Dr. J? inni) — każdy wymaga tej samej weryfikacji co obecni. Znany słaby punkt modelu:
      gracze wymuszający faule przy rzutach z dystansu (Harden) — udział trójek nie przenosi się
      uczciwie między epokami (w latach 80. Magic spadał do 0), więc nie jest w modelu.
- [x] **Luki w danych źródłowych (audyt 2026-09-25) — naprawione tego samego dnia.** Wspólny
      resolver nazwisk (`src/data/sourceNameResolver.ts`: dokładne → alias → forma kanoniczna + rok,
      rozdziela ojców i synów) we wszystkich lookupach i nagrodach; pliki `*.pool.json` przycięte na
      nowo. Odzyskane m.in. All-NBA Hakeema 1986-90 („Akeem”), Archibalda, Penny'ego, Amar'e.
      Zostają luki samego źródła: historyczny APM ma realnie dane dopiero od 1994 (przed 1994 po 1-5
      graczy na sezon, brak 1992-93) — do sprawdzenia, czy arkusz „Historical APM Grid.xlsx” ma więcej
      w innych zakładkach niż „All Scaled”; atletyczność bez graczy z lat 50.
- [ ] **Próg gwiazdy w `positionCorrectionFor` (talent.ts)** — znany klif: PG tuż pod
      `ALL_STAR_TAL_FLOOR` dostaje pełny bonus za spacing (~×1.15), tuż nad nim nie. Mark Price
      1993-95 przeskoczył 70 → 84 przy zmianie premii self-creation o 0.11 (2026-09-25). Opisane w
      kodzie jako odłożone („star-gate untangle”).
- [ ] **Przebudowa wpływu playoffs na TAL** (2026-09-25, „na przyszłość do zapamiętania”): obecny
      mechanizm do przemyślenia od nowa; nawet jeśli Malone byłby karany tak samo, kara/bonus za
      playoffs powinna być widoczna w ocenach offense i defense, nie tylko w samym TAL.
- [ ] **Salary-cap mode: eksplozja klamry (clamp) w pierwszych latach realnego capu (~1984-88)**
      (znalezione 2026-09-07, przykład: Bill Walton). Prawdziwy cap w 1984-85 to zaledwie $3.6M
      CAŁEJ drużyny — więc dowolna "normalna" realna pensja weterana z tamtych lat stanowi ogromny
      % ówczesnego capu, co po przeskalowaniu na dzisiejszy cap ($154.6M) regularnie wybija ponad
      dzisiejsze realne maksimum i ląduje docięte do klamry (Walton: schyłkowy sezon Role Player
      czyta się jako $58M, kontrakt maksymalny). Osobno, ale nakładająco: jego wcześniejsze,
      naprawdę elitarne (All-star/All-NBA) sezony czytają się jako tanie $13.8M, bo mieszczą się w
      oknie kontraktu rookie #1 wyboru — to celowe (mechanika gry), nie błąd. Efekt łączny: jego
      najlepsze lata są sztucznie tanie, najgorsze sztucznie drogie. Prawdopodobnie dotyczy każdego
      gracza z realną pensją z lat ~1984-88, nie tylko Waltona — nie zweryfikowane jak szeroko.
- [ ] **Waga TE-1**: zmierzona korelacja talentScore↔głos człowieka to 0.54 (nie zakładane wcześniej
      0.82). Zaakceptować, czy przekalibrować gdy będzie więcej niż n=15 realnych draftów?
- [ ] **Wykładnik wartości pick'a AI-1** — potrzebuje realnego "czucia" z rozgrywki, nie tylko matematyki
- [ ] **Całkowity czas draftu AI-4** — naprawione tylko zawieszanie w połowie draftu, ogólne tempo/czas nie ruszone
- [ ] **Kolizja tier-floor Hartenstein/Tucker** (przegląd 2026-09-06: mechanizm `STARTER_ELIGIBLE_TIERS`
      + kara down-slide 0.12x niezmieniony od 08-19, Tucker nadal tier-gated w każdym realnym
      spanie — scenariusz prawdopodobnie nadal reprodukowalny). Decyzja: poluzować próg tieru dla
      realnych drugich pozycji, czy pozwolić dużym różnicom fit przebić próg?
- [ ] **Taper mmStruct post-hub** (wymiar "struktury niedopasowania" w offenseScore, otwarte od sesji 2026-09-05)
- [ ] **Audyt etykiet "Fix B"** — kod gotowy, zatwierdzony, czeka na Twój przegląd (wątek niedoszacowania obrony)
- [ ] **Komponent offenseScore na poziomie drużyny** dla rim pressure całej drużyny — dziś poprawka
      per-gracz ledwo rusza sumy drużynowe (przykład: Drużyna #9/#14 zmieniła się tylko o +1)
- [ ] **Rozszerzenie rejestrów Movement Shooter / rim-pressure** — małe, realne, nazwane dodatki,
      proponowane jako szybki zysk przy każdym powrocie do tego projektu

## Znane, zaakceptowane ograniczenia (zdecydowano nie gonić dalej — nie odgrzewać bez nowych dowodów)

- Okres LeBrona 2008-10 w Cleveland czytany przez silnik jako jego szczyt kariery, ponad Miami —
  realna dziura architektoniczna (sygnał czysto defensywny), nie problem do załatania per-gracz.
  Nazwany wyjątek był proponowany i odrzucony.
- Systemowe niedoszacowanie PG/C sprzed 1997 (Bill Russell, Bob Cousy itd. czytani za nisko) —
  realne, wymaga osobnej sesji, nie zaczęte.

## Polityka: ręczna kalibracja "greatest peaks" (ustalone 2026-09-06)

Gdy gracz ma kilka spanów remisujących na tym samym ogólnym TAL, silnik AI (draft) domyślnie
wybiera reprezentanta zależnie od kontekstu picku (budżet, potrzeby) — co czasem daje span, który
nie jest realnym szczytem formy (tak jak Shaq/Harden/Jordan/Duncan/Garnett/Davis/Jokić poniżej).
**Ustalona polityka: nie budujemy ogólnego algorytmu wykrywającego to automatycznie** (zbyt
ryzykowne — historia tego projektu pokazuje że generalizacje tego typu regularnie się cofa, patrz
np. most D-TAL→TAL, próby generalnej reguły obronnej SG) — zamiast tego, ręcznie sprawdzamy i
przypinamy `USER_VALIDATED_PEAK_SPANS` (`aiDrafter.ts`) pojedynczo, w miarę jak faktycznie się
pojawiają. Kryterium: jeśli jeden remisujący span jest Pareto-lepszy (nigdy gorszy, czasem lepszy
na O-TAL I D-TAL jednocześnie) od pozostałych — przypinamy go. Jeśli to prawdziwy kompromis bez
jasnego zwycięzcy — zostawiamy bez wpisu (Twoja decyzja waży więcej niż automat).

**Przypięte (`e1a67cc`, `4d6a59c`)**: James Harden (2018-20), Shaquille O'Neal (1999-01), Michael
Jordan (1987-89), Tim Duncan (2001-03), Kevin Garnett (2002-04), Anthony Davis (2017-19), Nikola
Jokić (2021-23, remis idealny na O-TAL/D-TAL — przełamany po najniższym koszcie FGA).

**Świadomie zostawione bez wpisu** (Twoja decyzja — prawdziwe kompromisy, bez znaczenia które):
Larry Bird, Hakeem Olajuwon, David Robinson, Giannis Antetokounmpo.

**Dwie poboczne obserwacje z audytu, nieporuszone dziś — osobna sesja jeśli kiedyś zechcesz:**
- Prawdziwe sezony MVP Giannisa (spany ~2017-19/2018-20, TAL 90) czytają się WYRAŹNIE niżej niż
  jego późniejsze spany z ery mistrzostwa (TAL 98). Starsza, osobna lista `GREATEST_PEAK_DRAFT_TIERS`
  (inny mechanizm — bonus za spadającą legendę) już wcześniej wybrała ten późniejszy okres
  (2020-22), niezależnie od dzisiejszej pracy.
- Ta sama starsza lista ma Jordana przypisanego do 1988-90, różniącego się od dzisiejszego,
  świeżo zmierzonego Pareto-zwycięzcy (1987-89) — te dwa mechanizmy (stara lista bonusu za legendę
  vs dzisiejszy `USER_VALIDATED_PEAK_SPANS`) nigdy nie zostały ze sobą uzgodnione.

## Zamknięte (przegląd 2026-09-06/07)

- ~~**Zaniżony staż (YOS) dla graczy bez wpisu draftowego**~~ (`3ac2ffb`, 2026-09-07, przykład:
  Moses Malone) — naprawione ogólnie, nie tylko dla Malone'a: nowy `earliestSpanStartYearByName`
  (z całej `draftPool`) zastępuje "pierwszy rok z danymi o pensji" jako punkt startowy stażu, kiedy
  nie ma wpisu draftowego. Malone: 1984-86 $41M → $49M (drugi najwyższy próg zamiast najniższego).
  Walton (ma wpis draftowy, nietknięty tą zmianą) zweryfikowany bajt-w-bajt identyczny przed/po.
  Wciąż niedoskonałe (pula zaczyna się dla Malone'a w 1976, nie w jego realnym 1974 debiucie) —
  odnotowane wprost w kodzie, nie ukryte.
- ~~**Sezon 2025-26 brakujący w `salaries.json`**~~ (`10c7cf2`, 2026-09-07) — Twoje przeczucie było
  słuszne: dane kończyły się na 2024-25 (0/496 dopasowanych graczy miało klucz "2026"), plus 144 z
  640 obecnych graczy nie było w bazie w ogóle. Naprawione realnymi danymi z Twojego eksportu
  (`player_salaries.csv`, HoopsHype) — tylko dopisywanie brakujących lat, nic nadpisane. Sezon
  2026-27 świadomie pominięty (Twoja decyzja — jeszcze nie rozegrany). Zweryfikowane przez prawdziwą
  funkcję wyceny `priceSpan()`, nie tylko surowy JSON.
- ~~**Tryb salary-cap, Krok 2 (silnik cenowy)**~~ — **KOREKTA: to już istnieje**, wcześniejszy wpis w
  tym pliku był błędny (oparty na nieaktualnej notatce pamięci). [CapSheet.tsx](../src/components/CapSheet.tsx)
  (445 linii) + [salaryPricing.ts](../src/engine/salaryPricing.ts) (199 linii) są w pełni
  zaimplementowane i **wdrożone na żywo** na `https://timely-pasca-a20b70.netlify.app/` — trafiły w
  commit `dcb1444` pod nazwą niezwiązaną z tematem, stąd przeoczenie. Realna cecha: przelicza każdy
  span na "obciążenie" budżetu $200M/9 graczy, normalizując prawdziwą pensję do dzisiejszego capu
  ($154 647 000), z osobną obsługą kontraktów rookie i danych szacunkowych sprzed 1985. Kod sam
  siebie oznacza jako "WORKING DRAFT" (`capByYear` przybliżony przed 2016, lata służby szacowane z
  rocznika draftu) — jeśli to dopracowanie ma sens, to osobny, mniejszy temat niż "zbuduj to od zera".
- ~~**Shaq w `USER_VALIDATED_PEAK_SPANS`**~~ — przypięty na 1999-01 (`e1a67cc`). Twoja decyzja:
  1999-01 i 2000-02 to realni kandydaci na peak ofensywy+obrony; sprawdzone wprost — 1999-01 wygrywa
  na obu składowych (O-TAL 94 vs 92, D-TAL 80 vs 74) mimo remisu na ogólnym TAL (97).
- ~~**Sufit tieru Skilesa 76-vs-75**~~ — rozwiązane już 08-19 przez nazwany downcap. Od tego czasu
  jego TAL sam spadł do 62 (dalsza kalibracja), więc wyjątek stał się zbędny — usunięty (`8c0e99c`),
  potwierdzone identyczne zachowanie bez niego (nadal Sixth Man).
- ~~**Stackowanie obrony Nash/Kerr/Schrempf**~~ — prawdopodobnie zaadresowane przy okazji przez
  `886ad0b` ("dampen huntability penalty behind an elite rim anchor", G4) — dokładnie odpowiada na
  pytanie "czy kara za surowa przy silnym anchorze". Nie zrekonstruowano identycznego 9-osobowego
  składu żeby potwierdzić 1:1, ale mechanizm którego brakowało już istnieje.
- ~~**AI draft-value: Sefolosha zamiast 2. spanu Hardena**~~ — to strukturalnie niemożliwy scenariusz,
  nie bug. `draft.ts` ma twardą regułę: gdy ktokolwiek wydraftuje którykolwiek span danego gracza,
  WSZYSTKIE pozostałe spany tej samej realnej osoby znikają z całej puli, dla każdej drużyny, do
  końca draftu. "Drugi span Hardena" nie mógł być fizycznie dostępny. Oryginalna notatka musiała
  nieprecyzyjnie zapamiętać co się faktycznie stało.
- ~~**AI draft-value: gorszy pick Shaqa 2003-05**~~ — ma realne uzasadnienie. Ze wszystkich 14 spanów
  Shaqa, 2003-05 (TAL 93) to tylko 14.6 FGA — znacznie taniej niż jego szczytowe lata (97 TAL przy
  18-20 FGA). Kod ma udokumentowaną, celową zasadę preferowania tańszego/niższego-TAL spanu tego
  samego gracza gdy liczy się miejsce w limicie FGA. Bez zapisanego stanu budżetu z oryginalnego
  zgłoszenia nie da się potwierdzić 1:1, ale to wygląda na sensowny wybór efektywnościowy, nie błąd.

## Skrzynka pomysłów (wymyślone 2026-09-05/06 — nic jeszcze nie zdecydowane/priorytetyzowane)

### Tryby entry-level
- [ ] "Legends Only" — pula ~80-100 ikonicznych nazwisk (łatwiejsza niż pełna pula ~1223 spanów)
- [ ] "Szybka 5" — mini-draft na 5 graczy, bez budowania rotacji
- [ ] Losowy skład — zero wyboru, czysta zabawa/porównanie
- [ ] "Zgadnij kto lepszy" — trivia na 2 spanach, uczy TAL/D-TAL przy okazji
- [ ] Draft z podpowiedziami — AI sugeruje 3-4 picki na turę zamiast przeszukiwania całej puli
- [ ] Uproszczony wariant ekranu wyników (1-2 zdania vs. pełne 7 strengths + 7 concerns)

### Codzienne zaangażowanie
- [ ] Licznik serii (streak) na codziennej zagadce
- [ ] Darmowa codzienna paczka kart (łączy się z Card Collection)
- [ ] Pasek postępu kolekcji (X / ~1223 kart)
- [ ] "Tego dnia w historii NBA" na stronie głównej
- [ ] "Squad dnia" — codzienny zwycięzca w grupie znajomych, pokazany z WYJAŚNIENIEM dlaczego wygrał
      (wykorzystując istniejący silnik tekstu insights) + archiwum "hall of fame" poprzednich zwycięzców

### Szybkie PvP (bez backendu)
- [ ] Duel na tym samym seedzie — wykorzystuje istniejący mechanizm `?draftSeed=` (najtańszy z tych pomysłów)
- [ ] "Draft roast" — wysyłasz wynik, znajomy próbuje go pobić
- [ ] Best-of-3 szybkie starcie mini-draftów
- [ ] Wybór 1-na-1 (bez budowania składu w ogóle)

### Udostępnianie / wiralowość
- [ ] Shareable wynik w stylu Wordle — bez spoilerów, tylko skondensowane podsumowanie wyniku

### Większe pomysły na zawartość
- [ ] Rozszerzenie "What If" o realne scenariusze historyczne (nie tylko podmiana w swojej drużynie)
- [ ] Tryb wyzwania "odtwórz tę legendarną drużynę"
- [ ] Ironiczne/śmieszne achievementy (np. "wydraftowałeś drużynę bez ani jednego strzelca")
- [ ] Tryb kariery/dynastii na wiele sezonów (symulacja sezonu/playoffów już istnieje jako budulec)

## Monetyzacja — kierunek wybrany, nic jeszcze nie zbudowane

- [ ] Prywatne ligi, prawdopodobnie jednorazowa opłata per liga za sezon (nie per osoba miesięcznie —
      cykliczne rozliczanie miesięczne źle pasuje do funkcji używanej w grupie znajomych zrywami przez sezon)
- [ ] **Zanim zaczniesz pobierać realne pieniądze**: zdobądź prawdziwą opinię prawną co do używania
      prawdziwych nazwisk/statystyk graczy NBA w płatnej funkcji. Wspominane wielokrotnie, wciąż nie
      zrobione — to blokuje całą ścieżkę monetyzacji.
- [ ] Zwaliduj realny popyt na prywatne ligi jako darmową funkcję, zanim zbudujesz infrastrukturę płatności

## Jakość kodu

Pełny szczegół w pamięci Claude (`code_quality_plan_post_friends_launch.md`), jeśli wracasz do tego z Claude.

- [x] Czyszczenie martwej konfiguracji detektorów + stały test `scripts/testDetectorIntegrity.ts` (`ddf840e`)
- [x] Podział testów szybkie/pełne — `npm run test:fast` (~3m17s) vs pełny `npm test` (~17min) (`9a93e6e`)
- [ ] Rejestr nazwanych wyjątków dla per-gracz override'ów w `talent.ts`/`grades.ts` — wciąż czeka, po premierze
- [x] ~~Git worktree dla równoległych sesji AI~~ — nieaktualne, nie pracujesz już równolegle z innym AI

## Długoterminowe / wstrzymane

- Pipeline Playoff BPM z play-by-play — wstrzymany, wróć bliżej końca projektu (zwalidowany dla
  jednego sezonu, nie przeskalowany na resztę ~28)
- Prawdziwy multiplayer z taktyką na żywo — długoterminowa wizja, Twoje własne słowa: "that's a long
  fucking shot". Potrzebuje prawdziwego backendu (Supabase/Firebase to realistyczne wybory), nie
  zaczęte. Tanie pierwsze kroki bez backendu: pomysły entry-level/PvP/codzienne zaangażowanie wyżej.
