# Dane play-by-play (pbpstats) — jak je wykorzystać (szkic 2026-11-25)

## Co jest dostępne
- `api.pbpstats.com/get-totals/nba?Season=…&SeasonType=…&Type=Player|Team` — od **2000-01**, ~200 pól na gracza:
  strefy rzutów (pod koszem, krótki/długi półdystans, róg, łuk) z celnością i % po asyście, usage, straty
  w akcji / martwe, dobitki, faule wymuszone / popełnione (strzeleckie, nie-strzeleckie, and-1), rating
  drużyny z graczem na boisku (`OnOffRtg`, `OnDefRtg`), zbiórki według strefy rzutu.
- Posiadania według sposobu rozpoczęcia (`StartType`: po przechwycie, po zbiórce w obronie, po koszu…) —
  na razie potwierdzone dla drużyn.
- Przed 2000-01 brak — tam zostają obecne modele i mosty (`skillsPre`, przedziały ery).

## Zasady (jak przy każdym źródle)
1. **Jednorazowe pobranie**, z przerwami między zapytaniami, surowy JSON w `src/data/raw/pbpstats/<sezon>-<typ>.json`;
   skrypt `scripts/fetchPbpstats.ts` (cache: nie pobiera drugi raz). Licencja: prywatny projekt — z umiarem, z podaniem źródła.
2. **Lookup na okno gracza** jak `realAdvancedLookup`: sezony z `spanEndYears`, ważone minutami, przycięte do puli
   (`trimReferenceDataToPool`).
3. **Każde użycie za przełącznikiem**, mierzone sędziami — przede wszystkim **uczciwą prognozą** (`_baseline.ts PRIOR=1`),
   bo dane z tego samego sezonu „znają odpowiedź” (on/off jest tu najbardziej podatny).
4. Bez nazwisk; przed 2000 — albo brak zmiany, albo most dopasowany na latach 2000+.

## Gdzie wejdą (od najbardziej obiecujących)
| # | Część silnika | Dane | Co poprawia |
|---|---|---|---|
| 1 | **Samodzielne tworzenie akcji / grawitacja bez piłki** | % trafień po asyście (2 / 3 / pod koszem), róg vs łuk | Rozdziela strzelca z miejsca (Korver, Klay) od pull-upu (Curry) i kreatora; dziś „self-creation” ma wagę 0 i myli |
| 2 | **Spacing** | celność i wolumen z rogu / łuku, długi półdystans | Prawdziwe strefy zamiast drabinki z przeliczeniem ery dla 2000+; mniej uśredniania z sąsiednimi latami (White) |
| 3 | **Atak na kosz (rim pressure)** | `AtRimFrequency`, and-1, faule wymuszone | Wade / Giannis / Westbrook — dziś liczone ze skilli |
| 4 | **Straty w akcji → kontra rywala** | `LiveBallTurnovers` | Do mechaniki meczu (przechwyt → szybki atak) i do kosztu gracza z piłką |
| 5 | **Faule** | faule popełnione / wymuszone na posiadanie | Mechanika meczu (dziś `foulIndex` z boxa); usunięte z oceny — zostają tylko w meczu |
| 6 | **Wpływ gracza (on/off)** | `OnOffRtg`, `OnDefRtg` | Dodatkowy sygnał do TAL obok DARKO / RAPTOR; szum duży → tylko z regresją do średniej i tylko jeśli prognoza rośnie |
| 7 | **Styl drużyny / tempo** | `StartType` (drużyny), posiadania na minutę gracza | Kidd w kontrze obok dwóch wysokich w poście; najpierw sprawdzić, czy jest dla graczy |

## Kolejność
1. Pobranie 2000-01 … 2025-26 (gracze + drużyny, sezon zasadniczy; play-offy osobno) — ~52 zapytań.
2. Lookup + test zgodności z danymi, które już mamy z NBA.com (2013+), żeby złapać błędy łączenia nazwisk.
3. Punkty 1-3 jako część przebudowy TAL (surowe składniki ataku), każdy osobno przez sędziów.
4. Punkty 4-5 przy mechanice meczu (razem z oczekującym wariantem `SIM_A_OTAL` 3.5 + `SIM_FOUL` 0.3).
5. Punkty 6-7 na końcu (najwięcej szumu / brak pewności, czy są dane dla graczy).

