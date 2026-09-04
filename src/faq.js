const MAX_LIST_ROWS = 10;
const ROW_TITLE_MAX = 24;
const ROW_DESC_MAX = 72;
const BUTTON_TITLE_MAX = 20;

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function truncate(str, max) {
  if (!str) return str;
  return str.length > max ? str.slice(0, max - 1).trimEnd() + '…' : str;
}

function findService(negocio, text) {
  const normalized = normalize(text);

  const hasCorte = /corte|pelo/.test(normalized);
  const hasBarba = /barba/.test(normalized);

  const byKey = (key) => negocio.servicios.find((s) => s.key === key);

  if (hasCorte && hasBarba) return byKey('corte_barba') || null;
  if (hasBarba) return byKey('barba') || null;
  if (hasCorte) return byKey('corte') || null;
  return null;
}

function findServiceByKey(negocio, key) {
  return negocio.servicios.find((s) => s.key === key) || null;
}

function eventServiceName(event) {
  return (event.summary || 'Cita').split(' - Cliente')[0];
}

function horariosYPreciosTexto(negocio) {
  const { horaInicio, horaFin } = negocio.horario;
  const servicios = negocio.servicios.map((s) => `• ${s.nombre}: ${s.precio}€`).join('\n');
  return (
    `🕒 Nuestro horario: Lunes a Viernes de ${horaInicio}:00 a ${horaFin}:00\n\n` +
    `✂️ Nuestros servicios:\n${servicios}`
  );
}

function welcomeMessage(negocio) {
  return {
    kind: 'list',
    body:
      `¡Hola! 👋 Bienvenido/a a ${negocio.nombre} 💈\n` +
      'Soy el asistente virtual y estoy aquí para ayudarte. ¿Qué te gustaría hacer?',
    buttonText: 'Ver opciones',
    sections: [
      {
        title: 'Menú principal',
        rows: [
          { id: 'menu_horarios', title: truncate('📋 Horarios y precios', ROW_TITLE_MAX) },
          { id: 'menu_reservar', title: truncate('📅 Reservar una cita', ROW_TITLE_MAX) },
          { id: 'menu_cancelar', title: truncate('❌ Cancelar una cita', ROW_TITLE_MAX) },
        ],
      },
    ],
  };
}

function fallbackMessage(negocio) {
  return {
    ...welcomeMessage(negocio),
    body: 'Uy, no te he entendido bien 😅 Elige una opción:',
  };
}

function horariosPreciosMessage(negocio) {
  return {
    kind: 'buttons',
    body: horariosYPreciosTexto(negocio),
    buttons: [
      { id: 'action_reservar', title: truncate('📅 Reservar cita', BUTTON_TITLE_MAX) },
      { id: 'action_menu', title: truncate('🏠 Menú principal', BUTTON_TITLE_MAX) },
    ],
  };
}

function serviceListMessage(negocio) {
  return {
    kind: 'list',
    body: '¡Genial! 🙌 Vamos a reservarte una cita. ¿Qué servicio quieres?',
    buttonText: 'Ver servicios',
    sections: [
      {
        title: 'Servicios',
        rows: negocio.servicios.slice(0, MAX_LIST_ROWS).map((s) => ({
          id: `service_${s.key}`,
          title: truncate(s.nombre, ROW_TITLE_MAX),
          description: truncate(`${s.precio}€ · ${s.duracionMinutos} min`, ROW_DESC_MAX),
        })),
      },
    ],
  };
}

function askDateMessage() {
  return {
    kind: 'text',
    text: "Perfecto ✂️ ¿Qué día te viene bien? Por ejemplo: 'mañana', 'el viernes', o una fecha como '10/09'",
  };
}

function slotsListMessage(dateLabel, slots) {
  const shown = slots.slice(0, MAX_LIST_ROWS);
  const note = slots.length > MAX_LIST_ROWS ? '\n(mostrando los primeros 10 huecos)' : '';
  return {
    kind: 'list',
    body: `Estos son los huecos libres para el ${dateLabel} ⏰${note}`,
    buttonText: 'Ver horarios',
    sections: [
      {
        title: 'Horarios libres',
        rows: shown.map((slot, i) => ({
          id: `slot_${i}`,
          title: slot.toFormat('HH:mm'),
        })),
      },
    ],
  };
}

