<?php

declare(strict_types=1);

namespace Drupal\sutram\Hook;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Session\AccountInterface;
use Drupal\sutram\SutramMenus;
use Drupal\sutram\SutramPage;

/**
 * Hook implementations for Sutram.
 */
final class SutramHooks {

  public function __construct(
    private readonly AccountInterface $currentUser,
    private readonly SutramMenus $menus,
    private readonly SutramPage $page,
  ) {}

  /**
   * Implements hook_page_attachments().
   *
   * Loads Sutram, with Drupal's providers, for users who may use it. Other
   * modules add their own commands with a library that depends on
   * sutram/sutram and calls Sutram.register().
   */
  #[Hook('page_attachments')]
  public function pageAttachments(array &$attachments): void {
    $cacheability = CacheableMetadata::createFromRenderArray($attachments)
      ->addCacheContexts(['user.permissions']);

    if ($this->currentUser->hasPermission('use sutram')) {
      $attachments['#attached']['library'][] = 'sutram/drupal';
      $attachments['#attached']['drupalSettings']['sutram'] = [
        'menus' => $this->menus->build($cacheability),
        'page' => $this->page->build($cacheability),
      ];
    }

    $cacheability->applyTo($attachments);
  }

}
