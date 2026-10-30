import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '../work-desk.html'), 'utf8');
const indexHtml = readFileSync(join(__dirname, '../index.html'), 'utf8');

function extractMainScript(source) {
  const blocks = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.ok(blocks.length, 'expected at least one script block');
  return blocks.sort((a, b) => b.length - a.length)[0];
}

// Top-level declarations of the app script (4-space indent), by name. Consts are only kept when their
// initializer is a literal, so loading them can't touch the DOM.
const appDecls = (() => {
  const script = extractMainScript(html);
  const decls = new Map();
  const nextTopLevel = /\n {4}(?! )(\}?)[^\n]*/g;
  for (const m of script.matchAll(/^ {4}(?:async )?function (\w+)\(/gm)) {
    nextTopLevel.lastIndex = m.index + 1;
    const next = nextTopLevel.exec(script);
    const end = !next ? script.length : next[1] ? next.index + 6 : next.index;
    if (!decls.has(m[1])) decls.set(m[1], { kind: 'function', pos: m.index, src: script.slice(m.index, end) });
  }
  for (const m of script.matchAll(/^ {4}(const|let) (\w+) = ([^\n]*)/gm)) {
    if (decls.has(m[2]) || !/^(\[|\{|'|"|`|\d|-\d|\/|true|false|null|new (Set|Map)\()/.test(m[3])) continue;
    let end = m.index + m[0].length;
    if (!m[3].replace(/\s*\/\/.*$/, '').trimEnd().endsWith(';')) {
      nextTopLevel.lastIndex = end;
      const c = nextTopLevel.exec(script);
      if (!c || !/^\n {4}[\]})][^\n]*;\s*$/.test(c[0])) continue;
      end = c.index + c[0].length;
    }
    const src = script.slice(m.index, end);
    if (!/\b(document|window|localStorage)\b/.test(src)) decls.set(m[2], { kind: 'const', pos: m.index, src });
  }
  return decls;
})();

/**
 * Real app functions (and everything they call) running in this realm. `globals` replaces app
 * declarations or browser APIs by name: state, saveData, render, and so on.
 */
const noop = () => {};
const APP_SIDE_EFFECT_STUBS = {
  saveData: noop, render: noop, renderInBackground: noop, showToast: noop, celebrateTaskComplete: noop,
  clearPendingUndo: noop, syncCalendarViewToSelected: noop, clearMoveModal: noop, sbSchedulePush: noop, schedulePrefsPush: noop,
  saveProjectsData: noop, readStorage: () => null, writeStorage: () => true,
  loadRecurringTemplates: () => [], saveRecurringTemplates: noop, loadRecurringDeletedIds: () => ({}),
};

function appFns(names, globals = {}) {
  globals = { ...APP_SIDE_EFFECT_STUBS, ...globals };
  const need = new Set();
  const visit = (name) => {
    if (need.has(name) || name in globals || !appDecls.has(name)) return;
    need.add(name);
    for (const id of new Set(appDecls.get(name).src.match(/[A-Za-z_$][\w$]*/g))) visit(id);
  };
  names.forEach(visit);
  const missing = names.filter((n) => !need.has(n) && !(n in globals));
  assert.deepEqual(missing, [], 'requested names must be top-level declarations in work-desk.html');
  const decls = [...need].map((n) => appDecls.get(n)).sort((a, b) => a.pos - b.pos);  const src = [
    ...decls.filter((d) => d.kind === 'function').map((d) => d.src),
    ...decls.filter((d) => d.kind === 'const').map((d) => d.src),
    `return { ${names.join(', ')} };`,
  ].join('\n');
  return new Function(...Object.keys(globals), src)(...Object.values(globals));
}

// The mocked page has no HTML parser; content matching only needs the text
const stripTags = (h) => String(h || '').replace(/<[^>]*>/g, '');

const appState = { data: { days: {}, deletedIds: {} }, listContext: 'work', useFederalHolidays: true, customHolidays: [] };
const {
  normalizeItem, deduplicateDayItems, deduplicateRecurringSameDay, deduplicateAcrossDays, dayHasRecurringInstance,
  recurringContentKey, recurringDueOn, mergeRecurringTemplates, mergeDeletedIds, mergeDaysData, mergeProjectsData,
  AUTO_COLLAPSE_AT_OPTIONS, normalizeAutoCollapseAt, normalizeTag, normalizeTagList, mergeTags, extractHashtags,
  nthWeekdayOfMonth, lastWeekdayOfMonth, getUSFederalHolidays, applyTaskDropState,
} = appFns([
  'normalizeItem', 'deduplicateDayItems', 'deduplicateRecurringSameDay', 'deduplicateAcrossDays', 'dayHasRecurringInstance',
  'recurringContentKey', 'recurringDueOn', 'mergeRecurringTemplates', 'mergeDeletedIds', 'mergeDaysData', 'mergeProjectsData',
  'AUTO_COLLAPSE_AT_OPTIONS', 'normalizeAutoCollapseAt', 'normalizeTag', 'normalizeTagList', 'mergeTags', 'extractHashtags',
  'nthWeekdayOfMonth', 'lastWeekdayOfMonth', 'getUSFederalHolidays', 'applyTaskDropState',
], { state: appState, stripHtmlTags: stripTags });

// The app reads holiday settings from state
function checkHoliday(dateKey, { useFederal = true, customHolidays = [] } = {}) {
  const { checkHoliday: real } = appFns(['checkHoliday'], {
    state: { ...appState, useFederalHolidays: useFederal, customHolidays },
  });
  return real(dateKey);
}

/**
 * A desk in memory, driven through the app's own actions (carry forward, move, toggle, inject, import).
 * Rendering, toasts, and saving are no-ops; recurring templates live in `templates`.
 */
function deskSandbox({ days = {}, deletedIds = {}, templates = [], today = '2026-08-12', selectedDate = today } = {}) {
  const state = { ...appState, data: { days: structuredClone(days), deletedIds: structuredClone(deletedIds) }, selectedDate };
  const recurring = { templates: structuredClone(templates) };
  let n = 0;
  const fns = appFns(
    ['carryForwardUnfinished', 'moveItem', 'toggleItem', 'moveTaskToColumn', 'injectDueTemplates', 'markTemplateInjectedForDate', 'isDueToday', 'mergeImportInto', 'findItem'],
    {
      state,
      todayKey: () => today,
      newId: () => `new-${++n}`,
      stripHtmlTags: stripTags,
      loadRecurringTemplates: () => recurring.templates,
      saveRecurringTemplates: (t) => { recurring.templates = t; },
      clearItemDeleted: (id) => { delete state.data.deletedIds?.[id]; },
    },
  );
  return { ...fns, state, recurring };
}

/** Runs the app script in a mocked DOM; its top-level function declarations land on the returned context. */
function bootAppInVm() {
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

  vm.createContext(context);
  vm.runInContext(script, context);
  return context;
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

  const today = '2026-08-12';
  const withToday = (items) => ({ [today]: { date: today, items } });

  it('does not inject when a completed instance already exists today', () => {
    const desk = deskSandbox({ today, templates: [template], days: withToday([
      task({ id: 'done', content: '<p>Update the ACE Dashboard</p>', recurringTemplateId: 'tmpl-ace', completed: true }),
    ]) });
    assert.equal(desk.injectDueTemplates(), 0);
    assert.equal(desk.state.data.days[today].items.length, 1);
    assert.equal(desk.recurring.templates[0].lastInjectedDate, today);
  });

  it('does not inject when orphan content matches (stripped template id), and stamps the orphan', () => {
    const desk = deskSandbox({ today, templates: [template], days: withToday([
      task({ id: 'orphan', content: '<p>Update the ACE Dashboard</p>', completed: true }),
    ]) });
    assert.equal(desk.injectDueTemplates(), 0);
    const day = desk.state.data.days[today];
    assert.equal(dayHasRecurringInstance(day, template), true);
    assert.equal(day.items[0].recurringTemplateId, 'tmpl-ace');
  });

  it('injects once when today is empty and due', () => {
    const desk = deskSandbox({ today, templates: [template] });
    assert.equal(desk.injectDueTemplates(), 1);
    assert.equal(desk.state.data.days[today].items[0].recurringTemplateId, 'tmpl-ace');
    assert.equal(desk.injectDueTemplates(), 0, 'a second run the same day adds nothing');
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
    const desk = deskSandbox({ today: '2026-08-17', templates: [
      { id: 'tmpl-a', content: '<p>Update the ACE Dashboard</p>', rule: 'weekdays', lastInjectedDate: null },
      { id: 'tmpl-b', content: '<p>Update the ACE Dashboard</p>', rule: 'weekdays', lastInjectedDate: null },
    ] });
    assert.equal(desk.injectDueTemplates(), 1);
    const items = desk.state.data.days['2026-08-17'].items;
    assert.equal(items.filter(i => recurringContentKey(i.content) === 'update the ace dashboard').length, 1);
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
    const desk = deskSandbox({ today: '2026-08-12', templates: [template], days: {
      '2026-08-11': { date: '2026-08-11', items: [task({ id: 'yest', content: 'Update ACE', recurringTemplateId: 'tmpl-ace' })] },
    } });
    desk.carryForwardUnfinished('2026-08-11');
    assert.equal(desk.injectDueTemplates(), 0);
    const todayItems = desk.state.data.days['2026-08-12'].items.filter(i => i.recurringTemplateId === 'tmpl-ace');
    assert.equal(todayItems.length, 1);
    assert.equal(todayItems[0].id, 'yest');
    assert.equal(todayItems[0].carriedFrom, '2026-08-11');
  });

  it('auto-carry pulls unfinished open tasks from all past days with ID dedupe', () => {
    const desk = deskSandbox({ today: '2026-08-12', days: {
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
    } });
    desk.carryForwardUnfinished(null, { auto: true, allPastDays: true });
    const { days } = desk.state.data;

    assert.equal(days['2026-08-12'].items.filter(i => i.carriedFrom).length, 2);
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

describe('toggleItem / boardColumn', () => {
  const toggled = (item) => {
    const desk = deskSandbox({ days: { '2026-08-12': { date: '2026-08-12', items: [item] } } });
    desk.toggleItem(item.id);
    return desk.state.data.days['2026-08-12'].items[0];
  };

  it('uncomplete preserves New column', () => {
    const open = toggled(task({ id: 'a', boardColumn: 'new', completed: true }));
    assert.equal(open.completed, false);
    assert.equal(open.boardColumn, 'new');
  });

  it('defaults unknown boardColumn to active', () => {
    assert.equal(toggled(task({ id: 'a', boardColumn: 'weird', completed: true })).boardColumn, 'active');
    assert.equal(applyTaskDropState(task({ id: 'b', boardColumn: undefined }), 'completed').boardColumn, 'active');
  });

  it('completing a shelved task unshelves it; uncompleting keeps it unshelved', () => {
    const done = toggled(task({ id: 'a', shelved: true }));
    assert.deepEqual([done.completed, done.shelved], [true, false]);
  });
});

describe('import/export tombstones', () => {
  it('mergeImportInto keeps deletedIds and strips resurrected items', () => {
    const ts = '2026-08-12T10:00:00.000Z';
    const merged = deskSandbox().mergeImportInto(
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

describe('moveItem', () => {
  const twoCopies = {
    '2026-08-10': { date: '2026-08-10', items: [task({ id: 'x', content: 'Older' })] },
    '2026-08-11': { date: '2026-08-11', items: [task({ id: 'x', content: 'Newer', carriedFrom: '2026-08-10', carryCount: 3, carryStart: '2026-08-08' }), task({ id: 'y' })] },
  };

  it('moves the copy on the viewed day, removes the ID from every day, and clears carry stamps', () => {
    const desk = deskSandbox({ days: twoCopies, selectedDate: '2026-08-11' });
    desk.moveItem('x', '2026-08-13');
    const { days } = desk.state.data;
    assert.equal(days['2026-08-10'], undefined);
    assert.equal(days['2026-08-11'].items.map(i => i.id).join(), 'y');
    assert.equal(days['2026-08-13'].items.length, 1);
    assert.equal(days['2026-08-13'].items[0].content, 'Newer');
    for (const k of ['carriedFrom', 'carryCount', 'carryStart']) assert.equal(k in days['2026-08-13'].items[0], false, k);
  });

  it('falls back to the first day holding the ID when the viewed day does not have it', () => {
    const desk = deskSandbox({ days: twoCopies, selectedDate: '2026-08-12' });
    desk.moveItem('x', '2026-08-13');
    const { days } = desk.state.data;
    assert.equal(days['2026-08-13'].items[0].content, 'Older');
    assert.equal(Object.values(days).flatMap(d => d.items).filter(i => i.id === 'x').length, 1);
  });
});

describe('lastInjectedDate advancement', () => {
  it('completing a past-day instance must not stamp today', () => {
    const desk = deskSandbox({ today: '2026-08-12', templates: [{ id: 't1', lastInjectedDate: '2026-08-10', content: 'x', rule: 'daily' }] });
    desk.markTemplateInjectedForDate('t1', '2026-08-11');
    assert.equal(desk.recurring.templates[0].lastInjectedDate, '2026-08-11');
    assert.equal(desk.isDueToday(desk.recurring.templates[0]), true);
    desk.markTemplateInjectedForDate('t1', '2026-08-09');
    assert.equal(desk.recurring.templates[0].lastInjectedDate, '2026-08-11', 'never moves backwards');
  });

  it('deleting today instance stamps today and blocks re-inject', () => {
    const desk = deskSandbox({ today: '2026-08-12', templates: [{ id: 't1', lastInjectedDate: null, content: 'x', rule: 'daily' }] });
    desk.markTemplateInjectedForDate('t1', '2026-08-12');
    assert.equal(desk.isDueToday(desk.recurring.templates[0]), false);
    assert.equal(desk.injectDueTemplates(), 0);
  });
});

describe('sync merge scoring', () => {
  const sameDay = (local, remote) => mergeDaysData(
    { days: { '2026-08-12': { date: '2026-08-12', items: [local] } }, deletedIds: {} },
    { days: { '2026-08-12': { date: '2026-08-12', items: [remote] } }, deletedIds: {} },
  ).days['2026-08-12'].items;

  it('shelved local beats remote open task with one comment, and keeps the comment', () => {
    const [picked, ...rest] = sameDay(
      task({ id: 'a', shelved: true, comments: [] }),
      task({ id: 'a', comments: [{ id: 'c1', content: 'hi', createdAt: '2026-08-12T00:00:00.000Z' }] }),
    );
    assert.equal(rest.length, 0);
    assert.equal(picked.shelved, true);
    assert.equal(picked.comments.length, 1);
  });

  it('completed local beats remote open with comments', () => {
    const [picked] = sameDay(
      task({ id: 'a', completed: true }),
      task({ id: 'a', comments: [{ id: 'c1', content: 'a', createdAt: 'x' }, { id: 'c2', content: 'b', createdAt: 'x' }] }),
    );
    assert.equal(picked.completed, true);
    assert.equal(picked.comments.length, 2);
  });

  it('the longer carry run survives a merge', () => {
    const [picked] = sameDay(
      task({ id: 'a', carriedFrom: '2026-08-11', carryCount: 2, carryStart: '2026-08-10' }),
      task({ id: 'a', completed: true, carriedFrom: '2026-08-11', carryCount: 4, carryStart: '2026-08-07' }),
    );
    assert.deepEqual([picked.carryCount, picked.carryStart], [4, '2026-08-07']);
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

  it('deduplicateAcrossDays prefers completed over a newer open day', () => {
    const { days } = deduplicateAcrossDays({
      '2026-08-15': { date: '2026-08-15', items: [task({ id: 'x', content: 'X' })] },
      '2026-08-12': { date: '2026-08-12', items: [task({ id: 'x', content: 'X', completed: true })] },
    });
    assert.deepEqual(Object.keys(days), ['2026-08-12']);
    assert.equal(days['2026-08-12'].items[0].completed, true);
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
    assert.ok(calls.length >= 2, 'expected runSyncDayJobs and maybeAutoCarryForward call sites');
    for (const m of calls) {
      const before = script.slice(Math.max(0, m.index - 400), m.index);
      assert.match(before, /if \(!?state\.autoCarryForward\)/,
        `auto carry at offset ${m.index} is not guarded by state.autoCarryForward`);
    }
  });

  it('sync still injects recurring templates when Auto carry is off', () => {
    const jobs = fnSource('runSyncDayJobs');
    assert.match(jobs, /if \(state\.autoCarryForward\) \{[\s\S]*?\n\s*\}\n\s*injectDueTemplates\(\);/,
      'injection sits outside the auto-carry guard');
    const sync = fnSource('sbSyncNow');
    const check = sync.slice(sync.indexOf("if (mode === 'check')"), sync.indexOf('const remote ='));
    assert.match(check, /runSyncDayJobs\(\);/, 'the light check (no download) still runs the day jobs');
    assert.equal((sync.match(/runSyncDayJobs\(\);/g) || []).length, 3, 'check, merge, and first-upload paths all run them');
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
    assert.match(moveItemFn[0], /clearCarryStamps\(item\)/);
  });

  it('send to other context clears carriedFrom', () => {
    const sendFn = html.match(/function sendItemToOtherContext\(itemId\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(sendFn, 'sendItemToOtherContext function not found');
    assert.match(sendFn[0], /clearCarryStamps\(item\)/);
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

  it('THEMES contains 108 themes (36 light, 36 medium, 36 dark) with complete wireframe properties', () => {
    const themesMatch = html.match(/const THEMES = (\[[\s\S]*?\n    \]);/);
    assert.ok(themesMatch, 'THEMES array not found in work-desk.html');
    const themes = new Function(`return ${themesMatch[1]}`)();
    assert.equal(themes.length, 108);
    assert.equal(new Set(themes.map((t) => t.id)).size, 108, 'theme ids must be unique');
    const light  = themes.filter((t) => !t.dark && !t.medium);
    const medium = themes.filter((t) => t.medium);
    const dark   = themes.filter((t) => t.dark);
    assert.equal(light.length, 36, 'expected 36 light themes');
    assert.equal(medium.length, 36, 'expected 36 medium themes');
    assert.equal(dark.length, 36, 'expected 36 dark themes');
    for (const [tier, list] of [['light', light], ['medium', medium], ['dark', dark]]) {
      assert.equal(list.length % 4, 0, `${tier} themes should fill the 4-column theme grid (add themes in fours)`);
    }
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
    assert.match(html, /id="account-menu-btn"/);
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
    assert.doesNotThrow(() => bootAppInVm(), 'work-desk.html script must parse and execute without errors');
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

describe('installed app manifest', () => {
  it('does not lock screen orientation, so the installed app rotates on tablets and phones', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8'));
    assert.equal(manifest.orientation, 'any');
    assert.equal(manifest.display, 'standalone');
  });
});

describe('Full screen option', () => {
  it('lives in Behavior > General, is off by default, and is stored on this device only', () => {
    assert.match(html, /<section class="options-section" data-options-section="general"[\s\S]*?<input id="fullscreen-toggle" type="checkbox" \/>[\s\S]*?<\/section>/);
    assert.match(mainScript, /const FULLSCREEN_KEY = 'work-desk-fullscreen';/);
    assert.match(mainScript, /'fullscreen-toggle': false,/);
    const init = fnSource('initFullscreen');
    assert.match(init, /if \(!canFullscreen\(\)\) \{ document\.getElementById\('fullscreen-row'\)\.hidden = true; return; \}/);
    assert.match(init, /document\.addEventListener\('click', onGesture, true\);/);
    assert.match(init, /document\.exitFullscreen\(\)/);
    for (const fn of ['buildPrefsPayload', 'readOptionsSummaryPrefs']) {
      if (mainScript.includes(`function ${fn}(`)) assert.doesNotMatch(fnSource(fn), /FULLSCREEN_KEY|fullscreen/i, `${fn} must not sync it`);
    }
    assert.match(fnSource('enterFullscreen'), /if \(document\.fullscreenElement \|\| !canFullscreen\(\)\) return;\s*document\.documentElement\.requestFullscreen\(\{ navigationUI: 'hide' \}\)\.catch/);
  });
});

describe('desk keyboard shortcuts', () => {
  it('T and N pick Task or Note in the add bar, [ and ] change the day', () => {
    const fn = fnSource('handleDeskShortcut');
    assert.match(fn, /key === 't' \|\| key === 'n'/);
    assert.match(fn, /b\.dataset\.type === \(key === 't' \? 'task' : 'note'\)/);
    assert.match(fn, /e\.key === '\[' \? els\.prevDay : els\.nextDay/);
  });
  it('never fire while typing, with a modifier held, or behind an open menu or dialog', () => {
    const fn = fnSource('handleDeskShortcut');
    assert.match(fn, /if \(e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey \|\| e\.isComposing \|\| e\.defaultPrevented\) return;/);
    assert.match(fn, /isTypingTarget\(e\.target\) \|\| isTypingTarget\(document\.activeElement\) \|\| isOverlayOpen\(\)/);
    assert.match(fnSource('isTypingTarget'), /el\.isContentEditable \|\| \/\^\(INPUT\|TEXTAREA\|SELECT\)\$\//);
    for (const sel of ['.modal:not(.hidden)', '#density-popout:not(.hidden)', '#search-overlay:not(.hidden)', '#mobile-menu-sheet:not(.hidden)', '#account-menu:not(.hidden)']) {
      assert.ok(fnSource('isOverlayOpen').includes(sel), sel);
    }
  });
  it('are listed in Help', () => {
    assert.match(html, /<li><strong>Start a new task \/ note<\/strong> — T \/ N/);
    assert.match(html, /<li><strong>Previous \/ next day<\/strong> — \[ \/ \]<\/li>/);
  });
});

describe('1.22.0 keyboard menus, add-box Esc, and phone toasts', () => {
  const menuFocus = () => {
    const doc = { activeElement: null };
    const item = (label, shown = true) => ({ label, getClientRects: () => (shown ? [{}] : []), focus() { doc.activeElement = this; } });
    const items = [item('Start'), item('Hidden sign-in', false), item('Shelve'), item('Delete')];
    const menu = { querySelectorAll: () => items };
    const moveMenuFocus = new Function('document', `${fnSource('moveMenuFocus')}\nreturn moveMenuFocus;`)(doc);
    return { doc, items, menu, moveMenuFocus };
  };

  it('moveMenuFocus walks the visible items with ↑ / ↓ (wrapping), Home and End, and ignores other keys', () => {
    const { doc, menu, moveMenuFocus } = menuFocus();
    const at = () => doc.activeElement?.label;
    assert.equal(moveMenuFocus(menu, 'ArrowDown'), true);
    assert.equal(at(), 'Start', 'from outside, ↓ goes to the first item');
    moveMenuFocus(menu, 'ArrowDown');
    assert.equal(at(), 'Shelve', 'hidden items are skipped');
    moveMenuFocus(menu, 'End');
    assert.equal(at(), 'Delete');
    moveMenuFocus(menu, 'ArrowDown');
    assert.equal(at(), 'Start', '↓ on the last item wraps to the first');
    moveMenuFocus(menu, 'ArrowUp');
    assert.equal(at(), 'Delete', '↑ on the first item wraps to the last');
    moveMenuFocus(menu, 'Home');
    assert.equal(at(), 'Start');
    assert.equal(moveMenuFocus(menu, 'Enter'), false);
    assert.equal(moveMenuFocus(menu, 'Tab'), false);
  });

  it('↑ from outside the menu goes to the last item', () => {
    const { doc, menu, moveMenuFocus } = menuFocus();
    moveMenuFocus(menu, 'ArrowUp');
    assert.equal(doc.activeElement.label, 'Delete');
  });

  it('the account menu opens on its first item, walks with the arrows, and Esc closes an open Export / Import list first', () => {
    const open = mainScript.match(/accountMenuBtn\.addEventListener\('click', \(e\) => \{[\s\S]*?\n    \}\);/)[0];
    assert.match(open, /openAccountMenu\(\);\s*accountMenu\.querySelector\('\.account-menu-item'\)\?\.focus\(\{ preventScroll: true \}\);/);
    assert.match(mainScript, /accountMenu\.addEventListener\('keydown', \(e\) => \{ if \(moveMenuFocus\(accountMenu, e\.key\)\) e\.preventDefault\(\); \}\);/);
    assert.match(mainScript, /getElementById\('sidebar-account'\)\.addEventListener\('focusout'[\s\S]*?closeAccountMenu\(\);/);
    const esc = mainScript.match(/if \(e\.key !== 'Escape' \|\| accountMenu\.classList\.contains\('hidden'\)\) return;[\s\S]*?accountMenuBtn\.focus\(\{ preventScroll: true \}\);/)[0];
    assert.match(esc, /const openBackup = accountMenu\.querySelector\('\.backup-dropdown:not\(\.hidden\)'\);[\s\S]*?closeBackupMenus\(\);[\s\S]*?\.backup-btn'\)\?\.focus[\s\S]*?return;/);
    assert.match(fnSource('moveMenuFocus'), /\.filter\(b => b\.getClientRects\(\)\.length\)/);
  });

  it('the card ⋮ menu is a labelled menu that focuses its first item, closes on Esc back to ⋮, and on tabbing away', () => {
    const card = html.match(/const overflowBtn = document\.createElement\('button'\);[\s\S]*?actionEnd\.appendChild\(overflowWrap\);/)[0];
    assert.match(card, /overflowBtn\.setAttribute\('aria-haspopup', 'menu'\);/);
    assert.match(card, /overflowMenu\.setAttribute\('role', 'menu'\);/);
    assert.match(card, /btn\.setAttribute\('role', 'menuitem'\);/);
    assert.match(card, /overflowBtn\.setAttribute\('aria-expanded', 'true'\);\s*overflowMenu\.querySelector\('button'\)\?\.focus\(\{ preventScroll: true \}\);/);
    assert.match(card, /if \(e\.key === 'Escape'\) \{[\s\S]*?closeCardMenus\(\);\s*overflowBtn\.focus\(\{ preventScroll: true \}\);/);
    assert.match(card, /moveMenuFocus\(overflowMenu, e\.key\)/);
    assert.match(card, /addEventListener\('focusout'[\s\S]*?!overflowWrap\.contains\(e\.relatedTarget\)\) closeCardMenus\(\);/);
    assert.match(fnSource('closeCardMenus'), /setAttribute\('aria-expanded', 'false'\)/);
    assert.ok(fnSource('isOverlayOpen').includes('.card-overflow-menu:not(.hidden)'), 'shortcuts stay quiet while a card menu is open');
  });

  it('the recurring row menu uses the same ⋮ icon and arrow keys', () => {
    const row = fnSource('buildRecurringRow');
    assert.match(row, /moreBtn\.textContent = '⋮';/);
    assert.match(row, /menu\.addEventListener\('keydown', \(e\) => \{ if \(moveMenuFocus\(menu, e\.key\)\) e\.preventDefault\(\); \}\);/);
  });

  it('shortcuts check visibility with getClientRects, since the pinned phone add bar has no offsetParent', () => {
    const fn = fnSource('handleDeskShortcut');
    assert.match(fn, /if \(!els\.addForm\.getClientRects\(\)\.length\) return;/);
    assert.match(fn, /if \(!arrow\.getClientRects\(\)\.length\) return;/);
    assert.doesNotMatch(fn, /offsetParent/);
    assert.doesNotMatch(fnSource('initAddEditor'), /offsetParent/);
  });

  it('Esc in the add box leaves it without clearing the text', () => {
    const block = mainScript.match(/els\.addEditorHost\.addEventListener\('keydown', \(e\) => \{[\s\S]*?\n    \}\);/)[0];
    assert.match(block, /if \(e\.key !== 'Escape' \|\| !addEditor \|\| e\.target !== addEditor\) return;/);
    assert.match(block, /addEditor\.blur\(\);/);
    assert.doesNotMatch(block, /clearAddEditor/);
  });

  it('toasts sit above the pinned phone add bar', () => {
    assert.match(html, /\.toast \{\s*position: fixed; bottom: calc\(24px \+ var\(--add-dock-h, 0px\)\);/);
    const init = fnSource('initAddEditor');
    assert.match(init, /getComputedStyle\(els\.addForm\)\.position === 'fixed'/);
    assert.match(init, /setProperty\('--add-dock-h', docked \? `\$\{els\.addForm\.offsetHeight\}px` : '0px'\)/);
    assert.match(init, /new ResizeObserver\(syncAddDock\)\.observe\(els\.addForm\)/);
  });

  it('recurring Edit form: Enter, Esc, and the delayed blur each finish "+ tag" only once', () => {
    const edit = fnSource('openRecurringEditForm');
    assert.match(edit, /const commitTagInput = \(\) => \{\s*if \(tagInputDone\) return;\s*tagInputDone = true;/);
    assert.match(edit, /e\.key === 'Escape'\) \{\s*e\.preventDefault\(\);\s*tagInputDone = true;\s*renderEditTagChips\(\);/);
    assert.match(edit, /addEventListener\('blur', \(\) => setTimeout\(commitTagInput, 100\)\)/);
  });

  it('the unused helpers are gone and Help lists the menu keys', () => {
    for (const name of ['makeSection', 'closeThemePicker', 'startTask']) {
      assert.doesNotMatch(html, new RegExp(`function ${name}\\(`), name);
    }
    assert.match(html, /<li><strong>Move around a menu<\/strong> — ↑ \/ ↓<\/li>/);
    assert.match(html, /<li><strong>Cancel an edit, close a menu, or leave the add box<\/strong> — Escape<\/li>/);
  });
});

describe('1.22.1 Month chart trims future days and empty weekends', () => {
  const dateFromKey = (k) => new Date(`${k}T12:00:00`);
  const trim = (...args) => new Function('dateFromKey', `${fnSource('trimMonthSegments')}\nreturn trimMonthSegments;`)(dateFromKey)(...args);
  // Oct 2026: the 3rd and 4th are Sat/Sun, the 5th a Monday
  const days = [
    ['2026-10-02', true], ['2026-10-03', false], ['2026-10-04', true], ['2026-10-05', false],
    ['2026-10-06', false], ['2026-10-07', true], ['2026-10-10', false],
  ];
  const segments = days.map(([dayKey]) => ({ dayKey }));
  const daily = days.map(([dayKey, hasActivity]) => ({ dayKey, hasActivity }));
  const keys = (r) => r.segments.map((s) => s.dayKey);

  it('drops empty days after today but keeps a future day that has something on it', () => {
    const r = trim(segments, daily, { hideEmptyWeekends: false, today: '2026-10-05' });
    assert.deepEqual(keys(r), ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-07']);
    assert.equal(r.hiddenWeekends, 0, 'future days are not counted as hidden weekends');
  });

  it('with Quieter weekends, drops empty Sat/Sun up to today and counts them; a busy weekend day stays', () => {
    const r = trim(segments, daily, { hideEmptyWeekends: true, today: '2026-10-31' });
    assert.deepEqual(keys(r), ['2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
    assert.equal(r.hiddenWeekends, 2, 'the empty Sat 3rd and Sat 10th');
  });

  it('a past month keeps every weekday, empty or not', () => {
    const r = trim(segments, daily, { hideEmptyWeekends: false, today: '2026-11-15' });
    assert.equal(r.segments.length, segments.length);
  });

  it('renderInsights trims only the Month chart, hides the note on Pie, and Change opens Options at the setting', () => {
    const src = fnSource('renderInsights');
    assert.match(src, /if \(state\.insightsPeriod === 'month'\) \{\s*\(\{ segments: chartSegments, hiddenWeekends \} = trimMonthSegments\(segments, daily, \{\s*hideEmptyWeekends: quietWeekendsActive\(state\.quietWeekends, state\.listContext\),/);
    assert.match(src, /if \(hiddenWeekends && state\.insightsChartType !== 'pie'\)/);
    assert.match(src, /openOptionsAt\('behavior', 'general', 'quiet-weekends-select'\)/);
    for (const r of ['renderInsightBars', 'renderLineChart', 'renderStackedChart']) assert.match(src, new RegExp(`${r}\\(chartSegments\\)`));
    assert.match(src, /renderPieChart\(segments\)/);
    assert.match(mainScript, /renderCalendar\(\);\s*if \(state\.activeTab === 'insights'\) renderInsights\(\);/);
  });
});

describe('1.22.1 Insights two columns on wide screens', () => {
  it('cards go into a left and right column; the columns only switch on when the Insights area is 1500px or wider', () => {
    const src = fnSource('renderInsights');
    assert.match(src, /cols\.className = 'insights-cols';/);
    assert.match(html, /#insights-view \{ container: insights \/ inline-size; \}/);
    assert.match(html, /\.insights-cols, \.insights-col \{ display: contents; \}/);
    assert.match(html, /@container insights \(min-width: 1500px\) \{\s*\.insights-panel \{ max-width: 2000px; \}\s*\.insights-cols \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  });
});

describe('1.23.1 Phone Insights spacing', () => {
  it('Year-over-Year rows stack on a narrow card: label and change, then this period and last', () => {
    const block = html.slice(html.indexOf('/* Narrow card: label and change on top'));
    assert.match(block, /grid-template-areas: "label label change" "current previous previous";/);
    assert.match(block, /\.comp-previous \{ grid-area: previous; align-self: center; \}/);
    assert.match(block, /\.comparison-row > :last-child \{ grid-area: change; justify-self: end; \}/);
  });

  it('Streak gaps live in CSS, and the year strip drops its 1px gaps on a narrow card', () => {
    const src = fnSource('renderInsights');
    assert.doesNotMatch(src, /heatmap\.style\.gap|labels\.style\.gap/);
    assert.match(src, /heatmap\.classList\.add\(`period-\$\{state\.insightsPeriod\}`\);/);
    assert.match(html, /\.streak-card \{ container: streak \/ inline-size; \}/);
    assert.match(html, /@container streak \(max-width: 1100px\) \{\s*\.streak-heatmap\.period-year \{ gap: 0; \}/);
  });

  it('year labels get one column per month, as wide as its days', () => {
    const src = fnSource('renderInsights');
    assert.match(src, /labels\.style\.gridTemplateColumns = months\.map\(\(m\) => `minmax\(0, \$\{m\.days\}fr\)`\)\.join\(' '\);/);
  });
});

describe('1.23.3 Phone Options: layout, week strip weekends, tap targets', () => {
  const layout = html.slice(html.indexOf('data-options-section="layout"'), html.indexOf('data-options-section="effects"'));

  it('the Right layout only applies from 769px up, like Top and Bottom', () => {
    assert.match(html, /@media \(min-width: 769px\) \{\s*\[data-sidebar-position="right"\] \.app \{ flex-direction: row-reverse; \}/);
    assert.doesNotMatch(html, /\n {4}\[data-sidebar-position="right"\] \.app \{/);
  });

  it('phones see one note in Layout; all three settings are tablet and computer only', () => {
    assert.match(html, /@media \(max-width: 768px\) \{ \.phone-hide \{ display: none !important; \} \}/);
    assert.match(html, /@media \(min-width: 769px\) \{ \.phone-only \{ display: none !important; \} \}/);
    assert.match(layout, /<p class="sidebar-position-note phone-only">Layout settings apply on tablets and computers\. Phones always use the top bar, and the calendar legend and Today's Progress card only appear in the sidebar there\.<\/p>\s*<div class="customize-select-row phone-hide">\s*<label for="sidebar-position-select">/);
    assert.match(layout, /<label class="customize-toggle phone-hide" title="The key under the sidebar calendar">\s*<input id="show-cal-legend-toggle"/);
    assert.match(layout, /<label class="customize-toggle phone-hide" title="The progress card in the sidebar">\s*<input id="show-today-progress-toggle"/);
    assert.equal((layout.match(/phone-hide/g) || []).length, 3);
    assert.ok(html.includes('<span class="options-row-desc"><span class="phone-hide">Sidebar side, calendar legend, progress</span><span class="phone-only">Tablets and computers</span></span>'));
  });

  it('the Layout tooltip says it applies on tablets and computers on a phone', () => {
    const summary = new Function(`const capitalize = (s) => s; ${fnSource('optionsSummaryText')} return optionsSummaryText;`)();
    assert.equal(summary('layout', { sidebarPosition: 'right', showCalLegend: true, showTodayProgress: true }), 'Sidebar right');
    assert.equal(summary('layout', { sidebarPosition: 'top', showCalLegend: false, showTodayProgress: false }), 'Sidebar top · No legend · No progress');
    assert.equal(summary('layout', { sidebarPosition: 'right', showCalLegend: false, showTodayProgress: false, phone: true }), 'Applies on tablets and computers');
    assert.match(fnSource('readOptionsSummaryPrefs'), /phone: window\.matchMedia\('\(max-width: 768px\)'\)\.matches,/);
  });

  it('the week strip marks weekends and dims them when Quieter weekends covers the desk', () => {
    const strip = fnSource('renderWeekStrip');
    assert.match(strip, /if \(cur\.getDay\(\) % 6 === 0\) btn\.classList\.add\('weekend'\);/);
    assert.match(strip, /host\.classList\.toggle\('quiet-weekends', quietWeekendsActive\(state\.quietWeekends, state\.listContext\)\);/);
    assert.match(fnSource('renderCalendar'), /els\.weekStrip\?\.classList\.toggle\('quiet-weekends', quietWeekendsActive\(state\.quietWeekends, state\.listContext\)\);/);
    assert.match(html, /\.week-strip\.quiet-weekends \.week-day\.weekend:not\(\.selected\):not\(\.today\) \{ background: transparent; opacity: 0\.55; \}/);
  });

  it('Options controls are at least 36px tall on phones only', () => {
    const block = html.match(/@media \(max-width: 768px\) \{\s*\.density-popout select, \.custom-holiday-input \{ min-height: 36px; \}\s*\.options-back-btn, \.custom-holiday-add-btn \{ min-height: 36px; padding-inline: 10px; \}\s*\.current-theme-btn \{ min-height: 32px; \}\s*\}/);
    assert.ok(block);
  });
});

describe('1.23.2 Wide fonts and Large text', () => {
  it('year heatmap: month labels run over the following weeks, and narrow cards use 1px gaps', () => {
    assert.match(html, /\.heatmap-month-label \{[^}]*white-space: nowrap;\s*overflow: visible;/);
    assert.match(html, /\.heatmap-wrap \{[^}]*container: heatmap \/ inline-size;/);
    assert.match(html, /@container heatmap \(max-width: 700px\) \{\s*\.heatmap-months, \.heatmap-row \{ gap: 1px; \}/);
  });

  it('comparison rows stack by card width, not screen width, and last period can wrap', () => {
    assert.match(html, /\.comparison-card \{ container: comparison \/ inline-size; \}/);
    assert.match(html, /grid-template-columns: 140px minmax\(60px, auto\) minmax\(0, 1fr\) auto;/);
    assert.match(html, /@container comparison \(max-width: 560px\) \{\s*\.comparison-row \{/);
    assert.doesNotMatch(html, /\.comp-previous \{\s*font-size: 0\.78rem;\s*color: var\(--text-muted\);\s*white-space: nowrap;/);
  });

  it('phones: tag counts wrap; shelved, lingering, chain and recurring names get two lines before the ellipsis', () => {
    const phone = html.slice(html.indexOf('.tag-breakdown { grid-template-columns: 90px minmax(0, 1fr); }'));
    assert.match(phone, /\.tag-breakdown-counts \{ grid-column: 1 \/ -1; margin-top: -4px; white-space: normal; \}/);
    assert.match(phone, /\.insight-task-text, \.recurring-name \{\s*white-space: normal;\s*display: -webkit-box;\s*-webkit-box-orient: vertical;\s*-webkit-line-clamp: 2;/);
  });

  it('sidebar desk tabs shrink with the sidebar; the calendar badge sits up in the corner', () => {
    assert.match(html, /\.context-tabs \{ container: context-tabs \/ inline-size; \}\s*\.context-tabs \.app-tab \{\s*padding: 6px 6px;\s*font-size: clamp\(0\.62rem, 6cqi, 0\.76rem\);/);
    assert.match(html, /\.cal-day-badge \{\s*position: absolute;\s*top: -4px;\s*right: -3px;/);
  });

  it('Help index: up to 4 per row, fewer when the labels need the room', () => {
    assert.match(html, /\.help-index \{\s*display: grid;\s*font-size: 0\.74rem;\s*grid-template-columns: repeat\(auto-fill, minmax\(max\(8\.6em, calc\(\(100% - 12px\) \/ 4\)\), 1fr\)\);/);
    assert.doesNotMatch(html, /@media \(max-width: 480px\) \{ \.help-index/);
  });
});

describe('1.23.1 Most productive day: average completions per day, not completion rate', () => {
  const { mostProductiveWeekday } = appFns(['mostProductiveWeekday']);
  const day = (dayKey, tasks, completed) => ({ dayKey, tasks, completed });
  // Oct 2026: 5 Mon, 6 Tue, 7 Wed, 8 Thu, 9 Fri, 10 Sat
  const week = [day('2026-10-05', 8, 7), day('2026-10-06', 10, 10), day('2026-10-07', 9, 8), day('2026-10-08', 9, 9), day('2026-10-09', 6, 6)];

  it('one fully finished Saturday no longer beats a busy weekday', () => {
    assert.equal(mostProductiveWeekday([...week, day('2026-10-10', 1, 1)]), 'Tuesday');
  });

  it('averages over the days of that weekday that had tasks; empty days do not count', () => {
    const days = [day('2026-10-05', 10, 10), day('2026-10-12', 0, 0), day('2026-10-06', 12, 6), day('2026-10-13', 12, 6)];
    assert.equal(mostProductiveWeekday(days), 'Monday');
  });

  it('a tie on average goes to the weekday with more completions overall', () => {
    const days = [day('2026-10-05', 5, 4), day('2026-10-06', 5, 4), day('2026-10-13', 5, 4)];
    assert.equal(mostProductiveWeekday(days), 'Tuesday');
  });

  it('N/A when nothing was completed or there were no tasks', () => {
    assert.equal(mostProductiveWeekday([]), 'N/A');
    assert.equal(mostProductiveWeekday([day('2026-10-05', 3, 0)]), 'N/A');
  });

  it('renderInsights uses it for the Most Productive Day tile', () => {
    assert.match(fnSource('renderInsights'), /const bestDay = mostProductiveWeekday\(daily\);/);
  });
});

describe('1.23.1 Insights layout: tiles on top, Streak and breakdown as column cards', () => {
  const src = () => fnSource('renderInsights');

  it('the stat tiles follow the header, before the columns', () => {
    const s = src();
    const tiles = s.indexOf('panel.appendChild(statGrid)');
    assert.ok(tiles > s.indexOf('panel.appendChild(header)'));
    assert.ok(tiles < s.indexOf('panel.appendChild(cols)'));
  });

  it('every summary card gets a reading-order slot: Summary, comparison, Streak, breakdown, Carry-Over, then the rest', () => {
    const s = src();
    assert.match(s, /const COLUMN_SLOTS = \{ metrics: 0, comparison: 1, streak: 2, chart: 3, carryover: 4, more: 5 \};/);
    for (const [card, slot] of [['metricsCard', 'metrics'], ['compCard', 'comparison'], ['streakCard', 'streak'], ['chartSection', 'chart'], ['carryCard', 'carryover']]) {
      assert.match(s, new RegExp(`addColumnCard\\(${card}, COLUMN_SLOTS\\.${slot}\\)`), card);
    }
    assert.match(s, /renderTagBreakdownCard\(range\),\s*renderLingeringCard\(todayKey\(\)\),\s*renderShelvedCard\(range, todayKey\(\)\),\s*renderRecurringCard\(range, todayKey\(\)\),\s*renderCarryChainsCard\(range, state\.insightsPeriod\),\s*renderTagTrendCard\(state\.insightsPeriod, state\.insightsAnchor, todayKey\(\)\),\s*\]\.forEach\(\(card, i\) => \{\s*if \(card\) addColumnCard\(card, COLUMN_SLOTS\.more \+ i\);/);
  });

  it('Day-by-day detail and the year heatmap stay full width after the columns', () => {
    const s = src();
    assert.match(s, /panel\.appendChild\(renderHeatmap\(range\.startKey, range\.endKey, daily\)\)/);
    assert.match(s, /panel\.appendChild\(tableSection\)/);
    assert.doesNotMatch(s, /panel\.appendChild\((streakCard|chartSection)\)/);
  });

  it('balancing sorts by slot and puts each card in the shorter column; one column keeps reading order', () => {
    const b = fnSource('balanceInsightColumns');
    assert.match(b, /\.sort\(\(a, b\) => a\.dataset\.colOrder - b\.dataset\.colOrder\)/);
    assert.match(b, /if \(getComputedStyle\(cols\)\.display !== 'grid'\) \{\s*left\.append\(\.\.\.cards\);/);
    assert.match(b, /\(right\.offsetHeight < left\.offsetHeight \? right : left\)\.appendChild\(card\)/);
  });

  it('no CSS order rules are left to fight the reading order', () => {
    assert.doesNotMatch(html, /\.insights-panel \.[a-z-]+-card \{ order: \d+; \}/);
    assert.doesNotMatch(html, /\.insights-panel > :not\(\.insights-header\)/);
  });
});

// Real app functions, run against a fake desk. Built lazily: mainScript is defined further down.
function insightsSandbox(days, { templates = [], holidays = [] } = {}) {
  const names = ['dateFromKey', 'formatDateKey', 'eachDateInRange', 'getPeriodRange', 'isKeyInRange', 'daysBetweenKeys',
    'createdDateKey', 'normalizeTag', 'normalizeTagList', 'quarterMonths', 'recurringDueOn', 'carryCountOf',
    'comparablePeriodRanges', 'computeRecurringFollowThrough', 'computeCarryChains', 'countTasksByTag', 'computeTagTrend'];
  const src = [
    'const CARRY_CHAIN_MIN = 3; const TAG_TREND_MIN_TASKS = 10; const TAG_TREND_NOTABLE = 5;',
    ...names.map(fnSource),
    `return { ${names.join(', ')} };`,
  ].join('\n');
  const state = { data: { days } };
  const deps = {
    state,
    loadRecurringTemplates: () => templates,
    checkHoliday: (k) => ({ isHoliday: holidays.includes(k) }),
    plainTextPreview: (h) => String(h || '').replace(/<[^>]+>/g, '').trim(),
  };
  return new Function(...Object.keys(deps), src)(...Object.values(deps));
}

function deskDays(entries) {
  const days = {};
  for (const [dayKey, item] of entries) (days[dayKey] ||= { date: dayKey, items: [] }).items.push(item);
  return days;
}

let seedId = 0;
const seedTask = (createdKey, extra = {}) => ({
  id: `s${++seedId}`, type: 'task', content: `Task ${seedId}`, completed: false, shelved: false,
  boardColumn: 'active', createdAt: `${createdKey}T15:00:00.000Z`, ...extra,
});

describe('1.23.0 carry stamps', () => {
  const carry = () => new Function(`${['carryCountOf', 'stampCarry', 'clearCarryStamps', 'mergeCarryStamps'].map(fnSource).join('\n')}
    return { carryCountOf, stampCarry, clearCarryStamps, mergeCarryStamps };`)();

  it('each carry adds one, the first carry sets the start, and a pre-1.23.0 carry reads as one', () => {
    const { carryCountOf, stampCarry } = carry();
    const fresh = { id: 'a' };
    assert.equal(carryCountOf(fresh), 0);
    stampCarry(fresh, '2026-10-05');
    assert.deepEqual(fresh, { id: 'a', carryCount: 1, carryStart: '2026-10-05', carriedFrom: '2026-10-05' });
    stampCarry(fresh, '2026-10-06');
    assert.deepEqual(fresh, { id: 'a', carryCount: 2, carryStart: '2026-10-05', carriedFrom: '2026-10-06' });
    const legacy = { id: 'b', carriedFrom: '2026-09-30' };
    assert.equal(carryCountOf(legacy), 1);
    stampCarry(legacy, '2026-10-01');
    assert.deepEqual(legacy, { id: 'b', carryCount: 2, carryStart: '2026-09-30', carriedFrom: '2026-10-01' });
  });

  it('clearing removes all three stamps; merging keeps the longer run and the earlier start', () => {
    const { clearCarryStamps, mergeCarryStamps } = carry();
    const t = { id: 'a', carryCount: 4, carryStart: '2026-10-01', carriedFrom: '2026-10-04', tags: ['x'] };
    clearCarryStamps(t);
    assert.deepEqual(t, { id: 'a', tags: ['x'] });
    const a = { id: 'a', carryCount: 2, carryStart: '2026-10-03', carriedFrom: '2026-10-04' };
    const b = { id: 'a', carryCount: 5, carryStart: '2026-10-01', completed: true };
    assert.deepEqual(mergeCarryStamps(a, b), { ...a, carryCount: 5, carryStart: '2026-10-01' });
    assert.equal(mergeCarryStamps(b, a), b, 'nothing to take: same object back');
    assert.equal(mergeCarryStamps({ id: 'c' }, { id: 'c' }).carryCount, undefined, 'no stamps on either side adds none');
  });

  it('app normalizeItem keeps valid carry stamps through sync and drops bad ones', () => {
    const normalize = new Function('normalizeTagList', `${fnSource('normalizeItem')}\nreturn normalizeItem;`)((t) => (Array.isArray(t) ? t : []));
    const base = { id: 'a', type: 'task', content: 'x', createdAt: '2026-10-01T00:00:00Z', carriedFrom: '2026-10-04' };
    const kept = normalize({ ...base, carryCount: 4, carryStart: '2026-10-01' });
    assert.equal(kept.carryCount, 4);
    assert.equal(kept.carryStart, '2026-10-01');
    const bad = normalize({ ...base, carryCount: 0, carryStart: 'yesterday' });
    assert.equal('carryCount' in bad, false);
    assert.equal('carryStart' in bad, false);
    assert.equal(normalize({ ...base, type: 'note', carryCount: 3 }).carryCount, undefined, 'notes never carry stamps');
  });

  it('carrying stamps; moving, sending, and Bring back clear; every same-task merge keeps the longer run', () => {
    const carrySrc = fnSource('carryForwardUnfinished');
    assert.match(carrySrc, /if \(cloned\.type === 'task'\) stampCarry\(cloned, sourceDateKey\);/);
    assert.match(carrySrc, /if \(cloned\.type === 'task'\) stampCarry\(cloned, sourceDate\);/);
    assert.doesNotMatch(carrySrc, /cloned\.carriedFrom =/);
    assert.match(fnSource('moveItem'), /if \(item\.type === 'task'\) clearCarryStamps\(item\);/);
    assert.match(fnSource('sendItemToOtherContext'), /if \(item\.type === 'task'\) clearCarryStamps\(item\);/);
    assert.match(fnSource('bringBackShelvedTask'), /clearCarryStamps\(item\);/);
    assert.equal((mainScript.match(/merged = mergeCarryStamps\(merged, (loser|other)\);/g) || []).length, 3);
  });
});

describe('1.23.0 Recurring Follow-through', () => {
  const weekdays = { id: 'r1', content: '<b>Update</b> the dashboard', rule: 'weekdays', createdAt: '2026-09-01T12:00:00.000Z' };
  const fridays = { id: 'r2', content: 'Status email', rule: 'weekly', days: [5], createdAt: '2026-09-01T12:00:00.000Z' };
  const oct = { startKey: '2026-10-01', endKey: '2026-10-31' };

  it('counts due days the desk was used, matches copies by the day they were created, and sorts lowest first', () => {
    // Oct 5–9 is Mon–Fri. The desk was used every weekday; the 8th's copy was deleted, the 9th's is still open.
    const entries = [];
    for (const d of ['05', '06', '07', '08', '09']) entries.push([`2026-10-${d}`, seedTask(`2026-10-${d}`, { completed: true })]);
    for (const d of ['05', '06', '07']) entries.push([`2026-10-${d}`, seedTask(`2026-10-${d}`, { recurringTemplateId: 'r1', completed: true })]);
    entries.push(['2026-10-12', seedTask('2026-10-09', { recurringTemplateId: 'r1', carriedFrom: '2026-10-09' })]);
    entries.push(['2026-10-12', seedTask('2026-10-12')]);
    entries.push(['2026-10-09', seedTask('2026-10-09', { recurringTemplateId: 'r2', shelved: true })]);
    const sb = insightsSandbox(deskDays(entries), { templates: [weekdays, fridays] });
    const rows = sb.computeRecurringFollowThrough(oct, '2026-10-12');
    assert.deepEqual(rows.map((r) => [r.id, r.name, r.total, r.done, r.open, r.missed, r.rate, r.rarely]), [
      ['r2', 'Status email', 1, 0, 0, 1, 0, false],
      ['r1', 'Update the dashboard', 6, 3, 1, 2, 50, false],
    ]);
  });

  it('days away, days before the template existed, and skipped holidays are not chances', () => {
    const entries = [['2026-10-05', seedTask('2026-10-05', { recurringTemplateId: 'r1', completed: true })],
      ['2026-10-06', seedTask('2026-10-06')], ['2026-10-07', seedTask('2026-10-07')]];
    const late = { ...weekdays, createdAt: '2026-10-06T12:00:00.000Z', skipHolidays: true };
    const sb = insightsSandbox(deskDays(entries), { templates: [late], holidays: ['2026-10-07'] });
    // Before the 6th doesn't count, the 7th is a holiday, the 8th–9th the desk wasn't used: only the 6th, plus the 5th's copy itself
    const [row] = sb.computeRecurringFollowThrough(oct, '2026-10-09');
    assert.deepEqual([row.total, row.done, row.missed], [2, 1, 1]);
  });

  it('Rarely done needs 3+ chances under 50%; a template with no chances in the period has no row; future days never count', () => {
    const entries = [];
    for (const d of ['02', '09', '16']) entries.push([`2026-10-${d}`, seedTask(`2026-10-${d}`)]);
    entries.push(['2026-10-02', seedTask('2026-10-02', { recurringTemplateId: 'r2', completed: true })]);
    const sb = insightsSandbox(deskDays(entries), { templates: [fridays, { id: 'm', content: 'Monthly', rule: 'monthly', monthDays: [28] }] });
    const [row, ...rest] = sb.computeRecurringFollowThrough(oct, '2026-10-20');
    assert.deepEqual([row.id, row.total, row.done, row.rarely], ['r2', 3, 1, true]);
    assert.equal(rest.length, 0, 'the 28th is after today, so the monthly template has no chance yet');
    const week = sb.computeRecurringFollowThrough({ startKey: '2026-10-12', endKey: '2026-10-18' }, '2026-10-20');
    assert.deepEqual(week.map((r) => [r.total, r.rarely]), [[1, false]], 'one missed Friday is not flagged');
  });
});

describe('1.23.0 Carry Chains', () => {
  it('lists runs of 3+ carries overlapping the period, oldest first, with open count and average', () => {
    const days = deskDays([
      ['2026-10-27', seedTask('2026-10-05', { id: 'long', carryCount: 8, carryStart: '2026-10-05', carriedFrom: '2026-10-26' })],
      ['2026-10-21', seedTask('2026-10-12', { id: 'done', carryCount: 5, carryStart: '2026-10-12', carriedFrom: '2026-10-20', completed: true })],
      ['2026-10-27', seedTask('2026-10-22', { id: 'short', carryCount: 2, carryStart: '2026-10-24', carriedFrom: '2026-10-26' })],
      ['2026-09-20', seedTask('2026-09-01', { id: 'sept', carryCount: 4, carryStart: '2026-09-01', carriedFrom: '2026-09-19', shelved: true })],
      ['2026-10-27', seedTask('2026-10-26', { id: 'legacy', carriedFrom: '2026-10-26' })],
    ]);
    const sb = insightsSandbox(days);
    const oct = sb.computeCarryChains({ startKey: '2026-10-01', endKey: '2026-10-31' });
    assert.deepEqual(oct.chains.map((c) => [c.item.id, c.count, c.start, c.status]), [
      ['long', 8, '2026-10-05', 'open'], ['done', 5, '2026-10-12', 'done'],
    ]);
    assert.equal(oct.open, 1);
    assert.equal(oct.average, 6.5);
    const week = sb.computeCarryChains({ startKey: '2026-10-26', endKey: '2026-11-01' });
    assert.deepEqual(week.chains.map((c) => c.item.id), ['long'], 'the done run ended on the 20th');
    const sept = sb.computeCarryChains({ startKey: '2026-09-01', endKey: '2026-09-30' });
    assert.deepEqual(sept.chains.map((c) => [c.item.id, c.status]), [['sept', 'shelved']]);
    assert.deepEqual(sb.computeCarryChains({ startKey: '2026-08-01', endKey: '2026-08-31' }), { chains: [], open: 0, average: 0 });
  });
});

describe('1.23.0 Tag Trend', () => {
  const fill = (entries, dayKey, tags) => { for (const t of tags) entries.push([dayKey, seedTask(dayKey, t ? { tags: [t] } : {})]); };

  it('compares shares with the previous month up to the same day, flags 5+ point moves, and names the biggest shift', () => {
    const entries = [];
    fill(entries, '2026-09-03', ['ids', 'ids', 'ids', 'ids', 'ids', 'ace', 'ace', 'ace', 'dco', 'dco']);
    fill(entries, '2026-09-20', ['ids', 'ids', 'ids', 'ids', 'ids', 'ids', 'ids', 'ids', 'ids', 'ids']);
    fill(entries, '2026-10-02', ['ace', 'ace', 'ace', 'ace', 'ace', 'ace', 'ids', 'ids', 'dco', null]);
    const t = insightsSandbox(deskDays(entries)).computeTagTrend('month', '2026-10-10', '2026-10-10');
    assert.equal(t.mode, 'compare');
    assert.deepEqual(t.ranges.previous, { startKey: '2026-09-01', endKey: '2026-09-10' }, 'Sep 20 is past this point last month');
    assert.deepEqual(t.rows.map((r) => [r.tag, r.now, r.was, r.delta]), [
      ['ace', 60, 30, 30], ['ids', 20, 50, -30], ['dco', 10, 20, -10],
    ]);
    assert.deepEqual([t.untagged.now, t.untagged.was], [10, 0]);
    assert.deepEqual([t.rise.tag, t.drop.tag], ['ace', 'ids']);
  });

  it('under 10 tasks on either side is too few; a previous period with none says so; no tasks now means no card', () => {
    const entries = [];
    fill(entries, '2026-10-06', ['ace', 'ace', 'ace']);
    fill(entries, '2026-10-13', ['ace', 'dco', 'dco', 'dco', 'dco', 'dco', 'dco', 'dco', 'dco', 'dco', 'dco']);
    const sb = insightsSandbox(deskDays(entries));
    const week = sb.computeTagTrend('week', '2026-10-14', '2026-10-18');
    assert.equal(week.mode, 'too-few');
    assert.deepEqual(week.ranges.previous, { startKey: '2026-10-05', endKey: '2026-10-11' });
    assert.equal(week.rise, null);
    assert.deepEqual(week.rows.map((r) => r.tag), ['dco', 'ace'], 'only tags present now are listed');
    assert.equal(sb.computeTagTrend('year', '2026-10-14', '2026-10-18').mode, 'no-previous');
    assert.equal(sb.computeTagTrend('week', '2026-10-21', '2026-10-21'), null);
  });

  it('comparablePeriodRanges steps back a week, month, or year and trims to the same point only while in progress', () => {
    const sb = insightsSandbox({});
    assert.deepEqual(sb.comparablePeriodRanges('week', '2026-10-14', '2026-10-14'), {
      current: { startKey: '2026-10-12', endKey: '2026-10-14' }, previous: { startKey: '2026-10-05', endKey: '2026-10-07' }, toDate: true,
    });
    assert.deepEqual(sb.comparablePeriodRanges('month', '2026-09-14', '2026-10-14').previous, { startKey: '2026-08-01', endKey: '2026-08-31' });
    assert.deepEqual(sb.comparablePeriodRanges('year', '2026-03-01', '2026-03-01').previous, { startKey: '2025-01-01', endKey: '2025-03-01' });
  });
});

describe('1.23.0 Insights cards wiring', () => {
  it('Shelve and Open Recurring tasks are handled by the panel click delegate', () => {
    const src = fnSource('renderInsights');
    assert.match(src, /el\.dataset\.shelveItem\) \{\s*moveTaskToColumn\(el\.dataset\.shelveItem, 'shelved'\);/);
    assert.match(src, /el\.dataset\.openRecurring !== undefined\) \{\s*openRecurringModal\(\);/);
    assert.match(src, /\[data-shelve-item\], \[data-open-recurring\]/);
  });
});

describe('1.23.0 edit stamps: the newer copy wins a sync', () => {
  const { stampEditedItems, itemEditPrints, newerEdit } = appFns(['stampEditedItems', 'itemEditPrints', 'newerEdit'], { stripHtmlTags: stripTags });
  const T0 = '2026-10-28T13:00:00.000Z';
  const T1 = '2026-10-28T13:10:00.000Z';
  const NOW = '2026-10-28T14:00:00.000Z';
  const desk = (...items) => ({ days: { '2026-10-28': { date: '2026-10-28', items } }, deletedIds: {} });
  const only = (data) => Object.values(data.days).flatMap(d => d.items);

  it('saving stamps only the tasks that really changed', () => {
    const before = desk(task({ id: 'a', updatedAt: T0 }), task({ id: 'b', boardColumn: 'new', updatedAt: T0 }));
    const after = structuredClone(before);
    after.days['2026-10-28'].items[1].boardColumn = 'active';
    after.days['2026-10-28'].items.push(task({ id: 'c' }));
    stampEditedItems(itemEditPrints(before), after, NOW);
    assert.deepEqual(only(after).map(i => i.updatedAt), [T0, NOW, NOW]);
  });

  it('carrying forward, key order, and filled-in defaults are not edits', () => {
    const before = desk({ id: 'a', type: 'task', content: 'X', createdAt: T0, comments: [] });
    const after = desk({ boardColumn: 'active', shelved: false, completed: false, createdAt: T0, content: 'X', type: 'task', id: 'a',
      carriedFrom: '2026-10-27', carryCount: 2, carryStart: '2026-10-26' });
    stampEditedItems(itemEditPrints(before), after, NOW);
    assert.equal(only(after)[0].updatedAt, undefined);
  });

  it('with nothing to compare against (unreadable storage) nothing is stamped', () => {
    const data = desk(task({ id: 'a' }));
    stampEditedItems(null, data, NOW);
    assert.equal(only(data)[0].updatedAt, undefined);
  });

  it('newerEdit: later wins, stamped beats unstamped, equal or both missing is a tie', () => {
    assert.equal(newerEdit({ updatedAt: T0 }, { updatedAt: T1 }), 1);
    assert.equal(newerEdit({ updatedAt: T1 }, { updatedAt: T0 }), -1);
    assert.equal(newerEdit({}, { updatedAt: T0 }), 1);
    assert.equal(newerEdit({ updatedAt: T0 }, { updatedAt: T0 }), 0);
    assert.equal(newerEdit({}, {}), 0);
  });

  it('sync: the cloud copy moved to Active beats this device\'s older New copy (the reported bug)', () => {
    const local = desk(task({ id: 'a', boardColumn: 'new', updatedAt: T0 }));
    const remote = desk(task({ id: 'a', boardColumn: 'active', updatedAt: T1 }));
    assert.equal(only(mergeDaysData(local, remote))[0].boardColumn, 'active');
    assert.equal(only(mergeDaysData(remote, local))[0].boardColumn, 'active', 'same answer on either device');
  });

  it('sync: a newer reopen beats an older completed copy, and comments and tags from both survive', () => {
    const local = desk(task({ id: 'a', completed: true, updatedAt: T0, tags: ['ace'], comments: [{ id: 'c1', content: 'x', createdAt: T0 }] }));
    const remote = desk(task({ id: 'a', completed: false, updatedAt: T1, tags: ['ids'] }));
    const [item] = only(mergeDaysData(local, remote));
    assert.equal(item.completed, false);
    assert.equal(item.updatedAt, T1);
    assert.deepEqual([...item.tags].sort(), ['ace', 'ids']);
    assert.equal(item.comments.length, 1);
  });

  it('sync: copies from before 1.23.0 keep the old rules (completed beats open; a tie keeps this device\'s copy)', () => {
    assert.equal(only(mergeDaysData(desk(task({ id: 'a' })), desk(task({ id: 'a', completed: true }))))[0].completed, true);
    assert.equal(only(mergeDaysData(desk(task({ id: 'a', boardColumn: 'new' })), desk(task({ id: 'a' }))))[0].boardColumn, 'new');
  });

  it('sync: a newer copy on another day takes that day', () => {
    const local = desk(task({ id: 'a', updatedAt: T0 }));
    const remote = { days: { '2026-10-20': { date: '2026-10-20', items: [task({ id: 'a', content: 'Moved back', updatedAt: T1 })] } }, deletedIds: {} };
    const merged = mergeDaysData(local, remote);
    assert.deepEqual(Object.keys(merged.days), ['2026-10-20']);
  });

  it('Import All (merge) uses the same rule', () => {
    const merged = deskSandbox().mergeImportInto(desk(task({ id: 'a', boardColumn: 'new', updatedAt: T0 })), desk(task({ id: 'a', boardColumn: 'active', updatedAt: T1 })));
    assert.equal(only(merged)[0].boardColumn, 'active');
  });

  it('moving a task to another day stamps it; normalizeItem keeps the stamp and drops junk', () => {
    const sandbox = deskSandbox({ days: { '2026-08-12': { date: '2026-08-12', items: [task({ id: 'x', updatedAt: T0 })] } } });
    sandbox.moveItem('x', '2026-08-14');
    assert.ok(sandbox.state.data.days['2026-08-14'].items[0].updatedAt > T0);
    assert.equal(normalizeItem(task({ id: 'a', updatedAt: T1 })).updatedAt, T1);
    assert.equal('updatedAt' in normalizeItem(task({ id: 'a', updatedAt: 'soon' })), false);
  });

  it('saveData stamps against the stored copy before writing; a desk merge import writes first so nothing is stamped', () => {
    const save = fnSource('saveData');
    assert.match(save, /stampEditedItems\(editPrintsOfStored\(key, readStorage\(key\)\), state\.data\);\s*const raw = JSON\.stringify\(state\.data\);\s*writeStorage\(key, raw\);/);
    assert.match(mainScript, /state\.data = mergeImportData\(state\.pendingImport\);\s*\/\/[^\n]*\n\s*writeStorage\(getStorageKey\(\), JSON\.stringify\(state\.data\)\);/);
    assert.equal((mainScript.match(/const edit = newerEdit\(a, b\);/g) || []).length, 2, 'sync and import item merges');
    assert.equal((mainScript.match(/const edit = newerEdit\(a\.item, b\.item\);/g) || []).length, 2, 'sync and import placements');
  });
});

describe('1.23.0 phone and add-box fixes', () => {
  const css = () => html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

  it('the column add box is cleared before the redraw that would restore it as a draft', () => {
    const src = fnSource('renderBoardColumn');
    assert.match(src, /if \(val\) \{[\s\S]{0,160}input\.value = '';\s*addItem\(val,/);
    assert.match(fnSource('captureCommentDraft'), /draft\.inline = \{ column: state\.addingInColumn, value: input\.value \}/,
      'drafts still keep typed text across other redraws');
  });

  it('1.23.1: touch screens leave the search scope chip absolute, so the search box keeps its full width', () => {
    assert.match(css(), /\.search-scope-chip \{\s*position: absolute;/);
    const touchPosition = css().match(/\.tag-chip-remove, \.card-overflow-btn[^{]*\{ position: relative; \}/);
    assert.ok(touchPosition, 'touch hit-area position rule');
    assert.doesNotMatch(touchPosition[0], /search-scope-chip/);
  });

  it('project note actions wrap and labels never break', () => {
    assert.match(css(), /\.project-item-meta \{[^}]*flex-wrap: wrap;/);
    assert.match(css(), /\.project-item-actions \{[^}]*flex-wrap: wrap;/);
    assert.match(css(), /\.project-item-actions button \{[^}]*white-space: nowrap;/);
    assert.match(css(), /\.project-item-meta > span \{ white-space: nowrap; \}/);
  });

  it('phones stack the desk tabs under the view tabs; the 768px row layout stays for tablets', () => {
    const phone = css().match(/\/\* Phones: views on top[^*]*\*\/\s*@media \(max-width: 600px\) \{([\s\S]*?)\n      \}/);
    assert.ok(phone, 'nested 600px block inside the 768px layout');
    assert.match(phone[1], /\.sidebar-tabs \{ flex-direction: column; \}/);
    assert.match(phone[1], /\.context-tabs \{[^}]*border-left: none !important;[^}]*border-top: 1px solid var\(--sidebar-border\) !important;/);
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

describe('auto-collapse of the Completed column', () => {
  it('collapses only when on and the count reaches the normalized threshold', () => {
    assert.match(mainScript, /const collapseAt = normalizeAutoCollapseAt\(state\.autoCollapseCompletedAt\);[\s\S]{0,80}const shouldAutoCollapse = state\.autoCollapseCompleted && completed\.length >= collapseAt;/);
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
  it('Import All (merge) unions tags from both copies', () => {
    const day = (tags, extra = {}) => ({ days: { '2026-08-18': { date: '2026-08-18', items: [task({ id: 't1', tags, ...extra })] } }, deletedIds: {} });
    const merged = deskSandbox().mergeImportInto(day(['ace']), day(['vendor'], { completed: true }));
    const item = merged.days['2026-08-18'].items[0];
    assert.equal(item.completed, true);
    assert.deepEqual([...item.tags].sort(), ['ace', 'vendor']);
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

  it('a cross-day sync merge unions tags alongside comments', () => {
    const merged = mergeDaysData(
      { days: { '2026-08-17': { date: '2026-08-17', items: [task({ id: 't1', tags: ['ace'], comments: [{ id: 'c1', content: 'a', createdAt: 'x' }] })] } } },
      { days: { '2026-08-18': { date: '2026-08-18', items: [task({ id: 't1', completed: true, tags: ['vendor'] })] } } },
    );
    const [item] = Object.values(merged.days).flatMap(d => d.items);
    assert.deepEqual([...item.tags].sort(), ['ace', 'vendor']);
    assert.equal(item.comments.length, 1);
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

describe('recurring due dates and holidays', () => {
  it('weekdays template is normally due on a weekday', () => {
    const t = { id: 't1', content: 'x', rule: 'weekdays', lastInjectedDate: null };
    assert.equal(recurringDueOn(t, '2026-08-12'), true); // Wednesday
    assert.equal(recurringDueOn(t, '2026-08-15'), false); // Saturday
  });

  it('recurringDueOn is schedule only; isDueToday adds the holiday skip', () => {
    const t = { id: 't1', content: 'x', rule: 'daily', lastInjectedDate: null, skipHolidays: true };
    assert.equal(recurringDueOn(t, '2026-01-01'), true);
    assert.equal(deskSandbox({ today: '2026-01-01' }).isDueToday(t), false, 'New Year\'s Day is skipped');
    assert.equal(deskSandbox({ today: '2026-01-01' }).isDueToday({ ...t, skipHolidays: false }), true);
    assert.equal(deskSandbox({ today: '2026-01-02' }).isDueToday(t), true);
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
  it('all 36 medium themes have CSS [data-theme] rules with color-scheme: dark', () => {
    const mediumIds = [
      'fog','overcast','steel','fjord','nimbus','pewter','horizon','denim',
      'lichen','fern','tundra','moss','basalt','dot-matrix',
      'driftwood','clay','sandstone','umber','terracotta','flint',
      'twilight','haze','plum-mid','mulberry','merlot',
      'ash','graphite','concrete',
      'unit-zero-mid','unit-one-mid','unit-two-mid','unit-eight-mid',
      'catppuccin-frappe','gruvbox-mid','solarized-mid','rosewood',
    ];
    assert.equal(mediumIds.length, 36);
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

  it('1.22.0 layout: a quick-add bar on top, then one row per template with schedule, next due, and a ⋮ menu', () => {
    const panel = html.match(/function renderRecurringPanel\(\)\s*\{[\s\S]*?\n    \}/)[0];
    assert.match(panel, /quickRow\.append\(editorWrap, schedulePicker\.ruleSelect, addBtn\);/);
    assert.match(panel, /form\.append\(quickRow, schedulePicker\.options, skip\.label\);/);
    assert.match(panel, /toolbar\.remove\(\);/, 'no B / I / U toolbar');
    assert.match(panel, /buildRecurringRow\(t, today,/);
    assert.match(panel, /note\.textContent = '\* skips holidays';/);
    const row = html.match(/function buildRecurringRow\([\s\S]*?\n    \}/)[0];
    assert.match(row, /item\.append\(main, schedule, next, moreWrap\);/);
    assert.match(row, /recurring-rule-badge/);
    assert.match(row, /recurringNextDue\(t, today\)/);
    for (const label of ["'Edit'", "'Add tag'", "'Delete'"]) assert.ok(row.includes(`addMenuItem(${label}`), label);
    assert.match(row, /openRecurringTagEntry\(main, t\)/);
    assert.doesNotMatch(html, /prompt\('Add tag/, 'tags use the tag picker, not a browser prompt');
    assert.match(html, /\.recurring-template-item \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 10rem\) 6\.5rem 28px;/);
  });

  it('the schedule picker is a Repeats dropdown, not a row of buttons', () => {
    const picker = fnSource('createRecurringSchedulePicker');
    assert.match(picker, /ruleSelect\.className = 'recurring-rule-select';/);
    assert.match(picker, /RECURRING_RULES\.forEach\(r => ruleSelect\.appendChild\(new Option\(r\.label, r\.value\)\)\);/);
    assert.match(picker, /return \{ el, ruleSelect, options, read \};/);
    assert.doesNotMatch(html, /recurring-rule-btns/);
  });

  it('add and edit forms share the rule picker (daily/weekdays/weekly/custom and the 1.21.0 rules)', () => {
    const fnBody = html.match(/function openRecurringEditForm[\s\S]*?hostEl\.appendChild\(editActions\)/);
    assert.ok(fnBody, 'openRecurringEditForm extractable');
    assert.match(fnBody[0], /createRecurringSchedulePicker\(template\)/);
    assert.match(html, /function renderRecurringPanel\(\)[\s\S]*?createRecurringSchedulePicker\(\)/);
    const rules = html.match(/const RECURRING_RULES = \[[\s\S]*?\];/)[0];
    for (const r of ['daily', 'weekdays', 'weekly', 'custom', 'biweekly', 'monthly', 'quarterly']) assert.match(rules, new RegExp(`value: '${r}'`));
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
  const m = mainScript.match(new RegExp(`function ${name}\\((?:[^()]|\\([^()]*\\))*\\)\\s*\\{[\\s\\S]*?\\n    \\}`));
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

});

describe('v1.8.0 themes (HTML invariants)', () => {
  const themesSrc = html.match(/const THEMES = (\[[\s\S]*?\n    \]);/)[1];
  const themes = new Function(`return ${themesSrc}`)();
  const byId = Object.fromEntries(themes.map((t) => [t.id, t]));
  const NEW_LIGHT = ['retro', 'seafoam', 'mediterranean', 'citrus'];
  const NEW_MEDIUM = ['dot-matrix', 'denim', 'terracotta', 'merlot'];
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
    for (const id of ['dot-matrix', 'phosphor', 'denim', 'terracotta', 'merlot', 'rose-pine']) {
      assert.match(html, new RegExp(`\\[data-theme="${id}"\\] \\.add-btn`), `${id} add-btn text override missing`);
    }
  });

});

describe('v1.14.0 Unit themes and Dot Matrix rename (HTML invariants)', () => {
  const themesSrc = html.match(/const THEMES = (\[[\s\S]*?\n    \]);/)[1];
  const themes = new Function(`return ${themesSrc}`)();
  const byId = Object.fromEntries(themes.map((t) => [t.id, t]));
  const UNITS = { zero: 'Unit Zero', one: 'Unit One', two: 'Unit Two', eight: 'Unit Eight' };
  const cssBlock = (id) => [...html.matchAll(new RegExp(`\\[data-theme="${id}"\\] \\{([^}]*)\\}`, 'g'))]
    .find((m) => /--accent:/.test(m[1]));

  it('each unit exists in light, medium, and dark under the same display name', () => {
    for (const [unit, name] of Object.entries(UNITS)) {
      const light = byId[`unit-${unit}-light`];
      const mid = byId[`unit-${unit}-mid`];
      const dark = byId[`unit-${unit}`];
      assert.ok(light && !light.dark && !light.medium, `unit-${unit}-light should be light`);
      assert.ok(mid && mid.medium === true && mid.dark === false, `unit-${unit}-mid should be medium`);
      assert.ok(dark && dark.dark === true, `unit-${unit} should be dark`);
      for (const t of [light, mid, dark]) assert.equal(t.name, name);
    }
  });

  it('every unit theme has a full CSS block, matching swatch accent, favicon, and the right color-scheme', () => {
    const favicons = html.match(/const FAVICONS = \{[\s\S]*?\n\s*\};/)[0];
    const shared = html.match(/Shared semantics for all non-default dark themes[\s\S]*?\{/)[0];
    for (const unit of Object.keys(UNITS)) {
      for (const id of [`unit-${unit}-light`, `unit-${unit}-mid`, `unit-${unit}`]) {
        const block = cssBlock(id);
        assert.ok(block, `CSS block for ${id} missing`);
        for (const v of ['--bg', '--surface', '--sidebar', '--accent', '--text', '--border']) {
          assert.match(block[1], new RegExp(`${v}:\\s*#`), `${id} missing ${v}`);
        }
        const accent = block[1].match(/--accent:\s*(#[0-9a-fA-F]{6})/)[1];
        assert.equal(accent.toLowerCase(), byId[id].accent.toLowerCase(), `${id} swatch accent drifted from CSS`);
        assert.ok(favicons.includes(`'${id}':`), `${id} missing from FAVICONS`);
      }
      assert.match(cssBlock(`unit-${unit}-light`)[1], /color-scheme:\s*light/);
      assert.match(cssBlock(`unit-${unit}-mid`)[1], /color-scheme:\s*dark/);
      assert.ok(shared.includes(`[data-theme="unit-${unit}"]`), `unit-${unit} not in shared dark list`);
    }
  });

  it('each unit draws its header stripe in every tier', () => {
    assert.match(html, /\[data-theme\^="unit-"\] \.desk-sticky \{[^}]*background-size: 100% 4px/);
    for (const unit of Object.keys(UNITS)) {
      assert.match(html, new RegExp(`\\[data-theme\\^="unit-${unit}"\\] \\.desk-sticky \\{ background-image: linear-gradient`));
    }
  });

  it('bright-accent unit themes use dark text on primary buttons', () => {
    for (const id of ['unit-zero-mid', 'unit-zero', 'unit-one-mid', 'unit-one', 'unit-two-mid', 'unit-eight-mid', 'unit-eight']) {
      assert.match(html, new RegExp(`\\[data-theme="${id}"\\] \\.add-btn`), `${id} add-btn text override missing`);
    }
  });

  it('no Game Boy name or gameboy id remains, except the rename map', () => {
    assert.doesNotMatch(html, /Game Boy/);
    assert.equal(byId.gameboy, undefined);
    assert.equal(byId['dot-matrix'].name, 'Dot Matrix');
    const mentions = html.match(/gameboy/g) || [];
    assert.equal(mentions.length, 1, 'only RENAMED_THEME_IDS should mention gameboy');
    assert.match(html, /const RENAMED_THEME_IDS = \{ gameboy: 'dot-matrix' \};/);
  });

  it('a saved gameboy theme is migrated before first paint and synced prefs are mapped', () => {
    const boot = html.match(/const RENAMED_THEME_IDS[\s\S]*?setFavicon\(themeId\);/)[0];
    assert.match(boot, /localStorage\.setItem\('work-desk-theme', stored\)/);
    assert.match(boot, /window\.__RENAMED_THEME_IDS = RENAMED_THEME_IDS/);
    assert.match(html, /const prefTheme = typeof prefs\.theme === 'string' \? \(window\.__RENAMED_THEME_IDS\?\.\[prefs\.theme\] \?\? prefs\.theme\) : null;/);
  });

});

// ═══════════════════════════════════════════════════════════════════════
// v1.15.0 Insights additions (functional + invariants)
// ═══════════════════════════════════════════════════════════════════════
describe('v1.15.0 Insights additions', () => {
  function fns(days = {}, extra = {}) {
    return new Function('days', 'extra', `
      const state = { data: { days, deletedIds: {} }, selectedDate: null, highlightItemId: null };
      const calls = { saved: 0, toasts: [], renders: 0 };
      const todayKey = () => extra.today || '2026-10-06';
      const saveData = () => { calls.saved++; };
      const showToast = (m) => { calls.toasts.push(m); };
      const render = () => { calls.renders++; };
      ${fnSource('dateFromKey')}
      ${fnSource('formatDateKey')}
      ${fnSource('eachDateInRange')}
      ${fnSource('getPeriodRange')}
      ${fnSource('createdDateKey')}
      ${fnSource('sortNewColumnTasks')}
      ${fnSource('getTaskBuckets')}
      ${fnSource('analyzeDayItems')}
      ${fnSource('normalizeTag')}
      ${fnSource('normalizeTagList')}
      ${fnSource('daysBetweenKeys')}
      ${fnSource('isKeyInRange')}
      ${fnSource('summarizeRange')}
      ${fnSource('comparablePeriodRanges')}
      ${fnSource('computePeriodComparison')}
      ${fnSource('computeTagBreakdown')}
      ${fnSource('findLingeringTasks')}
      ${fnSource('findShelvedTasks')}
      ${fnSource('findItem')}
      ${fnSource('clearItemDeleted')}
      ${fnSource('clearCarryStamps')}
      ${fnSource('bringBackShelvedTask')}
      return { state, calls, summarizeRange, computePeriodComparison, computeTagBreakdown, findLingeringTasks, findShelvedTasks, bringBackShelvedTask, daysBetweenKeys };
    `)(days, extra);
  }
  const at = (k) => `${k}T09:00:00Z`;

  it('summarizeRange totals tasks and returns a null rate for an empty range', () => {
    const { summarizeRange } = fns({
      '2026-10-01': { items: [task({ id: 'a', completed: true }), task({ id: 'b', shelved: true }), task({ id: 'c', carriedFrom: '2026-09-30' })] },
    });
    const r = summarizeRange('2026-10-01', '2026-10-31');
    assert.deepEqual(r.totals, { activeDays: 1, tasks: 3, completed: 1, shelved: 1, unfinished: 1, carriedOver: 1 });
    assert.equal(r.completionRate, 33);
    assert.equal(summarizeRange('2026-11-01', '2026-11-30').completionRate, null);
  });

  it('an in-progress month is compared with the same number of days at the start of last month', () => {
    const { computePeriodComparison } = fns({
      '2026-09-03': { items: [task({ id: 'early', completed: true })] },
      '2026-09-20': { items: [task({ id: 'late', completed: true }), task({ id: 'late2', completed: true })] },
      '2026-10-02': { items: [task({ id: 'now', completed: true }), task({ id: 'open', carriedFrom: '2026-10-01' })] },
    });
    const c = computePeriodComparison('month', '2026-10-06', '2026-10-06');
    assert.equal(c.toDate, true);
    assert.deepEqual(c.previousRange, { startKey: '2026-09-01', endKey: '2026-09-06' });
    assert.equal(c.current.completed, 1);
    assert.equal(c.previous.completed, 1, 'Sep 20 is past "this point" last month');
    assert.equal(c.change.completed, 0);
    assert.equal(c.change.carriedOver, 1);
    assert.equal(c.currentRate, 50);
    assert.equal(c.previousRate, 100);
  });

  it('a finished month compares in full, and a long month clamps to a short previous month', () => {
    const days = {
      '2026-09-20': { items: [task({ id: 'sep', completed: true })] },
      '2026-08-31': { items: [task({ id: 'aug', completed: true })] },
    };
    const full = fns(days).computePeriodComparison('month', '2026-09-15', '2026-10-06');
    assert.equal(full.toDate, false);
    assert.deepEqual(full.previousRange, { startKey: '2026-08-01', endKey: '2026-08-31' });
    assert.equal(full.change.completed, 0);
    const clamp = fns({}).computePeriodComparison('month', '2026-03-31', '2026-03-31');
    assert.deepEqual(clamp.previousRange, { startKey: '2026-02-01', endKey: '2026-02-28' });
  });

  it('year-over-year to date stops last year at the same day', () => {
    const { computePeriodComparison } = fns({
      '2025-02-01': { items: [task({ id: 'a', completed: true })] },
      '2025-11-01': { items: [task({ id: 'b', completed: true })] },
      '2026-03-01': { items: [task({ id: 'c', completed: true }), task({ id: 'd', completed: true })] },
    });
    const c = computePeriodComparison('year', '2026-10-06', '2026-10-06');
    assert.deepEqual(c.previousRange, { startKey: '2025-01-01', endKey: '2025-10-06' });
    assert.equal(c.previous.completed, 1);
    assert.equal(c.change.completed, 1);
  });

  it('computeTagBreakdown counts each tag, splits states, counts multi-tag tasks under each, and sorts by total', () => {
    const { computeTagBreakdown } = fns({
      '2026-10-01': { items: [
        task({ id: '1', completed: true, tags: ['ACE'] }),
        task({ id: '2', tags: ['ace', 'ids'], carriedFrom: '2026-09-30' }),
        task({ id: '3', shelved: true, tags: ['#ids'] }),
        task({ id: '4', tags: [] }),
        { id: 'n', type: 'note', content: 'x', tags: ['ace'] },
      ] },
      '2026-11-01': { items: [task({ id: 'out', tags: ['zzz'] })] },
    });
    const { rows, untagged } = computeTagBreakdown({ startKey: '2026-10-01', endKey: '2026-10-31' });
    assert.deepEqual(rows.map(r => r.tag), ['ace', 'ids']);
    assert.deepEqual(rows[0], { tag: 'ace', total: 2, done: 1, open: 1, shelved: 0, carried: 1 });
    assert.deepEqual(rows[1], { tag: 'ids', total: 2, done: 0, open: 1, shelved: 1, carried: 1 });
    assert.equal(untagged.total, 1);
    assert.equal(computeTagBreakdown({ startKey: '2026-12-01', endKey: '2026-12-31' }).untagged, null);
  });

  it('findLingeringTasks returns the oldest open tasks, skipping done, shelved, today-created, future, and duplicates', () => {
    const { findLingeringTasks } = fns({
      '2026-10-06': { items: [
        task({ id: 'old', createdAt: at('2026-09-01'), carriedFrom: '2026-10-05' }),
        task({ id: 'mid', createdAt: at('2026-09-20') }),
        task({ id: 'fresh', createdAt: at('2026-10-06') }),
        task({ id: 'done', completed: true, createdAt: at('2026-08-01') }),
        task({ id: 'shelf', shelved: true, createdAt: at('2026-08-01') }),
      ] },
      '2026-10-05': { items: [task({ id: 'old', createdAt: at('2026-09-01') })] },
      '2026-10-20': { items: [task({ id: 'future', createdAt: at('2026-08-01') })] },
    });
    const r = findLingeringTasks('2026-10-06', 5);
    assert.deepEqual(r.items.map(x => x.item.id), ['old', 'mid']);
    assert.equal(r.items[0].age, 35);
    assert.equal(r.total, 2);
    assert.equal(findLingeringTasks('2026-10-06', 1).items.length, 1);
  });

  it('findLingeringTasks ages a task by its day when it sits on a day before it was created', () => {
    const { findLingeringTasks } = fns({
      '2026-09-30': { items: [task({ id: 'moved-back', createdAt: at('2026-10-04') })] },
    });
    assert.equal(findLingeringTasks('2026-10-06').items[0].age, 6);
  });

  it('findShelvedTasks lists shelved tasks in range oldest first with an all-time count', () => {
    const { findShelvedTasks } = fns({
      '2026-08-02': { items: [task({ id: 'aug', shelved: true })] },
      '2026-10-05': { items: [task({ id: 'b', shelved: true }), task({ id: 'done-shelf', shelved: true, completed: true })] },
      '2026-10-01': { items: [task({ id: 'a', shelved: true }), task({ id: 'open' })] },
    });
    const r = findShelvedTasks({ startKey: '2026-10-01', endKey: '2026-10-31' });
    assert.deepEqual(r.items.map(x => [x.item.id, x.dayKey]), [['a', '2026-10-01'], ['b', '2026-10-05']]);
    assert.equal(r.allTime, 3);
    assert.equal(r.oldestKey, '2026-08-02');
    assert.equal(findShelvedTasks({ startKey: '2026-11-01', endKey: '2026-11-30' }).items.length, 0);
  });

  it('bringBackShelvedTask moves the same task to today as Active, clears its carry stamp, and empties the old day', () => {
    const { state, calls, bringBackShelvedTask } = fns({
      '2026-09-14': { date: '2026-09-14', items: [task({ id: 's', shelved: true, boardColumn: 'new', carriedFrom: '2026-09-13', tags: ['ace'] })] },
      '2026-10-06': { date: '2026-10-06', items: [task({ id: 'x' })] },
    });
    state.data.deletedIds.s = '2026-10-01T00:00:00Z';
    bringBackShelvedTask('s');
    assert.equal(state.data.days['2026-09-14'], undefined);
    const today = state.data.days['2026-10-06'].items;
    assert.deepEqual(today.map(i => i.id), ['x', 's']);
    const s = today[1];
    assert.equal(s.shelved, false);
    assert.equal(s.boardColumn, 'active');
    assert.equal('carriedFrom' in s, false);
    assert.deepEqual(s.tags, ['ace']);
    assert.equal(state.data.deletedIds.s, undefined);
    assert.equal(calls.saved, 1);
    assert.deepEqual(calls.toasts, ['Task brought back to today']);
  });

  it('bringBackShelvedTask creates today when missing and ignores tasks that are not shelved', () => {
    const { state, calls, bringBackShelvedTask } = fns({
      '2026-09-14': { date: '2026-09-14', items: [task({ id: 's', shelved: true }), task({ id: 'open' })] },
    });
    bringBackShelvedTask('open');
    bringBackShelvedTask('missing');
    assert.equal(calls.saved, 0);
    bringBackShelvedTask('s');
    assert.deepEqual(state.data.days['2026-09-14'].items.map(i => i.id), ['open']);
    assert.deepEqual(state.data.days['2026-10-06'].items.map(i => i.id), ['s']);
  });

  it('chart segments carry the day or month they open', () => {
    const fn = html.match(/function computeInsights[\s\S]*?\n    \}/)[0];
    assert.match(fn, /monthKey: formatDateKey\(monthStart\)/);
    assert.equal((fn.match(/dayKey: s\.dayKey/g) || []).length, 2);
    const bars = html.match(/function renderInsightBars[\s\S]*?\n    \}/)[0];
    assert.match(bars, /row\.dataset\.openDay = seg\.dayKey/);
    assert.match(bars, /row\.dataset\.openMonth = seg\.monthKey/);
    assert.match(bars, /row\.tabIndex = 0/);
  });

  it('table days, both heatmaps, and the current-period button carry their actions', () => {
    const table = html.match(/function renderInsightsTable[\s\S]*?\n    \}/)[0];
    assert.match(table, /class="insight-day-link" data-open-day="\$\{row\.dayKey\}"/);
    const heat = html.match(/function renderHeatmap[\s\S]*?\n    \}/)[0];
    assert.match(heat, /if \(inRange\) cell\.dataset\.openDay = key;/);
    const ri = html.match(/function renderInsights\(\)[\s\S]*?\n    \}/)[0];
    assert.match(ri, /cell\.dataset\.openDay = day\.dayKey/);
    assert.match(ri, /if \(!isKeyInRange\(todayKey\(\), range\)\)/);
    assert.match(ri, /currentBtn\.textContent = `This \$\{state\.insightsPeriod\}`/);
    assert.ok(ri.indexOf("panel.addEventListener('click'") < ri.indexOf('if (!hasData)'),
      'actions must be wired before the empty-state return so "This week" works on an empty period');
  });

  it('comparison card runs in every period with the right titles', () => {
    const ri = html.match(/function renderInsights\(\)[\s\S]*?\n    \}/)[0];
    assert.doesNotMatch(ri, /state\.insightsPeriod === 'week' && totals\.activeDays > 0/);
    assert.match(ri, /week: 'Week-over-Week', month: 'Month-over-Month', year: 'Year-over-Year'/);
    assert.match(ri, /computePeriodComparison\(period, state\.insightsAnchor, todayKey\(\)\)/);
  });

  it('Ctrl/Cmd+Enter submits the task add box and both comment add forms', () => {
    const fn = fnSource('bindCtrlEnterSubmit');
    assert.match(fn, /\(e\.ctrlKey \|\| e\.metaKey\) && e\.key === 'Enter'/);
    assert.match(fn, /if \(!submitBtn\.disabled\) form\.requestSubmit\(\)/);
    assert.match(fnSource('initAddEditor'), /bindCtrlEnterSubmit\(editor, els\.addForm, els\.addBtn\)/);
    assert.match(fnSource('restoreAddCommentDraft'), /bindCtrlEnterSubmit\(commentEditor, form, addBtn\)/);
    assert.equal((mainScript.match(/bindCtrlEnterSubmit\(commentEditor, form, addBtn\)/g) || []).length, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// v1.15.1 Options menu polish
// ═══════════════════════════════════════════════════════════════════════
describe('v1.15.1 Options menu polish', () => {
  const pane = (id) => html.match(new RegExp(`<div class="options-pane[^"]*" id="options-pane-${id}">[\\s\\S]*?data-options-reset="${id}"`))[0];
  const defaults = () => new Function(`${mainScript.match(/const OPTIONS_DEFAULTS = \{[\s\S]*?\n    \};/)[0]}; return OPTIONS_DEFAULTS;`)();

  it('every checkbox and select in Appearance and Behavior has a reset default', () => {
    const d = defaults();
    for (const tab of ['appearance', 'behavior']) {
      const body = pane(tab);
      const checkboxes = [...body.matchAll(/<input id="([^"]+)" type="checkbox"/g)].map(m => m[1]);
      const selects = [...body.matchAll(/<select id="([^"]+)"/g)].map(m => m[1]);
      assert.ok(checkboxes.length && selects.length, `${tab} pane parsed`);
      assert.deepEqual(Object.keys(d[tab].toggles).sort(), checkboxes.sort(), `${tab} toggles`);
      assert.deepEqual(Object.keys(d[tab].selects).sort(), selects.sort(), `${tab} selects`);
    }
  });

  it('reset defaults match the first-launch state', () => {
    const { appearance, behavior } = defaults();
    const off = (key) => new RegExp(`localStorage\\.getItem\\(${key}\\) === 'true'`);
    const on = (key) => new RegExp(`localStorage\\.getItem\\(${key}\\) !== 'false'`);
    const t = behavior.toggles;
    assert.equal(t['confirm-delete-toggle'], false); assert.match(mainScript, off('CONFIRM_DELETE_KEY'));
    assert.equal(t['auto-carry-toggle-popout'], false); assert.match(mainScript, off('AUTO_CARRY_FORWARD_KEY'));
    assert.equal(t['keep-comments-open-toggle'], false); assert.match(mainScript, off("'work-desk-keep-comments-open'"));
    assert.equal(t['auto-collapse-completed-toggle'], true); assert.match(mainScript, on("'work-desk-auto-collapse-completed'"));
    assert.equal(t['confetti-toggle'], true); assert.match(mainScript, on('CONFETTI_KEY'));
    assert.equal(t['strike-completed-toggle'], true); assert.match(mainScript, on('STRIKE_COMPLETED_KEY'));
    assert.equal(t['truncate-notes-toggle'], true); assert.match(mainScript, on('TRUNCATE_NOTES_KEY'));
    assert.equal(t['streak-skip-weekends-toggle'], true); assert.match(mainScript, on('STREAK_SKIP_WEEKENDS_KEY'));
    assert.equal(t['us-federal-holidays-toggle'], true); assert.match(mainScript, on('US_FEDERAL_HOLIDAYS_KEY'));
    assert.match(mainScript, /getItem\('work-desk-auto-collapse-completed-at'\) \|\| '5'/);
    assert.equal(behavior.selects['auto-collapse-completed-at'], '5');
    assert.match(mainScript, /localStorage\.getItem\(WEEK_START_KEY\) \|\| 'sunday'/);
    assert.match(mainScript, /localStorage\.getItem\(STARTUP_VIEW_KEY\) \|\| 'last_viewed'/);
    assert.match(mainScript, /localStorage\.getItem\(FONT_SIZE_KEY\) \|\| 'default'/);
    assert.match(mainScript, /localStorage\.getItem\(FONT_FAMILY_KEY\) \|\| 'system'/);
    assert.match(mainScript, /localStorage\.getItem\(SIDEBAR_POSITION_KEY\) \|\| 'left'/);
    assert.match(mainScript, /applyCardGlow\(localStorage\.getItem\(CARD_GLOW_KEY\) === 'true'/);
    assert.match(mainScript, /applyGradientHeader\(localStorage\.getItem\(GRADIENT_HEADER_KEY\) === 'true'/);
    assert.match(fnSource('normalizeTagColorMode'), /: 'theme'/);
    assert.equal(appearance.selects['tag-color-mode-select'], 'theme');
  });

  it('resetOptionsTab drives controls through their change handlers and resets density', () => {
    const fn = fnSource('resetOptionsTab');
    assert.match(fn, /el\.dispatchEvent\(new Event\('change'\)\)/);
    assert.match(fn, /applyDensity\('comfortable'\)/);
    assert.doesNotMatch(fn, /customHolidays|tagColors|THEME_KEY/);
  });

  it('Confirm before delete sits in the Tasks section', () => {
    const body = pane('behavior');
    const tasksAt = body.indexOf('data-options-section="tasks"');
    const confirmAt = body.indexOf('id="confirm-delete-toggle"');
    const projectsAt = body.indexOf('data-options-section="projects"');
    assert.ok(tasksAt > 0 && confirmAt > tasksAt && confirmAt < projectsAt);
  });

  it('splitCustomHolidays and formatHolidayDate', () => {
    const split = new Function(`${fnSource('splitCustomHolidays')}; return splitCustomHolidays;`)();
    const fmt = new Function(`${fnSource('formatHolidayDate')}; return formatHolidayDate;`)();
    const r = split([{ date: '2026-10-06' }, { date: '2026-10-13' }, { date: '2026-10-31' }], '2026-10-13');
    assert.deepEqual(r.past.map(h => h.date), ['2026-10-06']);
    assert.deepEqual(r.upcoming.map(h => h.date), ['2026-10-13', '2026-10-31']);
    assert.equal(fmt('2026-10-31'), 'Sat, Oct 31, 2026');
    assert.equal(fmt('bogus'), 'bogus');
  });

  it('custom holiday labels are set as text, never HTML', () => {
    const fn = fnSource('renderCustomHolidaysList');
    assert.doesNotMatch(fn, /innerHTML\s*=\s*`/);
    assert.match(fn, /labelEl\.textContent = h\.label \|\| '\(no label\)'/);
  });

  it('tag color list caps at 8 rows and hides Reset unless a color is pinned', () => {
    assert.match(mainScript, /const TAG_COLOR_LIST_CAP = 8;/);
    const fn = fnSource('renderTagColorList');
    assert.match(fn, /index >= TAG_COLOR_LIST_CAP \? ' is-overflow' : ''/);
    assert.match(fn, /reset\.textContent = 'Reset'/);
    assert.match(html, /\.tag-color-row-reset:disabled \{ visibility: hidden; \}/);
    assert.doesNotMatch(html, /\.tag-color-list \{[^}]*max-height/);
  });

});

// ═══════════════════════════════════════════════════════════════════════
// v1.16.0 Board lanes: drop below a column
// ═══════════════════════════════════════════════════════════════════════
describe('v1.16.0 board lanes', () => {
  const findBoardLane = new Function(`${fnSource('findBoardLane')}; return findBoardLane;`)();
  const col = (target, left, right, bottom, top = 100) => ({ target, rect: { left, right, top, bottom } });
  const side = [col('new', 40, 300, 1500), col('active', 314, 614, 400), col('completed', 628, 878, 500)];
  const page = { left: 10, right: 910, bottom: 2000 };

  it('below a shorter column maps to that column, all the way down the page', () => {
    assert.equal(findBoardLane(side, page, 400, 900).target, 'active');
    assert.equal(findBoardLane(side, page, 700, 600).target, 'completed');
    assert.equal(findBoardLane(side, page, 314, 401).target, 'active');
    assert.equal(findBoardLane(side, page, 400, 1990).target, 'active', 'far below the tallest column still counts');
  });

  it('the outer margins belong to the first and last columns', () => {
    assert.equal(findBoardLane(side, page, 900, 300).target, 'completed', 'right margin beside Completed');
    assert.equal(findBoardLane(side, page, 900, 1800).target, 'completed');
    assert.equal(findBoardLane(side, page, 20, 300).target, 'new', 'left margin beside New');
  });

  it('over the box itself, in a gutter, above the columns, or outside the page area is not a lane', () => {
    assert.equal(findBoardLane(side, page, 400, 300), null);
    assert.equal(findBoardLane(side, page, 400, 400), null);
    assert.equal(findBoardLane(side, page, 307, 900), null);
    assert.equal(findBoardLane(side, page, 400, 99), null);
    assert.equal(findBoardLane(side, page, 400, 2001), null);
    assert.equal(findBoardLane(side, page, 920, 900), null);
    assert.equal(findBoardLane(side, page, 5, 900), null);
    assert.equal(findBoardLane(side, page, 100, 900), null);
  });

  it('stacked columns (tablet/phone) have no lanes', () => {
    const stacked = [col('new', 0, 600, 400, 100), col('active', 0, 600, 700, 412), col('completed', 0, 600, 900, 712)];
    assert.equal(findBoardLane(stacked, page, 300, 920), null);
    assert.equal(findBoardLane([], page, 300, 920), null);
    assert.equal(findBoardLane(null, page, 300, 920), null);
    assert.equal(findBoardLane(side, null, 400, 900), null);
  });

  it('lanes are desktop-only, task-drag-only, and leave real drop zones alone', () => {
    const at = fnSource('boardLaneAt');
    assert.match(at, /isTouchLikePointer\(\) \|\| state\.activeTab !== 'desk'/);
    assert.match(at, /includes\('text\/task-id'\)/);
    assert.match(at, /closest\?\.\('\[data-drop-target\], \.item-card'\)/);
    const layout = fnSource('boardLaneLayout');
    assert.match(layout, /col\.classList\.contains\('done'\) \? 'completed'/);
    assert.doesNotMatch(mainScript, /BOARD_LANE_BOTTOM_SLACK/);
    assert.match(layout, /const after = board\.nextElementSibling;/, 'lanes stop at the Notes section');
    assert.match(layout, /Math\.min\(mainRect\.bottom, window\.innerHeight,/);
    const init = fnSource('initBoardLanes');
    assert.match(init, /moveTaskToColumn\(taskId, lane\.target\)/);
    assert.match(init, /document\.addEventListener\('dragend', clearBoardLane\)/);
    assert.match(mainScript, /\n    initBoardLanes\(\);\n/);
    assert.match(html, /\.board-lane-ghost \{[^}]*pointer-events: none;/);
    assert.match(html, /\.board-lane-ghost\[hidden\] \{ display: none; \}/);
  });

  it('the Completed lane highlights the Completed section, not Shelved', () => {
    assert.match(fnSource('showBoardLane'), /lane\.col\.querySelector\('\.col-subsection\[data-drop-target="completed"\]'\)/);
  });

  it('sidebar position accepts left, right, top, and bottom; anything else falls back to left', () => {
    const normalize = new Function(`${mainScript.match(/const SIDEBAR_POSITIONS = \[[^\]]*\];/)[0]}; ${fnSource('normalizeSidebarPosition')}; return normalizeSidebarPosition;`)();
    for (const p of ['left', 'right', 'top', 'bottom']) assert.equal(normalize(p), p);
    assert.equal(normalize('middle'), 'left');
    assert.equal(normalize(undefined), 'left');
    const select = html.match(/<select id="sidebar-position-select"[\s\S]*?<\/select>/)[0];
    assert.deepEqual([...select.matchAll(/value="(\w+)"/g)].map(m => m[1]), ['left', 'right', 'top', 'bottom']);
    assert.match(mainScript, /prefs\.sidebarPosition && SIDEBAR_POSITIONS\.includes\(prefs\.sidebarPosition\)/);
  });

  it('top/bottom set data-sidebar-bar and track the bar height on <body>', () => {
    const fn = fnSource('applySidebarPosition');
    assert.match(fn, /if \(next === 'top' \|\| next === 'bottom'\) root\.dataset\.sidebarBar = 'true';/);
    assert.match(fn, /else delete root\.dataset\.sidebarBar;/);
    assert.match(fn, /new ResizeObserver\(syncSidebarBarHeight\)/);
    assert.match(fn, /sidebarEl\.style\.transition = 'none';/, 'switching layouts must not animate the sidebar width');
    assert.match(fnSource('syncSidebarBarHeight'), /document\.body\.style\.setProperty\('--sidebar-bar-h'/);
  });

  it('bar layout CSS only applies above phone width, and wide screens stay on one row', () => {
    const block = html.match(/@media \(min-width: 769px\) \{\s*\[data-sidebar-position="top"\] \.app \{ flex-direction: column; \}[\s\S]*?\n    \}\n/)[0];
    assert.match(block, /\[data-sidebar-position="bottom"\] \.app \{ flex-direction: column-reverse; \}/);
    assert.match(block, /\[data-sidebar-bar\] \.sidebar-collapse-btn \{ display: none; \}/);
    assert.match(block, /\[data-sidebar-bar\] \.date-nav \{ display: none; \}/);
    assert.match(block, /\[data-sidebar-bar\] \.week-strip-row \{ display: flex; \}/);
    assert.match(block, /\[data-sidebar-position="top"\] \.account-menu \{ bottom: auto; top: calc\(100% \+ 6px\); \}/);
    assert.match(block, /\[data-sidebar-position="bottom"\] \.toast \{ bottom: calc\(var\(--sidebar-bar-h, 0px\) \+ 16px\); \}/);
    const wide = html.indexOf('@media (min-width: 1280px) {\n      [data-sidebar-bar] .sidebar,');
    assert.ok(wide > html.indexOf(block), 'one-row rules must come after the bar block to win');
    assert.match(html.slice(wide, wide + 300), /flex-wrap: nowrap;/);
  });

  it('search results open above a bottom bar', () => {
    const fn = fnSource('positionSearchOverlay');
    assert.match(fn, /sidebarPosition === 'bottom' && window\.innerWidth > 768/);
    assert.match(fn, /overlay\.style\.bottom = `\$\{window\.innerHeight - rect\.top \+ 8\}px`/);
  });

});

// ═══════════════════════════════════════════════════════════════════════
// v1.16.1 Patterned backgrounds
// ═══════════════════════════════════════════════════════════════════════
describe('v1.16.1 patterned backgrounds', () => {
  const store = () => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
  };
  const consts = ['BG_PATTERN_ON_KEY', 'BG_PATTERN_KEY', 'BG_PATTERN_STRENGTH_KEY']
    .map(n => mainScript.match(new RegExp(`const ${n} = '[^']+';`))[0]).join('\n');
  const block = mainScript.slice(mainScript.indexOf('    const BG_PATTERNS = ['), mainScript.indexOf('    let bgPatternObserver = null;'));
  const build = (ls) => new Function('localStorage', `${consts}\n${block}\n${fnSource('normalizeBgPattern')}\n${fnSource('normalizeBgPatternStrength')}\n${fnSource('readBgPatternState')}\n${fnSource('bgPatternTileUrl')}
    return { BG_PATTERNS, normalizeBgPattern, normalizeBgPatternStrength, readBgPatternState, bgPatternTileUrl };`)(ls);

  it('ships the 12 chosen patterns with unique ids, each a single SVG using the INK placeholder', () => {
    const { BG_PATTERNS } = build(store());
    assert.deepEqual(BG_PATTERNS.map(p => p.name), ['Graph paper', 'Plus grid', 'Isometric', 'Diagonal', 'Pinstripe', 'Crosshatch',
      'Hexagon', 'Herringbone', 'Basketweave', 'Chevron', 'Greek key', 'Dot grid']);
    assert.equal(new Set(BG_PATTERNS.map(p => p.id)).size, 12);
    for (const p of BG_PATTERNS) {
      assert.match(p.svg, /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' width='[\d.]+' height='[\d.]+'>[\s\S]*<\/svg>$/, p.id);
      assert.ok(p.svg.includes('INK'), `${p.id} uses INK`);
      assert.ok(!p.svg.includes('"'), `${p.id} has no double quotes (it goes inside url("..."))`);
    }
    assert.doesNotMatch(block, /paisley|scallop|contour/i);
  });

  it('defaults to off, Graph paper, 10%; bad stored values fall back; strength is clamped to 2–45', () => {
    const ls = store();
    const api = build(ls);
    assert.deepEqual(api.readBgPatternState(), { on: false, pattern: 'graph', strength: 10 });
    ls.setItem('work-desk-bg-pattern-on', 'true');
    ls.setItem('work-desk-bg-pattern', 'paisley');
    ls.setItem('work-desk-bg-pattern-strength', '99');
    assert.deepEqual(api.readBgPatternState(), { on: true, pattern: 'graph', strength: 45 });
    assert.equal(api.normalizeBgPatternStrength(0), 2);
    assert.equal(api.normalizeBgPatternStrength('12.6'), 13);
    assert.equal(api.normalizeBgPatternStrength('abc'), 10);
    assert.equal(api.normalizeBgPattern('greek-key'), 'greek-key');
  });

  it('tile URLs are tinted with the theme color and wrapped at the chosen opacity', () => {
    const { bgPatternTileUrl } = build(store());
    const url = bgPatternTileUrl('pinstripe', '#e6e3d8', 0.12);
    assert.match(url, /^url\("data:image\/svg\+xml,/);
    const svg = decodeURIComponent(url.slice('url("data:image/svg+xml,'.length, -2));
    assert.match(svg, /^<svg[^>]*><g opacity='0\.12'><path d='M5 0V10' stroke='#e6e3d8'/);
    assert.match(svg, /<\/g><\/svg>$/);
    assert.equal(bgPatternTileUrl('nope', '#000', 0.1), 'none');
  });

  it('wired like the other appearance settings: synced, reset, set on <body>, recolored on theme change', () => {
    assert.match(mainScript, /return \{ bgPatternOn: bg\.on, bgPattern: bg\.pattern, bgPatternStrength: bg\.strength \};/);
    assert.match(fnSource('applyCloudPrefs'), /applyBgPattern\(next, \{ fromSync: true \}\)/);
    assert.match(mainScript, /'bg-pattern-toggle': false/);
    assert.match(fnSource('resetOptionsTab'), /applyBgPattern\(\{ pattern: BG_PATTERN_DEFAULT, strength: BG_PATTERN_STRENGTH_DEFAULT \}\)/);
    assert.match(fnSource('renderBgPattern'), /document\.body\.style\.setProperty\('--desk-pattern'/);
    assert.match(fnSource('initBgPattern'), /attributeFilter: \['class', 'style', 'data-theme'\]/);
    assert.match(fnSource('initDensityToggle'), /initBgPattern\(\);/);
    assert.match(html.match(/\n    \.main \{[^}]*\}/)[0], /background-image: var\(--desk-pattern, none\);/);
    assert.match(html, /<input id="bg-pattern-strength" type="range" min="2" max="45" step="1" value="10" \/>/);
    const pane = html.slice(html.indexOf('id="options-pane-appearance"'), html.indexOf('id="options-pane-behavior"'));
    const at = id => pane.indexOf(`data-options-section="${id}"`);
    assert.ok(at('background') > at('effects') && at('effects') > 0 && at('background') < at('tags'),
      'Background sits between Effects and Tags');
  });

  it('pattern clicks only toggle classes, so the Options popout never loses its click target', () => {
    const render = fnSource('renderBgPattern');
    assert.doesNotMatch(render, /innerHTML/);
    assert.match(fnSource('initBgPattern'), /if \(grid && !grid\.children\.length\)/);
  });

});

describe('v1.16.2 tag color labels', () => {
  it('uses plain labels everywhere, with stored values unchanged', () => {
    assert.match(mainScript, /const TAG_COLOR_MODES = \['theme', 'analogous', 'palette'\];/);
    assert.doesNotMatch(html, /Analogous \(shades of accent\)<\/option>|Multi-color \(from theme\)<\/option>/);
    assert.match(html, /<p class="tag-color-hint">Shades of accent picks colors that match what's on screen: the accent and the theme's background tint\. Multi-color uses a wider set that suits the theme\./);
  });

});

describe('v1.16.0 tag pills do not narrow card text', () => {
  it('chips render inside the top row, before the content, and never while editing', () => {
    const src = fnSource('renderItem');
    assert.match(src, /tags\.length && !isEditing && !tagsInBar \? ' has-tags' : ''/);
    const chipAt = src.indexOf('if (!isEditing && tags.length && !tagsInBar) row.appendChild(buildTagChipRow(item, tags))');
    assert.ok(chipAt > 0, 'chip row is appended to the .item row');
    assert.ok(chipAt < src.indexOf("content.className = 'item-content rich-content'"), 'chip row comes before the content');
    assert.doesNotMatch(src, /card\.appendChild\(buildTagChipRow/);
  });

  it('CSS gives chips a grid area instead of padding the content', () => {
    assert.doesNotMatch(html, /\.has-tags \.item-content \{[^}]*padding-right/);
    const block = html.slice(html.indexOf('    .tag-chip-row {'), html.indexOf('    .tag-chip {'));
    assert.match(block, /\.tag-chip-row \{\s*grid-area: tags;[^}]*flex-wrap: wrap;/);
    assert.doesNotMatch(block, /\.tag-chip-row \{[^}]*position: absolute/);
    assert.match(block, /\.board-column \.item\.has-tags \{\s*grid-template-columns: auto minmax\(0, 1fr\);\s*grid-template-areas:\s*"check tags"\s*"content content";/);
    assert.match(block, /\.item\.note\.has-tags \{[^}]*"tags"\s*"content";/);
    assert.match(block, /data-density="compact"\] \.board-column \.item\.has-tags \.tag-chip-row \{\s*order: -1;\s*flex: 0 0 100%;/);
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
      let shadeRefreshes = 0;
      const refreshTagShades = () => { shadeRefreshes++; };
      const tagShadeSlot = (tag) => tag.length % 8;
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
        state, store, document, pushes: () => pushes, shadeRefreshes: () => shadeRefreshes };
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

  it('decorateTagChip hands out the same use-order slot in both color modes and applies/removes a custom color', () => {
    const f = tagColorFns({ 'work-desk-tag-colors': JSON.stringify({ urgent: '#ef4444' }) });
    const chip = fakeChip();
    f.decorateTagChip(chip, 'urgent');
    assert.equal(chip.dataset.tag, 'urgent');
    assert.equal(chip.dataset.tagSlot, undefined, 'the name-hash slot is gone');
    assert.equal(chip.dataset.shadeSlot, undefined, 'Single color has no slots');
    f.state.tagColorMode = 'analogous';
    f.decorateTagChip(chip, 'urgent');
    const slot = chip.dataset.shadeSlot;
    assert.equal(slot, String('urgent'.length % 8));
    f.state.tagColorMode = 'palette';
    f.decorateTagChip(chip, 'urgent');
    assert.equal(chip.dataset.shadeSlot, slot, 'Multi-color uses the same slot, so a tag keeps its position when you switch');
    f.state.tagColorMode = 'theme';
    f.decorateTagChip(chip, 'urgent');
    assert.equal(chip.dataset.shadeSlot, undefined);
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
    assert.match(html, /<option value="theme">Single color \(accent\)<\/option>\s*<option value="analogous">Shades of accent<\/option>\s*<option value="palette">Multi-color<\/option>/);
  });

  it('CSS: chips read --tag-fg/--tag-bg, both color modes share the shade-slot rules, custom beats them', () => {
    assert.match(html, /\.tag-chip \{\s*--tag-fg: var\(--accent\);\s*--tag-bg: var\(--accent-light\);/);
    const modes = 'html:is\\(\\[data-tag-colors="analogous"\\], \\[data-tag-colors="palette"\\]\\)';
    // the (0,2,1) base rule sets --tag-fg; (0,3,1) slot rules only pick the shade, so a pinned color still wins
    assert.match(html, new RegExp(`${modes} \\.tag-chip \\{\\s*--tag-shade: var\\(--tag-shade-0, var\\(--accent\\)\\);\\s*--tag-fg: var\\(--tag-shade\\);`));
    for (let s = 1; s < 8; s++) {
      assert.match(html, new RegExp(`${modes} \\.tag-chip\\[data-shade-slot="${s}"\\] \\{ --tag-shade: var\\(--tag-shade-${s}, var\\(--accent\\)\\); \\}`), `shade slot ${s}`);
    }
    assert.doesNotMatch(html, /data-shade-slot="\d"\] \{[^}]*--tag-fg/);
    assert.doesNotMatch(html, /--tag-dh|--tag-dl|--tag-hue|data-tag-slot/, 'the old hue-rotation Multi-color is gone');
    // (0,3,0) custom selector must out-rank the (0,2,1) mode selector
    assert.match(html, /\.tag-chip\.tag-custom\[data-tag\] \{\s*--tag-fg: color-mix\(in oklch, var\(--tag-custom\) \d+%, var\(--text\)\);/);
    assert.match(html, /\.tag-chip-remove \{[^}]*color: inherit;/);
  });

  it('every chip builder decorates chips; only card chips open the popover', () => {
    const builders = mainScript.match(/chip\.className = 'tag-chip[^']*';[\s\S]{0,300}?decorateTagChip\(chip, tag\)/g) || [];
    assert.equal(builders.length, 5, 'card chips, recurring list chips, template editor chips, the Options tag list, and Insights chips');
    assert.match(fnSource('insightTagChips'), /decorateTagChip\(chip, tag\);\s*chip\.appendChild\(tagChipLabel\(tag\.toUpperCase\(\)\)\)/);
    assert.doesNotMatch(fnSource('insightTagChips'), /openTagColorPopover/);
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
    assert.match(fnSource('applyTagColorMode'), /refreshTagShades\(\);\s*refreshTagChipColors\(\);/);
    assert.match(fnSource('applyTheme'), /syncTagColorListRows\(\)/);
    assert.match(fnSource('refreshTagShades'), /syncTagColorListRows\(\)/);
  });

  it('every tag chip wraps its text in a label so it can be centered', () => {
    assert.equal((mainScript.match(/className = 'tag-chip( tag-clickable)?';/g) || []).length, 6);
    assert.doesNotMatch(mainScript, /(chip|preview)\.textContent = tag/);
    assert.equal((mainScript.match(/appendChild\(tagChipLabel\(/g) || []).length, 7);
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

  it('version lives in the sidebar footer; the What\'s new link sits under the subtitle and hides on close', () => {
    const sub = html.match(/<p id="logo-sub" class="logo-sub">[\s\S]*?<\/p>/)[0];
    assert.doesNotMatch(sub, /version-btn|version-new-dot/);
    assert.match(html, /<\/p>\s*<button id="whats-new-link" class="whats-new-link hidden" type="button">What's new<span id="version-new-dot" class="version-new-dot"><\/span><\/button>/);
    assert.match(html, /<div id="account-menu"[\s\S]*?<div class="sidebar-version">\s*<span>Version<\/span>\s*<button id="version-btn" class="version-btn" type="button" role="menuitem" title="What's new"><\/button>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/aside>/);
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
    assert.match(html, /if \(state\.taggingId === item\.id\) \{[\s\S]{0,300}buildTagEntry\(item\.tags,/);
    const box = fnSource('buildTagEntry');
    assert.doesNotMatch(box, /addEventListener\('blur'/);
    assert.match(box, /setTimeout\(\(\) => setTimeout\(\(\) => \{ if \(tagInput\.isConnected\) tagInput\.focus\(\); \}, 0\), 0\)/);
    assert.match(html, /if \(\(!state\.taggingId && !state\.projectTaggingId\) \|\| e\.target\.closest\?\.\('\.tag-input-wrap'\)\) return;\s*state\.taggingId = null;\s*state\.projectTaggingId = null;/);
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
    assert.match(html, /\.cal-day-badge \{[^}]*background: color-mix\(in srgb, var\(--carried\) 20%, transparent\);[^}]*color: var\(--carried-ink\);/);
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
    assert.match(fnSource('sendDeskItemToProject'), /markItemRestored\(itemId, data\)/);
    assert.equal((mainScript.match(/markItemRestored\(/g) || []).length, 3, 'declaration + delete Undo + send-to-project Undo only');
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

// ═══════════════════════════════════════════════════════════════════════
// v1.17.0 Options summary list, account menu, calendar polish, quieter weekends
// ═══════════════════════════════════════════════════════════════════════
describe('v1.17.0 Options summary list', () => {
  const labelConsts = ['OPTIONS_FONT_LABELS', 'OPTIONS_TAG_MODE_LABELS', 'OPTIONS_COMPLETE_STYLE_LABELS', 'OPTIONS_TAG_POSITION_LABELS']
    .map(n => mainScript.match(new RegExp(`const ${n} = \\{[\\s\\S]*?\\};`))[0]).join('\n');
  const summary = new Function(`${labelConsts}
    const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
    ${fnSource('optionsSummaryText')}
    return optionsSummaryText;`)();
  const appearance = html.slice(html.indexOf('id="options-pane-appearance"'), html.indexOf('id="options-pane-behavior"'));
  const behavior = html.slice(html.indexOf('id="options-pane-behavior"'), html.indexOf('id="options-pane-behavior"') + 40000);

  it('summarizes every Appearance row', () => {
    assert.equal(summary('card-layout', { density: 'compact', completeStyle: 'bar', tagPosition: 'slim' }), 'Compact · Bar · Slim tags');
    assert.equal(summary('card-layout', {}), 'Comfortable · Done label');
    assert.equal(summary('typography', { fontSize: 'large', fontFamily: 'jetbrains' }), 'Large · JetBrains Mono');
    assert.equal(summary('typography', { fontFamily: 'nope' }), 'Default · System font');
    assert.equal(summary('layout', { sidebarPosition: 'top' }), 'Sidebar top');
    assert.equal(summary('effects', {}), 'Off');
    assert.equal(summary('effects', { cardGlow: true, gradientHeader: true }), 'Glow · Gradient');
    assert.equal(summary('background', { bgOn: false }), 'Off');
    assert.equal(summary('background', { bgOn: true, bgPatternName: 'Greek key', bgStrength: 12 }), 'Greek key · 12%');
    assert.equal(summary('tags', { tagMode: 'palette', pinnedTags: 2 }), 'Multi-color · 2 pinned');
    assert.equal(summary('tags', {}), 'Single color');
  });

  it('summarizes every Behavior row', () => {
    assert.equal(summary('general', { startupView: 'today', weekStart: 'monday' }), 'Today · Mon');
    assert.equal(summary('general', {}), 'Last viewed · Sun');
    assert.equal(summary('tasks', { tasksOn: 3, tasksTotal: 6 }), '3 of 6 on');
    assert.equal(summary('projects', { truncateNotes: true }), 'Truncate long notes');
    assert.equal(summary('projects', {}), 'Full notes');
    assert.equal(summary('insights', { streakSkipWeekends: false }), 'Strict streaks');
    assert.equal(summary('holidays', { federalHolidays: true, customHolidays: 3 }), 'US federal · 3 custom');
    assert.equal(summary('holidays', {}), 'No federal');
    assert.equal(summary('unknown', {}), '');
  });

  it('each row opens a matching section with a back button, and Reset stays on the list', () => {
    const rows = (pane) => [...pane.matchAll(/data-options-open="([\w-]+)"/g)].map(m => m[1]);
    assert.deepEqual(rows(appearance), ['card-layout', 'typography', 'layout', 'effects', 'background', 'tags']);
    assert.deepEqual(rows(behavior), ['general', 'tasks', 'projects', 'insights', 'holidays']);
    for (const pane of [appearance, behavior]) {
      for (const id of rows(pane)) {
        const at = pane.indexOf(`data-options-section="${id}"`);
        assert.ok(at > 0, `${id} section exists`);
        assert.match(pane.slice(at, at + 400), /data-options-back>‹ Back<\/button>/);
      }
    }
    assert.doesNotMatch(appearance + behavior, /<p class="density-popout-label">/);
    assert.match(html, /\.options-pane\.in-section \.options-summary,\s*\.options-pane\.in-section > \.options-reset-btn \{ display: none; \}/);
  });

  it('Esc closes an open section before the popout, and tabs / reopening return to the list', () => {
    const init = fnSource('initDensityToggle');
    assert.match(init, /\.options-pane\.in-section:not\(\.hidden\)/);
    assert.match(fnSource('openDensityPopout'), /resetOptionsNavigation\(\);/);
    assert.match(fnSource('closeOptionsSection'), /renderOptionsSummaries\(\);/);
    assert.match(fnSource('openOptionsSection'), /if \(id === 'tags'\) renderTagColorList\(\);/);
  });

  it('New tags show only during the release that added them', () => {
    const isNew = new Function(`const APP_VERSION = '1.17.0'; ${fnSource('isNewInCurrentRelease')} return isNewInCurrentRelease;`)();
    assert.equal(isNew('1.17.0'), true);
    assert.equal(isNew('1.17.0', '1.17.3'), true);
    assert.equal(isNew('1.17.0', '1.18.0'), false);
    assert.equal(isNew('1.16.2'), false);
    assert.equal(isNew(''), false);
    assert.equal(isNew(undefined), false);
    assert.ok((html.match(/class="options-new-tag" data-new-in="1\.17\.\d"/g) || []).length >= 2);
  });

  it('switches replace checkboxes; patterns are 3 wide with the selected name below', () => {
    assert.match(html, /\.customize-toggle input \{[^}]*appearance: none;/);
    assert.match(mainScript, /const BG_PATTERN_COLUMNS = 3;/);
    assert.match(html, /<p class="bg-pattern-picked">Selected: <strong id="bg-pattern-name"><\/strong><\/p>/);
    assert.match(fnSource('renderBgPattern'), /bg-pattern-name/);
    assert.doesNotMatch(html, /bg-pattern-tile-name/);
  });
});

describe('v1.17.0 account menu', () => {
  it('holds the app links, backup, sign in/out, and version; the old footer controls live only here', () => {
    const menu = html.slice(html.indexOf('<div id="account-menu"'), html.indexOf('</aside>'));
    for (const id of ['account-menu-options', 'account-menu-help', 'account-menu-whatsnew', 'account-menu-new-dot', 'export-btn', 'import-btn', 'repair-btn', 'sb-signin-btn', 'sb-signout-btn', 'version-btn']) {
      assert.match(menu, new RegExp(`id="${id}"`), id);
      assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} is unique`);
    }
    assert.match(html, /id="account-menu-btn"[^>]*aria-haspopup="menu" aria-expanded="false" aria-controls="account-menu"/);
    assert.match(html, /<button id="help-btn" class="logo-help-btn"/, 'the ? next to the logo stays');
  });

  it('opens and closes like a menu and hands off to Options, Help, and What\'s new', () => {
    const block = mainScript.slice(mainScript.indexOf('/* ── Account menu ── */'), mainScript.indexOf("versionBtn.textContent = `v${APP_VERSION}`;"));
    assert.match(block, /accountMenuBtn\.setAttribute\('aria-expanded', 'true'\)/);
    assert.match(block, /e\.key !== 'Escape'/);
    assert.match(block, /!e\.target\.closest\?\.\('#sidebar-account'\)/);
    assert.match(block, /account-menu-help'\)\.addEventListener\('click', \(\) => \{ closeAccountMenu\(\); openHelpModal\(\); \}\)/);
    assert.match(block, /account-menu-whatsnew'\)\.addEventListener\('click', \(\) => \{ closeAccountMenu\(\); openChangelog\(\); \}\)/);
    assert.match(block, /popout\.classList\.add\('options-floating'\);\s*document\.body\.appendChild\(popout\);/);
    assert.match(fnSource('closeDensityPopout'), /popout\.classList\.remove\('options-floating'\);/);
    assert.match(fnSource('closeChangelog'), /syncAccountNewDots\(\);/);
  });

  it('describes sync status in words', () => {
    const text = new Function(`${fnSource('accountStatusText')} return accountStatusText;`)();
    assert.equal(text('guest'), 'Not syncing');
    assert.equal(text('offline'), 'This browser only');
    assert.equal(text('signed-in', 'ok'), 'Synced');
    assert.equal(text('signed-in', 'syncing'), 'Syncing…');
    assert.equal(text('signed-in', 'error'), 'Sync error');
    assert.equal(text('signed-in', undefined), 'Signed in');
    assert.match(fnSource('updateAccountChrome'), /accountMode = mode;\s*syncAccountStatusText\(\);/);
  });

  it('bar layouts anchor the menu to the right, opening down from a top bar; the phone sheet shows it inline', () => {
    assert.match(html, /\[data-sidebar-bar\] \.account-menu \{ left: auto; right: 0; width: 240px; \}/);
    assert.match(html, /\.mobile-menu-sheet \.account-menu\.hidden \{ display: flex; position: static;/);
    assert.match(html, /\.mobile-menu-sheet \.account-menu-app,\s*\.mobile-menu-sheet \.account-menu \.sidebar-version \{ display: none; \}/);
    assert.doesNotMatch(html, /\[data-sidebar-bar\] \.sidebar-repair-link::before/);
  });
});

describe('v1.17.0 calendar', () => {
  const chip = new Function(`${fnSource('calendarNeedsTodayChip')} return calendarNeedsTodayChip;`)();
  const weekends = new Function(`${fnSource('normalizeQuietWeekends')}\n${fnSource('quietWeekendsActive')} return { normalizeQuietWeekends, quietWeekendsActive };`)();

  it('shows the Today chip only away from the current month', () => {
    assert.equal(chip({ year: 2026, month: 9 }, '2026-10-14'), false);
    assert.equal(chip({ year: 2026, month: 10 }, '2026-10-14'), true);
    assert.equal(chip({ year: 2027, month: 9 }, '2026-10-14'), true);
    assert.equal(chip(null, '2026-10-14'), false);
    assert.equal(chip({ year: 2026, month: 9 }, ''), false);
  });

  it('quieter weekends: off by default, work-only follows the desk, both always', () => {
    assert.equal(weekends.normalizeQuietWeekends(null), 'off');
    assert.equal(weekends.normalizeQuietWeekends('bogus'), 'off');
    assert.equal(weekends.normalizeQuietWeekends('work'), 'work');
    assert.equal(weekends.normalizeQuietWeekends('both'), 'both');
    assert.equal(weekends.quietWeekendsActive('off', 'work'), false);
    assert.equal(weekends.quietWeekendsActive('work', 'work'), true);
    assert.equal(weekends.quietWeekendsActive('work', 'personal'), false);
    assert.equal(weekends.quietWeekendsActive('both', 'personal'), true);
  });

  it('quieter weekends is synced, reset, and redraws the calendar', () => {
    assert.match(mainScript, /const QUIET_WEEKENDS_KEY = 'work-desk-quiet-weekends';/);
    assert.match(mainScript, /quietWeekends: normalizeQuietWeekends\(localStorage\.getItem\(QUIET_WEEKENDS_KEY\)\)/);
    assert.match(fnSource('applyCloudPrefs'), /prefs\.quietWeekends/);
    assert.match(mainScript, /'quiet-weekends-select': 'off'/);
    const render = fnSource('renderCalendar');
    assert.match(render, /host\.classList\.toggle\('quiet-weekends', quietWeekendsActive\(state\.quietWeekends, state\.listContext\)\)/);
    assert.match(html, /\.sidebar-calendar\.quiet-weekends \.cal-day\.weekend:not\(\.selected\):not\(\.holiday\):not\(\.other-month\) \{ color: var\(--sidebar-muted\); \}/);
  });

  it('renders the Today chip and the legend, and fills the selected day with the theme color', () => {
    const render = fnSource('renderCalendar');
    assert.match(render, /calendarNeedsTodayChip\(/);
    assert.match(render, /cal-legend/);
    for (const label of ['Has items', 'Left open', 'Holiday']) assert.ok(render.includes(label), label);
    assert.match(html, /rgb\(from var\(--sidebar-cal-selected-bg\) r g b \/ 1\)/);
  });

  it('left open and carried over share --carried: amber, rose on the six amber-accent themes', () => {
    assert.match(html, /--carried: #f59e0b;/);
    assert.match(html, /\[data-theme="clay"\], \[data-theme="flint"\], \[data-theme="denim"\],\s*\[data-theme="warm"\], \[data-theme="noir"\], \[data-theme="mocha"\] \{ --carried: #fb7185; --carried-ink: #fda4af; \}/);
    assert.match(html, /--carried-ink: #fbbf24;/);
    assert.match(html, /\.legend-swatch\.carried \{[^}]*var\(--carried\)/);
    assert.match(html, /\.insight-bar-seg\.carried \{[^}]*var\(--carried\)/);
  });
});

describe('v1.17.0 docs', () => {

  it('1.17.1: Options panes size to their list and lock that height only while a section is open', () => {
    assert.doesNotMatch(html, /#options-pane-appearance, #options-pane-behavior \{ min-height/);
    assert.match(fnSource('openOptionsSection'), /pane\.style\.minHeight = `\$\{pane\.getBoundingClientRect\(\)\.height\}px`;\s*pane\.querySelectorAll/);
    assert.match(fnSource('closeOptionsSection'), /pane\.style\.minHeight = '';/);
  });
});

describe('v1.17.2 Options polish', () => {
  const labelConsts = ['OPTIONS_FONT_LABELS', 'OPTIONS_TAG_MODE_LABELS', 'OPTIONS_COMPLETE_STYLE_LABELS', 'OPTIONS_TAG_POSITION_LABELS']
    .map(n => mainScript.match(new RegExp(`const ${n} = \\{[\\s\\S]*?\\};`))[0]).join('\n');
  const summary = new Function(`${labelConsts}
    const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
    ${fnSource('optionsSummaryText')}
    return optionsSummaryText;`)();

  it('summaries are short and include the new settings', () => {
    assert.equal(summary('layout', { sidebarPosition: 'left', showCalLegend: true, showTodayProgress: true }), 'Sidebar left');
    assert.equal(summary('layout', { sidebarPosition: 'top', showCalLegend: false, showTodayProgress: false }), 'Sidebar top · No legend · No progress');
    assert.equal(summary('general', { launchDesk: 'personal', startupView: 'today', weekStart: 'monday' }), 'Personal · Today · Mon');
    assert.equal(summary('general', { launchDesk: 'last' }), 'Last viewed · Sun');
    assert.equal(summary('insights', { streakSkipWeekends: true }), 'Weekends skipped');
  });

  it('opens the chosen desk, or the last one used', () => {
    const fns = new Function(`const LAUNCH_DESK_VALUES = ['last', 'work', 'personal'];
      ${fnSource('normalizeLaunchDesk')}\n${fnSource('resolveLaunchContext')}
      return { normalizeLaunchDesk, resolveLaunchContext };`)();
    assert.equal(fns.normalizeLaunchDesk(null), 'last');
    assert.equal(fns.normalizeLaunchDesk('bogus'), 'last');
    assert.equal(fns.resolveLaunchContext('last', 'personal'), 'personal');
    assert.equal(fns.resolveLaunchContext(null, 'projects'), 'projects');
    assert.equal(fns.resolveLaunchContext('work', 'personal'), 'work');
    assert.equal(fns.resolveLaunchContext('personal', 'projects'), 'personal');
    assert.match(mainScript, /const launchContext = resolveLaunchContext\(localStorage\.getItem\(LAUNCH_DESK_KEY\), getListContext\(\)\);/);
    assert.ok(mainScript.indexOf('const launchContext') < mainScript.indexOf('const state = {'), 'runs before state reads the desk');
    assert.match(html, /<select id="launch-desk-select" aria-label="Open desk">/);
    assert.match(mainScript, /'launch-desk-select': 'last'/);
    assert.match(fnSource('readLocalPrefs'), /launchDesk: normalizeLaunchDesk/);
    assert.match(fnSource('applyCloudPrefs'), /prefs\.launchDesk/);
  });

  it('calendar legend and Today\'s Progress can be hidden, synced, and reset', () => {
    for (const [id, key, pref, fn] of [
      ['show-cal-legend-toggle', 'SHOW_CAL_LEGEND_KEY', 'showCalLegend', 'applyShowCalLegend'],
      ['show-today-progress-toggle', 'SHOW_TODAY_PROGRESS_KEY', 'showTodayProgress', 'applyShowTodayProgress'],
    ]) {
      assert.match(html, new RegExp(`<input id="${id}" type="checkbox" checked />`));
      assert.match(mainScript, new RegExp(`'${id}': true`));
      assert.match(fnSource('readLocalPrefs'), new RegExp(`${pref}: localStorage\\.getItem\\(${key}\\) !== 'false'`));
      assert.match(fnSource('applyCloudPrefs'), new RegExp(`${fn}\\(prefs\\.${pref}, \\{ fromSync: true \\}\\)`));
    }
    assert.match(html, /\[data-cal-legend="hide"\] \.cal-legend,\s*\[data-today-progress="hide"\] #sidebar-today-glance \{ display: none !important; \}/);
    const layout = html.slice(html.indexOf('data-options-section="layout"'), html.indexOf('data-options-section="effects"'));
    assert.match(layout, /show-cal-legend-toggle/);
    assert.match(layout, /show-today-progress-toggle/);
  });

  it('New tags hide once their section is opened, per section and version', () => {
    const store = {};
    const localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
    const tag = (newIn, section, row) => ({
      dataset: { newIn }, hidden: false,
      closest: (sel) => (sel === '[data-options-section]' && section ? { dataset: { optionsSection: section } }
        : sel === '[data-options-open]' && row ? { dataset: { optionsOpen: row } } : null),
    });
    const tags = [tag('1.17.2', null, 'general'), tag('1.17.0', 'general'), tag('1.17.2', 'layout'), tag('1.16.0', 'tasks')];
    const document = { querySelectorAll: () => tags };
    const api = new Function('localStorage', 'document', `const APP_VERSION = '1.17.2'; const SEEN_NEW_TAGS_KEY = 'seen';
      ${fnSource('isNewInCurrentRelease')}\n${fnSource('newTagKey')}\n${fnSource('readSeenNewTags')}\n${fnSource('markNewTagsSeen')}\n${fnSource('syncNewTags')}
      return { markNewTagsSeen, syncNewTags };`)(localStorage, document);
    api.syncNewTags();
    assert.deepEqual(tags.map(t => t.hidden), [false, false, false, true]);
    api.markNewTagsSeen('general');
    assert.deepEqual(tags.map(t => t.hidden), [false, false, false, true], 'stays up during the visit');
    api.syncNewTags();
    assert.deepEqual(tags.map(t => t.hidden), [true, true, false, true]);
    assert.deepEqual(JSON.parse(store.seen).sort(), ['general@1.17.0', 'general@1.17.2']);
    store.seen = 'not json';
    api.syncNewTags();
    assert.equal(tags[0].hidden, false, 'bad storage shows tags again');
    assert.match(fnSource('openOptionsSection'), /markNewTagsSeen\(id\);/);
    assert.match(fnSource('closeOptionsSection'), /syncNewTags\(\);/);
  });

  it('Quieter weekends keeps its New tag inline with a one-line hint', () => {
    assert.match(html, /\.customize-select-row-sub label > span:first-child \{ display: block; \}/);
    assert.match(html, /<span class="customize-toggle-sub">On the calendar and in Insights<\/span>/);
  });

  it('notes no longer carry the 📝 icon', () => {
    assert.doesNotMatch(html, /note-icon/);
    assert.doesNotMatch(html, /"icon (tags|content)"/);
    assert.match(html, /\.item\.note \{ grid-template-areas: "content"; \}/);
  });

});

// ═══════════════════════════════════════════════════════════════════════
// v1.18.0 complete edge + tag position
// ═══════════════════════════════════════════════════════════════════════
describe('v1.18.0 complete edge and tag position', () => {
  const fns = new Function(`
    const COMPLETE_STYLES = ['label', 'bar', 'raised', 'switch', 'circle', 'square', 'diamond', 'check', 'none', 'checkbox'];
    const TAG_POSITIONS = ['row', 'slim', 'actions'];
    ${fnSource('normalizeCompleteStyle')}\n${fnSource('normalizeTagPosition')}
    return { normalizeCompleteStyle, normalizeTagPosition };`)();
  const appearance = html.slice(html.indexOf('id="options-pane-appearance"'), html.indexOf('id="options-pane-behavior"'));

  it('defaults to the "Done" label and tags on their own row; junk falls back', () => {
    assert.equal(fns.normalizeCompleteStyle(null), 'label');
    assert.equal(fns.normalizeCompleteStyle('bogus'), 'label');
    assert.equal(fns.normalizeCompleteStyle('checkbox'), 'checkbox');
    assert.equal(fns.normalizeCompleteStyle('switch'), 'switch');
    assert.equal(fns.normalizeTagPosition(undefined), 'row');
    assert.equal(fns.normalizeTagPosition('top'), 'row');
    assert.equal(fns.normalizeTagPosition('slim'), 'slim');
    assert.equal(fns.normalizeTagPosition('actions'), 'actions');
    assert.match(mainScript, /const COMPLETE_STYLES = \['label', 'bar', 'raised', 'switch', 'circle', 'square', 'diamond', 'check', 'none', 'checkbox'\];/);
    assert.match(mainScript, /const TAG_POSITIONS = \['row', 'slim', 'actions'\];/);
  });

  it('both selects live in Card layout with every option, a New tag, and reset defaults', () => {
    const section = appearance.slice(appearance.indexOf('data-options-section="card-layout"'), appearance.indexOf('data-options-section="typography"'));
    const styles = [...section.matchAll(/<select id="complete-style-select"[\s\S]*?<\/select>/g)][0][0];
    assert.deepEqual([...styles.matchAll(/value="(\w+)"/g)].map(m => m[1]), ['label', 'bar', 'raised', 'switch', 'circle', 'square', 'diamond', 'check', 'none', 'checkbox']);
    assert.match(styles, />Checkbox</);
    const tags = [...section.matchAll(/<select id="tag-position-select"[\s\S]*?<\/select>/g)][0][0];
    assert.deepEqual([...tags.matchAll(/value="(\w+)"/g)].map(m => m[1]), ['row', 'slim', 'actions']);
    assert.equal((section.match(/data-new-in="1\.18\.0"/g) || []).length, 2);
    assert.match(appearance, /Card layout<span class="options-new-tag" data-new-in="1\.18\.0">New<\/span>/);
    assert.match(mainScript, /'complete-style-select': 'label',\s*'tag-position-select': 'row',/);
  });

  it('apply sets html attributes, saves, and syncs; only the action-bar switch re-renders', () => {
    const style = fnSource('applyCompleteStyle');
    assert.match(style, /dataset\.completeStyle = next/);
    assert.match(style, /dataset\.completeEdge = next === 'checkbox' \? 'off' : 'on'/);
    assert.match(style, /localStorage\.setItem\(COMPLETE_STYLE_KEY, next\)/);
    assert.match(style, /if \(!fromSync\) schedulePrefsPush\(\)/);
    const pos = fnSource('applyTagPosition');
    assert.match(pos, /dataset\.tagPosition = next/);
    assert.match(pos, /const movedBar = \(state\.tagPosition === 'actions'\) !== \(next === 'actions'\)/);
    assert.match(pos, /if \(movedBar && rerender\) render\(\)/);
    assert.match(mainScript, /applyTagPosition\(state\.tagPosition, \{ fromSync: true, rerender: false \}\)/);
    assert.match(fnSource('readLocalPrefs'), /completeStyle: normalizeCompleteStyle\(localStorage\.getItem\(COMPLETE_STYLE_KEY\)\)/);
    assert.match(fnSource('readLocalPrefs'), /tagPosition: normalizeTagPosition\(localStorage\.getItem\(TAG_POSITION_KEY\)\)/);
    assert.match(fnSource('applyCloudPrefs'), /COMPLETE_STYLES\.includes\(prefs\.completeStyle\)/);
    assert.match(fnSource('applyCloudPrefs'), /TAG_POSITIONS\.includes\(prefs\.tagPosition\)/);
  });

  it('cards wrap the row and action bar so the edge stops above comments; the edge comes first', () => {
    const src = fnSource('renderItem');
    assert.match(src, /main\.className = 'card-main';\s*if \(item\.type === 'task'\) main\.appendChild\(buildCompleteEdge\(item\)\);\s*main\.appendChild\(row\);\s*card\.appendChild\(main\);/);
    assert.match(src, /main\.appendChild\(actionBar\);/);
    assert.ok(src.indexOf('card.appendChild(renderCommentsPanel(item))') > src.indexOf('main.appendChild(actionBar)'), 'comments stay outside .card-main');
    assert.match(src, /const tagsInBar = state\.tagPosition === 'actions' && tags\.length > 0 && !isEditing;/);
    assert.match(src, /actionEnd\.className = 'card-action-end';\s*if \(tagsInBar\) actionEnd\.appendChild\(buildTagChipRow\(item, tags\)\);/);
    assert.match(src, /actionEnd\.appendChild\(overflowWrap\);\s*actionBar\.appendChild\(actionEnd\);/);
    assert.match(html, /\.card-main \{ position: relative; \}/);
    assert.match(html, /html\[data-complete-edge="on"\] \.task-card:has\(\.comments-panel\) \.complete-edge \{ border-bottom-left-radius: 0; \}/);
  });

  it('the edge toggles the task, labels itself, and ignores a press that turned into a drag', () => {
    const src = fnSource('buildCompleteEdge');
    assert.match(src, /edge\.className = `complete-edge\$\{item\.completed \? ' is-done' : ''\}`/);
    assert.match(src, /const label = item\.completed \? 'Mark incomplete' : 'Mark complete';/);
    assert.match(src, /edge\.setAttribute\('aria-label', label\)/);
    assert.match(src, /e\.detail > 0 && Math\.hypot\(e\.clientX - start\.x, e\.clientY - start\.y\) > 4/);
    assert.match(src, /onToggle = \(\) => toggleItem\(item\.id\)/);
    assert.match(src, /if \(!moved\) onToggle\(\)/);
  });

  it('CSS: classic hides the edge, the label states, wider edge on touch, slim chips sized to the row', () => {
    assert.match(html, /\.complete-edge \{ display: none; \}/);
    assert.match(html, /html\[data-complete-edge="on"\] \.item\.task > \.checkbox \{ display: none; \}/);
    for (const s of ["content: 'done';", "content: 'done\\200A?';", "content: 'done\\200A!';", "content: 'undo\\200A?';", "content: 'doing';"]) assert.ok(html.includes(s), s);
    assert.match(html, /html\[data-complete-style="label"\] \.item-card\.dragging \.complete-edge::before/);
    assert.match(html, /html\[data-complete-style="label"\] \.complete-edge\.is-done::before \{ content: 'done\\200A!'; transform: rotate\(180deg\);/);
    assert.match(html, /@media \(hover: none\), \(pointer: coarse\) \{\s*html\[data-complete-edge="on"\] :is\(\.task-card, \.project-task-card\) \.complete-edge \{ width: 40px; \}/);
    // Touch with the desktop layout (tablet in landscape) gets an in-between edge, declared after the 40px rule so it wins
    const tabletEdge = html.indexOf('@media (min-width: 769px) and (hover: none), (min-width: 769px) and (pointer: coarse) {\n      html[data-complete-edge="on"] :is(.task-card, .project-task-card) .complete-edge { width: 28px; }');
    assert.ok(tabletEdge > html.indexOf('.complete-edge { width: 40px; }'), 'tablet edge rule follows the touch rule');
    assert.match(html.slice(tabletEdge, tabletEdge + 600), /\.item-card\.task-card \.item\.task \{ padding-left: 40px; \}[\s\S]*\.project-task-card \{ padding-left: 40px; \}[\s\S]*\.card-action-bar \{ padding-left: 36px; \}/);
    assert.match(html, /grid-template-areas: "tags" "content"; grid-template-rows: 14px auto;/);
    assert.match(html, /\.item\.task \.tag-chip \{\s*box-sizing: border-box; height: 14px; padding-block: 0;/);
    assert.match(html, /height: 14px; flex-wrap: nowrap; overflow-x: clip; overflow-y: visible;/);
    assert.match(html, /\.card-action-end \{ margin-left: auto; display: flex;/);
  });

  it('Options summary describes the card layout', () => {
    const labelConsts = ['OPTIONS_COMPLETE_STYLE_LABELS', 'OPTIONS_TAG_POSITION_LABELS']
      .map(n => mainScript.match(new RegExp(`const ${n} = \\{[\\s\\S]*?\\};`))[0]).join('\n');
    const summary = new Function(`${labelConsts}
      const OPTIONS_FONT_LABELS = {}; const OPTIONS_TAG_MODE_LABELS = {};
      const capitalize = (s) => s;
      ${fnSource('optionsSummaryText')}
      return optionsSummaryText;`)();
    assert.equal(summary('card-layout', { completeStyle: 'checkbox', tagPosition: 'actions' }), 'Comfortable · Checkbox · Tags in bar');
  });
});

describe('v1.18.1 calendar legend sample', () => {
  it('the Left open sample is an empty swatch, not a hard-coded count', () => {
    assert.match(html, /<span class="cal-legend-badge" aria-hidden="true"><\/span>Left open/);
    assert.doesNotMatch(html, /<span class="cal-legend-badge">\d+<\/span>/);
  });
  it('the sample is a dot the size of the others, in the badge number color', () => {
    assert.match(html, /\.cal-legend-badge \{ width: 5px; height: 5px; border-radius: 50%; background: var\(--carried-ink\); \}/);
    assert.match(html, /\.cal-legend-dot \{ width: 5px; height: 5px;/);
  });
  it('real per-day badges still count open tasks on past days', () => {
    assert.match(html, /badge\.className = 'cal-day-badge';\s*badge\.textContent = openCount > 9 \? '9\+' : String\(openCount\);/);
  });
});

describe('v1.18.2 Options list descriptions, Back, and spacing', () => {
  const popout = html.slice(html.indexOf('id="density-popout"'), html.indexOf('<!-- Behavior Tab Pane -->') + 20000);
  const DESC = {
    'card-layout': 'Density, complete button, tag spot', typography: 'Text size and font',
    layout: '<span class="phone-hide">Sidebar side, calendar legend, progress</span><span class="phone-only">Tablets and computers</span>', effects: 'Card glow, gradient header',
    background: 'Board pattern and strength', tags: 'Tag colors',
    general: 'Start desk, launch view, week start, weekends, full screen', tasks: 'Delete, carry-forward, collapse, confetti',
    projects: 'Long project notes', insights: 'Streak rules', holidays: 'US and custom holidays',
  };
  it('every summary row has a description instead of a value', () => {
    for (const [id, desc] of Object.entries(DESC)) {
      const row = popout.match(new RegExp(`<button type="button" class="options-row" data-options-open="${id}">[\\s\\S]*?</button>`))[0];
      assert.match(row, /<span class="options-row-text"><span class="options-row-name">/, id);
      assert.ok(row.includes(`<span class="options-row-desc">${desc}</span>`), id);
      assert.doesNotMatch(row, /options-row-value/, id);
    }
    assert.doesNotMatch(html, /data-options-value=/);
  });
  it('current settings move to the row tooltip', () => {
    const fn = fnSource('renderOptionsSummaries');
    assert.match(fn, /\.options-row\[data-options-open\]/);
    assert.match(fn, /row\.title = `Current: \$\{text\}`/);
  });
  it('every back link reads ‹ Back', () => {
    assert.equal((html.match(/data-options-back>‹ Back<\/button>/g) || []).length, 11);
    assert.doesNotMatch(html, /data-options-back>‹ (Appearance|Behavior)</);
  });
  it('settings after the first get a little space and a faint divider', () => {
    assert.match(html, /\.options-section > :is\(\.customize-select-row, \.customize-toggle, \.bg-pattern-controls, \.custom-holidays-section\):not\(\.options-section-head \+ \*\) \{\s*position: relative; margin-top: 9px;/);
    assert.match(html, /:not\(\.options-section-head \+ \*\)::before \{[^}]*top: -5px; height: 1px;/);
  });
  it('the main area scrolls on its own layer so dimmed completed cards do not wobble', () => {
    assert.match(html, /\.main \{[^}]*will-change: scroll-position;/);
  });
});

describe('v1.18.4 complete edge on project tasks', () => {
  const projectCard = fnSource('createProjectTaskCard');
  it('project task cards build the shared complete edge with a project toggle', () => {
    assert.match(fnSource('buildCompleteEdge'), /function buildCompleteEdge\(item, onToggle = \(\) => toggleItem\(item\.id\)\)/);
    assert.match(fnSource('buildCompleteEdge'), /if \(!moved\) onToggle\(\);/);
    assert.match(projectCard, /card\.className = 'project-item-card project-task-card';/);
    assert.match(projectCard, /buildCompleteEdge\(task, \(\) => \{\s*toggleProjectTaskComplete\(projectId, task\.id\);\s*renderProjectDetail\(\);/);
  });
  it('edge mode shows the edge and hides the project checkbox; Checkbox mode keeps it', () => {
    assert.match(html, /html\[data-complete-edge="on"\] :is\(\.task-card, \.project-task-card\) \.complete-edge \{\s*display: grid;/);
    assert.match(html, /html\[data-complete-edge="on"\] :is\(\.task-card, \.project-task-card\) \.complete-edge\.is-done \{ background: var\(--accent\); \}/);
    assert.match(html, /html\[data-complete-edge="on"\] \.project-task-check \{ display: none; \}/);
    assert.match(html, /html\[data-complete-edge="on"\] \.project-task-card \{ padding-left: 52px; \}/);
  });
  it('importing a projects backup keeps archived notes and tasks archived', () => {
    const validateImportData = new Function(`${['normalizeTag', 'normalizeTagList', 'tagsField', 'validateImportData'].map(fnSource).join('\n')}\nreturn validateImportData;`)();
    const out = validateImportData({ type: 'projects', projects: [{
      id: 'p1', name: 'P', createdAt: '2026-10-01T00:00:00Z',
      notes: [{ id: 'n1', content: 'old note', archived: true }, { id: 'n2', content: 'live note' }],
      tasks: [{ id: 't1', content: 'done', completed: true, archived: true }, { id: 't2', content: 'open' }],
    }] });
    const [p] = out.projects;
    assert.deepEqual(p.notes.map(n => [n.id, n.archived]), [['n1', true], ['n2', false]]);
    assert.deepEqual(p.tasks.map(t => [t.id, t.completed, t.archived]), [['t1', true, true], ['t2', false, false]]);
  });
  it('project header Rename and Delete are text buttons, not emoji', () => {
    assert.match(html, /<button id="project-rename-btn" class="project-action-btn project-text-btn" type="button" title="Rename project">Rename<\/button>/);
    assert.match(html, /<button id="project-delete-btn" class="project-action-btn project-text-btn project-delete-btn" type="button" title="Delete project">Delete<\/button>/);
    assert.doesNotMatch(html.slice(html.indexOf('<header class="project-header">'), html.indexOf('<div class="project-body">')), /✏️|🗑️/);
  });
  it('project list counts open tasks and active notes, archived separately', () => {
    const projectListMeta = new Function(`${fnSource('projectListMeta')}\nreturn projectListMeta;`)();
    assert.equal(projectListMeta({ notes: [], tasks: [] }), 'Empty');
    assert.equal(projectListMeta({
      notes: [{}, { archived: true }],
      tasks: [{}, {}, { completed: true, archived: true }, { completed: true }],
    }), '2 open tasks · 1 note');
    assert.equal(projectListMeta({ notes: [{ archived: true }], tasks: [{ completed: true, archived: true }] }), '2 archived');
    assert.equal(projectListMeta({ tasks: [{}] }), '1 open task');
  });
  it('reopening a finished project task un-archives it', () => {
    const run = new Function('state', 'saveProjectsData', `${['getProject', 'toggleProjectTaskComplete'].map(fnSource).join('\n')}\nreturn toggleProjectTaskComplete;`);
    const task = { id: 't1', completed: true, archived: true };
    const state = { projectsData: { projects: [{ id: 'p1', tasks: [task], notes: [] }] } };
    const toggle = run(state, () => {});
    toggle('p1', 't1');
    assert.deepEqual([task.completed, task.archived], [false, false]);
    toggle('p1', 't1');
    assert.deepEqual([task.completed, task.archived], [true, true]);
  });
  it('project comment actions are CSS-driven, always shown on touch', () => {
    assert.equal((mainScript.match(/commentRow\.className = 'project-comment-row';/g) || []).length, 1);
    assert.equal((mainScript.match(/actions\.className = 'project-comment-actions';/g) || []).length, 1);
    assert.doesNotMatch(mainScript, /commentRow\.addEventListener\('mouse(enter|leave)'|actions\.style\.opacity/);
    assert.match(html, /\.project-comment-row:hover \.project-comment-actions,\s*\.project-comment-actions:focus-within \{ opacity: 1; \}/);
    assert.match(html, /@media \(hover: none\), \(pointer: coarse\) \{\s*\.project-comment-actions \{ opacity: 1; \}\s*\}/);
  });
});

describe('v1.19.0 projects: search, send, tags', () => {
  const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  const plainTextPreview = (h, max = 60) => { const t = stripHtml(h); return t.length > max ? `${t.slice(0, max)}…` : t; };
  const helpers = ['escapeHtml', 'normalizeTag', 'normalizeTagList', 'generateProjectItemId', 'newId'];
  const commentHelpers = ['richCommentText', 'richCommentFields', 'projectCommentHtml'];
  const converters = () => new Function('plainTextPreview', 'sanitizeHtml', `${[...helpers, ...commentHelpers, 'deskItemToProjectItem', 'projectItemToDeskItem'].map(fnSource).join('\n')}\nreturn { deskItemToProjectItem, projectItemToDeskItem };`)(plainTextPreview, (h) => h);

  it('desk → project keeps type, done state, tags, and comment formatting with a plain copy', () => {
    const { deskItemToProjectItem } = converters();
    const out = deskItemToProjectItem({
      id: 'd1', type: 'task', content: '<b>Ship</b> it', completed: true, createdAt: '2026-10-01T00:00:00Z',
      tags: ['Ops', 'ops', 'x y'], comments: [{ id: 'c1', content: 'line one<br>line &lt;two&gt;', createdAt: '2026-10-02T00:00:00Z' }],
    });
    assert.notEqual(out.id, 'd1');
    assert.match(out.id, /^pi_/);
    assert.equal(out.content, '<b>Ship</b> it');
    assert.deepEqual([out.type, out.completed, out.archived], ['task', true, true]);
    assert.deepEqual(out.tags, ['ops', 'xy']);
    assert.deepEqual(out.comments, [{ id: 'c1', text: 'line one\nline <two>', html: 'line one<br>line &lt;two&gt;', createdAt: '2026-10-02T00:00:00Z' }]);
    const note = deskItemToProjectItem({ id: 'd2', type: 'note', content: 'n' });
    assert.equal('completed' in note, false);
    assert.equal('tags' in note, false);
    assert.deepEqual(note.comments, []);
  });

  it('project → desk lands as a fresh New task with HTML comments', () => {
    const { projectItemToDeskItem } = converters();
    const out = projectItemToDeskItem({
      id: 'pi_1', type: 'task', content: 'Call <i>vendor</i>', completed: false, archived: true,
      tags: ['q4'], comments: [{ id: 'c1', text: 'a <b>\nb', createdAt: '2026-10-02T00:00:00Z' }],
    });
    assert.notEqual(out.id, 'pi_1');
    assert.deepEqual([out.type, out.completed, out.shelved, out.boardColumn], ['task', false, false, 'new']);
    assert.equal('archived' in out, false);
    assert.deepEqual(out.tags, ['q4']);
    assert.deepEqual(out.comments, [{ id: 'c1', content: 'a &lt;b&gt;<br>b', createdAt: '2026-10-02T00:00:00Z' }]);
    const rich = projectItemToDeskItem({ type: 'task', content: 't', comments: [{ id: 'c2', text: 'bold\nitem', html: '<b>bold</b><ul><li>item</li></ul>' }] });
    assert.equal(rich.comments[0].content, '<b>bold</b><ul><li>item</li></ul>');
    const note = projectItemToDeskItem({ type: 'note', content: 'x', comments: [] });
    assert.equal('boardColumn' in note, false);
    assert.equal('comments' in note, false);
  });

  it('sending tombstones the original and Undo restores it', () => {
    const toProject = fnSource('sendDeskItemToProject');
    assert.match(toProject, /markItemDeleted\(itemId\);/);
    assert.match(toProject, /markProjectItemDeleted\(projItem\.id\)/);
    assert.match(toProject, /markItemRestored\(itemId, data\)/);
    const toDesk = fnSource('sendProjectItemToDesk');
    assert.match(toDesk, /markProjectItemDeleted\(itemId\)/);
    assert.match(toDesk, /todayKey\(\)/);
    assert.match(html, /addMenuItem\('Send to project…', \(\) => openSendToProject\(item\.id\)\)/);
  });

  it('deleted projects, notes, and tasks are dropped by sync merges', () => {
    const merge = new Function(`${['pruneDeletedIds', 'withoutDeletedProjectEntries', 'projectGroup', 'orderedProjects', 'sortByReference', 'mergeProjectsData'].map(fnSource).join('\n')}\nreturn mergeProjectsData;`)();
    const now = new Date().toISOString();
    const remote = { projects: [
      { id: 'p1', name: 'Gone', notes: [], tasks: [] },
      { id: 'p2', name: 'Kept', notes: [{ id: 'n1' }, { id: 'n2' }], tasks: [{ id: 't1' }] },
    ], deletedIds: {} };
    const local = { projects: [{ id: 'p2', name: 'Kept', notes: [{ id: 'n2' }], tasks: [{ id: 't1' }] }], deletedIds: { p1: now, n1: now } };
    const out = merge(local, remote);
    assert.deepEqual(out.projects.map(p => p.id), ['p2']);
    assert.deepEqual(out.projects[0].notes.map(n => n.id), ['n2']);
    assert.ok(out.deletedIds.p1);
  });

  it('deleting a project records a tombstone, and imports filter through tombstones', () => {
    assert.match(fnSource('deleteProject'), /markProjectItemDeleted\(projectId\)/);
    const apply = fnSource('applyProjectsImport');
    assert.match(apply, /withoutDeletedProjectEntries\(/);
    assert.match(fnSource('applyImport'), /applyProjectsImport\(/);
    assert.match(fnSource('applyImportAll'), /applyProjectsImport\(/);
  });

  it('typed #hashtags on project items become tags unless nothing else is left', () => {
    const isEmptyHtml = (h) => !stripHtml(h);
    const fn = new Function('isEmptyHtml', `${['normalizeTag', 'normalizeTagList', 'mergeTags', 'extractHashtags', 'projectContentWithTags'].map(fnSource).join('\n')}\nreturn projectContentWithTags;`)(isEmptyHtml);
    assert.deepEqual(fn('Call vendor #Ops'), { content: 'Call vendor', tags: ['ops'] });
    assert.deepEqual(fn('More #q4', ['ops']), { content: 'More', tags: ['ops', 'q4'] });
    assert.deepEqual(fn('#ops'), { content: '#ops' });
    assert.deepEqual(fn('plain', ['ops']), { content: 'plain', tags: ['ops'] });
  });

  const projectOrderFns = () => {
    const state = { projectsData: { deletedIds: {}, projects: [
      { id: 'a' }, { id: 'b', pinned: true }, { id: 'c' }, { id: 'd' },
    ] } };
    const fns = new Function('state', 'saveProjectsData', `${['getProject', 'findProjectItem', 'projectGroup', 'orderedProjects', 'projectGroupBounds', 'setProjectOrder', 'regroupProject', 'toggleProjectPinned', 'toggleProjectArchived', 'moveProjectTo', 'moveProjectItem', 'projectProgress'].map(fnSource).join('\n')}\nreturn { orderedProjects, toggleProjectPinned, toggleProjectArchived, moveProjectTo, moveProjectItem, projectProgress };`)(state, () => {});
    return { state, ids: () => state.projectsData.projects.map(p => p.id), ...fns };
  };

  it('pinned projects come first, each group keeping its order', () => {
    const { orderedProjects } = projectOrderFns();
    assert.deepEqual(orderedProjects([{ id: 'a' }, { id: 'b', pinned: true }, { id: 'c' }, { id: 'd', pinned: true }]).map(p => p.id), ['b', 'd', 'a', 'c']);
  });

  it('pinning moves a project to the very top; unpinning puts it just under the pins', () => {
    const { state, ids, toggleProjectPinned } = projectOrderFns();
    toggleProjectPinned('d');
    assert.deepEqual(ids(), ['d', 'b', 'a', 'c']);
    assert.ok(state.projectsData.orderUpdatedAt);
    assert.ok(state.projectsData.projects[0].updatedAt);
    toggleProjectPinned('d');
    assert.deepEqual(ids(), ['b', 'd', 'a', 'c']);
    assert.equal('pinned' in state.projectsData.projects[1], false);
  });

  it('moving a project stays within its pinned or unpinned group', () => {
    const { ids, moveProjectTo } = projectOrderFns();
    assert.equal(moveProjectTo('d', 1), true);
    assert.deepEqual(ids(), ['b', 'd', 'a', 'c']);
    assert.equal(moveProjectTo('d', 0), false, 'cannot jump above a pinned project');
    assert.equal(moveProjectTo('b', 3), false, 'a pinned project cannot drop below the pins');
    assert.equal(moveProjectTo('a', 99), true);
    assert.deepEqual(ids(), ['b', 'd', 'c', 'a']);
    assert.equal(moveProjectTo('missing', 0), false);
  });

  it('sync keeps the newer name/pin and the more recent reorder', () => {
    const merge = new Function(`${['pruneDeletedIds', 'withoutDeletedProjectEntries', 'projectGroup', 'orderedProjects', 'sortByReference', 'mergeProjectsData'].map(fnSource).join('\n')}\nreturn mergeProjectsData;`)();
    const p = (id, extra = {}) => ({ id, name: id.toUpperCase(), notes: [], tasks: [], ...extra });
    const local = { deletedIds: {}, orderUpdatedAt: '2026-10-20T10:00:00Z', projects: [
      p('a', { name: 'Old', updatedAt: '2026-10-19T00:00:00Z' }), p('b', { pinned: true, updatedAt: '2026-10-20T12:00:00Z' }), p('c'),
    ] };
    const remote = { deletedIds: {}, orderUpdatedAt: '2026-10-20T11:00:00Z', projects: [
      p('c'), p('a', { name: 'New', pinned: true, updatedAt: '2026-10-20T09:00:00Z' }), p('b', { updatedAt: '2026-10-20T08:00:00Z' }), p('r'),
    ] };
    const out = merge(local, remote);
    const byId = Object.fromEntries(out.projects.map(x => [x.id, x]));
    assert.equal(byId.a.name, 'New');
    assert.equal(byId.a.pinned, true);
    assert.equal(byId.b.pinned, true, 'local pin is newer than the remote unpin');
    assert.deepEqual(out.projects.map(x => x.id), ['a', 'b', 'c', 'r'], 'pins first, then the remote order');
    assert.equal(out.orderUpdatedAt, '2026-10-20T11:00:00Z');

    const older = merge({ ...local, orderUpdatedAt: '2026-10-20T12:00:00Z' }, remote);
    assert.deepEqual(older.projects.filter(x => !x.pinned).map(x => x.id), ['c', 'r']);
    assert.deepEqual(merge({ projects: [p('x'), p('y')] }, { projects: [p('y'), p('x')] }).projects.map(x => x.id), ['x', 'y'], 'no order stamps: local order stays');
  });

  it('archiving unpins a project and moves it to the top of the archived group; pinning brings it back', () => {
    const { state, ids, toggleProjectArchived, toggleProjectPinned, moveProjectTo, orderedProjects } = projectOrderFns();
    toggleProjectArchived('b');
    assert.deepEqual(ids(), ['a', 'c', 'd', 'b']);
    assert.equal(state.projectsData.projects[3].archived, true);
    assert.equal('pinned' in state.projectsData.projects[3], false);
    toggleProjectArchived('a');
    assert.deepEqual(ids(), ['c', 'd', 'a', 'b'], 'newly archived goes first among the archived');
    assert.equal(moveProjectTo('a', 1), false, 'cannot move above the archived group');
    assert.equal(moveProjectTo('a', 3), true);
    assert.deepEqual(ids(), ['c', 'd', 'b', 'a']);
    toggleProjectPinned('a');
    assert.deepEqual(ids(), ['a', 'c', 'd', 'b']);
    assert.equal('archived' in state.projectsData.projects[0], false);
    toggleProjectArchived('b');
    assert.deepEqual(orderedProjects(state.projectsData.projects).map(p => p.id), ['a', 'b', 'c', 'd'], 'unarchived goes to the top of the unpinned group');
  });

  it('notes and tasks reorder among the active ones; archived stay put', () => {
    const { state, moveProjectItem } = projectOrderFns();
    state.projectsData.projects[0].tasks = [
      { id: 't1', type: 'task' }, { id: 't2', type: 'task', archived: true }, { id: 't3', type: 'task' }, { id: 't4', type: 'task' },
    ];
    state.projectsData.projects[0].notes = [];
    assert.equal(moveProjectItem('a', 't4', 0), true);
    assert.deepEqual(state.projectsData.projects[0].tasks.map(t => t.id), ['t4', 't1', 't3', 't2']);
    assert.ok(state.projectsData.projects[0].itemOrderUpdatedAt);
    assert.equal(moveProjectItem('a', 't4', -5), false);
    assert.equal(moveProjectItem('a', 't2', 0), false, 'archived items do not move');
    assert.equal(moveProjectItem('a', 't1', 99), true);
    assert.deepEqual(state.projectsData.projects[0].tasks.filter(t => !t.archived).map(t => t.id), ['t4', 't3', 't1']);
  });

  it('progress counts every finished task, archived included', () => {
    const { projectProgress } = projectOrderFns();
    assert.deepEqual(projectProgress({ tasks: [{ completed: true, archived: true }, { completed: false }, {}] }), { done: 1, total: 3 });
    assert.deepEqual(projectProgress({}), { done: 0, total: 0 });
  });

  it('sync keeps the newer archive flag and the more recent note/task order per project', () => {
    const merge = new Function(`${['pruneDeletedIds', 'withoutDeletedProjectEntries', 'projectGroup', 'orderedProjects', 'sortByReference', 'mergeProjectsData'].map(fnSource).join('\n')}\nreturn mergeProjectsData;`)();
    const local = { deletedIds: {}, projects: [{ id: 'p', name: 'P', updatedAt: '2026-10-20T01:00:00Z', itemOrderUpdatedAt: '2026-10-20T01:00:00Z',
      notes: [], tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'local-only' }] }, { id: 'q', name: 'Q', notes: [], tasks: [] }] };
    const remote = { deletedIds: {}, projects: [{ id: 'p', name: 'P', archived: true, updatedAt: '2026-10-20T02:00:00Z', itemOrderUpdatedAt: '2026-10-20T02:00:00Z',
      notes: [], tasks: [{ id: 'c' }, { id: 'a' }, { id: 'b' }] }, { id: 'q', name: 'Q', notes: [], tasks: [] }] };
    const out = merge(local, remote);
    assert.deepEqual(out.projects.map(p => p.id), ['q', 'p'], 'archived projects sort last');
    const p = out.projects[1];
    assert.equal(p.archived, true);
    assert.deepEqual(p.tasks.map(t => t.id), ['c', 'a', 'b', 'local-only']);
    assert.equal(p.itemOrderUpdatedAt, '2026-10-20T02:00:00Z');
    const keep = merge(remote, local).projects.find(x => x.id === 'p');
    assert.deepEqual(keep.tasks.map(t => t.id).slice(0, 3), ['c', 'a', 'b'], 'older remote order does not win');
  });

  it('More menu, Markdown copy, and the day picker are wired up', () => {
    assert.match(html, /<button id="project-more-btn" class="project-action-btn project-text-btn" type="button" aria-haspopup="menu"/);
    const menu = fnSource('openProjectMoreMenu');
    for (const label of ['Copy as Markdown', "'Archive project'", "'Unarchive project'", "'Move up'", "'Move down'"]) assert.ok(menu.includes(label), label);
    assert.match(menu, /index <= lo\);/);
    assert.match(menu, /index >= hi\);/);
    const md = fnSource('projectToMarkdown');
    assert.match(md, /- \[ \] /);
    assert.match(md, /!t\.archived && !t\.completed/);
    assert.match(fnSource('openSendToDesk'), /\{ pickDate: true \}/);
    assert.match(fnSource('sendProjectItemToDesk'), /function sendProjectItemToDesk\(projectId, itemId, ctx, date = todayKey\(\)\)/);
    assert.match(fnSource('openSendToProject'), /\.filter\(p => !p\.archived\)/);
  });

  it('project imports keep pins and order stamps', () => {
    const validateImportData = new Function(`${['normalizeTag', 'normalizeTagList', 'tagsField', 'validateImportData'].map(fnSource).join('\n')}\nreturn validateImportData;`)();
    const out = validateImportData({ type: 'projects', projects: [
      { id: 'p1', name: 'P', pinned: true, updatedAt: '2026-10-20T00:00:00Z' }, { id: 'p2', name: 'Q', pinned: 'yes' },
    ] });
    assert.deepEqual([out.projects[0].pinned, out.projects[0].updatedAt], [true, '2026-10-20T00:00:00Z']);
    assert.equal('pinned' in out.projects[1], false);
    assert.match(fnSource('applyProjectsImport'), /projects: orderedProjects\(incoming\), deletedIds, orderUpdatedAt:/);
    assert.match(fnSource('loadProjectsData'), /if \(parsed\.orderUpdatedAt\) data\.orderUpdatedAt = parsed\.orderUpdatedAt;/);
    assert.match(fnSource('renameProject'), /project\.updatedAt = new Date\(\)\.toISOString\(\);/);
  });

  it('project imports keep tags', () => {
    const validateImportData = new Function(`${['normalizeTag', 'normalizeTagList', 'tagsField', 'validateImportData'].map(fnSource).join('\n')}\nreturn validateImportData;`)();
    const out = validateImportData({ type: 'projects', projects: [{
      id: 'p1', name: 'P', notes: [{ id: 'n1', content: 'a', tags: ['#Ops', 'ops'] }], tasks: [{ id: 't1', content: 'b', tags: 'bad' }],
    }] });
    assert.deepEqual(out.projects[0].notes[0].tags, ['ops']);
    assert.equal('tags' in out.projects[0].tasks[0], false);
  });

  it('project search matches content, comment text, and #tags', () => {
    const run = new Function('state', 'searchableText', 'plainTextPreview', `${['escapeHtml', 'normalizeTag', 'normalizeTagList', 'searchItemStatus', 'collectProjectSearchMatches'].map(fnSource).join('\n')}\nreturn collectProjectSearchMatches;`);
    const state = { projectsData: { projects: [{ id: 'p1', name: 'Launch', notes: [
      { id: 'n1', type: 'note', content: 'Vendor <b>call</b>', createdAt: '2026-10-05T10:00:00Z', tags: ['ops'] },
    ], tasks: [
      { id: 't1', type: 'task', content: 'Ship', completed: true, archived: true, createdAt: '2026-10-04T10:00:00Z', comments: [{ id: 'c1', text: 'vendor said yes' }] },
    ] }] } };
    const search = run(state, (h) => stripHtml(h).toLowerCase(), plainTextPreview);
    const find = (q) => { const r = []; search(q, r); return r; };
    const hits = find('vendor');
    assert.deepEqual(hits.map(r => [r.itemId, r.matchType]).sort(), [['n1', 'content'], ['t1', 'comment']]);
    const comment = hits.find(r => r.matchType === 'comment');
    assert.deepEqual([comment.listContext, comment.projectId, comment.projectName, comment.archived, comment.status, comment.date],
      ['projects', 'p1', 'Launch', true, 'done', '2026-10-04']);
    assert.deepEqual(find('#op').map(r => [r.itemId, r.matchType]), [['n1', 'tag']]);
    assert.deepEqual(find('#ops call').map(r => r.itemId), ['n1']);
    assert.deepEqual(find('#ops nope'), []);
  });

  it('All scope searches Work, Personal, and Projects; project results open the project', () => {
    const all = fnSource('searchAllDays');
    assert.match(all, /collectProjectSearchMatches\(q, results\)/);
    const ui = fnSource('syncSearchUi');
    assert.match(ui, /'All'/);
    assert.match(ui, /'Search Work, Personal & Projects…'/);
    assert.match(mainScript, /r\.projectId\s*\?\s*goToProjectSearchResult\(r\)/);
    const go = fnSource('goToProjectSearchResult');
    assert.match(go, /setListContext\('projects'/);
    assert.match(go, /state\.projectArchiveOpen\[state\.projectViewTab\] = true/);
    assert.match(go, /classList\.add\('search-highlight'\)/);
    assert.match(html, /\.project-item-card\.search-highlight/);
  });

  it('project tags: hashtags on save, add/remove helpers, shared tag box, counted in tag usage', () => {
    assert.match(fnSource('saveProjectItemContent'), /projectContentWithTags\(html, item\.tags\)/);
    assert.match(fnSource('addProjectNote'), /\.\.\.projectContentWithTags\(content \|\| ''\)/);
    assert.match(fnSource('addProjectTask'), /\.\.\.projectContentWithTags\(content \|\| ''\)/);
    assert.match(fnSource('appendProjectItemExtras'), /buildTagEntry\(/);
    assert.match(fnSource('appendProjectItemExtras'), /'to desk'/);
    assert.match(fnSource('collectTagUsage'), /projectsData/);
    assert.match(mainScript, /state\.projectTaggingId = null/);
  });
});

describe('v1.19.1 formatting in projects', () => {
  const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  const plainTextPreview = (h, max = 60) => { const t = stripHtml(h); return t.length > max ? `${t.slice(0, max)}…` : t; };
  const commentFns = (state, saves = { n: 0 }) => new Function('state', 'saveProjectsData', 'plainTextPreview', 'sanitizeHtml', 'renderProjectDetail',
    `${['escapeHtml', 'getProject', 'richCommentText', 'richCommentFields', 'projectCommentHtml', 'addProjectItemComment', 'updateProjectItemComment'].map(fnSource).join('\n')}
    return { projectCommentHtml, richCommentFields, addProjectItemComment, updateProjectItemComment };`)(state, () => { saves.n++; }, plainTextPreview, (h) => `[clean]${h}`, () => {});

  it('comments store HTML plus a plain copy; blank HTML is rejected', () => {
    const state = { projectsData: { projects: [{ id: 'p', notes: [], tasks: [{ id: 't', comments: [] }] }] } };
    const saves = { n: 0 };
    const { addProjectItemComment, updateProjectItemComment } = commentFns(state, saves);
    assert.equal(addProjectItemComment('p', 't', '<b> </b><br>'), false);
    assert.equal(addProjectItemComment('p', 't', ' <b>Ship</b> it<ul><li>one</li><li>two</li></ul> '), true);
    const c = state.projectsData.projects[0].tasks[0].comments[0];
    assert.deepEqual([c.text, c.html], ['Ship it\none\ntwo', '<b>Ship</b> it<ul><li>one</li><li>two</li></ul>']);
    assert.match(c.id, /^c_/);
    assert.equal(updateProjectItemComment('p', 't', c.id, '<i>later</i>'), true);
    const edited = state.projectsData.projects[0].tasks[0].comments[0];
    assert.deepEqual([edited.id, edited.text, edited.html, edited.createdAt], [c.id, 'later', '<i>later</i>', c.createdAt]);
    assert.equal(updateProjectItemComment('p', 't', c.id, '<br>'), false);
    assert.equal(saves.n, 2);
  });

  it('display uses sanitized HTML unless an older client changed the plain text', () => {
    const { projectCommentHtml } = commentFns({ projectsData: { projects: [] } });
    assert.equal(projectCommentHtml({ text: 'a <b>\nb' }), 'a &lt;b&gt;<br>b');
    assert.equal(projectCommentHtml({ text: 'bold', html: '<b>bold</b>' }), '[clean]<b>bold</b>');
    assert.equal(projectCommentHtml({ text: 'edited elsewhere', html: '<b>bold</b>' }), 'edited elsewhere');
    assert.equal(projectCommentHtml({ text: 'x', html: '' }), 'x');
    assert.equal(projectCommentHtml(undefined), '');
  });

  it('project note, task, and comment editors use the shared rich editor', () => {
    assert.match(fnSource('createProjectItemEditor'), /createRichEditor\(\{\s*className: 'project-item-editor'/);
    assert.match(fnSource('createProjectNoteCard'), /createProjectItemEditor\(note\.content,/);
    assert.match(fnSource('createProjectTaskCard'), /createProjectItemEditor\(task\.content,/);
    assert.match(fnSource('createProjectNoteCard'), /buildProjectCommentsList\(projectId, note\)/);
    assert.match(fnSource('createProjectTaskCard'), /buildProjectCommentsList\(projectId, task\)/);
    const list = fnSource('buildProjectCommentsList');
    assert.match(list, /createRichEditor\(\{\s*className: 'project-comment-editor',\s*initialHtml: projectCommentHtml\(comment\)/);
    assert.match(list, /body\.innerHTML = projectCommentHtml\(comment\);/);
    const add = fnSource('showProjectItemCommentEditor');
    assert.match(add, /createRichEditor\(/);
    assert.match(add, /addProjectItemComment\(projectId, itemId, getEditorHtml\(editor\)\)/);
    for (const name of ['createProjectNoteCard', 'createProjectTaskCard', 'buildProjectCommentsList', 'showProjectItemCommentEditor']) {
      assert.doesNotMatch(fnSource(name), /createElement\('textarea'\)|contentEditable = 'true'/, name);
    }
    assert.match(fnSource('projectToMarkdown'), /htmlToMarkdown\(projectCommentHtml\(c\)\)/);
    assert.match(html, /\.rich-editor\.project-item-editor \{/);
  });
});

describe('v1.20.0 sync efficiency, full history, storage warning', () => {
  const fns = (names, deps = {}) => new Function(...Object.keys(deps),
    `${names.map(fnSource).join('\n')}\nreturn { ${names.join(', ')} };`)(...Object.values(deps));
  const fakeStorage = (initial = {}) => {
    const map = new Map(Object.entries(initial));
    return {
      map,
      failNext: null,
      full: false,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem(k, v) {
        if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; }
        if (this.full) throw quotaError();
        map.set(k, String(v));
      },
      removeItem: (k) => map.delete(k),
      key: (i) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    };
  };
  const quotaError = () => Object.assign(new Error('quota'), { name: 'QuotaExceededError', code: 22 });

  it('the 12-month trim is gone from code and docs', () => {
    for (const name of ['RETENTION_MONTHS', 'maybeAutoArchive', 'getEligibleArchiveDayKeys', 'getRetentionCutoffKey']) {
      assert.doesNotMatch(html, new RegExp(name), `${name} should be removed`);
    }
    assert.doesNotMatch(html, /Auto-pruning/);
    assert.doesNotMatch(html, /older than 1 year/);
  });

  it('canonical fingerprint ignores key order but not values or array order', () => {
    const { canonicalJson, payloadFingerprint } = fns(['canonicalJson', 'hashString', 'payloadFingerprint']);
    const a = { work: { days: { '2026-10-21': { date: 'x', items: [{ id: 1, tags: ['a', 'b'] }] } }, deletedIds: {} }, prefs: { theme: 'dark', density: 1 } };
    const b = { prefs: { density: 1, theme: 'dark' }, work: { deletedIds: {}, days: { '2026-10-21': { items: [{ tags: ['a', 'b'], id: 1 }], date: 'x' } } } };
    assert.equal(canonicalJson(a), canonicalJson(b));
    assert.equal(payloadFingerprint(a), payloadFingerprint(b));
    assert.notEqual(payloadFingerprint(a), payloadFingerprint({ ...a, prefs: { theme: 'light', density: 1 } }));
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
    // undefined object values drop out like JSON.stringify; jsonb never stores them
    assert.equal(canonicalJson({ x: undefined, y: 1 }), canonicalJson({ y: 1 }));
    assert.equal(canonicalJson([undefined, null]), '[null,null]');
    assert.equal(canonicalJson('a"b'), JSON.stringify('a"b'));
    assert.match(payloadFingerprint(a), /^[0-9a-z]+-[0-9a-z]+$/);
  });

  it('sync mode: check when the cloud is unchanged, full when it changed, converge on open or after 4 hours', () => {
    const FULL_SYNC_MAX_AGE = 4 * 60 * 60 * 1000;
    const { syncMode } = fns(['syncMode'], { FULL_SYNC_MAX_AGE });
    const now = Date.parse('2026-10-21T12:00:00Z');
    const fresh = { remoteUpdatedAt: 'T1', fullSyncAt: new Date(now - 60 * 1000).toISOString() };
    assert.equal(syncMode({ meta: fresh, remoteUpdatedAt: 'T1', force: false, now }), 'check');
    assert.equal(syncMode({ meta: fresh, remoteUpdatedAt: 'T2', force: false, now }), 'full');
    assert.equal(syncMode({ meta: { ...fresh, remoteUpdatedAt: null }, remoteUpdatedAt: 'T1', force: false, now }), 'full');
    assert.equal(syncMode({ meta: fresh, remoteUpdatedAt: 'T1', force: true, now }), 'converge');
    assert.equal(syncMode({ meta: null, remoteUpdatedAt: 'T1', force: false, now }), 'converge');
    assert.equal(syncMode({ meta: { remoteUpdatedAt: 'T1' }, remoteUpdatedAt: 'T1', force: false, now }), 'converge');
    const old = { remoteUpdatedAt: 'T1', fullSyncAt: new Date(now - FULL_SYNC_MAX_AGE).toISOString() };
    assert.equal(syncMode({ meta: old, remoteUpdatedAt: 'T1', force: false, now }), 'converge');
    const almost = { remoteUpdatedAt: 'T1', fullSyncAt: new Date(now - FULL_SYNC_MAX_AGE + 1000).toISOString() };
    assert.equal(syncMode({ meta: almost, remoteUpdatedAt: 'T1', force: false, now }), 'check');
  });

  it('after a merge, uploads only new local data except on converge syncs, never when equal to the cloud', () => {
    const { shouldPushAfterMerge } = fns(['shouldPushAfterMerge']);
    assert.equal(shouldPushAfterMerge({ localHash: 'a', remoteHash: 'a', pushedHash: null, converge: true }), false);
    assert.equal(shouldPushAfterMerge({ localHash: 'a', remoteHash: 'b', pushedHash: 'a', converge: false }), false,
      'a tie this device already uploaded must not bounce back');
    assert.equal(shouldPushAfterMerge({ localHash: 'a', remoteHash: 'b', pushedHash: 'z', converge: false }), true);
    assert.equal(shouldPushAfterMerge({ localHash: 'a', remoteHash: 'b', pushedHash: 'a', converge: true }), true);
    assert.equal(shouldPushAfterMerge({ localHash: 'a', remoteHash: 'b', pushedHash: undefined, converge: false }), true);
  });

  it('the sync marker belongs to one account and survives bad JSON', () => {
    const localStorage = fakeStorage();
    const SB_SYNC_META_KEY = 'work-desk-sb-sync';
    const { readSyncMeta, writeSyncMeta, clearSyncMeta } = fns(['readSyncMeta', 'writeSyncMeta', 'clearSyncMeta'], { localStorage, SB_SYNC_META_KEY });
    assert.equal(readSyncMeta('u1'), null);
    writeSyncMeta({ userId: 'u1', remoteUpdatedAt: 'T1', pushedHash: 'h', fullSyncAt: 'x' });
    assert.equal(readSyncMeta('u1').remoteUpdatedAt, 'T1');
    assert.equal(readSyncMeta('u2'), null, "another account's marker counts as none");
    assert.equal(readSyncMeta(null), null);
    localStorage.map.set(SB_SYNC_META_KEY, '{oops');
    assert.equal(readSyncMeta('u1'), null);
    clearSyncMeta();
    assert.equal(localStorage.getItem(SB_SYNC_META_KEY), null);
    localStorage.failNext = quotaError();
    assert.doesNotThrow(() => writeSyncMeta({ userId: 'u1' }));
  });

  it('syncs and uploads run one at a time, and a failure does not block the next', async () => {
    const { runSyncExclusive } = new Function(`let syncQueue = Promise.resolve();\n${fnSource('runSyncExclusive')}\nreturn { runSyncExclusive };`)();
    const log = [];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const p1 = runSyncExclusive(async () => { log.push('a1'); await wait(20); log.push('a2'); });
    const p2 = runSyncExclusive(async () => { log.push('b1'); throw new Error('boom'); });
    const p3 = runSyncExclusive(async () => { log.push('c1'); return 'done'; });
    await p1;
    await assert.rejects(p2, /boom/);
    assert.equal(await p3, 'done');
    assert.deepEqual(log, ['a1', 'a2', 'b1', 'c1']);
  });

  it('sync engine: light check skips the download, pull errors stop the sync, uploads check the cloud first', () => {
    const sync = fnSource('sbSyncNow');
    const check = sync.slice(sync.indexOf("if (mode === 'check')"), sync.indexOf('const remote ='));
    assert.ok(sync.indexOf('sbPullUpdatedAt()') < sync.indexOf("if (mode === 'check')"));
    assert.doesNotMatch(check, /sbPullRow|sbPull\(/, 'no full download in check mode');
    assert.match(check, /sbPushIfChanged\(userId, meta\)/);
    assert.match(sync, /const remote = mode === 'empty' \? null : await sbPullRow\(\);/);
    assert.match(fnSource('sbPullRow'), /if \(error\) throw error;/);
    assert.match(fnSource('sbPullUpdatedAt'), /select\('updated_at'\)/);
    const upload = fnSource('sbUpload');
    assert.match(upload, /\.select\('updated_at'\)\.maybeSingle\(\)/);
    assert.match(upload, /writeSyncMeta\(\{ \.\.\.meta, remoteUpdatedAt: data\?\.updated_at \?\? null \}\)/);
    assert.match(fnSource('sbPushIfChanged'), /if \(hash === meta\?\.pushedHash\) return false;/);
    const push = fnSource('sbPush');
    assert.match(push, /runSyncExclusive\(/);
    assert.match(push, /head\.updatedAt !== meta\.remoteUpdatedAt\) \{\s*await sbSyncNow\(\{ silent: true \}\);/);
    assert.match(fnSource('sbPostAuthSync'), /runSyncExclusive\(\(\) => sbSyncNow\(options\)\)/);
    assert.equal((html.match(/hideAuthModal\(email\);\s*await sbPostAuthSync\(\{ force: true \}\);/g) || []).length, 2,
      'sign-in and sign-up force a full sync past the debounce');
  });

  it('sign-out clears the sync marker and any pending upload', () => {
    const at = html.indexOf('await sbClient.auth.signOut();');
    const after = html.slice(at, at + 300);
    assert.match(after, /clearTimeout\(sbSyncTimer\);/);
    assert.match(after, /clearSyncMeta\(\);/);
  });

  it('another tab saving desk or project data reloads this tab, other keys and unsaved copies are left alone', () => {
    const at = html.indexOf("window.addEventListener('storage'");
    const block = html.slice(at, html.indexOf('});', at));
    assert.match(block, /e\.storageArea !== localStorage \|\| !e\.key \|\| unsavedStorage\.has\(e\.key\)\) return;/);
    assert.match(block, /if \(e\.key === getStorageKey\(\)\) state\.data = loadData\(\);/);
    assert.match(block, /else if \(e\.key === PROJECTS_STORAGE_KEY\) state\.projectsData = loadProjectsData\(\);/);
    assert.match(block, /else return;/);
  });

  it('storage warning levels and banner text', () => {
    const STORAGE_BUDGET_CHARS = 5 * 1024 * 1024;
    const { storagePercent, storageWarningLevel, storageBannerText } = fns(['storagePercent', 'storageWarningLevel', 'storageBannerText'], { STORAGE_BUDGET_CHARS });
    assert.equal(storagePercent(STORAGE_BUDGET_CHARS / 2), 50);
    assert.equal(storagePercent(STORAGE_BUDGET_CHARS * 2), 100);
    assert.deepEqual([0, 49, 50, 79, 80, 100].map((p) => storageWarningLevel(p, false)), ['ok', 'ok', 'info', 'info', 'warn', 'warn']);
    assert.equal(storageWarningLevel(10, true), 'full');
    assert.match(storageBannerText('warn', 83, false), /83% full[\s\S]*only saved here[\s\S]*Export All[\s\S]*sign in/);
    assert.match(storageBannerText('warn', 83, true), /83% full[\s\S]*saved to the cloud/);
    assert.doesNotMatch(storageBannerText('warn', 83, true), /sign in/i);
    assert.match(storageBannerText('full', 100, false), /full[\s\S]*aren't being saved[\s\S]*Export All[\s\S]*sign in/);
    assert.match(storageBannerText('full', 100, true), /still syncs to the cloud/);
  });

  it('a full storage keeps the change in memory, reads prefer it, and it is written once space frees', () => {
    const localStorage = fakeStorage({ k: 'old' });
    const unsavedStorage = new Map();
    let warnings = 0;
    const api = new Function('localStorage', 'unsavedStorage', 'updateStorageWarningSpy', `
      let lastStorageCheck = Date.now();
      function updateStorageWarning({ retry = true } = {}) { if (retry) retryUnsavedStorage(); updateStorageWarningSpy(); }
      ${['isQuotaError', 'writeStorage', 'readStorage', 'retryUnsavedStorage'].map(fnSource).join('\n')}
      return { isQuotaError, writeStorage, readStorage, retryUnsavedStorage };
    `)(localStorage, unsavedStorage, () => { warnings++; });
    const realWarn = console.warn; console.warn = () => {};
    try {
      localStorage.full = true;
      assert.equal(api.writeStorage('k', 'new'), false);
      assert.equal(unsavedStorage.get('k'), 'new');
      assert.equal(api.readStorage('k'), 'new', 'reads see the unsaved copy');
      assert.equal(localStorage.getItem('k'), 'old');
      assert.ok(warnings >= 1);
      api.retryUnsavedStorage();
      assert.equal(unsavedStorage.get('k'), 'new', 'still pending while storage is full');
      localStorage.full = false;
      assert.equal(api.writeStorage('k', 'newer'), true);
      assert.equal(unsavedStorage.has('k'), false);
      assert.equal(localStorage.getItem('k'), 'newer');

      localStorage.full = true;
      api.writeStorage('r', 'pending');
      unsavedStorage.set('*', '');
      localStorage.full = false;
      api.retryUnsavedStorage();
      assert.equal(localStorage.getItem('r'), 'pending', 'retried once space is available');
      assert.equal(unsavedStorage.size, 0);

      localStorage.failNext = new TypeError('not quota');
      assert.throws(() => api.writeStorage('k', 'x'), TypeError);
      assert.ok(api.isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }));
      assert.ok(api.isQuotaError({ code: 22 }));
      assert.ok(!api.isQuotaError(null));
    } finally {
      console.warn = realWarn;
    }
  });

  it('the cloud payload and Export All include data that could not be saved locally', () => {
    const unsaved = new Map([['work-desk-data-work', JSON.stringify({ days: { d: { items: [{ id: 'mem' }] } }, deletedIds: {} })]]);
    const localStorage = fakeStorage({ 'work-desk-data-work': JSON.stringify({ days: {}, deletedIds: {} }), 'work-desk-projects': JSON.stringify({ projects: [{ id: 'p' }] }) });
    const readStorage = (k) => (unsaved.has(k) ? unsaved.get(k) : localStorage.getItem(k));
    const { buildSbPayload } = fns(['buildSbPayload'], { readStorage, readLocalPrefs: () => ({ theme: 'x' }), APP_VERSION: '1.20.0', PROJECTS_STORAGE_KEY: 'work-desk-projects' });
    const payload = buildSbPayload();
    assert.equal(payload.work.days.d.items[0].id, 'mem');
    assert.deepEqual(payload.personal, { days: {}, deletedIds: {} });
    assert.equal(payload.projects.projects[0].id, 'p');
    assert.deepEqual(payload.recurring.work, { templates: [] });
    assert.equal(payload.appVersion, '1.20.0');
    for (const name of ['loadData', 'loadProjectsData', 'loadRecurringData', 'repairData']) {
      assert.match(fnSource(name), /readStorage\(/, `${name} reads through readStorage`);
    }
  });

  it('every desk, project, and recurring save goes through writeStorage', () => {
    assert.doesNotMatch(mainScript, /localStorage\.setItem\((getStorageKey\((ctx|context|targetContext)?\)|PROJECTS_STORAGE_KEY|getRecurringKey|`work-desk-data-)/);
    for (const name of ['saveData', 'saveProjectsData', 'saveRecurringTemplates', 'markRecurringTemplateDeleted']) {
      assert.match(fnSource(name), /writeStorage\(/, name);
    }
    assert.equal((mainScript.match(/localStorage\.setItem\(SB_TS_KEY/g) || []).length, 1, 'stamp writes go through stampLocalChange');
    assert.match(fnSource('stampLocalChange'), /try \{ localStorage\.setItem\(SB_TS_KEY/);
  });

  it('background redraws: skipped when nothing changed, held while typing, forced on request', () => {
    const make = () => new Function(`
      let backgroundRenderDepth = 0, heldRender = false, pointerIsDown = false;
      let snapshot = 'a', typing = false, focused = true, renders = 0, renderedDuringTask = 0;
      const state = {};
      const document = { hasFocus: () => focused };
      function deskSnapshot() { return snapshot; }
      function isTypingOnDesk() { return typing; }
      function render() { if (backgroundRenderDepth > 0) { renderedDuringTask++; return; } heldRender = false; renders++; }
      ${['renderInBackground', 'flushHeldRender'].map(fnSource).join('\n')}
      return {
        renderInBackground, flushHeldRender, render,
        set: (o) => { if ('snapshot' in o) snapshot = o.snapshot; if ('typing' in o) typing = o.typing; if ('focused' in o) focused = o.focused; if ('pointer' in o) pointerIsDown = o.pointer; },
        get: () => ({ renders, heldRender, renderedDuringTask }),
      };
    `)();
    const r = make();
    assert.equal(r.renderInBackground(() => {}), false, 'unchanged desk: no redraw');
    assert.equal(r.get().renders, 0);
    assert.equal(r.renderInBackground(() => true), true, 'forced');
    assert.equal(r.renderInBackground(() => r.set({ snapshot: 'b' })), true, 'desk changed');
    assert.equal(r.get().renders, 2);

    r.set({ typing: true });
    assert.equal(r.renderInBackground(() => true), false, 'held while typing');
    assert.equal(r.get().heldRender, true);
    r.flushHeldRender();
    assert.equal(r.get().renders, 2, 'still typing');
    r.set({ typing: false, pointer: true });
    r.flushHeldRender();
    assert.equal(r.get().renders, 2, 'waits for the click to finish');
    r.set({ pointer: false, focused: false });
    r.flushHeldRender();
    assert.equal(r.get().renders, 2, 'not while the window is in the background');
    r.set({ focused: true });
    r.flushHeldRender();
    assert.deepEqual([r.get().renders, r.get().heldRender], [3, false]);
    r.flushHeldRender();
    assert.equal(r.get().renders, 3, 'nothing held, nothing to flush');

    // Day jobs call render() themselves; inside a background task those calls are absorbed
    assert.equal(r.renderInBackground(() => { r.render(); }), false);
    assert.deepEqual([r.get().renderedDuringTask, r.get().renders], [1, 3]);
  });

  it('render() defers inside background tasks; drafts cover comments, comment and task edits, and column add boxes', () => {
    assert.match(fnSource('render'), /if \(backgroundRenderDepth > 0\) return;\s*heldRender = false;\s*const draft = captureCommentDraft\(\);/);
    const capture = fnSource('captureCommentDraft');
    assert.match(capture, /querySelectorAll\('\.add-comment-form'\)/, 'every open comment box, not just the first');
    assert.match(capture, /state\.editingComment/);
    assert.match(capture, /state\.editingId[\s\S]*\.edit-input/);
    assert.match(capture, /state\.addingInColumn[\s\S]*\.col-inline-input/);
    assert.match(capture, /orphanCommentDrafts/);
    const restore = fnSource('restoreCommentDraft');
    assert.match(restore, /orphanCommentDrafts\.set\(add\.taskId, add\.html\)/);
    assert.match(restore, /placeCaret\(target, caret\)/);
    assert.match(restore, /setSelectionRange\(at, at\)/);
    assert.match(fnSource('isTypingOnDesk'), /els\.itemLists\.contains\(el\)/);
    assert.match(html, /document\.addEventListener\('pointerup', releasePointer, true\);/);
    assert.match(html, /document\.addEventListener\('focusout', \(\) => setTimeout\(flushHeldRender, 0\)\);/);
  });

  it('sync redraws go through renderInBackground; the light check does not reload the desk', () => {
    const sync = fnSource('sbSyncNow');
    assert.doesNotMatch(sync, /\n\s*render\(\);/, 'no direct render() in the sync');
    assert.equal((sync.match(/renderInBackground\(/g) || []).length, 3);
    const check = sync.slice(sync.indexOf("if (mode === 'check')"), sync.indexOf('const remote ='));
    assert.doesNotMatch(check, /loadData\(\)/);
    assert.match(sync, /if \(changed\) \{\s*state\.data = loadData\(\);\s*if \(!silent\) showToast\('Synced from cloud/);
    assert.match(sync, /return changed \|\| force;/);
    assert.match(html, /otherTabRenderTimer = setTimeout\(\(\) => renderInBackground\(\(\) => true\), 50\);/);
  });

  it('storage banner markup and wiring', () => {
    assert.match(html, /<div id="storage-banner" class="storage-banner hidden" role="alert"/);
    for (const id of ['storage-banner-text', 'storage-banner-export', 'storage-banner-signin', 'storage-banner-dismiss', 'storage-usage']) {
      assert.match(html, new RegExp(`id="${id}"`), id);
    }
    assert.match(html, /getElementById\('storage-banner-export'\)\.addEventListener\('click', exportAll\)/);
    assert.match(html, /getElementById\('storage-banner-signin'\)\.addEventListener\('click', openSignInFromDesk\)/);
    assert.match(fnSource('updateStorageWarning'), /const signingIn = !document\.getElementById\('auth-modal'\)/, 'the banner never covers the sign-in dialog');
    assert.match(fnSource('showAuthModal'), /classList\.remove\('hidden'\);\s*updateStorageWarning\(\);/);
    assert.match(fnSource('openSignInFromDesk'), /classList\.remove\('hidden'\);\s*updateStorageWarning\(\);/);
    assert.match(html, /sessionStorage\.setItem\(STORAGE_BANNER_DISMISSED_KEY, storageBanner\.dataset\.dismissKey/);
    assert.match(fnSource('updateAccountChrome'), /updateStorageWarning\(\);[\s\S]*updateStorageWarning\(\);/);
    assert.match(fnSource('openAccountMenu'), /updateStorageWarning\(\);/);
    const script = extractMainScript(html);
    assert.ok(script.indexOf('const unsavedStorage = new Map()') < script.indexOf('const state ='),
      'storage globals must exist before state init, since loading data can write');
  });
});

describe('v1.21.0 new themes and Shades of accent', () => {
  const themes = new Function(`return ${html.match(/const THEMES = (\[[\s\S]*?\n    \]);/)[1]}`)();
  const byId = Object.fromEntries(themes.map((t) => [t.id, t]));
  const NEW_LIGHT = ['gruvbox-light', 'rose-pine-dawn', 'everforest-light'];
  const NEW_DARK = ['kanagawa', 'monokai-pro', 'everforest-dark'];
  const cssBlock = (id) => [...html.matchAll(new RegExp(`\\[data-theme="${id}"\\] \\{([^}]*)\\}`, 'g'))]
    .find((m) => /--accent:/.test(m[1]));
  const cssVar = (block, name) => (block.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1];
  const firstHex = (s) => (s && (s.match(/#[0-9a-f]{6}\b/i) || [])[0]?.toLowerCase()) || null;
  const shared = html.match(/Shared semantics for all non-default dark themes[\s\S]*?\{/)[0];
  const palettes = new Function(`${mainScript.match(/const THEME_TAG_PALETTES = \{[\s\S]*?\n    \};/)[0]}\nreturn THEME_TAG_PALETTES;`)();
  const shadeLib = () => new Function(`
    const TAG_SHADE_COUNT = 8;
    const TAG_SHADE_MIN_GAP = 0.07;
    ${['hexToRgb', 'rgbToHex', 'mixHex', 'srgbToLinear', 'hexToOklab', 'hexToOklch', 'oklabToLinearRgb', 'oklchToHex',
      'relativeLuminance', 'contrastRatio', 'tagShadeDistance', 'readableTagColor', 'pickTagShadeSecond', 'minTagShadeGap',
      'spreadTagShades', 'buildTagShades'].map(fnSource).join('\n')}
    return { hexToOklch, oklchToHex, contrastRatio, mixHex, tagShadeDistance, pickTagShadeSecond, minTagShadeGap, buildTagShades };
  `)();
  // The inputs refreshTagShades reads from a theme, taken from its CSS block (text falls back to the shared defaults)
  const SECOND_VARS = JSON.parse(mainScript.match(/const TAG_SHADE_SECOND_VARS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  const themeInputs = (id) => {
    const block = cssBlock(id)?.[1];
    if (!block) return null;
    const dark = byId[id].dark || byId[id].medium;
    return {
      accent: firstHex(cssVar(block, '--accent')),
      surface: firstHex(cssVar(block, '--surface')),
      text: firstHex(cssVar(block, '--text')) || (dark ? '#e8ecf3' : '#1a1f2e'),
      seconds: SECOND_VARS.map((v) => firstHex(cssVar(block, v))).filter(Boolean),
    };
  };
  const shadesFor = (lib, id) => {
    const t = themeInputs(id);
    const palette = palettes[id] || null;
    return lib.buildTagShades({ ...t, palette, second: palette ? null : lib.pickTagShadeSecond(t.accent, t.seconds) });
  };

  it('new themes sit in the right tier with a full CSS block, matching swatch accent, and favicon', () => {
    const favicons = html.match(/const FAVICONS = \{[\s\S]*?\n\s*\};/)[0];
    for (const id of NEW_LIGHT) assert.ok(byId[id] && !byId[id].dark && !byId[id].medium, `${id} should be light`);
    for (const id of NEW_DARK) assert.ok(byId[id] && byId[id].dark === true, `${id} should be dark`);
    for (const id of [...NEW_LIGHT, ...NEW_DARK]) {
      const block = cssBlock(id)?.[1];
      assert.ok(block, `CSS block for ${id} missing`);
      for (const v of ['--bg', '--surface', '--sidebar', '--accent', '--text', '--border', '--text-muted']) {
        assert.match(block, new RegExp(`${v}:\\s*#`), `${id} missing ${v}`);
      }
      assert.equal(firstHex(cssVar(block, '--accent')), byId[id].accent.toLowerCase(), `${id} swatch accent drifted from CSS`);
      assert.match(favicons, new RegExp(`(^|\\s)'?${id}'?:`, 'm'), `${id} missing from FAVICONS`);
    }
    for (const id of NEW_LIGHT) assert.match(cssBlock(id)[1], /color-scheme:\s*light/, id);
    for (const id of NEW_DARK) assert.ok(shared.includes(`[data-theme="${id}"]`), `${id} not in shared dark list`);
    assert.deepEqual(NEW_LIGHT.concat(NEW_DARK).map((id) => byId[id].name),
      ['Gruvbox Light', 'Rosé Pine Dawn', 'Everforest', 'Kanagawa', 'Monokai Pro', 'Everforest']);
  });

  it('new themes keep body text readable and use dark text on light accent buttons', () => {
    const lib = shadeLib();
    for (const id of [...NEW_LIGHT, ...NEW_DARK]) {
      const block = cssBlock(id)[1];
      const [surface, text, muted] = ['--surface', '--text', '--text-muted'].map((v) => firstHex(cssVar(block, v)));
      assert.ok(lib.contrastRatio(text, surface) >= 4.5, `${id} text contrast`);
      assert.ok(lib.contrastRatio(muted, surface) >= 3, `${id} muted text contrast`);
    }
    for (const id of ['kanagawa', 'monokai-pro', 'everforest-dark', 'everforest-light']) {
      assert.match(html, new RegExp(`\\[data-theme="${id}"\\] \\.add-btn`), `${id} add-btn text override missing`);
    }
  });

  it('theme palettes: real themes, 8 colors each, starting with the theme accent', () => {
    const ids = Object.keys(palettes);
    assert.ok(ids.length >= 19);
    for (const id of ['monokai', 'monokai-pro', 'dracula', 'nord', 'solarized-dark', 'gruvbox-dark', 'gruvbox-light', 'catppuccin',
      'one-dark', 'rose-pine', 'rose-pine-dawn', 'tokyo-storm', 'kanagawa', 'everforest-dark', 'everforest-light', 'mediterranean']) {
      assert.ok(ids.includes(id), `${id} should have a palette`);
    }
    for (const [id, colors] of Object.entries(palettes)) {
      assert.ok(byId[id], `${id} is not a theme`);
      assert.equal(colors.length, 8, id);
      for (const c of colors) assert.match(c, /^#[0-9a-f]{6}$/, `${id} ${c}`);
      assert.equal(new Set(colors).size, 8, `${id} repeats a color`);
      assert.equal(colors[0], byId[id].accent.toLowerCase(), `${id} palette should start with its accent`);
    }
  });

  it('OKLCH round-trips and clips out-of-gamut colors into sRGB', () => {
    const lib = shadeLib();
    for (const hex of ['#c8553d', '#0d9488', '#f92672', '#000000', '#ffffff', '#7aa2f7']) {
      const { l, c, h } = lib.hexToOklch(hex);
      const back = lib.oklchToHex(l, c, h);
      const diff = [1, 3, 5].map((i) => Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)));
      assert.ok(Math.max(...diff) <= 1, `${hex} → ${back}`);
    }
    assert.match(lib.oklchToHex(0.7, 0.5, 140), /^#[0-9a-f]{6}$/, 'impossible chroma still yields a valid color');
  });

  it('every theme gets 8 readable shades; generated ones keep the six most-used clearly apart', () => {
    const lib = shadeLib();
    let generated = 0;
    for (const t of themes) {
      if (!t.id || !themeInputs(t.id)?.accent) continue;
      const shades = shadesFor(lib, t.id);
      const { surface } = themeInputs(t.id);
      assert.equal(shades.length, 8, t.id);
      for (const s of shades) {
        assert.match(s, /^#[0-9a-f]{6}$/, `${t.id} ${s}`);
        assert.ok(lib.contrastRatio(s, lib.mixHex(s, surface, 82)) >= 1.95, `${t.id}: ${s} unreadable on its pill`);
      }
      const gap = lib.minTagShadeGap(shades.slice(0, 6));
      if (palettes[t.id]) assert.ok(gap >= 0.06, `${t.id} palette: top colors too close (${gap.toFixed(3)})`);
      else { generated++; assert.ok(gap >= 0.069, `${t.id}: top colors too close (${gap.toFixed(3)})`); }
    }
    assert.ok(generated > 60, 'most themes use generated shades');
  });

  it('the reported themes now get clearly different shades, and Monokai uses its own colors', () => {
    const lib = shadeLib();
    for (const id of ['mediterranean', 'seafoam', 'graphite', 'plum', 'plum-mid']) {
      assert.ok(lib.minTagShadeGap(shadesFor(lib, id).slice(0, 4)) >= 0.08, `${id} top four`);
    }
    const monokai = shadesFor(lib, 'monokai');
    for (const c of ['#a6e22e', '#66d9ef', '#fd971f', '#ae81ff']) assert.ok(monokai.includes(c), `Monokai missing ${c}`);
    assert.equal(monokai[0], '#f92672', 'the accent itself is not altered when it already reads');
  });

  it('two-tone uses the theme\'s second color, or 120° around the wheel for one-hue themes', () => {
    const lib = shadeLib();
    assert.equal(lib.pickTagShadeSecond('#c8553d', ['#e07a5f', '#5a76a0', '#13315c']), '#5a76a0', 'skips same-hue and takes the first different hue');
    assert.equal(lib.pickTagShadeSecond('#0d9488', ['#2dd4bf', '#4f8580', '#eef8f6']), null, 'one-hue theme has no second color');
    const shades = lib.buildTagShades({ accent: '#0d9488', surface: '#ffffff', text: '#0f2a28' });
    const hueGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
    const accentHue = lib.hexToOklch('#0d9488').h;
    assert.ok(shades.some((s) => hueGap(lib.hexToOklch(s).h, accentHue) >= 60), 'shades reach well past the accent hue');
    assert.equal(shades[0], '#0d9488');
  });

  it('readable colors are darkened on light themes and lightened on dark ones, capped at the accent\'s own contrast', () => {
    const lib = shadeLib();
    const onLight = lib.buildTagShades({ accent: '#c8553d', surface: '#fffdf8', text: '#1b2433', palette: ['#c8553d', '#ffe066'] });
    assert.ok(lib.hexToOklch(onLight[1]).l < lib.hexToOklch('#ffe066').l, 'pale yellow is darkened on a light theme');
    const onDark = lib.buildTagShades({ accent: '#f92672', surface: '#3e3d32', text: '#f8f8f2', palette: ['#f92672', '#31748f'] });
    assert.ok(lib.hexToOklch(onDark[1]).l > lib.hexToOklch('#31748f').l, 'deep teal is lightened on a dark theme');
    assert.match(fnSource('buildTagShades'), /Math\.max\(2, Math\.min\(3, contrastRatio\(accent, mixHex\(accent, surface, 82\)\)\)\)/);
  });

  describe('slot assignment', () => {
    const slotFns = (initial = {}, usage = []) => new Function('initial', 'usage', `
      const TAG_SHADE_COUNT = 8;
      const TAG_SHADE_SLOTS_KEY = 'work-desk-tag-shade-slots';
      const store = { [TAG_SHADE_SLOTS_KEY]: JSON.stringify(initial) };
      const localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
      let usageScans = 0, chipRefreshes = 0, prefsStamps = 0;
      const collectTagUsage = () => { usageScans++; return usage.map((tag) => ({ tag })); };
      const refreshTagChipColors = () => { chipRefreshes++; };
      const schedulePrefsPush = () => { prefsStamps++; };
      const touchPrefsUpdatedAt = () => { prefsStamps++; };
      const sbSynced = false;
      const sbSchedulePush = () => {};
      ${['normalizeTag', 'normalizeTagShadeSlots', 'loadTagShadeSlots', 'sameTagShadeSlots', 'nextTagShadeSlot',
        'assignTagShadeSlots', 'reconcileTagShadeSlots', 'tagShadeSlot', 'storeTagShadeSlots', 'mergeRemoteTagShadeSlots'].map(fnSource).join('\n')}
      let liveShadeTags = null;
      const state = { tagShadeSlots: loadTagShadeSlots() };
      return { state, store, tagShadeSlot, assignTagShadeSlots, nextTagShadeSlot, mergeRemoteTagShadeSlots, normalizeTagShadeSlots,
        counts: () => ({ usageScans, chipRefreshes, prefsStamps }) };
    `)(initial, usage);

    it('fresh assignment follows usage: most-used tag gets the accent, then the most distinct colors', () => {
      const f = slotFns();
      const tags = ['ace', 'ids', 'oms', 'p1', 'bug', 'ops', 'kt', 'aic', 'psql'];
      const slots = f.assignTagShadeSlots({}, tags);
      assert.deepEqual(tags.map((t) => slots[t]), [0, 1, 2, 3, 4, 5, 6, 7, 0], 'ninth tag shares the least-used color');
    });

    it('existing assignments never move; new tags take the least-used color among tags still in use', () => {
      const f = slotFns();
      const current = { ace: 0, ids: 1, oms: 2, old: 3 };
      const next = f.assignTagShadeSlots(current, ['oms', 'ace', 'ids', 'new1', 'new2']);
      assert.equal(next.ace, 0);
      assert.equal(next.oms, 2);
      assert.equal(next.new1, 3, 'a retired tag does not hold its color hostage');
      assert.equal(next.new2, 4);
      assert.equal(next.old, 3, 'retired tags keep their slot in case they come back');
      assert.equal(f.nextTagShadeSlot({ a: 0, b: 0, c: 1 }, ['a', 'b', 'c']), 2);
    });

    it('tagShadeSlot ranks all tags once per session, then hands out slots lazily without stamping prefs', () => {
      const f = slotFns({}, ['ace', 'ids', 'oms']);
      assert.equal(f.tagShadeSlot('oms'), 2, 'the first lookup ranks every tag by use');
      assert.equal(f.tagShadeSlot('ace'), 0);
      assert.equal(f.tagShadeSlot('brand-new'), 3);
      assert.equal(f.tagShadeSlot('brand-new'), 3, 'stable');
      assert.equal(f.counts().usageScans, 1, 'usage is scanned once');
      assert.deepEqual(JSON.parse(f.store['work-desk-tag-shade-slots']), { ace: 0, ids: 1, oms: 2, 'brand-new': 3 });
      assert.equal(f.counts().prefsStamps, 0, 'slot assignments must not bump the prefs timestamp');
    });

    it('a remote device\'s assignment wins per tag, local-only tags are kept, junk is dropped', () => {
      const f = slotFns({ ace: 0, mine: 5, shared: 2 });
      assert.equal(f.mergeRemoteTagShadeSlots({ shared: 4, theirs: 1, bad: 9, '#UP': 3, x: 'two' }), true);
      assert.deepEqual(f.state.tagShadeSlots, { ace: 0, mine: 5, shared: 4, theirs: 1, up: 3 });
      assert.equal(f.counts().chipRefreshes, 1);
      assert.equal(f.mergeRemoteTagShadeSlots({ shared: 4 }), false, 'nothing new → no redraw');
      assert.equal(f.mergeRemoteTagShadeSlots(undefined), false);
      assert.equal(f.counts().chipRefreshes, 1);
    });

    it('corrupt stored slots load as empty', () => {
      const f = slotFns();
      assert.deepEqual(f.normalizeTagShadeSlots('nope'), {});
      assert.deepEqual(f.normalizeTagShadeSlots([1, 2]), {});
    });
  });

  it('slots sync with prefs: included in uploads, merged before the timestamp check', () => {
    assert.match(fnSource('readLocalPrefs'), /tagShadeSlots: loadTagShadeSlots\(\)/);
    const apply = fnSource('applyCloudPrefs');
    assert.ok(apply.indexOf('mergeRemoteTagShadeSlots(prefs.tagShadeSlots)') < apply.indexOf('if (!force)'),
      'merged even when the remote prefs are not newer');
    assert.match(fnSource('storeTagShadeSlots'), /setTimeout\(\(\) => \{ if \(sbSynced\) sbSchedulePush\(\); \}, 0\)/);
    assert.doesNotMatch(fnSource('storeTagShadeSlots'), /schedulePrefsPush|touchPrefsUpdatedAt/);
    assert.match(mainScript, /tagShadeSlots: loadTagShadeSlots\(\),\n\s*completeStyle:/, 'state starts from saved slots');
  });

  it('shades are recomputed for the current theme and written to one style element', () => {
    const refresh = fnSource('refreshTagShades');
    assert.match(refresh, /if \(mode !== 'analogous' && mode !== 'palette'\) return;/);
    assert.match(refresh, /const key = \[mode, themeId,/, 'switching modes recomputes');
    assert.match(refresh, /mode === 'analogous'\s*\? buildAccentShades\(\{ accent, surface, text, neutrals \}\)\s*: buildTagShades\(/);
    assert.match(refresh, /THEME_TAG_PALETTES\[themeId\]/);
    assert.match(refresh, /if \(key === tagShadeKey\) return;/);
    assert.match(refresh, /style\.id = 'tag-shade-vars'/);
    assert.match(refresh, /--tag-shade-\$\{i\}/);
    assert.match(fnSource('initTagShades'), /attributeFilter: \['data-theme', 'style', 'data-tag-colors'\]/);
    assert.match(mainScript, /applyTagColorMode\(state\.tagColorMode, \{ fromSync: true \}\);\s*initTagShades\(\);/);
  });

  it('three new Medium themes balance the tiers and read well', () => {
    const lib = shadeLib();
    const favicons = html.match(/const FAVICONS = \{[\s\S]*?\n\s*\};/)[0];
    const NEW_MEDIUM = { 'catppuccin-frappe': 'Catppuccin Frappé', 'gruvbox-mid': 'Gruvbox Mid', 'solarized-mid': 'Solarized Mid' };
    for (const [id, name] of Object.entries(NEW_MEDIUM)) {
      assert.ok(byId[id]?.medium === true && !byId[id].dark, `${id} should be medium`);
      assert.equal(byId[id].name, name);
      const block = cssBlock(id)?.[1];
      assert.ok(block, `CSS block for ${id} missing`);
      assert.match(block, /color-scheme:\s*dark/);
      assert.equal(firstHex(cssVar(block, '--accent')), byId[id].accent.toLowerCase(), `${id} swatch accent drifted from CSS`);
      assert.equal(firstHex(cssVar(block, '--surface')), byId[id].surface.toLowerCase(), `${id} swatch surface drifted from CSS`);
      const [surface, text, muted] = ['--surface', '--text', '--text-muted'].map((v) => firstHex(cssVar(block, v)));
      assert.ok(lib.contrastRatio(text, surface) >= 4.5, `${id} text contrast`);
      assert.ok(lib.contrastRatio(muted, surface) >= 3, `${id} muted text contrast`);
      assert.match(favicons, new RegExp(`'${id}':`), `${id} missing from FAVICONS`);
      assert.match(html, new RegExp(`\\[data-theme="${id}"\\] \\.add-btn`), `${id} add-btn text override missing`);
      assert.ok(palettes[id], `${id} should use its family's colors in Shades of accent`);
      assert.ok(!shared.includes(`[data-theme="${id}"]`), `${id} is medium, not in the shared dark list`);
    }
  });

  it('one more theme per tier (Catppuccin Latte, Rosewood, Rosé Pine Moon) sits in the right tier and reads well', () => {
    const lib = shadeLib();
    const favicons = html.match(/const FAVICONS = \{[\s\S]*?\n\s*\};/)[0];
    const ADDED = [
      ['catppuccin-latte', 'Catppuccin Latte', 'light'],
      ['rosewood', 'Rosewood', 'medium'],
      ['rose-pine-moon', 'Rosé Pine Moon', 'dark'],
    ];
    for (const [id, name, tier] of ADDED) {
      const t = byId[id];
      assert.ok(t, `${id} missing from THEMES`);
      assert.equal(t.name, name);
      assert.equal(tier === 'dark' ? t.dark : tier === 'medium' ? t.medium === true && !t.dark : !t.dark && !t.medium, true, `${id} tier`);
      const block = cssBlock(id)?.[1];
      assert.ok(block, `CSS block for ${id} missing`);
      assert.equal(firstHex(cssVar(block, '--accent')), t.accent.toLowerCase(), `${id} swatch accent drifted from CSS`);
      assert.equal(firstHex(cssVar(block, '--surface')), t.surface.toLowerCase(), `${id} swatch surface drifted from CSS`);
      const [surface, text, muted] = ['--surface', '--text', '--text-muted'].map((v) => firstHex(cssVar(block, v)));
      assert.ok(lib.contrastRatio(text, surface) >= 4.5, `${id} text contrast`);
      assert.ok(lib.contrastRatio(muted, surface) >= 3, `${id} muted text contrast`);
      assert.match(favicons, new RegExp(`(^|\\s)'?${id}'?:`, 'm'), `${id} missing from FAVICONS`);
    }
    assert.match(cssBlock('catppuccin-latte')[1], /color-scheme:\s*light/);
    assert.match(cssBlock('rosewood')[1], /color-scheme:\s*dark/);
    assert.ok(shared.includes('[data-theme="rose-pine-moon"]'), 'Rosé Pine Moon gets the shared dark semantics');
    for (const id of ['rosewood', 'rose-pine-moon']) {
      assert.match(html, new RegExp(`\\[data-theme="${id}"\\] \\.add-btn`), `${id} add-btn text override missing`);
    }
    assert.ok(palettes['catppuccin-latte'] && palettes['rose-pine-moon'], 'Latte and Moon use their own color sets');
  });
});

describe('v1.21.0 recurring schedules and Ctrl+Enter edits', () => {
  const consts = ['DAY_LABELS', 'MONTH_SHORT'].map((n) => mainScript.match(new RegExp(`const ${n} = \\[[^\\]]*\\];`))[0]).join('\n');
  const lib = new Function(`
    ${consts}
    ${['ordinal', 'joinAnd', 'sortLastAtEnd', 'quarterMonths', 'recurringMonthlyWhen', 'recurringRuleLabel', 'recurringDueOn']
      .map(fnSource).join('\n')}
    const RECURRING_SCHEDULE_KEYS = ${mainScript.match(/const RECURRING_SCHEDULE_KEYS = (\[[^\]]*\]);/)[1]};
    ${fnSource('withRecurringSchedule')}
    return { ordinal, recurringRuleLabel, recurringDueOn, withRecurringSchedule };
  `)();
  const dueDates = (t, from, to) => {
    const out = [];
    for (let d = new Date(`${from}T12:00:00`); d <= new Date(`${to}T12:00:00`); d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (lib.recurringDueOn(t, key)) out.push(key);
    }
    return out;
  };

  it('existing rules keep their schedule', () => {
    assert.deepEqual(dueDates({ rule: 'weekly', days: [4] }, '2026-10-01', '2026-10-31'),
      ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
    assert.equal(dueDates({ rule: 'weekdays' }, '2026-10-19', '2026-10-25').length, 5);
    assert.equal(dueDates({ rule: 'daily' }, '2026-10-19', '2026-10-25').length, 7);
    assert.deepEqual(dueDates({ rule: 'custom', days: [1, 3] }, '2026-10-19', '2026-10-25'), ['2026-10-19', '2026-10-21']);
    assert.equal(lib.recurringDueOn({ rule: 'mystery' }, '2026-10-22'), false);
  });

  it('every 2 weeks counts from its start date, never before it', () => {
    const t = { rule: 'biweekly', startDate: '2026-10-06', days: [2] };
    assert.deepEqual(dueDates(t, '2026-09-01', '2026-11-30'), ['2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17']);
    assert.deepEqual(dueDates(t, '2027-03-01', '2027-03-31').length, 2, 'stays on track across the DST change');
    assert.equal(lib.recurringDueOn({ rule: 'biweekly' }, '2026-10-06'), false, 'no start date, never due');
  });

  it('monthly by weekday: 3rd Thursday (Laura), 1st and 3rd Tuesday (twice a month), last Friday', () => {
    const laura = { rule: 'monthly', monthBy: 'weekday', weeks: [3], days: [4] };
    assert.deepEqual(dueDates(laura, '2026-10-01', '2026-12-31'), ['2026-10-15', '2026-11-19', '2026-12-17']);
    const sara = { rule: 'monthly', monthBy: 'weekday', weeks: [1, 3], days: [2] };
    assert.deepEqual(dueDates(sara, '2026-10-01', '2026-11-30'), ['2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17']);
    const lastFri = { rule: 'monthly', monthBy: 'weekday', weeks: [-1], days: [5] };
    assert.deepEqual(dueDates(lastFri, '2026-10-01', '2026-11-30'), ['2026-10-30', '2026-11-27']);
    const fourthAndLast = { rule: 'monthly', monthBy: 'weekday', weeks: [4, -1], days: [4] };
    assert.deepEqual(dueDates(fourthAndLast, '2026-10-01', '2026-10-31'), ['2026-10-22', '2026-10-29']);
  });

  it('monthly by date: 1st and 15th (twice a month), and the 31st or Last falls on short months\' last day', () => {
    const twice = { rule: 'monthly', monthBy: 'date', monthDays: [1, 15] };
    assert.deepEqual(dueDates(twice, '2026-10-01', '2026-11-30'), ['2026-10-01', '2026-10-15', '2026-11-01', '2026-11-15']);
    assert.deepEqual(dueDates({ rule: 'monthly', monthDays: [31] }, '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30']);
    assert.deepEqual(dueDates({ rule: 'monthly', monthDays: [-1] }, '2028-02-01', '2028-03-31'), ['2028-02-29', '2028-03-31'], 'leap year');
    assert.deepEqual(dueDates({ rule: 'monthly', monthDays: [30, 31] }, '2026-02-01', '2026-02-28'), ['2026-02-28'], 'only once a day');
  });

  it('quarterly runs only in its month set', () => {
    const q = { rule: 'quarterly', monthBy: 'weekday', weeks: [3], days: [4], startMonth: 0 };
    assert.deepEqual(dueDates(q, '2026-01-01', '2026-12-31'), ['2026-01-15', '2026-04-16', '2026-07-16', '2026-10-15']);
    assert.deepEqual(dueDates({ ...q, startMonth: 1 }, '2026-10-01', '2026-11-30'), ['2026-11-19']);
    assert.deepEqual(dueDates({ rule: 'quarterly', monthDays: [1], startMonth: 2 }, '2026-01-01', '2026-12-31'),
      ['2026-03-01', '2026-06-01', '2026-09-01', '2026-12-01']);
  });

  it('labels read as plain words', () => {
    const L = lib.recurringRuleLabel;
    assert.equal(L({ rule: 'biweekly', startDate: '2026-10-06' }), 'Every other Tue');
    assert.equal(L({ rule: 'monthly', monthBy: 'weekday', weeks: [3, 1], days: [2] }), 'Monthly on the 1st & 3rd Tue');
    assert.equal(L({ rule: 'monthly', monthBy: 'weekday', weeks: [-1, 2], days: [5] }), 'Monthly on the 2nd & last Fri');
    assert.equal(L({ rule: 'monthly', monthBy: 'date', monthDays: [15, 1] }), 'Monthly on the 1st & 15th');
    assert.equal(L({ rule: 'monthly', monthDays: [-1, 1, 10] }), 'Monthly on the 1st, 10th & last day');
    assert.equal(L({ rule: 'quarterly', monthBy: 'weekday', weeks: [3], days: [4], startMonth: 1 }), 'Quarterly on the 3rd Thu (Feb, May, Aug, Nov)');
    assert.equal(L({ rule: 'weekly', days: [1] }), 'Every Mon', 'older rules unchanged');
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(lib.ordinal),
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
  });

  it('editing a schedule drops the old rule\'s fields and keeps everything else', () => {
    const before = { id: 't1', content: 'Sync', rule: 'monthly', monthBy: 'weekday', weeks: [3], days: [4], startMonth: 1, tags: ['ace'], lastInjectedDate: '2026-10-15' };
    const after = lib.withRecurringSchedule(before, { rule: 'daily', days: null });
    assert.deepEqual(after, { id: 't1', content: 'Sync', rule: 'daily', days: null, tags: ['ace'], lastInjectedDate: '2026-10-15' });
  });

  it('isDueToday uses the shared schedule check and still skips holidays', () => {
    const body = fnSource('isDueToday');
    assert.match(body, /recurringDueOn\(template, today\)/);
    assert.match(body, /template\.skipHolidays && checkHoliday\(today\)\.isHoliday/);
  });

  it('the picker validates each rule before saving', () => {
    const picker = fnSource('createRecurringSchedulePicker');
    assert.match(picker, /'Please choose at least one day'/);
    assert.match(picker, /'Please choose at least one day of the month'/);
    assert.match(picker, /'Please choose a week and a day'/);
    assert.match(picker, /if \(rule === 'quarterly'\) schedule\.startMonth = startMonth;/);
  });

  it('Ctrl+Enter saves desk task and comment edits and the recurring forms', () => {
    assert.match(fnSource('appendEditActions'), /container\.addEventListener\('keydown'[\s\S]*?\(e\.ctrlKey \|\| e\.metaKey\) && e\.key === 'Enter'\) \{ e\.preventDefault\(\); onSave\(\); \}/);
    assert.match(fnSource('renderRecurringPanel'), /e\.key === 'Enter'\) \{ e\.preventDefault\(\); addBtn\.click\(\); \}/);
    assert.match(mainScript, /function openRecurringEditForm[\s\S]*?e\.key === 'Enter'\) \{ e\.preventDefault\(\); saveBtn\.click\(\); \}/);
  });

});

describe('docs stay in step with the app', () => {
  const changelog = new Function(`return ${html.match(/const CHANGELOG = (\[[\s\S]*?\n    \]);/)[1]}`)();
  const appVersion = html.match(/const APP_VERSION = '([\d.]+)';/)[1];
  const md = readFileSync(join(__dirname, '../CHANGELOG.md'), 'utf8');
  const readme = readFileSync(join(__dirname, '../README.md'), 'utf8');
  const mdVersions = [...md.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
  const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

  it('APP_VERSION is the newest release in What\'s New and CHANGELOG.md, and only it is tagged latest', () => {
    assert.equal(changelog[0].version, appVersion);
    assert.equal(mdVersions[0], appVersion);
    assert.deepEqual(changelog.filter((e) => e.tag === 'latest').map((e) => e.version), [appVersion]);
  });

  it('releases are listed newest first, once each, in both changelogs', () => {
    for (const list of [changelog.map((e) => e.version), mdVersions]) {
      assert.equal(new Set(list).size, list.length, 'duplicate version');
      for (let i = 1; i < list.length; i++) assert.ok(cmp(list[i - 1], list[i]) > 0, `${list[i - 1]} should come before ${list[i]}`);
    }
  });

  it('every What\'s New release has a CHANGELOG.md block with the same sections', () => {
    for (const entry of changelog) {
      const start = md.indexOf(`## [${entry.version}]`);
      assert.ok(start >= 0, `CHANGELOG.md is missing ${entry.version}`);
      const next = md.indexOf('\n## [', start + 1);
      const block = md.slice(start, next < 0 ? undefined : next);
      for (const section of entry.sections) {
        assert.match(block, new RegExp(`### ${section.label}\\n+- `), `${entry.version} ${section.label} in CHANGELOG.md`);
      }
    }
  });

  it('every What\'s New release has a date and at least one non-empty item per section', () => {
    for (const entry of changelog) {
      assert.match(entry.date, /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/, `${entry.version} date`);
      assert.ok(entry.sections.length, `${entry.version} has sections`);
      for (const s of entry.sections) {
        assert.ok(['Added', 'Improved', 'Fixed', 'Changed', 'Removed'].includes(s.label), `${entry.version} label ${s.label}`);
        assert.ok(s.items.length && s.items.every((i) => typeof i === 'string' && i.trim().length > 10), `${entry.version} ${s.label} items`);
      }
    }
  });

  it('theme counts in Help and README match the theme list, and README names every theme', () => {
    const themes = new Function(`return ${html.match(/const THEMES = (\[[\s\S]*?\n    \]);/)[1]}`)();
    const tiers = {
      Light: themes.filter((t) => !t.dark && !t.medium),
      Medium: themes.filter((t) => t.medium),
      Dark: themes.filter((t) => t.dark),
    };
    const [l, m, d] = [tiers.Light.length, tiers.Medium.length, tiers.Dark.length];
    assert.ok(readme.includes(`**${themes.length} preset themes** — ${l} light + ${m} medium + ${d} dark`), 'README count');
    assert.ok(html.includes(`${themes.length} presets (${l} light, ${m} medium, ${d} dark`), 'Help count');
    for (const [tier, list] of Object.entries(tiers)) {
      const line = readme.match(new RegExp(`\\*\\*${tier} \\(${list.length}\\):\\*\\*([^\\n]*)`));
      assert.ok(line, `README ${tier} line with count ${list.length}`);
      for (const t of list) assert.ok(line[1].includes(t.name), `README ${tier} list names ${t.name}`);
    }
  });
});

describe('Help modal structure', () => {
  const start = html.indexOf('<div id="help-modal"');
  const help = html.slice(start, html.indexOf('<div class="help-modal-footer">', start));
  const sections = [...help.matchAll(/<details class="help-section" id="(help-[a-z-]+)"(?: data-short="([^"]+)")?( open)?>\s*<summary>([^<]+)<\/summary>([\s\S]*?)<\/details>/g)]
    .map((m) => ({ id: m[1], short: m[2], open: !!m[3], title: m[4], body: m[5] }));

  it('has a search box, an index, and folding sections that all start open', () => {
    assert.match(help, /<input id="help-search" class="help-search" type="search"/);
    assert.match(help, /<nav id="help-index" class="help-index" aria-label="Help sections"><\/nav>/);
    assert.ok(sections.length >= 10, `${sections.length} sections`);
    assert.equal((help.match(/class="help-section"/g) || []).length, sections.length, 'every section parses');
    assert.deepEqual(sections.filter((s) => !s.open).map((s) => s.title), [], 'every section starts open');
    for (const s of sections) assert.match(s.body, /<li>/, `${s.title} has items`);
    for (const s of sections) assert.ok((s.short || s.title).replace('&amp;', '&').length <= 11, `index label for ${s.title} fits its grid cell`);
    assert.equal(sections.length % 4, 0, 'the 4-column index fills every row');
    assert.doesNotMatch(help, /<h3>/, 'no loose headings outside the folding sections');
  });

  it('stays short: under 2,000 words, no item over 60 words, and no roadmap', () => {
    const text = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
    const words = (h) => text(h).split(/\s+/).filter((w) => /\w/.test(w)).length;
    assert.ok(words(help) < 2000, `${words(help)} words`);
    for (const li of help.match(/<li>[\s\S]*?<\/li>/g)) assert.ok(words(li) <= 60, `long item: ${text(li).slice(0, 80)}`);
    assert.doesNotMatch(help, /future improvements/i);
  });

  it('search filters lines, opens matching sections, and resets when Help opens', () => {
    const filter = fnSource('filterHelp');
    assert.match(filter, /li\.hidden = !\(titleMatch \|\| helpText\(li\)\.includes\(q\)\)/);
    assert.match(filter, /section\.open = helpOpenByDefault\.get\(section\)/);
    assert.match(filter, /'help-no-results'\)\.classList\.toggle\('hidden', !q \|\| anyMatch\)/);
    assert.match(fnSource('openHelpModal'), /helpSearch\.value = '';\s*filterHelp\(''\);/);
  });
});

describe('theme grid width', () => {
  it('columns can shrink below their longest name, names wrap, and a too-wide word is shrunk after each render', () => {
    assert.match(html, /\.theme-picker-grid \{\s*display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    assert.match(html, /\.theme-swatch \{\s*min-width: 0;/);
    assert.match(html, /\.theme-picker-grid \.theme-swatch-name \{\s*white-space: normal;/);
    assert.match(fnSource('renderThemeSwatches'), /requestAnimationFrame\(fitThemeNames\);\s*document\.fonts\?\.ready\.then\(fitThemeNames\);\s*\}$/);
    assert.match(fnSource('fitThemeNames'), /while \(name\.scrollWidth > name\.clientWidth \+ 0\.5 && size > min\)/);
  });
});

describe('stylesheet structure', () => {
  it('every <style> block has balanced braces, so no rule is silently dropped', () => {
    const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, ''));
    assert.ok(blocks.length);
    for (const css of blocks) {
      let depth = 0;
      for (let i = 0; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth < 0) assert.fail(`stray } near: ${css.slice(Math.max(0, i - 120), i + 1)}`);
      }
      assert.equal(depth, 0, 'unclosed {');
    }
  });
});

describe('recurring next due date (run from work-desk.html)', () => {
  const app = bootAppInVm();
  const next = (t, from) => app.recurringNextDue({ lastInjectedDate: null, ...t }, from);

  it('finds the next matching day, counting today until today\'s copy is on the desk', () => {
    // 2026-10-22 is a Thursday
    assert.equal(next({ rule: 'weekdays' }, '2026-10-22'), '2026-10-22');
    assert.equal(next({ rule: 'weekdays', lastInjectedDate: '2026-10-22' }, '2026-10-22'), '2026-10-23');
    assert.equal(next({ rule: 'weekdays', lastInjectedDate: '2026-10-23' }, '2026-10-23'), '2026-10-26', 'Friday done, so Monday');
    assert.equal(next({ rule: 'weekly', days: [2] }, '2026-10-22'), '2026-10-27');
    assert.equal(next({ rule: 'biweekly', startDate: '2026-10-06', days: [2] }, '2026-10-22'), '2026-11-03');
    assert.equal(next({ rule: 'monthly', monthBy: 'weekday', weeks: [3], days: [4] }, '2026-10-23'), '2026-11-19');
    assert.equal(next({ rule: 'quarterly', monthBy: 'date', monthDays: [1], startMonth: 1 }, '2026-10-22'), '2026-11-01');
  });

  it('skips holidays when the template does', () => {
    // Thanksgiving 2026 is Thu Nov 26
    assert.equal(next({ rule: 'weekly', days: [4] }, '2026-11-24'), '2026-11-26');
    assert.equal(next({ rule: 'weekly', days: [4], skipHolidays: true }, '2026-11-24'), '2026-12-03');
  });

  it('labels it Today, Tomorrow, a short date, or a date with the year', () => {
    assert.equal(app.formatNextDue('2026-10-22', '2026-10-22'), 'Today');
    assert.equal(app.formatNextDue('2026-10-23', '2026-10-22'), 'Tomorrow');
    assert.equal(app.formatNextDue('2026-10-27', '2026-10-22'), 'Tue, Oct 27');
    assert.equal(app.formatNextDue('2027-02-01', '2026-10-22'), 'Feb 1, 2027');
    assert.equal(app.formatNextDue(null), '');
  });
});

describe('Shades of accent colors (run from work-desk.html)', () => {
  const app = bootAppInVm();
  const MONOKAI = {
    accent: '#f92672', surface: '#3e3d32', text: '#f8f8f2',
    neutrals: ['#272822', '#3e3d32', '#1e1f1c', '#1e1f1c', '#a6a28c', '#a6a28c', '#49483e'],
  };
  const hueOf = (hex) => app.hexToOklch(hex).h;

  it('Monokai leans on its pink and uses at most two bright olive-family colors, all 8 clearly different', () => {
    const shades = [...app.buildAccentShades(MONOKAI)];
    assert.deepEqual(shades, ['#f92672', '#b5d76c', '#f4a1ff', '#ff8008', '#d652e9', '#ffaba7', '#fbba53', '#ff6cb4']);
    assert.ok(app.minTagShadeGap(shades) >= 0.07, 'no two look alike');
    const tint = app.tagShadeTint(MONOKAI.accent, MONOKAI.neutrals);
    const nearTint = shades.filter((h) => app.hexToOklch(h).c > 0.05 && Math.abs(((hueOf(h) - tint.h + 540) % 360) - 180) <= 24);
    assert.ok(nearTint.length <= 2, `${nearTint.length} tint colors`);
  });

  it('plain gray backgrounds have no tint, so every color stays within 60° of the accent', () => {
    const gray = { accent: '#0d9488', surface: '#ffffff', text: '#111111', neutrals: ['#f5f5f5', '#ffffff', '#fafafa', '#e5e5e5', '#737373'] };
    assert.equal(app.tagShadeTint(gray.accent, gray.neutrals), null);
    const a = hueOf(gray.accent);
    for (const hex of app.buildAccentShades(gray)) {
      assert.ok(Math.abs(((hueOf(hex) - a + 540) % 360) - 180) <= 62, `${hex} is near the accent's hue`);
    }
  });

  it('Multi-color still uses the theme\'s own color set', () => {
    const palette = JSON.parse(html.match(/\n\s+monokai:\s+(\[[^\]]+\])/)[1].replace(/'/g, '"'));
    assert.equal(palette.length, 8);
    const shades = [...app.buildTagShades({ accent: MONOKAI.accent, surface: MONOKAI.surface, text: MONOKAI.text, palette })];
    assert.equal(shades.length, 8);
    assert.equal(shades[0], '#f92672');
    assert.ok(shades.includes('#a6e22e') && shades.includes('#66d9ef'), 'Monokai green and cyan are in the set');
  });
});

describe('the app\'s own sync merge and dedupe code (run from work-desk.html)', () => {
  const app = bootAppInVm();
  // The mocked DOM has no HTML parser; content matching only needs the text
  app.stripHtmlTags = (h) => String(h || '').replace(/<[^>]*>/g, '');
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

  describe('mergeRecurringTemplates', () => {
    const remote = {
      id: 't1', content: '1-1 with Laura', rule: 'weekly', days: [4], createdAt: '2026-01-05T10:00:00Z',
      lastInjectedDate: '2026-10-15', tags: ['mgmt'],
    };

    it('a schedule edited on this device wins and is due on the new dates', () => {
      const local = {
        id: 't1', content: '1-1 with Laura', rule: 'monthly', monthBy: 'weekday', weeks: [3], days: [4],
        createdAt: '2026-03-01T10:00:00Z', lastInjectedDate: '2026-09-17', tags: ['laura'],
      };
      const [merged] = plain(app.mergeRecurringTemplates([local], [remote]));
      assert.equal(merged.rule, 'monthly');
      assert.deepEqual(merged.weeks, [3]);
      assert.equal(merged.createdAt, '2026-01-05T10:00:00Z', 'first-seen createdAt is kept');
      assert.equal(merged.lastInjectedDate, '2026-10-15', 'the later inject date wins from either side');
      assert.deepEqual(merged.tags, ['mgmt', 'laura']);
      assert.equal(app.recurringDueOn(merged, '2026-11-19'), true, '3rd Thursday of November');
      assert.equal(app.recurringDueOn(merged, '2026-11-12'), false, '2nd Thursday is not due');
      assert.equal(app.recurringRuleLabel(merged), 'Monthly on the 3rd Thu');
    });

    it('fields left over from the other device\'s older schedule do not change when it is due', () => {
      const oldRemote = { id: 't2', content: 'Sara 1-1', rule: 'monthly', monthBy: 'weekday', weeks: [1, 3], days: [2] };
      const editedLocal = { id: 't2', content: 'Sara 1-1', rule: 'monthly', monthBy: 'date', monthDays: [1, 15] };
      const [merged] = plain(app.mergeRecurringTemplates([editedLocal], [oldRemote]));
      const due = ['2026-11-01', '2026-11-03', '2026-11-15', '2026-11-17'].filter((d) => app.recurringDueOn(merged, d));
      assert.deepEqual(due, ['2026-11-01', '2026-11-15']);
      assert.equal(app.recurringRuleLabel(merged), 'Monthly on the 1st & 15th');
    });

    it('templates on only one side pass through with their biweekly and quarterly fields', () => {
      const biweekly = { id: 'b', content: 'Sprint review', rule: 'biweekly', startDate: '2026-10-07' };
      const quarterly = { id: 'q', content: 'QBR', rule: 'quarterly', monthBy: 'date', monthDays: [-1], startMonth: 2 };
      const merged = plain(app.mergeRecurringTemplates([biweekly], [quarterly]));
      assert.deepEqual(merged.map((t) => t.id).sort(), ['b', 'q']);
      const q = merged.find((t) => t.id === 'q');
      assert.equal(app.recurringDueOn(q, '2026-12-31'), true);
      assert.equal(app.recurringDueOn(q, '2026-11-30'), false);
      assert.equal(app.recurringDueOn(merged.find((t) => t.id === 'b'), '2026-10-21'), true);
    });

    it('ignores entries without an id and matches the shared library version', () => {
      const local = [{ id: 't1', content: 'x', rule: 'daily', lastInjectedDate: '2026-10-01' }, null, { content: 'no id' }];
      const out = plain(app.mergeRecurringTemplates(local, [remote]));
      assert.equal(out.length, 1);
      assert.deepEqual(out, plain(mergeRecurringTemplates(local, [remote])));
    });
  });

  describe('mergeProjectsData', () => {
    const project = (over) => ({ id: 'p1', name: 'ACE', notes: [], tasks: [], updatedAt: ago(5), ...over });

    it('an item deleted on either device stays deleted', () => {
      const local = { projects: [project({ tasks: [{ id: 'keep' }, { id: 'goneRemote' }] })], deletedIds: { goneLocal: ago(1) } };
      const remote = { projects: [project({ tasks: [{ id: 'keep' }, { id: 'goneLocal' }, { id: 'goneRemote' }] })], deletedIds: { goneRemote: ago(1) } };
      const out = plain(app.mergeProjectsData(local, remote));
      assert.deepEqual(out.projects[0].tasks.map((t) => t.id), ['keep']);
      assert.deepEqual(Object.keys(out.deletedIds).sort(), ['goneLocal', 'goneRemote']);
    });

    it('a project only on the other device arrives without its deleted items', () => {
      const out = plain(app.mergeProjectsData(
        { projects: [], deletedIds: { n2: ago(2) } },
        { projects: [project({ id: 'p2', notes: [{ id: 'n1' }, { id: 'n2' }] })], deletedIds: {} },
      ));
      assert.deepEqual(out.projects.map((p) => p.id), ['p2']);
      assert.deepEqual(out.projects[0].notes.map((n) => n.id), ['n1']);
    });

    it('the side renamed, pinned, or unarchived most recently wins', () => {
      const local = { projects: [project({ name: 'Old', archived: true, updatedAt: ago(3) })], deletedIds: {} };
      const remote = { projects: [project({ name: 'New', pinned: true, updatedAt: ago(1) })], deletedIds: {} };
      const [p] = plain(app.mergeProjectsData(local, remote)).projects;
      assert.equal(p.name, 'New');
      assert.equal(p.pinned, true);
      assert.equal(p.archived, undefined);
      const [kept] = plain(app.mergeProjectsData(remote, local)).projects;
      assert.equal(kept.name, 'New', 'an older remote edit does not overwrite');
    });

    it('a task with more comments wins, and the newer item order is applied', () => {
      const local = { projects: [project({
        tasks: [{ id: 'a', comments: [] }, { id: 'b', comments: [] }],
        itemOrderUpdatedAt: ago(4),
      })], deletedIds: {} };
      const remote = { projects: [project({
        tasks: [{ id: 'b', comments: [{ id: 'c1' }] }, { id: 'a', comments: [] }],
        itemOrderUpdatedAt: ago(1),
      })], deletedIds: {} };
      const [p] = plain(app.mergeProjectsData(local, remote)).projects;
      assert.deepEqual(p.tasks.map((t) => t.id), ['b', 'a']);
      assert.equal(p.tasks[0].comments.length, 1);
    });
  });

  describe('deduplicateDayItems and deduplicateAcrossDays', () => {
    it('two copies of one item on a day merge into the most advanced one, keeping comments, tags, and links', () => {
      const out = plain(app.deduplicateDayItems([
        task({ id: 'x', comments: [{ id: 'c1' }], tags: ['ace'], carriedFrom: '2026-10-20' }),
        task({ id: 'x', completed: true, comments: [{ id: 'c2' }], tags: ['ids'], recurringTemplateId: 't1' }),
        { id: undefined, type: 'note', content: 'no id' },
      ]));
      assert.equal(out.length, 2);
      const x = out.find((i) => i.id === 'x');
      assert.equal(x.completed, true);
      assert.deepEqual(x.comments.map((c) => c.id), ['c2', 'c1']);
      assert.deepEqual(x.tags.sort(), ['ace', 'ids']);
      assert.equal(x.carriedFrom, '2026-10-20');
      assert.equal(x.recurringTemplateId, 't1');
    });

    it('one item on two days lives on one: completed beats open, then the later day', () => {
      const { days, removed } = plain(app.deduplicateAcrossDays({
        '2026-10-20': { items: [task({ id: 'a', completed: true }), task({ id: 'b', comments: [{ id: 'old' }] })] },
        '2026-10-21': { items: [task({ id: 'a', tags: ['late'] }), task({ id: 'b' })] },
      }));
      assert.equal(removed, 2);
      assert.deepEqual(days['2026-10-20'].items.map((i) => i.id), ['a']);
      assert.deepEqual(days['2026-10-21'].items.map((i) => i.id), ['b']);
      assert.deepEqual(days['2026-10-20'].items[0].tags, ['late'], 'the losing copy\'s tags are kept');
      assert.deepEqual(days['2026-10-21'].items[0].comments.map((c) => c.id), ['old'], 'the losing copy\'s comments are kept');
    });

    it('a day left empty by deduping is dropped', () => {
      const { days } = plain(app.deduplicateAcrossDays({
        '2026-10-20': { items: [task({ id: 'a' })] },
        '2026-10-21': { items: [task({ id: 'a' })] },
      }));
      assert.deepEqual(Object.keys(days), ['2026-10-21']);
    });
  });

  describe('deduplicateRecurringSameDay', () => {
    const tmpl = { id: 't1', content: 'Update the ACE Dashboard' };

    it('two copies of one recurring task on a day collapse into the completed one with all comments', () => {
      const { items, removed } = plain(app.deduplicateRecurringSameDay([
        task({ id: 'r1', content: 'Update the ACE Dashboard', recurringTemplateId: 't1', comments: [{ id: 'c1' }] }),
        task({ id: 'other', content: 'Something else' }),
        task({ id: 'r2', content: 'Update the ACE Dashboard', recurringTemplateId: 't1', completed: true }),
      ], [tmpl]));
      assert.equal(removed, 1);
      assert.deepEqual(items.map((i) => i.id), ['other', 'r2']);
      assert.deepEqual(items[1].comments.map((c) => c.id), ['c1']);
    });

    it('an unlinked task with the same text as a template is linked and collapsed', () => {
      const { items, removed } = plain(app.deduplicateRecurringSameDay([
        task({ id: 'manual', content: '<b>Update the  ACE dashboard</b>', tags: ['ace'] }),
        task({ id: 'r1', content: 'Update the ACE Dashboard', recurringTemplateId: 't1' }),
      ], [tmpl]));
      assert.equal(removed, 1);
      assert.equal(items.length, 1);
      assert.equal(items[0].recurringTemplateId, 't1');
      assert.deepEqual(items[0].tags, ['ace']);
    });

    it('same-text tasks with no template link are left alone', () => {
      const input = [task({ id: 'a', content: 'Standup' }), task({ id: 'b', content: 'Standup' })];
      const { items, removed } = plain(app.deduplicateRecurringSameDay(input, [tmpl]));
      assert.equal(removed, 0);
      assert.deepEqual(items.map((i) => i.id), ['a', 'b']);
    });
  });
});
