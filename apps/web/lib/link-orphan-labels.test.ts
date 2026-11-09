import { describe, it, expect, beforeEach } from "vitest";

import { linkOrphanLabels } from "./link-orphan-labels";

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe("linkOrphanLabels", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("should link a label to the input that follows it", () => {
    const root = mount(
      `<div><label>Nome *</label><input name="name" /></div>`
    );

    linkOrphanLabels(root);

    const label = root.querySelector("label") as HTMLLabelElement;
    const input = root.querySelector("input") as HTMLInputElement;
    expect(input.id).not.toBe("");
    expect(label.htmlFor).toBe(input.id);
  });

  it("should reuse the id the control already has", () => {
    const root = mount(`<div><label>CPF</label><input id="cpf" /></div>`);

    linkOrphanLabels(root);

    expect((root.querySelector("label") as HTMLLabelElement).htmlFor).toBe("cpf");
    expect((root.querySelector("input") as HTMLInputElement).id).toBe("cpf");
  });

  it("should link a label to a Radix select trigger", () => {
    const root = mount(
      `<div><label>Tipo *</label><button type="button" role="combobox"></button></div>`
    );

    linkOrphanLabels(root);

    const trigger = root.querySelector("button") as HTMLButtonElement;
    expect((root.querySelector("label") as HTMLLabelElement).htmlFor).toBe(
      trigger.id
    );
  });

  it("should find the control when it is nested in a wrapper", () => {
    const root = mount(
      `<div><label>Valor</label><div class="relative"><input /></div></div>`
    );

    linkOrphanLabels(root);

    const input = root.querySelector("input") as HTMLInputElement;
    expect((root.querySelector("label") as HTMLLabelElement).htmlFor).toBe(
      input.id
    );
  });

  it("should leave a label that already has htmlFor alone", () => {
    const root = mount(
      `<div><label for="a">A</label><input id="a" /><input id="b" /></div>`
    );

    linkOrphanLabels(root);

    expect((root.querySelector("label") as HTMLLabelElement).htmlFor).toBe("a");
  });

  it("should not steal a control that belongs to the next label", () => {
    const root = mount(
      `<div><label>Sem campo</label><label>Com campo</label><input /></div>`
    );

    linkOrphanLabels(root);

    const [first, second] = Array.from(root.querySelectorAll("label"));
    expect(first.htmlFor).toBe("");
    expect(second.htmlFor).not.toBe("");
  });

  it("should not link two labels to the same control", () => {
    const root = mount(
      `<div><label>A</label><input /></div><div><label>B</label><input /></div>`
    );

    linkOrphanLabels(root);

    const [a, b] = Array.from(root.querySelectorAll("label"));
    expect(a.htmlFor).not.toBe(b.htmlFor);
  });

  it("should skip a control that already has an accessible name", () => {
    const root = mount(
      `<div><label>Busca</label><input aria-label="Buscar produto" /></div>`
    );

    linkOrphanLabels(root);

    expect((root.querySelector("label") as HTMLLabelElement).htmlFor).toBe("");
  });

  it("should ignore a label wrapping its own control", () => {
    const root = mount(`<label>Ativo <input type="checkbox" /></label>`);

    linkOrphanLabels(root);

    expect((root.querySelector("label") as HTMLLabelElement).htmlFor).toBe("");
  });
});
