// references: node autocomplete with several items (field_sf_nodes), a user
// (field_sf_user, uid), tags with autocreate (field_sf_tags), links, internal
// and external (field_sf_links.N.uri and .title).
//
// Makes two nodes with the same title for the ambiguous case, and a tag by
// autocreate; deletes them, and the nodes it saves, at the end.

import { assert, session, steps, title, cleanup, drush, PREFIX, FORM, EDIT_FORM } from '../lib.mjs';

export const group = 'references';

const set = (s, field, value, form = FORM) => s.ok('form set', { form, field, value });
const search = (s, field, text, form = FORM) => s.ok('form search', { form, field, text });

// form set that must be refused as a usage error; returns the message.
async function refused(s, field, value, form = FORM) {
  const r = await s.call('form set', { form, field, value });
  assert.equal(r.code, 2, `${field} = ${JSON.stringify(value)} → ${r.code}: ${r.message || r.text}`);
  return r.message || r.text;
}

// Completions for a command line, as the console offers them.
const complete = (s, line) =>
  s.page.evaluate(async (l) => {
    const src = document.querySelector('script[src*="/lib/sutram/sutram.js"]').src;
    const { complete: c } = await import(src);
    return (await c(window.Sutram.registry, l)).items.map((i) => i.value.trim());
  }, line);

// Nodes of the test type, unpublished, by title; returns their ids.
const nodes = (...titles) =>
  drush(
    'php:eval',
    `foreach (json_decode(base64_decode('${Buffer.from(JSON.stringify(titles)).toString('base64')}'), TRUE) as $t) { $n = \\Drupal\\node\\Entity\\Node::create(['type' => 'sutram_form_test', 'title' => $t, 'status' => 0]); $n->save(); echo $n->id(), ' '; }`,
  )
    .split(/\s+/)
    .filter(Boolean);

// The terms this group made, by autocreate.
function cleanupTerms() {
  const like = `${PREFIX} ${group}%`.replace(/'/g, "''");
  const tids = drush('sql:query', `SELECT tid FROM taxonomy_term_field_data WHERE name LIKE '${like}'`)
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x));
  if (tids.length) drush('entity:delete', 'taxonomy_term', tids.join(','));
}

