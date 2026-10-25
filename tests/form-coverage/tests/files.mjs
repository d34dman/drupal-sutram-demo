// files: file fields with several files and a description (field_sf_files,
// txt and pdf), an image with a required alt text (field_sf_image).
//
// form upload from text, base64, a same-origin URL, several URLs at once, and
// from the person (the console's file picker, or the field's own input);
// refusals in the browser (extension) and on the server (not an image);
// cross-origin URLs; form submit with the alt text missing; save and reopen;
// form remove, form discard putting a removed file back.
//
// Cleans up its nodes and the files it uploaded (temporary or permanent).

import { assert, session, steps, title, cleanup, drush, FORM, EDIT_FORM, SITE } from '../lib.mjs';

export const group = 'files';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const fid = (value) => Number(String(value).match(/\((\d+)\)$/)?.[1]);

export async function run() {
  const s = await session();
  const fids = new Set();
  const keep = (r) => (r.data?.uploaded || []).forEach((a) => fids.add(a.fid));
  const upload = async (input) => {
    const r = await s.ok('form upload', { form: FORM, ...input });
    keep(r);
    return r;
  };
  let nid = null;
  try {
    return await steps(group, [
      ['describes file and image fields', async () => {
        await s.add();
        const f = await s.fields();
        assert.equal(f['field_sf_files.0'].type, 'file');
        assert.equal(f['field_sf_files.0'].value, '');
        assert.equal(f.field_sf_image.type, 'image');
        assert.equal(f['field_sf_image.alt'], undefined, 'no alt text before there is an image');
        await s.ok('form set', { form: FORM, field: 'title', value: title(group, 'round trip') });
        await s.ok('form set', { form: FORM, field: 'status', value: 'false' });
      }],

      ['a file that is not an image is refused by the server', async () => {
        const r = await s.call('form upload', { form: FORM, field: 'field_sf_image', name: 'fake.png', text: 'not an image' });
        assert.equal(r.code, 1, r.message);
        assert.match(r.message, /field_sf_image: .*(image file is invalid|image type is not allowed)/i);
        const f = await s.fields();
        assert.equal(f.field_sf_image.value, '');
      }],

      ['upload text: a new item, with its description path', async () => {
        const r = await upload({ field: 'field_sf_files', name: 'form-coverage-notes.txt', text: 'Grind at 18.', description: 'Notes' });
        assert.equal(r.data.uploaded.length, 1);
        const a = r.data.uploaded[0];
        assert.equal(a.field, 'field_sf_files.0');
        assert.equal(a.filename, 'form-coverage-notes.txt');
        assert.equal(a.size, 12);
        assert.deepEqual(a.paths, ['field_sf_files.0.description']);
        const f = await s.fields();
        assert.equal(f['field_sf_files.0'].value, `form-coverage-notes.txt (${a.fid})`);
        assert.equal(f['field_sf_files.0.description'].value, 'Notes');
        assert.equal(f['field_sf_files.1'].value, '', 'an empty item takes the next upload');
        const got = await s.ok('form get', { form: FORM, field: 'field_sf_files.0' });
        assert.equal(fid(got.data.value), a.fid);
        const st = await s.ok('form status', { form: FORM });
        assert.ok(st.data.unsaved.some((c) => c.field === 'field_sf_files.0'), 'an upload is an unsaved change');
      }],

      ['upload base64, then several same-origin URLs at once', async () => {
        const r = await upload({ field: 'field_sf_files', name: 'form-coverage-b64.txt', base64: Buffer.from('base64 content').toString('base64') });
        assert.equal(r.data.uploaded[0].field, 'field_sf_files.1');
        const several = await upload({ field: 'field_sf_files', source: '/core/lib/README.txt /core/misc/logo/LICENSE.txt' });
        assert.deepEqual(several.data.uploaded.map((a) => [a.field, a.filename]), [
          ['field_sf_files.2', 'README.txt'],
          ['field_sf_files.3', 'LICENSE.txt'],
        ]);
        const f = await s.fields();
        assert.equal(f['field_sf_files.4'].value, '');
      }],

      ['a wrong extension is refused in the browser', async () => {
        const r = await s.call('form upload', { form: FORM, field: 'field_sf_files', name: 'notes.exe', text: 'no' });
        assert.equal(r.code, 1, r.message);
        assert.match(r.message, /notes\.exe cannot be uploaded\. Only files with the following extensions are allowed: txt, pdf/);
        const f = await s.fields();
        assert.equal(f['field_sf_files.4'].value, '', 'nothing was added');
      }],

      ['URLs: cross-origin refused clearly, 404, no name, too large', async () => {
        const cross = await s.call('form upload', { form: FORM, field: 'field_sf_files', source: `${SITE}:1/notes.txt` });
        assert.equal(cross.code, 1);
        assert.match(cross.message, /Cross-site URLs are not supported/);
        const missing = await s.call('form upload', { form: FORM, field: 'field_sf_files', source: '/sites/default/files/form-coverage-nope.txt' });
        assert.equal(missing.code, 1);
        assert.match(missing.message, /HTTP 404/);
        const noName = await s.call('form upload', { form: FORM, field: 'field_sf_files', text: 'x' });
        assert.equal(noName.code, 2);
        const big = await s.call('form upload', { form: FORM, field: 'field_sf_files', name: 'big.txt', base64: 'A'.repeat(8 * 1024 * 1024) });
        assert.equal(big.code, 2);
        assert.match(big.message, /too large to pass here/);
      }],

      ['upload an image by URL; the alt text becomes a path', async () => {
        const r = await upload({ field: 'field_sf_image', source: '/core/misc/druplicon.png' });
        const a = r.data.uploaded[0];
        assert.equal(a.field, 'field_sf_image');
        assert.match(a.filename, /^druplicon(_\d+)?\.png$/);
        assert.equal(a.mime, 'image/png');
        assert.deepEqual(a.paths, ['field_sf_image.alt']);
        assert.match(r.text, /Required before form submit: form set .* field_sf_image\.alt/);
        const f = await s.fields();
        assert.equal(f['field_sf_image.alt'].type, 'string');
        assert.equal(f['field_sf_image.alt'].required, true);
        const again = await s.call('form upload', { form: FORM, field: 'field_sf_image', name: 'pixel.png', base64: PNG });
        assert.equal(again.code, 2);
        assert.match(again.message, /already holds druplicon.*form remove/);
      }],

      ['save without the required alt text is refused', async () => {
        const r = await s.call('form submit', { form: FORM });
        assert.equal(r.code, 1);
        assert.match(r.message, /field_sf_image\.alt is required/);
      }],

      ['remove an item; the files after it move up', async () => {
        const before = await s.fields();
        const third = before['field_sf_files.3'].value;
        const r = await s.ok('form remove', { form: FORM, target: 'field_sf_files.2' });
        assert.equal(r.data.files, 3);
        const f = await s.fields();
        assert.equal(f['field_sf_files.2'].value, third);
        assert.equal(f['field_sf_files.3'].value, '');
        const bad = await s.call('form remove', { form: FORM, target: 'field_sf_files.3' });
        assert.equal(bad.code, 2, 'an empty item has nothing to remove');
      }],

      ['set the alt text, save, reopen the edit form', async () => {
        await s.ok('form set', { form: FORM, field: 'field_sf_image.alt', value: 'The Drupal drop' });
        await s.ok('form set', { form: FORM, field: 'field_sf_files.1.description', value: 'Encoded' });
        await s.save();
        nid = await s.nid();
        assert.ok(nid, `saved: landed on ${s.page.url()}`);
        await s.edit(nid);
        const f = await s.fields(EDIT_FORM);
        assert.match(f.field_sf_image.value, /^druplicon(_\d+)?\.png \(\d+\)$/);
        assert.equal(f['field_sf_image.alt'].value, 'The Drupal drop');
        assert.match(f['field_sf_files.0'].value, /^form-coverage-notes(_\d+)?\.txt \(\d+\)$/);
        assert.equal(f['field_sf_files.0.description'].value, 'Notes');
        assert.equal(f['field_sf_files.1.description'].value, 'Encoded');
        assert.match(f['field_sf_files.2'].value, /^LICENSE(_\d+)?\.txt/);
        assert.equal(f['field_sf_files.3'].value, '');
        const st = await s.ok('form status', { form: EDIT_FORM });
        assert.deepEqual(st.data.unsaved, [], JSON.stringify(st.data.unsaved));
      }],

      ['edit: remove, then discard puts the saved files back', async () => {
        const before = await s.fields(EDIT_FORM);
        await s.ok('form remove', { form: EDIT_FORM, target: 'field_sf_files.0' });
        await s.ok('form remove', { form: EDIT_FORM, target: 'field_sf_image' });
        const st = await s.ok('form status', { form: EDIT_FORM });
        assert.ok(st.data.unsaved.some((c) => c.field === 'field_sf_image'));
        const set = await s.call('form set', { form: EDIT_FORM, field: 'field_sf_image', value: 'other.png (999999)' });
        assert.equal(set.code, 2, 'form set does not take other files');
        await s.ok('form discard', { form: EDIT_FORM });
        const f = await s.fields(EDIT_FORM);
        for (const p of ['field_sf_image', 'field_sf_image.alt', 'field_sf_files.0', 'field_sf_files.0.description', 'field_sf_files.1', 'field_sf_files.2']) {
          assert.equal(f[p] && f[p].value, before[p].value, p);
        }
        const after = await s.ok('form status', { form: EDIT_FORM });
        assert.deepEqual(after.data.unsaved, [], JSON.stringify(after.data.unsaved));
      }],

      ['edit: remove the image, save: it is gone', async () => {
        await s.ok('form remove', { form: EDIT_FORM, target: 'field_sf_image' });
        await s.save(EDIT_FORM);
        await s.edit(nid);
        const f = await s.fields(EDIT_FORM);
        assert.equal(f.field_sf_image.value, '');
        assert.equal(f['field_sf_image.alt'], undefined);
      }],

      ['without a source, the command waits for the person to choose in the field', async () => {
        await s.add();
        const name = 'form-coverage-picked.txt';
        // Called as an agent: no user activation, so no picker; the field's
        // own input is focused and the command waits for it.
        const pending = s.call('form upload', { form: FORM, field: 'field_sf_files' });
        await s.page.waitForFunction(() => document.activeElement?.matches('input[type="file"][name^="files[field_sf_files_"]'));
        await s.page.setInputFiles('input[type="file"][name^="files[field_sf_files_"]', { name, mimeType: 'text/plain', buffer: Buffer.from('picked') });
        const r = await pending;
        assert.equal(r.code, 0, r.message);
        keep(r);
        assert.equal(r.data.uploaded[0].filename, name);
      }],

      ['waiting for the person can be cancelled', async () => {
        // The person says yes in the dialog; the agent then gives up while
        // the command waits in the field.
        const pending = s.approving(s.page.evaluate((form) => {
          window.ctrl = new AbortController();
          return window.Sutram.call('form upload', { form, field: 'field_sf_files' }, { signal: window.ctrl.signal })
            .then((r) => r.code === window.Sutram.EXIT.CANCELLED);
        }, FORM));
        await s.page.waitForFunction(() => document.activeElement?.matches('input[type="file"][name^="files[field_sf_files_"]'));
        await s.page.evaluate(() => window.ctrl.abort());
        assert.ok(await pending, 'cancelled');
        // Nothing is left listening: a later upload works as usual.
        await upload({ field: 'field_sf_files', name: 'form-coverage-after.txt', text: 'after' });
      }],

      ['at the console, Enter opens the browser file picker', async () => {
        const opened = await s.page.evaluate(() => {
          const c = document.querySelector('sutram-console');
          c.open();
          return !!c;
        });
        assert.ok(opened);
        // The console also shows the agent's uploads above: wait for one more.
        const uploads = () => s.page.evaluate(() => document.querySelector('sutram-console').transcript().split('Uploaded to').length);
        const before = await uploads();
        await s.page.keyboard.type(`form upload ${FORM} field_sf_files`);
        await s.page.keyboard.press('Enter');
        // A consequential command asks first; the answer is a key press too.
        await s.page.waitForFunction(() => /\?/.test(document.querySelector('sutram-console').transcript()));
        const chooser = s.page.waitForEvent('filechooser', { timeout: 5000 });
        await s.page.keyboard.type('y');
        await s.page.keyboard.press('Enter');
        const fc = await chooser;
        assert.equal(fc.isMultiple(), true, 'a field that takes several takes several at once');
        await fc.setFiles({ name: 'form-coverage-console.txt', mimeType: 'text/plain', buffer: Buffer.from('from the console') });
        await s.page.waitForFunction((n) => document.querySelector('sutram-console').transcript().split('Uploaded to').length > n, before, { timeout: 15000 });
        const f = await s.fields();
        const held = Object.values(f).filter((x) => x.type === 'file').map((x) => x.value);
        assert.ok(held.some((v) => v.startsWith('form-coverage-console.txt (')), held.join(' | '));
        held.forEach((v) => fid(v) && fids.add(fid(v)));
      }],
    ]);
  } finally {
    await s.close();
    cleanup(group);
    // The uploaded files, saved or still temporary: content only.
    if (fids.size) {
      try {
        drush('entity:delete', 'file', [...fids].join(','));
      } catch (err) {
        console.error(`  files: could not delete files ${[...fids]}: ${err.message}`);
      }
    }
  }
}
