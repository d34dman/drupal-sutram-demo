// @d34dman/sutram 0.2.0: src/browser.js bundled by scripts/build.mjs. Do not edit; run npm run build.

// https://github.com/d34dman/sutram · MIT

// src/formats.js
const __formats = (() => {
// Formats: what a JSON Schema `format` name means on this page.
// JSON Schema treats `format` as an annotation and lets validators add their
// own formats (Ajv: addFormat). Sutram follows that, and adds display: an app
// defines a format once, and every client uses the part it needs. Core checks
// input with `validate`, the console shows values with `display`, and `man`
// and the WebMCP bridge explain it with `description`.
// Sutram defines no domain formats. A format nobody defined stays a plain
// annotation: nothing is checked, and the value is shown as it is.

const FIELDS = ["type", "description", "validate", "display", "align"];

/** The formats JSON Schema draft 2020-12 itself defines. Agents and validators already know them. */
const STANDARD_FORMATS = Object.freeze([
  "date-time", "date", "time", "duration", "email", "idn-email", "hostname", "idn-hostname",
  "ipv4", "ipv6", "uri", "uri-reference", "iri", "iri-reference", "uuid", "uri-template",
  "json-pointer", "relative-json-pointer", "regex",
]);

const NAME = /^[a-z][a-z0-9-]*$/;

function checkFormat(name, def) {
  if (typeof name !== "string" || !NAME.test(name)) throw new TypeError(`formats: "${name}" is not a valid name; use lowercase letters, digits and hyphens`);
  if (!def || typeof def !== "object") throw new TypeError(`formats: "${name}" needs a definition`);
  for (const key of Object.keys(def)) {
    if (!FIELDS.includes(key)) throw new TypeError(`formats: "${name}" has an unknown field "${key}"; use ${FIELDS.join(", ")}`);
  }
  for (const key of ["validate", "display"]) {
    if (def[key] !== undefined && typeof def[key] !== "function") throw new TypeError(`formats: "${name}".${key} must be a function`);
  }
  if (def.align !== undefined && !["left", "right"].includes(def.align)) throw new TypeError(`formats: "${name}".align must be left or right`);
}

/** Display rules for JSON Schema's own date formats. Checking them is left to the schema's author. */
const STANDARD = {
  "date-time": {
    type: "string",
    description: "a date and time, RFC 3339",
    validate: (v) => !Number.isNaN(Date.parse(v)),
    display: (v, { locale } = {}) => new Date(v).toLocaleString(locale),
  },
  date: {
    type: "string",
    description: "a full date, RFC 3339, such as 2026-10-15",
    validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
    display: (v, { locale } = {}) => new Date(`${v}T00:00:00`).toLocaleDateString(locale),
  },
};

/**
 * Creates a format registry. Most pages should use getFormats() instead, so
 * that every copy of Sutram bundled on the page shares one.
 */
function createFormats({ standard = true } = {}) {
  const defs = new Map();
  const formats = {
    /**
     * Defines a format. Returns a function that removes it again.
     * Defining a name that is already taken is refused, so two modules
     * cannot silently disagree about what a format means.
     */
    define(name, def) {
      checkFormat(name, def);
      if (defs.has(name) && defs.get(name) !== def) throw new Error(`formats: "${name}" is already defined`);
      defs.set(name, def);
      return () => { if (defs.get(name) === def) defs.delete(name); };
    },
    get: (name) => defs.get(name),
    has: (name) => defs.has(name),
    list: () => [...defs.entries()].map(([name, def]) => ({ name, ...def })),

    /** True when the value passes the format's check, or when the format has none. */
    valid(name, value) {
      const def = defs.get(name);
      if (!def || !def.validate) return true;
      try { return !!def.validate(value); } catch (err) { return false; }
    },
  };
  if (standard) for (const [name, def] of Object.entries(STANDARD)) formats.define(name, def);
  return formats;
}

const FORMATS_KEY = Symbol.for("sutram.formats@1");

/** The page's one format registry, shared by every copy of Sutram loaded on it. */
function getFormats() {
  if (!globalThis[FORMATS_KEY]) globalThis[FORMATS_KEY] = createFormats();
  return globalThis[FORMATS_KEY];
}
return { STANDARD_FORMATS, createFormats, getFormats };
})();

