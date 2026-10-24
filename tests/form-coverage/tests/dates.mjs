// dates: date only (field_sf_date), date and time (field_sf_datetime),
// datelist (field_sf_datelist, 15 minute steps), daterange
// (field_sf_daterange.value and .end_value), all-day range
// (field_sf_dayrange), timestamp (created). Values are ISO 8601, local time.

import { assert, session, steps, title, cleanup, drush, FORM, EDIT_FORM } from '../lib.mjs';

export const group = 'dates';

const set = (s, field, value, form = FORM) => s.ok('form set', { form, field, value });

// form set that must be refused as a usage error; returns the message.
async function refused(s, field, value, form = FORM) {
  const r = await s.call('form set', { form, field, value });
  assert.equal(r.code, 2, `${field} = ${JSON.stringify(value)} → ${r.code}: ${r.message || r.text}`);
  return r.message || r.text;
}

// The values of the inputs on the page, by name.
const inputs = (s, ...names) =>
  s.page.evaluate((list) => list.map((n) => document.querySelector(`[name="${n}"]`)?.value ?? null), names);

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export async function run() {
  const s = await session();
  let nid = null;
  let created = '';
  const name = title(group, 'round trip');
  try {
    return await steps(group, [
      ['describes each date as one path with its type', async () => {
        await s.add();
        const f = await s.fields();
        const types = {
          field_sf_date: 'date',
          field_sf_datetime: 'datetime',
          field_sf_datelist: 'datetime',
          'field_sf_daterange.value': 'datetime',
          'field_sf_daterange.end_value': 'datetime',
          'field_sf_dayrange.value': 'date',
          'field_sf_dayrange.end_value': 'date',
          created: 'datetime',
        };
        for (const [path, type] of Object.entries(types)) {
          assert.ok(f[path], `${path} is described`);
          assert.equal(f[path].type, type, `${path} type`);
        }
        assert.ok(!f['field_sf_datetime.date'] && !f['field_sf_datelist.year'], 'no paths for the parts');
        assert.equal(f.field_sf_date.value, '');
        assert.equal(f.field_sf_datelist.value, '');
        assert.match(f.created.value, LOCAL, 'Authored on is now, with seconds');
        created = f.created.value;
        const st = await s.ok('form status', { form: FORM });
        assert.deepEqual(st.data.unsaved, [], 'a fresh form has no unsaved changes');
      }],

      ['date only: a date, nothing else', async () => {
        const r = await set(s, 'field_sf_date', '2026-10-24');
        assert.equal(r.data.to, '2026-10-24');
        assert.deepEqual(await inputs(s, 'field_sf_date[0][value][date]'), ['2026-10-24']);
        assert.match(await refused(s, 'field_sf_date', '2026-10-24T14:30'), /holds no time.*YYYY-MM-DD/);
        assert.match(await refused(s, 'field_sf_date', '2026-02-30'), /no day 2026-02-30/);
        assert.match(await refused(s, 'field_sf_date', 'next friday'), /takes a date as YYYY-MM-DD/);
        assert.match(await refused(s, 'field_sf_date', '1850-01-01'), /years from 1900 to 2050/);
        const got = await s.ok('form get', { form: FORM, field: 'field_sf_date' });
        assert.equal(got.data.value, '2026-10-24', 'a refused value changes nothing');
      }],

      ['date and time: ISO with T or a space, seconds optional', async () => {
        let r = await set(s, 'field_sf_datetime', '2026-10-24 14:30');
        assert.equal(r.data.to, '2026-10-24T14:30:00', 'the element takes seconds: read with them');
        assert.deepEqual(await inputs(s, 'field_sf_datetime[0][value][date]', 'field_sf_datetime[0][value][time]'), ['2026-10-24', '14:30:00']);
        r = await set(s, 'field_sf_datetime', '2026-10-25T09:05:07');
        assert.equal(r.data.from, '2026-10-24T14:30:00');
        assert.equal(r.data.to, '2026-10-25T09:05:07');
        assert.match(await refused(s, 'field_sf_datetime', '2026-10-24'), /needs a time too.*YYYY-MM-DDTHH:MM:SS/);
        assert.match(await refused(s, 'field_sf_datetime', '2026-10-24T14:30Z'), /local time in Europe\/Berlin, without a time zone offset/);
        assert.match(await refused(s, 'field_sf_datetime', '2026-10-24T25:00'), /no time/);
      }],

      ['datelist: fills the selects, refuses what they cannot hold', async () => {
        let r = await set(s, 'field_sf_datelist', '2026-10-24T14:30');
        assert.equal(r.data.to, '2026-10-24T14:30', 'no seconds part: read without');
        const names = ['year', 'month', 'day', 'hour', 'minute'].map((p) => `field_sf_datelist[0][value][${p}]`);
        assert.deepEqual(await inputs(s, ...names), ['2026', '10', '24', '14', '30']);
        r = await set(s, 'field_sf_datelist', '2027-01-02 08:00:00');
        assert.equal(r.data.to, '2027-01-02T08:00', ':00 seconds are fine');
        assert.match(await refused(s, 'field_sf_datelist', '2026-10-24T14:10'), /minutes 0, 15, 30, 45/);
        assert.match(await refused(s, 'field_sf_datelist', '2051-01-01T00:00'), /years 1900 to 2050/);
        assert.match(await refused(s, 'field_sf_datelist', '2026-10-24T14:30:15'), /takes no seconds/);
        assert.match(await refused(s, 'field_sf_datelist', '2026-10-24'), /needs a time too/);
        // A person choosing a part shows up; one left out reads as "?".
        await s.page.evaluate(() => {
          const el = document.querySelector('select[name="field_sf_datelist[0][value][minute]"]');
          el.value = '';
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const got = await s.ok('form get', { form: FORM, field: 'field_sf_datelist' });
        assert.equal(got.data.value, '2027-01-02T08:??');
      }],

      ['ranges and Authored on', async () => {
        await set(s, 'field_sf_daterange.value', '2026-11-01T09:00');
        const r = await set(s, 'field_sf_daterange.end_value', '2026-11-03T17:30');
        assert.equal(r.data.to, '2026-11-03T17:30:00');
        await set(s, 'field_sf_dayrange.value', '2026-12-24');
        await set(s, 'field_sf_dayrange.end_value', '2026-12-26');
        assert.match(await refused(s, 'field_sf_dayrange.end_value', '2026-12-26 10:00'), /holds no time/);
        const c = await set(s, 'created', '2025-01-02T03:04:05');
        assert.equal(c.data.from, created);
        assert.equal(c.data.to, '2025-01-02T03:04:05');
        assert.match(await refused(s, 'created', '2040-01-01T00:00'), /years from 1902 to 2037/);
      }],

      ['empty clears; status and discard', async () => {
        let r = await set(s, 'field_sf_date', '');
        assert.equal(r.data.to, '');
        r = await set(s, 'field_sf_datelist', '');
        assert.equal(r.data.to, '');
        const names = ['year', 'month', 'day', 'hour', 'minute'].map((p) => `field_sf_datelist[0][value][${p}]`);
        assert.deepEqual(await inputs(s, ...names), ['', '', '', '', '']);
        await set(s, 'field_sf_date', '2026-10-24');
        let st = await s.ok('form status', { form: FORM });
        const changed = st.data.unsaved.map((c) => c.field).sort();
        assert.deepEqual(changed, [
          'created',
          'field_sf_date',
          'field_sf_daterange.end_value',
          'field_sf_daterange.value',
          'field_sf_datetime',
          'field_sf_dayrange.end_value',
          'field_sf_dayrange.value',
        ], 'the cleared datelist is back where it started');
        await s.ok('form discard', { form: FORM });
        st = await s.ok('form status', { form: FORM });
        assert.deepEqual(st.data.unsaved, [], JSON.stringify(st.data.unsaved));
        const f = await s.fields();
        assert.equal(f.field_sf_datetime.value, '');
        assert.equal(f.created.value, created);
        assert.deepEqual(await inputs(s, 'field_sf_datetime[0][value][date]', 'field_sf_datetime[0][value][time]'), ['', '']);
      }],

      ['save, then the edit form shows the saved dates', async () => {
        await set(s, 'title', name);
        await set(s, 'status', 'false');
        await set(s, 'field_sf_date', '2026-10-24');
        await set(s, 'field_sf_datetime', '2026-10-24T14:30:15');
        await set(s, 'field_sf_datelist', '2026-03-29T02:45');
        await set(s, 'field_sf_daterange.value', '2026-11-01T09:00');
        await set(s, 'field_sf_daterange.end_value', '2026-11-03T17:30');
        await set(s, 'field_sf_dayrange.value', '2026-12-24');
        await set(s, 'field_sf_dayrange.end_value', '2026-12-26');
        await set(s, 'created', '2025-01-02T03:04:05');
        await s.save();
        nid = await s.nid();
        assert.ok(nid, `saved: landed on ${s.page.url()}`);
        await s.edit(nid);
        const f = await s.fields(EDIT_FORM);
        assert.equal(f.field_sf_date.value, '2026-10-24');
        assert.equal(f.field_sf_datetime.value, '2026-10-24T14:30:15');
        // 02:45 on 29 March does not exist in Berlin (clocks go forward):
        // Drupal stores the next real time.
        assert.equal(f.field_sf_datelist.value, '2026-03-29T03:45');
        assert.equal(f['field_sf_daterange.value'].value, '2026-11-01T09:00:00');
        assert.equal(f['field_sf_daterange.end_value'].value, '2026-11-03T17:30:00');
        assert.equal(f['field_sf_dayrange.value'].value, '2026-12-24');
        assert.equal(f['field_sf_dayrange.end_value'].value, '2026-12-26');
        assert.equal(f.created.value, '2025-01-02T03:04:05');
        // Drupal converts when it saves: stored in UTC, two hours behind
        // Berlin in October (summer time), one in January.
        const stored = drush(
          'sql:query',
          `SELECT CONCAT(field_sf_datetime_value, ' ', (SELECT created FROM node_field_data WHERE nid = ${nid})) FROM node__field_sf_datetime WHERE entity_id = ${nid}`,
        );
        assert.equal(stored, `2026-10-24T12:30:15 ${Date.UTC(2025, 0, 2, 2, 4, 5) / 1000}`);
        const st = await s.ok('form status', { form: EDIT_FORM });
        assert.deepEqual(st.data.unsaved, [], JSON.stringify(st.data.unsaved));
      }],

      ['edit: change, discard, clear and save', async () => {
        await set(s, 'field_sf_datelist', '2030-06-15T23:15', EDIT_FORM);
        await set(s, 'field_sf_date', '', EDIT_FORM);
        const d = await s.ok('form discard', { form: EDIT_FORM });
        assert.deepEqual(d.data.discarded.sort(), ['field_sf_date', 'field_sf_datelist']);
        let f = await s.fields(EDIT_FORM);
        assert.equal(f.field_sf_datelist.value, '2026-03-29T03:45');
        assert.equal(f.field_sf_date.value, '2026-10-24');
        await set(s, 'field_sf_date', '', EDIT_FORM);
        await set(s, 'field_sf_datetime', '', EDIT_FORM);
        await set(s, 'field_sf_datelist', '2030-06-15T23:15', EDIT_FORM);
        await s.save(EDIT_FORM);
        await s.edit(nid);
        f = await s.fields(EDIT_FORM);
        assert.equal(f.field_sf_date.value, '');
        assert.equal(f.field_sf_datetime.value, '');
        assert.equal(f.field_sf_datelist.value, '2030-06-15T23:15');
      }],

      ['Authored on of another content type', async () => {
        await s.open('/node/add/article');
        const f = await s.fields('node-article-form');
        assert.equal(f.created?.type, 'datetime', JSON.stringify(f.created));
        const r = await set(s, 'created', '2024-02-29 23:59:59', 'node-article-form');
        assert.equal(r.data.to, '2024-02-29T23:59:59');
        const st = await s.ok('form status', { form: 'node-article-form' });
        assert.deepEqual(st.data.unsaved.map((c) => c.field), ['created']);
      }],

      ['errors from Drupal are reported by field', async () => {
        await s.add();
        await set(s, 'title', title(group, 'invalid'));
        await set(s, 'status', 'false');
        await set(s, 'field_sf_daterange.value', '2026-11-03T09:00');
        await set(s, 'field_sf_daterange.end_value', '2026-11-01T09:00');
        // Half a datelist, as a person might leave it.
        await s.page.evaluate(() => {
          const el = document.querySelector('select[name="field_sf_datelist[0][value][year]"]');
          el.value = '2026';
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await s.save();
        const st = await s.ok('form status', { form: FORM });
        const fields = st.data.errors.map((e) => e.field);
        assert.ok(
          st.data.errors.some((e) => e.field.startsWith('field_sf_daterange') && /end date cannot be before/.test(e.message)),
          `errors: ${JSON.stringify(st.data.errors)}`,
        );
        assert.ok(fields.includes('field_sf_datelist'), `errors: ${JSON.stringify(st.data.errors)}`);
        const f = await s.fields();
        assert.equal(f.field_sf_datelist.value, '2026-??-??T??:??', 'the form comes back as it was sent');
        assert.equal(f['field_sf_daterange.end_value'].value, '2026-11-01T09:00:00');
      }],
    ]);
  } finally {
    await s.close();
    cleanup(group);
  }
}
