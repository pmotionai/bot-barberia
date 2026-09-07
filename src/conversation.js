const { DateTime } = require('luxon');
const faq = require('./faq');
const i18n = require('./i18n');
const googleCalendar = require('./googleCalendar');

// Estado de la conversacion por negocio + numero de telefono. En memoria: se
// pierde al reiniciar el proceso, suficiente para este bot de un solo
// servidor. El idioma elegido (session.lang) sobrevive a resetSession, para
// no tener que volver a preguntarlo tras cada reserva/cancelacion.
const sessions = new Map();

function sessionKey(negocio, from) {
  return `${negocio.id}:${from}`;
}

function getSession(negocio, from) {
  const key = sessionKey(negocio, from);
  if (!sessions.has(key)) {
    sessions.set(key, { state: 'idle', lang: i18n.DEFAULT_LANGUAGE });
  }
  return sessions.get(key);
}

function resetSession(negocio, from) {
  const key = sessionKey(negocio, from);
  const prev = sessions.get(key);
  sessions.set(key, { state: 'idle', lang: prev?.lang || i18n.DEFAULT_LANGUAGE });
}

function normalize(text) {
  return faq.normalize(text);
}

function isAffirmative(text) {
  return /^(si|si\.|s|vale|confirmo|ok|de acuerdo|d'acord|yes|y)$/.test(normalize(text));
}

function isNegative(text) {
  return /^(no|no\.|n|cancelar|cancela|cancel·lar)$/.test(normalize(text));
}

function isCancelIntent(normalized) {
  return /cancel|anular|anul·lar/.test(normalized);
}

/**
 * Intenta interpretar una fecha en lenguaje natural sencillo en el idioma
 * activo de la sesion: "hoy/avui/today", "mañana/dema/tomorrow", un dia de
 * la semana, o una fecha DD/MM(/YYYY) (siempre valida, sea cual sea el
 * idioma). Devuelve un DateTime (inicio del dia, zona del negocio) o null
 * si no se ha entendido.
 */
function parseDate(negocio, text, lang) {
  const normalized = normalize(text.trim());
  const now = DateTime.now().setZone(negocio.timezone).startOf('day');
  const s = i18n.t(lang);

  if (normalized === s.todayWord) return now;
  if (normalized === s.tomorrowWord) return now.plus({ days: 1 });

  const weekdayIdx = s.weekdayWords.findIndex((w) => normalized.includes(w));
  if (weekdayIdx !== -1) {
    const targetIdx = weekdayIdx + 1; // 1..7 (lunes/dilluns/monday = 1)
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

const LANGUAGE_IDS = { lang_es: 'es', lang_ca: 'ca', lang_en: 'en' };

/**
 * Devuelve el mensaje correspondiente al paso actual de la conversacion,
 * sin necesitar un input nuevo del cliente. Se usa para volver a mostrar
 * "donde estabas" justo despues de cambiar de idioma a mitad de un flujo.
 */
function repromptForState(negocio, session) {
  const lang = session.lang;
  switch (session.state) {
    case 'awaiting_service':
      return [faq.serviceListMessage(negocio, lang)];
    case 'awaiting_date':
      return [faq.askDateMessage(lang)];
    case 'awaiting_slot':
      return [faq.slotsListMessage(session.date.toFormat('dd/MM'), session.slots || [], lang)];
    case 'awaiting_confirmation':
      return [faq.confirmBookingMessage(negocio, session, lang)];
    case 'awaiting_cancel_choice':
      return [faq.appointmentsListMessage(session.cancelCandidates || [], lang)];
    case 'awaiting_cancel_confirmation':
      return [faq.cancelConfirmMessage(negocio, session.cancelTarget, lang)];
    case 'idle':
    default:
      return [faq.welcomeMessage(negocio, lang)];
  }
}

/**
 * Procesa un mensaje entrante de un negocio concreto y devuelve la lista de
 * mensajes (texto, lista o botones) a enviar de vuelta al cliente. Puede
 * tener efectos secundarios (crear/cancelar una cita en Google Calendar).
 */
async function handleIncomingMessage(negocio, from, message) {
  const input = extractInput(message);
  const session = getSession(negocio, from);

  // El selector de idioma funciona en cualquier punto de la conversacion,
  // sin perder el paso en el que estuviera el cliente.
  if ((input.kind === 'button' || input.kind === 'list') && input.id === 'menu_idioma') {
    return [faq.languagePickerMessage()];
  }
  if (input.kind === 'button' && LANGUAGE_IDS[input.id]) {
    session.lang = LANGUAGE_IDS[input.id];
    return [faq.languageSavedMessage(session.lang), ...repromptForState(negocio, session)];
  }
  if (input.kind === 'text' && /^(idioma|llengua|language)$/.test(normalize(input.text))) {
    return [faq.languagePickerMessage()];
  }

  // Atajos de navegacion (menu, reservar, cancelar...): funcionan sin
  // importar en que paso este el cliente, por si toca un boton de un
  // mensaje anterior en vez de responder al paso actual.
  if (input.kind === 'list' || input.kind === 'button') {
    switch (input.id) {
      case 'menu_horarios':
        return [faq.horariosPreciosMessage(negocio, session.lang)];
      case 'menu_reservar':
      case 'action_reservar':
      case 'action_reservar_otra':
        return startReservationFlow(negocio, session);
      case 'menu_cancelar':
      case 'action_cancelar_cita':
        return startCancelFlow(negocio, from, session);
      case 'action_menu':
        resetSession(negocio, from);
        return [faq.welcomeMessage(negocio, session.lang)];
      default:
        break;
    }
  }

  if (session.state !== 'idle' && input.kind === 'text' && normalize(input.text) === 'cancelar') {
    resetSession(negocio, from);
    return [
      { kind: 'text', text: i18n.t(session.lang).operationCancelledText },
      faq.welcomeMessage(negocio, session.lang),
    ];
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
      return [faq.welcomeMessage(negocio, session.lang)];
  }
}

async function handleIdle(negocio, from, input, session) {
  const lang = session.lang;
  const isFirstContact = !session.seen;
  session.seen = true;

  // Los ids de lista/boton (menu_*, action_*) ya se gestionan de forma
  // global en handleIncomingMessage antes de llegar aqui; si llegamos a
  // este punto con uno de ellos es que no coincidio ninguno, asi que
  // seguimos con la interpretacion de texto libre.
  const normalized = input.kind === 'text' ? normalize(input.text) : '';
  if (isCancelIntent(normalized)) return startCancelFlow(negocio, from, session);
  if (/horari|horario|precio|preu/.test(normalized)) return [faq.horariosPreciosMessage(negocio, lang)];
  if (/reserv|cita|agendar|book/.test(normalized)) return startReservationFlow(negocio, session);
  if (/^(menu|hola|inicio|buenas|empezar|hola|hello|hi|bon dia)\b/.test(normalized)) {
    return [faq.welcomeMessage(negocio, lang)];
  }

  return [isFirstContact ? faq.welcomeMessage(negocio, lang) : faq.fallbackMessage(negocio, lang)];
}

function startReservationFlow(negocio, session) {
  session.state = 'awaiting_service';
  return [faq.serviceListMessage(negocio, session.lang)];
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

  return [faq.serviceListMessage(negocio, session.lang)];
}

function proceedToDate(service, session) {
  session.service = service;
  session.state = 'awaiting_date';
  return [faq.askDateMessage(session.lang)];
}

async function handleAwaitingDate(negocio, from, input, session) {
  const lang = session.lang;
  const s = i18n.t(lang);

  if (input.kind !== 'text') {
    return [faq.askDateMessage(lang)];
  }

  const day = parseDate(negocio, input.text, lang);
  if (!day) {
    return [{ kind: 'text', text: s.dateNotUnderstoodText }];
  }

  const now = DateTime.now().setZone(negocio.timezone).startOf('day');
  if (day < now) {
    return [{ kind: 'text', text: s.datePastText }];
  }

  const openDays = negocio.horario.horarioPorDia
    ? Object.keys(negocio.horario.horarioPorDia).map(Number)
    : negocio.horario.diasLaborables || [1, 2, 3, 4, 5];
  if (!openDays.includes(day.weekday)) {
    return [{ kind: 'text', text: s.dayClosedText }];
  }

  const dayHours = googleCalendar.getDayHours(negocio, day);
  const windowMinutes =
    dayHours.horaFin * 60 + (dayHours.horaFinMinuto || 0) - (dayHours.horaInicio * 60 + (dayHours.horaInicioMinuto || 0));
  if (session.service.duracionMinutos > windowMinutes) {
    return [{ kind: 'text', text: s.serviceTooLongText(session.service, dayHours) }];
  }

  let slots;
  try {
    slots = await googleCalendar.getAvailableSlots(negocio, day, session.service.duracionMinutos);
  } catch (err) {
    console.error('Error consultando Google Calendar:', err);
    return [{ kind: 'text', text: s.calendarErrorText }];
  }

  if (slots.length === 0) {
    return [{ kind: 'text', text: s.noSlotsText }];
  }

  session.date = day;
  session.slots = slots;
  session.state = 'awaiting_slot';
  return [faq.slotsListMessage(day.toFormat('dd/MM'), slots, lang)];
}

async function handleAwaitingSlot(negocio, from, input, session) {
  let slot = null;

  if (input.kind === 'list' && input.id.startsWith('slot_')) {
    const idx = parseInt(input.id.slice('slot_'.length), 10);
    slot = session.slots?.[idx] || null;
  } else if (input.kind === 'text') {
    slot = findChosenSlotByText(input.text, session.slots || []);

    // El cliente puede estar rectificando el dia ("mejor mañana") en vez
    // de elegir un hueco de la lista actual. Si el texto no es un hueco
    // pero SI se interpreta como una fecha valida, lo tratamos como si
    // hubiera vuelto al paso de elegir dia con esa fecha nueva.
    if (!slot) {
      const maybeNewDay = parseDate(negocio, input.text, session.lang);
      if (maybeNewDay) {
        session.state = 'awaiting_date';
        return handleAwaitingDate(negocio, from, input, session);
      }
    }
  }

  if (!slot) {
    return [faq.slotsListMessage(session.date.toFormat('dd/MM'), session.slots || [], session.lang)];
  }

  session.chosenSlot = slot;
  session.state = 'awaiting_confirmation';
  return [faq.confirmBookingMessage(negocio, session, session.lang)];
}

async function handleAwaitingConfirmation(negocio, from, input, session) {
  const lang = session.lang;
  const s = i18n.t(lang);
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
      return [{ kind: 'text', text: s.bookingSaveErrorText }];
    }

    const message = faq.bookingConfirmedMessage(negocio, { service: session.service, start }, lang);
    resetSession(negocio, from);
    return [message];
  }

  if (negative) {
    resetSession(negocio, from);
    return [{ kind: 'text', text: s.bookingAbortedText }, faq.welcomeMessage(negocio, lang)];
  }

  return [faq.confirmBookingMessage(negocio, session, lang)];
}

async function startCancelFlow(negocio, from, session) {
  const lang = session.lang;
  const s = i18n.t(lang);

  let events;
  try {
    events = await googleCalendar.findUpcomingEvents(negocio, from);
  } catch (err) {
    console.error('Error consultando citas para cancelar:', err);
    return [{ kind: 'text', text: s.fetchAppointmentsErrorText }];
  }

  if (events.length === 0) {
    resetSession(negocio, from);
    return [faq.noAppointmentsMessage(lang)];
  }

  session.cancelCandidates = events;
  session.state = 'awaiting_cancel_choice';
  return [faq.appointmentsListMessage(events, lang)];
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
    return [faq.appointmentsListMessage(session.cancelCandidates || [], session.lang)];
  }

  session.cancelTarget = chosen;
  session.state = 'awaiting_cancel_confirmation';
  return [faq.cancelConfirmMessage(negocio, chosen, session.lang)];
}

async function handleAwaitingCancelConfirmation(negocio, from, input, session) {
  const lang = session.lang;
  const s = i18n.t(lang);
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
      return [{ kind: 'text', text: s.cancelSaveErrorText }];
    }

    resetSession(negocio, from);
    return [faq.cancelConfirmedMessage(negocio, lang)];
  }

  if (negative) {
    resetSession(negocio, from);
    return [{ kind: 'text', text: s.cancelAbortedText }, faq.welcomeMessage(negocio, lang)];
  }

  return [faq.cancelConfirmMessage(negocio, session.cancelTarget, lang)];
}

module.exports = { handleIncomingMessage };
