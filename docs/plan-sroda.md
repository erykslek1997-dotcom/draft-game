# Plan na środę 2026-11-25, 5:00 — do akceptacji

Zasada jak zawsze: każda zmiana za przełącznikiem → sędziowie (SRS, sim, D-TAL, piątki, atak vs ORtg, obrona vs DRtg) → na stronę tylko to, co przejdzie i co zaakceptujesz.

## 0. Wdrożone 2026-11-22 (a-e)
| # | Zmiana | Wynik testów |
|---|---|---|
| a | Rezerwa capów na niewybranych starterów AI (`TOP5_SLOT_FLOOR=8`) — Anchorage 1-81 | średnia AI 82.29 → 82.48, najsłabsza 73.2 → 75.4 |
| b | Wysocy grający tyłem nie płacą kary helio (`HELIO_BIGS=0`) — Duncan obok Wade'a | SRS 0.839 =, sim 0.61 → 0.62 |
| c | Próg „trzech z piłką” 0.42 → 0.5 (`REV_BALL_USE`) — J. Williams | (razem z b) |
| d | „Tłok w pomalowanym” nie łapie obwodowych z półdystansem 90+ (`REV_PAINT=mid`) — Wade + Shaq 2006 | piątki 0.572 = |
| e | Ławka: bez kary „brak kreatora”, gdy w piątce 2+ kreatorów (`BENCH_STAGGER`) | wynik niżej |
| f | Dopasowanie par: struktura „gra przez wysokiego w poście” obok pick-and-rolla (`PNR_POST`) | wynik niżej |

Twój skład z draftu 307382012 (Cheyenne): 75.9 → 79.0 przy a-d (15. → 13.).

## 1. Ocena vs symulacja meczów (największa niespójność)
- #1 z 8% na tytuł, obrona 88 z 38%, Curry-team <1%; sim R² 0.61-0.63.
- Krok: na 32 drużynach AI rozbić różnicę ocena − sim na części (atak / obrona / ławka / spacing / gwiazdy), dopasować wagi sim i oceny do prawdziwych wyników (SRS / ORtg / DRtg), nie do siebie.

## 2. Skala ataku i samodzielne tworzenie akcji
- Self-creation 64 dla Haliburton / Wade / Duncan; mismatch 67 — silnik karze styl (kończenie po podaniu, gra w poście), nie jakość.
- Westbrook / Harden / Oscar jako drugi gracz z piłką; pięciu solidnych vs dwóch po 100.
- Krok: sprawdzić wagę `selfCreation` i `mismatchStructure` w ataku vs ORtg; wariant „najlepsza z dróg tworzenia” (sam / PnR / post / ruch piłki).

## 3. Ocena mocniej na BPM (punkt odniesienia niżej)
- BPM z tych samych okien (0.907) bije silnik (0.855) na 600 drużynach.
- Krok: rozłożyć silnik na części (TAL, O/D, struktura, korekty) i sprawdzić, która obniża trafność względem BPM; wariant: dla okien 1974+ TAL/Overall z większym udziałem BPM / wpływu, przed 1974 jak teraz. Mierzyć `scripts/_baseline.ts` + sędziowie; uczciwie też na prognozie (bez sezonu drużyny).

## 4. Obrona i spacing graczy
- Spójność obrony przy braku typowego PoA (Cheyenne 62 przy połowie All-Defensive).
- Spacing wysokich rzucających okazjonalnie (Millsap 43, „C+”).

## 5. Automatyczna rotacja gracza
- Chalmers 24 min na PG przy Haliburtonie 24 + 10 na SG; Cincinnati Haliburton 7 + 20, Cooper 5 + 5.
- Draft użytkownika 2026-11-22 (Stockton / Kobe / Marion / Horford / Walton): rotacja użytkownika Marion 19 SF + 17 PF, Majerle 29, Hayes tylko 12 na C daje 87.4 zamiast 86.5 z automatu (ławka 83 → 87, spacing 68 → 71, obrona 82 → 83). Automat nie próbuje przesunąć startera na drugą pozycję, żeby zrobić miejsce lepszemu rezerwowemu (`scripts/_rotu.ts`).
- Krok: starter gra pełne minuty na swojej pozycji, rezerwowy dostaje resztę; porównać z rotacją AI.

## 6. Drobne
- Napis „3 systemy naraz” w opisie dopasowania — kara wyłączona, tekst został → usunąć.
- Drużyny z Jordanem (Long Beach 78): rozbić na części.

## Korekta za epokę — odpowiedź na pytanie
Punkt odniesienia (2003 / 1997 / 2007) nie zmienia kolejności w drafcie: przesuwa każdą drużynę o tę samą stałą (−0.073 × różnica lat), więc zmienia tylko wyświetlaną liczbę (np. pivot 2016 dałby Ci 0 zamiast −1.0, ale rywalom też +1.0). Liczy się nachylenie (−0.073 pkt na rok) i czy liczyć z ławką. Wyniki nocnych testów nachylenia i wersji z ławką niżej.

