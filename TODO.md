# TODO — Draft Game

Żywy backlog. Edytuj ten plik bezpośrednio, kiedy coś zostanie zdecydowane, wypuszczone albo nowo
otwarte — to jedno miejsce do sprawdzenia "co się dzieje z tym projektem", zamiast składać to z
pamięci AI albo starych plików handoff.

(Stare pliki `CLAUDE_*_HANDOFF*.md` / `CODEX-REVERT-NOTICE.md` / `SPACING_HANDOFF.md` /
`TEAM_MODEL_V1_SHADOW_*.md` zostały usunięte 2026-09-06 — były jednorazowymi, nieaktualnymi
migawkami z lipca/sierpnia, nic tu od nich nie zależy.)

---

## Przed wypuszczeniem dla znajomych

Nie znalazłem niczego co realnie blokuje — silnik i testy są w dobrym stanie na 2026-09-06.

## Decyzje kalibracyjne czekające na Twoją ocenę

- [ ] **Waga TE-1**: zmierzona korelacja talentScore↔głos człowieka to 0.54 (nie zakładane wcześniej
      0.82). Zaakceptować, czy przekalibrować gdy będzie więcej niż n=15 realnych draftów?
- [ ] **Wykładnik wartości pick'a AI-1** — potrzebuje realnego "czucia" z rozgrywki, nie tylko matematyki
- [ ] **Całkowity czas draftu AI-4** — naprawione tylko zawieszanie w połowie draftu, ogólne tempo/czas nie ruszone
- [ ] **Kolizja tier-floor Hartenstein/Tucker** (przegląd 2026-09-06: mechanizm `STARTER_ELIGIBLE_TIERS`
      + kara down-slide 0.12x niezmieniony od 08-19, Tucker nadal tier-gated w każdym realnym
      spanie — scenariusz prawdopodobnie nadal reprodukowalny). Decyzja: poluzować próg tieru dla
      realnych drugich pozycji, czy pozwolić dużym różnicom fit przebić próg?
- [ ] **AI draft-value** (Sefolosha zamiast 2. spanu Hardena, gorszy pick Shaqa 2003-05) — przegląd
      2026-09-06: `aiDrafter.ts` miał od tego czasu 6 commitów w tym "prevent dead cap-glue picks
      near the end of a draft" — brzmi trafnie, ale nie zweryfikowane (brak zapisanego seeda z
      oryginalnego zgłoszenia, trzeba by zaobserwować ponownie w praktyce)
- [ ] **Taper mmStruct post-hub** (wymiar "struktury niedopasowania" w offenseScore, otwarte od sesji 2026-09-05)
- [ ] **Audyt etykiet "Fix B"** — kod gotowy, zatwierdzony, czeka na Twój przegląd (wątek niedoszacowania obrony)
- [ ] **Komponent offenseScore na poziomie drużyny** dla rim pressure całej drużyny — dziś poprawka
      per-gracz ledwo rusza sumy drużynowe (przykład: Drużyna #9/#14 zmieniła się tylko o +1)
- [ ] **Rozszerzenie rejestrów Movement Shooter / rim-pressure** — małe, realne, nazwane dodatki,
      proponowane jako szybki zysk przy każdym powrocie do tego projektu
- [ ] **Tryb salary-cap, Krok 2**: moduł silnika cenowego (Krok 1 — realne dane płacowe 1985-2025 — gotowy)

## Znane, zaakceptowane ograniczenia (zdecydowano nie gonić dalej — nie odgrzewać bez nowych dowodów)

- Okres LeBrona 2008-10 w Cleveland czytany przez silnik jako jego szczyt kariery, ponad Miami —
  realna dziura architektoniczna (sygnał czysto defensywny), nie problem do załatania per-gracz.
  Nazwany wyjątek był proponowany i odrzucony.
- Systemowe niedoszacowanie PG/C sprzed 1997 (Bill Russell, Bob Cousy itd. czytani za nisko) —
  realne, wymaga osobnej sesji, nie zaczęte.

## Zamknięte (przegląd 2026-09-06)

- ~~**Sufit tieru Skilesa 76-vs-75**~~ — rozwiązane już 08-19 przez nazwany downcap. Od tego czasu
  jego TAL sam spadł do 62 (dalsza kalibracja), więc wyjątek stał się zbędny — usunięty (`8c0e99c`),
  potwierdzone identyczne zachowanie bez niego (nadal Sixth Man).
- ~~**Stackowanie obrony Nash/Kerr/Schrempf**~~ — prawdopodobnie zaadresowane przy okazji przez
  `886ad0b` ("dampen huntability penalty behind an elite rim anchor", G4) — dokładnie odpowiada na
  pytanie "czy kara za surowa przy silnym anchorze". Nie zrekonstruowano identycznego 9-osobowego
  składu żeby potwierdzić 1:1, ale mechanizm którego brakowało już istnieje.

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
