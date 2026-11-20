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

## Katalog stylów ataku (do rozwijania powoli, styl po stylu)
Każdy styl: warunki z danych, które silnik już ma (usage, handling, playmaking, spacing / spotUp / pullUp3, rim pressure, roll, post, offBall, D-TAL, zbiórki), mały dodatek gdy pasuje, mała strata gdy się gryzie. Silnik ma już: etykietę stylu w eksporcie („Style: …”), konflikty systemów (helio + post), limit piłki, PnR (`mismatchStructure`).

| Styl | Wzorce | Warunki | Konflikty |
|---|---|---|---|
| Motion / Princeton | Spurs 2014, Kings 2002, Pistons 2004 | patrz wyżej | 2+ graczy usage ≥ 0.5 |
| Heliocentryczny | Harden 2018, Luka, LeBron 2018 | 1 gracz usage ≥ 0.6 + handling ≥ 90, 4 strzelców | drugi gracz z piłką bez rzutu, wysoki tyłem do kosza |
| Pick-and-roll | Stockton–Malone, Nash–Amar'e, CP3–Chandler | PG handling ≥ 90 + wysoki roll / lob (roll ≥ 70) lub pick-and-pop, 2+ strzelców | dwóch wysokich bez rzutu |
| Post / inside-out | Shaq 2000, Hakeem 1995, Duncan 2003 | C post ≥ 80 + usage ≥ 0.45, 3+ strzelców wokół | drugi wysoki bez rzutu, helio na obwodzie |
| Trójkąt | Bulls 1996, Lakers 2001 | 2+ graczy grających tyłem / z łokcia (post lub pm ≥ 70 u wysokich), mądrzy podający na skrzydłach | brak gry tyłem do kosza |
| Seven seconds / pace | Suns 2005-07 | elitarny PnR PG + 4 strzelców, mała piątka (stretch 4) | dwóch wysokich bez rzutu |
| Showtime / tranzycja | Lakers 1985-87 | elitarny podający w biegu + finiszerzy (rim ≥ 80) + zbiórki | wolni, bez finiszerów |
| Izolacje / dribble-drive | Knicks / Thunder | 2+ samodzielnych kreatorów (selfCreation ≥ 85) + spacing | brak rzutu, dwóch na jednej piłce |

Kolejność wdrażania: Motion → Pick-and-roll (część jest) → Post / inside-out → Heliocentryczny → reszta. Każdy osobno, za przełącznikiem, sprawdzany na prawdziwych drużynach danego stylu i na ataku vs ORtg.

## Wyniki
- **Motion / Princeton** — włączony (`OFF_MOTION_W=4`, 4 z 5 warunków): atak vs ORtg 0.7671 → 0.7680 w obu połowach; Kings 2002 i Cheyenne się kwalifikują, Spurs 2014 nie (ich ruch piłki grał ławką).
- **Gra tyłem do kosza (inside-out)** — odrzucony (`OFF_INSIDE_W`, wyłączony): każdy wariant obniża atak vs ORtg (0.768 → 0.765-0.766). Prawdziwe drużyny tego stylu (Rockets 1994, Magic 1995, Spurs 2003) miały 1-2 strzelców i drugiego wysokiego bez rzutu, a silnik i tak ocenia ich atak dobrze — premia za „idealne” otoczenie nie ma oparcia w danych. Kara za dwóch wysokich bez rzutu już jest (reguły z oceny: tłok w pomalowanym).
- **Heliocentryczny** — włączony (`OFF_HELIO_W=3`): jedna gwiazda z piłką (usage ≥ 0.6, handling ≥ 90), pełny dodatek przy 4 strzelcach wokół, połowa przy 3. Atak vs ORtg 0.7680 → 0.7685 w obu połowach.
- **Pick-and-roll** — odrzucony (`OFF_PNR_W`, wyłączony): 0.7685 → 0.759-0.765. Parę rozgrywający + wysoki silnik już liczy (`mismatchStructure`), dodatek liczył ją drugi raz.