// src/core.js
const __core = (() => {
// Sutram core: a registry of commands and nothing else.
// It checks definitions and input, runs handlers, and announces changes.
// It holds no app state and touches no DOM.

const { getFormats } = __formats;

/** Exit codes, borrowed from the shell. */
const EXIT = Object.freeze({
  OK: 0,
  FAILED: 1,
  USAGE: 2,
  NOT_FOUND: 127,
  CANCELLED: 130, // 128 + SIGINT, as a shell reports Ctrl+C
});

/** Top-level words that belong to clients. No provider may register them. */
const RESERVED_WORDS = Object.freeze(["help", "man", "status", "clear"]);

/** Options that belong to clients: -h/--help, --json[=fields] and --wide. */
const CLIENT_OPTIONS = Object.freeze(["help", "json", "wide"]);

const REQUIRED_FIELDS = ["name", "provider", "description", "input", "annotations"];
const NAME = /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/;

class CommandError extends Error {
  constructor(message, code = EXIT.FAILED) {
    super(message);
    this.name = "CommandError";
    this.code = code;
  }
}

/** Resolves a local `$ref` such as `#/$defs/item` against the schema it came from. */
function deref(schema, root) {
  if (!schema || !schema.$ref) return schema;
  const path = schema.$ref.replace(/^#\//, "").split("/");
  return path.reduce((node, key) => (node ? node[key] : undefined), root);
}

function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

/** What a failed format check says, from the format's own description. */
const formatError = (formats, name) => {
  const def = formats.get(name);
  return def && def.description ? `${name}, ${def.description}` : `a valid ${name}`;
};

/**
 * Checks input against the subset of JSON Schema commands use, and coerces
 * strings typed in a console into the declared types. A `format` is checked
 * when the format registry defines it. Returns { errors, value }.
 */
function checkInput(schema, input = {}, formats = getFormats()) {
  const errors = [];
  const value = {};
  const props = (schema && schema.properties) || {};
  const required = (schema && schema.required) || [];

  for (const key of Object.keys(input)) {
    if (!props[key]) errors.push(`unknown argument "${key}"`);
  }
  for (const [key, prop] of Object.entries(props)) {
    let v = input[key];
    if (v === undefined || v === "") {
      if (prop.default !== undefined) v = prop.default;
      else {
        if (required.includes(key)) errors.push(`${key} is required`);
        continue;
      }
    }
    if (prop.type === "integer" || prop.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || (prop.type === "integer" && !Number.isInteger(n))) {
        errors.push(`${key} must be ${prop.type === "integer" ? "a whole number" : "a number"}`);
        continue;
      }
      if (prop.minimum !== undefined && n < prop.minimum) errors.push(`${key} must be at least ${prop.minimum}`);
      if (prop.maximum !== undefined && n > prop.maximum) errors.push(`${key} must be at most ${prop.maximum}`);
      v = n;
    } else if (prop.type === "boolean") {
      if (typeof v !== "boolean") {
        const s = String(v).toLowerCase();
        if (["true", "yes", "on", "1"].includes(s)) v = true;
        else if (["false", "no", "off", "0"].includes(s)) v = false;
        else { errors.push(`${key} must be true or false`); continue; }
      }
    } else if (prop.type === "array") {
      v = Array.isArray(v) ? v : String(v).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (prop.type === "string") {
      v = String(v);
    }
    if (prop.enum && !prop.enum.includes(v)) errors.push(`${key} must be one of: ${prop.enum.join(", ")}`);
    if (prop.format && !formats.valid(prop.format, v)) errors.push(`${key} must be ${formatError(formats, prop.format)}`);
    value[key] = v;
  }
  return { errors, value };
}

/**
 * A shallow check of a result against an output schema: types, required keys
 * and defined formats, following arrays into their first item. Returns null
 * when it matches, or a message naming the first field that does not.
 */
function checkOutput(schema, data, root = schema, formats = getFormats()) {
  schema = deref(schema, root);
  if (schema && schema.format && !formats.valid(schema.format, data)) return `expected ${formatError(formats, schema.format)}`;
  if (!schema || !schema.type) return null;
  const t = typeOf(data);
  const ok = t === schema.type || (schema.type === "number" && t === "integer");
  if (!ok) return `expected ${schema.type}, got ${t}`;
  if (t === "object") {
    for (const key of schema.required || []) if (!(key in data)) return `${key} is missing`;
    for (const [key, prop] of Object.entries(schema.properties || {})) {
      if (data[key] === undefined) continue;
      const err = checkOutput(prop, data[key], root, formats);
      if (err) return `${key}: ${err}`;
    }
  }
  if (t === "array" && schema.items && data.length) {
    const err = checkOutput(schema.items, data[0], root, formats);
    if (err) return `[0]: ${err}`;
  }
  return null;
}

function checkDefinition(def) {
  for (const field of REQUIRED_FIELDS) {
    if (!def || def[field] === undefined) throw new TypeError(`register: "${(def && def.name) || "?"}" has no ${field}`);
  }
  if (typeof def.run !== "function") throw new TypeError(`register: "${def.name}" has no run function`);
  if (!NAME.test(def.name)) throw new TypeError(`register: "${def.name}" is not a valid name; use lowercase words separated by single spaces`);
  if (RESERVED_WORDS.includes(def.name.split(" ")[0])) throw new TypeError(`register: "${def.name}" starts with a word reserved for clients`);
  for (const key of CLIENT_OPTIONS) {
    if (def.input.properties && def.input.properties[key]) throw new TypeError(`register: "${def.name}" cannot declare --${key}; clients own it`);
  }
  for (const key of def.positional || []) {
    if (!def.input.properties || !def.input.properties[key]) throw new TypeError(`register: "${def.name}" lists positional "${key}", which its input does not declare`);
  }
}

/**
 * Creates a registry. Most pages should use getRegistry() instead, so that
 * every copy of Sutram bundled on the page shares one list.
 */
function createRegistry({ checkResults = true, formats = getFormats() } = {}) {
  const commands = new Map();
  const changeFns = new Set();
  const runFns = new Set();
  const resultFns = new Set();

  const notify = (fns, event) => fns.forEach((fn) => {
    try { fn(event); } catch (err) { console.error(err); }
  });

  const registry = {
    /** The format registry this registry checks input and results against. */
    formats,

    /**
     * Adds a command. Returns a function that removes it again.
     * Registering a name another definition owns is refused.
     */
    register(def) {
      checkDefinition(def);
      const existing = commands.get(def.name);
      if (existing && existing !== def) {
        throw new Error(`register: "${def.name}" already belongs to ${existing.provider}; ${def.provider} cannot replace it`);
      }
      commands.set(def.name, def);
      notify(changeFns, { type: "register", name: def.name, def });
      return () => {
        if (commands.get(def.name) !== def) return;
        commands.delete(def.name);
        notify(changeFns, { type: "unregister", name: def.name, def });
      };
    },

    get: (name) => commands.get(name),
    has: (name) => commands.has(name),
    /** Every command on the page right now, sorted by name. */
    list: () => [...commands.values()].sort((a, b) => a.name.localeCompare(b.name)),

    /** Called on every register and unregister. Returns a function that stops listening. */
    onChange(fn) { changeFns.add(fn); return () => changeFns.delete(fn); },
    /** Called before every run, with { name, input, caller }. */
    onRun(fn) { runFns.add(fn); return () => runFns.delete(fn); },
    /** Called after every run that got as far as the handler, with { name, input, caller, result }. */
    onResult(fn) { resultFns.add(fn); return () => resultFns.delete(fn); },

    /**
     * Runs a command. Always resolves to a result:
     * { code: 0, text?, data? } on success, { code, message } otherwise.
     */
    async run(name, input = {}, { caller = "code", signal } = {}) {
      const def = commands.get(name);
      if (!def) return { code: EXIT.NOT_FOUND, message: `${name}: command not found` };
      const { errors, value } = checkInput(def.input, input, formats);
      if (errors.length) return { code: EXIT.USAGE, message: `${name}: ${errors.join("; ")}` };
      if (signal && signal.aborted) return { code: EXIT.CANCELLED, message: `${name}: cancelled` };

      notify(runFns, { name, input: value, caller });
      const result = await (async () => {
        try {
          const res = (await def.run(value, { caller, signal })) || {};
          if (checkResults && def.output && res.data !== undefined) {
            const err = checkOutput(def.output, res.data, def.output, formats);
            if (err) console.warn(`sutram: ${name} returned data that does not match its output schema: ${err}`);
          }
          return { code: EXIT.OK, ...res };
        } catch (err) {
          if (signal && signal.aborted) return { code: EXIT.CANCELLED, message: `${name}: cancelled` };
          return { code: err && Number.isInteger(err.code) ? err.code : EXIT.FAILED, message: (err && err.message) || String(err) };
        }
      })();
      notify(resultFns, { name, input: value, caller, result });
      return result;
    },
  };
  return registry;
}

const REGISTRY_KEY = Symbol.for("sutram.registry@1");

/** The page's one registry, shared by every copy of Sutram loaded on it. */
function getRegistry() {
  if (!globalThis[REGISTRY_KEY]) globalThis[REGISTRY_KEY] = createRegistry();
  return globalThis[REGISTRY_KEY];
}

/** True for a command that follows the status convention: `<provider> status`, read-only. */
const isStatusCommand = (def) => / status$/.test(def.name) && !!def.annotations.readOnly;

/**
 * Runs every `<provider> status` command, the way a bare `status` does.
 * Resolves to [{ provider, code, text?, data?, message? }].
 */
async function runStatus(registry, { caller = "status", signal } = {}) {
  const results = [];
  for (const def of registry.list().filter(isStatusCommand)) {
    results.push({ provider: def.provider, ...(await registry.run(def.name, {}, { caller, signal })) });
  }
  return results;
}
return { EXIT, RESERVED_WORDS, CLIENT_OPTIONS, CommandError, deref, checkInput, checkOutput, createRegistry, getRegistry, isStatusCommand, runStatus };
})();

// src/parse.js
const __parse = (() => {
// The command line: GNU long options, POSIX-style quoting, `--` to end options.
// Sutram parses one command line. It is not a shell: no pipes, redirection,
// variables or globbing.

const { CommandError, EXIT, RESERVED_WORDS, CLIENT_OPTIONS } = __core;

/**
 * Splits a line into words. Double and single quotes group words, and a
 * backslash escapes the next character outside single quotes.
 * Each token is { value, quoted }; quoted means the word starts with a quote.
 */
function tokenize(line) {
  const tokens = [];
  let current = null;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === "\\" && quote === '"' && i + 1 < line.length) { current.value += line[++i]; continue; }
      current.value += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = null; }
      continue;
    }
    if (!current) current = { value: "", quoted: false };
    // A word is quoted, and so never an option, when it starts with a quote:
    // --who="Grace Hopper" is an option with a quoted value.
    if (ch === '"' || ch === "'") { quote = ch; if (!current.value) current.quoted = true; continue; }
    if (ch === "\\" && i + 1 < line.length) { current.value += line[++i]; continue; }
    current.value += ch;
  }
  if (quote) throw new CommandError(`unclosed ${quote === '"' ? "double" : "single"} quote`, EXIT.USAGE);
  if (current) tokens.push(current);
  return tokens;
}

/** Edit distance, for "did you mean". */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** The closest command name to what was typed, like git's "did you mean". Suggests only; never runs it. */
function suggest(registry, words) {
  const names = [...registry.list().map((d) => d.name), ...RESERVED_WORDS];
  const tries = [words.slice(0, 3).join(" "), words.slice(0, 2).join(" "), words[0]].filter(Boolean);
  let best = null;
  for (const attempt of tries) {
    for (const name of names) {
      const score = distance(attempt, name);
      if (score <= 2 && (!best || score < best.score)) best = { name, score };
    }
  }
  return best ? best.name : null;
}

/**
 * Parses a line against the registry. The longest registered name that the
 * line starts with wins. Returns { def, input, help, json, wide, fields }, or throws a
 * CommandError with exit code 2 (usage) or 127 (not found).
 */