## Wyniki nocnych testów
Punkt odniesienia: obecne ustawienia (SRS 0.839 / sezony 0.837, sim 0.61, D-TAL 0.833, piątki 0.573).

| Wariant | SRS | SRS sezony | sim | piątki | atak vs ORtg | Werdykt |
|---|---|---|---|---|---|---|
| e. `BENCH_STAGGER=1` | **0.840** | **0.839** | **0.64** | 0.573 | — | **na plus — do włączenia** |
| f. `PNR_POST=1` | 0.832 | 0.831 | 0.58 | 0.571 | 0.7732 → 0.7700 | odrzucony |
| f. `PNR_POST=0.9` | 0.834 | 0.833 | 0.60 | 0.572 | 0.7721 | odrzucony |
| epoka `ERA_K=0` (bez korekty) | 0.829 | 0.837 | 0.59 | 0.572 | | gorzej — korekta potrzebna |
| epoka `ERA_K=-0.04` | 0.835 | 0.837 | 0.60 | 0.573 | | gorzej |
| epoka `ERA_K=-0.1` (mocniej) | **0.842** | 0.837 | 0.61 | **0.574** | | lekko lepiej; Twój skład −1.0 → −1.3 |
| epoka z ławką `ERA_ROT=1` | 0.839 | 0.837 | 0.61 | 0.573 | | bez różnicy |

Wnioski:
- **Ławka (e)** — Twoja intuicja się potwierdza: gdy dwóch kreatorów dzieli minuty, druga piątka nie potrzebuje własnego. Wszystkie testy w górę.
- **Gra przez wysokiego w poście (f)** — dane mówią „nie” (jak wcześniej inside-out): prawdziwe drużyny z graczem w poście i tak dostają dobry atak z innych części oceny. Para Wade–Duncan traci na dopasowaniu par przez brak rzutu obok, nie przez brak samego duetu.
- **Korekta za epokę** — działa (bez niej SRS 0.829); liczenie z ławką nic nie zmienia; mocniejsza (−0.1) minimalnie lepsza tylko między epokami (SRS w sezonach bez zmian) — zostawiłbym obecną.

## Wdrożone 2026-11-22 (po planie)
- `FIT_OFFBALL_GIVE` — strzelec bez piłki (Curry) oddaje piłkę kreatorowi bez rzutu (Grant Hill): sim 0.64 → 0.66.
- `OFF_BALL` 0.35 → 0.2 — sędziowie bez zmian, O-TAL mocnych piątek w górę.
- `REV_BENCH_3D` — 3-and-D premium (D 80+, spacing 55+) nie jest „starterem z ławki”.
- Poprawka przewijania tablicy draftu na telefonie.

## Otwarte z 2026-11-22
- `LIFT_SPLIT` (wyłączony): podniesienie karty idzie na stronę, która je zarobiła (Bowen O 49 → 40). Atak vs ORtg 0.7733 → 0.7764, ale obrona 0.8128 → 0.8105, SRS 0.841 → 0.839, sim 0.66 → 0.65 — do decyzji / wariantu.
- Cincinnati (draft 3836654035) 86.7 przy rotacji 75 i Mullinie ponad limit minut — sprawdzić, czy ocena nie jest zawyżona (chemia +1, eliteShooterCover +1, ballLoad +1).
- Spacing: uśrednianie z sąsiednimi oknami zostaje (bez niego atak vs ORtg 0.7676); do sprawdzenia ważenie mocniej okien bliższych.
- Napisy w Fit („3 systemy”, „dwa huby pod koszem” przy Sheedzie, „centrum w poście” przy Howardzie 2009) — błędne teksty.

## Punkt odniesienia (2026-11-22, `scripts/_baseline.ts`, 600 prawdziwych drużyn, korelacja z SRS)
| Metoda | r |
|---|---|
| silnik — Overall | 0.855 |
| silnik — sam talent | 0.846 |
| BPM z tych samych okien, równe wagi (top-8) | **0.907** |
| BPM z okien, prawdziwe minuty | 0.919 |
| BPM z okien bez sezonu drużyny (prognoza), równe wagi | 0.735 |
| BPM z okien bez sezonu drużyny, prawdziwe minuty | 0.759 |
| BPM z tego sezonu, prawdziwe minuty (ściąga) | 0.974 |

Wniosek: zwykły BPM z tych samych okien bije silnik o ~0.05. Największa dźwignia: więcej BPM / wpływu w TAL i Overall (sprawdzić, które części silnika odejmują trafność). Uwaga: przed 1974 BPM nie ma — silnik musi działać też tam.

## Wyniki sesji 2026-11-25

