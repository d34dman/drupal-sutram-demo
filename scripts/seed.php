<?php

/**
 * @file
 * Demo content: a few pages, linked from the main menu with descriptions,
 * so the nav provider has something to show.
 *
 * Run with: ddev drush php:script scripts/seed.php
 */

use Drupal\menu_link_content\Entity\MenuLinkContent;
use Drupal\node\Entity\Node;

$pages = [
  'shop' => ['Shop', 'Beans, tea and brewing equipment', NULL],
  'coffee' => ['Coffee', 'Single-origin beans and house blends, roasted weekly in Hamburg', 'shop'],
  'tea' => ['Tea', 'Loose-leaf black, green and herbal teas', 'shop'],
  'guides' => ['Brewing guides', 'Step-by-step recipes for each brew method', NULL],
  'pour-over' => ['Pour-over', 'A 15 g to 250 g recipe for V60 and Kalita drippers', 'guides'],
  'espresso' => ['Espresso', 'Dialling in dose, yield and time', 'guides'],
  'about' => ['About', 'Who roasts your coffee and how to reach us', NULL],
];

$links = [];
$weight = 0;
foreach ($pages as $key => [$title, $description, $parent]) {
  $existing = \Drupal::entityTypeManager()->getStorage('node')->loadByProperties(['title' => $title, 'type' => 'page']);
  $node = $existing ? reset($existing) : Node::create([
    'type' => 'page',
    'title' => $title,
    'body' => ['value' => "<p>{$description}.</p>", 'format' => 'basic_html'],
    'status' => 1,
    'uid' => 1,
  ]);
  $node->save();

  $found = \Drupal::entityTypeManager()->getStorage('menu_link_content')->loadByProperties(['title' => $title, 'menu_name' => 'main']);
  $link = $found ? reset($found) : MenuLinkContent::create(['menu_name' => 'main', 'title' => $title]);
  $link->set('link', ['uri' => 'entity:node/' . $node->id()]);
  $link->set('description', $description);
  $link->set('weight', $weight++);
  $link->set('expanded', TRUE);
  $link->set('parent', $parent ? 'menu_link_content:' . $links[$parent]->uuid() : '');
  $link->save();
  $links[$key] = $link;
}

echo 'Seeded ' . count($pages) . " pages and main menu links.\n";
