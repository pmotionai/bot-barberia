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
  return faq.normalize(text);
}

function isAffirmative(text) {
  return /^(si|si\.|s|vale|confirmo|ok|de acuerdo)$/.test(normalize(text));
}

function isNegative(text) {
  return /^(no|no\.|n|cancelar|cancela)$/.test(normalize(text));
}

function isCancelIntent(normalized) {
  return /cancelar|anular/.test(normalized);
}

const WEEKDAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

/**
 * Intenta interpretar una fecha en lenguaje natural sencillo: "hoy",
 * "mañana", un dia de la semana ("el viernes"), o una fecha DD/MM(/YYYY).
 * Devuelve un DateTime (inicio del dia, zona del negocio) o null si no se
 * ha entendido.
 */
function parseDate(negocio, text) {
  const normalized = normalize(text.trim());
  const now = DateTime.now().setZone(negocio.timezone).startOf('day');

  if (/^hoy$/.test(normalized)) return now;
  if (/^manana$/.test(normalized)) return now.plus({ days: 1 });

  const weekdayMatch = normalized.match(/(lunes|martes|miercoles|jueves|viernes|sabado|domingo)/);
  if (weekdayMatch) {
    const targetIdx = WEEKDAYS.indexOf(weekdayMatch[1]) + 1; // 1..7
    let diff = targetIdx - now.weekday;
    if (diff <= 0) diff += 7;
    return now.plus({ days: diff });
  }

  const match = text.trim().match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (match) {
    const [, dayStr, monthStr, yearStr] = match;
    let year = yearStr ? parseInt(yearStr, 10) : now.year;
    if (year < 100) year += 2000;

    const day = DateTime.fromObject(
      { year, month: parseInt(monthStr, 10), day: parseInt(dayStr, 10) },
      { zone: negocio.timezone }
    );
    if (day.isValid) return day;
  }

  return null;
}

