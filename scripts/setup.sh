#!/usr/bin/env bash
# Sets up the demo from a fresh clone. Safe to run again: it reinstalls the site.
set -euo pipefail
cd "$(dirname "$0")/.."

ddev start
ddev composer install
# Installs from the exported configuration in config/sync.
ddev drush site:install --existing-config -y --account-name=admin --account-pass=admin
ddev drush php:script scripts/seed.php
ddev drush cache:rebuild
echo
echo "Log in: $(ddev drush user:login)"
echo "Then press \` (backtick) or Ctrl+Shift+K for the Sutram console."
