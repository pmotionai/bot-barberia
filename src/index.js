const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const whatsapp = require('./whatsapp');
const conversation = require('./conversation');
const negocios = require('./negocios');

const app = express();

// Necesitamos el body en crudo para poder verificar la firma de Meta antes
// de parsearlo como JSON.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

function isValidSignature(req) {
  if (!config.whatsapp.appSecret) return true; // verificacion desactivada si no hay secret

  const signature = req.get('x-hub-signature-256');
  if (!signature) return false;

  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', config.whatsapp.appSecret)
      .update(req.rawBody)
      .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// Verificacion del webhook (Meta la llama una vez al configurarlo)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepcion de mensajes
app.post('/webhook', (req, res) => {
  if (!isValidSignature(req)) {
    return res.sendStatus(401);
  }

  // Respondemos ya para que Meta no reintente; el procesamiento sigue en
  // segundo plano.
  res.sendStatus(200);

  processWebhookPayload(req.body).catch((err) => {
    console.error('Error procesando el mensaje entrante:', err);
  });
});

async function processWebhookPayload(body) {
  const entries = body.entry || [];

  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const value = change.value || {};
      const messages = value.messages || [];
      if (messages.length === 0) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      const negocio = phoneNumberId ? negocios.findByPhoneNumberId(phoneNumberId) : null;

      if (!negocio) {
        console.error(
          `Mensaje recibido para un phone_number_id (${phoneNumberId}) que no está ` +
            'registrado en negocios.json. Se ignora.'
        );
        continue;
      }

      for (const message of messages) {
        if (message.type !== 'text') continue;

        const from = message.from;
        const text = message.text?.body || '';

        const replies = await conversation.handleIncomingMessage(negocio, from, text);
        for (const reply of replies) {
          await whatsapp.sendTextMessage(negocio.phoneNumberId, from, reply);
        }
      }
    }
  }
}

app.get('/', (req, res) => {
  res.send('Bot de WhatsApp de la barberia activo.');
});

app.listen(config.port, () => {
  console.log(`Servidor escuchando en el puerto ${config.port}`);
});
