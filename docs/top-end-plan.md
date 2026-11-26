# Szczyt rankingu — plan (2026-11-26)

Cel: najlepsze piątki w grze mają dać się obronić. Kryteria: test piątek (`scripts/_targetFives.ts`,
dziś 9/17), test par (`scripts/_topcheck.ts`, dziś 43/56). Sędziowie (SRS 0.876, gra 0.740, prognoza 0.677)
jako bezpiecznik: spadek do ~0.005 dopuszczalny.

## Etap 0 — narzędzia (pół dnia)
- Naprawić test par: gracz z pary nigdy nie jest już w piątce bazowej, zawsze gra na swojej pozycji.
- Jeden skrypt `_topall.sh`: piątki + pary + sędziowie + AI picks, jeden raport.

## Etap 1 — pomiary na prawdziwych drużynach (fakty, bez zmian w silniku)
1. F4 wpływ na partnerów: czy odejmowanie siły kolegów poprawia prognozę (bez przecieku wyniku),
   czy tylko dopasowuje się do drużyny, z której pochodzi wynik. Test: liczyć realMates z innych sezonów niż oceniany.
2. O3 dwóch rozgrywających: sezony drużyn z dwoma starterami o wysokim udziale piłki — reszta wyniku
   względem przewidywań silnika. Wynik: ile punktów SRS kosztuje para.
3. O4 atak vs obrona: rozrzut wpływu (RAPM/on-off, pbp od 2000-01) najlepszych graczy w ataku i w obronie,
   osobno obrońcy obręczy. Wynik: stosunek wag atak/obrona dla gwiazd.
4. F3 talent na szczycie: czy różnica talentu powyżej sufitu (Jordan/LeBron vs Kobe/Durant) przekłada się
   na wyniki drużyn (prawdziwe najlepsze zespoły).

## Etap 2 — zmiany w silniku (każda za przełącznikiem, kolejność wg wpływu)
1. Wpływ na partnerów wg wyniku pomiaru 1 (bez kary za kolegów albo limit na drużynę).
2. Talent drużyny bez sufitu 100 (wg pomiaru 4; OFF_SOFTCAP już jest).
3. Kara za dwóch rozgrywających w wysokości z pomiaru 2 (FIT_TWO_PG już jest).
4. Wagi atak/obrona wg pomiaru 3 (bez osobnej reguły dla słabych obrońców — O5 ma z tego wyjść).
Po każdej: piątki, pary, sędziowie. Zmiana przechodzi, jeśli poprawia testy i nie psuje sędziów ponad próg.

## Etap 3 — decyzja użytkownika (O2)
Ile dopasowanie może przestawić piątki: pokazać przykłady przy limicie ±2 / ±4 / bez limitu, użytkownik wybiera.

## Etap 4 — wdrożenie
Testy, re-bless AI picks, build, PR, notatka w TODO.md. Dopiero po akceptacji użytkownika.

## Wynik pomiaru 1.1 (2026-11-26): odejmowanie siły kolegów NIE jest obiegiem
_baseline.ts z MOVED_MIN (drużyny, w których co najmniej N z ośmiu graczy jest nowych):
| zestaw | LIFT_RM=1 | LIFT_RM=0 |
| SRS wszystkie 600 | 0.876 | 0.867 |
| SRS ≥3 nowych (236) | 0.868 | 0.858 |
| SRS ≥4 nowych (123) | 0.853 | 0.846 |
| prognoza wszystkie 114 | 0.677 | 0.660 |
| prognoza ≥3 nowych (29) | 0.699 | 0.679 |
Wniosek: F4 obalone — gwiazdy z silnych drużyn naprawdę miały statystyki podbite przez kolegów.
Problem B5 leży gdzie indziej: dodatni wpływ (Magic +1.3, Kareem +1.1, Stockton +1.1, Kawhi +1.2) sumuje się
liniowo w piątce gwiazd, czego prawdziwe drużyny nie sprawdzają. Następny krok: czy suma wpływu ma sufit.

## Wynik pomiaru 1.4 (2026-11-26): gwiazda waży więcej niż 1/5 (STARTEST w _baseline.ts)
- SRS (600 drużyn): średni TAL piątki sam r 0.869; cały Overall 0.876 — reszta składników dodaje ~0.007.
- Prognoza (114): średni TAL 0.672; + TAL najlepszego 0.692; Overall 0.677 -> Overall + najlepszy 0.701.
  Współczynniki (Overall + najlepszy): najlepszy gracz +0.070 SRS na punkt TAL ponad to, co daje przez Overall.
- LeBron w tej samej piątce: TAL 88 -> 105 zmienia Overall o ~0.2-1 pkt (1/5 średniej), a fit/O/D różnią się o ±3-5.
Wniosek: najlepszy gracz powinien ważyć więcej (dowód poza próbą); dziś jego TAL ginie w średniej.

## Weak link (2026-11-26, STARTEST): obie końcówki ważą więcej niż środek
Prognoza (114): średnia+najlepszy+najsłabszy r 0.720 (średnia 0.672); współczynniki: średnia 0.090,
najlepszy 0.107, najsłabszy 0.109 SRS/pkt TAL. SRS (600): średnia+najsłabszy 0.873, najsłabszy 0.062.
Silnik dziś: kara tylko gdy najsłabszy starter < 70 TAL (0.6 pkt/pkt), plus huntability w obronie i słaby atakujący starter.
