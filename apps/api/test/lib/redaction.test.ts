import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../../src/lib/crypto.js";
import { createRedactionState, redactDeep, redactText } from "../../src/lib/redaction.js";

const KEY = "0".repeat(64);

describe("redactText", () => {
  it("redacts an email", () => {
    const state = createRedactionState();
    expect(redactText("Contact me at rohit@example.com please", state)).toBe(
      "Contact me at {{EMAIL_1}} please",
    );
  });

  it("redacts a digit-formatted phone number", () => {
    const state = createRedactionState();
    expect(redactText("Call me at 914-810-3924 anytime", state)).toBe("Call me at {{PHONE_1}} anytime");
  });

  it("redacts a spelled-out phone number -- confirmed necessary against real transcript data, where phone numbers are transcribed as words", () => {
    const state = createRedactionState();
    expect(redactText("Sure, nine one four eight one zero three nine two four.", state)).toBe(
      "Sure, {{PHONE_1}}.",
    );
  });

  it("does not redact short number-word runs below the phone-number threshold", () => {
    const state = createRedactionState();
    expect(redactText("I have two kids and nine cats", state)).toBe("I have two kids and nine cats");
  });

  it("redacts a 12+ digit card-like run without it being caught by the phone pattern first", () => {
    const state = createRedactionState();
    expect(redactText("Card number 4111 1111 1111 1111 expires soon", state)).toBe(
      "Card number {{CARD_1}} expires soon",
    );
  });

  it("redacts a street address", () => {
    const state = createRedactionState();
    expect(redactText("I live at 123 Main Street in town", state)).toContain("{{ADDRESS_1}}");
  });

  it("does not redact names", () => {
    const state = createRedactionState();
    expect(redactText("My name is Rohit Sharma", state)).toBe("My name is Rohit Sharma");
  });

  it("reuses the same token for the same value seen twice, case-insensitively", () => {
    const state = createRedactionState();
    redactText("Nine one four eight one zero three nine two four", state);
    const second = redactText("nine one four eight one zero three nine two four", state);
    expect(second).toBe("{{PHONE_1}}");
    expect(Object.keys(state.mapping)).toHaveLength(1);
  });
});

describe("redactDeep", () => {
  it("redacts nested string values in an object/array structure", () => {
    const state = createRedactionState();
    const input = { contact: { email: "a@b.com" }, notes: ["call 914-810-3924"] };
    const result = redactDeep(input, state) as typeof input;
    expect(result.contact.email).toBe("{{EMAIL_1}}");
    expect(result.notes[0]).toBe("call {{PHONE_1}}");
  });
});

describe("redaction map encryption round-trip", () => {
  it("encrypts and decrypts the mapping correctly", () => {
    const state = createRedactionState();
    redactText("Email me at a@b.com", state);

    const ciphertext = encryptToken(JSON.stringify(state.mapping), KEY);
    const decrypted = JSON.parse(decryptToken(ciphertext, KEY));
    expect(decrypted).toEqual(state.mapping);
  });
});
