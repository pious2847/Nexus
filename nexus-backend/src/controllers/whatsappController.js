const whatsappService = require('../services/whatsappService');

async function webhook(req, res) {
  // Express/qs parses "hub.mode" as nested { hub: { mode } } — support both
  const mode = req.query['hub.mode'] || req.query?.hub?.mode;
  const token = req.query['hub.verify_token'] || req.query?.hub?.verify_token;
  const challenge = req.query['hub.challenge'] || req.query?.hub?.challenge;

  const result = whatsappService.verifyWebhook(mode, token, challenge);
  if (result !== null) return res.status(200).send(result);
  res.status(403).json({ success: false, message: 'Verification failed' });
}

async function receive(req, res, next) {
  try {
    res.status(200).json({ success: true }); // respond immediately to Meta

    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    if (!value?.messages) return;

    const message = value.messages[0];
    const contact = value.contacts?.[0];
    if (!message || message.type !== 'text') return;

    const phoneNumberId = value.metadata?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const replyText = await whatsappService.handleIncoming(message, contact, req.app.locals.coreServices);
    await whatsappService.sendMessage(phoneNumberId, message.from, replyText);
  } catch (err) {
    console.error('[WhatsApp] receive error:', err.message);
  }
}

module.exports = { webhook, receive };