function confirmBookingMessage(session) {
  const { service, chosenSlot } = session;
  return {
    kind: 'buttons',
    body:
      'Vale, resumen de tu cita 📋\n' +
      `✂️ Servicio: ${service.nombre}\n` +
      `📅 Día: ${chosenSlot.toFormat('dd/MM/yyyy')}\n` +
      `⏰ Hora: ${chosenSlot.toFormat('HH:mm')}\n` +
      `💶 Precio: ${service.precio}€\n\n` +
      '¿Confirmas la reserva?',
    buttons: [
      { id: 'confirm_yes', title: truncate('✅ Sí, confirmar', BUTTON_TITLE_MAX) },
      { id: 'confirm_no', title: truncate('❌ No, cancelar', BUTTON_TITLE_MAX) },
    ],
  };
}

function bookingConfirmedMessage(negocio, { service, start }) {
  return {
    kind: 'buttons',
    body:
      '¡Todo listo! ✅ Tu cita está confirmada:\n' +
      `✂️ ${service.nombre} — 📅 ${start.toFormat('dd/MM/yyyy')} a las ⏰ ${start.toFormat('HH:mm')}\n\n` +
      `Te esperamos en ${negocio.nombre} 💈 ¡Gracias por confiar en nosotros!`,
    buttons: [
      { id: 'action_cancelar_cita', title: truncate('❌ Cancelar cita', BUTTON_TITLE_MAX) },
      { id: 'action_menu', title: truncate('🏠 Menú principal', BUTTON_TITLE_MAX) },
    ],
  };
}

function appointmentsListMessage(events) {
  const shown = events.slice(0, MAX_LIST_ROWS);
  const note = events.length > MAX_LIST_ROWS ? '\n(mostrando las próximas 10)' : '';
  return {
    kind: 'list',
    body: `Estas son tus citas próximas 📋${note}`,
    buttonText: 'Ver mis citas',
    sections: [
      {
        title: 'Tus citas',
        rows: shown.map((ev, i) => ({
          id: `cancel_${i}`,
          title: truncate(eventServiceName(ev), ROW_TITLE_MAX),
          description: truncate(
            `${ev.start.toFormat('dd/MM/yyyy')} · ${ev.start.toFormat('HH:mm')}`,
            ROW_DESC_MAX
          ),
        })),
      },
    ],
  };
}

function cancelConfirmMessage(event) {
  return {
    kind: 'buttons',
    body:
      '¿Seguro que quieres cancelar esta cita? 🥺\n' +
      `✂️ ${eventServiceName(event)} — ${event.start.toFormat('dd/MM/yyyy')} a las ${event.start.toFormat(
        'HH:mm'
      )}`,
    buttons: [
      { id: 'cancel_confirm_yes', title: truncate('✅ Sí, cancelar', BUTTON_TITLE_MAX) },
      { id: 'cancel_confirm_no', title: truncate('❌ No, mantener', BUTTON_TITLE_MAX) },
    ],
  };
}

function cancelConfirmedMessage(negocio) {
  return {
    kind: 'buttons',
    body: `Cita cancelada ❌ Esperamos verte pronto por ${negocio.nombre} 💈`,
    buttons: [
      { id: 'action_reservar_otra', title: truncate('📅 Reservar otra', BUTTON_TITLE_MAX) },
      { id: 'action_menu', title: truncate('🏠 Menú principal', BUTTON_TITLE_MAX) },
    ],
  };
}

function noAppointmentsMessage() {
  return {
    kind: 'buttons',
    body: 'No encuentro ninguna cita a tu nombre 🤔',
    buttons: [
      { id: 'action_reservar', title: truncate('📅 Reservar cita', BUTTON_TITLE_MAX) },
      { id: 'action_menu', title: truncate('🏠 Menú principal', BUTTON_TITLE_MAX) },
    ],
  };
}

module.exports = {
  normalize,
  findService,
  findServiceByKey,
  eventServiceName,
  welcomeMessage,
  fallbackMessage,
  horariosPreciosMessage,
  serviceListMessage,
  askDateMessage,
  slotsListMessage,
  confirmBookingMessage,
  bookingConfirmedMessage,
  appointmentsListMessage,
  cancelConfirmMessage,
  cancelConfirmedMessage,
  noAppointmentsMessage,
};
