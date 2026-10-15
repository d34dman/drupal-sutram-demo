/**
 * @file
 * The form provider: commands for the content entity forms on this page.
 *
 *   form <form-id> status | fields | get | set | save | discard
 *
 * The server describes each form in drupalSettings.sutram.forms (see
 * SutramForms.php): a command-safe id, the entity, and the editable fields as
 * dotted paths, each with the name of the input that holds it. This file
 * is Drupal's integration, not Sutram core: it reads and fills those inputs
 * (and CKEditor, for HTML fields), so the form on the page and the commands
 * always agree. What a person types into the form shows up in `status`, and
 * what `set` changes shows up in the form.
 *
 * Nothing reaches the server until `save`, which submits the real form, the
 * same as clicking Save: Drupal validates, checks access and runs its hooks.
 * If the form comes back with errors, `status` lists them by field.
 *
 * Loaded as an ES module after sutram/sutram, which defines globalThis.Sutram.
 */

const { register, CommandError, EXIT } = globalThis.Sutram;
const forms = (globalThis.drupalSettings && globalThis.drupalSettings.sutram && globalThis.drupalSettings.sutram.forms) || {};
const NONE = { type: "object", properties: {} };
const YES = new Set(["true", "yes", "y", "on", "1"]);
const NO = new Set(["false", "no", "n", "off", "0"]);

// HTML from CKEditor and from the server differ in whitespace only.
const normal = (v) => (typeof v === "string" ? v.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim() : v);
const same = (a, b) => normal(a) === normal(b);
const isEmpty = (v) => v === "" || v === null || v === undefined || (typeof v === "string" && !normal(v.replace(/<[^>]*>/g, "")));
function short(v) {
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "(empty)";
  return JSON.stringify(s.length > 48 ? `${s.slice(0, 47)}…` : s);
}

for (const form of Object.values(forms)) provide(form);

