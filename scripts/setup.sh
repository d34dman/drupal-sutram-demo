#!/usr/bin/env bash
# Sets up the demo from a fresh clone. Safe to run again: it reinstalls the site.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f ../drupal-sutram/sutram.info.yml ]; then
  echo "The drupal/sutram module must be checked out next to this repository, in ../drupal-sutram." >&2
  echo "  git clone -b 1.x git@git.drupal.org:project/sutram.git ../drupal-sutram" >&2
  exit 1
fi

ddev start
ddev composer install
# Installs from the exported configuration in config/sync.
ddev drush site:install --existing-config -y --account-name=admin --account-pass=admin
ddev drush php:script scripts/seed.php
ddev drush cache:rebuild
echo
echo "Log in: $(ddev drush user:login)"
echo "Then press \` (backtick) or Ctrl+Shift+K for the Sutram console."
