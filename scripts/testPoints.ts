import { dailyPoints, medianOf, placePoints, seasonPoints, streakBonus } from '../src/online/points';

// 2026-11-11: the daily leaderboard's points (src/online/points.ts).
let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) console.log(`PASS: ${label}`);
  else {
    failures++;
    console.error(`FAIL: ${label} ${detail}`);
  }
}
check(placePoints(1, 16) === 40 && placePoints(2, 16) === 34 && placePoints(3, 16) === 30, 'podium 40 / 34 / 30');
check(placePoints(4, 16) === 28 && placePoints(16, 16) === 4, 'then 2 a place down to 4 for last of 16', `${placePoints(4, 16)} ${placePoints(16, 16)}`);
check(seasonPoints(60, 22, 'Champions') === Math.round((60 / 82 * 25 + 22) * 10) / 10, 'a 60-22 champion');
check(seasonPoints(30, 52, 'Missed the playoffs') < 10, 'a lottery team gets little');
check(streakBonus(1) === 0 && streakBonus(3) === 4 && streakBonus(20) === 10, 'streak +2 a day after the first, up to +10');
check(medianOf([1, 3, 2]) === 2 && medianOf([1, 2, 3, 4]) === 2.5, 'median');
const best = dailyPoints({ mode: 'alltime', place: 1, field: 16, overall: 99, median: 80, season: { wins: 82, losses: 0, playoffs: 'Champions' }, streak: 1 });
check(best.total === 97, 'a perfect All-Time day is 97 before the streak', `${best.total}`);
const mini = dailyPoints({ mode: 'mini', place: 1, field: 8, overall: 90, median: 70, streak: 6 });
check(mini.draft === 100 && mini.total === 110, 'Mini doubles the draft part (100) plus the streak', `${mini.draft} ${mini.total}`);
if (failures) process.exit(1);
console.log('\nAll points checks passed.');
