const i18n = require('./i18n');

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

  // Atajo especifico para barberias con corte/barba combinados: si el
  // negocio tiene esas claves, un "corte y barba" debe priorizar el combo
  // sobre el servicio individual.
  const hasCorte = /corte|pelo/.test(normalized);
  const hasBarba = /barba/.test(normalized);
  const byKey = (key) => negocio.servicios.find((s) => s.key === key);
  if (hasCorte && hasBarba && byKey('corte_barba')) return byKey('corte_barba');
  if (hasBarba && byKey('barba')) return byKey('barba');
  if (hasCorte && byKey('corte')) return byKey('corte');

  // Coincidencia generica por nombre de servicio, valida para cualquier
  // negocio: primero por contencion (en cualquier sentido) del nombre
  // completo, y si no, por alguna palabra significativa del nombre.
  const byFullName = negocio.servicios.find((s) => {
    const name = normalize(s.nombre);
    return normalized.includes(name) || name.includes(normalized);
  });
  if (byFullName) return byFullName;

  const bySignificantWord = negocio.servicios.find((s) =>
    normalize(s.nombre)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
      .some((w) => normalized.includes(w))
  );
  return bySignificantWord || null;
}

function findServiceByKey(negocio, key) {
  return negocio.servicios.find((s) => s.key === key) || null;
}

function eventServiceName(event) {
  return (event.summary || 'Cita').split(' - Cliente')[0];
}

function welcomeMessage(negocio, lang) {
  const s = i18n.t(lang);
  return {
    kind: 'list',
    body: s.welcomeBody(negocio),
    buttonText: s.welcomeButtonText,
    sections: [
      {
        title: s.welcomeSectionTitle,
        rows: [
          { id: 'menu_horarios', title: truncate(s.rowHorarios, ROW_TITLE_MAX) },
          { id: 'menu_reservar', title: truncate(s.rowReservar, ROW_TITLE_MAX) },
          { id: 'menu_cancelar', title: truncate(s.rowCancelar, ROW_TITLE_MAX) },
          { id: 'menu_idioma', title: truncate(s.rowIdioma, ROW_TITLE_MAX) },
        ],
      },
    ],
  };
}

function fallbackMessage(negocio, lang) {
  const s = i18n.t(lang);
  return {
    ...welcomeMessage(negocio, lang),
    body: s.fallbackBody,
  };
}

function horariosPreciosMessage(negocio, lang) {
  const s = i18n.t(lang);
  return {
    kind: 'buttons',
    body: s.horariosYPreciosBody(negocio),
    buttons: [
      { id: 'action_reservar', title: truncate(s.btnReservarCita, BUTTON_TITLE_MAX) },
      { id: 'action_menu', title: truncate(s.btnMenuPrincipal, BUTTON_TITLE_MAX) },
    ],
  };
}

function serviceListMessage(negocio, lang) {
  const s = i18n.t(lang);
  return {
    kind: 'list',
    body: s.serviceListBody,
    buttonText: s.serviceListButtonText,
    sections: [
      {
        title: s.serviceListSectionTitle,
        rows: negocio.servicios.slice(0, MAX_LIST_ROWS).map((srv) => ({
          id: `service_${srv.key}`,
          title: truncate(srv.nombre, ROW_TITLE_MAX),
          description: truncate(s.serviceRowDescription(srv.precio, srv.duracionMinutos), ROW_DESC_MAX),
        })),
      },
    ],
  };
}

function askDateMessage(lang) {
  return { kind: 'text', text: i18n.t(lang).askDateText };
}

function slotsListMessage(dateLabel, slots, lang) {
  const s = i18n.t(lang);
  const shown = slots.slice(0, MAX_LIST_ROWS);
  const note = slots.length > MAX_LIST_ROWS ? s.slotsNoteMore : '';
  return {
    kind: 'list',
    body: s.slotsListBody(dateLabel, note),
    buttonText: s.slotsListButtonText,
    sections: [
      {
        title: s.slotsSectionTitle,
        rows: shown.map((slot, i) => ({
          id: `slot_${i}`,
          title: slot.toFormat('HH:mm'),
        })),
      },
    ],
  };
}