## RAPM (APBRmetrics, 2026-11-25)
- Pobrane `scripts/fetchApbrRapm.sh`: 46 plików, 1996-97 … 2018-19, sezon + play-offy (`src/data/raw/apbrRapm`), scalone do `src/data/apbrRapm.json`, lookup `src/engine/apbrRapmLookup.ts` (pokrycie 5025 / 5088 okien 1997-2019).
- Test (`OVR_BPM_SRC=rapm OVR_BPM=k`, różnica RAPM vs RAPM wynikający z TAL, ważona minutami): SRS 0.877 → 0.880 / 0.882 / 0.885 (k=1/2/4), prognoza 0.671 → 0.671 / 0.671 / 0.669.
- Wniosek: jak przy BPM — zysk tylko w teście na tych samych sezonach (RAPM zna wynik drużyny), w uczciwej prognozie zero. Silnik już niesie to, co RAPM wie z innych sezonów. nbarapm (2019-2026) nie jest wart wysiłku.

## Squared Statistics — Historical RAPM (sprawdzone 2026-11-25)
- Justin Jacobs: stinty odtwarzane ręcznie z wideo, 1969-70 … 1995-96; 2068 z ~12 600 meczów (16%), 9 sezonów opublikowanych (1969-70, 1979-80, 1984-85, 1987-88 … 1992-93), np. 1987-88 189 / 943 meczów.
- Tabele jako obrazki (zrzuty ekranu), bez pliku; „dane będą szerzej dostępne, gdy projekt będzie pełniejszy”, zakładka „Data and Consulting”.
- Na teraz nieużywalne (za mała próba, brak plików). Wrócić, gdy autor udostępni dane — narzędzia (lookup + `OVR_BPM_SRC`) są gotowe.

## Test cech pbpstats jako składnika Overall (2026-11-25, `scripts/_pbpgrid.sh`, `reports/pbpgrid.txt`)
- Dane: 1216 graczy, 98% okien 2000+; usage zgodne z NBA.com r 1.000.
- 11 cech × waga ±1 (z-score ważony minutami rotacji): wszystkie w ±0.003 SRS / prognozy (bez zmian 0.877 / 0.671). On/off: SRS 0.881 / prognoza 0.667 (wiedza z tego samego sezonu).
- Wniosek: jako osobne składniki oceny nic nie wnoszą — box już to niesie. Używać punktowo: opisy / role graczy i decyzje AI (rzut po podaniu vs z kozła, strefy), mechanika meczu (straty w akcji, faule, strefy), wąskie reguły (ulga strzelca bez piłki z realnego % asyst zamiast skilla).

## Test ery (2026-11-25, `ERA_MASK=1`): drużyny 1997+ liczone „jak w latach 1974-96”
| | pełne dane | jak 1974-96 |
|---|---|---|
| SRS (527 drużyn 1997+) | 0.877 | 0.871 |
| prognoza | 0.681 | 0.665 |
| atak vs ORtg | 0.7918 | 0.7852 |
| **obrona vs DRtg** | **0.8300** | **0.7972** |
- Pomosty tracą mało w ataku i w całości (−0.006 SRS); najwięcej w obronie (−0.033): dane nowej ery (DARKO, RAPTOR, obrona ze śledzenia, „help”) niosą obronę, której box nie widzi; skill „help” z box ma hold-out r 0.44-0.68.
- Wniosek: przebudowa dla starszych graczy — obrona (most D-TAL z box + BBRef advanced na 1997+), nie atak.

## Defense reputation test (2026-11-25)

Question: can written defensive reputation (web sources) recover what the box-score bridge loses on defense for pre-1997 players?

- **Pilot, 30 extreme gaps from 1997+.** Labels came from model knowledge, not web search. Label vs mask gap: r 0.82. Mask alone vs true D-TAL: r 0.76. Mask plus label: r 0.94, at 13.6 points per level. Inflated by the selection.
- **Random 40 from 1997+, web-searched.** Gap sd 4.3. Mask vs true D-TAL: r 0.98. Label vs gap: r 0.42, about 1.7 points per level. Mask plus label stays at r 0.983, so no gain. The pilot coefficient overshoots (r 0.95).
- **150 key pre-1997 players, web-searched** (`src/data/raw/defRep`, `src/data/defRep.json`). Knob `DEF_REP_W` / `DEF_REP_MODE` in `defensiveTalent.ts`, off. Defense judge, 541 pre-1997 team-seasons, real DRtg:

| Variant | pre-1997 |
|---|---|
| base | 0.8658 |
| extreme W=2 | 0.8641 |
| extreme W=4 | 0.8617 |
| all W=1 | 0.8638 |
| all W=2 | 0.8660 |
| all W=4 | 0.8640 |

Conclusion: rejected. The engine's pre-1997 defense already tracks real DRtg (0.866, higher than 1997+), and reputation adds nothing beyond noise. The knob stays off.
