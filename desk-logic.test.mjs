import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  normalizeItem,
  deduplicateDayItems,
  deduplicateRecurringSameDay,
  deduplicateAcrossDays,
  planRecurringInject,
  applyCarryThenInject,
  advanceLastInjectedDate,
  mergeRecurringTemplates,
  scoreItemForMerge,
  pickMergedItem,
  dayHasRecurringInstance,
  isDueOnDate,
  recurringContentKey,
  toggleTaskCompleted,
  resolveBoardColumn,
  mergeImportDaysData,
  mergeDeletedIds,
  moveItemInDays,
  carryUnfinishedFromPastDays,
  mergeDaysData,
  pickBestIdPlacement,
  AUTO_COLLAPSE_AT_OPTIONS,
  normalizeAutoCollapseAt,
  shouldAutoCollapseCompleted,
  normalizeTag,
  normalizeTagList,
  mergeTags,
  extractHashtags,
  mergeItemComments,
  mergeProjectsData,
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  getUSFederalHolidays,
  checkHoliday,
} from '../lib/desk-logic.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '../work-desk.html'), 'utf8');
const indexHtml = readFileSync(join(__dirname, '../index.html'), 'utf8');

function extractMainScript(source) {
  const blocks = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.ok(blocks.length, 'expected at least one script block');
  return blocks.sort((a, b) => b.length - a.length)[0];
}

function task(partial) {
  return {
    type: 'task',
    completed: false,
    shelved: false,
    boardColumn: 'active',
    comments: [],
    createdAt: '2026-08-11T12:00:00.000Z',
    content: 'Task',
    ...partial,
  };
}

describe('normalizeItem', () => {
  it('preserves recurringTemplateId through normalize (regression)', () => {
    const n = normalizeItem(task({
      id: 'a',
      content: 'Update the ACE Dashboard',
      recurringTemplateId: 'tmpl-1',
      completed: true,
    }));
    assert.equal(n.recurringTemplateId, 'tmpl-1');
    assert.equal(n.completed, true);
  });

  it('does not invent recurringTemplateId', () => {
    assert.equal(normalizeItem(task({ id: 'a' })).recurringTemplateId, undefined);
  });
});

describe('recurring inject', () => {
  const template = {
    id: 'tmpl-ace',
    content: '<p>Update the ACE Dashboard</p>',
    rule: 'daily',
    lastInjectedDate: null,
  };

  it('does not inject when a completed instance already exists today', () => {
    const result = planRecurringInject({
      templates: [template],
      today: '2026-08-12',
      todayItems: [
        task({
          id: 'done',
          content: '<p>Update the ACE Dashboard</p>',
          recurringTemplateId: 'tmpl-ace',
          completed: true,
        }),
      ],
      newId: () => 'should-not-create',
    });
    assert.equal(result.injectedCount, 0);
    assert.equal(result.items.length, 1);
    assert.equal(result.updatedTemplates[0].lastInjectedDate, '2026-08-12');
  });

  it('does not inject when orphan content matches (stripped template id)', () => {
    const result = planRecurringInject({
      templates: [template],
      today: '2026-08-12',
      todayItems: [
        task({
          id: 'orphan',
          content: '<p>Update the ACE Dashboard</p>',
          completed: true,
        }),
      ],
      newId: () => 'should-not-create',
    });
    assert.equal(result.injectedCount, 0);
    assert.equal(dayHasRecurringInstance({ items: result.items }, template), true);
  });

  it('injects once when today is empty and due', () => {
    let n = 0;
    const result = planRecurringInject({
      templates: [template],
      today: '2026-08-12',
      todayItems: [],
      newId: () => `new-${++n}`,
    });
    assert.equal(result.injectedCount, 1);
    assert.equal(result.items[0].recurringTemplateId, 'tmpl-ace');
  });

  it('collapses two same-template copies preferring completed', () => {
    const { items, removed } = deduplicateRecurringSameDay([
      task({ id: 'open', content: 'ACE', recurringTemplateId: 'tmpl-ace' }),
      task({ id: 'done', content: 'ACE', recurringTemplateId: 'tmpl-ace', completed: true }),
    ], [template]);
    assert.equal(removed, 1);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'done');
    assert.equal(items[0].completed, true);
  });

  it('collapses same content even when template ids differ', () => {
    const { items, removed } = deduplicateRecurringSameDay([
      task({ id: 'a', content: '<p>Update the ACE Dashboard</p>', recurringTemplateId: 'tmpl-a' }),
      task({ id: 'b', content: '<p>Update the ACE Dashboard</p>', recurringTemplateId: 'tmpl-b' }),
    ], [
      { id: 'tmpl-a', content: '<p>Update the ACE Dashboard</p>', rule: 'weekdays' },
      { id: 'tmpl-b', content: '<p>Update the ACE Dashboard</p>', rule: 'weekdays' },
    ]);
    assert.equal(removed, 1);
    assert.equal(items.length, 1);
    assert.ok(items[0].recurringTemplateId);
  });

  it('does not collapse two manual tasks with identical text and no template link', () => {
    const { items, removed } = deduplicateRecurringSameDay([
      task({ id: 'a', content: 'Buy milk' }),
      task({ id: 'b', content: 'Buy milk' }),
    ], []);
    assert.equal(removed, 0);
    assert.equal(items.length, 2);
  });

  it('injects only once when two templates share the same content', () => {
    let n = 0;
    const result = planRecurringInject({
      templates: [
        { id: 'tmpl-a', content: '<p>Update the ACE Dashboard</p>', rule: 'weekdays', lastInjectedDate: null },
        { id: 'tmpl-b', content: '<p>Update the ACE Dashboard</p>', rule: 'weekdays', lastInjectedDate: null },
      ],
      today: '2026-08-17',
      todayItems: [],
      newId: () => `new-${++n}`,
    });
    assert.equal(result.injectedCount, 1);
    assert.equal(result.items.filter(i => recurringContentKey(i.content) === 'update the ace dashboard').length, 1);
  });
});

describe('carry then inject order', () => {
  const template = {
    id: 'tmpl-ace',
    content: 'Update ACE',
    rule: 'daily',
    lastInjectedDate: null,
  };

  it('carry-then-inject does not duplicate an open recurring task from yesterday', () => {
    let n = 0;
    const { days } = applyCarryThenInject({
      yesterday: '2026-08-11',
      today: '2026-08-12',
      templates: [template],
      newId: () => `inj-${++n}`,
      days: {
        '2026-08-11': {
          date: '2026-08-11',
          items: [
            task({
              id: 'yest',
              content: 'Update ACE',
              recurringTemplateId: 'tmpl-ace',
            }),
          ],
        },
      },
    });
    const todayItems = days['2026-08-12'].items.filter(i => i.recurringTemplateId === 'tmpl-ace');
    assert.equal(todayItems.length, 1);
    assert.equal(todayItems[0].id, 'yest');
  });

  it('auto-carry pulls unfinished open tasks from all past days with ID dedupe', () => {
    const { days, carriedCount } = carryUnfinishedFromPastDays({
      '2026-08-09': {
        date: '2026-08-09',
        items: [
          task({ id: 'old', content: 'Parked older', boardColumn: 'new' }),
          task({ id: 'done-old', content: 'Done', completed: true }),
          task({ id: 'shelved-old', content: 'Shelved', shelved: true }),
        ],
      },
      '2026-08-11': {
        date: '2026-08-11',
        items: [
          task({ id: 'yest', content: 'From yesterday' }),
          task({ id: 'old', content: 'Same id newer copy' }),
        ],
      },
      '2026-08-12': {
        date: '2026-08-12',
        items: [task({ id: 'today-only', content: 'Already today' })],
      },
    }, '2026-08-12');

    assert.equal(carriedCount, 2);
    // Completed/shelved stay on the old day; only open unfinished moved
    assert.deepEqual(
      days['2026-08-09'].items.map(i => i.id).sort(),
      ['done-old', 'shelved-old'],
    );
    assert.equal(days['2026-08-11'], undefined);
    const ids = days['2026-08-12'].items.map(i => i.id).sort();
    assert.deepEqual(ids, ['old', 'today-only', 'yest']);
    assert.equal(days['2026-08-12'].items.find(i => i.id === 'old').content, 'Same id newer copy');
  });
});

describe('toggleTaskCompleted / boardColumn', () => {
  it('uncomplete preserves New column', () => {
    const done = task({ id: 'a', boardColumn: 'new', completed: true });
    const open = toggleTaskCompleted(done);
    assert.equal(open.completed, false);
    assert.equal(open.boardColumn, 'new');
  });

  it('defaults unknown boardColumn to active', () => {
    assert.equal(resolveBoardColumn({}), 'active');
    assert.equal(toggleTaskCompleted(task({ id: 'a', boardColumn: 'weird', completed: true })).boardColumn, 'active');
  });
});

describe('import/export tombstones', () => {
  it('mergeImportDaysData keeps deletedIds and strips resurrected items', () => {
    const ts = '2026-08-12T10:00:00.000Z';
    const merged = mergeImportDaysData(
      {
        days: {
          '2026-08-12': { date: '2026-08-12', items: [task({ id: 'keep' }), task({ id: 'gone' })] },
        },
        deletedIds: { gone: ts },
      },
      {
        days: {
          '2026-08-12': { date: '2026-08-12', items: [task({ id: 'gone' }), task({ id: 'imported' })] },
        },
        deletedIds: {},
      },
    );
    assert.ok(merged.deletedIds.gone);
    const ids = merged.days['2026-08-12'].items.map(i => i.id).sort();
    assert.deepEqual(ids, ['imported', 'keep']);
  });

  it('mergeDeletedIds prefers later tombstone', () => {
    const merged = mergeDeletedIds(
      { a: '2026-08-10T00:00:00.000Z' },
      { a: '2026-08-12T00:00:00.000Z', b: '2026-08-12T00:00:00.000Z' },
    );
    assert.equal(merged.a, '2026-08-12T00:00:00.000Z');
    assert.equal(merged.b, '2026-08-12T00:00:00.000Z');
  });
});

describe('moveItemInDays', () => {
  it('removes the ID from every day before placing on target', () => {
    const { days, moved } = moveItemInDays({
      '2026-08-10': { date: '2026-08-10', items: [task({ id: 'x', content: 'Older' })] },
      '2026-08-11': { date: '2026-08-11', items: [task({ id: 'x', content: 'Newer' }), task({ id: 'y' })] },
    }, 'x', '2026-08-13');
    assert.equal(moved, true);
    assert.equal(days['2026-08-10'], undefined);
    assert.equal(days['2026-08-11'].items.map(i => i.id).join(), 'y');
    assert.equal(days['2026-08-13'].items.length, 1);
    assert.equal(days['2026-08-13'].items[0].content, 'Newer');
  });
});

describe('lastInjectedDate advancement', () => {
  it('completing a past-day instance must not stamp today', () => {
    const templates = [{ id: 't1', lastInjectedDate: '2026-08-10', content: 'x', rule: 'daily' }];
    const next = advanceLastInjectedDate(templates, 't1', '2026-08-11');
    assert.equal(next[0].lastInjectedDate, '2026-08-11');
    assert.equal(isDueOnDate(next[0], '2026-08-12'), true);
  });

  it('deleting today instance stamps today and blocks re-inject', () => {
    const templates = [{ id: 't1', lastInjectedDate: null, content: 'x', rule: 'daily' }];
    const next = advanceLastInjectedDate(templates, 't1', '2026-08-12');
    assert.equal(isDueOnDate(next[0], '2026-08-12'), false);
  });
});

describe('sync merge scoring', () => {
  it('shelved local beats remote open task with one comment', () => {
    const local = task({ id: 'a', shelved: true, comments: [] });
    const remote = task({
      id: 'a',
      comments: [{ id: 'c1', content: 'hi', createdAt: '2026-08-12T00:00:00.000Z' }],
    });
    assert.ok(scoreItemForMerge(local) > scoreItemForMerge(remote));
    const picked = pickMergedItem(local, remote);
    assert.equal(picked.shelved, true);
    assert.equal(picked.comments.length, 1);
  });

  it('completed local beats remote open with comments', () => {
    const local = task({ id: 'a', completed: true });
    const remote = task({
      id: 'a',
      comments: [
        { id: 'c1', content: 'a', createdAt: 'x' },
        { id: 'c2', content: 'b', createdAt: 'x' },
      ],
    });
    const picked = pickMergedItem(local, remote);
    assert.equal(picked.completed, true);
    assert.equal(picked.comments.length, 2);
  });
});

describe('mergeDaysData (cross-device / stale local)', () => {
  it('remote completed on an older day beats local open carried to today', () => {
    // Device B: stale open copy auto-carried to today before sync
    const local = {
      days: {
        '2026-08-15': {
          date: '2026-08-15',
          items: [task({ id: 'task-1', content: 'Finish report', boardColumn: 'active' })],
        },
      },
      deletedIds: {},
    };
    // Device A (cloud): same ID completed on a previous day
    const remote = {
      days: {
        '2026-08-12': {
          date: '2026-08-12',
          items: [task({ id: 'task-1', content: 'Finish report', completed: true })],
        },
      },
      deletedIds: {},
    };

    const merged = mergeDaysData(local, remote);
    const all = Object.values(merged.days).flatMap(d => d.items);
    assert.equal(all.length, 1);
    assert.equal(all[0].completed, true);
    assert.equal(merged.days['2026-08-12']?.items?.[0]?.id, 'task-1');
    assert.equal(merged.days['2026-08-15'], undefined);
  });

  it('remote shelved on an older day beats local open on today', () => {
    const local = {
      days: {
        '2026-08-15': {
          date: '2026-08-15',
          items: [task({ id: 'task-2', content: 'Parked work' })],
        },
      },
      deletedIds: {},
    };
    const remote = {
      days: {
        '2026-08-10': {
          date: '2026-08-10',
          items: [task({ id: 'task-2', content: 'Parked work', shelved: true })],
        },
      },
      deletedIds: {},
    };

    const merged = mergeDaysData(local, remote);
    const all = Object.values(merged.days).flatMap(d => d.items);
    assert.equal(all.length, 1);
    assert.equal(all[0].shelved, true);
    assert.equal(merged.days['2026-08-10']?.items?.[0]?.id, 'task-2');
  });

  it('pickBestIdPlacement prefers completed over newer open day', () => {
    const openToday = {
      date: '2026-08-15',
      item: task({ id: 'x', content: 'X' }),
    };
    const doneEarlier = {
      date: '2026-08-12',
      item: task({ id: 'x', content: 'X', completed: true }),
    };
    const best = pickBestIdPlacement(openToday, doneEarlier);
    assert.equal(best.date, '2026-08-12');
    assert.equal(best.item.completed, true);
  });
});

describe('same-id day dedupe', () => {
  it('merges comments and keeps completed state', () => {
    const items = deduplicateDayItems([
      task({ id: 'a', comments: [{ id: 'c1', content: 'one', createdAt: 'x' }] }),
      task({ id: 'a', completed: true, comments: [{ id: 'c2', content: 'two', createdAt: 'x' }] }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].completed, true);
    assert.equal(items[0].comments.length, 2);
  });
});

describe('mergeRecurringTemplates', () => {
  it('keeps later lastInjectedDate and local content', () => {
    const merged = mergeRecurringTemplates(
      [{ id: 't1', content: 'Local', rule: 'daily', lastInjectedDate: '2026-08-11' }],
      [{ id: 't1', content: 'Remote', rule: 'weekdays', lastInjectedDate: '2026-08-12' }],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].lastInjectedDate, '2026-08-12');
    assert.equal(merged[0].content, 'Local');
  });
});

describe('mergeProjectsData (project task/note deletion tombstones)', () => {
  it('a task deleted locally does not get resurrected by a stale remote copy', () => {
    const local = {
      projects: [
        {
          id: 'proj-1',
          name: 'Test Project',
          notes: [],
          tasks: [task({ id: 'keep-task', content: 'Still here' })],
        },
      ],
      deletedIds: { 'gone-task': '2026-08-26T09:00:00.000Z' },
    };
    // Remote hasn't received the deletion yet — still has the deleted task.
    const remote = {
      projects: [
        {
          id: 'proj-1',
          name: 'Test Project',
          notes: [],
          tasks: [
            task({ id: 'keep-task', content: 'Still here' }),
            task({ id: 'gone-task', content: 'Should stay deleted' }),
          ],
        },
      ],
      deletedIds: {},
    };

    const merged = mergeProjectsData(local, remote);
    const ids = merged.projects[0].tasks.map(t => t.id).sort();
    assert.deepEqual(ids, ['keep-task']);
    assert.ok(merged.deletedIds['gone-task']);
  });

  it('a note deleted remotely does not get resurrected by a stale local copy', () => {
    const local = {
      projects: [
        {
          id: 'proj-1',
          name: 'Test Project',
          notes: [task({ id: 'gone-note', content: 'Deleted on other device' })],
          tasks: [],
        },
      ],
      deletedIds: {},
    };
    const remote = {
      projects: [
        {
          id: 'proj-1',
          name: 'Test Project',
          notes: [],
          tasks: [],
        },
      ],
      deletedIds: { 'gone-note': '2026-08-26T09:05:00.000Z' },
    };

    const merged = mergeProjectsData(local, remote);
    assert.deepEqual(merged.projects[0].notes, []);
    assert.ok(merged.deletedIds['gone-note']);
  });

  it('a brand-new remote-only project has its tombstoned items stripped on adoption', () => {
    const local = { projects: [], deletedIds: { 'gone-task': '2026-08-26T09:00:00.000Z' } };
    const remote = {
      projects: [
        {
          id: 'proj-2',
          name: 'Remote-only Project',
          notes: [],
          tasks: [
            task({ id: 'gone-task', content: 'Deleted elsewhere' }),
            task({ id: 'keep-task', content: 'Fine' }),
          ],
        },
      ],
      deletedIds: {},
    };

    const merged = mergeProjectsData(local, remote);
    const ids = merged.projects[0].tasks.map(t => t.id);
    assert.deepEqual(ids, ['keep-task']);
  });

  it('still unions non-deleted tasks/notes and keeps the higher-comment-count version on conflict', () => {
    const local = {
      projects: [
        {
          id: 'proj-1',
          name: 'Test Project',
          notes: [],
          tasks: [task({ id: 'shared', content: 'v1', comments: [] })],
        },
      ],
      deletedIds: {},
    };
    const remote = {
      projects: [
        {
          id: 'proj-1',
          name: 'Test Project',
          notes: [],
          tasks: [task({ id: 'shared', content: 'v2', comments: [{ id: 'c1', text: 'update' }] })],
        },
      ],
      deletedIds: {},
    };

    const merged = mergeProjectsData(local, remote);
    assert.equal(merged.projects[0].tasks.length, 1);
    assert.equal(merged.projects[0].tasks[0].content, 'v2');
  });
});

