// Unit tests for the pure card filter in src/filter.ts.
import { test, assert, assertEqual } from './harness.js';
import { cardMatchesFilter, emptyFilter, isFilterActive } from '../src/filter.js';
const NOW = 1000000000000;
const HOUR = 60 * 60 * 1000;
function card(patch) {
    return {
        id: 'c',
        text: '',
        description: '',
        labelIds: [],
        checklist: [],
        comments: [],
        dueAt: null,
        dueDone: false,
        color: '',
        createdAt: 0,
        ...patch,
    };
}
test('empty filter matches everything and is inactive', () => {
    const f = emptyFilter();
    assert(!isFilterActive(f), 'empty filter is inactive');
    assert(cardMatchesFilter(card({ text: 'anything' }), f, NOW), 'matches any card');
});
test('keyword matches text or description, case-insensitively', () => {
    const f = { ...emptyFilter(), query: 'Bug' };
    assert(isFilterActive(f), 'keyword makes it active');
    assert(cardMatchesFilter(card({ text: 'fix BUG now' }), f, NOW), 'matches text');
    assert(cardMatchesFilter(card({ description: 'a bug here' }), f, NOW), 'matches description');
    assert(!cardMatchesFilter(card({ text: 'feature' }), f, NOW), 'rejects non-match');
});
test('label filter matches any selected label', () => {
    const f = { ...emptyFilter(), labelIds: ['L1', 'L2'] };
    assert(cardMatchesFilter(card({ labelIds: ['L2'] }), f, NOW), 'matches one of the labels');
    assert(!cardMatchesFilter(card({ labelIds: ['L3'] }), f, NOW), 'rejects other labels');
    assert(!cardMatchesFilter(card({ labelIds: [] }), f, NOW), 'rejects no labels');
});
test('due filters classify cards correctly', () => {
    const overdue = card({ dueAt: NOW - HOUR });
    const soon = card({ dueAt: NOW + HOUR });
    const far = card({ dueAt: NOW + 48 * HOUR });
    const done = card({ dueAt: NOW - HOUR, dueDone: true });
    const none = card({ dueAt: null });
    const has = { ...emptyFilter(), due: 'has' };
    assert(cardMatchesFilter(soon, has, NOW) && !cardMatchesFilter(none, has, NOW), 'has');
    const noDue = { ...emptyFilter(), due: 'none' };
    assert(cardMatchesFilter(none, noDue, NOW) && !cardMatchesFilter(soon, noDue, NOW), 'none');
    const od = { ...emptyFilter(), due: 'overdue' };
    assert(cardMatchesFilter(overdue, od, NOW), 'overdue matches past');
    assert(!cardMatchesFilter(done, od, NOW), 'overdue ignores completed');
    assert(!cardMatchesFilter(soon, od, NOW), 'overdue ignores future');
    const sn = { ...emptyFilter(), due: 'soon' };
    assert(cardMatchesFilter(soon, sn, NOW), 'soon matches within 24h');
    assert(!cardMatchesFilter(far, sn, NOW), 'soon ignores far future');
    assert(!cardMatchesFilter(overdue, sn, NOW), 'soon ignores overdue');
    const dn = { ...emptyFilter(), due: 'done' };
    assert(cardMatchesFilter(done, dn, NOW) && !cardMatchesFilter(overdue, dn, NOW), 'done');
});
test('parts combine with AND', () => {
    const f = { query: 'api', labelIds: ['L1'], due: 'overdue' };
    const good = card({ text: 'API call', labelIds: ['L1'], dueAt: NOW - HOUR });
    const wrongLabel = card({ text: 'API call', labelIds: ['L2'], dueAt: NOW - HOUR });
    assert(cardMatchesFilter(good, f, NOW), 'all parts satisfied');
    assert(!cardMatchesFilter(wrongLabel, f, NOW), 'one failing part rejects');
    assertEqual(isFilterActive(f), true, 'active');
});
