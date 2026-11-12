import assert from 'node:assert/strict';
import { draftPoints, draftXp, levelOf } from '../src/online/careerPoints';

const free = { daily: false, title: false };
assert.equal(draftPoints({ ...free, mode: 'alltime', place: 1, field: 12 }), 5);
assert.equal(draftPoints({ ...free, mode: 'alltime', place: 12, field: 12 }), -5);
assert.equal(draftPoints({ ...free, mode: 'alltime', place: 1, field: 12, title: true }), 7);
assert.equal(draftPoints({ ...free, mode: 'drawfive', place: 2, field: 2 }), -2);
assert.equal(draftPoints({ ...free, mode: 'mini', place: 16, field: 16 }), -3);
assert.equal(draftPoints({ daily: true, title: false, mode: 'alltime', place: 1, field: 12 }), 0, 'dailies score on their own table');
// Grinding weak drafts costs: a bottom-half run never pays.
for (let place = 7; place <= 12; place++) assert.ok(draftPoints({ ...free, mode: 'alltime', place, field: 12 }) < 0);
assert.equal(draftXp({ daily: false, place: 12, field: 12, won: false, title: false }), 10);
assert.equal(draftXp({ daily: false, place: 1, field: 12, won: false, title: true }), 35);
assert.ok(draftXp({ daily: true, place: 1, field: 12, won: false, title: true }) <= 60, 'the server caps XP at 60');
assert.deepEqual(levelOf(0), { level: 1, into: 0, next: 40 });
assert.equal(levelOf(40).level, 2);
assert.equal(levelOf(160).level, 3);
console.log('career points ok');
