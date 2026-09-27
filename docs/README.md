# Draftverse — instrukcja obsługi kodu

Ta instrukcja wyjaśnia, co jest czym w kodzie gry i jak to działa: od kliknięcia w menu, przez
draft i ocenę drużyny, po ekran wyników. Jest pisana dla człowieka, nie dla kompilatora — szczegóły
implementacji są w kodzie, tutaj jest obraz całości i powody decyzji.

> Strona 1 z 7 · **Mapa projektu** · stan na 2026-09-27

## Spis treści

1. **Mapa projektu** ← ta strona
2. Jak działa gra, krok po kroku — tryby, draft, AI, rotacja, wyniki *(w przygotowaniu)*
3. Silnik oceny — TAL, ofensywa i obrona, spacing, fit, finishing, durability, portability *(w przygotowaniu)*
4. Kalibracja — tiery, ręczne korekty, playoffs *(w przygotowaniu)*
5. Dane — skąd pochodzą, jak je zbudować i odświeżyć *(w przygotowaniu)*
6. Jak zmieniać rzeczy — dodać gracza, poprawić ocenę, dodać ekran, testy, wdrożenie *(w przygotowaniu)*
7. Słowniczek *(w przygotowaniu)*

---

## Czym jest gra w jednym akapicie

Draftverse to przeglądarkowa gra o budowaniu drużyny NBA z graczy wszystkich epok. Gracz wybiera
zawodników — każdy w konkretnym okresie kariery (np. „Kobe Bryant 2007-09”) — i musi zmieścić się
w limicie **capów**, czyli sumie rzutów na mecz jego zawodników. Potem silnik ocenia drużynę tak,
jak ocenia się prawdziwy skład: talent, atak, obronę, rozstawienie na parkiecie, dopasowanie
graczy do siebie i rotację. Nie ma serwera — cała gra, łącznie z oceną, działa w przeglądarce.

## Trzy tryby

| Tryb | Co robi gracz | Główny plik |
|---|---|---|
| **Roulette** | Losuje po 4 graczy na każdą pozycję (automat z dźwignią), wybiera piątkę pod limit capów danej planszy. Wynik porównany z „fan-vote five” (5 największych nazwisk) i najlepszą możliwą piątką. | `src/components/BestFive.tsx`, `src/engine/bestFive.ts` |
| **Mini Draft** | Draft na żywo: 16 drużyn, 5 rund, limit 70 capów, tylko pierwsza piątka. | `src/components/QuickFive.tsx`, `src/engine/quickDraft.ts` |
| **All-Time Draft** | Pełna gra: 16 drużyn, 9 rund, limit 100,9 capa, ławka i rotacja minut. Ranking całej ligi, symulacja sezonu i playoffs. | `src/components/GameShell.tsx`, `DraftBoard.tsx`, `ResultsScreen.tsx`, `src/engine/draft.ts` |

Menu układa je w ścieżkę nauki: krok 1 Roulette (uczy capów), krok 2 Mini Draft, krok 3 All-Time.

## Technologia

- **React 19 + TypeScript**, budowane przez **Vite**. Brak backendu i bazy danych.
- Hosting: **GitHub Pages** (`erykslek1997-dotcom.github.io/draft-game/`). Każdy merge do `main`
  uruchamia `.github/workflows/deploy.yml`, który buduje i publikuje stronę.
- Zapis postępu tylko w przeglądarce (`localStorage`): trwający draft, ukończone kroki ścieżki.
- Wyzwania dla znajomych działają przez link — wynik nadawcy jest zapisany w adresie URL.

## Mapa folderów

```
draft-game/
├── src/
│   ├── main.tsx, App.tsx      start aplikacji, menu, przełączanie trybów
│   ├── components/  (36)      ekrany i elementy interfejsu (React)
│   ├── engine/      (96)      silnik: ocena graczy i drużyn, AI, draft, symulacje
│   ├── data/        (32)      dane graczy (JSON) i ich wczytywanie
│   └── styles/      (10)      style CSS, po jednym pliku na obszar ekranu
├── scripts/         (73)      budowanie danych, testy, walidacja kalibracji (Node, nie w grze)
├── public/                    zdjęcia graczy i pliki statyczne
├── docs/                      ta instrukcja
├── compactJson.ts             kompresja danych przy budowaniu strony
├── vite.config.ts             konfiguracja budowania
└── TODO.md                    lista zadań i decyzji
```

### `src/engine` — silnik (serce gry)

Czysta logika, bez interfejsu. Da się go uruchomić w Node (tak działają testy w `scripts/`).
Najważniejsze grupy:

| Grupa | Pliki | Co robi |
|---|---|---|
| Ocena gracza | `talent.ts`, `grades.ts`, `tierCalibration.ts`, `defensiveTalent.ts`, `portability.ts`, `spacing.ts`, `finishing.ts`, `durability.ts` | Liczy TAL (ogólny talent) i oceny cząstkowe dla każdego okresu kariery. |
| Ocena drużyny | `scoring.ts`, `fit.ts`, `defense.ts`, `teamModel.ts`, `rotation.ts` | Składa oceny graczy w ocenę drużyny: talent, atak, obrona, spacing, fit, ławka, rotacja. |
| Draft | `draft.ts`, `quickDraft.ts`, `positions.ts`, `aiDrafter.ts` | Kolejność wyborów, limit capów, legalność wyboru, decyzje 15 drużyn komputera. |
| Symulacje | `leagueSimulation.ts`, `seasonSimulation.ts`, `playoffSimulation.ts` | Szanse w serii do 4 zwycięstw, sezon 82 meczów, drabinka playoffs. |
| Opisy | `insights.ts`, `insightMapper.ts`, `draftDesk.ts`, `historicalComps.ts` | Zdania „co zadziałało / co zawiodło”, komentatorzy po 3. picku, „gra jak Detroit 2004”. |
| Roulette | `bestFive.ts` | Losowanie planszy, limit capów, najlepsza piątka, ocena wyniku. |
| Dostęp do danych | `*Lookup.ts` (22 pliki) | Każdy czyta jedno źródło danych (np. `bpm2Lookup.ts`, `usageLookup.ts`) i odpowiada na pytanie o konkretny okres kariery. |

### `src/data` — dane

- `draftPool.json` — **pula draftu**: 10 161 okresów kariery 1 438 graczy. To z niej się wybiera.
- `generatedPlayers.json` — pełne archiwum (12 172 okresy), z którego silnik liczy percentyle i porównania.
- `awards/` — źródła: statystyki zaawansowane (BPM, DARKO, RAPTOR, PIPM…), nagrody, strefy rzutowe, dostępność.
- `precomputedTiers.json`, `runtimePercentiles.json`, `runtimeSpanLookups.json` — wyniki policzone
  wcześniej przez skrypty, żeby gra nie liczyła ich przy każdym uruchomieniu.
- `userTierCalibration.ts` — ręczna tabela tierów 200 graczy, ustalona razem z właścicielem gry.

### `src/components` — interfejs

Każdy ekran to komponent React. Najważniejsze:

- `GameShell.tsx` — prowadzi All-Time Draft przez etapy: loteria → draft → wyniki.
- `DraftBoard.tsx` — ekran draftu (karty graczy, zakładka Team, rotacja).
- `ResultsScreen.tsx` — wyniki All-Time: tablica wyniku, ranking, szanse w seriach, sezon.
- `BestFive.tsx`, `QuickFive.tsx` — całe tryby Roulette i Mini Draft.
- Wspólne klocki: `ScoreBoard.tsx` (tablica wyniku), `ShotChip.tsx` (capy i twarze graczy),
  `DraftChrome.tsx` (pasek statusu draftu), `DraftLottery.tsx` (losowanie miejsca w drafcie).

## Jak to się łączy

```
dane JSON (src/data)
      │  wczytane raz, przy pierwszym wejściu w tryb (gameLoader.ts pokazuje pasek postępu)
      ▼
lookupy (src/engine/*Lookup.ts)  →  ocena gracza (talent.ts, grades.ts …)
                                           │
                                           ▼
                        draft (draft.ts, aiDrafter.ts)  →  ocena drużyny (scoring.ts, fit.ts)
                                                                  │
                                                                  ▼
                                    symulacje i opisy  →  ekrany (src/components)
```

Dwa ważne szczegóły:

- **Silnik ładuje się dopiero po wybraniu trybu.** Menu jest lekkie; dane (ok. 16 MB, po kompresji
  3,7 MB) pobierają się w tle, a wybrany tryb czeka na nie z paskiem postępu.
- **Przy budowaniu dane są kompresowane** (`compactJson.ts`) — ta sama treść, zapisana
  kolumnami zamiast powtarzania nazw pól w każdym wierszu. Plik JSON w repozytorium się nie zmienia.

## Najważniejsze liczby

| | |
|---|---|
| Drużyny w drafcie | 16 |
| Skład All-Time | 9 (5 w pierwszej piątce + 4 na ławce) |
| Limit capów | 100,9 (All-Time), 70 (Mini Draft), ustalany osobno dla każdej planszy (Roulette) |
| Pula draftu | 10 161 okresów kariery, 1 438 graczy |
| Testy | 25 plików w `scripts/test*.ts`; `npm test` uruchamia 24 z nich |

## Jak uruchomić

```bash
npm install
npm run dev          # wersja deweloperska na http://localhost:5173/draft-game/
npm run build        # pełne budowanie strony do folderu dist/
npm run test:fast    # szybkie testy (kilka minut)
npm test             # wszystkie testy
```

---

*Następna strona: **2. Jak działa gra, krok po kroku.***
