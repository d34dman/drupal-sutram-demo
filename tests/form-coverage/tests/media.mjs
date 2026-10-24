// media: the media library widget (field_sf_media: takes several, of type
// sutram_form_test_image; one media item, Druplicon, is installed).
//
// The value and its description, form search through the entity autocomplete
// endpoint (and that it refuses a key that does not match), form set by
// label, by id and as Label (id), form pick, the order, removal through the
// Remove buttons, refusals (a type the field does not take, with the widget
// empty and not, an unknown id or label), save and reopen, form discard.
// Too many items cannot be tested here: the field takes any number.
//
// Makes two media items of its own (one of the field's type, one image of
// the demo's Image type) and deletes them, their files and its nodes after.

import { assert, session, steps, title, cleanup, deleteFiles, drush, FORM, EDIT_FORM } from '../lib.mjs';

export const group = 'media';

const DRUPLICON = 'Druplicon (1)';

/** Makes a media item with a copy of druplicon.png: [mid, fid]. */
function makeMedia(bundle, field, name) {
  const php = `
    $file = \\Drupal::service('file.repository')->writeData(
      file_get_contents(DRUPAL_ROOT . '/core/misc/druplicon.png'),
      'public://form-coverage-media.png',
      \\Drupal\\Core\\File\\FileExists::Rename);
    $media = \\Drupal\\media\\Entity\\Media::create([
      'bundle' => '${bundle}',
      'name' => '${name.replace(/'/g, "\\'")}',
      '${field}' => ['target_id' => $file->id(), 'alt' => 'form coverage'],
    ]);
    $media->save();
    echo $media->id(), ' ', $file->id();`;
  return drush('php:eval', php).split(/\s+/).map(Number);
}

