/**
 * @file
 * Drupal's providers for Sutram.
 *
 * - nav: the menus chosen in Sutram's settings, already access-checked for
 *   the current user on the server (drupalSettings.sutram.menus).
 * - page: what this page is (drupalSettings.sutram.page), and its forms.
 *
 * Loaded as an ES module after sutram/sutram, which defines globalThis.Sutram.
 */

const { register, mountConsole, CommandError, EXIT } = globalThis.Sutram;
const settings = (globalThis.drupalSettings && globalThis.drupalSettings.sutram) || {};
const menus = settings.menus || {};
const page = settings.page || {};
const formIds = Object.keys(settings.forms || {});
const NONE = { type: "object", properties: {} };
const menuNames = Object.keys(menus);

// Every menu item with its breadcrumb inside its menu.
const flat = [];
for (const [menu, { label, items }] of Object.entries(menus)) {
  (function walk(list, trail) {
    for (const item of list) {
      flat.push({ menu, menuLabel: label, item, trail: [...trail, item.title] });
      if (item.children) walk(item.children, [...trail, item.title]);
    }
  })(items || [], []);
}
const here = () => window.location.pathname + window.location.search;
const trailOf = (entry) => entry.trail.join(" › ");

// The deepest menu item whose path is the current path.
function currentEntry() {
  const path = window.location.pathname;
  return flat.filter((e) => e.item.url === path).sort((a, b) => b.trail.length - a.trail.length)[0] || null;
}

function findItem(query) {
  const q = String(query).trim().toLowerCase();
  const exact = flat.filter((e) => e.item.url.toLowerCase() === q || e.item.id.toLowerCase() === q);
  if (exact.length) return exact;
  const byTitle = flat.filter((e) => e.item.title.toLowerCase() === q);
  if (byTitle.length) return byTitle;
  // A breadcrumb may leave out the top of the trail: "Structure › Menus".
  return flat.filter((e) => {
    const trail = trailOf(e).toLowerCase();
    return trail === q || trail.endsWith(` › ${q}`);
  });
}

const ITEM = {
  type: "object",
  required: ["title", "url"],
  properties: {
    trail: { type: "string", title: "Menu item" },
    url: { type: "string", format: "uri-reference", title: "Path", description: "Pass it to nav go" },
    menu: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
  },
};

