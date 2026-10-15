<?php

declare(strict_types=1);

namespace Drupal\sutram;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Menu\MenuLinkTreeElement;
use Drupal\Core\Menu\MenuLinkTreeInterface;
use Drupal\Core\Menu\MenuTreeParameters;

/**
 * Builds the menus the nav provider exposes, as plain data for drupalSettings.
 *
 * Each tree is access-checked for the current user, the same way the menu
 * block checks it, so the console and agents only see links the user could
 * already click.
 */
final class SutramMenus {

  public function __construct(
    private readonly MenuLinkTreeInterface $menuTree,
    private readonly ConfigFactoryInterface $configFactory,
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Builds every configured menu.
   *
   * @return array<string, array{label: string, items: list<array<string, mixed>>}>
   *   Menus keyed by machine name.
   */
  public function build(CacheableMetadata $cacheability): array {
    $config = $this->configFactory->get('sutram.settings');
    $cacheability->addCacheableDependency($config);

    $menus = [];
    foreach ($config->get('menus') ?? [] as $setting) {
      $menu = $this->entityTypeManager->getStorage('menu')->load($setting['menu']);
      if (!$menu) {
        continue;
      }
      $cacheability->addCacheableDependency($menu);
      $menus[$menu->id()] = [
        'label' => (string) $menu->label(),
        'items' => $this->tree($menu->id(), (int) ($setting['depth'] ?? 3), $cacheability),
      ];
    }
    return $menus;
  }

  /**
   * Builds one menu tree.
   *
   * @return list<array<string, mixed>>
   *   Items with id, title, description, url and, if any, children.
   */
  public function tree(string $menu_name, int $depth, CacheableMetadata $cacheability): array {
    $parameters = (new MenuTreeParameters())
      ->setMaxDepth($depth)
      ->onlyEnabledLinks();
    $tree = $this->menuTree->load($menu_name, $parameters);
    $tree = $this->menuTree->transform($tree, [
      ['callable' => 'menu.default_tree_manipulators:checkNodeAccess'],
      ['callable' => 'menu.default_tree_manipulators:checkAccess'],
      ['callable' => 'menu.default_tree_manipulators:generateIndexAndSort'],
    ]);
    $cacheability->addCacheTags(['config:system.menu.' . $menu_name]);
    return $this->items($tree, $cacheability);
  }

  /**
   * Converts tree elements to items, leaving out what the user cannot reach.
   *
   * @param \Drupal\Core\Menu\MenuLinkTreeElement[] $tree
   *   The tree, already checked and sorted.
   */
  private function items(array $tree, CacheableMetadata $cacheability): array {
    $items = [];
    foreach ($tree as $element) {
      assert($element instanceof MenuLinkTreeElement);
      if ($element->access !== NULL) {
        $cacheability->addCacheableDependency($element->access);
        if (!$element->access->isAllowed()) {
          continue;
        }
      }
      $link = $element->link;
      $url = $link->getUrlObject()->toString(TRUE);
      $cacheability->addCacheableDependency($url);

      $item = [
        'id' => $link->getPluginId(),
        'title' => (string) $link->getTitle(),
        'description' => (string) $link->getDescription(),
        'url' => $url->getGeneratedUrl(),
      ];
      $children = $element->subtree ? $this->items($element->subtree, $cacheability) : [];
      if ($children) {
        $item['children'] = $children;
      }
      $items[] = $item;
    }
    return $items;
  }

}
