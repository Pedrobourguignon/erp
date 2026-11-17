import { describe, expect, it } from "vitest";

import { BarcodeBurst } from "./barcode-burst";

/** Feeds `text` + Enter, one key every `gap` ms; returns what the last key produced. */
function type(burst: BarcodeBurst, text: string, gap: number, start = 1000) {
  let time = start;
  let result: string | null = null;
  for (const key of [...text, "Enter"]) {
    result = burst.push(key, time);
    time += gap;
  }
  return result;
}

describe("BarcodeBurst", () => {
  it("recognises a reader typing a few ms per key and ending in Enter", () => {
    expect(type(new BarcodeBurst(), "7891000000017", 5)).toBe("7891000000017");
  });

  it("ignores a person typing the same digits", () => {
    expect(type(new BarcodeBurst(), "7891000000017", 150)).toBeNull();
  });

  it("ignores a short burst, like a fast double key", () => {
    expect(type(new BarcodeBurst(), "12", 5)).toBeNull();
  });

  // Uma leitura partida no meio deixava só o fim ("2936") — que não pode virar
  // uma leitura de outro produto.
  it("ignores the tail of a read that was split in the middle", () => {
    const burst = new BarcodeBurst();
    type(burst, "78910000", 5, 0);

    expect(type(burst, "2936", 5, 500)).toBeNull();
  });

  // Um pedaço de EAN ("000000") não pode passar por um código inteiro: um
  // código só de números tem no mínimo os 8 dígitos do EAN-8.
  it("ignores a numeric code shorter than an EAN-8", () => {
    expect(type(new BarcodeBurst(), "000000", 5)).toBeNull();
    expect(type(new BarcodeBurst(), "12345670", 5)).toBe("12345670");
  });

  it("still accepts a short SKU with letters", () => {
    expect(type(new BarcodeBurst(), "BON-01", 5)).toBe("BON-01");
  });

  it("ignores an Enter with nothing before it", () => {
    expect(new BarcodeBurst().push("Enter", 1000)).toBeNull();
  });

  it("drops what a person typed before the reader started", () => {
    const burst = new BarcodeBurst();
    burst.push("4", 0);
    burst.push("2", 200);

    expect(type(burst, "7891000000017", 5, 1000)).toBe("7891000000017");
  });

  it("does not count Shift and other non-printing keys sent with letters", () => {
    const burst = new BarcodeBurst();
    let time = 0;
    let result: string | null = null;
    for (const key of ["Shift", "C", "A", "M", "-", "Shift", "M", "0", "1", "Enter"]) {
      result = burst.push(key, time);
      time += 4;
    }

    expect(result).toBe("CAM-M01");
  });

  it("starts over after a recognised code", () => {
    const burst = new BarcodeBurst();
    type(burst, "7891000000017", 5, 0);

    expect(burst.push("Enter", 70)).toBeNull();
  });

  it("accepts a slower wireless reader when told to", () => {
    expect(type(new BarcodeBurst({ avgGapMs: 70 }), "7891000000017", 60)).toBe("7891000000017");
  });

  // Uma página ocupada atrasa uma tecla no meio da leitura; a leitura continua
  // sendo do leitor, e perder os primeiros dígitos é pior que tolerar a pausa.
  it("survives one stall in the middle of a fast read", () => {
    const burst = new BarcodeBurst();
    let time = 0;
    let result: string | null = null;
    for (const [i, key] of [..."7891000000017", "Enter"].entries()) {
      time += i === 3 ? 80 : 5;
      result = burst.push(key, time);
    }

    expect(result).toBe("7891000000017");
  });

  it("ignores a fast typist, whose keys average far above the reader", () => {
    expect(type(new BarcodeBurst(), "12345678", 70)).toBeNull();
  });
});