if (menuNames.length) {
  register({
    name: "nav status",
    provider: "nav",
    description: "Show where this page is in the menus",
    input: NONE,
    output: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string" }, trail: { type: "string" }, menu: { type: "string" }, menus: { type: "array", items: { type: "string" } } },
    },
    annotations: { readOnly: true },
    seeAlso: ["nav tree", "nav find"],
    run() {
      const e = currentEntry();
      const text = e
        ? `On ${trailOf(e)} (${e.menuLabel}). ${flat.length} links in ${menuNames.join(", ")}; see nav tree.`
        : `On ${here()}, which is in none of the menus. ${flat.length} links in ${menuNames.join(", ")}; see nav tree.`;
      return { text, data: { path: here(), trail: e ? trailOf(e) : "", menu: e ? e.menu : "", menus: menuNames } };
    },
  });

  register({
    name: "nav tree",
    provider: "nav",
    description: "Show a menu's links with their path and description",
    input: {
      type: "object",
      properties: {
        menu: { type: "string", enum: menuNames, default: menuNames[0], description: "Which menu" },
        depth: { type: "integer", minimum: 1, default: 2, description: "How many levels to show" },
      },
    },
    positional: ["menu"],
    output: {
      type: "object",
      properties: { items: { type: "array", items: { $ref: "#/$defs/item" } } },
      $defs: {
        item: {
          type: "object",
          required: ["id", "title", "url"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            url: { type: "string", format: "uri-reference", title: "Path" },
            description: { type: "string" },
            children: { type: "array", items: { $ref: "#/$defs/item" } },
          },
        },
      },
    },
    view: { columns: ["title", "url", "description"] },
    annotations: { readOnly: true },
    examples: ["nav tree", ...menuNames.slice(1).map((m) => `nav tree ${m} --depth=3`)],
    seeAlso: ["nav find", "nav go"],
    run({ menu, depth }) {
      const strip = (items, d) => items.map(({ id, title, description, url, children }) => ({
        id, title, description, url, ...(children && d < depth ? { children: strip(children, d + 1) } : {}),
      }));
      return { data: { items: strip(menus[menu].items || [], 1) } };
    },
  });

  register({
    name: "nav find",
    provider: "nav",
    description: "Find menu links whose title or description contains all the words",
    input: { type: "object", properties: { query: { type: "string", description: "Words to look for" } }, required: ["query"] },
    positional: ["query"],
    output: { type: "object", required: ["matches"], properties: { matches: { type: "array", items: ITEM } } },
    view: { columns: ["trail", "url", "description"] },
    annotations: { readOnly: true },
    examples: ["nav find content type", 'nav find "text format"'],
    seeAlso: ["nav go", "nav tree"],
    run({ query }) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = flat
        .filter((e) => words.every((w) => `${e.item.title} ${e.item.description}`.toLowerCase().includes(w)))
        .map((e) => ({ trail: trailOf(e), url: e.item.url, menu: e.menu, title: e.item.title, description: e.item.description }));
      return matches.length ? { data: { matches } } : { text: `No menu link matches "${query}".`, data: { matches } };
    },
  });

  register({
    name: "nav go",
    provider: "nav",
    description: "Go to a menu link, by path, title or breadcrumb, or to any path on this site",
    input: {
      type: "object",
      properties: { item: { type: "string", description: "A path such as /admin/structure, a link title, or a breadcrumb such as \"Structure › Content types\"" } },
      required: ["item"],
    },
    positional: ["item"],
    output: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri-reference" }, title: { type: "string" } } },
    annotations: { navigates: true },
    examples: ["nav go /admin/content", 'nav go "Content types"', "nav go Structure › Menus"],
    seeAlso: ["nav find", "nav status"],
    run({ item }) {
      const hits = findItem(item);
      let url;
      let title;
      if (hits.length === 1 || (hits.length > 1 && hits.every((h) => h.item.url === hits[0].item.url))) {
        ({ url, title } = hits[0].item);
      } else if (hits.length > 1) {
        throw new CommandError(`nav go: "${item}" matches ${hits.length} links: ${hits.slice(0, 4).map(trailOf).join("; ")}. Use the path or the breadcrumb.`, EXIT.FAILED);
      } else if (/^\/(?!\/)/.test(item)) {
        // Any path on this site: the same as following a link to it.
        url = item;
        title = item;
      } else {
        throw new CommandError(`nav go: no menu link "${item}". Try nav find ${item.split(/\s+/)[0]}.`, EXIT.FAILED);
      }
      // Navigate after the result has been delivered to the caller.
      setTimeout(() => window.location.assign(url), 0);
      return { text: `Going to ${title} (${url}).`, data: { url, title } };
    },
  });
}

register({
  name: "page status",
  provider: "page",
  description: "Show what this page is: its title, route, the entity it shows, and its forms",
  input: NONE,
  output: {
    type: "object",
    properties: {
      title: { type: "string" },
      path: { type: "string" },
      route: { type: "string" },
      entity: { type: "object", properties: { type: { type: "string" }, id: { type: "string" }, bundle: { type: "string" }, label: { type: "string" } } },
      forms: { type: "array", items: { type: "string" }, description: "Ids of the forms that have form <id> commands" },
    },
  },
  annotations: { readOnly: true },
  seeAlso: ["nav status"],
  run() {
    const e = page.entity;
    const what = e ? ` It shows ${e.type} ${e.id} (${e.bundle}): "${e.label}".` : "";
    const formsText = formIds.length ? ` Forms: ${formIds.map((id) => `form ${id}`).join(", ")}; see help form.` : "";
    return {
      text: `"${page.title || document.title}", route ${page.route}.${what}${formsText}`,
      data: { title: page.title || document.title, path: here(), route: page.route, ...(e ? { entity: { ...e, id: String(e.id) } } : {}), forms: formIds },
    };
  },
});

mountConsole({ greeting: "Sutram console for Drupal. Type help, or status. Press Esc to close." });
