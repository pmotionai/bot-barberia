const axios = require('axios');
const config = require('./config');

const client = axios.create({
  baseURL: 'https://graph.facebook.com/v20.0',
  headers: {
    Authorization: `Bearer ${config.whatsapp.accessToken}`,
    'Content-Type': 'application/json',
  },
});

async function sendTextMessage(phoneNumberId, to, body) {
  try {
    await client.post(`/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error('Error enviando mensaje de WhatsApp:', JSON.stringify(details));
    throw err;
  }
}

module.exports = { sendTextMessage };
