import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NOTE_MAX_LENGTH, normalizeNote, parseNote } from "../src/domain/lifecycle-note.js";

describe("normalizeNote (ADR-0007 §6)", () => {
  it("trims, NFC-normalizes and collapses horizontal whitespace but keeps line breaks", () => {
    assert.equal(normalizeNote("  Replaced\tthe   valve.\nTested   OK.  "), "Replaced the valve.\nTested OK.");
    assert.equal(normalizeNote("Cafe\u0301"), "Caf\u00e9");
  });

  it("unifies line endings and collapses 3+ newlines to 2", () => {
    assert.equal(normalizeNote("a\r\nb\rc"), "a\nb\nc");
    assert.equal(normalizeNote("a\n\n\n\n\nb"), "a\n\nb");
    assert.equal(normalizeNote("a \n b"), "a\nb");
  });

  it("removes control, zero-width and bidi override characters", () => {
    assert.equal(normalizeNote("a\u0007b\u200Bc\u202Ed\u2066e"), "abcde");
  });

  it("returns undefined for blank and non-string input", () => {
    for (const v of ["", "   ", "\n\t\r\n", undefined, null, 5, {}, []]) {
      assert.equal(normalizeNote(v), undefined);
    }
  });

  it("does not interpret markup (plain text stays plain text)", () => {
    assert.equal(normalizeNote("<b>done</b>"), "<b>done</b>");
  });
});

describe("parseNote", () => {
  it("required: rejects absent, null, blank-after-normalization", () => {
    for (const v of [undefined, null, "", "   ", "\n\u200B\t"]) {
      assert.deepEqual(parseNote(v, { required: true }), { ok: false, problem: "note is required" });
    }
  });

  it("optional: absent or blank is accepted as absent", () => {
    for (const v of [undefined, null, "", "   "]) {
      assert.deepEqual(parseNote(v), { ok: true, value: undefined });
    }
  });

  it("returns the normalized value", () => {
    assert.deepEqual(parseNote("  fixed  ", { required: true }), { ok: true, value: "fixed" });
  });

  it("enforces the 2000-character limit after normalization (never truncates)", () => {
    assert.equal(parseNote("x".repeat(NOTE_MAX_LENGTH), { required: true }).ok, true);
    const over = parseNote("x".repeat(NOTE_MAX_LENGTH + 1), { required: true });
    assert.equal(over.ok, false);
    assert.match(over.problem, /at most 2000/);
    // whitespace that normalizes away does not count against the limit
    assert.equal(parseNote(`a${" ".repeat(5000)}b`, { required: true }).ok, true);
  });

  it("rejects a supplied non-string, required or not", () => {
    for (const v of [5, {}, [], true]) {
      assert.equal(parseNote(v).ok, false);
      assert.equal(parseNote(v, { required: true }).ok, false);
    }
  });
});
