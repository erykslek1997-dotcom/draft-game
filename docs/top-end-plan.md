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
