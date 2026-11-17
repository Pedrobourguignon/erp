/**
 * Opens the browser print dialog of a frame. Isolated so tests can replace it
 * (jsdom has no printing) and so there is one place to change if a local print
 * agent ever replaces the dialog.
 */
export function printWindow(target: Window): void {
  target.focus();
  target.print();
}