describe('HTML invariants (work-desk.html stays aligned)', () => {
  it('normalizeItem preserves recurringTemplateId', () => {
    assert.match(html, /normalized\.recurringTemplateId\s*=\s*item\.recurringTemplateId/);
  });

  it('startup runs carry before inject', () => {
    const sync = html.slice(html.indexOf('async function sbPostAuthSync'));
    const carryAt = sync.indexOf('carryForwardUnfinished(');
    const injectAt = sync.indexOf('injectDueTemplates()');
    assert.ok(carryAt > -1);
    assert.ok(injectAt > -1);
    assert.ok(carryAt < injectAt, 'carry must run before inject after sync');
  });

  it('sync merge resolves IDs globally (stale open cannot hide remote completed)', () => {
    assert.match(html, /pickBestPlacement/);
    assert.doesNotMatch(html, /localDates && !localDates\.has\(date\) return false/);
    assert.match(html, /stale open/);
  });

  it('sync merge score prefers completed over comment weight', () => {
    assert.match(html, /item\.completed\s*\?\s*100/);
    assert.match(html, /item\.shelved\s*\?\s*50/);
  });

  it('markTemplateInjected uses the item date, not always todayKey()', () => {
    assert.match(html, /markTemplateInjectedForDate\s*\(/);
    assert.match(html, /markTemplateInjectedForDate\(\s*items\[idx\]\.recurringTemplateId\s*,\s*date\s*\)/);
  });

  it('export includes deletedIds tombstones', () => {
    assert.match(html, /deletedIds:\s*pruneDeletedIds\(state\.data\.deletedIds/);
  });

  it('auto-carry uses allPastDays', () => {
    assert.match(html, /allPastDays:\s*true/);
  });

  it('every automatic carry-forward call is gated on the Auto carry toggle', () => {
    const script = extractMainScript(html);
    const calls = [...script.matchAll(/carryForwardUnfinished\([^;]*?\{\s*auto:\s*true/g)];
    assert.ok(calls.length >= 3, 'expected sync, no-remote, and maybeAutoCarryForward call sites');
    for (const m of calls) {
      const before = script.slice(Math.max(0, m.index - 400), m.index);
      assert.match(before, /if \(!?state\.autoCarryForward\)/,
        `auto carry at offset ${m.index} is not guarded by state.autoCarryForward`);
    }
  });

  it('sync still injects recurring templates when Auto carry is off', () => {
    const sync = html.slice(html.indexOf('async function sbPostAuthSync'), html.indexOf('async function sbPull'));
    const blocks = [...sync.matchAll(/if \(state\.autoCarryForward\) \{[\s\S]*?\n\s*\}\n\s*injectDueTemplates\(\);/g)];
    assert.equal(blocks.length, 2, 'both sync branches inject outside the auto-carry guard');
  });

  it('uncomplete preserves New boardColumn', () => {
    assert.match(html, /boardColumn === 'new' \? 'new' : 'active'/);
    assert.doesNotMatch(html, /boardColumn:\s*wasCompleted \? 'active'/);
  });

  it('auto-collapse helpers are declared before state init (TDZ regression)', () => {
    const script = extractMainScript(html);
    const optionsAt = script.indexOf('const AUTO_COLLAPSE_AT_OPTIONS');
    const normalizeAt = script.indexOf('function normalizeAutoCollapseAt');
    const stateAt = script.indexOf('const state =');
    assert.ok(optionsAt > -1, 'AUTO_COLLAPSE_AT_OPTIONS missing');
    assert.ok(normalizeAt > -1, 'normalizeAutoCollapseAt missing');
    assert.ok(stateAt > -1, 'const state missing');
    assert.ok(
      optionsAt < stateAt,
      'AUTO_COLLAPSE_AT_OPTIONS must be initialized before const state (avoids TDZ crash on boot)',
    );
    assert.ok(
      normalizeAt < stateAt,
      'normalizeAutoCollapseAt must be declared before const state',
    );
    assert.match(script.slice(stateAt, stateAt + 1500), /normalizeAutoCollapseAt\s*\(/);
  });

  it('auto-collapse threshold helpers extracted from HTML are executable', () => {
    const script = extractMainScript(html);
    const optionsDecl = script.match(/const AUTO_COLLAPSE_AT_OPTIONS = \[[^\]]+\];/);
    const fnDecl = script.match(/function normalizeAutoCollapseAt\(n\) \{[\s\S]*?\n    \}\n/);
    assert.ok(optionsDecl, 'could not extract AUTO_COLLAPSE_AT_OPTIONS');
    assert.ok(fnDecl, 'could not extract normalizeAutoCollapseAt');
    const run = new Function(
      `${optionsDecl[0]}\n${fnDecl[0]}\nreturn [normalizeAutoCollapseAt(5), normalizeAutoCollapseAt(7), normalizeAutoCollapseAt('x')];`,
    );
    assert.deepEqual(run(), [5, 8, 5]);
  });

  it('documents TDZ crash when options const is after the call site', () => {
    assert.throws(() => {
      new Function(`
        function normalizeAutoCollapseAt(n) {
          return AUTO_COLLAPSE_AT_OPTIONS.includes(n) ? n : 5;
        }
        normalizeAutoCollapseAt(5);
        const AUTO_COLLAPSE_AT_OPTIONS = [3, 5, 8];
      `)();
    }, /before initialization/);
  });

  it('Completed column uses preference threshold, not a hardcoded 5', () => {
    assert.doesNotMatch(html, /const COMPLETED_COLLAPSE_AT\s*=\s*5/);
    assert.match(html, /completed\.length\s*>=\s*collapseAt/);
    assert.match(html, /normalizeAutoCollapseAt\(state\.autoCollapseCompletedAt\)/);
  });

  it('Customize select options match AUTO_COLLAPSE_AT_OPTIONS', () => {
    const select = html.match(
      /<select id="auto-collapse-completed-at"[^>]*>([\s\S]*?)<\/select>/,
    );
    assert.ok(select, 'threshold select missing');
    const values = [...select[1].matchAll(/<option value="(\d+)">/g)].map((m) => Number(m[1]));
    assert.deepEqual(values, AUTO_COLLAPSE_AT_OPTIONS);
  });

  it('prefs payload includes autoCollapseCompletedAt', () => {
    assert.match(html, /autoCollapseCompletedAt:/);
    assert.match(html, /prefs\.autoCollapseCompletedAt/);
    assert.match(html, /work-desk-auto-collapse-completed-at/);
  });

  it('offline users can reopen auth from the sidebar account footer', () => {
    assert.match(html, /id="sb-signin-btn"/);
    assert.match(html, /function openSignInFromDesk\s*\(/);
    assert.match(html, /updateAccountChrome\s*\(\s*['"]offline['"]/);
    assert.doesNotMatch(
      html,
      /sidebar-account-identity[\s\S]{0,200}addEventListener\(\s*['"]click['"]/,
    );
  });

  it('auto-carry stamps carriedFrom on moved tasks', () => {
    assert.match(html, /carriedFrom\s*=\s*sourceDate/);
    assert.match(html, /carriedFrom\s*=\s*sourceDateKey/);
  });

  it('manual move clears carriedFrom', () => {
    const moveItemFn = html.match(/function moveItem\(itemId, targetDate\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(moveItemFn, 'moveItem function not found');
    assert.match(moveItemFn[0], /delete item\.carriedFrom/);
  });

  it('send to other context clears carriedFrom', () => {
    const sendFn = html.match(/function sendItemToOtherContext\(itemId\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(sendFn, 'sendItemToOtherContext function not found');
    assert.match(sendFn[0], /delete item\.carriedFrom/);
  });

  it('analyzeDayItems uses carriedFrom for accurate counting', () => {
    const analyzeFunction = html.match(
      /function analyzeDayItems\(dayKey, items\)\s*\{[\s\S]*?\n    \}/,
    );
    assert.ok(analyzeFunction, 'analyzeDayItems function not found');
    assert.match(analyzeFunction[0], /task\.carriedFrom/);
    assert.match(analyzeFunction[0], /carriedOver\+\+/);
  });

  it('persists expanded comments state across refreshes', () => {
    assert.match(html, /expandedTaskIds:\s*loadExpandedComments\(/);
    assert.match(html, /function saveExpandedComments\s*\(/);
    assert.match(html, /function loadExpandedComments\s*\(/);
    assert.match(html, /work-desk-expanded-comments-/);
  });

  it('jumpToToday respects keepCommentsOpen via clearExpandedComments', () => {
    const jumpFn = html.match(/function jumpToToday\(\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(jumpFn, 'jumpToToday function not found');
    assert.match(jumpFn[0], /clearExpandedComments\(\)/);
    assert.doesNotMatch(jumpFn[0], /state\.expandedTaskIds\.clear\(\)/);
  });

  it('THEMES contains 84 themes (28 light, 28 medium, 28 dark) with complete wireframe properties', () => {
    const themesMatch = html.match(/const THEMES = (\[[\s\S]*?\n    \]);/);
    assert.ok(themesMatch, 'THEMES array not found in work-desk.html');
    const themes = new Function(`return ${themesMatch[1]}`)();
    assert.equal(themes.length, 84);
    assert.equal(new Set(themes.map((t) => t.id)).size, 84, 'theme ids must be unique');
    const light  = themes.filter((t) => !t.dark && !t.medium);
    const medium = themes.filter((t) => t.medium);
    const dark   = themes.filter((t) => t.dark);
    assert.equal(light.length, 28, 'expected 28 light themes');
    assert.equal(medium.length, 28, 'expected 28 medium themes');
    assert.equal(dark.length, 28, 'expected 28 dark themes');
    for (const t of themes) {
      assert.equal(typeof t.id, 'string');
      assert.equal(typeof t.name, 'string');
      assert.match(t.sidebar, /^#[0-9a-fA-F]{6}$/);
      assert.match(t.bg, /^#[0-9a-fA-F]{6}$/);
      assert.match(t.surface, /^#[0-9a-fA-F]{6}$/);
      assert.match(t.accent, /^#[0-9a-fA-F]{6}$/);
    }
    for (const t of medium) {
      assert.strictEqual(t.medium, true, `medium theme ${t.id} should have medium: true`);
      assert.strictEqual(t.dark, false, `medium theme ${t.id} should have dark: false`);
    }
  });

  it('options popup includes three tabbed submenus (Themes, Appearance, Behavior)', () => {
    assert.match(html, /data-options-tab="themes"/);
    assert.match(html, /data-options-tab="appearance"/);
    assert.match(html, /data-options-tab="behavior"/);
    assert.match(html, /id="options-pane-themes"/);
    assert.match(html, /id="options-pane-appearance"/);
    assert.match(html, /id="options-pane-behavior"/);
    assert.match(html, /data-theme-filter="light"/);
    assert.match(html, /data-theme-filter="medium"/);
    assert.match(html, /data-theme-filter="dark"/);
    assert.match(html, /id="strike-completed-toggle"/);
    assert.match(html, /id="confetti-toggle"/);
    assert.match(html, /id="week-start-select"/);
    assert.match(html, /id="startup-view-select"/);
  });

  it('theme swatches render mini app wireframe elements', () => {
    assert.match(html, /class="theme-swatch-preview"/);
    assert.match(html, /class="theme-swatch-sidebar"/);
    assert.match(html, /class="theme-swatch-sidebar-pill"/);
    assert.match(html, /class="theme-swatch-content"/);
    assert.match(html, /class="theme-swatch-card"/);
    assert.match(html, /class="theme-swatch-card-line"/);
  });

  it('sidebar includes today at a glance widget, streamlined backup, and polished account footer', () => {
    assert.match(html, /id="sidebar-today-glance"/);
    assert.match(html, /id="glance-pct"/);
    assert.match(html, /id="glance-progress-bar"/);
    assert.match(html, /id="glance-stats-text"/);
    assert.match(html, /class="sidebar-backup-btns"/);
    assert.match(html, /class="sidebar-repair-link"/);
    assert.match(html, /class="sidebar-account-top"/);
    assert.match(html, /class="sidebar-account-actions"/);
    assert.match(html, /function renderSidebarTodayGlance\s*\(/);
  });

  it('main panel includes in-column quick add', () => {
    assert.match(html, /col-add-btn/);
    assert.match(html, /col-inline-add/);
    assert.match(html, /addingInColumn/);
    assert.match(html, /addItem\(content,\s*options\s*=\s*\{\}\)/);
  });

  it('desktop desk scrolls like a normal page: .main scrolls, the top card is not pinned, the board has no own scroll', () => {
    assert.match(html, /id="desk-view"/);
    assert.doesNotMatch(html, /id="desk-view"[^>]*class="[^"]*desk-view/);
    const main = html.match(/\n    \.main \{[^}]*\}/)[0];
    assert.match(main, /overflow-y: auto;/);
    assert.match(main, /scrollbar-gutter: stable;/);
    assert.doesNotMatch(main, /overflow: hidden/);
    assert.match(html, /\n    \.density-popout \{[^}]*max-height: calc\(100vh - 112px\);/);
    const desk = html.match(/\n    #desk-view \{[^}]*\}/)[0];
    assert.match(desk, /flex: none;/);
    assert.doesNotMatch(desk, /overflow/);
    const board = html.match(/\n    \.desk-board-area \{[^}]*\}/)[0];
    assert.doesNotMatch(board, /overflow/);
    const sticky = html.match(/\n    \.desk-sticky \{[^}]*\}/)[0];
    assert.doesNotMatch(sticky, /position: (sticky|fixed)/);
  });

  it('mobile CSS keeps help/version and full-width backup buttons', () => {
    // Regression: .logo-sub { display: none } hid ? and version on mobile
    assert.doesNotMatch(html, /\.logo-sub\s*\{\s*display:\s*none\s*;?\s*\}/);
    // Compact mobile still hides only the subtitle text, not the controls
    assert.match(html, /#logo-sub-text\s*\{\s*display:\s*none/);
    // Backup row stays a 2-col grid (flex-on-buttons-only caused the squish)
    assert.match(html, /\.sidebar-backup-btns\s*\{[^}]*grid-template-columns:\s*1fr\s+1fr/s);
  });

  it('main script parses and boots without runtime exceptions', () => {
    const script = extractMainScript(html);
    const idMatches = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const elementsById = {};

    class MockElement {
      constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.classList = {
          _classes: new Set(),
          add(...c) { c.forEach((x) => this._classes.add(x)); },
          remove(...c) { c.forEach((x) => this._classes.delete(x)); },
          toggle(c, force) {
            if (force === undefined) {
              if (this._classes.has(c)) { this._classes.delete(c); return false; }
              this._classes.add(c);
              return true;
            }
            if (force) { this._classes.add(c); return true; }
            this._classes.delete(c);
            return false;
          },
          contains(c) { return this._classes.has(c); },
        };
        this.dataset = {};
        this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
        this.innerHTML = '';
        this.textContent = '';
        this.disabled = false;
        this.checked = false;
        this.value = '';
        this.type = '';
        this.attributes = {};
      }
      setAttribute(k, v) { this.attributes[k] = v; }
      getAttribute(k) { return this.attributes[k] || null; }
      removeAttribute(k) { delete this.attributes[k]; }
      appendChild(child) { this.children.push(child); return child; }
      append(...children) { this.children.push(...children); }
      before() {}
      after() {}
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        return child;
      }
      addEventListener() {}
      removeEventListener() {}
      querySelector() { return new MockElement(); }
      querySelectorAll() { return [new MockElement()]; }
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
      focus() {}
      click() {}
      scrollIntoView() {}
      getContext() {
        return {
          clearRect() {},
          fillRect() {},
          strokeRect() {},
          beginPath() {},
          closePath() {},
          moveTo() {},
          lineTo() {},
          arc() {},
          fill() {},
          stroke() {},
          measureText() { return { width: 50 }; },
          fillText() {},
          strokeText() {},
          save() {},
          restore() {},
          translate() {},
          rotate() {},
          scale() {},
          setLineDash() {},
          createLinearGradient() { return { addColorStop() {} }; },
        };
      }
    }

    idMatches.forEach((id) => {
      elementsById[id] = new MockElement(id);
    });

    const mockStorage = {
      _store: {},
      getItem(k) { return this._store[k] !== undefined ? this._store[k] : null; },
      setItem(k, v) { this._store[k] = String(v); },
      removeItem(k) { delete this._store[k]; },
      clear() { this._store = {}; },
      key(i) { return Object.keys(this._store)[i] || null; },
      get length() { return Object.keys(this._store).length; },
    };

    const mockDoc = {
      documentElement: new MockElement('html', 'html'),
      body: new MockElement('body', 'body'),
      getElementById(id) {
        return elementsById[id] || new MockElement(id);
      },
      querySelector(sel) {
        if (sel.startsWith('#')) return mockDoc.getElementById(sel.slice(1));
        return new MockElement('', 'div');
      },
      querySelectorAll() {
        return [new MockElement('', 'div')];
      },
      createElement(tag) {
        return new MockElement('', tag);
      },
      createTextNode(text) {
        return { textContent: text };
      },
      createComment() {
        return new MockElement('', '#comment');
      },
      addEventListener() {},
      removeEventListener() {},
    };

    const context = {
      document: mockDoc,
      window: {
        innerWidth: 1200,
        innerHeight: 800,
        addEventListener() {},
        location: { reload() {}, search: '', origin: 'http://localhost' },
        requestAnimationFrame(cb) { cb(); },
        cancelAnimationFrame() {},
        localStorage: mockStorage,
        sessionStorage: mockStorage,
        navigator: { userAgent: 'test', clipboard: { writeText() {} } },
        document: mockDoc,
        getSelection() { return { toString() { return ''; } }; },
        matchMedia() { return { matches: false, addEventListener() {} }; },
      },
      MutationObserver: class { observe() {} disconnect() {} },
      localStorage: mockStorage,
      sessionStorage: mockStorage,
      navigator: { userAgent: 'test', clipboard: { writeText() {} } },
      console: { log() {}, warn() {}, error() {} },
      setTimeout: (fn) => fn(),
      clearTimeout: () => {},
      setInterval: () => {},
      clearInterval: () => {},
      requestAnimationFrame: (cb) => cb(),
      cancelAnimationFrame: () => {},
      location: { reload() {}, search: '', origin: 'http://localhost' },
      Intl,
      Date,
      Math,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Set,
      Map,
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
    };
    context.window.window = context.window;

    assert.doesNotThrow(() => {
      vm.createContext(context);
      vm.runInContext(script, context);
    }, 'work-desk.html script must parse and execute without errors');
  });

  it('search results render in a floating overlay, not the sidebar-clipped list', () => {
    assert.match(html, /id="search-overlay"/);
    assert.match(html, /id="search-overlay-count"/);
    assert.match(html, /id="search-overlay-close"/);
    assert.match(html, /function positionSearchOverlay\s*\(/);
    assert.match(html, /\.search-overlay\s*\{[\s\S]{0,40}position:\s*fixed;/);
  });

  it('search overlay closes on Escape, close button, and outside click', () => {
    assert.match(html, /function closeSearchOverlay\s*\(/);
    assert.match(html, /searchOverlayClose\.addEventListener\(\s*['"]click['"]/);
    assert.match(html, /searchWrap\.contains\(e\.target\)[\s\S]{0,40}searchOverlay\.contains\(e\.target\)/);
  });

  it('search supports #tagname filtering in addition to full-text', () => {
    assert.match(html, /isTagQuery/);
    assert.match(html, /tags\.some\(t => t\.includes\(tagQuery\)\)/);
  });

  it('#tagname search finds the tag token anywhere in the query and treats the rest as an order-independent text filter', () => {
    // Regression: "#ace set up" used to search for a literal tag named
    // "ace set up" (tags can't contain spaces) and always returned "No items
    // with that tag". Worse, "set up #ace" (tag not first) skipped tag mode
    // entirely and ran a plain-text search for the literal string "set up
    // #ace", which never matches because the "#ace" text is stripped out of
    // the content when the tag is extracted. The tag token can now appear
    // anywhere in the query, and remaining words just need to appear
    // somewhere in the item — not contiguous, not in a particular order.
    assert.match(html, /const tokens = q\.split\(\/\\s\+\/\)\.filter\(Boolean\);/);
    assert.match(html, /const tagTokenIdx = tokens\.findIndex\(t => t\.length > 1 && t\.startsWith\('#'\)\);/);
    assert.match(html, /const isTagQuery = tagTokenIdx !== -1;/);
    assert.match(html, /if \(!tagQuery \|\| !tags\.some\(t => t\.includes\(tagQuery\)\)\) continue;/);
    assert.match(html, /if \(!textWords\.every\(w => haystack\.includes\(w\)\)\) continue;/);
  });

  it('tags: data model, extraction, and card UI are wired up', () => {
    assert.match(html, /function normalizeTag\s*\(/);
    assert.match(html, /function normalizeTagList\s*\(/);
    assert.match(html, /function mergeTags\s*\(/);
    assert.match(html, /function extractHashtags\s*\(/);
    assert.match(html, /function addTagToItem\s*\(/);
    assert.match(html, /function removeTagFromItem\s*\(/);
    assert.match(html, /wrap\.className = 'tag-chip-row'/);
    assert.match(html, /chip\.className = 'tag-chip'/);
    assert.match(html, /\.tag-chip\s*\{/);
    assert.match(html, /taggingId/);
  });

  it('addItem and updateItem both run hashtag extraction', () => {
    const addItemFn = html.match(/function addItem\(content, options = \{\}\)\s*\{[\s\S]*?\n    \}/);
    const updateItemFn = html.match(/function updateItem\(id, content\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(addItemFn, 'addItem function not found');
    assert.ok(updateItemFn, 'updateItem function not found');
    assert.match(addItemFn[0], /extractHashtags\(/);
    assert.match(updateItemFn[0], /extractHashtags\(/);
  });

  it('tag merges are threaded through every same-ID merge site (sync/dedupe)', () => {
    const mergeSiteCount = [...html.matchAll(/mergeTags\(/g)].length;
    assert.ok(mergeSiteCount >= 8, `expected tags to be merged at 8+ call sites, found ${mergeSiteCount}`);
  });

  it('deleteProjectItem tombstones the id so cloud sync cannot resurrect it', () => {
    const fn = html.match(/function deleteProjectItem\([\s\S]*?\n    \}/);
    assert.ok(fn, 'deleteProjectItem function not found');
    assert.match(fn[0], /markProjectItemDeleted\(itemId\)/);
  });

  it('mergeProjectsData filters tombstoned tasks/notes before unioning', () => {
    const fn = html.match(/function mergeProjectsData\([\s\S]*?\n    \}/);
    assert.ok(fn, 'mergeProjectsData function not found');
    assert.match(fn[0], /deletedIds\[note\.id\]/);
    assert.match(fn[0], /deletedIds\[task\.id\]/);
  });

  it('index.html stays byte-identical to work-desk.html', () => {
    assert.equal(indexHtml, html, 'Copy work-desk.html → index.html before shipping');
  });
});

describe('Character encoding (mojibake guard)', () => {
  const SHIPPED_FILES = ['work-desk.html', 'index.html', 'sw.js', 'manifest.json', 'CHANGELOG.md', 'README.md'];
  // UTF-8 bytes misread as Windows-1252: — → "â€”", → → "â†’", é → "Ã©", emoji → "ðŸ…", nbsp → "Â "
  const MOJIBAKE = /â€|â†|Ã[\u0080-\u00BF\u0152-\u2122]|Â[\u00A0-\u00BF]|ðŸ|ï¸/;
  const findMojibake = (text) => {
    const m = text.match(MOJIBAKE);
    if (!m) return null;
    const line = text.slice(0, m.index).split('\n').length;
    return `line ${line}: ${JSON.stringify(text.slice(Math.max(0, m.index - 30), m.index + 30))}`;
  };

  for (const name of SHIPPED_FILES) {
    it(`${name} is valid UTF-8 with no BOM, replacement chars, or mojibake`, () => {
      const bytes = readFileSync(join(__dirname, '..', name));
      assert.ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), `${name} must not start with a UTF-8 BOM`);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      assert.ok(!text.includes('\uFFFD'), `${name} contains U+FFFD replacement characters`);
      assert.equal(findMojibake(text), null, `${name} contains double-encoded text`);
    });
  }

  it('HTML declares <meta charset="UTF-8"> within the first 1024 bytes', () => {
    const head = readFileSync(join(__dirname, '../work-desk.html')).subarray(0, 1024).toString('latin1');
    assert.match(head, /<meta charset="UTF-8"\s*\/?>/i);
  });

  it('every in-app What\'s New entry is free of mojibake and control characters', () => {
    const src = html.match(/const CHANGELOG = (\[[\s\S]*?\n    \]);/)[1];
    const entries = new Function(`return ${src}`)();
    assert.ok(entries.length > 0);
    for (const e of entries) {
      for (const s of e.sections) {
        for (const item of s.items) {
          assert.equal(findMojibake(item), null, `v${e.version} ${s.label}: ${item.slice(0, 60)}`);
          assert.doesNotMatch(item, /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/, `v${e.version} has a control character`);
        }
      }
    }
  });

  it('help modal text is free of mojibake', () => {
    const start = html.indexOf('id="help-modal"');
    assert.ok(start > 0, 'help modal not found');
    const help = html.slice(start, html.indexOf('<script', start));
    assert.ok(help.includes('Themes'), 'help modal slice looks wrong');
    assert.equal(findMojibake(help), null);
  });

  it('detector catches a simulated Windows-1252 double-encode of the app', () => {
    const bytes = readFileSync(join(__dirname, '../work-desk.html'));
    const corrupted = new TextDecoder('windows-1252').decode(bytes);
    assert.notEqual(findMojibake(corrupted), null, 'guard failed to detect double-encoded HTML');
    assert.notEqual(findMojibake('12 new themes — Retro, Rosé Pine'.replace(/—/, 'â€"')), null);
  });
});

describe('normalizeAutoCollapseAt', () => {
  it('keeps valid options and defaults invalid input to 5', () => {
    for (const n of AUTO_COLLAPSE_AT_OPTIONS) {
      assert.equal(normalizeAutoCollapseAt(n), n);
    }
    assert.equal(normalizeAutoCollapseAt('10'), 10);
    assert.equal(normalizeAutoCollapseAt(0), 5);
    assert.equal(normalizeAutoCollapseAt(-3), 5);
    assert.equal(normalizeAutoCollapseAt(NaN), 5);
    assert.equal(normalizeAutoCollapseAt('nope'), 5);
  });

  it('snaps unknown values to the nearest option', () => {
    assert.equal(normalizeAutoCollapseAt(7), 8);
    assert.equal(normalizeAutoCollapseAt(4), 3);
    assert.equal(normalizeAutoCollapseAt(12), 10);
    assert.equal(normalizeAutoCollapseAt(100), 20);
  });
});

describe('shouldAutoCollapseCompleted', () => {
  it('respects enabled flag and threshold', () => {
    assert.equal(shouldAutoCollapseCompleted(true, 5, 5), true);
    assert.equal(shouldAutoCollapseCompleted(true, 4, 5), false);
    assert.equal(shouldAutoCollapseCompleted(false, 20, 5), false);
    assert.equal(shouldAutoCollapseCompleted(true, 8, 8), true);
  });
});

describe('carriedFrom field tracking', () => {
  it('normalizeItem preserves carriedFrom for tasks', () => {
    const task = {
      id: 't1',
      type: 'task',
      content: 'Test task',
      completed: false,
      shelved: false,
      boardColumn: 'new',
      createdAt: '2026-08-18T10:00:00Z',
      carriedFrom: '2026-08-17',
    };
    const normalized = normalizeItem(task);
    assert.equal(normalized.carriedFrom, '2026-08-17');
  });

  it('normalizeItem does not add carriedFrom if not present', () => {
    const task = {
      id: 't1',
      type: 'task',
      content: 'Test task',
      completed: false,
      shelved: false,
      boardColumn: 'new',
      createdAt: '2026-08-18T10:00:00Z',
    };
    const normalized = normalizeItem(task);
    assert.equal(normalized.carriedFrom, undefined);
  });

  it('normalizeItem ignores carriedFrom on notes', () => {
    const note = {
      id: 'n1',
      type: 'note',
      content: 'Test note',
      completed: false,
      createdAt: '2026-08-18T10:00:00Z',
      carriedFrom: '2026-08-17', // Should be ignored
    };
    const normalized = normalizeItem(note);
    assert.equal(normalized.carriedFrom, undefined);
  });

  it('normalizeItem filters out invalid carriedFrom values', () => {
    const task1 = {
      id: 't1',
      type: 'task',
      content: 'Task 1',
      completed: false,
      shelved: false,
      boardColumn: 'new',
      createdAt: '2026-08-18T10:00:00Z',
      carriedFrom: 123, // Not a string
    };
    const task2 = {
      id: 't2',
      type: 'task',
      content: 'Task 2',
      completed: false,
      shelved: false,
      boardColumn: 'new',
      createdAt: '2026-08-18T10:00:00Z',
      carriedFrom: null,
    };
    assert.equal(normalizeItem(task1).carriedFrom, undefined);
    assert.equal(normalizeItem(task2).carriedFrom, undefined);
  });

  it('carriedFrom survives deduplication within a day', () => {
    const items = [
      {
        id: 't1',
        type: 'task',
        content: 'Task',
        completed: false,
        shelved: false,
        boardColumn: 'new',
        createdAt: '2026-08-18T10:00:00Z',
        carriedFrom: '2026-08-17',
        comments: [],
      },
      {
        id: 't1',
        type: 'task',
        content: 'Task',
        completed: true,
        shelved: false,
        boardColumn: 'active',
        createdAt: '2026-08-18T10:00:00Z',
        comments: [{ id: 'c1', content: 'Comment' }],
      },
    ];
    const deduped = deduplicateDayItems(items);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].completed, true);
    // carriedFrom should be preserved from either copy
    assert.equal(deduped[0].carriedFrom, '2026-08-17');
  });

  it('carriedFrom survives cross-day deduplication', () => {
    const days = {
      '2026-08-17': {
        date: '2026-08-17',
        items: [
          {
            id: 't1',
            type: 'task',
            content: 'Old task',
            completed: false,
            shelved: false,
            boardColumn: 'new',
            createdAt: '2026-08-16T10:00:00Z',
            carriedFrom: '2026-08-16',
          },
        ],
      },
      '2026-08-18': {
        date: '2026-08-18',
        items: [
          {
            id: 't1',
            type: 'task',
            content: 'Same task completed',
            completed: true,
            shelved: false,
            boardColumn: 'active',
            createdAt: '2026-08-16T10:00:00Z',
            carriedFrom: '2026-08-17', // Updated on re-carry
          },
        ],
      },
    };
    const result = deduplicateAcrossDays(days);
    assert.equal(Object.keys(result.days).length, 1);
    assert.ok(result.days['2026-08-18'], 'Should keep completed on 2026-08-18');
    assert.equal(result.days['2026-08-18'].items[0].carriedFrom, '2026-08-17');
  });
});

describe('normalizeTag / normalizeTagList', () => {
  it('lowercases, trims, and strips leading #', () => {
    assert.equal(normalizeTag('#ACE'), 'ace');
    assert.equal(normalizeTag('#ace'), 'ace');
    assert.equal(normalizeTag('  Ace  '), 'ace');
    assert.equal(normalizeTag('##ace'), 'ace');
  });

  it('strips characters outside a-z0-9_- so #ACE and #ace never diverge', () => {
    assert.equal(normalizeTag('a c e!'), 'ace');
    assert.equal(normalizeTag('vendor-follow_up'), 'vendor-follow_up');
  });

  it('returns empty string for garbage input', () => {
    assert.equal(normalizeTag(''), '');
    assert.equal(normalizeTag('   '), '');
    assert.equal(normalizeTag(null), '');
    assert.equal(normalizeTag(undefined), '');
    assert.equal(normalizeTag('###'), '');
  });

  it('normalizeTagList dedupes case-insensitively and drops invalid entries', () => {
    assert.deepEqual(normalizeTagList(['ACE', 'ace', '#Ace', 'vendor', '', null]), ['ace', 'vendor']);
  });

  it('normalizeTagList tolerates non-array input', () => {
    assert.deepEqual(normalizeTagList(undefined), []);
    assert.deepEqual(normalizeTagList(null), []);
    assert.deepEqual(normalizeTagList('ace'), []);
  });
});

describe('mergeTags', () => {
  it('unions two tag lists without duplicates', () => {
    assert.deepEqual(mergeTags(['ace'], ['vendor', 'ace']), ['ace', 'vendor']);
  });

  it('is case-insensitive across both sides', () => {
    assert.deepEqual(mergeTags(['ACE'], ['ace', 'Vendor']), ['ace', 'vendor']);
  });

  it('returns undefined when both sides are empty (avoids stamping empty tags:[])', () => {
    assert.equal(mergeTags(undefined, undefined), undefined);
    assert.equal(mergeTags([], []), undefined);
  });

  it('returns tagsA unchanged (as an array) when the other side has nothing new', () => {
    assert.deepEqual(mergeTags(['ace'], []), ['ace']);
    assert.deepEqual(mergeTags(['ace'], undefined), ['ace']);
  });

  it('returns the other side tags when only one side has any', () => {
    assert.deepEqual(mergeTags(undefined, ['ace']), ['ace']);
    assert.deepEqual(mergeTags([], ['ace', 'vendor']), ['ace', 'vendor']);
  });
});

describe('extractHashtags', () => {
  it('extracts a single hashtag and strips it from the content', () => {
    const result = extractHashtags('Follow up with vendor #ace before Friday');
    assert.deepEqual(result.tags, ['ace']);
    assert.equal(result.content, 'Follow up with vendor before Friday');
  });

  it('is case-insensitive and dedupes repeated tags', () => {
    const result = extractHashtags('Ping #ACE about #ace again #Ace');
    assert.deepEqual(result.tags, ['ace']);
  });

  it('extracts multiple distinct tags in order of first appearance', () => {
    const result = extractHashtags('#urgent Call the #vendor about the invoice');
    assert.deepEqual(result.tags, ['urgent', 'vendor']);
    assert.equal(result.content, 'Call the about the invoice');
  });

  it('leaves content untouched when there are no hashtags', () => {
    const result = extractHashtags('Just a plain task with no tags');
    assert.deepEqual(result.tags, []);
    assert.equal(result.content, 'Just a plain task with no tags');
  });

  it('does not strip a lone hashtag that would leave content empty (caller falls back to original)', () => {
    const result = extractHashtags('#ace');
    assert.deepEqual(result.tags, ['ace']);
    assert.equal(result.content, '', 'extraction empties the content — caller must detect and fall back');
  });

  it('ignores a bare # with no word characters after it', () => {
    const result = extractHashtags('Price is #3 per unit, see # for details');
    assert.deepEqual(result.tags, ['3']);
  });
});

describe('normalizeItem tags', () => {
  it('preserves and cleans tags for tasks', () => {
    const n = normalizeItem({
      id: 't1', type: 'task', content: 'Task', completed: false,
      tags: ['ACE', 'ace', '#vendor', ''],
    });
    assert.deepEqual(n.tags, ['ace', 'vendor']);
  });

  it('preserves tags for notes too (not gated behind type === task)', () => {
    const n = normalizeItem({
      id: 'n1', type: 'note', content: 'Note', completed: false, tags: ['idea'],
    });
    assert.deepEqual(n.tags, ['idea']);
  });

  it('omits the tags key entirely when there are none (no empty array noise)', () => {
    const n = normalizeItem({ id: 't1', type: 'task', content: 'Task', completed: false });
    assert.equal('tags' in n, false);
    const n2 = normalizeItem({ id: 't1', type: 'task', content: 'Task', completed: false, tags: [] });
    assert.equal('tags' in n2, false);
  });
});

describe('tags survive merges (sync/dedupe never drops a tag)', () => {
  it('mergeItemComments unions tags from both copies', () => {
    const winner = { id: 't1', content: 'Task', comments: [], tags: ['ace'] };
    const loser = { id: 't1', content: 'Task', comments: [], tags: ['vendor'] };
    const merged = mergeItemComments(winner, loser);
    assert.deepEqual(merged.tags, ['ace', 'vendor']);
  });

  it('deduplicateDayItems unions tags when the same ID appears twice in one day', () => {
    const items = [
      { id: 't1', type: 'task', content: 'Task', completed: false, shelved: false, tags: ['ace'] },
      { id: 't1', type: 'task', content: 'Task', completed: true, shelved: false, tags: ['vendor'] },
    ];
    const deduped = deduplicateDayItems(items);
    assert.equal(deduped.length, 1);
    assert.deepEqual([...deduped[0].tags].sort(), ['ace', 'vendor']);
  });

  it('deduplicateAcrossDays keeps the union of tags when collapsing the same ID onto one day', () => {
    const days = {
      '2026-08-17': {
        date: '2026-08-17',
        items: [{ id: 't1', type: 'task', content: 'Task', completed: false, shelved: false, tags: ['ace'] }],
      },
      '2026-08-18': {
        date: '2026-08-18',
        items: [{ id: 't1', type: 'task', content: 'Task', completed: true, shelved: false, tags: ['vendor'] }],
      },
    };
    const result = deduplicateAcrossDays(days);
    assert.equal(Object.keys(result.days).length, 1);
    assert.deepEqual([...result.days['2026-08-18'].items[0].tags].sort(), ['ace', 'vendor']);
  });

  it('mergeDaysData (cross-device sync) unions tags instead of letting one device win outright', () => {
    const local = {
      days: {
        '2026-08-18': {
          date: '2026-08-18',
          items: [{ id: 't1', type: 'task', content: 'Task', completed: false, shelved: false, tags: ['ace'] }],
        },
      },
    };
    const remote = {
      days: {
        '2026-08-18': {
          date: '2026-08-18',
          items: [{ id: 't1', type: 'task', content: 'Task', completed: true, shelved: false, tags: ['vendor'] }],
        },
      },
    };
    const merged = mergeDaysData(local, remote);
    const item = merged.days['2026-08-18'].items.find(i => i.id === 't1');
    assert.ok(item, 'merged item missing');
    assert.equal(item.completed, true, 'completed copy should still win the placement');
    assert.deepEqual([...item.tags].sort(), ['ace', 'vendor']);
  });

  it('pickMergedItem unions tags alongside comments', () => {
    const a = { id: 't1', content: 'Task', completed: false, comments: [], tags: ['ace'] };
    const b = { id: 't1', content: 'Task', completed: true, comments: [], tags: ['vendor'] };
    const merged = pickMergedItem(a, b);
    assert.deepEqual([...merged.tags].sort(), ['ace', 'vendor']);
  });
});

// ── Holiday computation tests ───────────────────────────────────────

describe('nthWeekdayOfMonth', () => {
  it('3rd Monday in January 2026 → MLK Day (Jan 19)', () => {
    const d = nthWeekdayOfMonth(2026, 0, 1, 3);
    assert.equal(d.getMonth(), 0);
    assert.equal(d.getDate(), 19);
    assert.equal(d.getDay(), 1);
  });

  it('3rd Monday in February 2026 → Presidents Day (Feb 16)', () => {
    const d = nthWeekdayOfMonth(2026, 1, 1, 3);
    assert.equal(d.getMonth(), 1);
    assert.equal(d.getDate(), 16);
    assert.equal(d.getDay(), 1);
  });

  it('1st Monday in September 2026 → Labor Day (Sep 7)', () => {
    const d = nthWeekdayOfMonth(2026, 8, 1, 1);
    assert.equal(d.getMonth(), 8);
    assert.equal(d.getDate(), 7);
    assert.equal(d.getDay(), 1);
  });

  it('2nd Monday in October 2026 → Columbus Day (Oct 12)', () => {
    const d = nthWeekdayOfMonth(2026, 9, 1, 2);
    assert.equal(d.getMonth(), 9);
    assert.equal(d.getDate(), 12);
    assert.equal(d.getDay(), 1);
  });

  it('4th Thursday in November 2026 → Thanksgiving (Nov 26)', () => {
    const d = nthWeekdayOfMonth(2026, 10, 4, 4);
    assert.equal(d.getMonth(), 10);
    assert.equal(d.getDate(), 26);
    assert.equal(d.getDay(), 4);
  });
});

describe('lastWeekdayOfMonth', () => {
  it('last Monday in May 2026 → Memorial Day (May 25)', () => {
    const d = lastWeekdayOfMonth(2026, 4, 1);
    assert.equal(d.getMonth(), 4);
    assert.equal(d.getDate(), 25);
    assert.equal(d.getDay(), 1);
  });

  it('last Monday in May 2025 → May 26', () => {
    const d = lastWeekdayOfMonth(2025, 4, 1);
    assert.equal(d.getDate(), 26);
  });
});

describe('getUSFederalHolidays', () => {
  it('always includes the 11 named federal holidays (actual dates)', () => {
    for (const year of [2025, 2026, 2027]) {
      const holidays = getUSFederalHolidays(year);
      const labels = [...holidays.values()].map(l => l.replace(/ \(observed\)$/, ''));
      const unique = new Set(labels);
      assert.equal(unique.size, 11, `expected 11 unique holiday names for ${year}, got ${unique.size}`);
    }
  });

  it('2026 holidays include known dates', () => {
    const h = getUSFederalHolidays(2026);
    assert.equal(h.get('2026-01-01'), 'New Year\'s Day');
    assert.equal(h.get('2026-01-19'), 'MLK Day');
    assert.equal(h.get('2026-02-16'), 'Presidents\' Day');
    assert.equal(h.get('2026-05-25'), 'Memorial Day');
    assert.equal(h.get('2026-06-19'), 'Juneteenth');
    // Jul 4 is Saturday → actual on the 4th, federal observance on Friday the 3rd
    assert.equal(h.get('2026-07-04'), 'Independence Day');
    assert.equal(h.get('2026-07-03'), 'Independence Day (observed)');
    assert.equal(h.get('2026-09-07'), 'Labor Day');
    assert.equal(h.get('2026-10-12'), 'Columbus Day');
    assert.equal(h.get('2026-11-11'), 'Veterans Day');
    assert.equal(h.get('2026-11-26'), 'Thanksgiving');
    assert.equal(h.get('2026-12-25'), 'Christmas Day');
  });

  it('observed-date: 2027 Jul 4 falls on Sunday → actual Jul 4 + observed Monday Jul 5', () => {
    const h = getUSFederalHolidays(2027);
    assert.equal(h.get('2027-07-04'), 'Independence Day');
    assert.equal(h.get('2027-07-05'), 'Independence Day (observed)');
  });

  it('observed-date: 2025 Jul 4 falls on Friday → no adjustment, single entry', () => {
    const h = getUSFederalHolidays(2025);
    assert.equal(h.get('2025-07-04'), 'Independence Day');
    assert.equal(h.has('2025-07-03'), false);
    assert.equal(h.has('2025-07-05'), false);
  });

  it('Christmas 2027 (Saturday) → actual Dec 25 + observed Friday Dec 24', () => {
    const h = getUSFederalHolidays(2027);
    assert.equal(h.get('2027-12-25'), 'Christmas Day');
    assert.equal(h.get('2027-12-24'), 'Christmas Day (observed)');
  });
});

describe('checkHoliday', () => {
  it('recognizes a US federal holiday when federal is enabled', () => {
    const result = checkHoliday('2026-01-01', { useFederal: true, customHolidays: [] });
    assert.equal(result.isHoliday, true);
    assert.equal(result.label, 'New Year\'s Day');
  });

  it('does not recognize a federal holiday when federal is disabled', () => {
    const result = checkHoliday('2026-01-01', { useFederal: false, customHolidays: [] });
    assert.equal(result.isHoliday, false);
  });

  it('recognizes a custom holiday even when federal is disabled', () => {
    const result = checkHoliday('2026-03-15', {
      useFederal: false,
      customHolidays: [{ date: '2026-03-15', label: 'Company Day' }],
    });
    assert.equal(result.isHoliday, true);
    assert.equal(result.label, 'Company Day');
  });

  it('custom holiday with empty label falls back to "Holiday"', () => {
    const result = checkHoliday('2026-06-01', {
      useFederal: false,
      customHolidays: [{ date: '2026-06-01', label: '' }],
    });
    assert.equal(result.isHoliday, true);
    assert.equal(result.label, 'Holiday');
  });

  it('non-holiday date returns false', () => {
    const result = checkHoliday('2026-08-12', { useFederal: true, customHolidays: [] });
    assert.equal(result.isHoliday, false);
    assert.equal(result.label, null);
  });
});

describe('isDueOnDate skips holidays', () => {
  it('weekdays template is normally due on a weekday', () => {
    const t = { id: 't1', content: 'x', rule: 'weekdays', lastInjectedDate: null };
    assert.equal(isDueOnDate(t, '2026-08-12'), true); // Wednesday
  });

  it('daily template is due on a non-holiday weekday', () => {
    const t = { id: 't1', content: 'x', rule: 'daily', lastInjectedDate: null };
    assert.equal(isDueOnDate(t, '2026-08-12'), true);
  });

  it('isDueOnDate does NOT check holidays (pure day-of-week logic only)', () => {
    const t = { id: 't1', content: 'x', rule: 'daily', lastInjectedDate: null, skipHolidays: true };
    assert.equal(isDueOnDate(t, '2026-01-01'), true);
  });
});

describe('Holiday-aware recurring in work-desk.html (HTML invariants)', () => {
  it('holiday computation functions are present inline', () => {
    assert.match(html, /function nthWeekdayOfMonth\s*\(/);
    assert.match(html, /function lastWeekdayOfMonth\s*\(/);
    assert.match(html, /function getUSFederalHolidays\s*\(/);
    assert.match(html, /function checkHoliday\s*\(/);
  });

  it('isDueToday gates on skipHolidays + checkHoliday', () => {
    assert.match(html, /template\.skipHolidays && checkHoliday\(today\)\.isHoliday/);
  });

  it('recurring add form includes skip holidays checkbox', () => {
    assert.match(html, /recurring-skip-holidays/);
    assert.match(html, /skipHolidays:\s*skipHolidayCb\.checked/);
  });

  it('Behavior tab includes holiday settings', () => {
    assert.match(html, /id="us-federal-holidays-toggle"/);
    assert.match(html, /id="custom-holidays-list"/);
    assert.match(html, /id="custom-holiday-add-btn"/);
    assert.match(html, /id="custom-holiday-date"/);
    assert.match(html, /id="custom-holiday-label"/);
  });

  it('state includes holiday prefs and they sync', () => {
    assert.match(html, /useFederalHolidays:/);
    assert.match(html, /customHolidays:/);
    assert.match(html, /US_FEDERAL_HOLIDAYS_KEY/);
    assert.match(html, /CUSTOM_HOLIDAYS_KEY/);
    assert.match(html, /prefs\.useFederalHolidays/);
    assert.match(html, /prefs\.customHolidays/);
  });

  it('calendar cells show holiday indicators', () => {
    assert.match(html, /btn\.classList\.add\('holiday'\)/);
    assert.match(html, /cal-holiday-dot/);
    assert.match(html, /\.cal-day\.holiday/);
  });

  it('templates display skip holidays badge', () => {
    assert.match(html, /t\.skipHolidays/);
    assert.match(html, /skip holidays/);
  });

  it('renderCustomHolidaysList function exists', () => {
    assert.match(html, /function renderCustomHolidaysList\s*\(/);
  });
});

describe('Medium themes (HTML invariants)', () => {
  it('all 28 medium themes have CSS [data-theme] rules with color-scheme: dark', () => {
    const mediumIds = [
      'fog','overcast','steel','fjord','nimbus','pewter','horizon','denim',
      'lichen','fern','tundra','moss','basalt','gameboy',
      'driftwood','clay','sandstone','umber','terracotta','flint',
      'twilight','haze','plum-mid','mulberry','merlot',
      'ash','graphite','concrete',
    ];
    assert.equal(mediumIds.length, 28);
    for (const id of mediumIds) {
      const block = html.match(new RegExp(`\\[data-theme="${id}"\\] \\{([^}]*)\\}`));
      assert.ok(block, `CSS rule for medium theme "${id}" not found`);
      assert.match(block[1], /color-scheme:\s*dark/, `medium theme "${id}" must set color-scheme: dark`);
    }
  });

  it('renderThemeSwatches filters on medium property', () => {
    assert.match(html, /THEMES\.filter\(t\s*=>\s*t\.medium\)/);
    assert.match(html, /currentThemeFilter\s*===\s*'medium'/);
  });

  it('medium filter button exists with data-theme-filter="medium"', () => {
    assert.match(html, /data-theme-filter="medium"[^>]*>Med</);
  });
});

describe('Custom theme builder (HTML invariants)', () => {
  it('custom theme filter tab exists in markup', () => {
    assert.match(html, /data-theme-filter="custom"/);
    assert.match(html, /id="custom-theme-panel"/);
  });

  it('deriveCustomThemeVars function exists and returns an object', () => {
    assert.match(html, /function deriveCustomThemeVars\s*\(/);
    const fnMatch = html.match(/function deriveCustomThemeVars\(\{[^}]+\}\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fnMatch, 'deriveCustomThemeVars body not found');
    assert.match(fnMatch[1], /--bg/);
    assert.match(fnMatch[1], /--accent-hover/);
    assert.match(fnMatch[1], /--sidebar-text/);
    assert.match(fnMatch[1], /--panel-bg/);
    assert.match(fnMatch[1], /--danger/);
    assert.match(fnMatch[1], /--modal-overlay/);
    assert.match(fnMatch[1], /return vars/);
  });

  it('hexToRgb, rgbToHex, mixHex helpers exist', () => {
    assert.match(html, /function hexToRgb\s*\(/);
    assert.match(html, /function rgbToHex\s*\(/);
    assert.match(html, /function mixHex\s*\(/);
  });

  it('CRUD functions exist for custom themes', () => {
    assert.match(html, /function loadCustomThemes\s*\(/);
    assert.match(html, /function saveCustomThemes\s*\(/);
    assert.match(html, /function createCustomTheme\s*\(/);
    assert.match(html, /function updateCustomTheme\s*\(/);
    assert.match(html, /function deleteCustomTheme\s*\(/);
  });

  it('MAX_CUSTOM_THEMES is set to 5', () => {
    assert.match(html, /MAX_CUSTOM_THEMES\s*=\s*5/);
  });

  it('isCustomThemeId identifies custom- prefixed IDs', () => {
    assert.match(html, /function isCustomThemeId\s*\(/);
    assert.match(html, /\.startsWith\('custom-'\)/);
  });

  it('applyTheme handles custom theme IDs with inline vars', () => {
    assert.match(html, /isCustomThemeId\(id\)/);
    assert.match(html, /deriveCustomThemeVars\(ct\)/);
    assert.match(html, /clearCustomThemeInlineVars/);
  });

  it('initTheme recognizes custom theme IDs as valid', () => {
    const initMatch = html.match(/function initTheme\(\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(initMatch, 'initTheme function not found');
    assert.match(initMatch[0], /isCustomThemeId/);
    assert.match(initMatch[0], /loadCustomThemes/);
  });

  it('readLocalPrefs includes customThemes', () => {
    const prefsMatch = html.match(/function readLocalPrefs\(\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(prefsMatch, 'readLocalPrefs not found');
    assert.match(prefsMatch[0], /customThemes/);
  });

  it('applyCloudPrefs syncs customThemes from remote', () => {
    assert.match(html, /prefs\.customThemes/);
    assert.match(html, /saveCustomThemes\(prefs\.customThemes\)/);
  });

  it('custom theme CSS classes exist', () => {
    assert.match(html, /\.custom-theme-panel/);
    assert.match(html, /\.custom-editor/);
    assert.match(html, /\.custom-color-swatch/);
    assert.match(html, /\.custom-color-hex/);
    assert.match(html, /\.custom-swatch-delete/);
    assert.match(html, /\.custom-add-tile/);
    assert.match(html, /\.custom-preview-app/);
  });

  it('renderCustomThemePanel / browse / editor functions exist', () => {
    assert.match(html, /function renderCustomThemePanel\s*\(/);
    assert.match(html, /function renderCustomBrowse\s*\(/);
    assert.match(html, /function renderCustomEditor\s*\(/);
    assert.match(html, /function updateEditorPreview\s*\(/);
  });

  it('themes pane is separate from appearance pane (3-tab split)', () => {
    assert.match(html, /id="options-pane-themes"/);
    const themesPane = html.match(/id="options-pane-themes"[\s\S]*?<\/div>\s*\n\s*<!-- Appearance/);
    assert.ok(themesPane, 'themes pane should close before appearance pane starts');
    assert.match(themesPane[0], /customize-theme-grid/);
    assert.match(themesPane[0], /custom-theme-panel/);
    assert.doesNotMatch(themesPane[0], /density-option/);
    assert.doesNotMatch(themesPane[0], /font-size-select/);
  });

  it('click-outside guard uses bounding-rect fallback for detached targets', () => {
    assert.match(html, /getBoundingClientRect/);
    assert.match(html, /clientX >= r\.left/);
  });
});

describe('Custom theme builder (functional — extracted JS)', () => {
  const script = extractMainScript(html);

  function extractFunctions() {
    const hexToRgb = script.match(/function hexToRgb\(hex\)\s*\{[\s\S]*?\n    \}/);
    const rgbToHex = script.match(/function rgbToHex\(r, g, b\)\s*\{[\s\S]*?\n    \}/);
    const mixHex = script.match(/function mixHex\(c1, c2, pct\)\s*\{[\s\S]*?\n    \}/);
    const lighten = script.match(/function lighten\(hex, pct\)\s*\{[^}]+\}/);
    const darken = script.match(/function darken\(hex, pct\)\s*\{[^}]+\}/);
    const withAlpha = script.match(/function withAlpha\(hex, alpha\)\s*\{[\s\S]*?\n    \}/);
    const deriveVars = script.match(/function deriveCustomThemeVars\(\{[^}]+\}\)\s*\{[\s\S]*?\n    \}/);
    const isCustomId = script.match(/function isCustomThemeId\(id\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(hexToRgb && rgbToHex && mixHex && lighten && darken && withAlpha && deriveVars && isCustomId,
      'all helper functions must be extractable');
    const code = [hexToRgb[0], rgbToHex[0], mixHex[0], lighten[0], darken[0], withAlpha[0], deriveVars[0], isCustomId[0]].join('\n');
    return code;
  }

  it('hexToRgb correctly parses hex colors', () => {
    const run = new Function(extractFunctions() + `\nreturn hexToRgb('#ff8000');`);
    assert.deepEqual(run(), [255, 128, 0]);
  });

  it('hexToRgb handles black and white', () => {
    const code = extractFunctions();
    const black = new Function(code + `\nreturn hexToRgb('#000000');`)();
    const white = new Function(code + `\nreturn hexToRgb('#ffffff');`)();
    assert.deepEqual(black, [0, 0, 0]);
    assert.deepEqual(white, [255, 255, 255]);
  });

  it('rgbToHex produces valid 6-digit hex', () => {
    const run = new Function(extractFunctions() + `\nreturn rgbToHex(255, 128, 0);`);
    assert.equal(run(), '#ff8000');
  });

  it('rgbToHex clamps values outside 0-255', () => {
    const run = new Function(extractFunctions() + `\nreturn rgbToHex(300, -10, 128);`);
    assert.match(run(), /^#[0-9a-f]{6}$/);
    assert.equal(run(), '#ff0080');
  });

  it('mixHex at 0% returns first color, at 100% returns second color', () => {
    const code = extractFunctions();
    const at0 = new Function(code + `\nreturn mixHex('#ff0000', '#0000ff', 0);`)();
    const at100 = new Function(code + `\nreturn mixHex('#ff0000', '#0000ff', 100);`)();
    assert.equal(at0, '#ff0000');
    assert.equal(at100, '#0000ff');
  });

  it('mixHex at 50% produces midpoint', () => {
    const run = new Function(extractFunctions() + `\nreturn mixHex('#000000', '#ffffff', 50);`);
    const result = run();
    assert.match(result, /^#[0-9a-f]{6}$/);
    const [r, g, b] = [parseInt(result.slice(1, 3), 16), parseInt(result.slice(3, 5), 16), parseInt(result.slice(5, 7), 16)];
    assert.ok(r >= 126 && r <= 129, `red channel should be ~128, got ${r}`);
    assert.ok(g >= 126 && g <= 129, `green channel should be ~128, got ${g}`);
  });

  it('lighten moves toward white', () => {
    const run = new Function(extractFunctions() + `\nreturn lighten('#000000', 50);`);
    const result = run();
    const r = parseInt(result.slice(1, 3), 16);
    assert.ok(r >= 126 && r <= 129, `lightened black by 50% should be ~128 gray, got r=${r}`);
  });

  it('darken moves toward black', () => {
    const run = new Function(extractFunctions() + `\nreturn darken('#ffffff', 50);`);
    const result = run();
    const r = parseInt(result.slice(1, 3), 16);
    assert.ok(r >= 126 && r <= 129, `darkened white by 50% should be ~128 gray, got r=${r}`);
  });

  it('isCustomThemeId returns true for custom- prefixed IDs, false otherwise', () => {
    const code = extractFunctions();
    assert.equal(new Function(code + `\nreturn isCustomThemeId('custom-abc123');`)(), true);
    assert.equal(new Function(code + `\nreturn isCustomThemeId('dark');`)(), false);
    assert.equal(new Function(code + `\nreturn isCustomThemeId('');`)(), false);
    assert.equal(new Function(code + `\nreturn isCustomThemeId(null);`)(), false);
    assert.equal(new Function(code + `\nreturn isCustomThemeId(undefined);`)(), false);
  });

  it('deriveCustomThemeVars returns all critical CSS variables for a light theme', () => {
    const code = extractFunctions();
    const run = new Function(code + `\nreturn deriveCustomThemeVars({ bg:'#f4f2ee', surface:'#ffffff', sidebar:'#1e2433', accent:'#3b6fd9', text:'#1a1f2e', dark:false });`);
    const vars = run();
    assert.equal(typeof vars, 'object');
    assert.equal(vars['--bg'], '#f4f2ee');
    assert.equal(vars['--surface'], '#ffffff');
    assert.equal(vars['--accent'], '#3b6fd9');
    assert.equal(vars['--text'], '#1a1f2e');
    assert.match(vars['--accent-hover'], /^#[0-9a-f]{6}$/);
    assert.match(vars['--text-muted'], /^#[0-9a-f]{6}$/);
    assert.match(vars['--border'], /^#[0-9a-f]{6}$/);
    assert.match(vars['--panel-bg'], /^#[0-9a-f]{6}$/);
    assert.match(vars['--danger'], /^#[0-9a-f]{6}$/);
    assert.ok(vars['--shadow'], '--shadow must be set');
    assert.ok(vars['--modal-overlay'], '--modal-overlay must be set');
    assert.ok(vars['--sidebar-text'], '--sidebar-text must be set');
    assert.ok(vars['--tooltip-bg'], '--tooltip-bg must be set');
    assert.equal(vars['--radius'], '10px');
  });

  it('deriveCustomThemeVars produces different accent-hover for dark vs light', () => {
    const code = extractFunctions();
    const base = { bg:'#121212', surface:'#1c1c1c', sidebar:'#0a0a0a', accent:'#5b8def', text:'#e8ecf3' };
    const darkVars = new Function(code + `\nreturn deriveCustomThemeVars(${JSON.stringify({ ...base, dark: true })});`)();
    const lightVars = new Function(code + `\nreturn deriveCustomThemeVars(${JSON.stringify({ ...base, dark: false })});`)();
    assert.notEqual(darkVars['--accent-hover'], lightVars['--accent-hover']);
    assert.notEqual(darkVars['--modal-overlay'], lightVars['--modal-overlay']);
  });

  it('deriveCustomThemeVars returns at least 25 CSS variables', () => {
    const code = extractFunctions();
    const run = new Function(code + `\nreturn deriveCustomThemeVars({ bg:'#f4f2ee', surface:'#ffffff', sidebar:'#1e2433', accent:'#3b6fd9', text:'#1a1f2e', dark:false });`);
    const vars = run();
    const keys = Object.keys(vars).filter(k => k.startsWith('--'));
    assert.ok(keys.length >= 25, `expected at least 25 CSS vars, got ${keys.length}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Rich text editor / sanitizer — functional extracted JS
// ═══════════════════════════════════════════════════════════════════════
describe('Rich text editor (functional — extracted JS)', () => {
  const script = extractMainScript(html);

  function extractRichTextFns() {
    const escapeHtml = script.match(/function escapeHtml\(str\)\s*\{[\s\S]*?\n    \}/);
    const shouldCollapse = script.match(/function shouldCollapseSoftBreak\(beforePlain, afterStart, beforeHtml[^)]*\)\s*\{[\s\S]*?\n    \}/);
    const plainTextPreview = script.match(/function plainTextPreview\(html, maxLen[^)]*\)\s*\{[\s\S]*?\n    \}/);
    const formatCommentTime = script.match(/function formatCommentTime\(iso\)\s*\{[\s\S]*?\n    \}/);
    const recurringRuleLabel = script.match(/function recurringRuleLabel\(template\)\s*\{[\s\S]*?\n    \}/);
    const createdDateKey = script.match(/function createdDateKey\(item\)\s*\{[\s\S]*?\n    \}/);
    const DAY_LABELS = script.match(/const DAY_LABELS = \[[^\]]+\];/);
    assert.ok(escapeHtml, 'escapeHtml extractable');
    assert.ok(shouldCollapse, 'shouldCollapseSoftBreak extractable');
    assert.ok(plainTextPreview, 'plainTextPreview extractable');
    assert.ok(formatCommentTime, 'formatCommentTime extractable');
    assert.ok(recurringRuleLabel, 'recurringRuleLabel extractable');
    assert.ok(createdDateKey, 'createdDateKey extractable');
    assert.ok(DAY_LABELS, 'DAY_LABELS extractable');
    return [escapeHtml[0], shouldCollapse[0], plainTextPreview[0], formatCommentTime[0],
      DAY_LABELS[0], recurringRuleLabel[0], createdDateKey[0]].join('\n');
  }

  it('escapeHtml escapes &, <, >', () => {
    const run = new Function(extractRichTextFns() + `\nreturn escapeHtml('<b>AT&T</b>');`);
    assert.equal(run(), '&lt;b&gt;AT&amp;T&lt;/b&gt;');
  });

  it('escapeHtml handles null/undefined gracefully', () => {
    const code = extractRichTextFns();
    assert.equal(new Function(code + `\nreturn escapeHtml(null);`)(), '');
    assert.equal(new Function(code + `\nreturn escapeHtml(undefined);`)(), '');
    assert.equal(new Function(code + `\nreturn escapeHtml('');`)(), '');
  });

  it('shouldCollapseSoftBreak collapses mid-sentence continuation', () => {
    const code = extractRichTextFns();
    const BULLET_START_RE = `/^[•\\-\\*○◦▪▸\\u2022\\u2023\\u25E6\\u2043\\u2219]\\s/`;
    const NUMBERED_LINE_RE = `/^\\d+[.)]\\s+\\S/`;
    const BLOCK_END_RE = `/<\\/(ul|ol|li|p|div|h[1-6])>\\s*$/i`;
    const SENTENCE_END_RE = `/[.!?:]["'""»)\\]]*$/`;
    const setup = `const BULLET_START_RE=${BULLET_START_RE};const NUMBERED_LINE_RE=${NUMBERED_LINE_RE};const BLOCK_END_RE=${BLOCK_END_RE};const SENTENCE_END_RE=${SENTENCE_END_RE};\n`;
    assert.equal(new Function(setup + code + `\nreturn shouldCollapseSoftBreak('the quick brown', 'fox jumps');`)(), true);
  });

  it('shouldCollapseSoftBreak does NOT collapse after sentence-ending punctuation', () => {
    const code = extractRichTextFns();
    const setup = `const BULLET_START_RE=/^[•\\-\\*]\\s/;const NUMBERED_LINE_RE=/^\\d+[.)]\\s+\\S/;const BLOCK_END_RE=/<\\/(ul|ol|li|p|div|h[1-6])>\\s*$/i;const SENTENCE_END_RE=/[.!?:]["'""»)\\]]*$/;\n`;
    assert.equal(new Function(setup + code + `\nreturn shouldCollapseSoftBreak('End of sentence.', 'Start of new');`)(), false);
  });

  it('shouldCollapseSoftBreak does NOT collapse before bullet lines', () => {
    const code = extractRichTextFns();
    const setup = `const BULLET_START_RE=/^[•\\-\\*]\\s/;const NUMBERED_LINE_RE=/^\\d+[.)]\\s+\\S/;const BLOCK_END_RE=/<\\/(ul|ol|li|p|div|h[1-6])>\\s*$/i;const SENTENCE_END_RE=/[.!?:]["'""»)\\]]*$/;\n`;
    assert.equal(new Function(setup + code + `\nreturn shouldCollapseSoftBreak('above text', '• bullet item');`)(), false);
  });

  it('plainTextPreview exists, truncates with ellipsis, and uses DOM innerHTML', () => {
    assert.match(html, /function plainTextPreview\(html, maxLen/);
    const fnBody = html.match(/function plainTextPreview[\s\S]*?\n    \}/);
    assert.ok(fnBody, 'plainTextPreview extractable');
    assert.match(fnBody[0], /\.slice\(/);
    assert.match(fnBody[0], /textContent/);
    assert.match(fnBody[0], /maxLen/);
  });

  it('formatCommentTime returns a human-readable timestamp', () => {
    const code = extractRichTextFns();
    const result = new Function(code + `\nreturn formatCommentTime('2026-09-16T12:30:00.000Z');`)();
    assert.ok(result.includes('Sep'), `expected "Sep" in "${result}"`);
    assert.ok(result.includes('16'), `expected "16" in "${result}"`);
  });

  it('recurringRuleLabel returns correct labels for each rule type', () => {
    const code = extractRichTextFns();
    assert.equal(new Function(code + `\nreturn recurringRuleLabel({ rule: 'daily' });`)(), 'Every day');
    assert.equal(new Function(code + `\nreturn recurringRuleLabel({ rule: 'weekdays' });`)(), 'Mon–Fri');
    assert.equal(new Function(code + `\nreturn recurringRuleLabel({ rule: 'weekly', days: [1] });`)(), 'Every Mon');
    assert.equal(new Function(code + `\nreturn recurringRuleLabel({ rule: 'custom', days: [1, 3, 5] });`)(), 'Mon, Wed, Fri');
  });

  it('createdDateKey extracts YYYY-MM-DD from createdAt', () => {
    const code = extractRichTextFns();
    assert.equal(new Function(code + `\nreturn createdDateKey({ createdAt: '2026-09-16T12:00:00Z' });`)(), '2026-09-16');
    assert.equal(new Function(code + `\nreturn createdDateKey({});`)(), '');
  });
});

describe('Rich text editor (HTML invariants)', () => {
  it('sanitizeHtml function is present and handles plain text and HTML', () => {
    assert.match(html, /function sanitizeHtml\(html\)/);
    const fnBody = html.match(/function sanitizeHtml\(html\)\s*\{[\s\S]*?return repairFlowingHtml/);
    assert.ok(fnBody, 'sanitizeHtml should call repairFlowingHtml');
  });

  it('plainTextToRichHtml converts bullets to <ul> lists', () => {
    assert.match(html, /function plainTextToRichHtml\(text\)/);
    const fnBody = html.match(/function plainTextToRichHtml[\s\S]*?return chunks\.join/);
    assert.ok(fnBody, 'plainTextToRichHtml should produce chunked output');
    assert.match(fnBody[0], /<ul>/);
    assert.match(fnBody[0], /<li>/);
  });

  it('normalizeRichHtml processes nested blocks and lists', () => {
    assert.match(html, /function normalizeRichHtml\(html\)/);
    const fnBody = html.match(/function normalizeRichHtml[\s\S]*?return joinRichOutput/);
    assert.ok(fnBody, 'normalizeRichHtml should call joinRichOutput');
  });

  it('repairMashedBullets detects and splits bullet characters', () => {
    assert.match(html, /function repairMashedBullets\(html\)/);
    const fnBody = html.match(/function repairMashedBullets[\s\S]*?return plainTextToRichHtml/);
    assert.ok(fnBody, 'repairMashedBullets should fallback to plainTextToRichHtml');
  });

  it('repairSoftLineBreaks collapses unnecessary <br> tags', () => {
    assert.match(html, /function repairSoftLineBreaks\(html\)/);
    assert.match(html, /shouldCollapseSoftBreak/);
  });

  it('repairOrphanPunctuation pulls orphan punctuation back', () => {
    assert.match(html, /function repairOrphanPunctuation\(html\)/);
    assert.match(html, /ORPHAN_PUNCT_TAIL_RE/);
  });

  it('serializeEditorHtml / serializeEditorNode / serializeEditorInline form a tree', () => {
    assert.match(html, /function serializeEditorHtml\(editor\)/);
    assert.match(html, /function serializeEditorNode\(node\)/);
    assert.match(html, /function serializeEditorInline\(node\)/);
    const serBody = html.match(/function serializeEditorHtml[\s\S]*?normalizeRichHtml/);
    assert.ok(serBody, 'serializeEditorHtml calls normalizeRichHtml');
  });

  it('INLINE_ALLOWED whitelist in sanitizeHtml permits B/STRONG/I/EM/U/S/DEL/BR', () => {
    const fnBody = html.match(/function sanitizeHtml[\s\S]*?return repairFlowingHtml\(normalizeRichHtml\(result\)\);/);
    assert.ok(fnBody, 'sanitizeHtml body extractable');
    assert.match(fnBody[0], /INLINE_ALLOWED.*Set.*B.*STRONG.*I.*EM.*U.*S.*DEL.*BR/);
  });

  it('SKIP_TAGS blocks STYLE/SCRIPT/META in sanitizeHtml', () => {
    assert.match(html, /SKIP_TAGS.*Set.*STYLE.*SCRIPT.*META/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Insights / analytics (HTML invariants + extracted JS)
// ═══════════════════════════════════════════════════════════════════════
describe('Insights tab (HTML invariants)', () => {
  it('insights view element exists', () => {
    assert.match(html, /id="insights-view"/);
    assert.match(html, /id="tab-insights"/);
  });

  it('computeInsights function processes period ranges', () => {
    assert.match(html, /function computeInsights\(period, anchorKey\)/);
    const fnBody = html.match(/function computeInsights[\s\S]*?\n    \}/);
    assert.ok(fnBody, 'computeInsights extractable');
    assert.match(fnBody[0], /getPeriodRange/);
    assert.match(fnBody[0], /analyzeDayItems/);
    assert.match(fnBody[0], /completionRate/);
  });

  it('computeWeekComparison computes deltas against prior week', () => {
    assert.match(html, /function computeWeekComparison\(currentData, anchorKey\)/);
    const fnBody = html.match(/function computeWeekComparison[\s\S]*?\n    \}/);
    assert.ok(fnBody);
    assert.match(fnBody[0], /computeInsights.*'week'/);
  });

  it('analyzeCarryOverPatterns tracks carry-overs by day of week from the period + range', () => {
    assert.match(html, /function analyzeCarryOverPatterns\(period, range\)/);
    const fnBody = html.match(/function analyzeCarryOverPatterns[\s\S]*?\n    \}/);
    assert.ok(fnBody);
    assert.match(fnBody[0], /carryOverByDay/);
    assert.match(fnBody[0], /item\.carriedFrom/);
    assert.match(fnBody[0], /Mon.*Tue.*Wed.*Thu.*Fri/);
  });

  it('computeStreaks finds current and longest streaks', () => {
    assert.match(html, /function computeStreaks\(\)/);
    const fnBody = html.match(/function computeStreaks\(\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(fnBody);
    assert.match(fnBody[0], /currentStreak/);
    assert.match(fnBody[0], /longestStreak/);
  });

  it('renderInsights function exists and handles all three periods', () => {
    assert.match(html, /function renderInsights\(\)/);
    const fnBody = html.match(/function renderInsights\(\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(fnBody);
    assert.match(fnBody[0], /computeInsights/);
    assert.match(fnBody[0], /renderInsightBars/);
    assert.match(fnBody[0], /renderLineChart/);
    assert.match(fnBody[0], /renderHeatmap/);
  });

  it('all chart renderers exist (bars, line, stacked, pie)', () => {
    assert.match(html, /function renderInsightBars\(segments\)/);
    assert.match(html, /function renderLineChart\(segments\)/);
    assert.match(html, /function renderStackedChart\(segments\)/);
    assert.match(html, /function renderPieChart\(segments\)/);
  });

  it('renderInsightsTable produces a summary data table', () => {
    assert.match(html, /function renderInsightsTable\(daily\)/);
  });

  it('renderHeatmap visualizes daily activity', () => {
    assert.match(html, /function renderHeatmap\(startKey, endKey, daily\)/);
  });
});

describe('Insights (functional — extracted JS)', () => {
  const script = extractMainScript(html);

  function extractInsightsFns() {
    const dateFromKey = script.match(/function dateFromKey\(key\)\s*\{[\s\S]*?\n    \}/);
    const formatDateKey = script.match(/function formatDateKey\(date\)\s*\{[\s\S]*?\n    \}/);
    const getPeriodRange = script.match(/function getPeriodRange\(period, anchorKey\)\s*\{[\s\S]*?\n    \}/);
    const createdDateKey = script.match(/function createdDateKey\(item\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(dateFromKey && formatDateKey && getPeriodRange && createdDateKey,
      'insights helper functions must be extractable');
    return [dateFromKey[0], formatDateKey[0], getPeriodRange[0], createdDateKey[0]].join('\n');
  }

  it('getPeriodRange returns correct week range (Mon–Sun)', () => {
    const code = extractInsightsFns();
    const run = new Function(code + `\nreturn getPeriodRange('week', '2026-09-16');`);
    const r = run();
    assert.equal(r.startKey, '2026-09-14');
    assert.equal(r.endKey, '2026-09-20');
    assert.ok(r.label.includes('Sep'), `label should mention Sep: "${r.label}"`);
  });

  it('getPeriodRange returns correct month range', () => {
    const code = extractInsightsFns();
    const run = new Function(code + `\nreturn getPeriodRange('month', '2026-09-16');`);
    const r = run();
    assert.equal(r.startKey, '2026-09-01');
    assert.equal(r.endKey, '2026-09-30');
    assert.ok(r.label.includes('September'), `label should mention September: "${r.label}"`);
  });

  it('getPeriodRange returns correct year range', () => {
    const code = extractInsightsFns();
    const run = new Function(code + `\nreturn getPeriodRange('year', '2026-09-16');`);
    const r = run();
    assert.equal(r.startKey, '2026-01-01');
    assert.equal(r.endKey, '2026-12-31');
    assert.equal(r.label, '2026');
  });

  it('dateFromKey ↔ formatDateKey round-trips', () => {
    const code = extractInsightsFns();
    const run = new Function(code + `\nconst d = dateFromKey('2026-09-16'); return formatDateKey(d);`);
    assert.equal(run(), '2026-09-16');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Recurring templates (HTML invariants)
// ═══════════════════════════════════════════════════════════════════════
describe('Recurring templates (HTML invariants)', () => {
  it('recurring modal HTML structure exists', () => {
    assert.match(html, /id="recurring-modal"/);
    assert.match(html, /id="recurring-modal-body"/);
    assert.match(html, /id="recurring-close"/);
    assert.match(html, /id="recurring-btn"/);
  });

  it('recurring CRUD functions exist', () => {
    assert.match(html, /function loadRecurringTemplates\s*\(/);
    assert.match(html, /function saveRecurringTemplates\s*\(/);
    assert.match(html, /function markRecurringTemplateDeleted\s*\(/);
  });

  it('renderRecurringPanel builds template list with edit/delete actions', () => {
    const fnBody = html.match(/function renderRecurringPanel\(\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(fnBody, 'renderRecurringPanel extractable');
    assert.match(fnBody[0], /recurring-template-item/);
    assert.match(fnBody[0], /recurring-rule-badge/);
    assert.match(fnBody[0], /edit/);
    assert.match(fnBody[0], /delete/);
  });

  it('openRecurringEditForm has rule picker (daily/weekdays/weekly/custom)', () => {
    const fnBody = html.match(/function openRecurringEditForm[\s\S]*?hostEl\.appendChild\(editActions\)/);
    assert.ok(fnBody, 'openRecurringEditForm extractable');
    assert.match(fnBody[0], /daily/);
    assert.match(fnBody[0], /weekdays/);
    assert.match(fnBody[0], /weekly/);
    assert.match(fnBody[0], /custom/);
  });

  it('recurring template items include skip-holidays badge', () => {
    assert.match(html, /skip-holidays/);
    assert.match(html, /skipHolidays/);
  });

  it('injectDueTemplates checks isDueToday before injecting', () => {
    const fnBody = html.match(/function injectDueTemplates\(\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(fnBody, 'injectDueTemplates extractable');
    assert.match(fnBody[0], /isDueToday/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Comments system (HTML invariants)
// ═══════════════════════════════════════════════════════════════════════
describe('Comments system (HTML invariants)', () => {
  it('comment CRUD functions exist', () => {
    assert.match(html, /function addComment\(taskId, content\)/);
    assert.match(html, /function deleteComment\(taskId, commentId\)/);
    assert.match(html, /function updateComment\(taskId, commentId, content\)/);
  });

  it('addComment sanitizes content and validates non-empty', () => {
    const fnBody = html.match(/function addComment\(taskId, content\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(fnBody, 'addComment extractable');
    assert.match(fnBody[0], /sanitizeHtml/);
    assert.match(fnBody[0], /isEmptyHtml/);
  });

  it('deleteComment stores undo data', () => {
    const fnBody = html.match(/function deleteComment\(taskId, commentId\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(fnBody, 'deleteComment extractable');
    assert.match(fnBody[0], /pendingUndo/);
    assert.match(fnBody[0], /showToast.*undo/);
  });

  it('renderCommentsPanel builds thread with edit/delete actions', () => {
    const fnBody = html.match(/function renderCommentsPanel\(item\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(fnBody, 'renderCommentsPanel extractable');
    assert.match(fnBody[0], /comments-list/);
    assert.match(fnBody[0], /add-comment/);
  });

  it('createCommentsButton shows badge with comment count', () => {
    const fnBody = html.match(/function createCommentsButton[\s\S]*?\n    \}/);
    assert.ok(fnBody, 'createCommentsButton extractable');
    assert.match(fnBody[0], /comment-count-badge/);
    assert.match(fnBody[0], /comments-toggle/);
  });

  it('comments panel CSS classes exist', () => {
    assert.match(html, /\.comments-panel/);
    assert.match(html, /\.comments-list/);
    assert.match(html, /\.add-comment-form/);
    assert.match(html, /\.add-comment-trigger/);
    assert.match(html, /\.comment-count-badge/);
  });

  it('splitCommentToItem function exists with correct signature', () => {
    assert.match(html, /function splitCommentToItem\(parentId, commentId, targetType\)/);
  });

  it('splitCommentToItem creates new item, annotates original comment, and shows toast', () => {
    const fnBody = html.match(/function splitCommentToItem\(parentId, commentId, targetType\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(fnBody, 'splitCommentToItem extractable');
    assert.match(fnBody[0], /addItem|newItem|items\.push/, 'creates new item');
    assert.match(fnBody[0], /Split from:/, 'breadcrumb comment added');
    assert.match(fnBody[0], /moved to/, 'original comment annotated');
    assert.match(fnBody[0], /showToast/, 'toast shown');
    assert.match(fnBody[0], /pendingUndo/, 'undo data stored');
    assert.match(fnBody[0], /tags/, 'tags carried over');
  });

  it('splitCommentToItem undo handler restores original comment and removes new item', () => {
    const fnBody = html.match(/function splitCommentToItem\(parentId, commentId, targetType\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(fnBody, 'splitCommentToItem extractable');
    assert.match(fnBody[0], /undo:/, 'undo callback provided');
    assert.match(fnBody[0], /splice\(removeIdx/, 'removes new item on undo');
    assert.match(fnBody[0], /originalComment/, 'restores original comment on undo');
  });

  it('renderCommentsPanel includes text-based edit/delete and split action links', () => {
    const fnBody = html.match(/function renderCommentsPanel\(item\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(fnBody, 'renderCommentsPanel extractable');
    assert.match(fnBody[0], /comment-action-edit/, 'text edit button');
    assert.match(fnBody[0], /comment-action-delete/, 'text delete button');
    assert.match(fnBody[0], /comment-split-btn/);
    assert.match(fnBody[0], /split-task/);
    assert.match(fnBody[0], /split-note/);
    assert.match(fnBody[0], /splitCommentToItem/);
  });

  it('split action CSS classes exist', () => {
    assert.match(html, /\.comment-actions-sep/);
    assert.match(html, /\.comment-split-btn/);
    assert.match(html, /\.comment-action-delete:hover/);
  });

  it('→ task has no permanent accent styling (only hover highlights)', () => {
    assert.doesNotMatch(html, /\.comment-split-btn\.split-task\s*\{/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Shared extractor for functional tests below
// ═══════════════════════════════════════════════════════════════════════
const mainScript = extractMainScript(html);
function fnSource(name) {
  const m = mainScript.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n    \\}`));
  assert.ok(m, `${name} must be extractable from work-desk.html`);
  return m[0];
}

// ═══════════════════════════════════════════════════════════════════════
// splitCommentToItem (functional — runs the real function with stubs)
// ═══════════════════════════════════════════════════════════════════════
describe('splitCommentToItem (functional)', () => {
  function runSplit(targetType, parentExtras = {}) {
    const harness = new Function(`
      let idCounter = 0;
      let pendingUndo = null;
      let lastToast = null;
      let saves = 0;
      const state = { data: { days: {
        '2026-09-22': { items: [
          { id: 'parent', type: 'task', content: 'Parent <b>task</b>', completed: false,
            comments: [{ id: 'c1', content: 'Follow up with JD', createdAt: '2026-09-22T10:00:00Z' }],
            ...${JSON.stringify(parentExtras)} },
        ] },
      } } };
      const newId = () => 'new-' + (++idCounter);
      const sanitizeHtml = (s) => s;
      const stripHtmlTags = (s) => String(s).replace(/<[^>]+>/g, '');
      const cloneData = (x) => JSON.parse(JSON.stringify(x));
      const clearPendingUndo = () => { pendingUndo = null; };
      const clearItemDeleted = () => {};
      const saveData = () => { saves++; };
      const render = () => {};
      const showToast = (msg, opts) => { lastToast = { msg, opts }; };
      function findItem(id) {
        for (const date of Object.keys(state.data.days)) {
          const day = state.data.days[date];
          const idx = day.items.findIndex(i => i.id === id);
          if (idx !== -1) return { date, day, idx, item: day.items[idx] };
        }
        return null;
      }
      ${fnSource('escapeHtml')}
      ${fnSource('splitCommentToItem')}
      splitCommentToItem('parent', 'c1', ${JSON.stringify(targetType)});
      return { state, get pendingUndo() { return pendingUndo; }, lastToast, get saves() { return saves; } };
    `);
    return harness();
  }

  it('split to task adds a task with the comment text, a breadcrumb, and an annotated source comment', () => {
    const h = runSplit('task');
    const items = h.state.data.days['2026-09-22'].items;
    assert.equal(items.length, 2);
    const created = items[1];
    assert.equal(created.type, 'task');
    assert.equal(created.content, 'Follow up with JD');
    assert.equal(created.completed, false);
    assert.equal(created.boardColumn, 'new');
    assert.equal(created.comments.length, 1);
    assert.equal(created.comments[0].content, 'Split from: Parent task');
    assert.match(items[0].comments[0].content, /moved to task/);
    assert.equal(h.lastToast.msg, 'Task created from comment');
    assert.equal(h.pendingUndo.type, 'split-comment');
    assert.equal(h.saves, 1);
  });

  it('split to note creates a note without task-only fields', () => {
    const h = runSplit('note');
    const created = h.state.data.days['2026-09-22'].items[1];
    assert.equal(created.type, 'note');
    assert.equal(created.boardColumn, undefined);
    assert.equal(created.comments, undefined);
    assert.equal(h.lastToast.msg, 'Note created from comment');
  });

  it('carries parent tags onto the new item', () => {
    const h = runSplit('task', { tags: ['ace', 'ids'] });
    assert.deepEqual(h.state.data.days['2026-09-22'].items[1].tags, ['ace', 'ids']);
  });

  it('undo removes the new item and restores the original comment text', () => {
    const h = runSplit('task');
    h.lastToast.opts.undo();
    const items = h.state.data.days['2026-09-22'].items;
    assert.equal(items.length, 1);
    assert.equal(items[0].comments[0].content, 'Follow up with JD');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Streaks (functional — weekend-aware counting)
// ═══════════════════════════════════════════════════════════════════════
describe('Streaks (functional)', () => {
  // 2026-09-18 is a Friday; 2026-09-21 is a Monday
  function runStreaks(activeKeys, { today, skipWeekends = true } = {}) {
    const days = Object.fromEntries(activeKeys.map(k => [k, { items: [{ id: k, type: 'task' }] }]));
    return new Function('days', 'today', 'skip', `
      const state = { data: { days }, streakSkipWeekends: skip };
      const todayKey = () => today;
      const yesterdayKey = () => '';
      ${fnSource('dateFromKey')}
      ${fnSource('formatDateKey')}
      ${fnSource('isConsecutiveDay')}
      ${fnSource('isStreakConsecutive')}
      ${fnSource('computeStreaks')}
      return { computeStreaks, isStreakConsecutive };
    `)(days, today, skipWeekends);
  }

  const MON_TO_FRI = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];

  it('Fri → Mon is consecutive with the toggle on and broken with it off', () => {
    assert.equal(runStreaks([], { skipWeekends: true }).isStreakConsecutive('2026-09-18', '2026-09-21'), true);
    assert.equal(runStreaks([], { skipWeekends: false }).isStreakConsecutive('2026-09-18', '2026-09-21'), false);
  });

  it('a missed weekday breaks the streak even with the toggle on', () => {
    const { isStreakConsecutive } = runStreaks([], { skipWeekends: true });
    assert.equal(isStreakConsecutive('2026-09-17', '2026-09-21'), false);
    assert.equal(isStreakConsecutive('2026-09-14', '2026-09-16'), false);
  });

  it('Sat → Mon bridges an idle Sunday', () => {
    assert.equal(runStreaks([], { skipWeekends: true }).isStreakConsecutive('2026-09-19', '2026-09-21'), true);
  });

  it('Mon–Fri plus the next Monday is a 6-day streak with the toggle on, 5 with it off', () => {
    const keys = [...MON_TO_FRI, '2026-09-21'];
    assert.deepEqual(runStreaks(keys, { today: '2026-09-21', skipWeekends: true }).computeStreaks(), { current: 6, longest: 6 });
    assert.deepEqual(runStreaks(keys, { today: '2026-09-21', skipWeekends: false }).computeStreaks(), { current: 1, longest: 5 });
  });

  it('active weekend days still count toward the streak', () => {
    const keys = [...MON_TO_FRI, '2026-09-19', '2026-09-21'];
    assert.equal(runStreaks(keys, { today: '2026-09-21' }).computeStreaks().longest, 7);
  });

  it('current streak survives into Monday before any Monday activity', () => {
    const r = runStreaks(MON_TO_FRI, { today: '2026-09-21', skipWeekends: true }).computeStreaks();
    assert.equal(r.current, 5);
    const strict = runStreaks(MON_TO_FRI, { today: '2026-09-21', skipWeekends: false }).computeStreaks();
    assert.equal(strict.current, 0);
  });

  it('current streak resets after an idle weekday', () => {
    const r = runStreaks(MON_TO_FRI, { today: '2026-09-22', skipWeekends: true }).computeStreaks();
    assert.equal(r.current, 0);
    assert.equal(r.longest, 5);
  });

  it('no activity yields zero streaks; days with empty item lists do not count', () => {
    assert.deepEqual(runStreaks([], { today: '2026-09-21' }).computeStreaks(), { current: 0, longest: 0 });
    const h = new Function(`
      const state = { data: { days: { '2026-09-21': { items: [] } } }, streakSkipWeekends: true };
      const todayKey = () => '2026-09-21';
      ${fnSource('dateFromKey')}
      ${fnSource('formatDateKey')}
      ${fnSource('isConsecutiveDay')}
      ${fnSource('isStreakConsecutive')}
      ${fnSource('computeStreaks')}
      return computeStreaks();
    `)();
    assert.deepEqual(h, { current: 0, longest: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Insights math (functional)
// ═══════════════════════════════════════════════════════════════════════
describe('Insights math (functional)', () => {
  function insightsFns(days = {}) {
    return new Function('days', `
      const state = { data: { days } };
      ${fnSource('dateFromKey')}
      ${fnSource('formatDateKey')}
      ${fnSource('eachDateInRange')}
      ${fnSource('getPeriodRange')}
      ${fnSource('createdDateKey')}
      ${fnSource('sortNewColumnTasks')}
      ${fnSource('getTaskBuckets')}
      ${fnSource('analyzeDayItems')}
      ${fnSource('computeInsights')}
      ${fnSource('analyzeCarryOverPatterns')}
      ${fnSource('formatInsightsDayLabel')}
      ${fnSource('formatSidebarLabel')}
      return { getTaskBuckets, analyzeDayItems, computeInsights, analyzeCarryOverPatterns, formatInsightsDayLabel, formatSidebarLabel, eachDateInRange };
    `)(days);
  }

  it('getTaskBuckets splits tasks by column/state and floats recurring tasks to the top of New', () => {
    const { getTaskBuckets } = insightsFns();
    const b = getTaskBuckets([
      task({ id: 'n1', boardColumn: 'new' }),
      task({ id: 'r1', boardColumn: 'new', recurringTemplateId: 't1' }),
      task({ id: 'a1', boardColumn: 'active' }),
      task({ id: 'c1', completed: true }),
      task({ id: 's1', shelved: true }),
    ]);
    assert.deepEqual(b.new.map(t => t.id), ['r1', 'n1']);
    assert.deepEqual(b.active.map(t => t.id), ['a1']);
    assert.deepEqual(b.completed.map(t => t.id), ['c1']);
    assert.deepEqual(b.shelved.map(t => t.id), ['s1']);
  });

  it('analyzeDayItems counts completed, shelved, open, carried, created, notes, and comments', () => {
    const { analyzeDayItems } = insightsFns();
    const s = analyzeDayItems('2026-09-22', [
      task({ id: '1', completed: true, createdAt: '2026-09-22T09:00:00Z', comments: [{ id: 'x' }, { id: 'y' }] }),
      task({ id: '2', shelved: true, createdAt: '2026-09-22T09:00:00Z' }),
      task({ id: '3', boardColumn: 'new', createdAt: '2026-09-22T09:00:00Z' }),
      task({ id: '4', boardColumn: 'active', carriedFrom: '2026-09-21', createdAt: '2026-09-21T09:00:00Z' }),
      { id: 'n', type: 'note', content: 'note' },
    ]);
    assert.equal(s.hasActivity, true);
    assert.equal(s.tasks, 4);
    assert.equal(s.completed, 1);
    assert.equal(s.shelved, 1);
    assert.equal(s.unfinished, 2);
    assert.equal(s.openNew, 1);
    assert.equal(s.openCarried, 1);
    assert.equal(s.carriedOver, 1);
    assert.equal(s.createdToday, 3);
    assert.equal(s.notes, 1);
    assert.equal(s.comments, 2);
  });

  it('a task completed on a later day than it was created is not counted as carried over', () => {
    const { analyzeDayItems } = insightsFns();
    const s = analyzeDayItems('2026-09-24', [
      task({ id: 'future', completed: true, createdAt: '2026-09-21T09:00:00Z' }),
    ]);
    assert.equal(s.carriedOver, 0);
    assert.equal(s.createdToday, 0);
  });

  it('computeInsights week totals and completion rate', () => {
    const { computeInsights } = insightsFns({
      '2026-09-14': { items: [task({ id: 'a', completed: true }), task({ id: 'b', completed: true })] },
      '2026-09-16': { items: [task({ id: 'c', shelved: true }), task({ id: 'd', boardColumn: 'active' })] },
      '2026-09-21': { items: [task({ id: 'outside', completed: true })] },
    });
    const r = computeInsights('week', '2026-09-16');
    assert.equal(r.daily.length, 7);
    assert.equal(r.totals.activeDays, 2);
    assert.equal(r.totals.completed, 2);
    assert.equal(r.totals.shelved, 1);
    assert.equal(r.totals.unfinished, 1);
    assert.equal(r.completionRate, 50);
    assert.equal(r.segments.length, 7);
  });

  it('computeInsights returns a null completion rate for an empty period', () => {
    const { computeInsights } = insightsFns();
    assert.equal(computeInsights('week', '2026-09-16').completionRate, null);
  });

  it('computeInsights year view has 12 monthly segments', () => {
    const { computeInsights } = insightsFns({
      '2026-03-10': { items: [task({ id: 'm', completed: true })] },
    });
    const r = computeInsights('year', '2026-09-16');
    assert.equal(r.segments.length, 12);
    assert.equal(r.segments[2].completed, 1);
  });

  // Tasks landing on `toKey` that were left unfinished on `fromKey`
  const carried = (id, fromKey) => task({ id, carriedFrom: fromKey, createdAt: `${fromKey}T09:00:00Z` });
  const SEP = { startKey: '2026-09-01', endKey: '2026-09-30' };

  it('analyzeCarryOverPatterns counts each carry-over on the day it was left unfinished', () => {
    const { analyzeCarryOverPatterns } = insightsFns({
      '2026-09-10': { items: [carried('a', '2026-09-09'), carried('b', '2026-09-09')] }, // left Wed Sep 9
      '2026-09-24': { items: [carried('c', '2026-09-23')] },                              // left Wed Sep 23
      '2026-09-18': { items: [carried('d', '2026-09-17')] },                              // left Thu Sep 17
    });
    const p = analyzeCarryOverPatterns('month', SEP);
    assert.equal(p.total, 4);
    assert.equal(p.carryOverByDay.Wed, 3);
    assert.equal(p.carryOverByDay.Thu, 1, 'Sep 10 arrivals must not count as Thursday');
    assert.equal(p.carryOverByDay.Mon, 0);
    assert.deepEqual(p.datesByWeekday.Wed, [{ dayKey: '2026-09-09', count: 2 }, { dayKey: '2026-09-23', count: 1 }]);
    assert.deepEqual(p.datesByWeekday.Thu, [{ dayKey: '2026-09-17', count: 1 }]);
  });

  it('analyzeCarryOverPatterns ignores notes, uncarried tasks, and carry-overs left outside the period', () => {
    const { analyzeCarryOverPatterns } = insightsFns({
      '2026-09-01': { items: [carried('aug', '2026-08-31')] },                     // left in August
      '2026-10-01': { items: [carried('sep30', '2026-09-30')] },                   // left Sep 30, landed Oct
      '2026-09-15': { items: [
        task({ id: 'plain' }),
        { id: 'n', type: 'note', content: 'x', carriedFrom: '2026-09-14' },
      ] },
    });
    const p = analyzeCarryOverPatterns('month', SEP);
    assert.equal(p.total, 1);
    assert.deepEqual(Object.keys(p.perDate), ['2026-09-30']);
  });

  it('analyzeCarryOverPatterns counts a duplicated task copy only once per source day', () => {
    const { analyzeCarryOverPatterns } = insightsFns({
      '2026-09-10': { items: [carried('dup', '2026-09-09')] },
      '2026-09-11': { items: [carried('dup', '2026-09-09'), carried('dup', '2026-09-10')] },
    });
    const p = analyzeCarryOverPatterns('month', SEP);
    assert.equal(p.perDate['2026-09-09'], 1);
    assert.equal(p.perDate['2026-09-10'], 1, 'a re-carry from the next day is a separate carry-over');
    assert.equal(p.total, 2);
  });

  it('month trend buckets Mon–Sun weeks clipped to the month and sums correctly', () => {
    const { analyzeCarryOverPatterns } = insightsFns({
      '2026-09-10': { items: [carried('a', '2026-09-09'), carried('b', '2026-09-09')] },
      '2026-09-24': { items: [carried('c', '2026-09-23')] },
      '2026-09-30': { items: [carried('d', '2026-09-29')] },
    });
    const p = analyzeCarryOverPatterns('month', SEP);
    assert.deepEqual(p.trend.map((b) => b.label), ['Sep 1–6', 'Sep 7–13', 'Sep 14–20', 'Sep 21–27', 'Sep 28–30']);
    assert.deepEqual(p.trend.map((b) => b.count), [0, 2, 0, 1, 1]);
    assert.equal(p.trend[0].startKey, '2026-09-01');
    assert.equal(p.trend.at(-1).endKey, '2026-09-30');
    assert.equal(p.trend.reduce((s, b) => s + b.count, 0), p.total);
  });

  it('month trend handles a month starting on Sunday (single-day first bucket)', () => {
    const { analyzeCarryOverPatterns } = insightsFns({});
    const p = analyzeCarryOverPatterns('month', { startKey: '2026-11-01', endKey: '2026-11-30' });
    assert.equal(p.trend[0].label, 'Nov 1');
    assert.equal(p.trend[1].label, 'Nov 2–8');
    assert.equal(p.trend.at(-1).label, 'Nov 30');
  });

  it('year trend has 12 month buckets that add up to the total', () => {
    const { analyzeCarryOverPatterns } = insightsFns({
      '2026-03-05': { items: [carried('m', '2026-03-04')] },
      '2026-09-10': { items: [carried('a', '2026-09-09'), carried('b', '2026-09-09')] },
      '2026-12-31': { items: [carried('d', '2026-12-30')] },
    });
    const p = analyzeCarryOverPatterns('year', { startKey: '2026-01-01', endKey: '2026-12-31' });
    assert.equal(p.trend.length, 12);
    assert.deepEqual(p.trend.map((b) => b.label), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
    assert.equal(p.trend[2].count, 1);
    assert.equal(p.trend[8].count, 2);
    assert.equal(p.trend[11].count, 1);
    assert.equal(p.trend[1].endKey, '2026-02-28');
    assert.equal(p.total, 4);
  });

  it('1.8.1 documents the carry-over changes in help and What\'s New', () => {
    const entry = html.match(/version: '1\.8\.1'[\s\S]*?\n      \},/)[0];
    assert.match(entry, /left unfinished/);
    assert.match(html, /id="help-modal"[\s\S]*counted on the day the task was left unfinished/);
    assert.doesNotMatch(html, /which days of the week tasks most often carry over from/);
  });

  it('week view has no trend chart', () => {
    const { analyzeCarryOverPatterns } = insightsFns({ '2026-09-24': { items: [carried('c', '2026-09-23')] } });
    const p = analyzeCarryOverPatterns('week', { startKey: '2026-09-21', endKey: '2026-09-27' });
    assert.equal(p.trend, null);
    assert.equal(p.carryOverByDay.Wed, 1);
  });

  it('eachDateInRange is inclusive and crosses month boundaries', () => {
    const { eachDateInRange } = insightsFns();
    const seen = [];
    eachDateInRange('2026-09-29', '2026-10-02', k => seen.push(k));
    assert.deepEqual(seen, ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('formatInsightsDayLabel shows the real date, adding "(Today)" only for today', () => {
    const { formatInsightsDayLabel } = insightsFns();
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const fmt = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const now = new Date();
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    assert.equal(formatInsightsDayLabel(key(now)), `${fmt(now)} (Today)`);
    assert.equal(formatInsightsDayLabel(key(yest)), fmt(yest));
    assert.equal(formatInsightsDayLabel('2026-01-05'), 'Mon, Jan 5');
  });

  it('sidebar labels still use Today / Yesterday', () => {
    const { formatSidebarLabel } = insightsFns();
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    assert.equal(formatSidebarLabel(key(new Date())), 'Today');
    assert.equal(formatSidebarLabel(key(yest)), 'Yesterday');
  });

  it('the day-by-day table uses the insights formatter, not the sidebar one', () => {
    const body = fnSource('renderInsightsTable');
    assert.match(body, /formatInsightsDayLabel\(row\.dayKey\)/);
    assert.doesNotMatch(body, /formatSidebarLabel/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Desk / Projects view separation + streak preference wiring
// ═══════════════════════════════════════════════════════════════════════
describe('View separation and streak preference (HTML invariants)', () => {
  it('#desk-view.hidden overrides the ID-level display:flex', () => {
    assert.match(html, /#desk-view\s*\{[^}]*display:\s*flex/);
    assert.match(html, /#desk-view\.hidden\s*\{\s*display:\s*none;?\s*\}/);
  });

  it('renderSidebar hides the desk whenever Projects is active', () => {
    const body = fnSource('renderSidebar');
    assert.match(body, /els\.deskView\.classList\.toggle\('hidden', !isDesk \|\| isProjects\)/);
    assert.match(body, /els\.projectsView\.classList\.toggle\('hidden', !isProjects\)/);
    assert.match(body, /els\.insightsView\.classList\.toggle\('hidden', isDesk \|\| isProjects\)/);
  });

  it('renderProjectDetail refreshes the sidebar list so note/task counts stay current', () => {
    assert.match(fnSource('renderProjectDetail'), /renderProjectsList\(\)/);
  });

  it('render() skips desk/insights rendering while in Projects', () => {
    const body = fnSource('render');
    assert.match(body, /if \(state\.listContext === 'projects'\)\s*\{\s*return;/);
  });

  it('streak toggle lives in the Behavior pane and defaults on', () => {
    const behavior = html.match(/id="options-pane-behavior"[\s\S]*?id="us-federal-holidays-toggle"/);
    assert.ok(behavior, 'behavior pane precedes holiday settings');
    assert.match(behavior[0], /id="streak-skip-weekends-toggle"/);
    assert.match(html, /streakSkipWeekends: localStorage\.getItem\(STREAK_SKIP_WEEKENDS_KEY\) !== 'false'/);
  });

  it('streak preference is included in local prefs and applied from cloud prefs', () => {
    assert.match(fnSource('readLocalPrefs'), /streakSkipWeekends/);
    const apply = fnSource('applyCloudPrefs');
    assert.match(apply, /typeof prefs\.streakSkipWeekends === 'boolean'/);
    assert.match(apply, /STREAK_SKIP_WEEKENDS_KEY/);
  });

  it('changing the toggle pushes prefs and re-renders Insights when visible', () => {
    const block = html.match(/streakSkipWeekendsToggle\.addEventListener\('change'[\s\S]*?\}\);/);
    assert.ok(block);
    assert.match(block[0], /schedulePrefsPush\(\)/);
    assert.match(block[0], /renderInsights\(\)/);
  });

  it('docs mention the streak toggle in help and What\'s New', () => {
    assert.match(html, /id="help-modal"[\s\S]*Weekends don't break streaks/);
    const entry = html.match(/version: '1\.7\.0'[\s\S]*?\n      \},/);
    assert.ok(entry);
    assert.match(entry[0], /break streaks/);
  });
});

describe('v1.8.0 themes (HTML invariants)', () => {
  const themesSrc = html.match(/const THEMES = (\[[\s\S]*?\n    \]);/)[1];
  const themes = new Function(`return ${themesSrc}`)();
  const byId = Object.fromEntries(themes.map((t) => [t.id, t]));
  const NEW_LIGHT = ['retro', 'seafoam', 'mediterranean', 'citrus'];
  const NEW_MEDIUM = ['gameboy', 'denim', 'terracotta', 'merlot'];
  const NEW_DARK = ['monokai', 'one-dark', 'phosphor', 'rose-pine'];
  const cssBlock = (id) => [...html.matchAll(new RegExp(`\\[data-theme="${id}"\\] \\{([^}]*)\\}`, 'g'))]
    .find((m) => /--accent:/.test(m[1]));

  it('new themes are registered in the right tier', () => {
    for (const id of NEW_LIGHT) assert.ok(byId[id] && !byId[id].dark && !byId[id].medium, `${id} should be light`);
    for (const id of NEW_MEDIUM) assert.ok(byId[id] && byId[id].medium === true && byId[id].dark === false, `${id} should be medium`);
    for (const id of NEW_DARK) assert.ok(byId[id] && byId[id].dark === true, `${id} should be dark`);
  });

  it('every new theme has a full CSS block whose accent matches its swatch', () => {
    for (const id of [...NEW_LIGHT, ...NEW_MEDIUM, ...NEW_DARK]) {
      const block = cssBlock(id);
      assert.ok(block, `CSS block for ${id} missing`);
      for (const v of ['--bg', '--surface', '--sidebar', '--accent', '--text', '--border']) {
        assert.match(block[1], new RegExp(`${v}:\\s*#`), `${id} missing ${v}`);
      }
      const accent = block[1].match(/--accent:\s*(#[0-9a-fA-F]{6})/)[1];
      assert.equal(accent.toLowerCase(), byId[id].accent.toLowerCase(), `${id} swatch accent drifted from CSS`);
    }
  });

  it('new light themes declare color-scheme: light', () => {
    for (const id of NEW_LIGHT) assert.match(cssBlock(id)[1], /color-scheme:\s*light/, id);
  });

  it('new dark themes are in the shared dark semantics selector list', () => {
    const shared = html.match(/Shared semantics for all non-default dark themes[\s\S]*?\{/)[0];
    for (const id of NEW_DARK) assert.ok(shared.includes(`[data-theme="${id}"]`), `${id} not in shared dark list`);
  });

  it('every new theme has an early-paint favicon entry', () => {
    const favicons = html.match(/const FAVICONS = \{[\s\S]*?\n\s*\};/)[0];
    for (const id of [...NEW_LIGHT, ...NEW_MEDIUM, ...NEW_DARK]) {
      assert.match(favicons, new RegExp(`(^|\\s)'?${id}'?:`, 'm'), `${id} missing from FAVICONS`);
    }
  });

  it('Retro theme draws the SNES four-button stripe on the desk header', () => {
    const stripe = html.match(/\[data-theme="retro"\] \.desk-sticky \{[^}]*\}/);
    assert.ok(stripe);
    for (const c of ['#d02b2b', '#f5c518', '#2e9e44', '#2459c8']) assert.ok(stripe[0].includes(c), `stripe missing ${c}`);
  });

  it('theme swatches expose data-theme-id (not data-theme, which would match theme CSS selectors)', () => {
    const fn = html.match(/function renderThemeSwatches[\s\S]*?grid\.appendChild\(sw\)/)[0];
    assert.match(fn, /sw\.dataset\.themeId = t\.id/);
    assert.doesNotMatch(fn, /sw\.dataset\.theme = /);
  });

  it('bright-accent themes use dark text on primary buttons', () => {
    for (const id of ['gameboy', 'phosphor', 'denim', 'terracotta', 'merlot', 'rose-pine']) {
      assert.match(html, new RegExp(`\\[data-theme="${id}"\\] \\.add-btn`), `${id} add-btn text override missing`);
    }
  });

  it('1.8.0 changelog entry documents the new themes', () => {
    const entry = html.match(/version: '1\.8\.0'[\s\S]*?\n      \},/)[0];
    assert.match(entry, /Retro/);
    assert.equal((html.match(/tag: 'latest'/g) || []).length, 1);
    assert.match(html, /id="help-modal"[\s\S]*84 presets \(28 light, 28 medium, 28 dark/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Theme switching must not wipe other inline settings (font family)
// ═══════════════════════════════════════════════════════════════════════
describe('clearCustomThemeInlineVars', () => {
  function run(initial) {
    const props = { ...initial };
    const style = {
      get length() { return Object.keys(props).length; },
      removeProperty: (k) => { delete props[k]; },
    };
    const keys = () => Object.keys(props);
    const proxy = new Proxy(style, { get: (t, k) => (typeof k === 'string' && /^\d+$/.test(k) ? keys()[Number(k)] : t[k]) });
    const document = { documentElement: { style: proxy } };
    const src = mainScript.match(/const NON_THEME_INLINE_VARS = [^\n]+/)[0];
    new Function('document', `${src}\n${fnSource('clearCustomThemeInlineVars')}\nclearCustomThemeInlineVars();`)(document);
    return props;
  }

  it('keeps the font family while clearing custom theme vars and color-scheme', () => {
    const left = run({
      '--bg': '#000', '--accent': '#f00', '--sidebar': '#111',
      '--font-family': '"JetBrains Mono", monospace',
      'color-scheme': 'dark',
    });
    assert.deepEqual(left, { '--font-family': '"JetBrains Mono", monospace' });
  });

  it('is a no-op on an empty style', () => {
    assert.deepEqual(run({}), {});
  });

  it('1.9.1 documents the font fix', () => {
    const entry = html.match(/version: '1\.9\.1'[\s\S]*?\n      \},/)[0];
    assert.match(entry, /font no longer resets/);
  });

  it('applyTheme clears inline vars before applying, and the font is applied after initTheme', () => {
    assert.match(fnSource('applyTheme'), /clearCustomThemeInlineVars\(\)/);
    assert.match(fnSource('applyFontFamily'), /setProperty\('--font-family'/);
    assert.match(html, /NON_THEME_INLINE_VARS = new Set\(\[[^\]]*'--font-family'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tag colors (functional + HTML invariants)
// ═══════════════════════════════════════════════════════════════════════
describe('Tag colors', () => {
  function tagColorFns(stored = {}) {
    return new Function('stored', `
      const store = { ...stored };
      const localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
      };
      let pushes = 0;
      const schedulePrefsPush = () => { pushes++; };
      const syncTagColorListRows = () => {};
      const document = { querySelectorAll: () => [], documentElement: { dataset: {} }, getElementById: () => null };
      const TAG_COLOR_MODE_KEY = 'work-desk-tag-color-mode';
      const TAG_COLORS_KEY = 'work-desk-tag-colors';
      const TAG_PALETTE_SIZE = 8;
      ${mainScript.match(/const TAG_COLOR_MODES = [^\n]+/)[0]}
      ${fnSource('normalizeTag')}
      ${fnSource('tagPaletteSlot')}
      ${fnSource('normalizeTagColorMode')}
      ${fnSource('normalizeTagColors')}
      ${fnSource('loadTagColors')}
      ${fnSource('saveTagColors')}
      const state = { tagColors: loadTagColors(), tagColorMode: normalizeTagColorMode(localStorage.getItem(TAG_COLOR_MODE_KEY)) };
      ${fnSource('decorateTagChip')}
      ${fnSource('refreshTagChipColors')}
      ${fnSource('applyTagColorMode')}
      ${fnSource('setTagColor')}
      return { tagPaletteSlot, normalizeTagColorMode, normalizeTagColors, decorateTagChip, applyTagColorMode, setTagColor,
        state, store, document, pushes: () => pushes };
    `)(stored);
  }
  const fakeChip = () => {
    const props = {};
    const classes = new Set();
    return {
      dataset: {},
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) },
      style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } },
      props,
    };
  };

  it('tagPaletteSlot is deterministic and within the palette size', () => {
    const { tagPaletteSlot } = tagColorFns();
    for (const tag of ['ace', 'urgent', 'ids', 'p1', 'databricks', 'a', 'x-y_z']) {
      const s = tagPaletteSlot(tag);
      assert.ok(Number.isInteger(s) && s >= 0 && s < 8, `${tag} → ${s}`);
      assert.equal(tagPaletteSlot(tag), s, 'same tag must always map to the same slot');
    }
  });

  it('tagPaletteSlot spreads common tags across several colors', () => {
    const { tagPaletteSlot } = tagColorFns();
    const tags = ['ace', 'urgent', 'ids', 'p1', 'oms', 'databricks', 'postgres', 'aic', 'bug', 'meeting', 'ops', 'kt'];
    assert.ok(new Set(tags.map(tagPaletteSlot)).size >= 5, 'palette should not collapse to a couple of colors');
  });

  it('normalizeTagColorMode allows theme/analogous/palette, defaulting to theme', () => {
    const { normalizeTagColorMode } = tagColorFns();
    assert.equal(normalizeTagColorMode('palette'), 'palette');
    assert.equal(normalizeTagColorMode('analogous'), 'analogous');
    assert.equal(normalizeTagColorMode('theme'), 'theme');
    assert.equal(normalizeTagColorMode(null), 'theme');
    assert.equal(normalizeTagColorMode('rainbow'), 'theme');
  });

  it('normalizeTagColors keeps valid hex colors, normalizes tag names, and drops junk', () => {
    const { normalizeTagColors } = tagColorFns();
    assert.deepEqual(normalizeTagColors({ '#ACE': '#FF0000', urgent: '#00ff00', bad: 'red', '': '#123456', short: '#fff', n: 5 }),
      { ace: '#ff0000', urgent: '#00ff00' });
    assert.deepEqual(normalizeTagColors(null), {});
    assert.deepEqual(normalizeTagColors(['#ff0000']), {});
  });

  it('corrupt stored tag colors load as an empty map', () => {
    const { state } = tagColorFns({ 'work-desk-tag-colors': '{not json' });
    assert.deepEqual(state.tagColors, {});
  });

  it('decorateTagChip sets the slot and applies/removes a custom color', () => {
    const f = tagColorFns({ 'work-desk-tag-colors': JSON.stringify({ urgent: '#ef4444' }) });
    const chip = fakeChip();
    f.decorateTagChip(chip, 'urgent');
    assert.equal(chip.dataset.tag, 'urgent');
    assert.equal(chip.dataset.tagSlot, String(f.tagPaletteSlot('urgent')));
    assert.ok(chip.classList.has('tag-custom'));
    assert.equal(chip.props['--tag-custom'], '#ef4444');

    const plain = fakeChip();
    f.decorateTagChip(plain, 'ace');
    assert.ok(!plain.classList.has('tag-custom'));
    assert.equal(plain.props['--tag-custom'], undefined);
  });

  it('setTagColor saves, normalizes, clears, and schedules a prefs push', () => {
    const f = tagColorFns();
    f.setTagColor('#ACE', '#3B82F6');
    assert.deepEqual(f.state.tagColors, { ace: '#3b82f6' });
    assert.deepEqual(JSON.parse(f.store['work-desk-tag-colors']), { ace: '#3b82f6' });
    assert.equal(f.pushes(), 1);
    f.setTagColor('ace', 'not-a-color');
    assert.deepEqual(f.state.tagColors, {}, 'invalid color clears the custom color');
    f.setTagColor('ace', '#111111');
    f.setTagColor('ace', null);
    assert.deepEqual(f.state.tagColors, {});
    f.setTagColor('', '#111111');
    assert.deepEqual(f.state.tagColors, {}, 'empty tag is ignored');
  });

  it('applyTagColorMode stores the mode on <html> and only pushes for user changes', () => {
    const f = tagColorFns();
    f.applyTagColorMode('palette');
    assert.equal(f.document.documentElement.dataset.tagColors, 'palette');
    assert.equal(f.store['work-desk-tag-color-mode'], 'palette');
    assert.equal(f.pushes(), 1);
    f.applyTagColorMode('bogus', { fromSync: true });
    assert.equal(f.state.tagColorMode, 'theme');
    assert.equal(f.pushes(), 1);
  });

  it('defaults to Theme color mode', () => {
    assert.equal(tagColorFns().state.tagColorMode, 'theme');
    assert.match(html, /<option value="theme">Single color \(accent\)<\/option>\s*<option value="analogous">Analogous \(shades of accent\)<\/option>\s*<option value="palette">Multi-color \(from theme\)<\/option>/);
  });

  it('CSS: chips read --tag-fg/--tag-bg, palette is gated by @supports, custom beats palette', () => {
    assert.match(html, /\.tag-chip \{\s*--tag-fg: var\(--accent\);\s*--tag-bg: var\(--accent-light\);/);
    assert.match(html, /@supports \(color: oklch\(from red l c h\)\) \{\s*html\[data-tag-colors="palette"\] \.tag-chip \{/);
    for (let s = 1; s < 8; s++) assert.match(html, new RegExp(`\\.tag-chip\\[data-tag-slot="${s}"\\] \\{ --tag-hue: ${s * 45}; \\}`));
    // Analogous: every slot gets a hue/lightness offset; lightness is clamped for readability
    assert.match(html, /html\[data-tag-colors="analogous"\] \.tag-chip \{[^}]*oklch\(from var\(--accent\) clamp\(0\.4, calc\(l \+ var\(--tag-dl\)\), 0\.86\) c calc\(h \+ var\(--tag-dh\)\)\)/);
    const offsets = new Set();
    for (let s = 1; s < 8; s++) {
      const m = html.match(new RegExp(`data-tag-colors="analogous"\\] \\.tag-chip\\[data-tag-slot="${s}"\\] \\{ --tag-dh: (-?\\d+); +--tag-dl: (-?[\\d.]+); \\}`));
      assert.ok(m, `analogous slot ${s} missing`);
      assert.ok(Math.abs(Number(m[1])) <= 30, 'analogous hues stay within 30° of the accent');
      offsets.add(`${m[1]}|${m[2]}`);
    }
    assert.equal(offsets.size, 7, 'each analogous slot must look different');
    assert.ok(!offsets.has('0|0'), 'only slot 0 may be the plain accent');
    // (0,3,0) custom selector must out-rank the (0,2,1) palette selector
    assert.match(html, /\.tag-chip\.tag-custom\[data-tag\] \{\s*--tag-fg: color-mix\(in oklch, var\(--tag-custom\) \d+%, var\(--text\)\);/);
    assert.match(html, /\.tag-chip-remove \{[^}]*color: inherit;/);
  });

  it('every chip builder decorates chips; only card chips open the popover', () => {
    const builders = mainScript.match(/chip\.className = 'tag-chip[^']*';[\s\S]{0,300}?decorateTagChip\(chip, tag\)/g) || [];
    assert.equal(builders.length, 4, 'card chips, recurring list chips, template editor chips, and the Options tag list');
    const cardRow = fnSource('buildTagChipRow');
    assert.match(cardRow, /tag-clickable/);
    assert.match(cardRow, /openTagColorPopover\(tag, chip\)/);
    assert.match(cardRow, /e\.stopPropagation\(\)/);
  });

  it('tag list rows update in place instead of re-rendering while you pick', () => {
    const sync = fnSource('syncTagColorListRows');
    assert.doesNotMatch(sync, /innerHTML/);
    assert.match(sync, /document\.activeElement !== input/);
    assert.match(fnSource('refreshTagChipColors'), /syncTagColorListRows\(\)/);
  });

  it('color pickers show the chip\'s displayed color, refreshed on mode and theme changes', () => {
    assert.match(fnSource('syncTagColorListRows'), /displayedTagColorHex\(row\.querySelector\('\.tag-chip'\), tag\)/);
    assert.doesNotMatch(fnSource('syncTagColorListRows'), /TAG_PRESET_COLORS\[/);
    assert.match(fnSource('openTagColorPopover'), /displayedTagColorHex\(anchorEl, tag\)/);
    const shown = fnSource('displayedTagColorHex');
    assert.match(shown, /state\.tagColors\[tag\]/);
    assert.match(shown, /getComputedStyle\(chip\)\.color/);
    assert.match(fnSource('applyTagColorMode'), /syncTagColorListRows\(\)/);
    assert.match(fnSource('applyTheme'), /syncTagColorListRows\(\)/);
  });

  it('1.10.0 documents analogous tag colors', () => {
    const entry = html.match(/version: '1\.10\.0'[\s\S]*?\n      \},/)[0];
    assert.match(entry, /Analogous/);
    assert.match(html, /id="help-modal"[\s\S]*<strong>Analogous \(shades of accent\)<\/strong>/);
  });

  it('every tag chip wraps its text in a label so it can be centered', () => {
    assert.equal((mainScript.match(/className = 'tag-chip( tag-clickable)?';/g) || []).length, 5);
    assert.doesNotMatch(mainScript, /(chip|preview)\.textContent = tag/);
    assert.equal((mainScript.match(/appendChild\(tagChipLabel\(/g) || []).length, 6);
    assert.match(fnSource('tagChipLabel'), /label\.className = 'tag-chip-label'/);
  });

  describe('quick-pick tag suggestions', () => {
    const suggest = (...args) => new Function('args', `
      ${fnSource('normalizeTag')}
      const TAG_SUGGESTION_LIMIT = 2;
      ${fnSource('topTagSuggestions')}
      return topTagSuggestions(...args);
    `)(args);
    const usage = [
      { tag: 'ace', count: 9 },
      { tag: 'workdesk', count: 6 },
      { tag: 'ids', count: 3 },
      { tag: 'admin', count: 1 },
      { tag: 'unused', count: 0 },
    ];

    it('offers the two most-used tags', () => {
      assert.deepEqual(suggest(usage), ['ace', 'workdesk']);
    });

    it('skips tags the item already has and backfills with the next most-used', () => {
      assert.deepEqual(suggest(usage, ['ace']), ['workdesk', 'ids']);
    });

    it('narrows to tags starting with what is typed (ignoring # and case)', () => {
      assert.deepEqual(suggest(usage, [], 'a'), ['ace', 'admin']);
      assert.deepEqual(suggest(usage, [], '#AD'), ['admin']);
      assert.deepEqual(suggest(usage, [], 'zzz'), []);
    });

    it('never suggests tags with no uses (color-only or template-only tags)', () => {
      assert.deepEqual(suggest(usage, ['ace', 'workdesk', 'ids', 'admin']), []);
      assert.deepEqual(suggest([]), []);
    });

    it('card tag input renders the suggestions and keeps focus when one is clicked', () => {
      assert.match(mainScript, /topTagSuggestions\(usage, itemTags, tagInput\.value\)/);
      assert.match(mainScript, /btn\.className = 'tag-chip tag-suggestion'/);
      assert.match(mainScript, /btn\.addEventListener\('mousedown', \(e\) => e\.preventDefault\(\)\)/);
    });

  });

  it('tag chip CSS centers the label in any font', () => {
    const chip = html.match(/\n    \.tag-chip \{[\s\S]*?\n    \}/)[0];
    assert.match(chip, /padding: 2px 8px;/, 'even left/right padding when there is no remove button');
    assert.match(html, /\.tag-chip:has\(\.tag-chip-remove\) \{ padding-right: 5px; \}/);
    assert.match(html, /@supports \(text-box: trim-both cap alphabetic\) \{\s*\.tag-chip \{ padding-block: [\d.]+em; \}\s*\.tag-chip-label \{ text-box: trim-both cap alphabetic; \}/);
  });

  it('1.10.1 documents the chip and carry-over fixes', () => {
    const entry = html.match(/version: '1\.10\.1'[\s\S]*?\n      \},/)[0];
    assert.match(entry, /centered in its pill/);
    assert.match(entry, /same line as its bar/);
  });

  it('1.11.0 documents quick-pick tags', () => {
    const entry = html.match(/version: '1\.11\.0'[\s\S]*?\n      \},/)[0];
    assert.match(entry, /Quick-pick tags/);
    assert.match(html, /id="help-modal"[\s\S]*two most-used tags appear next to the box/);
  });

  it('1.11.1 documents the full-width carry-over bars', () => {
    const entry = html.match(/version: '1\.11\.1'[\s\S]*?\n      \},/)[0];
    assert.match(entry, /stretch the full width/);
  });

  it('1.12.0 documents updates, the stale-copy guard, and search', () => {
    const entry = html.match(/version: '1\.12\.0'[\s\S]*?\n      \},/)[0];
    assert.match(entry, /Update prompt/);
    assert.match(entry, /out-of-date copy/);
    assert.match(entry, /separate lines/);
    assert.doesNotMatch(entry, /tag: 'latest'/);
    assert.match(html, /id="help-modal"[\s\S]*<strong>Staying up to date<\/strong>/);
  });

  it('1.12.1 documents the UI audit fixes', () => {
    const entry = html.slice(html.indexOf("version: '1.12.1'"), html.indexOf("version: '1.12.0'"));
    assert.match(entry, /more carry-over in red/);
    assert.match(entry, /tag box no longer pushes cards/);
    assert.match(html, /id="help-modal"[\s\S]*New, Active, and Completed \/ Shelved columns/);
    assert.doesNotMatch(html, /New \/ Active \/ Done \/ Shelved/);
  });

  it('1.13.0 documents the phone menu', () => {
    const entry = html.match(/version: '1\.13\.0'[\s\S]*?\n      \},/)[0];
    assert.match(entry, /Phone menu/);
    assert.match(entry, /Desktop and tablet layouts are unchanged/);
    assert.doesNotMatch(entry, /tag: 'latest'/);
    assert.match(html, /id="help-modal"[\s\S]*<strong>Phone menu<\/strong>/);
    assert.doesNotMatch(html, /stay available in the sidebar on mobile/);
  });

  it('1.13.1 documents the tag box fix', () => {
    const entry = html.match(/version: '1\.13\.1'[\s\S]*?\n      \},/)[0];
    assert.match(entry, /tag box on a card no longer closes/);
    assert.doesNotMatch(entry, /tag: 'latest'/);
    assert.match(html, /id="help-modal"[\s\S]*box stays open until you add a tag, press Esc, or click outside it/);
  });

  it('1.13.3 is the latest version and documents normal desktop page scroll', () => {
    assert.match(html, /const APP_VERSION = '1\.13\.3'/);
    const latest = html.match(/const CHANGELOG = \[\s*\{[\s\S]*?\n      \},/)[0];
    assert.match(latest, /version: '1\.13\.3'/);
    assert.match(latest, /tag: 'latest'/);
    assert.match(latest, /scrolls like a normal page/);
    assert.equal((html.match(/tag: 'latest'/g) || []).length, 1);
  });

  it('1.13.2 documents the version move', () => {
    const entry = html.match(/version: '1\.13\.2'[\s\S]*?\n      \},/)[0];
    assert.doesNotMatch(entry, /tag: 'latest'/);
    assert.match(entry, /bottom of the sidebar/);
    assert.match(entry, /What\\'s new link/);
    assert.match(html, /id="help-modal"[\s\S]*highlighted <strong>What's new<\/strong> link/);
    assert.doesNotMatch(html, /next to the app name to see the full changelog/);
  });

  it('version lives in the sidebar footer; the What\'s new link sits under the subtitle and hides on close', () => {
    const sub = html.match(/<p id="logo-sub" class="logo-sub">[\s\S]*?<\/p>/)[0];
    assert.doesNotMatch(sub, /version-btn|version-new-dot/);
    assert.match(html, /<\/p>\s*<button id="whats-new-link" class="whats-new-link hidden" type="button">What's new<span id="version-new-dot" class="version-new-dot"><\/span><\/button>/);
    assert.match(html, /<div class="sidebar-version">\s*<button id="version-btn" class="version-btn" type="button" title="What's new"><\/button>\s*<\/div>\s*<\/aside>/);
    assert.equal((html.match(/id="version-btn"/g) || []).length, 1);
    assert.equal((html.match(/id="whats-new-link"/g) || []).length, 1);
    const close = html.match(/function closeChangelog\(\) \{[\s\S]*?\n    \}/)[0];
    assert.match(close, /changelogModal\.classList\.add\('hidden'\);\s*whatsNewLink\.classList\.add\('hidden'\);/);
    const open = html.match(/function openChangelog\(\) \{[\s\S]*?\n    \}/)[0];
    assert.doesNotMatch(open, /whatsNewLink/, 'link stays visible while the changelog is open');
    assert.match(html, /if \(localStorage\.getItem\(LAST_SEEN_VERSION_KEY\) !== APP_VERSION\) \{\s*whatsNewLink\.classList\.remove\('hidden'\);/);
    assert.match(html, /whatsNewLink\.addEventListener\('click', openChangelog\);/);
    assert.match(html, /mobile-menu-new-dot'\)\.classList\.toggle\('hidden', whatsNewLink\.classList\.contains\('hidden'\)\)/);
    assert.doesNotMatch(html, /versionDot/);
  });

  it('card tag box closes on outside clicks, not on blur, and wins focus', () => {
    const box = html.match(/if \(state\.taggingId === item\.id\) \{[\s\S]*?\n        \} else \{/)[0];
    assert.doesNotMatch(box, /addEventListener\('blur'/);
    assert.match(box, /setTimeout\(\(\) => setTimeout\(\(\) => \{ if \(tagInput\.isConnected\) tagInput\.focus\(\); \}, 0\), 0\)/);
    assert.match(html, /if \(!state\.taggingId \|\| e\.target\.closest\?\.\('\.tag-input-wrap'\)\) return;[\s\S]{0,200}state\.taggingId = null;/);
  });

  it('carry-over weekday dates live inside the bar so bars keep full width', () => {
    assert.doesNotMatch(html, /has-dates/);
    assert.match(html, /\.carryover-card:has\(\.carryover-trend\) \.carryover-by-day \.carryover-day-row \{\s*grid-template-columns: 72px 1fr 40px;/);
    assert.match(html, /\.carryover-day-fill \{\s*width: var\(--fill, 0%\);/);
    assert.match(mainScript, /<div class="carryover-day-fill"><\/div>\$\{inBar\}/);
    assert.match(mainScript, /const inside = count \/ carryTotal > 0\.6;/);
  });

  it('tag color prefs are synced both ways', () => {
    const read = fnSource('readLocalPrefs');
    assert.match(read, /tagColorMode: normalizeTagColorMode\(/);
    assert.match(read, /tagColors: loadTagColors\(\)/);
    const apply = fnSource('applyCloudPrefs');
    assert.match(apply, /applyTagColorMode\(next, \{ fromSync: true \}\)/);
    assert.match(apply, /normalizeTagColors\(prefs\.tagColors\)/);
  });

  it('1.9.0 changelog and help document tag colors', () => {
    const entry = html.match(/version: '1\.9\.0'[\s\S]*?\n      \},/)[0];
    assert.match(entry, /Tag colors/);
    assert.match(html, /id="help-modal"[\s\S]*<strong>Tag colors<\/strong>/);
    assert.match(html, /id="help-modal"[\s\S]*<strong>Custom tag color<\/strong>/);
    assert.match(html, /Synced preferences[^<]*<\/strong>[^<]*tag colors/);
  });
});

describe('App updates and stale-client guard', () => {
  const versionFns = (session = {}) => new Function('session', 'APP_VERSION', `
    const sessionStorage = {
      getItem: (k) => (k in session ? session[k] : null),
      setItem: (k, v) => { session[k] = String(v); },
    };
    ${fnSource('compareVersions')}
    ${fnSource('extractAppVersion')}
    ${fnSource('shouldReloadForNewerCloud')}
    return { compareVersions, extractAppVersion, shouldReloadForNewerCloud, session };
  `)(session, '1.12.0');

  it('compareVersions compares each segment numerically', () => {
    const { compareVersions } = versionFns();
    assert.equal(compareVersions('1.10.0', '1.9.1'), 1, '10 > 9 numerically, not as text');
    assert.equal(compareVersions('1.6.0', '1.11.1'), -1);
    assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
    assert.equal(compareVersions('1.12.0', '1.12.0'), 0);
    assert.equal(compareVersions(undefined, '1.12.0'), 0, 'missing version never counts as newer');
    assert.equal(compareVersions('1.x.0', '1.2.0'), 0);
  });

  it('extractAppVersion reads APP_VERSION out of a deployed page', () => {
    const { extractAppVersion } = versionFns();
    assert.equal(extractAppVersion("<script>const APP_VERSION = '1.12.3';</script>"), '1.12.3');
    assert.equal(extractAppVersion('<html>no version</html>'), null);
    assert.equal(extractAppVersion(html), html.match(/const APP_VERSION = '([\d.]+)'/)[1]);
  });

  it('a stale client reloads once when the cloud was written by a newer version', () => {
    const fns = versionFns();
    assert.equal(fns.shouldReloadForNewerCloud('1.13.0'), true);
    assert.equal(fns.shouldReloadForNewerCloud('1.13.0'), false, 'only once per session, so a rollback cannot loop');
    assert.equal(fns.shouldReloadForNewerCloud('1.14.0'), true, 'a later version gets its own reload');
  });

  it('same, older, or missing cloud versions never trigger a reload', () => {
    const fns = versionFns();
    assert.equal(fns.shouldReloadForNewerCloud('1.12.0'), false);
    assert.equal(fns.shouldReloadForNewerCloud('1.6.0'), false);
    assert.equal(fns.shouldReloadForNewerCloud(undefined), false);
    assert.deepEqual(fns.session, {});
  });

  it('sync stamps the app version and bails out before merging, carrying, or pushing', () => {
    assert.match(fnSource('buildSbPayload'), /appVersion: APP_VERSION/);
    const sync = mainScript.slice(mainScript.indexOf('async function sbPostAuthSync'));
    const guard = sync.indexOf('shouldReloadForNewerCloud(remote.data.appVersion)');
    assert.ok(guard > 0);
    assert.ok(guard < sync.indexOf('mergeDaysData('), 'guard runs before any merge');
    assert.ok(guard < sync.indexOf('carryForwardUnfinished('), 'guard runs before auto carry');
    assert.match(sync.slice(guard, guard + 400), /sbSynced = false;[\s\S]*return;/);
  });

  it('service worker is registered without the HTTP cache, and resuming the app checks for updates', () => {
    assert.match(mainScript, /register\('\/work_desk\/sw\.js', \{ scope: '\/work_desk\/', updateViaCache: 'none' \}\)/);
    assert.match(mainScript, /visibilitychange[\s\S]{0,120}checkForAppUpdate\(\)/);
    assert.match(fnSource('checkForAppUpdate'), /fetch\('\/work_desk\/index\.html', \{ cache: 'no-store' \}\)/);
  });
});

describe('UI audit fixes (1.12.1)', () => {
  const load = (name) => new Function(`${fnSource(name)}; return ${name};`)();

  it('week-over-week colors changes by good/bad, and more carry-over is bad', () => {
    const formatChange = load('formatChange');
    assert.match(formatChange(2), /class="change-good">\+2 ↑/);
    assert.match(formatChange(-1), /class="change-bad">-1 ↓/);
    assert.match(formatChange(2, { lowerIsBetter: true }), /class="change-bad">\+2 ↑/);
    assert.match(formatChange(-2, { lowerIsBetter: true }), /class="change-good">-2 ↓/);
    assert.match(formatChange(0), /change-neutral/);
    assert.match(mainScript, /formatChange\(comparison\.change\.carriedOver, \{ lowerIsBetter: true \}\)/);
    assert.doesNotMatch(html, /change-up|change-down/);
  });

  it('search marks finished tasks as done or shelved, never notes', () => {
    const status = load('searchItemStatus');
    assert.equal(status({ type: 'task', completed: true }), 'done');
    assert.equal(status({ type: 'task', shelved: true }), 'shelved');
    assert.equal(status({ type: 'task' }), null);
    assert.equal(status({ type: 'note', completed: true }), null);
    assert.equal((fnSource('collectSearchMatches').match(/status: searchItemStatus\(item\)/g) || []).length, 3);
  });

  it('board columns cannot be widened by their content, and the card action row wraps', () => {
    assert.match(html, /\.sprint-board \{[^}]*grid-template-columns: minmax\(0, 1\.1fr\) minmax\(0, 1\.1fr\) minmax\(0, 0\.9fr\);/);
    assert.match(html, /\.sprint-board \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    assert.match(html, /\.card-action-bar \{\s*display: flex;\s*flex-wrap: wrap;/);
    assert.match(html, /\.tag-input-wrap \{\s*display: inline-flex;\s*flex-wrap: wrap;/);
  });

  it('insights has 8 stat tiles laid out 8, 4, or 2 per row', () => {
    const render = mainScript.slice(mainScript.indexOf("statGrid.className = 'stat-grid'"));
    const cards = render.slice(0, render.indexOf('];')).match(/label: '/g);
    assert.equal(cards.length, 8);
    assert.doesNotMatch(render.slice(0, 600), /Completion rate/);
    assert.match(html, /\.stat-grid \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
    assert.match(html, /@media \(min-width: 1360px\) \{\s*\.stat-grid \{ grid-template-columns: repeat\(8, minmax\(0, 1fr\)\); \}/);
    assert.match(html, /@media \(max-width: 600px\) \{\s*\.stat-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  });

  it('progress bar: Done is the solid accent, Active and New are lighter accent shades', () => {
    assert.match(html, /\.progress-seg\.done \{ background: var\(--progress-done, var\(--accent\)\); \}/);
    assert.match(html, /\.progress-seg\.active \{ background: var\(--progress-active, color-mix\(in srgb, var\(--accent\) 55%/);
    assert.match(html, /\.progress-seg\.new \{ background: var\(--progress-new, color-mix\(in srgb, var\(--accent\) 22%/);
  });

  it('long theme names get the compact label instead of being cut off', () => {
    assert.equal((mainScript.match(/theme-swatch-name\$\{t\.name\.length > 11 \? ' long' : ''\}/g) || []).length, 2);
    assert.match(html, /\.theme-swatch-name \{[^}]*max-width: 100%;/);
    assert.match(html, /\.theme-swatch-name\.long \{ font-size: 0\.56rem;/);
  });

  it('touch screens get finger-sized hit areas without shifting the layout', () => {
    const touch = html.slice(html.indexOf('@media (hover: none), (pointer: coarse)'));
    const block = touch.slice(0, touch.indexOf('.empty-state'));
    assert.match(block, /\.tag-chip-remove::after, \.card-overflow-btn::after[^{]*\{\s*content: ''; position: absolute; inset: -10px;/);
    assert.match(block, /\.card-action, \.comment-split-btn \{ padding: 8px 6px; \}/);
    assert.match(block, /min-height: 36px;/);
  });

  it('calendar badges are amber, the recurring icon follows the theme, and the week strip snaps', () => {
    assert.match(html, /\.cal-day-badge \{[^}]*background: rgba\(245, 158, 11, 0\.2\);[^}]*color: #fbbf24;/);
    assert.doesNotMatch(html, /\u{1F501}/u, 'the always-blue emoji is gone');
    assert.match(html, /id="recurring-btn"[^>]*><svg class="icon-repeat"/);
    assert.match(mainScript, /badge\.innerHTML = REPEAT_ICON_SVG;/);
    assert.match(html, /\.icon-repeat \{[^}]*stroke: currentColor;/);
    assert.match(html, /\.week-strip \{[^}]*scroll-snap-type: x proximity;[^}]*mask-image:/);
  });

  it('year carry-over hides empty future months; streak bar gets labels and a legend', () => {
    assert.match(mainScript, /\.filter\(\(b\) => unit === 'Week' \|\| b\.startKey <= today \|\| b\.count > 0\)/);
    assert.match(mainScript, /labels\.className = 'streak-heatmap-labels';/);
    assert.match(mainScript, /labels\.style\.gridTemplateColumns = heatmap\.style\.gridTemplateColumns;/);
    assert.match(mainScript, /Each block is a day — darker means more tasks/);
  });
});

describe('Deletions stay deleted across devices', () => {
  const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const day = (date, ...items) => ({ [date]: { date, items } });

  const htmlMerge = new Function('lib', `
    const { mergeTags, deduplicateDayItems, deduplicateAcrossDays, normalizeItem } = lib;
    const console = { log() {} };
    ${fnSource('pruneDeletedIds')}
    ${fnSource('mergeDeletedIds')}
    ${fnSource('mergeDaysData')}
    return mergeDaysData;
  `)({ mergeTags, deduplicateDayItems, deduplicateAcrossDays, normalizeItem: (i) => normalizeItem(i, () => i.id) });

  const records = () => new Function(`
    const state = { data: { days: {}, deletedIds: {} } };
    ${fnSource('pruneDeletedIds')}
    ${fnSource('syncRecords')}
    ${fnSource('markItemDeleted')}
    ${fnSource('clearItemDeleted')}
    ${fnSource('markItemRestored')}
    return { state, syncRecords, markItemDeleted, clearItemDeleted, markItemRestored };
  `)();

  for (const [label, merge] of [['lib', mergeDaysData], ['work-desk.html', htmlMerge]]) {
    it(`${label}: a purged task is dropped even when the other device still has a local copy`, () => {
      const local = { days: day('2026-09-30', task({ id: 'zombie', content: 'Old task' })), deletedIds: {} };
      const remote = { days: {}, deletedIds: { zombie: ago(60) }, purgedIds: { zombie: ago(60) } };
      const merged = merge(local, remote);
      assert.equal(Object.values(merged.days).flatMap(d => d.items).length, 0);
      assert.ok(merged.purgedIds.zombie, 'purge record travels on so the next device drops it too');
    });

    it(`${label}: legacy tombstones (no purge record) keep the local-copy-wins rule`, () => {
      const local = { days: day('2026-09-30', task({ id: 'old-undo', content: 'Restored long ago' })), deletedIds: {} };
      const remote = { days: {}, deletedIds: { 'old-undo': ago(600) } };
      const merged = merge(local, remote);
      assert.equal(merged.days['2026-09-30'].items[0].id, 'old-undo');
    });

    it(`${label}: an Undo-restore after the delete wins on every device, including ones without a copy`, () => {
      const remote = {
        days: day('2026-09-29', task({ id: 'undone', content: 'Oops, keep this' })),
        deletedIds: { undone: ago(10) }, purgedIds: { undone: ago(10) }, restoredIds: { undone: ago(9) },
      };
      const merged = merge({ days: {}, deletedIds: {} }, remote);
      assert.equal(merged.days['2026-09-29'].items[0].id, 'undone');
      assert.equal(merged.deletedIds.undone, undefined);
      assert.equal(merged.purgedIds.undone, undefined);
    });

    it(`${label}: deleting again after an Undo wins over the older restore`, () => {
      const local = { days: day('2026-09-30', task({ id: 'twice', content: 'Changed my mind' })), deletedIds: {}, restoredIds: { twice: ago(30) } };
      const remote = { days: {}, deletedIds: { twice: ago(5) }, purgedIds: { twice: ago(5) } };
      const merged = merge(local, remote);
      assert.equal(Object.values(merged.days).flatMap(d => d.items).length, 0);
    });
  }

  it('deleting writes a purge record; Undo replaces it with a restore record', () => {
    const r = records();
    r.markItemDeleted('t1');
    assert.ok(r.state.data.deletedIds.t1);
    assert.equal(r.state.data.purgedIds.t1, r.state.data.deletedIds.t1);
    r.markItemRestored('t1');
    assert.equal(r.state.data.deletedIds.t1, undefined);
    assert.equal(r.state.data.purgedIds.t1, undefined);
    assert.ok(r.state.data.restoredIds.t1);
  });

  it('carry-forward and moves only clear the local tombstone; they never count as a restore', () => {
    assert.match(fnSource('restoreDeleted'), /markItemRestored\(undo\.item\.id\)/);
    assert.doesNotMatch(fnSource('carryForwardUnfinished'), /markItemRestored/);
    assert.equal((mainScript.match(/markItemRestored\(/g) || []).length, 2, 'declaration + Undo only');
  });

  it('syncRecords keeps recent records, drops expired or malformed ones', () => {
    const { syncRecords } = records();
    const out = syncRecords({ purgedIds: { a: ago(1), old: '2020-01-01T00:00:00.000Z' }, restoredIds: 'bad' });
    assert.deepEqual(Object.keys(out.purgedIds), ['a']);
    assert.deepEqual(out.restoredIds, {});
    assert.deepEqual(syncRecords(null), { purgedIds: {}, restoredIds: {} });
  });

  it('loading and importing keep the purge/restore records', () => {
    assert.match(fnSource('loadData'), /\.\.\.syncRecords\(parsed\)/);
    assert.match(fnSource('mergeImportData'), /\.\.\.syncRecords\(state\.data\)/);
    assert.match(fnSource('applyImport'), /deletedIds, \.\.\.syncRecords\(state\.data\)/);
    assert.match(fnSource('applyImportAll'), /\.\.\.syncRecords\(workData\)[\s\S]*\.\.\.syncRecords\(personalData\)/);
  });
});

describe('Service worker (sw.js)', () => {
  const swSource = readFileSync(join(__dirname, '../sw.js'), 'utf8');

  function loadSw({ online = true, networkBody = 'fresh', cached = {} } = {}) {
    const handlers = {};
    const store = new Map(Object.entries(cached));
    const fetches = [];
    const cache = {
      put: async (req, res) => { store.set(typeof req === 'string' ? req : new URL(req.url).pathname, res); },
      match: async (req) => store.get(typeof req === 'string' ? req : new URL(req.url).pathname),
      addAll: async () => {},
    };
    const ctx = {
      self: {
        location: { origin: 'https://example.github.io' },
        addEventListener: (type, fn) => { handlers[type] = fn; },
        skipWaiting: () => {},
        clients: { claim: async () => {} },
      },
      caches: { open: async () => cache, keys: async () => [], delete: async () => true },
      fetch: async (req, init) => {
        fetches.push({ url: req.url, init });
        if (!online) throw new TypeError('offline');
        return { ok: true, status: 200, body: networkBody, clone() { return this; } };
      },
      Request: class { constructor(url, init) { this.url = url; this.init = init; } },
      Response: { error: () => ({ error: true }) },
      URL,
    };
    vm.createContext(ctx);
    vm.runInContext(swSource, ctx);
    const respond = async (url, mode = 'no-cors') => {
      let pending;
      handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: (p) => { pending = p; } });
      return pending;
    };
    return { respond, fetches, store, source: swSource };
  }

  it('pages come from the network first, bypassing the HTTP cache', async () => {
    const sw = loadSw({ cached: { '/work_desk/': { body: 'stale' } } });
    const res = await sw.respond('https://example.github.io/work_desk/', 'navigate');
    assert.equal(res.body, 'fresh', 'a new deploy shows on the first load');
    assert.equal(sw.fetches[0].init.cache, 'no-cache');
    assert.equal(sw.store.get('/work_desk/').body, 'fresh', 'cache is refreshed for offline use');
  });

  it('pages fall back to the cached copy when offline', async () => {
    const sw = loadSw({ online: false, cached: { '/work_desk/index.html': { body: 'offline copy' } } });
    const res = await sw.respond('https://example.github.io/work_desk/', 'navigate');
    assert.equal(res.body, 'offline copy');
  });

  it('icons are served from cache and refreshed in the background', async () => {
    const sw = loadSw({ cached: { '/work_desk/icon-192.png': { body: 'cached icon' } } });
    const res = await sw.respond('https://example.github.io/work_desk/icon-192.png');
    assert.equal(res.body, 'cached icon');
    assert.equal(sw.fetches.length, 1);
  });

  it('cross-origin requests (Supabase, fonts) are left alone', async () => {
    const sw = loadSw();
    assert.equal(await sw.respond('https://abc.supabase.co/rest/v1/user_data'), undefined);
  });

  it('uses a new cache name so the old cache-first copy is cleared', () => {
    const name = swSource.match(/const CACHE = '([^']+)'/)[1];
    assert.notEqual(name, 'work-desk-v1');
    assert.match(swSource, /keys\.filter\(k => k !== CACHE\)\.map\(k => caches\.delete\(k\)\)/);
    assert.match(swSource, /self\.skipWaiting\(\)/);
    assert.match(swSource, /self\.clients\.claim\(\)/);
  });
});

describe('Phone menu (1.13.0)', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

  function phoneBlocks() {
    const blocks = [];
    let from = 0;
    for (;;) {
      const start = css.indexOf('@media (max-width: 768px) {', from);
      if (start < 0) return blocks;
      let depth = 0;
      let i = css.indexOf('{', start);
      for (; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) break;
      }
      blocks.push([start, i + 1]);
      from = i + 1;
    }
  }

  it('sync dot shows off, synced, syncing, or error', () => {
    const state = new Function(`${fnSource('mobileSyncState')}; return mobileSyncState;`)();
    assert.equal(state({ signedIn: false, status: 'ok' }), 'off');
    assert.equal(state({ signedIn: true, status: 'idle' }), 'synced');
    assert.equal(state({ signedIn: true, status: 'ok' }), 'synced');
    assert.equal(state({ signedIn: true, status: 'syncing' }), 'syncing');
    assert.equal(state({ signedIn: true, status: 'error' }), 'error');
  });

  it('outside the phone breakpoint, the menu only ever hides itself', () => {
    let outside = css;
    for (const [s, e] of phoneBlocks().reverse()) outside = outside.slice(0, s) + outside.slice(e);
    const rules = outside.match(/[^{}]*mobile-(menu|sync)[^{}]*\{[^}]*\}/g) || [];
    assert.deepEqual(rules.map((r) => r.trim()), [
      '/* Phone-only menu; every visible rule lives in the max-width: 768px block */\n    .mobile-menu-actions, .mobile-menu-sheet, .mobile-menu-backdrop { display: none; }',
      'body.mobile-menu-open { overflow: hidden; }',
    ]);
  });

  it('phone block hides the moved rows, Today card, version, and gear, and keeps a collapsed sidebar open', () => {
    const phone = phoneBlocks().map(([s, e]) => css.slice(s, e)).join('\n');
    assert.match(phone, /\.sidebar \.sidebar-backup,\s*\.sidebar \.sidebar-account,\s*#sidebar-today-glance,\s*\.sidebar-version,\s*#whats-new-link,\s*#density-toggle \{ display: none; \}/);
    assert.match(phone, /\.sidebar\.collapsed \{ width: 100%;/);
    assert.match(phone, /\.mobile-menu-sheet:not\(\.hidden\) \{[^}]*position: fixed;[^}]*z-index: 91;/);
    assert.match(phone, /\.density-popout \{[^}]*position: fixed;[^}]*bottom: 0;/);
    // Above the pinned add-task dock (45), below modals (100)
    const dock = Number(css.match(/#desk-view \.add-form \{[^}]*z-index: (\d+)/)[1]);
    assert.ok(dock < 90 && 95 < 100);
  });

  it('account and backup are moved into the sheet and put back, never copied', () => {
    const init = mainScript.slice(mainScript.indexOf('function initMobileMenu()'), mainScript.indexOf('initMobileMenu();'));
    assert.match(init, /sections\.forEach\(\(el\) => movedHost\.appendChild\(el\)\)/);
    assert.match(init, /sections\.forEach\(\(el, i\) => homes\[i\]\.after\(el\)\)/);
    assert.doesNotMatch(init, /cloneNode/);
    assert.match(init, /PHONE_QUERY\.addEventListener\('change'/);
    assert.match(mainScript, /const PHONE_QUERY = window\.matchMedia\('\(max-width: 768px\)'\);/);
    for (const id of ['mobile-menu-btn', 'mobile-menu-sheet', 'mobile-menu-backdrop', 'mobile-menu-close', 'mobile-menu-options', 'mobile-menu-whatsnew']) {
      assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
    }
  });
});
