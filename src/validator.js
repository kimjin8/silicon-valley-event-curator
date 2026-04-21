// ============================================================
// validator.js — Sanity checks on Gemini's curated HTML output
// ============================================================
//
// Gemini can return HTML that parses cleanly (finishReason: STOP)
// but contains hallucinated URLs or drops legitimate events. These
// checks catch the two failure modes we've seen in production so
// the curator can advance to the next model instead of emailing
// garbage.
//
// The checks are intentionally coarse — they're a floor, not a
// filter. The AI stays in charge of judgment; we only reject
// outputs that violate factual invariants.
// ============================================================

/**
 * Extract all event-link URLs that appear in input scraper data.
 * We collect: Luma event.link, CV event.url, and any URL from SF IRL raw text.
 */
function collectInputUrls(mergedData) {
  const urls = new Set();

  const lumaEvents = mergedData?.lumaSFEvents?.events || [];
  lumaEvents.forEach((e) => {
    if (e.link) urls.add(e.link);
  });

  const cvEvents = mergedData?.cerebralValleyEvents?.events || [];
  cvEvents.forEach((e) => {
    if (e.url) urls.add(e.url);
  });

  const sfIrlArticleUrl = mergedData?.sfIrlEvents?.articleUrl;
  if (sfIrlArticleUrl) urls.add(sfIrlArticleUrl);

  const sfIrlRaw = mergedData?.sfIrlEvents?.raw || "";
  for (const match of sfIrlRaw.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    urls.add(match[0]);
  }

  return urls;
}

/**
 * Does `outputUrl` correspond to any URL that was in the input?
 *
 * Tolerances:
 * - lu.ma and luma.com are the same platform — accept either spelling
 *   of the same slug
 * - trailing slashes, http vs https, www. prefix: normalized away
 * - if the output URL's final path segment (slug) appears in any input
 *   URL, it's considered a match — this catches Luma short-links
 */
function urlInInput(outputUrl, inputUrls) {
  if (!outputUrl) return true;

  const normalize = (u) =>
    u
      .replace(/^http:\/\//, "https://")
      .replace(/^https:\/\/www\./, "https://")
      .replace(/\/+$/, "");

  const normalizedOutput = normalize(outputUrl);
  for (const u of inputUrls) {
    if (normalize(u) === normalizedOutput) return true;
  }

  let outHost;
  let outSlug;
  try {
    const parsed = new URL(outputUrl);
    outHost = parsed.host.replace(/^www\./, "");
    const segments = parsed.pathname.split("/").filter(Boolean);
    outSlug = segments[segments.length - 1] || "";
  } catch {
    return false;
  }

  const lumaHosts = new Set(["lu.ma", "luma.com"]);

  if (outSlug && outSlug.length >= 4) {
    for (const u of inputUrls) {
      if (u.includes(outSlug)) return true;
    }
  }

  if (lumaHosts.has(outHost)) {
    for (const u of inputUrls) {
      try {
        const uHost = new URL(u).host.replace(/^www\./, "");
        if (lumaHosts.has(uHost)) {
          const uSlug = new URL(u).pathname.split("/").filter(Boolean).pop() || "";
          if (uSlug && outSlug && uSlug === outSlug) return true;
        }
      } catch {}
    }
  }

  return false;
}

/**
 * Extract external hrefs from the shortlist + radar sections of the output HTML.
 * Skips utility links (mailto:, tel:, #anchors).
 */
function extractOutputUrls(html) {
  const sectionStart = html.search(/SHORTLISTED FOR YOU/i);
  const section = sectionStart >= 0 ? html.slice(sectionStart) : html;
  const urls = [];
  for (const m of section.matchAll(/href="([^"]+)"/gi)) {
    const h = m[1];
    if (/^https?:\/\//i.test(h)) urls.push(h);
  }
  return urls;
}

/**
 * Validate the AI's curated HTML against the input data.
 *
 * @param {string} html - Curator output HTML
 * @param {object} mergedData - The merged input that was sent to the AI
 * @returns {{ok: boolean, reasons: string[], stats: object}}
 */
function validateCurationOutput(html, mergedData) {
  const reasons = [];
  const inputUrls = collectInputUrls(mergedData);

  const outputUrls = extractOutputUrls(html);
  const uniqueOutputUrls = [...new Set(outputUrls)];
  const unknown = uniqueOutputUrls.filter((u) => !urlInInput(u, inputUrls));
  if (unknown.length > 0) {
    reasons.push(
      `${unknown.length} hallucinated URL(s): ${unknown.slice(0, 3).join(", ")}`
    );
  }

  const lumaCount = (mergedData?.lumaSFEvents?.events || []).length;
  const cvCount = (mergedData?.cerebralValleyEvents?.events || []).length;
  const inputEventCount = lumaCount + cvCount;

  const shortlistMatch = html.match(/SHORTLISTED FOR YOU \((\d+) EVENTS?\)/i);
  const shortlistCount = shortlistMatch ? parseInt(shortlistMatch[1], 10) : 0;

  const radarSection = html.split(/ALSO ON YOUR RADAR/i)[1] || "";
  const radarCount = (radarSection.match(/[A-Z]+DAY · [A-Z]+ \d+/g) || []).length;

  const surfaced = shortlistCount + radarCount;

  // Coverage floor: with ≥10 scraped events, surfacing <3 total means the AI
  // dropped the ball. The 10am prod run had 98 events and surfaced 2 — exactly
  // the pattern this catches.
  if (inputEventCount >= 10 && surfaced < 3) {
    reasons.push(
      `Surfaced only ${surfaced} events (${shortlistCount} shortlist + ${radarCount} radar) from ${inputEventCount} scraped events`
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    stats: {
      inputEventCount,
      outputUrlCount: uniqueOutputUrls.length,
      unknownUrlCount: unknown.length,
      shortlistCount,
      radarCount,
    },
  };
}

module.exports = {
  validateCurationOutput,
  urlInInput,
  collectInputUrls,
  extractOutputUrls,
};
