# Atak „Motion / Princeton” — projekt reguły (2026-11-20)

Problem: pięciu solidnych, wszechstronnych graczy (Cheyenne: Frazier / Butler / Middleton / Nowitzki / Hakeem) ma atak 68, a dwóch po 100 obok przeciętnych (SGA + Jokić) 82. Ocena ataku liczy głównie gwiazdy (O-TAL ważone rangą + limit piłki), więc system, w którym każdy podaje, rzuca i ścina, nie jest nagradzany.

## Co mówią źródła
- Princeton to atak bez pozycji, „czytaj obronę”: każdy (poza piątką) musi ścinać, stawiać zasłony, podawać i rzucać; mało kozłowania, presja na kosz przez ścięcia (backdoor) [1][2][3].
- Kluczowy jest wysoki na high post / łokciu: mądry podający i strzelec jednocześnie („double threat”), wzrost drugorzędny [2][3].
- Rozgrywający = silnik: wejście kozłem, odczyt backdoor, podanie do wysokiego [2].
- Skrzydłowi: backdoor, rzut z rogu, czytanie pomocy [2]. Reguła: otwarty rzut po podaniu — rzucasz, piłka się nie zatrzymuje [4].
- Spurs 2014 („beautiful game”): drużyna bez dominującego gracza z piłką, ruch piłki i zawodników pierwszy w lidze w pomiarach Harvard Sports Analysis [5][6]; gdy Kawhi został pierwszą opcją, Pop przeszedł na atak „z piłką u gwiazdy” [7].

## Reguła w silniku (do zrobienia przy algorytmie oceny)
Warunki dla piątki (dane, które silnik już ma):
1. **Bez helio**: najwyżej jeden starter z udziałem w piłce (usage) ≥ 0.5.
2. **Pięciu solidnych**: każdy starter O-TAL ≥ 60.
3. **Rzut**: ≥ 4 starterów z rzutem (spacing ≥ 55).
4. **Podanie**: ≥ 4 starterów z playmakingiem ≥ 70 (nie tylko PG).
5. **Wysoki podający** (high post): PF/C z playmakingiem ≥ 75 i rzutem z półdystansu (Sabonis, Divac, Webber, Duncan, Horford, Jokić, Dirk).
6. (opcjonalnie) **Ścięcia**: skill `offBall` / cut ≥ 60 u skrzydłowych.

Efekt: dodatek do ataku rosnący ze spełnionymi warunkami (np. do +4-6 pkt ataku przy wszystkich), zamiast podbijania gwiazd.

Sprawdzenie: atak vs prawdziwy ORtg (`scripts/_offjudge.ts`, dziś 0.767), osobno drużyny „systemowe” — Spurs 2013-15, Kings 2001-03, Pistons 2004-05, Warriors 2015-17, Hawks 2015, Jazz Stocktona/Malone'a — czy ich atak w silniku rośnie bliżej prawdziwego, a drużyny helio (Harden, Luka, Westbrook) nie tracą.

## Źródła
1. https://www.basketballforcoaches.com/?p=6361
2. https://coachprincetonbasketball.com/best-players-for-princeton-offense/
3. https://en.wikipedia.org/wiki/Princeton_offense
4. https://coachprincetonbasketball.com/how-to-run-the-princeton-offense
5. https://harvardsportsanalysis.org/2014/04/nba-basketball-the-spurs-and-quantifying-movement
6. https://bleacherreport.com/articles/2098515-san-antonio-spurs-exemplify-the-beauty-of-team-basketball
7. https://rdgao.github.io/the-evolution-of-the-san-antonio-spurs/
