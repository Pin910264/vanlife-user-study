// Offline checks of the actual discovery renderer and stage/poll integration.
// Run: node tools/test_discovery.cjs [live.js] [demo-response-fixtures.json]
// Uses only Node built-ins; no browser, package installation, or model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.argv[2] || path.resolve(__dirname, '../live.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source section: ${start}`);
  return source.slice(a, b);
}
const renderer = section('  function applyDiscovery(', '  function setPlanBig(');
const stages = section("  let shownStage = '', shownCard", '  // a three-step tour');
const polling = section('  async function tick()', '  tick(); setInterval');
const blocked = () => { throw new Error('Discovery must not fetch, persist, or log'); };

class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.style = {};
    this.hidden = false; this.textContent = ''; this.attributes = {}; this.queries = new Map();
    this.classes = new Set(); this.replacements = 0;
    this.classList = {toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name)};
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; this.replacements++; }
  setAttribute(key, value) { this.attributes[key] = value; }
  set innerHTML(value) { this.html = value; this.children = []; this.queries.clear(); }
  get innerHTML() { return this.html || ''; }
  querySelector(selector) {
    if (selector === 'input') return null;
    if (!this.queries.has(selector)) this.queries.set(selector, new Element());
    return this.queries.get(selector);
  }
}
function fixture() {
  const stageBox = new Element(), title = new Element(), header = new Element();
  const find = (node, id) => node.id === id ? node : node.children.map(child => find(child, id)).find(Boolean);
  const document = {
    createElement: tag => new Element(tag),
    getElementById: id => id === 'livetitle' ? title : find(stageBox, id),
    querySelector: selector => selector === 'header' ? header : null,
  };
  const context = vm.createContext({
    document, stageBox, strip: new Element(), app: new Element(), planbox: new Element(),
    fab: new Element(), notice: new Element(), liveEvent: () => {},
    endTour() {}, endPinPractice() {}, introCard: () => new Element(),
    window: {scrollTo() {}}, setTimeout() {}, tourStep: 0, TOUR: [1, 2], showTour() {}, applyDemo() {},
    fetch: blocked, localStorage: {setItem: blocked}, sessionStorage: {setItem: blocked},
  });
  vm.runInContext(stages + renderer + '\nglobalThis.api = {applyStage, applyDiscovery};', context);
  return {context, stageBox, title, document, ...context.api};
}
const data = {
  steps: [{key: 'day', label: 'Your day', status: 'discussed'}, {key: 'night', label: 'Your night', status: 'current'}, {key: 'van', label: 'Your van', status: 'upcoming'}],
  routines: [{key: 'day', label: 'Your day', note: 'Hiking and cooking'}, {key: 'night', label: 'Your night', note: ''}],
  items: [{name: 'Stove and fridge', detail: 'Near the door', area: 'Cooking'}, {name: 'Wet gear', detail: '', area: 'Storage'}],
};
const f = fixture();
f.applyStage('talk', 0, 1);
f.context.liveEvent = blocked;
const panel = f.document.getElementById('livediscovery');
assert.ok(panel);
f.applyDiscovery(data);
assert.equal(panel.hidden, false);
assert.equal(panel.querySelector('.discovery-count').textContent, '2 ideas noted');
const list = panel.querySelector('.discovery-list');
assert.equal(list.children[0].children[0].children[0].textContent, 'Stove and fridge');
assert.equal(panel.querySelector('.discovery-steps').children[1].attributes['aria-current'], 'step');
const routines = panel.querySelector('.discovery-routines');
assert.equal(routines.hidden, false);
assert.equal(routines.querySelector('div').children.length, 1);
routines.open = true;
const originalRow = list.children[0], changes = list.replacements;
f.applyDiscovery(JSON.parse(JSON.stringify(data)));
assert.equal(list.children[0], originalRow, 'Unchanged polls preserve DOM nodes');
assert.equal(list.replacements, changes);
assert.equal(routines.open, true, 'Polling preserves expanded notes');
const corrected = JSON.parse(JSON.stringify(data));
corrected.items = [{name: 'Stove', detail: 'At the back', area: 'Cooking'}];
f.applyDiscovery(corrected);
assert.equal(list.children.length, 1);
assert.equal(list.children[0].children[0].children[0].textContent, 'Stove');
assert.equal(list.children[0].children[0].children[1].textContent, 'At the back');
f.applyDiscovery(null);
assert.equal(panel.hidden, true);
f.applyDiscovery(corrected);
assert.equal(panel.hidden, false);
f.applyDiscovery({steps: [], routines: [], items: []});
assert.equal(list.children.length, 0);
assert.equal(panel.querySelector('.discovery-empty').hidden, false);
assert.equal(routines.hidden, true);
const literal = '<img src=x onerror=alert(1)>';
f.applyDiscovery({...data, items: [{name: literal, detail: literal, area: literal}]});
const rendered = list.children[0].children[0].children;
assert.equal(rendered[0].textContent, literal);
assert.equal(rendered[0].innerHTML, '', 'Participant text is never assigned as HTML');
f.context.liveEvent = () => {};
f.applyStage('browse', 0, 1);
assert.equal(f.document.getElementById('livediscovery'), undefined);
assert.equal(f.context.app.style.display, '');
f.applyDiscovery(data);
f.applyStage('talk', 0, 1);
f.applyDiscovery(data);
assert.equal(f.document.getElementById('livediscovery').querySelector('.discovery-list').children.length, 2);
console.log('PASS: shared cards, corrections/removal, stable polling, routine expansion, safe text, null/empty data, stage re-entry; no extra fetch/storage/events');

