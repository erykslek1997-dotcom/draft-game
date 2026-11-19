# Raport na rano (2026-11-20)

## TL;DR
- **Ławka AI według szablonu ról — włączone i na stronie.** Na tych samych 12 draftach: ocena drużyn AI 79.98 → 80.43, ławka TAL 67.5 → 68.5, słabi rezerwowi (TAL < 60) grający 10+ min 42% → 27%, najsłabsza dziesiątka 75.3 → 76.2, glue gra 0 minut.
- **Reguła drugiej piątki** (ławka bez strzelca / bez rozgrywającego / dwóch wysokich bez rzutu kosztuje) — włączona wieczorem. Piątki 0.560 → 0.572, SRS 0.843 → 0.839.
- **Planer AI powtarzalny** — ten sam draft dwa razy daje to samo; pomiary przed/po na tych samych drużynach.

## Jak działa szablon ławki (`AI_BENCH_ROLES=4`, `AI_GLUE_SLACK=5`)
Przy ostatnich 4 wyborach AI sprawdza, której roli brakuje na ławce, i bierze najlepszego TAL, który się mieści:
1. obwodowy z rzutem albo rozgrywaniem (PG/SG),
2. skrzydłowy 3&D (obrona 70+, rzut),
3. wysoki, który broni (obrona 70+), ale nie drugi wysoki bez rzutu.

Na każde następne miejsce zostawia cenę prawdziwego zmiennika (6 rzutów). Gwiazdy nie idą na ławkę. Gdy role są obsadzone — normalny planer. Glue (≤ 2.5 rzutu) tylko gdy zostaje < 5 rzutów capu.

Przykładowe ławki (draft testowy 11): Payton 93-95 za Long Beach, Price 91-93 + Tyson Chandler (Aspen), Kyrie + Rodman (Topeka), Tony Parker + Robert Williams (Honolulu), Mutombo 98-00 (Kentucky). Glue (Aşık, Catchings, Collins…) — 0 minut.

## Co przetestowałem (12 draftów każdy, te same ziarna)
| Wariant | Ocena AI | Ławka TAL | Słabi 10+ min | Najsłabsza 10% |
|---|---|---|---|---|
| Bez szablonu (z regułą ławki) | 79.98 | 67.5 | 42% | 75.3 |
| Szablon, 3 ostatnie | 80.09 | 68.3 | 36% | 75.3 |
| Szablon, 4 ostatnie | 80.27 | 68.3 | 28% | 75.6 |
| Szablon, 5 ostatnich | 80.27 | 68.3 | 28% | 75.6 |
| **Szablon 4 + glue przy ciasnym capie** | **80.43** | **68.5** | **27%** | **76.2** |
| …+ próg obrony 65 | 80.23 | 68.0 | 34% | 75.7 |
| …+ czwarta rola „zdobywa punkty” | 80.31 | 68.3 | 29% | 75.9 |
| …+ rezerwa 5 rzutów zamiast 6 | 80.23 | 68.5 | 33% | 76.0 |

## Odrzucone wcześniej (wieczór)
- Wybieranie ławki wprost według oceny drużyny (`AI_BENCH_GREEDY`) — ocena +0.4, ale słabi rezerwowi 35% → 57-63%: ocena drużyny lubiła tanich obrońców bez ataku.
- Pojedyncze progi: podłoga potrzeby pozycji, kara za wysokiego bez ataku na ławce, gwiazda na zajętej pozycji (+6 TAL), szersza lista planera — bez efektu.

## Zostaje
- Wciąż zdarzają się słabi rezerwowi grający 27-30 min (Prigioni, Hauser, Chuck Hayes) — wybrani wcześniej niż ostatnie 4 wybory.
- Sieroty: Grant Hill, Alvin Robertson nisko na tablicy AI (punkt 4 planu).
- Automatyczny raport z eksportu (`scripts/_favs.ts`, punkt 5).
- Reszta z `docs/do-naprawy.md`.
