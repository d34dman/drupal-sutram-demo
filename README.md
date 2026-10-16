# Drupal Sutram demo

A Drupal 11 site that connects Drupal to [Sutram](https://github.com/d34dman/sutram),
the npm package that lets JavaScript apps expose their commands to people in a
console and to AI agents through WebMCP.

The connection is the [`drupal/sutram`](https://www.drupal.org/project/sutram)
module and its demo submodules (`sutram_demo_nav`, `sutram_demo_page`,
`sutram_demo_form`), installed with Composer from the module's `1.x-dev`
branch.

## Set up

Needs DDEV. The module ships the Sutram library itself, so neither npm nor a
CDN is needed.

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

## What the modules do

See the [module README](https://git.drupalcode.org/project/sutram/-/blob/1.x/README.md):
the core module loads Sutram and opens the console for users with the *Use
Sutram* permission; the demo submodules add `nav`, `page status` and `form`
commands.

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
