# Style obrony — rozpoznanie (2026-11-20)

Odpowiednik `docs/motion-offense.md`. Tylko projekt — wdrażanie i sprawdzanie jak przy ataku: każdy styl osobno, za przełącznikiem, na prawdziwych drużynach i na obronie vs prawdziwy DRtg (`scripts/auditTeams.ts` / sędziowie).

## Co mówią źródła
- **Zmiany przy każdej zasłonie (switch)** usuwają przestrzeń, którą daje zasłona, ale wymagają graczy, którzy kryją kilka pozycji; ryzyko: rywal szuka niekorzystnych par (wysoki na rozgrywającym) [1][2][3].
- **Drop** — najczęstsza podstawa: wysoki zostaje przy koszu, oddaje półdystans, chroni obręcz; wymaga dużego, długiego obrońcy kosza; słabość — drużyny, które trafiają z półdystansu / pull-up (Heat vs Bucks) [4][5].
- **Zasada składu**: elitarna obrona to albo świetny obrońca kosza, albo kilku mocnych obrońców obwodu; schemat idzie za składem, drużyny mieszają oba [6][7].
- **Ochronę kosza** lepiej mierzyć skutecznością rywala przy obręczy z graczem na boisku i bez niego niż blokami [8].

## Co już jest w silniku
Zamiany (`switchability` w Fit), pokrycie ról obronnych (POA / skrzydło / obręcz — `defensiveRoleCoverage`), spójność obrony (`defensiveCohesion`), polowanie na słabe ogniwo (`defensiveHuntability`), ochrona kosza ze skilla 1997+ (`isRimProtector`). Dlatego jak przy pick-and-rollu w ataku — styl obrony może powielać to, co już jest; każdy trzeba sprawdzić, zanim wejdzie.

## Style i warunki (z naszych danych)
| Styl | Wzorce | Warunki | Słabość (mała strata) |
|---|---|---|---|
| Switch | Warriors 2016-18, Celtics 2024 | 4-5 starterów D-TAL 70+ i podobnej wielkości (wzrost w ±3"), nikt z D-TAL < 55 | brak obrońcy kosza przy dużym rywalu (do sprawdzenia, czy grać od składu rywala) |
| Drop z obrońcą kosza | Jazz Goberta, Bucks Lopeza | C z ochroną kosza 85+ i 2+ obrońców obwodu (POA / skrzydło 70+) | rywal z elitarnym strzelcem pull-up (sim, nie ocena) |
| Presja / przechwyty | Bulls 1996, Pistons 2004 | 3+ graczy z aktywnością (przechwyty, odbicia) 70+, skrzydłowy-stoper | wysoki wolny w zmianach |
| Twarda gra pod koszem | Bad Boys, Knicks 90. | 2 wysokich z D-TAL 75+ i zbiórką w obronie, fizyczność | spacing w ataku (już liczony) |

Kolejność: Drop (najprostszy, jeden skill + pokrycie) → Switch → Presja → Twarda gra.

## Źródła
1. https://fivethirtyeight.com/features/anybody-and-everybody-can-switch-on-pick-and-rolls-now
2. https://www.sportplan.net/drills/Basketball/trends/defensive-systems-switching-2025-02.jsp
3. https://www.thescore.com/nba/news/3195631
4. https://medium.com/@KJ_THE_SCOUT/variations-of-pick-and-roll-defense-326a69eeded0
5. https://www.dunkest.com/en/nba/news/210570/the-most-effective-defensive-strategies-against-the-pick-and-roll
6. https://halfcourthoops.substack.com/p/nba-defense-philosophy
7. https://www.talkbasket.net/204246-the-switchability-era-building-a-defense-without-a-traditional-rim-protector
8. https://www.nba.com/article/2020/07/08/film-study-sixers-joel-embiid-rim-protections/

## Wyniki (2026-11-20, `scripts/_defjudge.ts`: obrona vs prawdziwy DRtg, 600 drużyn, dziś 0.8103)
| Styl (+3 pkt) | Obrona vs DRtg |
|---|---|
| drop | 0.8099 |
| switch | 0.8103 (nikt się nie kwalifikuje / już liczone) |
| presja | 0.8085 |
| twarda gra pod koszem | 0.8086 |
| wszystkie | 0.8079 |

Żaden nie pomaga — spójność obrony (`defensiveCohesion`: POA + skrzydło + obręcz, trzy warstwy, zaplecze wysokich) już łapie to, co te style. Zostają wyłączone (`DEF_STYLE_W`). Kierunek na później: zamiast dodatku za styl — kara za styl, który się gryzie (switch z dużym wolnym wysokim, drop bez obrońców obwodu), sprawdzana w symulacji meczów przeciw konkretnemu rywalowi.
