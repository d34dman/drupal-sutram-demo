<?php

declare(strict_types=1);

namespace Drupal\sutram\Form;

use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Chooses which menus Sutram exposes, and how deep.
 */
final class SettingsForm extends ConfigFormBase {

  /**
   * The menu storage.
   */
  private EntityStorageInterface $menuStorage;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $instance = parent::create($container);
    $instance->menuStorage = $container->get('entity_type.manager')->getStorage('menu');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'sutram_settings';
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames(): array {
    return ['sutram.settings'];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $current = [];
    foreach ($this->config('sutram.settings')->get('menus') ?? [] as $setting) {
      $current[$setting['menu']] = (int) $setting['depth'];
    }

    $form['intro'] = [
      '#markup' => '<p>' . $this->t('The <code>nav</code> provider lets people in the Sutram console and AI agents browse these menus: <code>nav tree</code>, <code>nav find</code> and <code>nav go</code>. Each user sees only the links they have access to.') . '</p>',
    ];
    $form['menus'] = [
      '#type' => 'table',
      '#header' => [$this->t('Menu'), $this->t('Expose'), $this->t('Levels')],
    ];
    $menus = $this->menuStorage->loadMultiple();
    foreach ($menus as $id => $menu) {
      $form['menus'][$id]['label'] = ['#plain_text' => $menu->label()];
      $form['menus'][$id]['enabled'] = [
        '#type' => 'checkbox',
        '#title' => $this->t('Expose @menu', ['@menu' => $menu->label()]),
        '#title_display' => 'invisible',
        '#default_value' => isset($current[$id]),
      ];
      $form['menus'][$id]['depth'] = [
        '#type' => 'number',
        '#title' => $this->t('Levels of @menu', ['@menu' => $menu->label()]),
        '#title_display' => 'invisible',
        '#min' => 1,
        '#max' => 9,
        '#default_value' => $current[$id] ?? 3,
      ];
    }
    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $menus = [];
    foreach ($form_state->getValue('menus') ?? [] as $id => $row) {
      if (!empty($row['enabled'])) {
        $menus[] = ['menu' => (string) $id, 'depth' => (int) $row['depth']];
      }
    }
    $this->config('sutram.settings')->set('menus', $menus)->save();
    parent::submitForm($form, $form_state);
  }

}
