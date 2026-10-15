# Drupal Sutram demo

A Drupal 11 site that connects Drupal to [Sutram](https://github.com/d34dman/sutram),
the npm package that lets JavaScript apps expose their commands to people in a
console and to AI agents through WebMCP.

The connection is the custom module `sutram`
([web/modules/custom/sutram](web/modules/custom/sutram)). Once it settles, it
moves to drupal.org as `drupal/sutram`.

## Set up

Needs DDEV. The sutram package is committed as a build in
`web/libraries/sutram`, so neither npm nor GitHub access is needed.

```sh
scripts/setup.sh
```

That starts DDEV, installs Composer dependencies, installs Drupal from the
configuration in `config/sync` (`admin` / `admin`), adds some demo pages to the
main menu, and prints a login link.

## Configuration

The site's configuration lives in `config/sync` (set in
`web/sites/default/settings.php`). It is the standard profile plus the core
recipes `page_content_type` and `article_tags` (Drupal 11.4's standard profile
no longer creates content types), with `sutram` enabled. After changing
configuration on your site, export and commit it:

```sh
ddev drush config:export -y
```

After pulling someone else's changes, import them with
`ddev drush config:import -y`.

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

## Update the sutram package

The package and this demo change independently: the demo runs the build
committed in `web/libraries/sutram/sutram.js`, and `SOURCE` next to it names
the package commit it was built from. To take a newer package, with a `sutram`
checkout next to this one (as in the Sutram workspace) and Node.js 20 or later:

```sh
npm run sutram:update   # builds ../sutram and copies dist/sutram.js here
```

Reload the browser; JavaScript changes need no Drupal cache clear. Commit the
new build when the demo works with it. `SUTRAM_SRC=<path>` builds another
checkout.