function parse(registry, line) {
  const tokens = tokenize(line);
  if (!tokens.length) throw new CommandError("nothing to run", EXIT.USAGE);

  for (let k = Math.min(tokens.length, 6); k > 0; k--) {
    if (tokens.slice(0, k).some((t) => t.quoted)) continue;
    const name = tokens.slice(0, k).map((t) => t.value).join(" ").toLowerCase();
    const def = registry.get(name);
    if (!def) continue;
    return parseArguments(def, tokens.slice(k));
  }

  const words = tokens.map((t) => t.value.toLowerCase());
  const guess = suggest(registry, words);
  throw new CommandError(
    `${words.slice(0, 2).join(" ")}: command not found.${guess ? ` The most similar command is: ${guess}` : " See help."}`,
    EXIT.NOT_FOUND,
  );
}

function parseArguments(def, rest) {
  const name = def.name;
  const props = def.input.properties || {};
  const input = {};
  const positional = [];
  let help = false;
  let json = false;
  let wide = false;
  let fields = null;
  let endOfOptions = false;

  for (let i = 0; i < rest.length; i++) {
    const { value: raw, quoted } = rest[i];
    const option = !endOfOptions && !quoted;
    if (option && raw === "--") { endOfOptions = true; continue; }
    if (option && (raw === "-h" || raw === "--help")) { help = true; continue; }
    if (option && raw === "--json") { json = true; continue; }
    if (option && raw.startsWith("--json=")) {
      fields = raw.slice(7).split(",").map((f) => f.trim()).filter(Boolean);
      if (!fields.length) throw new CommandError(`${name}: --json= needs field names, such as --json=sku,price`, EXIT.USAGE);
      json = true;
      continue;
    }
    if (option && raw === "--wide") { wide = true; continue; }
    if (option && raw.startsWith("--")) {
      const m = /^--([a-z][\w-]*)(?:=([\s\S]*))?$/i.exec(raw);
      if (!m) throw new CommandError(`${name}: cannot read option ${raw}`, EXIT.USAGE);
      let [, key, val] = m;
      const negated = key.startsWith("no-") ? key.slice(3) : null;
      if (!props[key] && negated && props[negated] && props[negated].type === "boolean") {
        input[negated] = false;
        continue;
      }
      if (!props[key]) throw new CommandError(`${name}: unknown option --${key}. See ${name} -h`, EXIT.USAGE);
      if (val === undefined) {
        if (props[key].type === "boolean") { input[key] = true; continue; }
        if (i + 1 >= rest.length) throw new CommandError(`${name}: --${key} needs a value`, EXIT.USAGE);
        val = rest[++i].value;
      }
      input[key] = val;
      continue;
    }
    if (option && /^-[a-z]/i.test(raw)) throw new CommandError(`${name}: unknown option ${raw}. See ${name} -h`, EXIT.USAGE);
    positional.push(raw);
  }

  const order = def.positional || [];
  if (positional.length && !order.length) {
    throw new CommandError(`${name}: takes no positional arguments. See ${name} -h`, EXIT.USAGE);
  }
  order.forEach((key, i) => {
    if (i >= positional.length || input[key] !== undefined) return;
    // The last positional takes the rest of the line, so `nav find pour over` works without quotes.
    input[key] = i === order.length - 1 ? positional.slice(i).join(" ") : positional[i];
  });
  return { def, input, help, json, wide, fields };
}

/**
 * Splits a line into spans for syntax highlighting, covering every character,
 * so joining their text gives the line back. Never throws: a half-typed line
 * is the normal case. Each span is { text, kind }, where kind is one of
 * "space", "command" (a registered name), "client" (help, man, status,
 * clear), "unknown" (no such command), "option", "bad-option" (the command
 * has no such option), "value" (an option's value), "string" (a quoted word),
 * or "arg".
 */
function highlight(registry, line) {
  line = String(line);
  // Words with their place in the line, by the same rules as tokenize().
  const words = [];
  let w = null;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (!quote && /\s/.test(ch)) { if (w) { w.end = i; words.push(w); w = null; } continue; }
    if (!w) w = { start: i, value: "", quoted: false };
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length) w.value += line[++i];
      else w.value += ch;
    } else if (ch === '"' || ch === "'") { quote = ch; if (i === w.start) w.quoted = true; }
    else if (ch === "\\" && i + 1 < line.length) w.value += line[++i];
    else w.value += ch;
  }
  if (w) { w.end = line.length; words.push(w); }

  const kinds = words.map(() => "arg");
  // The command: the longest registered name the line starts with.
  let def = null;
  let k = 0;
  for (let n = Math.min(words.length, 6); n > 0 && !def; n--) {
    if (words.slice(0, n).some((x) => x.quoted)) continue;
    def = registry.get(words.slice(0, n).map((x) => x.value).join(" ").toLowerCase()) || null;
    if (def) k = n;
  }
  if (def) kinds.fill("command", 0, k);
  else if (words.length && RESERVED_WORDS.includes(words[0].value.toLowerCase())) { kinds[0] = "client"; k = 1; }
  else if (words.length) {
    // Still typing a name: unknown only once no command starts with it.
    const typed = words.map((x) => x.value.toLowerCase()).join(" ") + (/\s$/.test(line) ? " " : "");
    const names = [...registry.list().map((d) => d.name), ...RESERVED_WORDS];
    if (names.some((n) => n.startsWith(typed))) kinds.fill("command");
    else kinds[0] = "unknown";
    k = words.length;
  }

  const props = (def && def.input && def.input.properties) || {};
  let endOfOptions = false;
  const spans = [];
  let at = 0;
  const push = (text, kind) => { if (text) spans.push({ text, kind }); };
  words.forEach((x, i) => {
    push(line.slice(at, x.start), "space");
    at = x.end;
    const raw = line.slice(x.start, x.end);
    if (i < k) { push(raw, kinds[i]); return; }
    if (!endOfOptions && !x.quoted && raw.startsWith("-")) {
      if (raw === "--") { endOfOptions = true; push(raw, "option"); return; }
      const eq = raw.indexOf("=");
      const name = (eq < 0 ? raw : raw.slice(0, eq)).replace(/^--?/, "");
      const known = raw === "-h" || CLIENT_OPTIONS.includes(name) || !def || props[name]
        || (name.startsWith("no-") && props[name.slice(3)] && props[name.slice(3)].type === "boolean");
      push(eq < 0 ? raw : raw.slice(0, eq + 1), known ? "option" : "bad-option");
      if (eq >= 0) push(raw.slice(eq + 1), /["']/.test(raw.slice(eq + 1)) ? "string" : "value");
      return;
    }
    push(raw, x.quoted ? "string" : "arg");
  });
  push(line.slice(at), "space");
  return spans;
}
return { tokenize, distance, suggest, parse, highlight };
})();