function findChosenSlotByText(text, slots) {
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
 * Normaliza un mensaje entrante de WhatsApp (texto o respuesta interactiva
 * de boton/lista) a una forma comun con la que trabaja el resto del modulo.
 */
function extractInput(message) {
  if (message.type === 'text') {
    return { kind: 'text', text: message.text?.body || '' };
  }
  if (message.type === 'interactive') {
    const interactive = message.interactive || {};
    if (interactive.type === 'button_reply') {
      return {
        kind: 'button',
        id: interactive.button_reply?.id || '',
        title: interactive.button_reply?.title || '',
      };
    }
    if (interactive.type === 'list_reply') {
      return {
        kind: 'list',
        id: interactive.list_reply?.id || '',
        title: interactive.list_reply?.title || '',
      };
    }
  }
  return { kind: 'unknown' };
}

/**
 * Procesa un mensaje entrante de un negocio concreto y devuelve la lista de
 * mensajes (texto, lista o botones) a enviar de vuelta al cliente. Puede
 * tener efectos secundarios (crear/cancelar una cita en Google Calendar).
 */
async function handleIncomingMessage(negocio, from, message) {
  const input = extractInput(message);
  const session = getSession(negocio, from);

  if (session.state !== 'idle' && input.kind === 'text' && normalize(input.text) === 'cancelar') {
    resetSession(negocio, from);
    return [{ kind: 'text', text: 'Operación cancelada.' }, faq.welcomeMessage(negocio)];
  }

  switch (session.state) {
    case 'idle':
      return handleIdle(negocio, from, input, session);
    case 'awaiting_service':
      return handleAwaitingService(negocio, from, input, session);
    case 'awaiting_date':
      return handleAwaitingDate(negocio, from, input, session);
    case 'awaiting_slot':
      return handleAwaitingSlot(negocio, from, input, session);
    case 'awaiting_confirmation':
      return handleAwaitingConfirmation(negocio, from, input, session);
    case 'awaiting_cancel_choice':
      return handleAwaitingCancelChoice(negocio, from, input, session);
    case 'awaiting_cancel_confirmation':
      return handleAwaitingCancelConfirmation(negocio, from, input, session);
    default:
      resetSession(negocio, from);
      return [faq.welcomeMessage(negocio)];
  }
}

async function handleIdle(negocio, from, input, session) {
  const isFirstContact = !session.seen;
  session.seen = true;

  if (input.kind === 'list' || input.kind === 'button') {
    switch (input.id) {
      case 'menu_horarios':
        return [faq.horariosPreciosMessage(negocio)];
      case 'menu_reservar':
      case 'action_reservar':
      case 'action_reservar_otra':
        return startReservationFlow(negocio, session);
      case 'menu_cancelar':
      case 'action_cancelar_cita':
        return startCancelFlow(negocio, from, session);
      case 'action_menu':
        return [faq.welcomeMessage(negocio)];
      default:
        break;
    }
  }

  const normalized = input.kind === 'text' ? normalize(input.text) : '';
  if (isCancelIntent(normalized)) return startCancelFlow(negocio, from, session);
  if (/horario|precio/.test(normalized)) return [faq.horariosPreciosMessage(negocio)];
  if (/reserv|cita|agendar/.test(normalized)) return startReservationFlow(negocio, session);
  if (/^(menu|hola|inicio|buenas|empezar)\b/.test(normalized)) return [faq.welcomeMessage(negocio)];

  return [isFirstContact ? faq.welcomeMessage(negocio) : faq.fallbackMessage(negocio)];
}

function startReservationFlow(negocio, session) {
  session.state = 'awaiting_service';
  return [faq.serviceListMessage(negocio)];
}

function handleAwaitingService(negocio, from, input, session) {
  if (input.kind === 'list' && input.id.startsWith('service_')) {
    const key = input.id.slice('service_'.length);
    const service = faq.findServiceByKey(negocio, key);
    if (service) return proceedToDate(service, session);
  }

  if (input.kind === 'text') {
    const normalized = normalize(input.text);
    if (isCancelIntent(normalized)) return startCancelFlow(negocio, from, session);

    const service = faq.findService(negocio, input.text);
    if (service) return proceedToDate(service, session);
  }

  return [faq.serviceListMessage(negocio)];
}

function proceedToDate(service, session) {
  session.service = service;
  session.state = 'awaiting_date';
  return [faq.askDateMessage()];
}

async function handleAwaitingDate(negocio, from, input, session) {
  if (input.kind !== 'text') {
    return [faq.askDateMessage()];
  }

  const day = parseDate(negocio, input.text);
  if (!day) {
    return [
      {
        kind: 'text',
        text: 'No he entendido esa fecha. Prueba con "mañana", "el viernes" o una fecha como "10/09".',
      },
    ];
  }

  const now = DateTime.now().setZone(negocio.timezone).startOf('day');
  if (day < now) {
    return [{ kind: 'text', text: 'Esa fecha ya ha pasado. Indica un día a partir de hoy.' }];
  }

  const diasLaborables = negocio.horario.diasLaborables || [1, 2, 3, 4, 5];
  if (!diasLaborables.includes(day.weekday)) {
    return [{ kind: 'text', text: 'Ese día no abrimos. Elige otro día, por favor.' }];
  }

  let slots;
  try {
    slots = await googleCalendar.getAvailableSlots(negocio, day, session.service.duracionMinutos);
  } catch (err) {
    console.error('Error consultando Google Calendar:', err);
    return [
      { kind: 'text', text: 'Ha ocurrido un error consultando el calendario. Inténtalo de nuevo en un momento.' },
    ];
  }

  if (slots.length === 0) {
    return [{ kind: 'text', text: 'No quedan huecos libres ese día. Prueba con otra fecha.' }];
  }

  session.date = day;
  session.slots = slots;
  session.state = 'awaiting_slot';
  return [faq.slotsListMessage(day.toFormat('dd/MM'), slots)];
}

function handleAwaitingSlot(negocio, from, input, session) {
  let slot = null;

  if (input.kind === 'list' && input.id.startsWith('slot_')) {
    const idx = parseInt(input.id.slice('slot_'.length), 10);
    slot = session.slots?.[idx] || null;
  } else if (input.kind === 'text') {
    slot = findChosenSlotByText(input.text, session.slots || []);
  }

  if (!slot) {
    return [faq.slotsListMessage(session.date.toFormat('dd/MM'), session.slots || [])];
  }

  session.chosenSlot = slot;
  session.state = 'awaiting_confirmation';
  return [faq.confirmBookingMessage(session)];
}

async function handleAwaitingConfirmation(negocio, from, input, session) {
  const affirmative =
    (input.kind === 'button' && input.id === 'confirm_yes') ||
    (input.kind === 'text' && isAffirmative(input.text));
  const negative =
    (input.kind === 'button' && input.id === 'confirm_no') ||
    (input.kind === 'text' && isNegative(input.text));

  if (affirmative) {
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
      return [{ kind: 'text', text: 'No he podido guardar la cita en el calendario. Inténtalo de nuevo más tarde.' }];
    }

    const message = faq.bookingConfirmedMessage(negocio, { service: session.service, start });
    resetSession(negocio, from);
    return [message];
  }

  if (negative) {
    resetSession(negocio, from);
    return [{ kind: 'text', text: 'De acuerdo, no se ha realizado la reserva.' }, faq.welcomeMessage(negocio)];
  }

  return [faq.confirmBookingMessage(session)];
}

