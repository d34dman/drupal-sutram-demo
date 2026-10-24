// choices: radios (field_sf_radios; field_sf_flag, a boolean as radios),
// checkboxes (field_sf_checkboxes; field_sf_terms, terms as checkboxes),
// select multiple (field_sf_multiselect); field_sf_term, a single
// options_select, stays the basic group's choice.

import { assert, session, steps, title, cleanup, FORM, EDIT_FORM } from '../lib.mjs';

export const group = 'choices';

// Sets a field and returns the result, failing unless it exits 0.
const set = (s, field, value, form = FORM) => s.ok('form set', { form, field, value });

export async function run() {
  const s = await session();
  let nid = null;
  let terms = {};
  const name = title(group, 'round trip');
  try {
    return await steps(group, [
      ['describes the choice fields with their options', async () => {
        await s.add();
        const f = await s.fields();
        const types = {
          field_sf_radios: 'choice',
          field_sf_flag: 'choice',
          field_sf_checkboxes: 'choices',
          field_sf_terms: 'choices',
          field_sf_multiselect: 'choices',
          field_sf_term: 'choice',
        };
        for (const [path, type] of Object.entries(types)) {
          assert.ok(f[path], `${path} is described`);
          assert.equal(f[path].type, type, `${path} type`);
        }
        assert.deepEqual(f.field_sf_radios.options, { light: 'Light roast', medium: 'Medium roast', dark: 'Dark roast' });
        assert.deepEqual(f.field_sf_flag.options, { 0: 'Off', 1: 'On' }, 'no N/A option: empty clears');
        assert.deepEqual(f.field_sf_multiselect.options, { 1: 'One', 2: 'Two', 3: 'Three', 5: 'Five' }, 'no - None - option');
        assert.equal(f.field_sf_checkboxes.options.pour_over, 'Pour-over, by hand');
        assert.equal(f.field_sf_radios.value, '');
        assert.deepEqual(f.field_sf_checkboxes.value, []);
        assert.deepEqual(f.field_sf_multiselect.value, []);
        terms = Object.fromEntries(Object.entries(f.field_sf_terms.options).map(([k, v]) => [v, k]));
        assert.ok(terms.Arabica && terms.Robusta && terms.Liberica, JSON.stringify(terms));
        const st = await s.ok('form status', { form: FORM });
        assert.deepEqual(st.data.unsaved, [], 'a fresh form has no unsaved changes');
      }],

      ['radios: by key, by label, invalid, clear', async () => {
        let r = await set(s, 'field_sf_radios', 'medium');
        assert.equal(r.data.to, 'medium');
        r = await set(s, 'field_sf_radios', 'dark ROAST');
        assert.equal(r.data.from, 'medium');
        assert.equal(r.data.to, 'dark', 'a label becomes its key');
        assert.equal(await s.page.evaluate(() => document.querySelector('input[name="field_sf_radios"]:checked').value), 'dark', 'the radio on the page is checked');
        const bad = await s.call('form set', { form: FORM, field: 'field_sf_radios', value: 'burnt' });
        assert.equal(bad.code, 2);
        assert.match(bad.message || bad.text, /light \(Light roast\).*dark \(Dark roast\)/, 'the error lists the options');
        r = await set(s, 'field_sf_radios', '');
        assert.equal(r.data.to, '');
        assert.equal(await s.page.evaluate(() => document.querySelector('input[name="field_sf_radios"]:checked')?.value ?? null), '_none', 'clearing checks N/A');
        r = await set(s, 'field_sf_flag', 'on');
        assert.equal(r.data.to, '1');
        r = await set(s, 'field_sf_flag', '');
        assert.equal(r.data.to, '');
        await set(s, 'field_sf_flag', 'Off');
        await set(s, 'field_sf_radios', 'Light roast');
      }],

      ['checkboxes and select multiple: several keys or labels', async () => {
        let r = await set(s, 'field_sf_checkboxes', 'espresso, v60');
        assert.deepEqual(r.data.to, ['v60', 'espresso'], 'read in the order of the options');
        r = await set(s, 'field_sf_checkboxes', 'aeropress, Pour-over, by hand');
        assert.deepEqual(r.data.from, ['v60', 'espresso']);
        assert.deepEqual(r.data.to, ['aeropress', 'pour_over'], 'replaces the selection; a label may hold a comma');
        const checked = await s.page.evaluate(() => [...document.querySelectorAll('input[name^="field_sf_checkboxes["]:checked')].map((e) => e.value));
        assert.deepEqual(checked, ['aeropress', 'pour_over'], 'the checkboxes on the page follow');
        r = await set(s, 'field_sf_checkboxes', '["French press", "v60"]');
        assert.deepEqual(r.data.to, ['v60', 'french_press'], 'a JSON array works too');
        const bad = await s.call('form set', { form: FORM, field: 'field_sf_checkboxes', value: 'v60, kettle' });
        assert.equal(bad.code, 2);
        assert.match(bad.message || bad.text, /"kettle".*v60 \(V60\)/, 'the error names the bad part and lists the options');
        r = await set(s, 'field_sf_checkboxes', '');
        assert.deepEqual(r.data.to, [], 'empty clears');

        r = await set(s, 'field_sf_multiselect', 'three, 1, Five');
        assert.deepEqual(r.data.to, ['1', '3', '5']);
        const selected = await s.page.evaluate(() => [...document.querySelector('select[name="field_sf_multiselect[]"]').selectedOptions].map((o) => o.value));
        assert.deepEqual(selected, ['1', '3', '5']);
        const badm = await s.call('form set', { form: FORM, field: 'field_sf_multiselect', value: '4' });
        assert.equal(badm.code, 2);
        r = await set(s, 'field_sf_multiselect', '');
        assert.deepEqual(r.data.to, []);
        r = await set(s, 'field_sf_terms', 'robusta, Liberica');
        // Terms are listed by name, so are the keys read back.
        assert.deepEqual(r.data.to, [terms.Liberica, terms.Robusta]);
        const got = await s.ok('form get', { form: FORM, field: 'field_sf_terms' });
        assert.deepEqual(got.data.value, [terms.Liberica, terms.Robusta]);
      }],

      ['status and discard compare selections, not their order', async () => {
        await set(s, 'field_sf_checkboxes', 'espresso, v60');
        await set(s, 'field_sf_multiselect', 'Two, One');
        let st = await s.ok('form status', { form: FORM });
        let changed = st.data.unsaved.map((c) => c.field);
        for (const p of ['field_sf_radios', 'field_sf_flag', 'field_sf_checkboxes', 'field_sf_multiselect', 'field_sf_terms']) {
          assert.ok(changed.includes(p), `${p} is an unsaved change (${changed})`);
        }
        const d = await s.ok('form discard', { form: FORM });
        assert.ok(d.data.discarded.includes('field_sf_checkboxes'));
        st = await s.ok('form status', { form: FORM });
        assert.deepEqual(st.data.unsaved, [], JSON.stringify(st.data.unsaved));
        const f = await s.fields();
        assert.deepEqual(f.field_sf_checkboxes.value, []);
        assert.equal(f.field_sf_radios.value, '');
        // A person ticking the boxes in another order is the same selection.
        await set(s, 'field_sf_checkboxes', 'v60');
        await s.page.evaluate(() => {
          const box = document.querySelector('input[name="field_sf_checkboxes[espresso]"]');
          box.checked = true;
          box.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const got = await s.ok('form get', { form: FORM, field: 'field_sf_checkboxes' });
        assert.deepEqual(got.data.value, ['v60', 'espresso'], 'what a person ticks shows up');
      }],

      ['save, then the edit form shows the saved choices', async () => {
        await set(s, 'title', name);
        await set(s, 'status', 'false');
        await set(s, 'field_sf_radios', 'medium');
        await set(s, 'field_sf_flag', 'On');
        await set(s, 'field_sf_checkboxes', 'french_press, Pour-over, by hand, AeroPress');
        await set(s, 'field_sf_multiselect', '5, 2');
        await set(s, 'field_sf_terms', 'arabica, liberica');
        await s.save();
        nid = await s.nid();
        assert.ok(nid, `saved: landed on ${s.page.url()}`);
        await s.edit(nid);
        const f = await s.fields(EDIT_FORM);
        assert.equal(f.field_sf_radios.value, 'medium');
        assert.equal(f.field_sf_flag.value, '1');
        assert.deepEqual(f.field_sf_checkboxes.value, ['aeropress', 'french_press', 'pour_over']);
        assert.deepEqual(f.field_sf_multiselect.value, ['2', '5']);
        assert.deepEqual(f.field_sf_terms.value, [terms.Arabica, terms.Liberica]);
        const st = await s.ok('form status', { form: EDIT_FORM });
        assert.deepEqual(st.data.unsaved, [], JSON.stringify(st.data.unsaved));
      }],

      ['edit: change, discard back to the saved values, clear and save', async () => {
        await set(s, 'field_sf_checkboxes', 'v60', EDIT_FORM);
        await set(s, 'field_sf_radios', '', EDIT_FORM);
        const d = await s.ok('form discard', { form: EDIT_FORM });
        assert.deepEqual(d.data.discarded.sort(), ['field_sf_checkboxes', 'field_sf_radios']);
        let f = await s.fields(EDIT_FORM);
        assert.deepEqual(f.field_sf_checkboxes.value, ['aeropress', 'french_press', 'pour_over']);
        assert.equal(f.field_sf_radios.value, 'medium');
        await set(s, 'field_sf_radios', '', EDIT_FORM);
        await set(s, 'field_sf_flag', '', EDIT_FORM);
        await set(s, 'field_sf_checkboxes', '', EDIT_FORM);
        await set(s, 'field_sf_multiselect', 'three', EDIT_FORM);
        await set(s, 'field_sf_terms', '[]', EDIT_FORM);
        await s.save(EDIT_FORM);
        await s.edit(nid);
        f = await s.fields(EDIT_FORM);
        assert.equal(f.field_sf_radios.value, '');
        assert.equal(f.field_sf_flag.value, '');
        assert.deepEqual(f.field_sf_checkboxes.value, []);
        assert.deepEqual(f.field_sf_multiselect.value, ['3']);
        assert.deepEqual(f.field_sf_terms.value, []);
      }],

      ['errors on a choice field are reported by field', async () => {
        await s.add();
        await set(s, 'title', title(group, 'invalid'));
        await set(s, 'status', 'false');
        // An option that is no longer allowed, as a stale page would send.
        await s.page.evaluate(() => {
          const radio = document.querySelector('input[name="field_sf_radios"][value="dark"]');
          radio.value = 'burnt';
          radio.checked = true;
        });
        await s.save();
        const st = await s.ok('form status', { form: FORM });
        assert.ok(
          st.data.errors.some((e) => e.field === 'field_sf_radios'),
          `errors: ${JSON.stringify(st.data.errors)}`,
        );
      }],
    ]);
  } finally {
    await s.close();
    cleanup(group);
  }
}
