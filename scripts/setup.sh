#!/usr/bin/env bash
# Sets up the demo from a fresh clone. Safe to run again: it reinstalls the site.
set -euo pipefail
cd "$(dirname "$0")/.."

ddev start
ddev composer install
npm install                      # copies the sutram package into web/libraries/sutram
ddev drush site:install standard -y --site-name="Sutram demo" --account-name=admin --account-pass=admin
ddev drush pm:install sutram -y
ddev drush php:script scripts/seed.php
ddev drush cache:rebuild
echo
echo "Log in: $(ddev drush user:login)"
echo "Then press \` (backtick) or Ctrl+Shift+K for the Sutram console."
