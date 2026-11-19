# Plan działań (2026-11-18, noc)

Zasada: każdy krok za przełącznikiem, domyślnie wyłączony. Mierzone sędziami (SRS, D-TAL, piątki, sim, AI rosters) + przypadki kontrolne z `lineup-principles.md` + licznik dziwności (`scripts/_oddities.ts`). Rano raport z liczbami; włączenie decyzją użytkownika.

## 0. Narzędzia (najpierw)
- `scripts/_controlCases.ts`: składy wzorcowe i kontrolne → atak / obrona / fit / ocena, porównanie wariantów. Oczekiwania z `lineup-principles.md` jako testy (np. Holiday > Brunson przy Jokiciu).
- Licznik dziwności: poprawić „zmarnowany wybór” (liczyć raz na gracza, osobno pominięcia przez cap), dodać „trzech z piłką” i „dwóch C”.

## 1. Atak za nisko (pkt 5)
- Rozbić Offense dla Curry'ego / Birda: piątka vs ławka, każda kara osobno.
- Znaleźć, co ściąga 63-64; poprawka tylko jeśli nie psuje sędziów.

## 2. D-TAL z cech (pkt 4)
- Kandydat: D-TAL z pointOfAttack / help / rimProtect / activity / defGlass (+ pre-1997).
- Warunki: sędzia D-TAL ≥ 0.825, gładkość między sąsiednimi oknami (George, Iguodala, Manu), obrona obwodu osobno od ochrony kosza (pkt 3).

## 1b. Etykiety (przeniesione przed atak — decyzja użytkownika)
## 3. Etykiety → cechy, posiadanie piłki (pkt 9)
- `HIGH_USAGE_ARCHETYPE_WEIGHT` w `fit.ts` i `aiDrafter.ts` → prawdziwe USG% + handling.
- Potem `talent.ts` (4 miejsca: samodzielne tworzenie, zwolnienie z kary bez piłki, rozgrywanie, roll big), `pairwiseFit.ts`, `portability.ts`.

## 4. Jeden mechanizm zamiast pięciu reguł (pkt 1, 6-10, 1a, 1b, 3a, 8a)
- Piątka ma budżet piłki; każda kolejna jednostka tej samej cechy (piłka, wjazd, post, spacing) warta mniej; brak potrzebnej cechy (spacing, obrona obwodu, ochrona kosza) kosztuje nieliniowo.
- Wartość gry bez piłki zależy od reszty (strzelec bez piłki ok; niestrzelający obwodowy bez piłki prawie 0; cutter tylko przy miejscu).
- Najpierw zmierzyć na prawdziwych piątkach NBA (sędzia piątek 0.548) — tylko jeśli poprawia, idzie dalej.

## 5. Poziom startera (pkt 2a)
- Sprawdzić dodatek za elitarną obronę u graczy z bardzo niskim O (Caruso przechodzi próg startera).

## 6. Rotacja — minuty
- Dlaczego przypisani gracze grają mało na swojej pozycji (LeBron 16/40 na PF).

## 7. AI w drafcie
- Po zmianach oceny AI sam za nią pójdzie; sprawdzić licznikiem dziwności na 10 draftach (Wade / Oscar pomijani, drugi C, Caruso jako starter).
- Dopiero jeśli zostanie: poprawki w samym AI (pozycje, drugi C).

## Rano
- Tabela: każdy krok → sędziowie przed/po, przypadki kontrolne, licznik dziwności.
- Nowe drafty na stronę do oceny.