// src/format.js
const __format = (() => {
// Formatting for people. Commands return data; clients decide how it looks.
// Everything here is pure: it turns definitions and results into text blocks
// that a console (or a terminal) can print. No DOM.

const { deref } = __core;
const { getFormats, STANDARD_FORMATS } = __formats;

/**
 * A block of output: { kind, text, head? }.
 * kind is "text", "table", "pairs", "json", "dim", "man" or "error".
 * A table block also has `head`, the header line, so a client can style it.
 */

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isRecords = (v) => Array.isArray(v) && v.length > 0 && v.every(isRecord);

/** Ends a description with exactly one full stop. */
const sentence = (s) => String(s).replace(/\.?\s*$/, ".");

/** The format definition for a property, from the page's format registry. */
const formatOf = (prop, options) => (prop && prop.format ? (options.formats || getFormats()).get(prop.format) : undefined);

/** Formats one value for a table cell or a `key: value` line. */
function formatValue(value, prop = {}, options = {}) {
  if (value === null || value === undefined) return "";
  const fmt = formatOf(prop, options);
  if (fmt && fmt.display) {
    try {
      const shown = fmt.display(value, { locale: options.locale });
      if (shown !== undefined && shown !== null) return String(shown);
    } catch (err) {
      // A format that cannot show this value falls back to the plain value.
    }
  }
  if (Array.isArray(value)) return value.every((x) => typeof x !== "object") ? value.join(", ") : `${value.length} items`;
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * Lays out a list of records as text columns. Records with `children` become
 * an indented tree. Returns { head, rows } as strings.
 */
function formatTable(rows, itemSchema, root, { columns, maxWidth = 40, ...options } = {}) {
  const props = (deref(itemSchema, root) || {}).properties || {};
  const scalar = (k) => {
    const p = deref(props[k], root) || {};
    const fmt = formatOf(p, options);
    return (fmt && fmt.display) || (p.type !== "object" && p.type !== "array");
  };
  const cols = columns || (Object.keys(props).length ? Object.keys(props).filter(scalar) : Object.keys(rows[0]));

  const flat = [];
  (function walk(list, depth) {
    for (const r of list) {
      flat.push([r, depth]);
      if (isRecords(r.children)) walk(r.children, depth + 1);
    }
  })(rows, 0);

  const cells = flat.map(([r, depth]) => cols.map((k, i) => {
    const s = (i === 0 ? "  ".repeat(depth) : "") + formatValue(r[k], props[k], options);
    return s.length > maxWidth ? s.slice(0, maxWidth - 1) + "…" : s;
  }));
  const head = cols.map((k) => String((props[k] && props[k].title) || k).toUpperCase());
  const numeric = cols.map((k) => {
    const fmt = formatOf(props[k], options);
    if (fmt && fmt.align) return fmt.align === "right";
    return !!props[k] && ["number", "integer"].includes(props[k].type);
  });
  const width = cols.map((_, i) => Math.max(head[i].length, ...cells.map((c) => c[i].length)));
  const line = (cs) => cs
    .map((c, i) => (numeric[i] ? c.padStart(width[i]) : i === cs.length - 1 ? c : c.padEnd(width[i])))
    .join("  ")
    .replace(/\s+$/, "");
  return { head: line(head), rows: cells.map(line) };
}

/**
 * Turns a result into blocks for people.
 * - A failure prints its message.
 * - A summary `text`, if any, comes first; then only the lists in `data`.
 * - Without a summary: `key: value` lines for a record, a table for each list.
 * - With { json: true }: the data, unchanged. With { fields }, only those fields.
 * - With { wide: true }: every column, ignoring view.columns.
 */
function formatResult(result, def = {}, options = {}) {
  if (result.code !== 0) return [{ kind: "error", text: result.message || `exit ${result.code}`, code: result.code }];
  if (options.json) {
    let data = result.data === undefined ? null : result.data;
    if (options.fields) {
      const picked = selectFields(data, options.fields, def.output);
      if (picked.error) return [{ kind: "error", text: `${def.name || "--json"}: ${picked.error}`, code: 2 }];
      data = picked.data;
    }
    return [{ kind: "json", text: JSON.stringify(data, null, 2) }];
  }

  const schema = def.output || {};
  const view = def.view || {};
  const data = result.data;
  const blocks = [];
  const tableOpts = { ...options, columns: options.wide ? undefined : view.columns };
  const table = (rows, items) => {
    const { head, rows: lines } = formatTable(rows, items, schema, tableOpts);
    blocks.push({ kind: "table", head, text: [head, ...lines].join("\n") });
  };

  if (result.text) blocks.push({ kind: "text", text: result.text });
  if (data === undefined || data === null) return blocks;

  if (isRecords(data)) { table(data, schema.items); return blocks; }
  if (!isRecord(data)) {
    if (!result.text) blocks.push({ kind: "text", text: formatValue(data, schema, options) });
    return blocks;
  }

  const props = schema.properties || {};
  const pairs = [];
  const lists = [];
  for (const [key, value] of Object.entries(data)) {
    if (isRecords(value)) lists.push([value, deref(props[key], schema)]);
    else if (!result.text && !(Array.isArray(value) && !value.length)) pairs.push([key, formatValue(value, props[key], options)]);
  }
  if (pairs.length) {
    const w = Math.max(...pairs.map(([k]) => k.length)) + 1;
    blocks.push({ kind: "pairs", text: pairs.map(([k, v]) => `${(k + ":").padEnd(w)} ${v}`).join("\n") });
  }
  for (const [rows, prop] of lists) table(rows, prop && prop.items);
  if (!blocks.length) blocks.push({ kind: "dim", text: "Nothing to show." });
  return blocks;
}

/** The fields `--json=` can pick: the properties of each record in a list, or of the record itself. */
function fieldNames(schema, data) {
  schema = deref(schema, schema) || {};
  const target = schema.type === "array" ? deref(schema.items, schema) || {} : schema;
  if (target.properties) return Object.keys(target.properties);
  if (isRecords(data)) return [...new Set(data.flatMap(Object.keys))];
  if (isRecord(data)) return Object.keys(data);
  return [];
}

/**
 * Checks `--json=` field names against a command's output schema before it
 * runs, so a typo never costs a consequential command. Returns a message or null.
 */
function checkFields(def, fields) {
  if (!def.output) return null;
  const known = fieldNames(def.output);
  if (!known.length) return `${def.name}: --json= needs records, and this command returns ${def.output.type || "no fields"}`;
  const unknown = fields.filter((f) => !known.includes(f));
  return unknown.length ? `${def.name}: unknown field ${unknown.map((f) => `"${f}"`).join(", ")}. Available: ${known.join(", ")}` : null;
}

/**
 * Keeps only the named fields, like `gh … --json=a,b`: of each record in a
 * list, or of a single record. Returns { data } or { error }.
 */
function selectFields(data, fields, schema) {
  const known = fieldNames(schema, data);
  if (!isRecord(data) && !isRecords(data)) return { error: "--json= needs records, and this command returned none" };
  const unknown = fields.filter((f) => !known.includes(f));
  if (unknown.length) return { error: `unknown field ${unknown.map((f) => `"${f}"`).join(", ")}. Available: ${known.join(", ")}` };
  const pick = (r) => Object.fromEntries(fields.filter((f) => f in r).map((f) => [f, r[f]]));
  return { data: Array.isArray(data) ? data.map(pick) : pick(data) };
}

/** Quotes a value for a command line only when it needs it, the way a shell user would. */
function quoteArg(value) {
  const s = Array.isArray(value) ? value.join(",") : String(value);
  return s !== "" && /^[\w@%+=:,./-]+$/.test(s) && !s.startsWith("-") ? s : `"${s.replace(/(["\\])/g, "\\$1")}"`;
}

/**
 * The command line that runs a command with this input, such as
 * `form node-article-edit-form set revision_log "Clearer title"`. Positional
 * arguments come first, in order; the rest are long options. Clients use it to
 * show what an agent or a button ran in the words a person would type.
 */
function commandLine(def, input = {}) {
  const parts = [def.name];
  const props = (def.input && def.input.properties) || {};
  const order = def.positional || [];
  const used = new Set();
  for (const key of order) {
    if (input[key] === undefined) break;
    parts.push(quoteArg(input[key]));
    used.add(key);
  }
  for (const [key, value] of Object.entries(input)) {
    if (used.has(key) || value === undefined) continue;
    if (props[key] && props[key].type === "boolean") parts.push(value ? `--${key}` : `--no-${key}`);
    else parts.push(`--${key}=${quoteArg(value)}`);
  }
  return parts.join(" ");
}

/** Plain text for a list of blocks, for terminals and tests. */
const blocksToText = (blocks) => blocks.map((b) => b.text).join("\n");

/** Short usage: positionals first, then options. */
function synopsis(def) {
  const props = def.input.properties || {};
  const required = def.input.required || [];
  const order = def.positional || [];
  const parts = order.map((k) => (required.includes(k) ? `<${k}>` : `[${k}]`));
  for (const k of Object.keys(props)) {
    if (order.includes(k)) continue;
    const p = props[k];
    const s = p.type === "boolean" ? `--${k}` : `--${k}=<${p.enum ? p.enum.join("|") : p.type}>`;
    parts.push(required.includes(k) ? s : `[${s}]`);
  }
  return [def.name, ...parts].join(" ");
}

/** The same usage with every argument as an option, or null when that adds nothing. */
function longSynopsis(def) {
  const props = def.input.properties || {};
  const required = def.input.required || [];
  if (!(def.positional || []).length) return null;
  const parts = Object.keys(props).map((k) => {
    const s = props[k].type === "boolean" ? `--${k}` : `--${k}=<${props[k].type}>`;
    return required.includes(k) ? s : `[${s}]`;
  });
  return [def.name, ...parts].join(" ");
}

/** The annotation label shown next to a command in help. */
function annotationLabel(annotations = {}) {
  if (annotations.readOnly) return "read-only";
  if (annotations.consequential) return "consequential";
  if (annotations.navigates) return "navigates";
  return null;
}

/** `help` and `help <provider>`: one line per command. */
function formatHelp(registry, prefix = "") {
  const list = registry.list().filter((d) => !prefix || d.name === prefix || d.name.startsWith(prefix + " "));
  if (!list.length) return [{ kind: "error", text: `help: nothing called "${prefix}" on this page`, code: 1 }];
  const usages = list.map(synopsis);
  const w = Math.min(40, Math.max(...usages.map((u) => u.length)));
  const lines = list.map((d, i) => {
    const label = annotationLabel(d.annotations);
    return `${usages[i].padEnd(w)}  ${d.description}${label ? `  [${label}]` : ""}`;
  });
  const blocks = [{ kind: "text", text: lines.join("\n"), commands: list }];
  if (!prefix) blocks.push({ kind: "dim", text: "help <provider> · man <command> · <command> -h · <command> --json[=fields] · <command> --wide · status · clear" });
  return blocks;
}

/** `<command> -h`: short usage. */
function formatUsage(def) {
  const lines = [`usage: ${synopsis(def)}`];
  const long = longSynopsis(def);
  if (long && long !== synopsis(def)) lines.push(`   or: ${long}`);
  return [
    { kind: "text", text: lines.join("\n") },
    { kind: "dim", text: `${sentence(def.description)} See man ${def.name} for more.` },
  ];
}

const BUILT_IN_MAN = {
  help: ["help [provider]", "List the commands on this page with their usage and annotations. Generated from the registry; providers write nothing for it."],
  man: ["man <command>", "Show the full manual entry for a command, generated from its definition: arguments from the input schema, output from the output schema, annotations, examples and related commands."],
  status: ["status [--json]", "Run every read-only command named <provider> status, and show what each provider reports about the page right now."],
  clear: ["clear", "Clear the console."],
};

/** ", money: { amount, currency } with an ISO 4217 code." for a property whose format is defined. */
function formatNote(prop, formats) {
  const fmt = prop && prop.format ? formats.get(prop.format) : undefined;
  return fmt && fmt.description && !STANDARD_FORMATS.includes(prop.format) ? ` ${prop.format}: ${sentence(fmt.description)}` : "";
}

/** `man <command>`: the full entry, generated from the definition. */
function formatMan(def, name = def && def.name, formats = getFormats()) {
  if (!def && BUILT_IN_MAN[name]) {
    const [syn, desc] = BUILT_IN_MAN[name];
    return [{ kind: "man", text: [name.toUpperCase(), "", "NAME", `     ${name} - built into every Sutram client`, "", "SYNOPSIS", `     ${syn}`, "", "DESCRIPTION", `     ${desc}`].join("\n") }];
  }
  const props = def.input.properties || {};
  const required = def.input.required || [];
  const head = def.name.toUpperCase();
  const right = `provided by ${def.provider}`;
  const L = [head + " ".repeat(Math.max(2, 64 - head.length - right.length)) + right, "", "NAME", `     ${def.name} - ${def.description}`, "", "SYNOPSIS", `     ${synopsis(def)}`];
  const long = longSynopsis(def);
  if (long && long !== synopsis(def)) L.push(`     ${long}`);

  L.push("", "ARGUMENTS");
  if (!Object.keys(props).length) L.push("     none");
  for (const [k, p] of Object.entries(props)) {
    const bits = [
      p.type,
      p.format,
      required.includes(k) ? "required" : null,
      p.enum ? `one of ${p.enum.join(", ")}` : null,
      p.minimum !== undefined ? `at least ${p.minimum}` : null,
      p.default !== undefined ? `default ${p.default}` : null,
    ].filter(Boolean).join(", ");
    L.push(`     --${k}`, `          ${bits}.${p.description ? " " + sentence(p.description) : ""}${formatNote(p, formats)}`);
  }

  L.push("", "OUTPUT");
  if (!def.output) L.push("     not declared. --json prints whatever the command returns.");
  else {
    const root = def.output;
    (function fields(schema, indent, depth) {
      schema = deref(schema, root);
      if (!schema) return;
      if (schema.type === "array") { fields(schema.items, indent, depth); return; }
      for (const [k, raw] of Object.entries(schema.properties || {})) {
        const p = deref(raw, root) || {};
        const items = p.type === "array" ? deref(p.items, root) || {} : null;
        const isList = items && items.properties;
        const bits = [isList ? "list of records" : items ? `list of ${items.type || "values"}` : p.type, p.format].filter(Boolean).join(", ");
        L.push(`${" ".repeat(indent)}${k}`, `${" ".repeat(indent + 5)}${bits}.${p.description ? " " + sentence(p.description) : ""}${formatNote(p, formats)}`);
        // Recursive schemas, such as a menu tree, are described once.
        if (isList && depth < 2 && !(raw.items && raw.items.$ref && depth > 0)) fields(p.items, indent + 5, depth + 1);
      }
    })(def.output, 5, 0);
    L.push("     The console formats this as text; --wide shows every column. --json prints it unchanged, as an agent gets it, and --json=<field,…> keeps only those fields.");
  }

  const label = annotationLabel(def.annotations);
  const notes = [];
  if (def.annotations.consequential) notes.push("The console asks before running it, and agent hosts ask you.");
  if (def.annotations.navigates) notes.push("Leaves the page; the commands on the next page may differ.");
  L.push("", "ANNOTATIONS", `     ${label || "none: an ordinary write"}${notes.length ? ". " + notes.join(" ") : ""}`);
  L.push("", "EXIT STATUS", "     0 done, 1 failed, 2 usage error, 127 not found, 130 cancelled.");
  if (def.examples && def.examples.length) L.push("", "EXAMPLES", ...def.examples.map((x) => `     ${x}`));
  if (def.seeAlso && def.seeAlso.length) L.push("", "SEE ALSO", `     ${def.seeAlso.join(", ")}`);
  return [{ kind: "man", text: L.join("\n") }];
}

/**
 * A one-line shape of a schema, such as `{ items: [{ sku, qty }], total }`.
 * Used where a full schema cannot go, such as a WebMCP tool description.
 */
function describeShape(schema, root = schema, depth = 0) {
  schema = deref(schema, root);
  if (!schema) return "any";
  // A field with a format is named by its format; formatsUsed() explains it once.
  if (schema.format && depth > 0) return schema.format;
  if (depth > 2) return schema.type === "array" ? "[…]" : "{…}";
  if (schema.type === "array") return `[${describeShape(schema.items, root, depth + 1)}]`;
  if (schema.type === "object" && schema.properties) {
    const fields = Object.entries(schema.properties).map(([k, p]) => {
      const q = deref(p, root);
      if (q && q.format) return `${k}: ${q.format}`;
      return q && (q.type === "array" || (q.type === "object" && q.properties)) ? `${k}: ${describeShape(q, root, depth + 1)}` : k;
    });
    return `{ ${fields.join(", ")} }`;
  }
  return schema.type || "any";
}

/**
 * The page-defined formats a command's input and output use, with their
 * descriptions, for readers that cannot look them up. JSON Schema's own
 * formats are left out: agents already know them.
 */
function formatsUsed(def, formats = getFormats()) {
  const names = new Set();
  const seen = new Set();
  const walk = (schema, root) => {
    schema = deref(schema, root);
    if (!schema || typeof schema !== "object" || seen.has(schema)) return;
    seen.add(schema);
    if (schema.format) names.add(schema.format);
    if (schema.items) walk(schema.items, root);
    for (const p of Object.values(schema.properties || {})) walk(p, root);
  };
  walk(def.input, def.input);
  if (def.output) walk(def.output, def.output);
  return [...names]
    .filter((n) => !STANDARD_FORMATS.includes(n) && formats.get(n) && formats.get(n).description)
    .map((n) => ({ name: n, description: formats.get(n).description }));
}
return { sentence, formatValue, formatTable, formatResult, checkFields, selectFields, commandLine, blocksToText, synopsis, longSynopsis, annotationLabel, formatHelp, formatUsage, formatMan, describeShape, formatsUsed };
})();

// src/index.js
const __index = (() => {
// sutram: the registry, the command line parser and the formatter.
// No DOM. The console, the WebMCP bridge and events are separate entry points:
//   @d34dman/sutram/console, /webmcp, /events, /browser

const { EXIT, RESERVED_WORDS, CLIENT_OPTIONS, CommandError, createRegistry, getRegistry, checkInput, checkOutput, deref, isStatusCommand, runStatus } = __core;
const { tokenize, parse, suggest, distance, highlight } = __parse;
const { createFormats, getFormats, STANDARD_FORMATS } = __formats;
const { formatResult, formatValue, formatTable, blocksToText, formatHelp, formatUsage, formatMan, synopsis, longSynopsis, annotationLabel, describeShape, sentence, checkFields, selectFields, formatsUsed, commandLine } = __format;
return { EXIT, RESERVED_WORDS, CLIENT_OPTIONS, CommandError, createRegistry, getRegistry, checkInput, checkOutput, deref, isStatusCommand, runStatus, tokenize, parse, suggest, distance, highlight, createFormats, getFormats, STANDARD_FORMATS, formatResult, formatValue, formatTable, blocksToText, formatHelp, formatUsage, formatMan, synopsis, longSynopsis, annotationLabel, describeShape, sentence, checkFields, selectFields, formatsUsed, commandLine };
})();

// src/events.js
const __events = (() => {
// Declared events: facts, emitted by their owner and heard by anyone.
// Optional. Commands are for intent ("please do this"); events are for facts
// ("this happened"). It adds `events list` and `events recent`, so agents can
// read what happened after they acted.

const { checkInput, getRegistry } = __core;

function createEvents(registry, { bufferSize = 50 } = {}) {
  const defs = new Map();
  const listeners = new Map();
  const buffer = [];
  let seq = 0;

  const api = {
    /** Declares an event and its payload schema. Only declared events can be emitted. */
    define(name, def) {
      if (defs.has(name)) throw new Error(`events: "${name}" is already defined`);
      defs.set(name, def);
    },

    /** Emits an event. The payload is checked against its schema first. */
    emit(name, payload = {}, { source = "code" } = {}) {
      const def = defs.get(name);
      if (!def) throw new Error(`events: "${name}" is not defined`);
      if (def.payload) {
        const { errors } = checkInput(def.payload, payload, registry.formats);
        if (errors.length) throw new Error(`events: ${name}: ${errors.join("; ")}`);
      }
      const ls = [...(listeners.get(name) || []), ...(listeners.get("*") || [])];
      const event = { id: ++seq, name, payload, source, heardBy: ls.filter((l) => !l.hidden).map((l) => l.as) };
      buffer.push(event);
      if (buffer.length > bufferSize) buffer.shift();
      for (const l of ls) {
        try { l.fn(event); } catch (err) { console.error(err); }
      }
      return event;
    },

    /** Listens for an event, or "*" for all. Returns a function that stops listening. */
    on(name, fn, { as = "anonymous", hidden = false } = {}) {
      const l = { fn, as, hidden };
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(l);
      return () => listeners.set(name, listeners.get(name).filter((x) => x !== l));
    },

    list: () => [...defs.entries()].map(([name, d]) => ({ name, description: d.description })),
    lastId: () => seq,

    /**
     * Forgets buffered events up to an id, by default all of them. Ids keep
     * counting, so an agent's --since stays valid. Runs by itself after a
     * navigates command succeeds; a single-page app whose router changes the
     * page another way calls it too.
     */
    clear(upTo = seq) {
      const keep = buffer.filter((e) => e.id > upTo);
      buffer.splice(0, buffer.length, ...keep);
    },
  };

  // Events from a page the user has left describe things that are gone.
  // Events the navigation itself emitted, such as route.changed, are kept.
  const marks = new Map(); // command name → newest event id when it started
  registry.onRun(({ name }) => {
    const def = registry.get(name);
    if (def && def.annotations.navigates) marks.set(name, seq);
  });
  registry.onResult(({ name, result }) => {
    if (!marks.has(name)) return;
    const mark = marks.get(name);
    marks.delete(name);
    if (result.code === 0) api.clear(mark);
  });

  registry.register({
    name: "events list",
    provider: "events",
    description: "List the events providers on this page have declared",
    input: { type: "object", properties: {} },
    output: {
      type: "object",
      properties: { events: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } } } } },
    },
    annotations: { readOnly: true },
    seeAlso: ["events recent"],
    run: () => ({ data: { events: api.list() } }),
  });

  registry.register({
    name: "events recent",
    provider: "events",
    description: "Show recent events on this page, optionally only those after an event id",
    input: { type: "object", properties: { since: { type: "integer", minimum: 0, default: 0, description: "Only events with a higher id than this" } } },
    output: {
      type: "object",
      required: ["events", "cursor"],
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer", title: "#" },
              name: { type: "string", title: "Event" },
              payload: { type: "object" },
              source: { type: "string", title: "From" },
            },
          },
        },
        cursor: { type: "integer", description: "The newest event id. Pass it as --since next time" },
      },
    },
    view: { columns: ["id", "name", "payload", "source"] },
    annotations: { readOnly: true },
    examples: ["events recent", "events recent --since=4", "events recent --json"],
    seeAlso: ["events list"],
    run({ since }) {
      const events = buffer.filter((e) => e.id > since).map(({ id, name, payload, source }) => ({ id, name, payload, source }));
      const text = events.length ? `${events.length} events. Next time: --since=${seq}` : since ? `No events after #${since}.` : "No events yet.";
      return { text, data: { events, cursor: seq } };
    },
  });

  return api;
}

