# Plan na środę 2026-11-25, 5:00 — do akceptacji

Zasada jak zawsze: każda zmiana za przełącznikiem → sędziowie (SRS, sim, D-TAL, piątki, atak vs ORtg, obrona vs DRtg) → na stronę tylko to, co przejdzie i co zaakceptujesz.

## 0. Czeka na Twoje „tak” (sprawdzone, neutralne lub na plus)
| # | Zmiana | Wynik testów |
|---|---|---|
| a | Rezerwa capów na niewybranych starterów AI (`TOP5_SLOT_FLOOR=8`) — Anchorage 1-81 | średnia AI 82.29 → 82.48, najsłabsza 73.2 → 75.4 |
| b | Wysocy grający tyłem nie płacą kary helio (`HELIO_BIGS=0`) — Duncan obok Wade'a | SRS 0.839 =, sim 0.61 → 0.62 |
| c | Próg „trzech z piłką” 0.42 → 0.5 (`REV_BALL_USE`) — J. Williams | (razem z b) |
| d | „Tłok w pomalowanym” nie łapie obwodowych z półdystansem 90+ (`REV_PAINT=mid`) — Wade + Shaq 2006 | piątki 0.572 = |
| e | Ławka: bez kary „brak kreatora”, gdy w piątce 2+ kreatorów (`BENCH_STAGGER`) | test w nocy — wynik niżej |
| f | Dopasowanie par: struktura „gra przez wysokiego w poście” obok pick-and-rolla (`PNR_POST`) | test w nocy — wynik niżej |

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
- Krok: starter gra pełne minuty na swojej pozycji, rezerwowy dostaje resztę; porównać z rotacją AI.

## 5. Drobne
- Napis „3 systemy naraz” w opisie dopasowania — kara wyłączona, tekst został → usunąć.
- Drużyny z Jordanem (Long Beach 78): rozbić na części.

## Korekta za epokę — odpowiedź na pytanie
Punkt odniesienia (2003 / 1997 / 2007) nie zmienia kolejności w drafcie: przesuwa każdą drużynę o tę samą stałą (−0.073 × różnica lat), więc zmienia tylko wyświetlaną liczbę (np. pivot 2016 dałby Ci 0 zamiast −1.0, ale rywalom też +1.0). Liczy się nachylenie (−0.073 pkt na rok) i czy liczyć z ławką. Wyniki nocnych testów nachylenia i wersji z ławką niżej.

## Wyniki nocnych testów
(dopisane po teście)
