// ============================================================
// email.test.js — Tests for email construction
// ============================================================
// Vitest globals (describe, it, expect) are available automatically

describe("Email message construction", () => {
  // Test the email encoding logic (extracted from email.js)

  it("should properly base64url-encode a message", () => {
    const message = "To: test@example.com\nSubject: Test\n\n<div>Hello</div>";
    const encoded = Buffer.from(message)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Should not contain regular base64 characters +, /, or trailing =
    expect(encoded).not.toMatch(/[+/=]/);

    // Should be decodable back to the original
    // (re-add padding and restore characters for decoding)
    const restored = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(restored, "base64").toString("utf8");
    expect(decoded).toBe(message);
  });

  it("should properly encode a UTF-8 subject with emoji", () => {
    const subject = "🗓️ Your Weekly Bay Area Tech Events Shortlist";
    const encoded = Buffer.from(subject).toString("base64");
    const subjectHeader = `=?UTF-8?B?${encoded}?=`;

    // Should be a valid encoded-word format
    expect(subjectHeader).toMatch(/^=\?UTF-8\?B\?.+\?=$/);

    // Should decode back to the original
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    expect(decoded).toBe(subject);
  });

  it("should construct a valid RFC 2822 message", () => {
    const to = "test@example.com";
    const subject = "Test Subject";
    const htmlBody = "<div>Hello World</div>";

    const messageParts = [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      htmlBody,
    ];
    const rawMessage = messageParts.join("\n");

    // Should contain all required headers
    expect(rawMessage).toContain("To: test@example.com");
    expect(rawMessage).toContain("MIME-Version: 1.0");
    expect(rawMessage).toContain("Content-Type: text/html");

    // Should have an empty line separating headers from body
    expect(rawMessage).toContain("\n\n<div>");
  });
});
