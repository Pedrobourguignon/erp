/**
 * Gives every orphan `<label>` the control it sits next to.
 *
 * The forms were written as `<label>Nome *</label><Input {...register()} />`:
 * the text is beside the field, but nothing tells the browser they belong
 * together. A screen reader announces an unnamed "edit text", clicking the
 * label does not focus the field, and `getByLabel` finds nothing — 124 labels
 * across 36 files were like that.
 *
 * Rewriting each one by hand is a huge diff with no way to exercise every page,
 * so this links them where the DOM already shows the intent: the first control
 * that follows the label inside its parent, before the next label starts. New
 * code should still write `htmlFor`/`id` — this is the net under what slips.
 */

const CONTROL_SELECTOR = [
  "input:not([type=hidden]):not([type=radio])",
  "textarea",
  "select",
  'button[role="combobox"]',
].join(",");

let nextId = 0;

function isLabelled(control: HTMLElement): boolean {
  if (control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby")) {
    return true;
  }
  const labels = (control as HTMLInputElement).labels;
  return !!labels && labels.length > 0;
}

function findControl(label: HTMLLabelElement): HTMLElement | null {
  let sibling = label.nextElementSibling;
  while (sibling) {
    // The next label owns whatever control comes after it.
    if (sibling.tagName === "LABEL") {
      return null;
    }
    if (sibling.matches(CONTROL_SELECTOR)) {
      return sibling as HTMLElement;
    }
    const nested = sibling.querySelector<HTMLElement>(CONTROL_SELECTOR);
    if (nested) {
      return nested;
    }
    sibling = sibling.nextElementSibling;
  }
  return null;
}

export function linkOrphanLabels(root: ParentNode): void {
  const labels = root.querySelectorAll<HTMLLabelElement>("label");

  labels.forEach((label) => {
    if (label.htmlFor) {
      return;
    }
    // A label that wraps its control is already associated.
    if (label.querySelector(CONTROL_SELECTOR)) {
      return;
    }

    const control = findControl(label);
    if (!control || isLabelled(control)) {
      return;
    }

    if (!control.id) {
      nextId += 1;
      control.id = `auto-field-${nextId}`;
    }
    label.htmlFor = control.id;
  });
}
