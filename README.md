# Drupal Sutram demo

A Drupal 11 site that connects Drupal to [Sutram](https://github.com/d34dman/sutram),
the npm package that lets JavaScript apps expose their commands to people in a
console and to AI agents through WebMCP.

The connection is the [`drupal/sutram`](https://www.drupal.org/project/sutram)
module and its demo submodules (`sutram_demo_nav`, `sutram_demo_page`,
`sutram_demo_form`, `sutram_demo_canvas`, `sutram_demo_user`), installed with
Composer from the module's `1.x-dev` branch. Visitors who are not logged in
may use Sutram too, so `user login` works for them. [Drupal Canvas](https://www.drupal.org/project/canvas)
is installed too, with three small components to build pages with (heading,
text and card, in `web/modules/custom/demo_components`).

## Set up

Needs DDEV. The module ships the Sutram library itself, so neither npm nor a
CDN is needed.

```sh
scripts/setup.sh
```

That starts DDEV, installs Composer dependencies, installs Drupal from the
configuration in `config/sync` (`admin` / `admin`), adds some demo pages to the
main menu and an empty Canvas page, and prints a login link.

## Configuration

The site's configuration lives in `config/sync` (set in
`web/sites/default/settings.php`). It is the standard profile plus the core
recipes `page_content_type` and `article_tags` (Drupal 11.4's standard profile
no longer creates content types), with `sutram`, its demo submodules and
Canvas enabled. After changing
configuration on your site, export and commit it:

```sh
ddev drush config:export -y
```

After pulling someone else's changes, import them with
`ddev drush config:import -y`.

Open the site, log in, and press <kbd>`</kbd> (outside text fields) or
<kbd>Ctrl</kbd>+<kbd>`</kbd> (anywhere). It is the key left of <kbd>1</kbd>,
so <kbd>^</kbd> on a German keyboard.

```
› help
› status
› nav menu
› nav menu main
› nav menu admin --depth=3
› nav search content type
› nav go "Content types"
› page status --json
› man nav go
```

On `/node/add/article`:

```
› form list
› form fields node-article-form
› form set node-article-form title Pour-over, step by step
› form set node-article-form body.value <p>Rinse the filter first.</p>
› form set node-article-form field_tags coffee, v60
› form status node-article-form
› form save node-article-form
```

In the Canvas editor, on the *Build with Sutram* page
(`/canvas/editor/canvas_page/<id>`, printed by `scripts/setup.sh`), paste
these lines into the console. They run as one change, and if one fails the
others are undone:

```
canvas page set title "Our coffee"
canvas add heading --as=top
canvas set top text "Fresh every week"
canvas add card --after=top --as=intro
canvas set intro title "Single origin"
```

Then `canvas tree` shows the page, and `canvas undo` takes back the last
change. `canvas publish` is turned on in this demo (*Configuration ›
Development › Sutram Demo Canvas*); on a real site it is off by default.

## What the modules do

See the [module README](https://git.drupalcode.org/project/sutram/-/blob/1.x/README.md):
the core module loads Sutram and opens the console for users with the *Use
Sutram* permission; the demo submodules add `nav`, `page status` and `form`
commands, and `sutram_demo_canvas` adds `canvas` commands in the Canvas
editor.

## Tests and checks

The module's tests and Drupal's coding standards run here, against the
mounted module:

```sh
ddev exec 'SIMPLETEST_DB=mysql://db:db@db/db SIMPLETEST_BASE_URL=http://web \
  BROWSERTEST_OUTPUT_DIRECTORY=/var/www/html/web/sites/simpletest/browser_output \
  vendor/bin/phpunit -c web/core/phpunit.xml.dist web/modules/contrib/sutram/tests'
ddev exec 'vendor/bin/phpcs --standard=Drupal,DrupalPractice \
  --extensions=php,module,inc,install,yml --ignore=*/lib/* web/modules/contrib/sutram'
```

`tests/form-coverage` runs the form provider's commands in a real browser
against this site, on the `sutram_form_test` content type of the hidden test
module `sutram_demo_form_test` (needs the mounted module and
`$settings['extension_discovery_scan_tests'] = TRUE`):

```sh
cd tests/form-coverage && npm install
node run.mjs            # all groups at once; `node run.mjs files` for one, --serial, --cleanup
```

## Developing the module

To work on the module and see changes here at once, check it out next to this
repository and mount it over the Composer copy:

```sh
git clone -b 1.x git@git.drupal.org:project/sutram.git ../drupal-sutram
cp .ddev/docker-compose.sutram.yaml.example .ddev/docker-compose.sutram.yaml
ddev restart
```

`.ddev/docker-compose.sutram.yaml` is not committed; delete it and restart to
go back to the Composer copy. With the mount, a package change can be tried
too: `../drupal-sutram/scripts/update-sutram.sh --local ../sutram`, then
reload the browser.
