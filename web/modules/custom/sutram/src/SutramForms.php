<?php

declare(strict_types=1);

namespace Drupal\sutram;

use Drupal\Component\Utility\Html;
use Drupal\Core\Entity\ContentEntityFormInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityChangedInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Render\Element;
use Drupal\Core\Security\TrustedCallbackInterface;
use Drupal\Core\Session\AccountInterface;

/**
 * Describes content entity forms for the form provider, as drupalSettings.
 *
 * For each form the browser gets a command-safe id, the entity, and the
 * editable fields as dotted paths with their type, whether they are required,
 * their allowed values, their current value, and the name of the input that
 * holds it. After a failed save it also gets the errors, by field. The
 * provider in js/sutram.form.js turns that into commands.
 *
 * Paths follow the entity: the field name, then a property only when the
 * widget edits several (body.value, body.summary, path.alias). A field whose
 * widget the provider cannot fill yet (dates, files, several values) is still
 * listed, as unsupported.
 */
final class SutramForms implements TrustedCallbackInterface {

  /**
   * Form element types the provider can read and fill, and their value type.
   */
  private const TYPES = [
    'textfield' => 'string',
    'textarea' => 'text',
    'select' => 'choice',
    'checkbox' => 'boolean',
    'entity_autocomplete' => 'reference',
    'number' => 'number',
    'email' => 'string',
    'url' => 'string',
    'tel' => 'string',
  ];

  /**
   * Element types that hold a value the provider cannot fill yet.
   */
  private const UNSUPPORTED = ['datetime', 'date', 'managed_file', 'radios', 'checkboxes', 'password', 'password_confirm', 'machine_name'];

  /**
   * Marks a content entity form for Sutram, for users who may use it.
   * Called from hook_form_alter().
   */
  public function prepare(array &$form, FormStateInterface $form_state, AccountInterface $account): void {
    $object = $form_state->getFormObject();
    if (!$object instanceof ContentEntityFormInterface) {
      return;
    }
    $entity = $object->getEntity();
    if (!$entity instanceof ContentEntityInterface) {
      return;
    }
    $form['#cache']['contexts'][] = 'user.permissions';
    if (!$account->hasPermission('use sutram')) {
      return;
    }
    $fields = [];
    foreach ($object->getFormDisplay($form_state)->getComponents() as $name => $component) {
      if (isset($form[$name]) && $entity->hasField($name)) {
        $fields[$name] = (string) $entity->getFieldDefinition($name)->getLabel();
      }
    }
    $form['#sutram'] = [
      'entity' => [
        'type' => $entity->getEntityTypeId(),
        'bundle' => $entity->bundle(),
        'id' => $entity->isNew() ? NULL : (string) $entity->id(),
        'label' => $entity->isNew() ? '' : (string) $entity->label(),
        'changed' => $entity instanceof EntityChangedInterface && !$entity->isNew() ? $entity->getChangedTime() : NULL,
      ],
      'fields' => $fields,
    ];
    $form['#pre_render'][] = [self::class, 'preRender'];
  }

  /**
   * {@inheritdoc}
   */
  public static function trustedCallbacks(): array {
    return ['preRender'];
  }

  /**
   * Attaches the form's description once it is built and validated.
   *
   * At render time every element has its processed value, its
   * data-drupal-selector and, after a failed submit, its errors.
   */
  public static function preRender(array $form): array {
    $info = $form['#sutram'];
    $id = self::commandId((string) ($form['#attributes']['data-drupal-selector'] ?? $form['#form_id']));
    if ($id === NULL) {
      return $form;
    }

    $fields = [];
    $byParents = [];
    foreach ($info['fields'] as $name => $label) {
      $leaves = [];
      $unsupported = FALSE;
      self::collect($form[$name], $leaves, $unsupported);
      $paths = [];
      foreach ($leaves as $leaf) {
        $rest = array_values(array_filter(array_slice($leaf['#parents'], 1), static fn ($p) => !is_int($p) && !ctype_digit((string) $p)));
        $paths[] = $rest;
      }
      $single = count($leaves) === 1;
      $keys = [];
      foreach ($leaves as $i => $leaf) {
        $rest = $paths[$i];
        $plain = $single && ($rest === [] || $rest === ['value'] || $rest === ['target_id']);
        $keys[$i] = $plain ? $name : $name . '.' . implode('.', $rest);
      }
      // Several values of one field land on the same path: not fillable yet.
      if ($unsupported || !$leaves || count(array_unique($keys)) !== count($keys)) {
        $fields[] = ['field' => $name, 'label' => $label, 'type' => 'unsupported', 'required' => FALSE];
        continue;
      }
      foreach ($leaves as $i => $leaf) {
        $fields[] = self::describe($keys[$i], $label, $leaf, !$single);
        $byParents[implode('][', $leaf['#parents'])] = $keys[$i];
      }
    }

    $errors = [];
    self::errors($form, $info['fields'], $byParents, $errors);

    $submit = self::primaryButton($form);
    \Drupal::logger('sutram')->notice('DBG ' . json_encode(['children' => Element::children($form), 'actions' => isset($form['actions']) ? Element::children($form['actions']) : 'none', 'submit' => $submit['#attributes'] ?? NULL]));
    $form['#attached']['library'][] = 'sutram/form';
    $form['#attached']['drupalSettings']['sutram']['forms'][$id] = [
      'id' => $id,
      'formId' => $form['#form_id'],
      'selector' => $form['#attributes']['data-drupal-selector'] ?? NULL,
      'entity' => $info['entity'],
      'fields' => $fields,
      'errors' => $errors,
    ];
    // Claro renders the node form twice: whole, then again with the actions
    // moved out. Settings from both passes are merged, so only send the
    // button when this pass has it.
    if (isset($submit['#attributes']['data-drupal-selector'])) {
      $form['#attached']['drupalSettings']['sutram']['forms'][$id]['submit'] = $submit['#attributes']['data-drupal-selector'];
    }
    return $form;
  }

