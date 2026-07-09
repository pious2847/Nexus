const axios = require('axios');
const { query } = require('../config/database');
const IllegalDumpSite = require('../models/IllegalDumpSite');

const BASE_URL = 'https://graph.facebook.com/v19.0';

async function sendMessage(phoneNumberId, to, text) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    console.log(`[WhatsApp] (unconfigured) → ${to}: ${text}`);
    return { logged: true };
  }
  const { data } = await axios.post(
    `${BASE_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data;
}

async function handleIncoming(message, contact, coreServices) {
  const rawBody = (message.text?.body || '').trim();
  const body = rawBody.toUpperCase();
  const parts = body.split(/\s+/);
  const cmd = parts[0];

  if (cmd === 'HELP') {
    return `N.E.X.U.S. Commands:
REPORT DUMP [description] — report an illegal dump site
REPORT <type>, <place>, <description> — report a flood/fire/outbreak/other hazard, e.g. REPORT FLOOD, TOLON, Water rising near the market
FLOOD [district] — flood risk & rainfall for a district
HEALTH [district] — community health score
TOILETS NEAR [lat] [lon] — 3 nearest registered toilets
HELP — this message`;
  }

  if (cmd === 'REPORT' && parts[1] === 'DUMP') {
    const desc = parts.slice(2).join(' ') || 'Reported via WhatsApp';
    await IllegalDumpSite.create({
      district: 'Northern',
      severity: 'moderate',
      latitude: 0,
      longitude: 0,
      description: desc,
      reporter_name: contact?.profile?.name || 'WhatsApp User',
      reporter_phone: contact?.wa_id || message.from,
    });
    return `Dump site reported. Thank you! Our team will investigate. Reference: ${new Date().toISOString().slice(0,10)}`;
  }

  // Multi-hazard citizen incident report (Module C gap) — REPORT <type>, <place>,
  // <description>. Same channel-agnostic grammar/parser as the SMS intake
  // (modules/reports/sms/report-sms.parser.ts), submitted through the real
  // multi-hazard ReportsService rather than the legacy sanitation-only dump-site
  // path above. `coreServices` is stashed on `app.locals` by
  // core/http/register.ts; if it's unavailable for any reason this just falls
  // through to "Unknown command" below rather than throwing.
  if (cmd === 'REPORT' && coreServices) {
    const { parseSmsReportCommand, buildConfirmationText } = require('../modules/reports/sms/report-sms.parser');
    const parsed = parseSmsReportCommand(rawBody);
    if (parsed.ok) {
      const resolved = await coreServices.geography.resolveDistrict(parsed.placeText);
      const report = await coreServices.reports.submit(
        {
          hazardType: parsed.hazardType,
          placeId: resolved?.placeId ?? null,
          title: (parsed.description.split(/\r?\n/)[0].trim() || 'Incident reported via WhatsApp').slice(0, 120),
          description: parsed.description,
          source: 'whatsapp',
          reporterPhone: contact?.wa_id || message.from,
        },
        null, // no authenticated user — anonymous/phone-only WhatsApp reporter
      );
      return buildConfirmationText(resolved?.name ?? null, report.id);
    }
  }

  if (cmd === 'FLOOD' && parts[1]) {
    const district = parts.slice(1).join(' ');
    const { rows } = await query(
      `SELECT precipitation_mm, total_precip_24h, temperature_c, recorded_at
       FROM weather_history WHERE district ILIKE $1 ORDER BY recorded_at DESC LIMIT 1`,
      [`%${district}%`]
    );
    if (!rows.length) return `No weather data found for "${district}". Try: Tamale Metro, Savelugu, Yendi`;
    const w = rows[0];
    const risk = (w.total_precip_24h || w.precipitation_mm || 0) > 25 ? 'HIGH' : 'LOW';
    return `${district} Weather:
Rainfall (24h): ${parseFloat(w.total_precip_24h || w.precipitation_mm || 0).toFixed(1)}mm
Temperature: ${parseFloat(w.temperature_c || 0).toFixed(1)}°C
Flood Risk: ${risk}
Updated: ${new Date(w.recorded_at).toLocaleDateString()}`;
  }

  if (cmd === 'HEALTH' && parts[1]) {
    const district = parts.slice(1).join(' ');
    const { rows } = await query(
      `SELECT score, computed_at FROM community_health_scores WHERE district ILIKE $1 ORDER BY computed_at DESC LIMIT 1`,
      [`%${district}%`]
    );
    if (!rows.length) return `No health score for "${district}". Try: Tamale Metro, Savelugu, Yendi`;
    const h = rows[0];
    const grade = h.score >= 80 ? 'Good' : h.score >= 60 ? 'Fair' : 'Needs Attention';
    return `${district} Health Score: ${parseFloat(h.score).toFixed(1)}/100 (${grade})
Updated: ${new Date(h.computed_at).toLocaleDateString()}`;
  }

  if (cmd === 'TOILETS' && parts[1] === 'NEAR' && parts[2] && parts[3]) {
    const lat = parseFloat(parts[2]);
    const lon = parseFloat(parts[3]);
    if (isNaN(lat) || isNaN(lon)) return 'Invalid coordinates. Use: TOILETS NEAR 9.4008 -0.8393';
    const { rows } = await query(
      `SELECT owner_name, toilet_type, condition, community, district,
              ROUND((point(longitude,latitude)<->point($2,$1))::numeric * 111000) AS dist_m
       FROM registered_toilets
       WHERE latitude IS NOT NULL ORDER BY dist_m LIMIT 3`,
      [lat, lon]
    );
    if (!rows.length) return 'No registered toilets found near that location.';
    const list = rows.map((t,i) => `${i+1}. ${t.owner_name} (${t.toilet_type}) — ${t.community}, ${t.district} — ~${t.dist_m}m away — Condition: ${t.condition}`).join('\n');
    return `3 Nearest Toilets:\n${list}`;
  }

  return `Unknown command. Send HELP for available commands.`;
}

function verifyWebhook(mode, token, challenge) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'nexus_whatsapp_verify_2024';
  if (mode === 'subscribe' && token === verifyToken) return challenge;
  return null;
}

module.exports = { sendMessage, handleIncoming, verifyWebhook };