const g = fixture();
g.applyStage('consent', 0, 3);
assert.match(g.stageBox.children[0].innerHTML, /Welcome/);
g.applyStage('consent', 1, 3);
assert.match(g.stageBox.children[0].innerHTML, /Before we begin/);
g.applyStage('consent', 2, 3);
assert.match(g.stageBox.children[0].innerHTML, /livesurvey/);
g.applyStage('demo', 0, 1);
assert.match(g.stageBox.children[0].innerHTML, /Talking with the assistant/);
g.applyStage('intro', 0, 2);
assert.match(g.stageBox.children[0].innerHTML, /Any questions/);
g.applyStage('intro', 1, 2);
assert.equal(g.stageBox.children.length, 1);
for (const stage of ['questionnaire', 'debrief']) {
  g.applyStage(stage, 0, 1);
  assert.match(g.stageBox.children[0].innerHTML, /livesurvey/);
  assert.ok(!g.stageBox.children.some(node => node.innerHTML.includes('out of date')));
}
g.applyStage('interview', 0, 1);
assert.match(g.stageBox.children[0].innerHTML, /Thank you/);
console.log('PASS: merged consent cards, forms, voice rehearsal, intro cards and interview');

if (process.argv[3]) {
  const responses = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const demo = fixture();
  for (const response of responses) {
    demo.applyStage(response.stage, response.card, response.cards);
    demo.applyDiscovery(response.discovery);
    const panel = demo.document.getElementById('livediscovery');
    if (response.discovery) {
      assert.equal(panel.querySelector('.discovery-list').children.length, response.discovery.items.length);
      response.discovery.items.forEach((item, i) => {
        assert.equal(panel.querySelector('.discovery-list').children[i].children[0].children[0].textContent, item.name);
      });
      const reloaded = fixture();
      reloaded.applyStage(response.stage, response.card, response.cards);
      reloaded.applyDiscovery(response.discovery);
      assert.equal(reloaded.document.getElementById('livediscovery').querySelector('.discovery-count').textContent,
                   panel.querySelector('.discovery-count').textContent);
    } else assert.equal(panel, undefined);
  }
  console.log(`PASS: ${responses.length} actual backend demo responses rendered through stage changes, updates and reloads`);
}

(async () => {
  const calls = [], received = [];
  const elements = new Map();
  const response = {stage: 'talk', card: 1, cards: 3, intro: {}, discovery: data, demo: {}, survey: '', chosen: [], mentions: []};
  const context = vm.createContext({
    FEED: 'http://test', KEY: 'key', SAMPLE: '', STAGE: '', failures: 0, shownStage: 'talk', chosen: new Set(), chosenKey: '',
    fetch: async url => { calls.push(url); return {ok: true, json: async () => response}; },
    applyStage: (...args) => received.push(['stage', ...args]), applyDiscovery: d => received.push(['discovery', d]),
    applySurvey: url => received.push(['survey', url]), applyWords() {}, applyTalkSentence() {}, applyDemo() {},
    render() {}, drawPlan() {}, applyPlacement() {}, setSpeaking() {}, setState() {}, showNoteBox() {}, window: {},
    document: {getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }},
  });
  vm.runInContext(polling + '\nglobalThis.tick = tick;', context);
  await context.tick();
  assert.deepEqual(calls, ['http://test/p/state?key=key']);
  assert.equal(received[0].join(','), 'stage,talk,1,3');
  assert.equal(received.find(row => row[0] === 'discovery')[1], data);
  assert.ok(received.some(row => row[0] === 'survey'));
  assert.equal(context.failures, 0);
  console.log('PASS: one existing state request feeds discovery, briefing card indices and survey handling');
})().catch(error => {console.error(error); process.exitCode = 1;});