const EVENTS_KEY = Symbol.for("sutram.events@1");

/** The page's one event bus, shared by every copy of Sutram loaded on it. */
function getEvents(registry = getRegistry()) {
  if (!globalThis[EVENTS_KEY]) globalThis[EVENTS_KEY] = createEvents(registry);
  return globalThis[EVENTS_KEY];
}
return { createEvents, getEvents };
})();

// src/webmcp.js
const __webmcp = (() => {
// The registry as WebMCP tools.
// Checked against the WebMCP Draft Community Group Report of 13 October 2026:
// document.modelContext.registerTool(tool, { signal }) returns a promise,
// rejects a duplicate name, and removes the tool when the signal aborts.
// ToolAnnotations is a fixed set, and a tool has no output schema, so
// Sutram's own annotations and a summary of `output` go into the description.

const { getRegistry, runStatus } = __core;
const { describeShape, formatsUsed, sentence } = __format;
const { getFormats } = __formats;

/** The page's model context, or null when the browser has none. */
function findModelContext() {
  if (typeof document !== "undefined" && document.modelContext) return document.modelContext;
  // Older builds put it on navigator; Chromium is deprecating that.
  if (typeof navigator !== "undefined" && navigator.modelContext) return navigator.modelContext;
  return null;
}

const toolName = (def) => def.name.replace(/\s+/g, "_");

/** A command as a WebMCP tool definition, without `execute`. */
function toTool(def, formats = getFormats()) {
  const a = def.annotations || {};
  const annotations = {};
  if (a.readOnly) annotations.readOnlyHint = true;
  if (a.consequential) annotations.consequentialHint = true;
  if (a.untrustedContent) annotations.untrustedContentHint = true;
  let description = sentence(def.description);
  if (a.navigates) description += " Leaves this page; the tools on the next page may differ.";
  if (def.output) description += ` Returns ${describeShape(def.output)}.`;
  // An agent cannot look up a page's own formats, so the description explains them.
  for (const f of formatsUsed(def, formats)) description += ` ${f.name}: ${sentence(f.description)}`;
  return { name: toolName(def), description, inputSchema: def.input, annotations };
}

const STATUS_TOOL = {
  name: "sutram_status",
  description: "Run every provider's status command and return what each reports about the page. Call this first.",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true },
};

/**
 * Mirrors the registry into the model context, and keeps it in sync.
 * Returns a function that removes every tool again.
 */
function connectWebMCP(registry = getRegistry(), modelContext = findModelContext()) {
  if (!modelContext || typeof modelContext.registerTool !== "function") return () => {};
  const live = new Map(); // command name → AbortController

  const add = (name, tool, execute) => {
    const ctrl = new AbortController();
    live.set(name, ctrl);
    Promise.resolve(modelContext.registerTool({ ...tool, execute }, { signal: ctrl.signal })).catch((err) => {
      console.warn(`sutram: WebMCP refused ${tool.name}: ${err && err.message}`);
      if (live.get(name) === ctrl) live.delete(name);
    });
  };
  const remove = (name) => {
    const ctrl = live.get(name);
    if (ctrl) { ctrl.abort(); live.delete(name); }
  };

  add("\0status", STATUS_TOOL, async (_, { signal } = {}) => ({ code: 0, providers: await runStatus(registry, { caller: "agent", signal }) }));
  const addCommand = (def) => add(def.name, toTool(def, registry.formats), (input, { signal } = {}) => registry.run(def.name, input, { caller: "agent", signal }));

  registry.list().forEach(addCommand);
  const off = registry.onChange(({ type, name, def }) => {
    remove(name);
    if (type === "register") addCommand(def);
  });

  return () => {
    off();
    [...live.keys()].forEach(remove);
  };
}
return { findModelContext, toolName, toTool, STATUS_TOOL, connectWebMCP };
})();

