// ============================================================
// email.js — Send HTML Emails via Gmail API
// ============================================================
//
// This module constructs and sends emails through the Gmail API.
//
// HOW EMAIL SENDING WORKS:
// The Gmail API doesn't accept a simple "to, subject, body" format.
// Instead, you need to construct a raw email message following the
// RFC 2822 standard (a technical specification for email format),
// then encode it in base64 (a way to represent binary data as text).
//
// The email is sent as HTML, which allows for the rich formatting
// (colors, buttons, cards) that our curated digest uses.
//
// WHY BASE64?
// The Gmail API's "raw" message field requires base64url encoding.
// This is because email messages can contain special characters,
// attachments, and other binary data that needs to be safely
// transmitted as a text string.
// ============================================================

const { google } = require("googleapis");
const { RECIPIENT_EMAIL } = require("./config");

/**
 * Send an HTML email via Gmail API.
 *
 * Constructs an RFC 2822 email message, base64-encodes it,
 * and sends it through the Gmail API using your authenticated account.
 *
 * @param {google.auth.OAuth2} authClient - Authenticated Google client
 * @param {string} htmlBody - The HTML content of the email
 * @returns {Promise<object>} Gmail API response with message ID
 * @throws {Error} If email sending fails after retry
 */
async function sendEmail(authClient, htmlBody) {
  console.log("📧 Sending email to " + RECIPIENT_EMAIL + "...");

  // Create a Gmail API client
  const gmail = google.gmail({ version: "v1", auth: authClient });

  // Email subject with emoji (requires special encoding)
  const subject = "🗓️ Your Weekly Bay Area Tech Events Shortlist";

  // Construct the email in RFC 2822 format.
  // This is like building an envelope: you specify the recipient,
  // subject, and then the body content.
  const messageParts = [
    `To: ${RECIPIENT_EMAIL}`,
    // The subject uses "base64 encoded word" syntax (=?UTF-8?B?...?=)
    // because the emoji 🗓️ can't be sent as plain ASCII text
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "", // Empty line separates headers from body
    htmlBody,
  ];

  const rawMessage = messageParts.join("\n");

  // Base64url encode the entire message.
  // "base64url" is slightly different from regular base64:
  //   - Replace + with -
  //   - Replace / with _
  //   - Remove trailing = padding
  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // Try sending, with one retry on failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await gmail.users.messages.send({
        userId: "me", // "me" = the authenticated user
        requestBody: { raw: encodedMessage },
      });

      console.log("✅ Email sent! Message ID:", res.data.id);
      return res.data;
    } catch (err) {
      console.error(
        `❌ Email send failed (attempt ${attempt + 1}/2):`,
        err.message
      );

      if (attempt === 0) {
        // Wait 3 seconds before retrying
        console.log("   ↻ Retrying in 3 seconds...");
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        throw new Error("Email sending failed after 2 attempts: " + err.message);
      }
    }
  }
}

module.exports = { sendEmail };
