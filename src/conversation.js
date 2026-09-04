const { DateTime } = require('luxon');
const faq = require('./faq');
const googleCalendar = require('./googleCalendar');

// Estado de la conversacion por negocio + numero de telefono. En memoria: se
// pierde al reiniciar el proceso, suficiente para este bot de un solo
// servidor.
const sessions = new Map();

function sessionKey(negocio, from) {
  return `${negocio.id}:${from}`;
}

function getSession(negocio, from) {
  const key = sessionKey(negocio, from);
  if (!sessions.has(key)) {
    sessions.set(key, { state: 'idle' });
  }
  return sessions.get(key);
}

function resetSession(negocio, from) {
  sessions.set(sessionKey(negocio, from), { state: 'idle' });
}

function normalize(text) {
  return text
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function isAffirmative(text) {
  return /^(si|si\.|s|vale|confirmo|ok|de acuerdo)$/.test(normalize(text));
}

function isNegative(text) {
  return /^(no|no\.|n|cancelar|cancela)$/.test(normalize(text));
}

/**
 * Intenta interpretar una fecha en formato DD/MM o DD/MM/YYYY.
 * Devuelve un DateTime (inicio del dia, zona del negocio) o null si no es valida.
 */
function parseDate(negocio, text) {
  const match = text.trim().match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (!match) return null;

  const [, dayStr, monthStr, yearStr] = match;
  const now = DateTime.now().setZone(negocio.timezone);
  let year = yearStr ? parseInt(yearStr, 10) : now.year;
  if (year < 100) year += 2000;

  const day = DateTime.fromObject(
    { year, month: parseInt(monthStr, 10), day: parseInt(dayStr, 10) },
    { zone: negocio.timezone }
  );

  if (!day.isValid) return null;
  return day;
}

function formatSlotsList(slots) {
  return slots.map((slot, i) => `${i + 1}. ${slot.toFormat('HH:mm')}`).join('\n');
}

function findChosenSlot(text, slots) {
  const cleaned = text.trim();

  const asIndex = parseInt(cleaned, 10);
  if (!Number.isNaN(asIndex) && slots[asIndex - 1]) {
    return slots[asIndex - 1];
  }

  const timeMatch = cleaned.match(/^(\d{1,2})[:.h](\d{2})$/);
  if (timeMatch) {
    const [, h, m] = timeMatch;
    return slots.find((s) => s.hour === parseInt(h, 10) && s.minute === parseInt(m, 10)) || null;
  }

  return null;
}

/**
 * Procesa un mensaje entrante de un negocio concreto y devuelve la lista de
 * mensajes de texto a enviar de vuelta al cliente. Puede tener efectos
 * secundarios (crear una cita en Google Calendar).
 */
async function handleIncomingMessage(negocio, from, rawText) {
  const text = (rawText || '').trim();
  const session = getSession(negocio, from);
  const normalized = normalize(text);

  if (session.state !== 'idle' && normalized === 'cancelar') {
    resetSession(negocio, from);
    return ['Reserva cancelada. Escribe "reservar" cuando quieras volver a intentarlo.'];
  }

  switch (session.state) {
    case 'idle':
      return handleIdle(negocio, from, text, normalized);
    case 'awaiting_service':
      return handleAwaitingService(negocio, from, text, session);
    case 'awaiting_date':
      return handleAwaitingDate(negocio, from, text, session);
    case 'awaiting_slot':
      return handleAwaitingSlot(negocio, from, text, session);
    case 'awaiting_confirmation':
      return handleAwaitingConfirmation(negocio, from, text, session);
    case 'awaiting_cancel_choice':
      return handleAwaitingCancelChoice(negocio, from, text, session);
    case 'awaiting_cancel_confirmation':
      return handleAwaitingCancelConfirmation(negocio, from, text, session);
    default:
      resetSession(negocio, from);
      return [faq.menuText(negocio)];
  }
}

function isCancelIntent(normalized) {
  return /cancelar|anular/.test(normalized);
}

function handleIdle(negocio, from, text, normalized) {
  if (isCancelIntent(normalized)) {
    const session = getSession(negocio, from);
    return startCancelFlow(negocio, from, session);
  }
  if (/horario/.test(normalized)) {
    return [faq.horariosText(negocio)];
  }
  if (/servicio/.test(normalized)) {
    return [faq.serviciosText(negocio)];
  }
  if (/precio|cuanto cuesta|coste/.test(normalized)) {
    return [faq.preciosText(negocio)];
  }
  if (/reserv|cita|agendar/.test(normalized)) {
    const session = getSession(negocio, from);
    session.state = 'awaiting_service';
    return [
      '¡Genial! Estos son nuestros servicios:\n' +
        negocio.servicios.map((s) => `- ${s.nombre} (${s.precio}€)`).join('\n') +
        '\n\nEscribe el servicio que quieres reservar, o escribe "cancelar cita" si ' +
        'quieres cancelar una cita que ya tengas.',
    ];
  }
  return [faq.menuText(negocio)];
}

function handleAwaitingService(negocio, from, text, session) {
  const normalized = normalize(text);
  if (isCancelIntent(normalized)) {
    return startCancelFlow(negocio, from, session);
  }

  const service = faq.findService(negocio, text);
  if (!service) {
    return [
      'No he reconocido ese servicio. Escribe: corte, barba o corte + barba ' +
        '(o "cancelar" para salir).',
    ];
  }

  session.service = service;
  session.state = 'awaiting_date';
  return [
    `Perfecto, ${service.nombre} (${service.precio}€). ` +
      '¿Qué día quieres venir? Indica la fecha como DD/MM (Lunes a Viernes).',
  ];
}

async function handleAwaitingDate(negocio, from, text, session) {
  const day = parseDate(negocio, text);
  if (!day) {
    return ['No he entendido la fecha. Usa el formato DD/MM, por ejemplo 15/09.'];
  }

  const now = DateTime.now().setZone(negocio.timezone).startOf('day');
  if (day < now) {
    return ['Esa fecha ya ha pasado. Indica un día a partir de hoy.'];
  }

  const diasLaborables = negocio.horario.diasLaborables || [1, 2, 3, 4, 5];
  if (!diasLaborables.includes(day.weekday)) {
    return ['Ese día no abrimos. Elige otro día, por favor.'];
  }

  let slots;
  try {
    slots = await googleCalendar.getAvailableSlots(negocio, day, session.service.duracionMinutos);
  } catch (err) {
    console.error('Error consultando Google Calendar:', err);
    return ['Ha ocurrido un error consultando el calendario. Inténtalo de nuevo en un momento.'];
  }

  if (slots.length === 0) {
    return ['No quedan huecos libres ese día. Prueba con otra fecha (DD/MM).'];
  }

  session.date = day;
  session.slots = slots;
  session.state = 'awaiting_slot';
  return [
    `Huecos disponibles el ${day.toFormat('dd/MM')} para ${session.service.nombre}:\n` +
      formatSlotsList(slots) +
      '\n\nResponde con el número o la hora del hueco que prefieras.',
  ];
}

function handleAwaitingSlot(negocio, from, text, session) {
  const slot = findChosenSlot(text, session.slots || []);
  if (!slot) {
    return [
      'No he reconocido ese hueco. Responde con el número de la lista o la hora, ' +
        'por ejemplo "10:00".',
    ];
  }

  session.chosenSlot = slot;
  session.state = 'awaiting_confirmation';
  return [
    `Confirmas la cita para ${session.service.nombre} (${session.service.precio}€) ` +
      `el ${slot.toFormat('dd/MM')} a las ${slot.toFormat('HH:mm')}? Responde sí o no.`,
  ];
}

async function handleAwaitingConfirmation(negocio, from, text, session) {
  if (isAffirmative(text)) {
    const start = session.chosenSlot;
    const end = start.plus({ minutes: session.service.duracionMinutos });

    try {
      await googleCalendar.createEvent(negocio, {
        summary: `${session.service.nombre} - Cliente ${from}`,
        description: `Cita reservada por WhatsApp. Servicio: ${session.service.nombre}. Cliente: ${from}.`,
        start,
        end,
      });
    } catch (err) {
      console.error('Error creando el evento en Google Calendar:', err);
      return ['No he podido guardar la cita en el calendario. Inténtalo de nuevo más tarde.'];
    }

    const confirmationMessage =
      `Tu cita ha quedado confirmada ✅\n` +
      `Servicio: ${session.service.nombre}\n` +
      `Fecha: ${start.toFormat('dd/MM/yyyy')}\n` +
      `Hora: ${start.toFormat('HH:mm')}\n` +
      `Precio: ${session.service.precio}€\n\n` +
      '¡Te esperamos!';

    resetSession(negocio, from);
    return [confirmationMessage];
  }

  if (isNegative(text)) {
    resetSession(negocio, from);
    return ['De acuerdo, he cancelado la reserva. Escribe "reservar" si quieres empezar de nuevo.'];
  }

  return ['Responde "sí" para confirmar la cita o "no" para cancelarla.'];
}

function eventLabel(event) {
  const serviceName = (event.summary || 'Cita').split(' - Cliente')[0];
  return `${serviceName} el ${event.start.toFormat('dd/MM')} a las ${event.start.toFormat('HH:mm')}`;
}

/**
 * Busca las citas futuras del cliente y arranca el flujo de cancelacion:
 * pide confirmacion directa si hay una sola, o que elija de una lista si
 * hay varias.
 */
async function startCancelFlow(negocio, from, session) {
  let events;
  try {
    events = await googleCalendar.findUpcomingEvents(negocio, from);
  } catch (err) {
    console.error('Error consultando citas para cancelar:', err);
    return ['Ha ocurrido un error consultando tus citas. Inténtalo de nuevo en un momento.'];
  }

  if (events.length === 0) {
    resetSession(negocio, from);
    return [
      'No hemos encontrado ninguna cita reservada a tu nombre. ' +
        'Escribe "reservar" si quieres pedir una cita.',
    ];
  }

  if (events.length === 1) {
    session.cancelTarget = events[0];
    session.state = 'awaiting_cancel_confirmation';
    return [`¿Confirmas que quieres cancelar tu cita de ${eventLabel(events[0])}? Responde sí o no.`];
  }

  session.cancelCandidates = events;
  session.state = 'awaiting_cancel_choice';
  return [
    'Tienes varias citas próximas:\n' +
      events.map((e, i) => `${i + 1}. ${eventLabel(e)}`).join('\n') +
      '\n\nResponde con el número de la cita que quieres cancelar (o "cancelar" para salir).',
  ];
}

function handleAwaitingCancelChoice(negocio, from, text, session) {
  const index = parseInt(text.trim(), 10);
  const chosen = session.cancelCandidates?.[index - 1];
  if (!chosen) {
    return ['No he reconocido esa cita. Responde con el número de la lista, o "cancelar" para salir.'];
  }

  session.cancelTarget = chosen;
  session.state = 'awaiting_cancel_confirmation';
  return [`¿Confirmas que quieres cancelar tu cita de ${eventLabel(chosen)}? Responde sí o no.`];
}

async function handleAwaitingCancelConfirmation(negocio, from, text, session) {
  if (isAffirmative(text)) {
    try {
      await googleCalendar.cancelEvent(negocio, session.cancelTarget.id);
    } catch (err) {
      console.error('Error cancelando la cita en Google Calendar:', err);
      return ['No he podido cancelar la cita. Inténtalo de nuevo más tarde.'];
    }

    const label = eventLabel(session.cancelTarget);
    resetSession(negocio, from);
    return [`Tu cita de ${label} ha sido cancelada. ¡Esperamos verte pronto!`];
  }

  if (isNegative(text)) {
    resetSession(negocio, from);
    return ['De acuerdo, no se ha cancelado nada.'];
  }

  return ['Responde "sí" para cancelar la cita o "no" para dejarla como está.'];
}

module.exports = { handleIncomingMessage };