export async function run() {
  const s = await session();
  const stamp = Date.now().toString(36);
  const twin = `${PREFIX} ${group} twin ${stamp}`;
  const target = `${PREFIX} ${group} target ${stamp}`;
  const newTag = `${PREFIX} ${group}, new tag ${stamp}`;
  let twins = [];
  let targetId = '';
  let nid = null;
  try {
    return await steps(group, [
      ['describes references, tags and links', async () => {
        twins = nodes(twin, twin);
        [targetId] = nodes(target);
        assert.equal(twins.length, 2);
        await s.add();
        const f = await s.fields();
        const types = {
          'field_sf_nodes.0': 'reference',
          field_sf_user: 'reference',
          field_sf_tags: 'references',
          'field_sf_links.0.uri': 'link',
          'field_sf_links.0.title': 'string',
          uid: 'reference',
        };
        for (const [path, type] of Object.entries(types)) assert.equal(f[path]?.type, type, `${path}: ${JSON.stringify(f[path])}`);
        assert.equal(f.uid.value, 'admin (1)', 'Authored by: the input holds Label (id)');
        const st = await s.ok('form status', { form: FORM });
        assert.deepEqual(st.data.unsaved, []);
      }],

      ['form search: the autocomplete endpoint of a field', async () => {
        let r = await search(s, 'field_sf_tags', 'rob');
        assert.deepEqual(r.data.candidates.map((c) => c.label), ['Robusta']);
        const robusta = r.data.candidates[0];
        assert.equal(robusta.value, `Robusta (${robusta.id})`);
        r = await search(s, 'uid', 'adm');
        assert.deepEqual(r.data.candidates, [{ value: 'admin (1)', label: 'admin', id: '1' }]);
        // An item the field does not show yet, or no item number at all.
        for (const path of ['field_sf_nodes.7', 'field_sf_nodes']) {
          r = await search(s, path, `target ${stamp}`);
          assert.equal(r.data.field, 'field_sf_nodes.0');
          assert.deepEqual(r.data.candidates.map((c) => c.value), [`${target} (${targetId})`]);
        }
        r = await search(s, 'field_sf_links.0', `target ${stamp}`);
        assert.equal(r.data.field, 'field_sf_links.0.uri', 'a link searches its URL input');
        assert.equal(r.data.candidates.length, 1);
        r = await search(s, 'field_sf_user', 'zz-nobody-zz');
        assert.deepEqual(r.data.candidates, []);
        const bad = await s.call('form search', { form: FORM, field: 'title', text: 'a' });
        assert.equal(bad.code, 2);
        assert.match(bad.message, /not a reference or link field.*field_sf_tags/);
      }],

      ['form set completes a reference with the candidates', async () => {
        let items = await complete(s, `form set ${FORM} field_sf_nodes.0 "${PREFIX} ${group} target`);
        assert.ok(items.includes(`"${target} (${targetId})"`), JSON.stringify(items));
        items = await complete(s, `form set ${FORM} field_sf_tags "Arabica (1), rob`);
        assert.ok(items.some((i) => /^"Arabica \(1\), Robusta \(\d+\)"$/.test(i)), JSON.stringify(items));
        items = await complete(s, `form set ${FORM} title Rob`);
        assert.deepEqual(items, [], 'not for other fields');
      }],

      ['form set: Label (id), a label, several, none', async () => {
        let r = await set(s, 'field_sf_nodes.0', `${target} (${targetId})`);
        assert.equal(r.data.to, `${target} (${targetId})`);
        r = await set(s, 'field_sf_nodes.0', target.toUpperCase());
        assert.equal(r.data.to, `${target} (${targetId})`, 'a label, any case, becomes Label (id)');
        r = await set(s, 'field_sf_user', 'admin');
        assert.equal(r.data.to, 'admin (1)');
        let m = await refused(s, 'field_sf_nodes.0', twin);
        assert.match(m, /2 in field_sf_nodes\.0 match/);
        for (const id of twins) assert.ok(m.includes(`${twin} (${id})`), m);
        m = await refused(s, 'field_sf_user', 'adm');
        assert.match(m, /nothing in field_sf_user matches "adm".*Close: admin \(1\).*form search/);
        m = await refused(s, 'field_sf_user', '1');
        assert.match(m, /nothing in field_sf_user matches "1"/, 'a bare id is a label, as for the widget');
        const got = await s.ok('form get', { form: FORM, field: 'field_sf_nodes.0' });
        assert.equal(got.data.value, `${target} (${targetId})`, 'a refused value changes nothing');
        r = await set(s, 'field_sf_user', '');
        assert.equal(r.data.to, '', 'empty clears');
        // A person's pick shows up too.
        await s.page.fill('[name="field_sf_user[0][target_id]"]', 'admin (1)');
        assert.equal((await s.ok('form get', { form: FORM, field: 'field_sf_user' })).data.value, 'admin (1)');
      }],

      ['tags: labels, Label (id), quotes, autocreate', async () => {
        const r = await set(s, 'field_sf_tags', `arabica, "${newTag}", Robusta`);
        assert.match(r.data.to, new RegExp(`^Arabica \\(\\d+\\), "${newTag.replace(/[[\]()]/g, '\\$&')}", Robusta \\(\\d+\\)$`), r.data.to);
        assert.equal(
          await s.page.inputValue('[name="field_sf_tags[target_id]"]'),
          r.data.to,
          'the input holds the value',
        );
      }],

      ['links: a title, a URL, a path, <front>', async () => {
        let r = await set(s, 'field_sf_links.0.uri', target);
        assert.equal(r.data.to, `${target} (${targetId})`);
        await set(s, 'field_sf_links.0.title', 'Internal');
        let m = await refused(s, 'field_sf_links.0.uri', 'example.com');
        assert.match(m, /URL with its protocol.*a path starting with \//);
        m = await refused(s, 'field_sf_links.0.uri', twin);
        assert.match(m, /2 in field_sf_links\.0\.uri match/);
        let a = await s.ok('form add', { form: FORM, field: 'field_sf_links' });
        assert.deepEqual(a.data.added, ['field_sf_links.1.uri', 'field_sf_links.1.title']);
        r = await set(s, 'field_sf_links.1.uri', 'https://example.com/a?b=c');
        assert.equal(r.data.to, 'https://example.com/a?b=c');
        await set(s, 'field_sf_links.1.title', 'External');
        a = await s.ok('form add', { form: FORM, field: 'field_sf_links' });
        await set(s, 'field_sf_links.2.uri', '<front>');
        await set(s, 'field_sf_links.2.title', 'Home');
        const f = await s.fields();
        assert.equal(f['field_sf_links.0.uri'].value, `${target} (${targetId})`, 'earlier items keep their values');
        assert.equal(f['field_sf_tags'].value.startsWith('Arabica'), true, 'other fields too');
      }],

      ['several nodes: add, save, reopen, remove', async () => {
        let a = await s.ok('form add', { form: FORM, field: 'field_sf_nodes' });
        assert.deepEqual(a.data.added, ['field_sf_nodes.1']);
        await set(s, 'field_sf_nodes.1', `${twin} (${twins[1]})`);
        await set(s, 'title', title(group, 'round trip'));
        await set(s, 'status', 'false');
        await s.save();
        nid = await s.nid();
        assert.ok(nid, `saved: landed on ${s.page.url()}`);
        await s.edit(nid);
        const f = await s.fields(EDIT_FORM);
        assert.equal(f['field_sf_nodes.0'].value, `${target} (${targetId})`);
        assert.equal(f['field_sf_nodes.1'].value, `${twin} (${twins[1]})`);
        assert.equal(f.field_sf_user.value, 'admin (1)', 'as the person picked it');
        assert.match(f.field_sf_tags.value, new RegExp(`^Arabica \\(\\d+\\), "${newTag.replace(/[[\]()]/g, '\\$&')} \\(\\d+\\)", Robusta \\(\\d+\\)$`), 'the new tag was created');
        assert.equal(f['field_sf_links.0.uri'].value, `${target} (${targetId})`);
        assert.equal(f['field_sf_links.1.uri'].value, 'https://example.com/a?b=c');
        assert.equal(f['field_sf_links.1.title'].value, 'External');
        assert.equal(f['field_sf_links.2.uri'].value, '<front>');
        const stored = drush('sql:query', `SELECT GROUP_CONCAT(field_sf_links_uri ORDER BY delta SEPARATOR ' ') FROM node__field_sf_links WHERE entity_id = ${nid}`);
        assert.equal(stored, `entity:node/${targetId} https://example.com/a?b=c internal:/`);
        let st = await s.ok('form status', { form: EDIT_FORM });
        assert.deepEqual(st.data.unsaved, [], JSON.stringify(st.data.unsaved));

        await s.ok('form remove', { form: EDIT_FORM, item: 'field_sf_nodes.0' });
        let g = await s.fields(EDIT_FORM);
        assert.equal(g['field_sf_nodes.0'].value, `${twin} (${twins[1]})`, 'the items after it move up');
        await set(s, 'field_sf_tags', 'Liberica', EDIT_FORM);
        await s.save(EDIT_FORM);
        await s.edit(nid);
        g = await s.fields(EDIT_FORM);
        assert.equal(g['field_sf_nodes.0'].value, `${twin} (${twins[1]})`);
        assert.ok(!g['field_sf_nodes.1'] || g['field_sf_nodes.1'].value === '', JSON.stringify(g['field_sf_nodes.1']));
        assert.match(g.field_sf_tags.value, /^Liberica \(\d+\)$/);
        st = await s.ok('form status', { form: EDIT_FORM });
        assert.deepEqual(st.data.unsaved, []);
      }],

      ['Authored by on another content type', async () => {
        await s.open('/node/add/article');
        const f = await s.fields('node-article-form');
        assert.equal(f.uid?.type, 'reference');
        await set(s, 'uid', '', 'node-article-form');
        const r = await set(s, 'uid', 'ADMIN', 'node-article-form');
        assert.equal(r.data.to, 'admin (1)');
      }],

      ['errors from Drupal are reported by field', async () => {
        await s.add();
        await set(s, 'title', title(group, 'invalid'));
        await set(s, 'status', 'false');
        await set(s, 'field_sf_nodes.0', 'Gone (999999)');
        await set(s, 'field_sf_user', 'Nobody (999999)');
        // Link text without a URL: Drupal's states make the URL required.
        await set(s, 'field_sf_links.0.title', 'Nowhere');
        const no = await s.call('form save', { form: FORM });
        assert.equal(no.code, 1);
        assert.match(no.message, /field_sf_links\.0\.uri/);
        await set(s, 'field_sf_links.0.title', '');
        await s.save();
        const st = await s.ok('form status', { form: FORM });
        const by = Object.fromEntries(st.data.errors.map((e) => [e.field, e.message]));
        assert.match(by['field_sf_nodes.0'] || '', /999999/, JSON.stringify(st.data.errors));
        assert.match(by.field_sf_user || '', /999999/, JSON.stringify(st.data.errors));
        const f = await s.fields();
        assert.equal(f['field_sf_nodes.0'].value, 'Gone (999999)', 'the form comes back as it was sent');
      }],
    ]);
  } finally {
    await s.close();
    cleanup(group);
    cleanupTerms();
  }
}