### 1. Ocena vs symulacja
- Sezon zasadniczy: mecz w grze dokładnie trzyma się prognozy silnika (`scripts/_nudge.ts`: gra vs cel r 1.000, dociąganie nigdy nie dochodzi do limitu). Sędzia „sim R² 0.66” mierzy samą mechanikę, którą gra i tak dociąga do prognozy.
- Szanse na tytuł liczy prognoza play-off: 0.85 × różnica Overall + 0.15 × net rating + dopasowanie w obronie + **zderzenie stylów (w play-offach z pełną wagą)**.
- Na 568 prawdziwych drużynach (`scripts/_mu.ts`): prognoza play-off vs SRS 0.8634, bez zderzenia stylów 0.8680 (= sama ocena). Na 316 prawdziwych drużynach z play-offów (1997+) wygrane serie: z nim 0.5015, bez 0.4997 — bez znaczenia.
- W ligach AI (`scripts/_title.ts`, top-8): drużyna z niższą oceną faworytem serii w 16% par, bez zderzenia stylów 7%, bez niego i bez net rating 0%.
- Propozycja: `MU_STYLE=0` (połowa rozjazdów ocena–szanse znika, dane bez straty). Decyzja użytkownika.

### 3. BPM
- Przewaga BPM (0.907 vs 0.855) to w dużej mierze konstrukcja BPM: jego poprawka drużynowa wiąże sumę BPM z wynikiem drużyny w tym samym sezonie, a okna lat zawierają oceniany sezon.
- Uczciwa prognoza (`PRIOR=1`, okna sprzed sezonu, 114 drużyn): silnik 0.623, BPM 0.629 — remis.
- Poprawka BPM w Overall (`OVR_BPM`, różnica BPM vs BPM wynikający z TAL, ważona minutami): prognoza 0.623 → 0.618 (k=4) / 0.606 (k=8); w teście na tych samych sezonach 0.855 → 0.877 — zysk pozorny. Zostaje wyłączona.
- Wniosek: silnik w uczciwym teście jest na poziomie BPM; nie ma tu dźwigni.

### 6. Notatki w dopasowaniu (`NOTES_FIX`, tylko tekst)
- „Dwa huby pod koszem” tylko gdy obaj nie rzucają (spacing < 30) — Sheed 2000-02 (47) już nie.
- „Centrum kotwiczący w poście” nie dla elitarnych rollerów (roll 85+) — Howard 2009 (92) już nie.
- „3 systemy naraz” nie pokazuje się, skoro kara jest wyłączona.
- Sędziowie bez zmian (to tylko tekst).

### 5. Automatyczna rotacja gracza (`ROT_SEARCH`, `src/engine/rotationSearch.ts`)
- Od automatycznej rotacji: kroki po 6 minut (minuty rezerwowego innemu graczowi na tej pozycji; albo starter przesuwa minuty na drugą pozycję, a ktoś przejmuje jego), dopóki Overall rośnie. Starter zostaje pierwszy na swojej pozycji i nie traci minut łącznie; limity minut obowiązują przy dodawaniu.
- Skład użytkownika (Stockton / Kobe / Marion / Horford / Walton): 86.7 → **87.8** (Marion 20 SF + 18 PF, Majerle 34, Hayes 6) — ręczna rotacja użytkownika dawała 87.4.
- 48 składów z lig testowych (`scripts/_rotsearch.ts`): średnio +0.71, mediana +0.52, max +2.6, poprawa w 33/48; czas średnio 56 ms, max 227 ms.
- Podpięte pod: start edytora rotacji (zamiast autoAssignRotation) i auto-wysłanie rotacji, gdy kończy się czas. AI bez zmian (ma własną rotację).

### 2. Gwiazdy z piłką jako druga opcja (`scripts/_star2.ts`)
Ta sama piątka obok Curry'ego 2015-17 (Battier / Horford / Gobert + ławka), zmienia się druga gwiazda:

| Druga gwiazda | TAL | Overall |
|---|---|---|
| Durant 2012-14 | 97 | 84.6 |
| Kawhi 2015-17 | 95 | 84.6 |
| Wade 2008-10 | 95 | 84.3 |
| Oscar 1962-64 | 91 | 83.5 |
| Klay 2014-16 | 85 | 83.1 |
| Iverson 2000-02 | 80 | 82.9 |
| Westbrook 2015-17 | 92 | 82.8 |
| Harden 2017-19 | 92 | 82.3 |

- Kary za piłkę są już małe (drugi gracz z piłką +0.5 dla wszystkich, helio 0) — Westbrook / Harden nie są „karani” osobno.
- Za to druga gwiazda prawie nie rusza oceny: 17 TAL różnicy (Iverson → Durant) = 1.7 Overall.
- `TAL_P` (średnia potęgowa talentu piątki, gwiazdy ważą więcej): p=6 przesuwa wszystkich o ~+0.6, różnice bez zmian; SRS 0.855 → 0.853, prognoza 0.623 → 0.635 (szum). Wyłączony.
- Dane nie mówią, że gwiazdy ważą za mało: w teście SRS drużyny z liderem 80-87 są niedoceniane (+1.09), a z gwiazdą 95+ lekko przeceniane (−0.22). Do decyzji, czy to kwestia „odczucia gracza”, nie trafności.
