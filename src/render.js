// ============================================================
// render.js — Deterministic HTML digest from verdicts + candidates
// ============================================================
//
// Every fact on the page (name, link, day, time, location, price,
// source) comes straight from the candidate record. The AI only
// contributes the verdict, a blurb, tags, and the week's note.
// ============================================================

const userConfig = require("../user-config");
const { toPacificTime, formatTimeRange } = require("./scrapers/utils");

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const TAG_STYLES = {
  AI: ["#e3f2fd", "#1976d2", "🤖"],
  Startups: ["#f3e5f5", "#7b1fa2", "🚀"],
  Product: ["#fff3e0", "#e65100", "🎨"],
  Founders: ["#e0f2f1", "#00695c", "👥"],
  Hardware: ["#eceff1", "#37474f", "🔧"],
  Consumer: ["#fce4ec", "#ad1457", "📱"],
  Free: ["#e8f5e9", "#2e7d32", "🔥"],
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pill(text, bg, fg, extra = "") {
  return `<span style="background:${bg};color:${fg};padding:3px 8px;border-radius:4px;font-size:11px;font-weight:bold;${extra}">${esc(text)}</span>`;
}

function dateBadge(c) {
  return `${c.dayOfWeek} · ${c.datePT}`.toUpperCase();
}

function priceBadge(c) {
  if (c.isFree) return pill("FREE", "#e8f5e9", "#2e7d32", "margin-left:8px;");
  if (c.price) return pill(c.price, "#fff3e0", "#e65100", "margin-left:8px;");
  return "";
}

function regionBadge(c) {
  const preferred =
    c.dayType === "weekend" ? userConfig.schedule.weekendRegion : userConfig.schedule.weekdayRegion;
  const label = c.region === "Other" ? "" : c.region;
  if (!label) return "";
  return c.region === preferred
    ? pill(`${label} ✅`, "#ebf5ff", "#007bff", "margin-left:8px;border-radius:10px;")
    : pill(label, "#f5f5f5", "#616161", "margin-left:8px;border-radius:10px;");
}

function tagRow(c, tags) {
  const list = [...new Set([...tags, ...(c.isFree ? ["Free"] : [])])];
  const pills = list
    .filter((t) => TAG_STYLES[t])
    .map((t) => {
      const [bg, fg, emoji] = TAG_STYLES[t];
      return pill(`${emoji} ${t.toUpperCase()}`, bg, fg, "margin-right:5px;");
    });
  pills.push(pill(`Source: ${c.source}`, "#e8f5e9", "#2e7d32", "margin-right:5px;"));
  return pills.join("\n      ");
}

function registerLabel(url) {
  return /^https?:\/\/(www\.)?(lu\.ma|luma\.com)\//i.test(url) ? "Register on Luma →" : "Register →";
}

function shortlistCard(c, d) {
  return `
  <div style="background:#ffffff;border:1px solid #e0e0e0;border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 2px 4px rgba(0,0,0,0.05);">
    <div style="margin-bottom:10px;">
      <span style="color:#e74c3c;font-weight:bold;font-size:13px;">${esc(dateBadge(c))}</span>
      ${priceBadge(c)}
    </div>
    <a href="${esc(c.url)}" style="text-decoration:none;"><h3 style="color:#2c3e50;margin:0 0 10px 0;font-size:18px;">${esc(c.name)}</h3></a>
    <div style="font-size:13px;color:#7f8c8d;margin-bottom:12px;">
      ⏰ ${esc(c.displayTime)} | 📍 ${esc(c.location || "Location on registration page")} ${regionBadge(c)}
    </div>
    <p style="font-size:14px;color:#555;margin-bottom:15px;">${esc(d.blurb)}</p>
    <div style="margin-bottom:15px;">
      ${tagRow(c, d.tags)}
    </div>
    <a href="${esc(c.url)}" style="background-color:#e74c3c;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">${registerLabel(c.url)}</a>
  </div>`;
}

function radarItem(c, d) {
  const reason = d.radarReason
    ? pill(d.radarReason, "#ffebee", "#c62828", "margin-left:8px;font-size:10px;")
    : "";
  return `
  <div style="margin-bottom:20px;padding-left:15px;border-left:3px solid #bdc3c7;">
    <div style="margin-bottom:5px;">
      <span style="color:#e74c3c;font-weight:bold;font-size:12px;">${esc(dateBadge(c))}</span>
      ${reason}
    </div>
    <a href="${esc(c.url)}" style="font-weight:bold;font-size:15px;color:#34495e;text-decoration:none;">${esc(c.name)}</a>
    <div style="font-size:13px;color:#7f8c8d;">${esc(c.displayTime)} | ${esc(c.location)} | ${c.isFree ? "Free" : esc(c.price || "")} | Source: ${esc(c.source)}</div>
    <p style="font-size:13px;color:#666;margin:5px 0;">${esc(d.blurb)}</p>
  </div>`;
}

// Group busy blocks by PT day so the heads-up reads as a schedule, not a dump.
function calendarHeadsUp(busyEvents, prefilterReport) {
  const byDay = new Map();
  for (const b of busyEvents || []) {
    const start = b.start?.dateTime || b.start?.date;
    if (!start) continue;
    const allDay = !b.start?.dateTime;
    const pt = toPacificTime(allDay ? `${b.start.date}T12:00:00` : start);
    const key = `${pt.dayOfWeek.slice(0, 3)} ${pt.datePT}`;
    const when = allDay ? "all day" : formatTimeRange(b.start.dateTime, b.end?.dateTime);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(`${b.summary || "(busy)"} (${when})`);
  }

  const lines = [...byDay.entries()].map(([day, items]) => {
    const shown = items.slice(0, 4).map(esc).join(" · ");
    const more = items.length > 4 ? ` · +${items.length - 4} more` : "";
    return `<div style="margin:4px 0;"><strong>${esc(day)}:</strong> ${shown}${more}</div>`;
  });

  const travel = (prefilterReport?.awayWindows || []).map((w) => {
    const from = toPacificTime(w.from);
    const to = new Date(w.to).getFullYear() > 9000 ? null : toPacificTime(w.to);
    return `<div style="margin:4px 0;">✈️ Out of town from ${esc(from.dayOfWeek)} ${esc(from.datePT)}${to ? ` to ${esc(to.dayOfWeek)} ${esc(to.datePT)}` : " onward"} — those days are excluded.</div>`;
  });

  if (lines.length === 0 && travel.length === 0) return "";
  return `
  <div style="background-color:#d4edfc;padding:20px;border-radius:12px;margin-bottom:30px;border:1px solid #a9d9f9;font-size:14px;color:#004085;">
    <div style="font-weight:bold;color:#0056b3;margin-bottom:10px;">📅 Calendar heads-up:</div>
    ${travel.join("\n    ")}
    ${lines.join("\n    ")}
  </div>`;
}

/**
 * Build the full email body.
 *
 * @param {object} p
 * @param {object} p.dateRange - from computeDateRange(); needs weekLabelPT
 * @param {Array}  p.candidates - from buildCandidates()
 * @param {Array}  p.decisions - validated verdicts from judgeEvents()
 * @param {string} p.note - the AI's one-line framing of the week
 * @param {Array}  p.busyEvents - filtered busy calendar events
 * @param {object} p.prefilterReport - from prefilterMergedData()
 */
function renderDigest({ dateRange, candidates, decisions, note = "", busyEvents = [], prefilterReport = null }) {
  const { region, schedule } = userConfig;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const pick = (verdict) =>
    decisions
      .filter((d) => d.verdict === verdict && byId.has(d.id))
      .map((d) => [byId.get(d.id), d])
      .sort((a, b) => new Date(a[0].date) - new Date(b[0].date));

  const shortlist = pick("shortlist");
  const radar = pick("radar");
  const dropped = prefilterReport?.droppedCount || 0;

  const shortlistHtml = shortlist.length
    ? shortlist.map(([c, d]) => shortlistCard(c, d)).join("\n")
    : `<p style="font-size:14px;color:#555;">Nothing matched your interests and schedule this week — check back next Monday.</p>`;

  const radarHtml = radar.length
    ? `
  <h2 style="font-size:18px;color:#2c3e50;border-bottom:2px solid #bdc3c7;padding-bottom:8px;margin-bottom:20px;">✨ ALSO ON YOUR RADAR</h2>
  <div style="font-size:12px;color:#7f8c8d;margin-bottom:20px;font-style:italic;">(Great interest match — excluded by schedule/location rules)</div>
  ${radar.map(([c, d]) => radarItem(c, d)).join("\n")}`
    : "";

  return `<div style="font-family:${FONT};max-width:600px;margin:0 auto;padding:20px;color:#333;line-height:1.5;">
  <div style="background-color:#1a1a2e;padding:30px;border-radius:12px;text-align:center;margin-bottom:20px;">
    <div style="color:#bdc3c7;font-size:12px;letter-spacing:2px;font-weight:bold;margin-bottom:8px;">YOUR WEEKLY CURATOR</div>
    <h1 style="color:#ffffff;margin:0;font-size:24px;">📅 ${esc(region)} Tech Events</h1>
    <div style="color:#ff6b6b;font-weight:bold;margin-top:10px;font-size:18px;">Week of ${esc(dateRange.weekLabelPT)}</div>
    <div style="display:inline-block;background:rgba(255,255,255,0.1);color:#ffffff;padding:4px 12px;border-radius:20px;font-size:12px;margin-top:15px;">📍 Weekday preference: ${esc(schedule.weekdayRegion)} (${esc(schedule.weekendRegion)} on radar)</div>
  </div>
${note ? `
  <div style="background-color:#fff3cd;border-left:4px solid #ffc107;padding:15px;border-radius:4px;margin-bottom:25px;">
    <span style="font-weight:bold;">⚡ Note:</span> ${esc(note)}
  </div>` : ""}
  <h2 style="font-size:18px;color:#27ae60;border-bottom:2px solid #27ae60;padding-bottom:8px;margin-bottom:20px;">✅ SHORTLISTED FOR YOU (${shortlist.length} EVENT${shortlist.length === 1 ? "" : "S"})</h2>
${shortlistHtml}
${calendarHeadsUp(busyEvents, prefilterReport)}
${radarHtml}
  <div style="font-size:12px;color:#95a5a6;margin-top:30px;border-top:1px solid #eee;padding-top:12px;">
    ${candidates.length} attendable events considered${dropped ? `; ${dropped} more skipped for calendar conflicts or travel` : ""}. Links go straight to each event's own registration page.
  </div>
</div>`;
}

module.exports = { renderDigest, calendarHeadsUp };
