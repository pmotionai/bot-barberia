const axios = require('axios');
const config = require('./config');

const client = axios.create({
  baseURL: 'https://graph.facebook.com/v20.0',
  headers: {
    Authorization: `Bearer ${config.whatsapp.accessToken}`,
    'Content-Type': 'application/json',
  },
});

async function sendPayload(phoneNumberId, payload) {
  try {
    await client.post(`/${phoneNumberId}/messages`, payload);
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error('Error enviando mensaje de WhatsApp:', JSON.stringify(details));
    throw err;
  }
}

async function sendTextMessage(phoneNumberId, to, body) {
  return sendPayload(phoneNumberId, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  });
}

/**
 * Envia un mensaje de lista desplegable ("interactive" / "list").
 * spec: { body, buttonText, sections: [{ title, rows: [{id, title, description?}] }] }
 */
async function sendListMessage(phoneNumberId, to, spec) {
  return sendPayload(phoneNumberId, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: spec.body },
      action: {
        button: spec.buttonText,
        sections: spec.sections,
      },
    },
  });
}

/**
 * Envia un mensaje con botones de respuesta rapida ("interactive" /
 * "button"). WhatsApp permite un maximo de 3 botones por mensaje.
 * spec: { body, buttons: [{id, title}] }
 */
async function sendButtonMessage(phoneNumberId, to, spec) {
  return sendPayload(phoneNumberId, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: spec.body },
      action: {
        buttons: spec.buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  });
}

/** Envia el mensaje descrito por `spec` (kind: 'text' | 'list' | 'buttons'). */
async function sendMessage(phoneNumberId, to, spec) {
  if (spec.kind === 'list') return sendListMessage(phoneNumberId, to, spec);
  if (spec.kind === 'buttons') return sendButtonMessage(phoneNumberId, to, spec);
  return sendTextMessage(phoneNumberId, to, spec.text);
}

module.exports = { sendTextMessage, sendListMessage, sendButtonMessage, sendMessage };
