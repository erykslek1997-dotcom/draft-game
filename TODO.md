# TODO — Draft Game

Żywy backlog. Edytuj ten plik bezpośrednio, kiedy coś zostanie zdecydowane, wypuszczone albo nowo
otwarte — to jedno miejsce do sprawdzenia "co się dzieje z tym projektem".

**Zasada (2026-09-30, Twoja decyzja): dopracowujemy tryby gry po kolei — Draw Five → Mini Draft →
All-Time Draft.** W każdym trybie: najpierw to, co najbardziej scala grę, i to, co łatwe; na koniec
pełny playtest trybu (z telefonem) i lista poprawek. Kolejność jeszcze do przemyślenia.

Trudność: **S** = kilka godzin, **M** = jedna runda zmian, **L** = kilka rund.

---

## 1. Draw Five (zwykły + daily) — w pracy

Jak jest teraz: talia kart zamiast slot machine. Zwykły tryb to gra z AI (Pro), które dostaje z tej
samej talii 4 karty pozycji, które nie przyszły do gracza; na końcu mecz na żywo. Daily: 5 kart na
pozycję, w 1–3 rundach zakryty Joker (legenda albo leszcz, 50/50), mecz z legendarną piątką, streak,
share bez spoilerów. Granatowy stół, wachlarz, karty Premium, dźwięki. Szczegóły w historii na dole.

- [ ] **Wyłączyć tryb testowy daily przed wypuszczeniem** — `DAILY_REPLAY_FOR_TESTING = false`
      w `src/components/dailyProgress.ts` (znika „Play today again”, „Another day's board” i świeża
      plansza przy każdym wejściu). Zostaje włączony, dopóki testujesz. (S)
- [ ] **Podpowiedź dopiero po dociągnięciu kart** — dziś „One shooter so far — this deal has
      another” widać przed Draw. (S)
- [ ] **Animacja wyboru karty: lot do slotu** — wariant z makiety „Draw Five Card Motion”;
      wdrożone jest tylko rozdanie (wariant A). (S)
- [ ] **Poziomy AI: Rookie / Pro / Legend** — Rookie z losowością i słabością do wielkich nazwisk,
      Legend bez błędów. Dziś tylko Pro. (M)
- [ ] **Balans po graniu** — Joker (częstość legendy i leszcza, cena = środkowa cena pozycji),
      limit capów w daily (`DAILY_CAP_ROOM = 15`), jak często AI wygrywa, tempo rozdania. (S–M)
- [ ] **Playtest całego trybu + lista poprawek** (S)
- Później:
  - [ ] Karty taktyki w meczu („Zone defense”, „Clutch timeout”…) — zagrywane w trakcie meczu na
        żywo. (L)
  - [ ] Pojedynek przez link — seed + 5 wyborów w linku, bez serwera; znajomy drafuje z tej samej
        talii, potem mecz. Tani krok przed multiplayerem. (M)
  - [ ] Multiplayer na żywo — patrz „Później”.

## 2. Mini Draft

- [ ] **Playtest pod kątem spójności z Draw Five** — wygląd kart, stół, tempo, dźwięki. (S)
- [ ] **Ton wyniku według miejsca** (odłożone 2026-09-28). W Draw Five film room ocenia względem
      najlepszej piątki na planszy: im bliżej, tym więcej pochwał, a najniższa oś to „sufit
      planszy”, nie błąd. W draftach nie da się policzyć najlepszej możliwej drużyny (CPU zabiera
      graczy), więc ton według miejsca: 1. miejsce już dziś same pochwały; rozszerzyć na top 3, gdzie
      słabości tylko jako „co mogłoby zagrozić”. Wspólne z All-Time. (M)
- [ ] **Mecz na żywo na koniec?** — do decyzji: w Mini jest 16 drużyn i wynik to miejsce w lidze.
      (M–L)
- [ ] **Daily dla Mini** — każdego dnia inny limit FGA, zbanowani gracze, tematy (np. zakaz graczy,
      którzy grali w Lakers). Podstawa gotowa: dzienne ziarno i `dailyProgress.ts`. (M)
- [ ] **Playtest całego trybu + lista poprawek** (S)

## 3. All-Time Draft

- [ ] **Playtest pod kątem spójności z resztą** (S)
- [ ] **Ton wyniku według miejsca** — ten sam co w Mini.
- [ ] **Tempo draftu AI (AI-4)** — naprawione tylko zawieszanie w połowie draftu, ogólne tempo
      i czas nie ruszone. (S)
- [ ] **Daily dla All-Time** — limit FGA, bany, „the bomb”. (M)
- [ ] **Kalibracja silnika — tylko to, co realnie wyjdzie w graniu** (lista w „Kalibracja”). 
- [ ] **Playtest całego trybu + lista poprawek** (S)

## Wspólne dla wszystkich trybów (po trzech trybach)

- [ ] **Mniejsza paczka danych** — dziś otwarcie trybu trwa ok. 5 s, na telefonie najdłużej. Jeden
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

## Kalibracja silnika (Twoja ocena; robimy, gdy wyjdzie w graniu)

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

### Znane, zaakceptowane ograniczenia (nie odgrzewać bez nowych dowodów)

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
