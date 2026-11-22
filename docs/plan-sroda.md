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

## 3. Obrona i spacing graczy
- Spójność obrony przy braku typowego PoA (Cheyenne 62 przy połowie All-Defensive).
- Spacing wysokich rzucających okazjonalnie (Millsap 43, „C+”).

## 4. Automatyczna rotacja gracza
- Chalmers 24 min na PG przy Haliburtonie 24 + 10 na SG; Cincinnati Haliburton 7 + 20, Cooper 5 + 5.
- Draft użytkownika 2026-11-22 (Stockton / Kobe / Marion / Horford / Walton): rotacja użytkownika Marion 19 SF + 17 PF, Majerle 29, Hayes tylko 12 na C daje 87.4 zamiast 86.5 z automatu (ławka 83 → 87, spacing 68 → 71, obrona 82 → 83). Automat nie próbuje przesunąć startera na drugą pozycję, żeby zrobić miejsce lepszemu rezerwowemu (`scripts/_rotu.ts`).
- Krok: starter gra pełne minuty na swojej pozycji, rezerwowy dostaje resztę; porównać z rotacją AI.

## 5. Drobne
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
