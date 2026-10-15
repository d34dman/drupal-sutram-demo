# Drupal Sutram demo

A Drupal 11 site that connects Drupal to [Sutram](https://github.com/d34dman/sutram),
the npm package that lets JavaScript apps expose their commands to people in a
console and to AI agents through WebMCP.

The connection is the custom module `sutram`
([web/modules/custom/sutram](web/modules/custom/sutram)). Once it settles, it
moves to drupal.org as `drupal/sutram`.

## Set up

Needs DDEV, Node.js 20 or later, and SSH access to `d34dman/sutram` on GitHub
(npm installs the package from there until it is published).

```sh
scripts/setup.sh
```

That starts DDEV, installs Composer and npm dependencies, installs Drupal with
the standard profile (`admin` / `admin`), enables `sutram`, adds some demo pages
to the main menu, and prints a login link.

Open the site, log in, and press <kbd>`</kbd> (outside text fields) or
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>:

```
› help
› status
› nav tree
› nav tree admin --depth=3
› nav find content type
› nav go "Content types"
› page status --json
› man nav go
```

## What the module does

- **Loads Sutram** on every page for users with the *Use the Sutram console*
  permission: the console, and WebMCP tools when the browser supports WebMCP.
- **`nav` provider:** the menus chosen at *Configuration › Development ›
  Sutram* (main and admin by default). The server checks access for each link
  as the menu block does, so people and agents only see links the user could
  already click. Commands: `nav status`, `nav tree`, `nav find`, `nav go`.
- **`page` provider:** `page status` says what the current page is: its title,
  route, and the entity it shows.

Sutram adds no way into the server. Commands run in the browser with the
user's session and can do only what the user can already do on the page.

## Add commands from another module

Define a library that depends on `sutram/sutram`, attach it where the commands
make sense, and register them:

```yaml
# mymodule.libraries.yml
commands:
  js:
    js/mymodule.sutram.js: { attributes: { type: module }, preprocess: false }
  dependencies:
    - sutram/sutram
```

```js
// js/mymodule.sutram.js
Sutram.register({
  name: "cache clear",
  provider: "cache",
  description: "Clear all caches",
  input: { type: "object", properties: {} },
  annotations: { consequential: true },
  run: async () => { /* call one of your module's own routes */ },
});
```

See the [package README](https://github.com/d34dman/sutram#register-a-command)
for the full definition: output schemas, positional arguments, examples.

## Work on the package at the same time

With a `sutram` checkout next to this one (as in the Sutram workspace):

```sh
npm run sutram:local    # copies ../sutram into web/libraries/sutram
```

Run it again after each change; no Drupal cache clear is needed for JavaScript
changes, only a browser reload.