function provide(form) {
  const base = `form ${form.id}`;
  const e = form.entity || {};
  const what = e.id ? `${e.bundle || e.type} "${e.label}"` : `new ${e.bundle || e.type}`;
  const fields = form.fields.filter((f) => f.type !== "unsupported");
  const byPath = new Map(fields.map((f) => [f.field, f]));
  const paths = fields.map((f) => f.field);
  const errors = (form.errors || []).map((err) => ({ field: err.field || "", message: err.message }));

  const root = () => document.querySelector(`form[data-drupal-selector="${CSS.escape(form.selector)}"]`);
  const inputOf = (f) => {
    const r = root();
    return r && f.name ? r.querySelector(`[name="${CSS.escape(f.name)}"]:is(input, textarea, select)`) : null;
  };
  const editorOf = (el) => {
    const id = el && el.getAttribute("data-ckeditor5-id");
    return id && globalThis.Drupal && Drupal.CKEditor5Instances ? Drupal.CKEditor5Instances.get(id) : null;
  };

  function read(f) {
    const el = inputOf(f);
    if (!el) return f.value;
    if (f.type === "boolean") return el.checked;
    const editor = editorOf(el);
    return editor ? editor.getData() : el.value;
  }

  function write(f, value) {
    const el = inputOf(f);
    if (!el) throw new CommandError(`${base} set: the input for ${f.field} is not on the page.`, EXIT.FAILED);
    if (f.type === "boolean") el.checked = value;
    else {
      const editor = editorOf(el);
      if (editor) editor.setData(value);
      else el.value = value;
    }
    // Drupal's own behaviours (states, vertical tab summaries) listen for these.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function coerce(f, raw) {
    const s = String(raw);
    if (f.type === "boolean") {
      const v = s.trim().toLowerCase();
      if (YES.has(v)) return true;
      if (NO.has(v)) return false;
      throw new CommandError(`${base} set: ${f.field} is a yes/no field. Use true or false.`, EXIT.USAGE);
    }
    if (f.type === "choice") {
      const options = f.options || {};
      if (Object.hasOwn(options, s)) return s;
      const byLabel = Object.keys(options).find((k) => options[k].toLowerCase() === s.trim().toLowerCase());
      if (byLabel !== undefined) return byLabel;
      throw new CommandError(`${base} set: ${f.field} takes one of: ${Object.keys(options).slice(0, 12).join(", ")}.`, EXIT.USAGE);
    }
    if (f.type === "number" && s.trim() !== "" && !Number.isFinite(Number(s))) {
      throw new CommandError(`${base} set: ${f.field} takes a number.`, EXIT.USAGE);
    }
    return s;
  }

  const unsaved = () => fields
    .map((f) => ({ field: f.field, from: f.value, to: read(f) }))
    .filter((c) => !same(c.from, c.to));

  const fieldInput = {
    type: "string",
    enum: paths,
    description: `A field of this form, such as ${paths.slice(0, 3).join(", ")}. ${base} fields lists them all.`,
  };
  const example = (path, value) => (byPath.has(path) ? [`${base} set ${path} ${value}`] : []);

  register({
    name: `${base} status`,
    provider: base,
    description: `Show the unsaved changes and the errors in the ${what} form`,
    input: NONE,
    output: {
      type: "object",
      required: ["form", "unsaved", "errors"],
      properties: {
        form: { type: "string" },
        entity: { type: "object", properties: { type: { type: "string" }, bundle: { type: "string" }, id: { description: "null for a new entity" }, label: { type: "string" } } },
        unsaved: { type: "array", items: { type: "object", properties: { field: { type: "string" }, from: {}, to: {} } } },
        errors: { type: "array", items: { type: "object", properties: { field: { type: "string", description: "Empty for an error about the whole form" }, message: { type: "string" } } } },
      },
    },
    annotations: { readOnly: true },
    seeAlso: [`${base} fields`, `${base} save`],
    run() {
      const changes = unsaved();
      const lines = [];
      if (errors.length) {
        lines.push(`Not saved: Drupal found ${errors.length === 1 ? "an error" : `${errors.length} errors`}.`);
        for (const err of errors) lines.push(`  ${err.field || "form"}: ${err.message}`);
      }
      lines.push(changes.length
        ? `${errors.length ? "Changed since the page loaded" : "Unsaved changes"} in ${what}: ${changes.map((c) => c.field).join(", ")}. ${base} save sends them.`
        : `No unsaved changes in ${what}.`);
      return { text: lines.join("\n"), data: { form: form.id, entity: e, unsaved: changes, errors } };
    },
  });

  register({
    name: `${base} fields`,
    provider: base,
    description: `List the fields of the ${what} form with their type and current value`,
    input: NONE,
    output: {
      type: "object",
      required: ["fields"],
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            required: ["field", "type"],
            properties: {
              field: { type: "string", title: "Field" },
              label: { type: "string" },
              type: { type: "string", description: "string, text, html, choice, boolean, reference, references, number, or unsupported" },
              required: { type: "boolean" },
              value: {},
              options: { type: "object", description: "For choice fields: allowed keys and their labels" },
            },
          },
        },
      },
    },
    view: { columns: ["field", "label", "type", "required", "value"] },
    annotations: { readOnly: true },
    seeAlso: [`${base} get`, `${base} set`],
    run() {
      return {
        data: {
          fields: form.fields.map((f) => ({
            field: f.field,
            label: f.label,
            type: f.type,
            required: !!f.required,
            value: f.type === "unsupported" ? "" : read(f),
            ...(f.options ? { options: f.options } : {}),
          })),
        },
      };
    },
  });

  register({
    name: `${base} get`,
    provider: base,
    description: `Show one field's current value in the ${what} form, in full`,
    input: { type: "object", properties: { field: fieldInput }, required: ["field"] },
    positional: ["field"],
    output: { type: "object", required: ["field", "value"], properties: { field: { type: "string" }, value: {} } },
    annotations: { readOnly: true },
    examples: [`${base} get ${paths[0]}`],
    seeAlso: [`${base} set`],
    run({ field }) {
      const value = read(byPath.get(field));
      return { text: typeof value === "boolean" ? short(value) : String(value), data: { field, value } };
    },
  });

  register({
    name: `${base} set`,
    provider: base,
    description: `Change a field in the ${what} form. Nothing is saved until ${base} save`,
    input: {
      type: "object",
      properties: {
        field: fieldInput,
        value: {
          type: "string",
          description: "The new value. Yes/no fields take true or false, lists take a key or its label, tags take names separated by commas, HTML fields take HTML such as <p>…</p>",
        },
      },
      required: ["field", "value"],
    },
    positional: ["field", "value"],
    output: { type: "object", required: ["field", "to"], properties: { field: { type: "string" }, from: {}, to: {} } },
    annotations: {},
    examples: [
      ...example("title", '"Pour-over, step by step"'),
      ...example("body.summary", "A 15 g to 250 g recipe"),
      ...example("field_tags", "coffee, v60"),
      ...example("status", "false"),
    ],
    seeAlso: [`${base} status`, `${base} save`],
    run({ field, value }) {
      const f = byPath.get(field);
      const next = coerce(f, value);
      const from = read(f);
      write(f, next);
      const to = read(f);
      return { text: `${field}: ${short(from)} → ${short(to)}. Not saved yet.`, data: { field, from, to } };
    },
  });

  register({
    name: `${base} save`,
    provider: base,
    description: `Save the ${what} form, the same as clicking Save. The page reloads`,
    input: NONE,
    output: { type: "object", required: ["form", "submitted"], properties: { form: { type: "string" }, submitted: { type: "boolean" } } },
    annotations: { consequential: true, navigates: true },
    confirm() {
      const status = byPath.get("status");
      const changes = unsaved().length;
      const publish = status && read(status) ? " It will be published." : "";
      return `Save ${what}${changes ? ` with ${changes} change${changes === 1 ? "" : "s"}` : ""}?${publish}`;
    },
    seeAlso: [`${base} status`, "page status"],
    run() {
      const r = root();
      const button = r && form.submit ? r.querySelector(`[data-drupal-selector="${CSS.escape(form.submit)}"]`) : null;
      if (!button) throw new CommandError(`${base} save: this form has no Save button the user may click.`, EXIT.FAILED);
      // Checked here, so a caller gets exit 1 instead of a browser bubble nobody sees.
      const missing = fields.filter((f) => f.required && isEmpty(read(f))).map((f) => f.field);
      if (missing.length) {
        throw new CommandError(`${base} save: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required. Set ${missing.length === 1 ? "it" : "them"} first, for example: ${base} set ${missing[0]} …`, EXIT.FAILED);
      }
      if (!r.checkValidity()) {
        const invalid = fields.filter((f) => { const el = inputOf(f); return el && el.validity && !el.validity.valid; });
        throw new CommandError(`${base} save: the browser rejects ${invalid.map((f) => `${f.field} (${inputOf(f).validationMessage})`).join(", ") || "a field"}.`, EXIT.FAILED);
      }
      // Submit after the result has been delivered to the caller.
      setTimeout(() => button.click(), 0);
      return {
        text: `Saving ${what}. The page reloads; then page status shows where it went, or ${base} status shows errors if the form comes back.`,
        data: { form: form.id, submitted: true },
      };
    },
  });

  register({
    name: `${base} discard`,
    provider: base,
    description: `Undo the unsaved changes in the ${what} form`,
    input: NONE,
    output: { type: "object", required: ["discarded"], properties: { discarded: { type: "array", items: { type: "string" } } } },
    annotations: { consequential: true },
    confirm() {
      const changes = unsaved();
      return changes.length ? `Discard the unsaved changes in ${changes.map((c) => c.field).join(", ")}?` : "There are no unsaved changes. Run anyway?";
    },
    seeAlso: [`${base} status`],
    run() {
      const changes = unsaved();
      for (const c of changes) write(byPath.get(c.field), c.from);
      return {
        text: changes.length ? `Discarded changes in ${changes.map((c) => c.field).join(", ")}.` : "Nothing to discard.",
        data: { discarded: changes.map((c) => c.field) },
      };
    },
  });
}
