// basic: strings, numbers, email, telephone, a checkbox, a select, single
// references, tags; plus what every group relies on: multiple value paths,
// form add / remove, descriptions refreshed by AJAX, errors by field.

import { assert, session, steps, title, cleanup, deleteFiles, drush, FORM, EDIT_FORM } from '../lib.mjs';

export const group = 'basic';

/** The fids of the files this group uploads, since it started. */
const uploaded = (since) =>
  drush(
    'sql:query',
    `SELECT fid FROM file_managed WHERE filename REGEXP '^(pixel|note)(_[0-9]+)?[.](png|txt)$' AND uri LIKE 'public://sutram-form-test/%' AND uid = 1 AND created >= ${since}`,
  )
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x));

export async function run() {
  // A few seconds early: the site's clock may differ a little.
  const started = Math.floor(Date.now() / 1000) - 5;
  const s = await session();
  let nid = null;
  const name = title(group, 'round trip');
  try {
    return await steps(group, [
      ['describes the basic fields', async () => {
        await s.add();
        const f = await s.fields();
        const types = {
          title: 'string',
          field_sf_string: 'string',
          'field_sf_strings.0': 'string',
          field_sf_number: 'number',
          field_sf_email: 'string',
          field_sf_phone: 'string',
          field_sf_boolean: 'boolean',
          field_sf_term: 'choice',
          field_sf_user: 'reference',
          field_sf_tags: 'references',
          status: 'boolean',
        };
        for (const [path, type] of Object.entries(types)) {
          assert.ok(f[path], `${path} is described`);
          assert.equal(f[path].type, type, `${path} type`);
        }
        assert.equal(f.title.required, true);
        assert.ok(Object.values(f.field_sf_term.options).includes('Robusta'));
        assert.equal(f.field_sf_strings, undefined, 'a multiple field has numbered paths');
      }],

      ['set and get, with coercion', async () => {
        await s.ok('form set', { form: FORM, field: 'title', value: name });
        await s.ok('form set', { form: FORM, field: 'field_sf_string', value: 'single' });
        const bad = await s.call('form set', { form: FORM, field: 'field_sf_number', value: 'many' });
        assert.equal(bad.code, 2, 'a number field refuses words');
        await s.ok('form set', { form: FORM, field: 'field_sf_number', value: '42' });
        await s.ok('form set', { form: FORM, field: 'field_sf_email', value: 'test@example.com' });
        await s.ok('form set', { form: FORM, field: 'field_sf_phone', value: '+49 40 123' });
        await s.ok('form set', { form: FORM, field: 'field_sf_boolean', value: 'yes' });
        const term = await s.ok('form set', { form: FORM, field: 'field_sf_term', value: 'robusta' });
        assert.match(String(term.data.to), /^\d+$/, 'a choice label becomes its key');
        await s.ok('form set', { form: FORM, field: 'field_sf_tags', value: 'alpha, beta' });
        // Kept unpublished: test content stays out of listings.
        await s.ok('form set', { form: FORM, field: 'status', value: 'false' });
        const got = await s.ok('form get', { form: FORM, field: 'field_sf_number' });
        assert.equal(got.data.value, '42');
        const unknown = await s.call('form set', { form: FORM, field: 'field_sf_nope', value: 'x' });
        assert.equal(unknown.code, 2);
      }],

      ['form add on a multiple field, values kept through AJAX', async () => {
        await s.ok('form set', { form: FORM, field: 'field_sf_strings.0', value: 'one' });
        const r = await s.ok('form add', { form: FORM, field: 'field_sf_strings' });
        assert.deepEqual(r.data.added, ['field_sf_strings.1']);
        assert.equal(r.data.item, 'field_sf_strings.1');
        const f = await s.fields();
        assert.equal(f['field_sf_strings.0'].value, 'one', 'the first item kept its value');
        assert.equal(f['field_sf_strings.1'].value, '');
        await s.ok('form set', { form: FORM, field: 'field_sf_strings.1', value: 'two' });
        // Unsaved changes are still measured from the page load, not the AJAX render.
        const st = await s.ok('form status', { form: FORM });
        const changed = st.data.unsaved.map((c) => c.field);
        for (const p of ['title', 'field_sf_strings.0', 'field_sf_strings.1', 'field_sf_number']) {
          assert.ok(changed.includes(p), `${p} is an unsaved change (${changed})`);
        }
      }],

      ['the AJAX render re-describes the field in drupalSettings', async () => {
        const before = await s.page.evaluate(
          (id) => drupalSettings.sutram.forms[id].fields.field_sf_links,
          FORM,
        );
        await s.ok('form set', { form: FORM, field: 'field_sf_links.0.uri', value: 'https://example.com/a' });
        await s.ok('form add', { form: FORM, field: 'field_sf_links' });
        const after = await s.page.evaluate(
          (id) => JSON.parse(drupalSettings.sutram.forms[id].fields.field_sf_links),
          FORM,
        );
        assert.notEqual(JSON.stringify(after), before);
        assert.deepEqual(
          after.items.map((i) => i.field),
          ['field_sf_links.0.uri', 'field_sf_links.0.title', 'field_sf_links.1.uri', 'field_sf_links.1.title'],
        );
        assert.equal(after.items[0].value, 'https://example.com/a', 'the server saw the value typed before');
      }],

      ['an upload re-describes the field, alone or as a widget', async () => {
        // The image field takes one file: its managed_file element is rendered
        // alone. The files field takes several: the whole widget is.
        for (const field of ['field_sf_image', 'field_sf_files']) {
          await s.page.evaluate(
            ([id, f]) => { drupalSettings.sutram.forms[id].fields[f] = 'stale'; },
            [FORM, field],
          );
          await s.page.evaluate((f) => {
            const input = document.querySelector(`input[type="file"][name^="files[${f}_"]`);
            const dt = new DataTransfer();
            const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
            const txt = new TextEncoder().encode('form coverage');
            dt.items.add(f === 'field_sf_image' ? new File([png], 'pixel.png', { type: 'image/png' }) : new File([txt], 'note.txt', { type: 'text/plain' }));
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }, field);
          await s.page.waitForFunction(
            ([id, f]) => drupalSettings.sutram.forms[id].fields[f] !== 'stale',
            [FORM, field],
            { timeout: 15000 },
          );
          const d = await s.page.evaluate(
            ([id, f]) => JSON.parse(drupalSettings.sutram.forms[id].fields[f]),
            [FORM, field],
          );
          assert.equal(d.label, field === 'field_sf_image' ? 'Image' : 'Files');
        }
        const f = await s.fields();
        assert.ok(f.field_sf_image && f['field_sf_files.0'], 'both fields are still listed');
        // Once the image is there, its alt text is required for form submit. The
        // upload may also have sent nothing: file.js disables file inputs for a
        // second after any AJAX button. files.mjs tests uploads themselves.
        if (f['field_sf_image.alt']) await s.ok('form set', { form: FORM, field: 'field_sf_image.alt', value: 'A pixel' });
      }],

      ['form remove renumbers, and no stale item lingers', async () => {
        await s.ok('form add', { form: FORM, field: 'field_sf_strings' });
        await s.ok('form set', { form: FORM, field: 'field_sf_strings.2', value: 'three' });
        const r = await s.ok('form remove', { form: FORM, target: 'field_sf_strings.1' });
        assert.equal(r.data.items, 2);
        const f = await s.fields();
        assert.equal(f['field_sf_strings.0'].value, 'one');
        assert.equal(f['field_sf_strings.1'].value, 'three');
        assert.equal(f['field_sf_strings.2'], undefined, 'the removed item is gone');
        const bad = await s.call('form remove', { form: FORM, target: 'field_sf_strings.7' });
        assert.equal(bad.code, 2);
        const single = await s.call('form add', { form: FORM, field: 'field_sf_string' });
        assert.equal(single.code, 2, 'a single value field takes no more items');
      }],

      ['save, then the edit form shows the saved values', async () => {
        await s.save();
        nid = await s.nid();
        assert.ok(nid, `saved: landed on ${s.page.url()}`);
        await s.edit(nid);
        const f = await s.fields(EDIT_FORM);
        assert.equal(f.title.value, name);
        assert.equal(f.field_sf_string.value, 'single');
        assert.equal(f['field_sf_strings.0'].value, 'one');
        assert.equal(f['field_sf_strings.1'].value, 'three');
        assert.equal(f.field_sf_number.value, '42');
        assert.equal(f.field_sf_boolean.value, true);
        assert.equal(f.status.value, false);
        assert.match(f.field_sf_tags.value, /alpha \(\d+\), beta \(\d+\)/);
        assert.equal(f['field_sf_links.0.uri'].value, 'https://example.com/a');
        const st = await s.ok('form status', { form: EDIT_FORM });
        assert.deepEqual(st.data.unsaved, [], JSON.stringify(st.data.unsaved));
      }],

      ['edit: add, set, save, and discard', async () => {
        await s.ok('form add', { form: EDIT_FORM, field: 'field_sf_strings' });
        await s.ok('form set', { form: EDIT_FORM, field: 'field_sf_strings.2', value: 'four' });
        await s.ok('form set', { form: EDIT_FORM, field: 'field_sf_string', value: 'changed' });
        const d = await s.ok('form discard', { form: EDIT_FORM });
        assert.ok(d.data.discarded.includes('field_sf_string'));
        await s.ok('form set', { form: EDIT_FORM, field: 'field_sf_strings.2', value: 'four' });
        await s.save(EDIT_FORM);
        await s.edit(nid);
        const f = await s.fields(EDIT_FORM);
        assert.equal(f.field_sf_string.value, 'single');
        assert.deepEqual(
          ['field_sf_strings.0', 'field_sf_strings.1', 'field_sf_strings.2'].map((p) => f[p] && f[p].value),
          ['one', 'three', 'four'],
        );
      }],

      ['errors after a failed save are reported by field', async () => {
        await s.add();
        await s.ok('form set', { form: FORM, field: 'title', value: title(group, 'invalid') });
        await s.ok('form set', { form: FORM, field: 'status', value: 'false' });
        await s.ok('form set', { form: FORM, field: 'field_sf_nodes.0', value: 'Nothing (999999)' });
        await s.save();
        const st = await s.ok('form status', { form: FORM });
        assert.ok(
          st.data.errors.some((e) => e.field === 'field_sf_nodes.0'),
          `errors: ${JSON.stringify(st.data.errors)}`,
        );
        const list = await s.ok('form list');
        assert.ok(list.data.forms.find((x) => x.form === FORM).errors >= 1);
      }],
    ]);
  } finally {
    await s.close();
    cleanup(group);
    // The files the upload step sent (pixel.png, note.txt, or pixel_0.png and
    // so on when Drupal renamed them), saved with the node or still temporary.
    deleteFiles(uploaded(started), group);
  }
}
