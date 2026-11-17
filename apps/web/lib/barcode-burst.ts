/**
 * Tells a barcode reader from a person by the rhythm of the keys.
 *
 * The reader is a keyboard (HID): it "types" the code a few milliseconds per
 * key and ends with Enter. Nobody types 13 characters that fast, so a run of
 * quick keys ending in Enter is a read — wherever the cursor happens to be.
 *
 * The rhythm is judged on the **average** gap, not on every gap: a busy page
 * can delay one key in the middle of a read, and treating that as two bursts
 * lost the first digits into whatever field had the cursor.
 */
export interface BarcodeBurstOptions {
  /** Average pause between keys of a read. Readers sit at 1–10 ms; wireless ones are slower. */
  avgGapMs?: number;
  /** A pause longer than this ends any burst (a person, or a new read). */
  maxGapMs?: number;
  /**
   * Shortest code worth treating as a read. EAN-8 has 8; 6 still covers short
   * SKUs, and keeps the tail of a split read ("2936") from passing as a code.
   */
  minLength?: number;
}

const DEFAULT_AVG_GAP_MS = 30;
const DEFAULT_MAX_GAP_MS = 100;
const DEFAULT_MIN_LENGTH = 6;
/** A code of digits only is an EAN/GTIN, and the shortest of those is EAN-8. */
const MIN_NUMERIC_LENGTH = 8;

export class BarcodeBurst {
  private readonly avgGapMs: number;
  private readonly maxGapMs: number;
  private readonly minLength: number;
  private buffer = "";
  private firstAt = 0;
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(options: BarcodeBurstOptions = {}) {
    this.avgGapMs = options.avgGapMs ?? DEFAULT_AVG_GAP_MS;
    this.maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
    this.minLength = options.minLength ?? DEFAULT_MIN_LENGTH;
  }

  /** Feeds one key (`KeyboardEvent.key`); returns the code when the read ends. */
  push(key: string, at: number): string | null {
    const continues = at - this.lastAt <= this.maxGapMs;

    if (key === "Enter") {
      const longEnough =
        this.buffer.length >= (/^\d+$/.test(this.buffer) ? Math.max(this.minLength, MIN_NUMERIC_LENGTH) : this.minLength);
      const code = continues && longEnough && this.averageGap(at) <= this.avgGapMs ? this.buffer : null;
      this.reset();
      return code;
    }
    // Shift (sent with letters), Control, F-keys…: not part of the code, and
    // they must not break the rhythm either.
    if (key.length !== 1) {return null;}

    if (continues && this.buffer) {
      this.buffer += key;
    } else {
      this.buffer = key;
      this.firstAt = at;
    }
    this.lastAt = at;
    return null;
  }

  /** How many keys of the current burst already reached the page. */
  get length(): number {
    return this.buffer.length;
  }

  /** Average gap of the burst, counting the key arriving at `at`. */
  private averageGap(at: number): number {
    return (at - this.firstAt) / Math.max(this.buffer.length, 1);
  }

  private reset(): void {
    this.buffer = "";
    this.firstAt = 0;
    this.lastAt = Number.NEGATIVE_INFINITY;
  }
}
