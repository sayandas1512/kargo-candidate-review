import { describe, it, expect } from "vitest";
import { isGrounded } from "@/lib/ground";

const SOURCE = `Led a vendor migration after finding reliability issues, cutting lag by 60% with no data loss. Built a BoL verification prototype over a weekend; 30 colleagues used it within a month.`;

describe("isGrounded", () => {
  it("passes on an exact quote", () => {
    expect(isGrounded("Led a vendor migration after finding reliability issues", SOURCE)).toBe(true);
  });

  it("passes on a quote that differs only in case and punctuation", () => {
    expect(isGrounded("led a VENDOR migration, after finding reliability issues!", SOURCE)).toBe(true);
  });

  it("passes on a lightly paraphrased quote via token overlap", () => {
    expect(isGrounded("vendor migration after finding reliability issues cutting lag", SOURCE)).toBe(true);
  });

  it("fails on a fabricated quote with no real overlap", () => {
    expect(isGrounded("negotiated a seven figure enterprise contract with a Fortune 500 client", SOURCE)).toBe(false);
  });

  it("fails on an empty quote", () => {
    expect(isGrounded("", SOURCE)).toBe(false);
  });

  it("fails when the quote invents a number not in the source", () => {
    expect(isGrounded("cutting lag by 95% with no data loss and record profit", SOURCE)).toBe(false);
  });
});