export async function run() {
  const s = await session();
  const made = [];
  let nid = null;
  let second;
  let wrong;
  const get = async (form = FORM) => (await s.ok('form get', { form, field: 'field_sf_media' })).data.value;
  try {
    const stamp = Date.now().toString(36);
    const secondName = `[form-coverage] media Second ${stamp}`;
    const wrongName = `[form-coverage] media Wrong ${stamp}`;
    const [secondId, secondFid] = makeMedia('sutram_form_test_image', 'field_sf_media_image', secondName);
    made.push([secondId, secondFid]);
    const [wrongId, wrongFid] = makeMedia('image', 'field_media_image', wrongName);
    made.push([wrongId, wrongFid]);
    second = `${secondName} (${secondId})`;
    wrong = `${wrongName} (${wrongId})`;

    return await steps(group, [
      ['describes the media field, empty', async () => {
        await s.add();
        const f = await s.fields();
        assert.equal(f.field_sf_media.type, 'media');
        assert.equal(f.field_sf_media.value, '');
        assert.equal(f.field_sf_media.required, false);
        assert.equal(f['field_sf_media.0'], undefined, 'one path for the whole selection');
        const d = await s.page.evaluate((id) => JSON.parse(drupalSettings.sutram.forms[id].fields.field_sf_media).items[0], FORM);
        assert.deepEqual(d.types, { sutram_form_test_image: 'Sutram form test image' });
        assert.equal(d.cardinality, -1);
        assert.match(d.search, /^\/entity_reference_autocomplete\/media\/default%3Amedia\/[\w-]+$/);
        await s.ok('form set', { form: FORM, field: 'title', value: title(group, 'round trip') });
        await s.ok('form set', { form: FORM, field: 'status', value: 'false' });
      }],

      ['form search lists media of the allowed types only', async () => {
        const r = await s.ok('form search', { form: FORM, field: 'field_sf_media', text: 'dru' });
        assert.deepEqual(r.data.candidates, [{ value: DRUPLICON, label: 'Druplicon', id: '1' }]);
        const own = await s.ok('form search', { form: FORM, field: 'field_sf_media', text: stamp });
        assert.deepEqual(own.data.candidates.map((c) => c.value), [second], 'the Image media item is not offered');
      }],

      ['the endpoint refuses a key that does not match its settings', async () => {
        const status = await s.page.evaluate(async (id) => {
          const path = JSON.parse(drupalSettings.sutram.forms[id].fields.field_sf_media).items[0].search;
          const forged = path.replace(/[\w-]+$/, 'forged-key');
          return (await fetch(`${forged}?q=dru`, { credentials: 'same-origin' })).status;
        }, FORM);
        assert.equal(status, 403);
      }],

      ['a type the field does not take is refused, with the widget empty', async () => {
        const r = await s.call('form set', { form: FORM, field: 'field_sf_media', value: String(wrongId) });
        assert.equal(r.code, 1, r.message);
        assert.match(r.message, /is not of an accepted type\. Allowed types: Sutram form test image/);
        assert.equal(await get(), '', 'it was taken out again');
        const label = await s.call('form set', { form: FORM, field: 'field_sf_media', value: wrongName });
        assert.equal(label.code, 2, 'a label of another type is not found');
        assert.match(label.message, /no media in field_sf_media is called/);
      }],

      ['set by label: "Label (id)", an unsaved change', async () => {
        const r = await s.ok('form set', { form: FORM, field: 'field_sf_media', value: 'druplicon' });
        assert.equal(r.data.to, DRUPLICON);
        assert.equal(await get(), DRUPLICON);
        const st = await s.ok('form status', { form: FORM });
        assert.deepEqual(st.data.unsaved.find((c) => c.field === 'field_sf_media'), { field: 'field_sf_media', from: '', to: DRUPLICON });
      }],

      ['form pick by id adds; Drupal refuses another type itself', async () => {
        const r = await s.ok('form pick', { form: FORM, field: 'field_sf_media', media: String(secondId) });
        assert.deepEqual(r.data.added, [{ id: String(secondId), label: secondName, type: 'sutram_form_test_image' }]);
        assert.equal(r.data.value, `${DRUPLICON}, ${second}`);
        const again = await s.call('form pick', { form: FORM, field: 'field_sf_media', media: DRUPLICON });
        assert.equal(again.code, 2);
        assert.match(again.message, /already holds/);
        const bad = await s.call('form pick', { form: FORM, field: 'field_sf_media', media: wrong });
        assert.equal(bad.code, 1, bad.message);
        assert.match(bad.message, /is not of an accepted type/);
        assert.equal(await get(), `${DRUPLICON}, ${second}`);
        const missing = await s.call('form pick', { form: FORM, field: 'field_sf_media', media: '999999' });
        assert.equal(missing.code, 1);
        assert.match(missing.message, /did not add media 999999/);
        const notMedia = await s.call('form pick', { form: FORM, field: 'title', media: '1' });
        assert.equal(notMedia.code, 2);
      }],

      ['set changes the order, and removes with the Remove buttons', async () => {
        await s.ok('form set', { form: FORM, field: 'field_sf_media', value: `${second}, ${DRUPLICON}` });
        assert.equal(await get(), `${second}, ${DRUPLICON}`);
        const weights = await s.page.evaluate(() =>
          [...document.querySelectorAll('.js-media-library-widget .js-media-library-item')].map((el) => [
            el.querySelector('input[name$="[target_id]"]').value,
            el.querySelector('.js-media-library-item-weight').value,
          ]),
        );
        assert.deepEqual(weights, [[String(secondId), '0'], ['1', '1']], 'moved, with the weights Drupal saves');
        const r = await s.ok('form set', { form: FORM, field: 'field_sf_media', value: String(secondId) });
        assert.equal(r.data.to, second);
        await s.ok('form pick', { form: FORM, field: 'field_sf_media', media: 'Druplicon' });
        assert.equal(await get(), `${second}, ${DRUPLICON}`);
      }],

      ['save, then the edit form holds the media in their order', async () => {
        await s.save();
        nid = await s.nid();
        assert.ok(nid, `saved: landed on ${s.page.url()}`);
        await s.edit(nid);
        const f = await s.fields(EDIT_FORM);
        assert.equal(f.field_sf_media.value, `${second}, ${DRUPLICON}`);
        const st = await s.ok('form status', { form: EDIT_FORM });
        assert.deepEqual(st.data.unsaved, [], JSON.stringify(st.data.unsaved));
      }],

      ['edit: remove everything, then discard puts it back', async () => {
        await s.ok('form set', { form: EDIT_FORM, field: 'field_sf_media', value: '' });
        assert.equal(await get(EDIT_FORM), '');
        const st = await s.ok('form status', { form: EDIT_FORM });
        assert.deepEqual(st.data.unsaved.map((c) => c.field), ['field_sf_media']);
        await s.ok('form discard', { form: EDIT_FORM });
        assert.equal(await get(EDIT_FORM), `${second}, ${DRUPLICON}`);
        const after = await s.ok('form status', { form: EDIT_FORM });
        assert.deepEqual(after.data.unsaved, [], JSON.stringify(after.data.unsaved));
      }],

      ['edit: a new order and a removal are saved', async () => {
        await s.ok('form set', { form: EDIT_FORM, field: 'field_sf_media', value: `${DRUPLICON}, ${second}` });
        await s.save(EDIT_FORM);
        await s.edit(nid);
        assert.equal(await get(EDIT_FORM), `${DRUPLICON}, ${second}`);
        await s.ok('form set', { form: EDIT_FORM, field: 'field_sf_media', value: second });
        await s.save(EDIT_FORM);
        await s.edit(nid);
        assert.equal(await get(EDIT_FORM), second);
      }],
    ]);
  } finally {
    await s.close();
    cleanup(group);
    if (made.length) {
      try {
        drush('entity:delete', 'media', made.map(([mid]) => mid).join(','));
      } catch (err) {
        console.error(`  media: could not delete media ${made.map(([mid]) => mid)}: ${err.message}`);
      }
      deleteFiles(made.map(([, fid]) => fid), group);
    }
  }
}
