<?php

declare(strict_types=1);

namespace Drupal\sutram;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Controller\TitleResolverInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Describes the current page for `page status`: its title, route and entity.
 */
final class SutramPage {

  public function __construct(
    private readonly RouteMatchInterface $routeMatch,
    private readonly TitleResolverInterface $titleResolver,
    private readonly RequestStack $requestStack,
  ) {}

  /**
   * Builds the page description.
   *
   * @return array<string, mixed>
   *   The title, route name and, on an entity's page, the entity.
   */
  public function build(CacheableMetadata $cacheability): array {
    $cacheability->addCacheContexts(['route']);
    $page = ['route' => $this->routeMatch->getRouteName()];

    $route = $this->routeMatch->getRouteObject();
    $request = $this->requestStack->getCurrentRequest();
    if ($route && $request) {
      $title = $this->titleResolver->getTitle($request, $route);
      if (is_string($title) || $title instanceof \Stringable) {
        $page['title'] = strip_tags((string) $title);
      }
    }

    foreach ($this->routeMatch->getParameters() as $parameter) {
      if ($parameter instanceof ContentEntityInterface && $parameter->access('view')) {
        $cacheability->addCacheableDependency($parameter);
        $page['entity'] = [
          'type' => $parameter->getEntityTypeId(),
          'id' => $parameter->id(),
          'bundle' => $parameter->bundle(),
          'label' => (string) $parameter->label(),
        ];
        break;
      }
    }
    return $page;
  }

}
