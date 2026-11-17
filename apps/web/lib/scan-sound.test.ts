import { afterEach, describe, expect, it, vi } from "vitest";

import { playScanSound } from "./scan-sound";

const frequencies: number[] = [];

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createOscillator() {
    return {
      type: "",
      frequency: { set value(v: number) { frequencies.push(v); } },
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    };
  }
  createGain() {
    return { gain: { value: 0 }, connect: () => undefined };
  }
}

describe("playScanSound", () => {
  afterEach(() => {
    frequencies.length = 0;
    vi.unstubAllGlobals();
  });

  it("beeps high on a read that found the product and low on an error", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);

    playScanSound("ok");
    playScanSound("error");

    expect(frequencies[0]).toBeGreaterThan(frequencies[1]);
  });

  // Sem áudio (navegador antigo, política de autoplay) a venda segue em silêncio.
  it("never breaks the sale when the browser has no audio", () => {
    vi.stubGlobal("AudioContext", undefined);

    expect(() => playScanSound("ok")).not.toThrow();
  });
});
