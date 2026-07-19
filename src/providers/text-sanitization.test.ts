import { describe, expect, it } from "vitest";
import { stripMarkdownEmphasis } from "./text-sanitization";

describe("stripMarkdownEmphasis", () => {
  it("strips single and double asterisks", () => {
    expect(stripMarkdownEmphasis("this is *important*")).toBe(
      "this is important"
    );
    expect(stripMarkdownEmphasis("this is **important**")).toBe(
      "this is important"
    );
  });

  it("strips HTML emphasis tags", () => {
    expect(stripMarkdownEmphasis("what we <em>don't</em> know")).toBe(
      "what we don't know"
    );
  });

  it("strips arbitrary HTML tags with attributes", () => {
    expect(
      stripMarkdownEmphasis('a <span class="x">tagged</span> word')
    ).toBe("a tagged word");
  });

  it("leaves plain text untouched", () => {
    expect(stripMarkdownEmphasis("nothing to strip here")).toBe(
      "nothing to strip here"
    );
  });
});