function confirmBookingMessage(negocio, session, lang) {
  const s = i18n.t(lang);
  const { service, chosenSlot } = session;
  return {
    kind: 'buttons',
    body: s.confirmBookingBody(negocio, service, chosenSlot),
    buttons: [
      { id: 'confirm_yes', title: truncate(s.btnConfirmYes, BUTTON_TITLE_MAX) },
      { id: 'confirm_no', title: truncate(s.btnConfirmNo, BUTTON_TITLE_MAX) },
    ],
  };
}

function bookingConfirmedMessage(negocio, { service, start }, lang) {
  const s = i18n.t(lang);
  return {
    kind: 'buttons',
    body: s.bookingConfirmedBody(negocio, service, start),
    buttons: [
      { id: 'action_cancelar_cita', title: truncate(s.btnCancelarCita, BUTTON_TITLE_MAX) },
      { id: 'action_menu', title: truncate(s.btnMenuPrincipal, BUTTON_TITLE_MAX) },
    ],
  };
}

function appointmentsListMessage(events, lang) {
  const s = i18n.t(lang);
  const shown = events.slice(0, MAX_LIST_ROWS);
  const note = events.length > MAX_LIST_ROWS ? s.appointmentsNoteMore : '';
  return {
    kind: 'list',
    body: s.appointmentsListBody(note),
    buttonText: s.appointmentsListButtonText,
    sections: [
      {
        title: s.appointmentsSectionTitle,
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

function cancelConfirmMessage(negocio, event, lang) {
  const s = i18n.t(lang);
  return {
    kind: 'buttons',
    body: s.cancelConfirmBody(negocio, eventServiceName(event), event),
    buttons: [
      { id: 'cancel_confirm_yes', title: truncate(s.btnCancelYes, BUTTON_TITLE_MAX) },
      { id: 'cancel_confirm_no', title: truncate(s.btnCancelNo, BUTTON_TITLE_MAX) },
    ],
  };
}

function cancelConfirmedMessage(negocio, lang) {
  const s = i18n.t(lang);
  return {
    kind: 'buttons',
    body: s.cancelConfirmedBody(negocio),
    buttons: [
      { id: 'action_reservar_otra', title: truncate(s.btnReservarOtra, BUTTON_TITLE_MAX) },
      { id: 'action_menu', title: truncate(s.btnMenuPrincipal, BUTTON_TITLE_MAX) },
    ],
  };
}

function noAppointmentsMessage(lang) {
  const s = i18n.t(lang);
  return {
    kind: 'buttons',
    body: s.noAppointmentsBody,
    buttons: [
      { id: 'action_reservar', title: truncate(s.btnReservarCita, BUTTON_TITLE_MAX) },
      { id: 'action_menu', title: truncate(s.btnMenuPrincipal, BUTTON_TITLE_MAX) },
    ],
  };
}

/** Selector de idioma: se muestra igual sin importar el idioma actual. */
function languagePickerMessage() {
  return {
    kind: 'buttons',
    body:
      '🌐 ¿En qué idioma prefieres continuar?\n' +
      'En quin idioma vols continuar?\n' +
      'Which language would you like to use?',
    buttons: [
      { id: 'lang_es', title: truncate('🇪🇸 Castellano', BUTTON_TITLE_MAX) },
      { id: 'lang_ca', title: truncate('🏴󠁥󠁳󠁣󠁴󠁿 Català', BUTTON_TITLE_MAX) },
      { id: 'lang_en', title: truncate('🇬🇧 English', BUTTON_TITLE_MAX) },
    ],
  };
}

function languageSavedMessage(lang) {
  return { kind: 'text', text: i18n.t(lang).languageSavedText };
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
  languagePickerMessage,
  languageSavedMessage,
};