// src/console.js
const __console = (() => {
// <sutram-console>: one client of the registry.
// A drop-down console with history, help, man, status, "did you mean",
// confirmation for consequential commands, --json[=fields] and --wide, and
// syntax highlighting of the line being typed.

const { CommandError, EXIT, getRegistry, runStatus } = __core;
const { highlight, parse, tokenize } = __parse;
const { formatHelp, formatMan, formatResult, formatUsage, annotationLabel, checkFields } = __format;

const STYLE = `
:host {
  --sutram-bg: #11131c; --sutram-fg: #e6e8f0; --sutram-dim: #8c93a8; --sutram-accent: #9aa2ff;
  --sutram-ok: #6fd69a; --sutram-warn: #f5a35c; --sutram-err: #ff7b7b; --sutram-line: #ffffff1a;
  --sutram-option: #7dcfff; --sutram-string: #c3e88d;
  --sutram-font: ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  position: fixed; inset: 0 0 auto 0; z-index: 2147483000; display: none;
}
:host([open]) { display: block; }
.panel { background: var(--sutram-bg); color: var(--sutram-fg); font: 13px/1.55 var(--sutram-font);
  height: min(55vh, 520px); display: flex; flex-direction: column; box-shadow: 0 8px 32px #0007;
  border-bottom: 1px solid var(--sutram-line); }
header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 6px 14px;
  border-bottom: 1px solid var(--sutram-line); color: var(--sutram-dim); font-size: 12px; }
header b { color: var(--sutram-fg); }
header button { font: inherit; background: none; border: 1px solid var(--sutram-line); color: var(--sutram-dim); border-radius: 5px; padding: 0 8px; cursor: pointer; }
.out { flex: 1; overflow: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 2px; }
.ln { white-space: pre-wrap; word-break: break-word; }
.ln.table, .ln.man, .ln.json { white-space: pre; word-break: normal; overflow-x: auto; }
.ln.input { margin-top: 6px; }
.ln.input::before { content: "› "; color: var(--sutram-accent); }
.ln.dim, .ln .head { color: var(--sutram-dim); }
.ln.ok { color: var(--sutram-ok); }
.ln.error { color: var(--sutram-err); }
.ln.json { color: var(--sutram-dim); }
.ln .code { color: var(--sutram-dim); margin-left: 8px; }
.ln .tag { font-size: 11px; padding: 0 6px; border-radius: 99px; margin-left: 6px; border: 1px solid var(--sutram-line); }
.ln .tag.read-only { color: var(--sutram-ok); }
.ln .tag.consequential { color: var(--sutram-warn); }
.ln .tag.navigates { color: var(--sutram-accent); }
.ln.ask { color: var(--sutram-warn); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ln.ask button { font: inherit; font-size: 12px; border: 1px solid var(--sutram-warn); background: transparent; color: var(--sutram-warn); border-radius: 5px; padding: 0 10px; cursor: pointer; }
.ln.ask button.yes { background: var(--sutram-warn); color: var(--sutram-bg); }
form { display: flex; gap: 8px; align-items: center; border-top: 1px solid var(--sutram-line); padding: 8px 14px; }
form span { color: var(--sutram-accent); }
.field { flex: 1; min-width: 0; display: grid; }
.field > * { grid-area: 1 / 1; font: inherit; padding: 0; margin: 0; border: 0; white-space: pre; letter-spacing: normal; }
.hl { overflow: hidden; pointer-events: none; color: var(--sutram-fg); }
input { min-width: 0; background: transparent; outline: 0; color: transparent; caret-color: var(--sutram-accent); }
input::placeholder { color: var(--sutram-dim); }
.s-command { color: var(--sutram-accent); }
.s-client { color: var(--sutram-accent); font-style: italic; }
.s-unknown, .s-bad-option { color: var(--sutram-err); text-decoration: underline wavy; text-decoration-thickness: 1px; }
.s-option { color: var(--sutram-option); }
.s-value, .s-string { color: var(--sutram-string); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--sutram-accent); outline-offset: 2px; }
`;

// Importable outside a browser (for server rendering or tests) without failing.
const Base = globalThis.HTMLElement || class {};

const isEditable = (el) => el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));