  /**
   * The button a person clicks to save: the primary submit button.
   *
   * Looked up by its role rather than by its place in the form, since themes
   * and modules move the actions around.
   */
  private static function primaryButton(array $element): ?array {
    if (($element['#access'] ?? TRUE) === FALSE) {
      return NULL;
    }
    if (($element['#type'] ?? NULL) === 'submit' && ($element['#button_type'] ?? NULL) === 'primary') {
      return $element;
    }
    foreach (Element::children($element) as $key) {
      if (is_array($element[$key]) && ($found = self::primaryButton($element[$key]))) {
        return $found;
      }
    }
    return NULL;
  }

  /**
   * A command-safe id: lowercase words of letters, digits and hyphens.
   */
  private static function commandId(string $value): ?string {
    $id = trim(preg_replace('/-+/', '-', preg_replace('/[^a-z0-9-]/', '-', strtolower(Html::getId($value)))), '-');
    return preg_match('/^[a-z][a-z0-9-]*$/', $id) ? $id : NULL;
  }

  /**
   * Collects the input elements of a field's widget the user may change.
   */
  private static function collect(array $element, array &$leaves, bool &$unsupported): void {
    if (($element['#access'] ?? TRUE) === FALSE) {
      return;
    }
    $type = $element['#type'] ?? NULL;
    if (in_array($type, self::UNSUPPORTED, TRUE)) {
      $unsupported = TRUE;
      return;
    }
    if (isset(self::TYPES[$type]) && !empty($element['#parents'])) {
      $leaves[] = $element;
      return;
    }
    foreach (Element::children($element) as $key) {
      if (is_array($element[$key])) {
        // A text format's value is HTML, edited through the format's editor.
        if ($type === 'text_format' && $key === 'value') {
          $element[$key]['#sutram_html'] = TRUE;
        }
        self::collect($element[$key], $leaves, $unsupported);
      }
    }
  }

  /**
   * Describes one input as a field of the form provider.
   */
  private static function describe(string $path, string $label, array $leaf, bool $part): array {
    $type = self::TYPES[$leaf['#type']];
    if ($type === 'text' && !empty($leaf['#sutram_html'])) {
      $type = 'html';
    }
    if ($type === 'reference' && !empty($leaf['#tags'])) {
      $type = 'references';
    }
    $title = isset($leaf['#title']) ? trim(strip_tags((string) $leaf['#title'])) : '';
    $field = [
      'field' => $path,
      'label' => $part && $title !== '' && $title !== $label ? "$label: $title" : $label,
      'type' => $type,
      'required' => !empty($leaf['#required']),
      'name' => $leaf['#name'] ?? NULL,
      'value' => self::value($leaf),
    ];
    if ($type === 'choice') {
      $field['options'] = self::options($leaf['#options'] ?? []);
    }
    if ($type === 'references' && !empty($leaf['#autocreate'])) {
      $field['autocreate'] = TRUE;
    }
    return $field;
  }

  /**
   * The element's current value as the browser sees it.
   */
  private static function value(array $leaf): string|bool {
    $value = $leaf['#value'] ?? '';
    if ($leaf['#type'] === 'checkbox') {
      return !empty($value);
    }
    if (is_array($value)) {
      return '';
    }
    return (string) $value;
  }

  /**
   * Select options as a flat key → label map, optgroups included.
   */
  private static function options(array $options): array {
    $flat = [];
    foreach ($options as $key => $label) {
      if (is_array($label)) {
        $flat += self::options($label);
      }
      elseif (is_object($label) && property_exists($label, 'option')) {
        $flat += self::options($label->option);
      }
      else {
        $flat[(string) $key] = trim(strip_tags((string) $label));
      }
    }
    return $flat;
  }

  /**
   * Collects validation errors, by field path where there is one.
   */
  private static function errors(array $element, array $fields, array $byParents, array &$errors): void {
    if (!empty($element['#errors']) && !empty($element['#parents'])) {
      $parents = implode('][', $element['#parents']);
      $name = (string) $element['#parents'][0];
      $field = $byParents[$parents] ?? (isset($fields[$name]) ? $name : NULL);
      $errors[] = ['field' => $field, 'message' => trim(strip_tags((string) $element['#errors']))];
    }
    foreach (Element::children($element) as $key) {
      if (is_array($element[$key])) {
        self::errors($element[$key], $fields, $byParents, $errors);
      }
    }
  }

}