async function startCancelFlow(negocio, from, session) {
  let events;
  try {
    events = await googleCalendar.findUpcomingEvents(negocio, from);
  } catch (err) {
    console.error('Error consultando citas para cancelar:', err);
    return [{ kind: 'text', text: 'Ha ocurrido un error consultando tus citas. Inténtalo de nuevo en un momento.' }];
  }

  if (events.length === 0) {
    resetSession(negocio, from);
    return [faq.noAppointmentsMessage()];
  }

  session.cancelCandidates = events;
  session.state = 'awaiting_cancel_choice';
  return [faq.appointmentsListMessage(events)];
}

function handleAwaitingCancelChoice(negocio, from, input, session) {
  let chosen = null;

  if (input.kind === 'list' && input.id.startsWith('cancel_')) {
    const idx = parseInt(input.id.slice('cancel_'.length), 10);
    chosen = session.cancelCandidates?.[idx] || null;
  } else if (input.kind === 'text') {
    const idx = parseInt(input.text.trim(), 10);
    chosen = session.cancelCandidates?.[idx - 1] || null;
  }

  if (!chosen) {
    return [faq.appointmentsListMessage(session.cancelCandidates || [])];
  }

  session.cancelTarget = chosen;
  session.state = 'awaiting_cancel_confirmation';
  return [faq.cancelConfirmMessage(chosen)];
}

async function handleAwaitingCancelConfirmation(negocio, from, input, session) {
  const affirmative =
    (input.kind === 'button' && input.id === 'cancel_confirm_yes') ||
    (input.kind === 'text' && isAffirmative(input.text));
  const negative =
    (input.kind === 'button' && input.id === 'cancel_confirm_no') ||
    (input.kind === 'text' && isNegative(input.text));

  if (affirmative) {
    try {
      await googleCalendar.cancelEvent(negocio, session.cancelTarget.id);
    } catch (err) {
      console.error('Error cancelando la cita en Google Calendar:', err);
      return [{ kind: 'text', text: 'No he podido cancelar la cita. Inténtalo de nuevo más tarde.' }];
    }

    resetSession(negocio, from);
    return [faq.cancelConfirmedMessage(negocio)];
  }

  if (negative) {
    resetSession(negocio, from);
    return [{ kind: 'text', text: 'De acuerdo, no se ha cancelado nada.' }, faq.welcomeMessage(negocio)];
  }

  return [faq.cancelConfirmMessage(session.cancelTarget)];
}

module.exports = { handleIncomingMessage };