class SutramConsole extends Base {
  constructor() {
    super();
    this.registry = getRegistry();
    this.history = [];
    this.historyIndex = 0;
    this.pendingAsk = null;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STYLE}</style>
      <div class="panel" role="dialog" aria-label="Sutram console">
        <header><span><b>Sutram</b> · <span class="count">0</span> commands on this page</span><button type="button" class="close" aria-label="Close">Esc</button></header>
        <div class="out" aria-live="polite"></div>
        <form><span aria-hidden="true">›</span><div class="field"><div class="hl" aria-hidden="true"></div><input type="text" autocomplete="off" spellcheck="false" aria-label="Command" placeholder="type a command, or help"></div></form>
      </div>`;
    this.out = root.querySelector(".out");
    this.input = root.querySelector("input");
    this.hl = root.querySelector(".hl");
    this.countEl = root.querySelector(".count");
    root.querySelector(".close").addEventListener("click", () => this.close());
    root.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const line = this.input.value;
      this.setInput("");
      this.submit(line);
    });
    this.input.addEventListener("keydown", (e) => this.onInputKey(e));
    this.input.addEventListener("input", () => this.renderInput());
    // The input scrolls when the line is longer than the field; follow it.
    for (const type of ["scroll", "keyup", "click", "select"]) this.input.addEventListener(type, () => { this.hl.scrollLeft = this.input.scrollLeft; });
    this.onGlobalKey = this.onGlobalKey.bind(this);
  }

  connectedCallback() {
    document.addEventListener("keydown", this.onGlobalKey);
    this.offChange = this.registry.onChange(() => { this.updateCount(); this.renderInput(); });
    this.updateCount();
    if (!this.out.childElementCount && this.hasAttribute("greeting")) this.print(this.getAttribute("greeting"), "dim");
  }

  disconnectedCallback() {
    document.removeEventListener("keydown", this.onGlobalKey);
    if (this.offChange) this.offChange();
  }

  get formatOptions() {
    return { locale: this.getAttribute("locale") || undefined, formats: this.registry.formats };
  }

  updateCount() { this.countEl.textContent = this.registry.list().length; }

  /** Colours a command line: the command, options, values and quoted words. */
  spans(line) {
    return highlight(this.registry, line).map(({ text, kind }) => {
      if (kind === "space" || kind === "arg") return document.createTextNode(text);
      const s = document.createElement("span");
      s.className = `s-${kind}`;
      s.textContent = text;
      return s;
    });
  }

  setInput(value) {
    this.input.value = value;
    this.renderInput();
  }

  renderInput() {
    // A trailing space keeps the layer as wide as the input when the caret is at the end.
    this.hl.replaceChildren(...this.spans(this.input.value), " ");
    this.hl.scrollLeft = this.input.scrollLeft;
  }

  open() {
    this.setAttribute("open", "");
    requestAnimationFrame(() => this.input.focus());
    this.dispatchEvent(new CustomEvent("sutram-open"));
  }

  close() {
    this.removeAttribute("open");
    this.dispatchEvent(new CustomEvent("sutram-close"));
  }

  toggle() { this.hasAttribute("open") ? this.close() : this.open(); }

  /** The hotkey: backtick outside text fields, or Ctrl+Shift+K anywhere. Escape closes. */
  onGlobalKey(e) {
    const path = e.composedPath ? e.composedPath() : [];
    const inside = path.includes(this);
    if (e.key === "Escape" && this.hasAttribute("open")) { e.preventDefault(); this.close(); return; }
    if (e.ctrlKey && e.shiftKey && (e.key === "K" || e.key === "k")) { e.preventDefault(); this.toggle(); return; }
    if (e.key === "`" && !e.ctrlKey && !e.metaKey && !e.altKey && !inside && !isEditable(document.activeElement)) {
      e.preventDefault();
      this.toggle();
    }
  }

  onInputKey(e) {
    if (e.key === "ArrowUp" && this.historyIndex > 0) {
      this.historyIndex--;
      this.setInput(this.history[this.historyIndex]);
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
      this.setInput(this.history[this.historyIndex] || "");
      e.preventDefault();
    } else if (e.key === "`" && !this.input.value) {
      e.preventDefault();
      this.close();
    }
  }

  print(text, kind = "text") {
    const el = document.createElement("div");
    el.className = `ln ${kind}`;
    el.textContent = text;
    this.out.append(el);
    this.out.scrollTop = this.out.scrollHeight;
    return el;
  }

  printBlocks(blocks, okKind = "text") {
    for (const b of blocks) {
      if (b.kind === "table") {
        const el = this.print("", "table");
        const head = document.createElement("span");
        head.className = "head";
        head.textContent = b.head;
        el.append(head, "\n" + b.text.split("\n").slice(1).join("\n"));
      } else if (b.kind === "error") {
        const el = this.print(b.text, "error");
        if (b.code !== undefined) {
          const code = document.createElement("span");
          code.className = "code";
          code.textContent = `exit ${b.code}`;
          el.append(code);
        }
      } else if (b.commands) {
        // help: one line per command, with its annotation as a tag.
        b.text.split("\n").forEach((line, i) => {
          const label = annotationLabel(b.commands[i].annotations);
          const el = this.print(label ? line.replace(`  [${label}]`, "") : line, "text");
          if (label) {
            const tag = document.createElement("span");
            tag.className = `tag ${label}`;
            tag.textContent = label;
            el.append(tag);
          }
        });
      } else {
        this.print(b.text, b.kind === "text" || b.kind === "pairs" ? okKind : b.kind);
      }
    }
  }

  ask(message) {
    return new Promise((resolve) => {
      const el = this.print(message + " ", "ask");
      const done = (yes) => {
        this.pendingAsk = null;
        el.querySelectorAll("button").forEach((b) => b.remove());
        el.append(yes ? "yes" : "no");
        resolve(yes);
        this.input.focus();
      };
      for (const [label, yes] of [["Yes", true], ["No", false]]) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (yes) b.className = "yes";
        b.addEventListener("click", () => done(yes));
        el.append(b);
      }
      this.pendingAsk = done;
    });
  }

  /** Runs one line, as if it was typed. */
  async submit(line) {
    line = String(line).trim();
    if (!line) return;
    if (this.pendingAsk) {
      this.print(line, "input");
      this.pendingAsk(/^y(es)?$/i.test(line));
      return;
    }
    this.history.push(line);
    this.historyIndex = this.history.length;
    this.print("", "input").append(...this.spans(line));

    let words;
    try { words = tokenize(line).map((t) => t.value); } catch (err) { this.printBlocks([{ kind: "error", text: err.message, code: err.code }]); return; }
    const [first, ...rest] = words;

    if (first === "help") { this.printBlocks(formatHelp(this.registry, rest.join(" ").toLowerCase())); return; }
    if (first === "man") {
      const name = rest.join(" ").toLowerCase();
      if (!name) { this.print("What manual page do you want?\nFor example, try: man help", "text"); return; }
      const def = this.registry.get(name);
      if (!def && !["help", "man", "status", "clear"].includes(name)) {
        this.printBlocks([{ kind: "error", text: `No manual entry for ${name}. See help.`, code: EXIT.FAILED }]);
        return;
      }
      this.printBlocks(formatMan(def, name, this.registry.formats));
      return;
    }
    if (first === "clear" && !rest.length) { this.out.replaceChildren(); return; }
    if (first === "status" && (!rest.length || (rest.length === 1 && rest[0] === "--json"))) {
      const results = await runStatus(this.registry, { caller: "console" });
      if (rest.length) { this.print(JSON.stringify(results.map(({ provider, data }) => ({ provider, data })), null, 2), "json"); return; }
      if (!results.length) { this.print("No provider on this page reports a status.", "dim"); return; }
      const w = Math.max(...results.map((r) => r.provider.length));
      this.print(results.map((r) => `${r.provider.padEnd(w)}  ${(r.code ? r.message : r.text || "").split("\n")[0]}`).join("\n"), "text");
      return;
    }

    try {
      const { def, input, help, json, wide, fields } = parse(this.registry, line);
      if (help) { this.printBlocks(formatUsage(def)); return; }
      const fieldError = fields && checkFields(def, fields);
      if (fieldError) { this.printBlocks([{ kind: "error", text: fieldError, code: EXIT.USAGE }]); return; }
      if (def.annotations.consequential) {
        const message = typeof def.confirm === "function" ? def.confirm(input) : `Run ${def.name}?`;
        if (!(await this.ask(message))) { this.print("Cancelled. Nothing changed.", "dim"); return; }
      }
      const result = await this.registry.run(def.name, input, { caller: "console" });
      this.printBlocks(formatResult(result, def, { ...this.formatOptions, json, wide, fields }), def.annotations.readOnly ? "text" : "ok");
    } catch (err) {
      const code = err instanceof CommandError ? err.code : EXIT.FAILED;
      this.printBlocks([{ kind: "error", text: err.message, code }]);
    }
  }
}

/** Defines <sutram-console> once, however many copies are loaded. */
function defineConsole(tag = "sutram-console") {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) customElements.define(tag, SutramConsole);
}

/** Adds a console to the page if there is none yet, and returns it. */
function mountConsole(attributes = {}) {
  defineConsole();
  let el = document.querySelector("sutram-console");
  if (!el) {
    el = document.createElement("sutram-console");
    for (const [k, v] of Object.entries(attributes)) if (v !== undefined && v !== null) el.setAttribute(k, v);
    document.body.append(el);
  }
  return el;
}
return { SutramConsole, defineConsole, mountConsole };
})();

// src/browser.js
const __browser = (() => {
// One script for pages without a bundler: loads everything, defines
// <sutram-console>, connects WebMCP when the browser has it, and exposes
// the shared API as globalThis.Sutram.
//
//   <script type="module" src=".../sutram/src/browser.js"></script>
//   <script type="module">
//     Sutram.register({ name: "hello world", provider: "hello", ... });
//     Sutram.mountConsole();
//   </script>

const core = __index;
const { getEvents } = __events;
const { connectWebMCP, findModelContext } = __webmcp;
const { defineConsole, mountConsole } = __console;

const registry = core.getRegistry();
const events = getEvents(registry);
defineConsole();

if (!globalThis.Sutram) {
  globalThis.Sutram = Object.freeze({
    ...core,
    registry,
    events,
    formats: registry.formats,
    defineFormat: (name, def) => registry.formats.define(name, def),
    register: (def) => registry.register(def),
    run: (name, input, ctx) => registry.run(name, input, ctx),
    mountConsole,
    connectWebMCP: () => connectWebMCP(registry, findModelContext()),
  });
  connectWebMCP(registry, findModelContext());
}

const __default = globalThis.Sutram;
return { default: __default };
})();

export default __browser.default;

export const { EXIT, RESERVED_WORDS, CLIENT_OPTIONS, CommandError, createRegistry, getRegistry, checkInput, checkOutput, deref, isStatusCommand, runStatus, tokenize, parse, suggest, distance, highlight, createFormats, getFormats, STANDARD_FORMATS, formatResult, formatValue, formatTable, blocksToText, formatHelp, formatUsage, formatMan, synopsis, longSynopsis, annotationLabel, describeShape, sentence, checkFields, selectFields, formatsUsed, commandLine } = __index;

