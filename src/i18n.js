const LANGUAGES = ['es', 'ca', 'en'];
const DEFAULT_LANGUAGE = 'es';

function resolveLanguage(lang) {
  return LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
}

function formatHour(hour, minute) {
  return `${hour}:${String(minute || 0).padStart(2, '0')}`;
}

/** "15€" o, si el precio es null (a determinar), el texto que se le indique. */
function priceSuffix(precio, onRequestText) {
  return precio != null ? `${precio}€` : onRequestText;
}

/** "€15" o, si el precio es null (a determinar), el texto que se le indique. */
function pricePrefix(precio, onRequestText) {
  return precio != null ? `€${precio}` : onRequestText;
}

/** Categorias de un negocio, en el orden en que aparecen sus servicios. */
function categoriasDeServicios(negocio) {
  const seen = [];
  for (const s of negocio.servicios) {
    if (s.categoria && !seen.includes(s.categoria)) seen.push(s.categoria);
  }
  return seen;
}

/**
 * Servicios de un negocio sin repetir (un mismo servicio puede aparecer
 * varias veces en negocio.servicios si pertenece a mas de una categoria,
 * p.ej. "Limpieza facial" en servicios de hombre y de mujer).
 */
function serviciosUnicos(negocio) {
  const seen = new Set();
  const result = [];
  for (const s of negocio.servicios) {
    if (!seen.has(s.key)) {
      seen.add(s.key);
      result.push(s);
    }
  }
  return result;
}

/**
 * Icono de un negocio para un "rol" dado (p.ej. "marca" o "servicio").
 * negocio.emojis en negocios.json puede sobreescribirlo; si no, se usa el
 * icono por defecto (el de barberia, para no cambiar el aspecto de los
 * negocios que ya existian).
 */
function emoji(negocio, role, fallback) {
  return (negocio.emojis && negocio.emojis[role]) || fallback;
}

const WEEKDAY_DISPLAY = {
  es: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
  ca: ['Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte', 'Diumenge'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};
const DAY_RANGE_CONNECTOR = { es: 'a', ca: 'a', en: 'to' };
const CLOSED_LABEL = { es: 'Cerrado', ca: 'Tancat', en: 'Closed' };

/**
 * Devuelve, para cada dia de lunes(1) a domingo(7), si el negocio abre ese
 * dia y con que tramos horarios (normalmente uno, pero puede haber varios
 * si hay un descanso entre medio, p.ej. mañana y tarde). Soporta tanto el
 * formato antiguo (horaInicio/horaFin + diasLaborables, mismo tramo todos
 * los dias abiertos) como negocio.horario.horarioPorDia, cuyo valor por
 * dia puede ser un tramo {horaInicio,horaFin,...} o un array de tramos;
 * los dias ausentes de horarioPorDia se consideran cerrados.
 */
function scheduleEntries(negocio) {
  const { horario } = negocio;
  const perDay = horario.horarioPorDia;
  const diasLaborables = horario.diasLaborables || [1, 2, 3, 4, 5];

  const entries = [];
  for (let day = 1; day <= 7; day++) {
    if (perDay) {
      const raw = perDay[day];
      const ranges = raw ? (Array.isArray(raw) ? raw : [raw]) : null;
      entries.push(ranges ? { day, open: true, ranges } : { day, open: false });
    } else if (diasLaborables.includes(day)) {
      entries.push({
        day,
        open: true,
        ranges: [
          {
            horaInicio: horario.horaInicio,
            horaFin: horario.horaFin,
            horaInicioMinuto: horario.horaInicioMinuto,
            horaFinMinuto: horario.horaFinMinuto,
          },
        ],
      });
    } else {
      entries.push({ day, open: false });
    }
  }
  return entries;
}

function rangesEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every(
    (r, i) =>
      r.horaInicio === b[i].horaInicio &&
      r.horaFin === b[i].horaFin &&
      (r.horaInicioMinuto || 0) === (b[i].horaInicioMinuto || 0) &&
      (r.horaFinMinuto || 0) === (b[i].horaFinMinuto || 0)
  );
}

/**
 * Texto multilinea con el horario completo (lunes a domingo), agrupando
 * dias consecutivos con el mismo horario (o consecutivos cerrados) en una
 * sola linea. Los dias cerrados se muestran explicitamente. Si un dia
 * tiene varios tramos, se listan separados por comas (p.ej. "10:30-13:30,
 * 16:00-20:30").
 */
function formatSchedule(negocio, lang) {
  const entries = scheduleEntries(negocio);
  const names = WEEKDAY_DISPLAY[lang];
  const connector = DAY_RANGE_CONNECTOR[lang];
  const closedLabel = CLOSED_LABEL[lang];

  const groups = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    const sameGroup =
      last &&
      last.open === entry.open &&
      entry.day === last.lastDay + 1 &&
      (!entry.open || rangesEqual(last.ranges, entry.ranges));
    if (sameGroup) {
      last.lastDay = entry.day;
    } else {
      groups.push({ ...entry, firstDay: entry.day, lastDay: entry.day });
    }
  }

  return groups
    .map((g) => {
      const dayLabel =
        g.firstDay === g.lastDay
          ? names[g.firstDay - 1]
          : `${names[g.firstDay - 1]} ${connector} ${names[g.lastDay - 1]}`;
      const hoursLabel = g.open
        ? g.ranges.map((r) => `${formatHour(r.horaInicio, r.horaInicioMinuto)}-${formatHour(r.horaFin, r.horaFinMinuto)}`).join(', ')
        : closedLabel;
      return `${dayLabel}: ${hoursLabel}`;
    })
    .join('\n');
}

const catalogs = {
  es: {
    todayWord: 'hoy',
    tomorrowWord: 'manana',
    weekdayWords: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],

    welcomeBody: (negocio) =>
      `¡Hola! 👋 Bienvenido/a a ${negocio.nombre} ${emoji(negocio, 'marca', '💈')}\n` +
      'Soy el asistente virtual y estoy aquí para ayudarte. ¿Qué te gustaría hacer?',
    welcomeButtonText: 'Ver opciones',
    welcomeSectionTitle: 'Menú principal',
    rowHorarios: '📋 Horarios y precios',
    rowReservar: '📅 Reservar una cita',
    rowCancelar: '❌ Cancelar una cita',
    rowIdioma: '🌐 Idioma',
    fallbackBody: 'Uy, no te he entendido bien 😅 Elige una opción:',

    horariosYPreciosBody: (negocio) => {
      const servicios = serviciosUnicos(negocio)
        .map((s) => `• ${s.nombre}: ${priceSuffix(s.precio, 'consultar en el momento de la reserva')}`)
        .join('\n');
      return (
        `🕒 Nuestro horario:\n${formatSchedule(negocio, 'es')}\n\n` +
        `${emoji(negocio, 'servicio', '✂️')} Nuestros servicios:\n${servicios}`
      );
    },
    btnReservarCita: '📅 Reservar cita',
    btnMenuPrincipal: '🏠 Menú principal',

    categoryListBody: (negocio) => {
      const bloques = categoriasDeServicios(negocio).map((cat) => {
        const servicios = negocio.servicios
          .filter((s) => s.categoria === cat)
          .map((s) => {
            const precio = priceSuffix(s.precio, 'consultar en el momento de la reserva');
            return `• ${s.nombre}: ${precio}${s.destacado ? ' 🔥 El más elegido' : ''}`;
          })
          .join('\n');
        return `*${cat}*\n${servicios}`;
      });
      return `¡Genial! 🙌 Estos son nuestros servicios:\n\n${bloques.join('\n\n')}\n\nElige una categoría para reservar 👇`;
    },
    categoryListButtonText: 'Ver categorías',
    categoryListSectionTitle: 'Categorías',

    serviceListBody: '¡Genial! 🙌 Vamos a reservarte una cita. ¿Qué servicio quieres?',
    serviceListButtonText: 'Ver servicios',
    serviceListSectionTitle: 'Servicios',
    serviceRowDescription: (service) => {
      const precio = priceSuffix(service.precio, 'precio a consultar');
      return service.destacado ? `${precio} · 🔥 El más elegido` : precio;
    },

    askDateText: "Perfecto ✂️ ¿Qué día te viene bien? Por ejemplo: 'mañana', 'el viernes', o una fecha como '10/09'",
    askNameText: '¿Cómo te llamas? 😊',
    dateNotUnderstoodText: 'No he entendido esa fecha. Prueba con "mañana", "el viernes" o una fecha como "10/09".',
    datePastText: 'Esa fecha ya ha pasado. Indica un día a partir de hoy.',
    dayClosedText: 'Ese día no abrimos. Elige otro día, por favor.',
    calendarErrorText: 'Ha ocurrido un error consultando el calendario. Inténtalo de nuevo en un momento.',
    noSlotsText: 'No quedan huecos libres ese día. Prueba con otra fecha.',
    serviceTooLongText: (service, horario) =>
      `Lo sentimos 🙏 No podemos ofrecerte "${service.nombre}" ese día: no cabe en nuestro horario de apertura de ese día ` +
      `(${formatHour(horario.horaInicio, horario.horaInicioMinuto)}-${formatHour(horario.horaFin, horario.horaFinMinuto)}). ` +
      'Por favor, elige otro día.',

    slotsListBody: (fecha, note) => `Estos son los huecos libres para el ${fecha} ⏰${note}`,
    slotsNoteMore: '\n(mostrando los primeros 10 huecos)',
    slotsListButtonText: 'Ver horarios',
    slotsSectionTitle: 'Horarios libres',

    confirmBookingBody: (negocio, service, slot, clientName) =>
      'Vale, resumen de tu cita 📋\n' +
      `👤 Nombre: ${clientName}\n` +
      `${emoji(negocio, 'servicio', '✂️')} Servicio: ${service.nombre}\n` +
      `📅 Día: ${slot.toFormat('dd/MM/yyyy')}\n` +
      `⏰ Hora: ${slot.toFormat('HH:mm')}\n` +
      `💶 Precio: ${priceSuffix(service.precio, 'a consultar en el momento de la reserva')}\n\n` +
      '¿Confirmas la reserva?',
    btnConfirmYes: '✅ Sí, confirmar',
    btnConfirmChangeHour: '🕐 Modificar hora',
    btnConfirmNo: '❌ No, cancelar',

    bookingConfirmedBody: (negocio, service, start) =>
      '¡Todo listo! ✅ Tu cita está confirmada:\n' +
      `${emoji(negocio, 'servicio', '✂️')} ${service.nombre} — 📅 ${start.toFormat('dd/MM/yyyy')} a las ⏰ ${start.toFormat('HH:mm')}\n\n` +
      `Te esperamos en ${negocio.nombre} ${emoji(negocio, 'marca', '💈')} ¡Gracias por confiar en nosotros!`,
    btnCancelarCita: '❌ Cancelar cita',
    bookingSaveErrorText: 'No he podido guardar la cita en el calendario. Inténtalo de nuevo más tarde.',
    bookingAbortedText: 'De acuerdo, no se ha realizado la reserva.',

    appointmentsListBody: (note) => `Estas son tus citas próximas 📋${note}`,
    appointmentsNoteMore: '\n(mostrando las próximas 10)',
    appointmentsListButtonText: 'Ver mis citas',
    appointmentsSectionTitle: 'Tus citas',
    fetchAppointmentsErrorText: 'Ha ocurrido un error consultando tus citas. Inténtalo de nuevo en un momento.',

    cancelConfirmBody: (negocio, eventName, event) =>
      '¿Seguro que quieres cancelar esta cita? 🥺\n' +
      `${emoji(negocio, 'servicio', '✂️')} ${eventName} — ${event.start.toFormat('dd/MM/yyyy')} a las ${event.start.toFormat('HH:mm')}`,
    btnCancelYes: '✅ Sí, cancelar',
    btnCancelNo: '❌ No, mantener',
    cancelSaveErrorText: 'No he podido cancelar la cita. Inténtalo de nuevo más tarde.',

    cancelConfirmedBody: (negocio) =>
      `Cita cancelada ❌ Esperamos verte pronto por ${negocio.nombre} ${emoji(negocio, 'marca', '💈')}`,
    btnReservarOtra: '📅 Reservar otra',
    cancelAbortedText: 'De acuerdo, no se ha cancelado nada.',

    noAppointmentsBody: 'No encuentro ninguna cita a tu nombre 🤔',

    operationCancelledText: 'Operación cancelada.',
    restartingChoiceText: 'Vale, empecemos de nuevo eligiendo el servicio 🙌',
    languageSavedText: 'Perfecto, a partir de ahora te hablaré en castellano 🇪🇸',
  },

  ca: {
    todayWord: 'avui',
    tomorrowWord: 'dema',
    weekdayWords: ['dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte', 'diumenge'],

    welcomeBody: (negocio) =>
      `Hola! 👋 Benvingut/da a ${negocio.nombre} ${emoji(negocio, 'marca', '💈')}\n` +
      "Sóc l'assistent virtual i estic aquí per ajudar-te. Què t'agradaria fer?",
    welcomeButtonText: 'Veure opcions',
    welcomeSectionTitle: 'Menú principal',
    rowHorarios: '📋 Horaris i preus',
    rowReservar: '📅 Reservar una cita',
    rowCancelar: '❌ Cancel·lar una cita',
    rowIdioma: '🌐 Idioma',
    fallbackBody: "Ui, no t'he entès bé 😅 Tria una opció:",

    horariosYPreciosBody: (negocio) => {
      const servicios = serviciosUnicos(negocio)
        .map((s) => `• ${s.nombre}: ${priceSuffix(s.precio, 'a consultar en el moment de la reserva')}`)
        .join('\n');
      return (
        `🕒 El nostre horari:\n${formatSchedule(negocio, 'ca')}\n\n` +
        `${emoji(negocio, 'servicio', '✂️')} Els nostres serveis:\n${servicios}`
      );
    },
    btnReservarCita: '📅 Reservar cita',
    btnMenuPrincipal: '🏠 Menú principal',

    categoryListBody: (negocio) => {
      const bloques = categoriasDeServicios(negocio).map((cat) => {
        const servicios = negocio.servicios
          .filter((s) => s.categoria === cat)
          .map((s) => {
            const precio = priceSuffix(s.precio, 'a consultar en el moment de la reserva');
            return `• ${s.nombre}: ${precio}${s.destacado ? ' 🔥 El més triat' : ''}`;
          })
          .join('\n');
        return `*${cat}*\n${servicios}`;
      });
      return `Genial! 🙌 Aquests són els nostres serveis:\n\n${bloques.join('\n\n')}\n\nTria una categoria per reservar 👇`;
    },
    categoryListButtonText: 'Veure categories',
    categoryListSectionTitle: 'Categories',

    serviceListBody: "Genial! 🙌 Anem a reservar-te una cita. Quin servei vols?",
    serviceListButtonText: 'Veure serveis',
    serviceListSectionTitle: 'Serveis',
    serviceRowDescription: (service) => {
      const precio = priceSuffix(service.precio, 'preu a consultar');
      return service.destacado ? `${precio} · 🔥 El més triat` : precio;
    },

    askDateText: "Perfecte ✂️ Quin dia et va bé? Per exemple: 'demà', 'el divendres', o una data com '10/09'",
    askNameText: 'Com et dius? 😊',
    dateNotUnderstoodText: 'No he entès aquesta data. Prova amb "demà", "el divendres" o una data com "10/09".',
    datePastText: "Aquesta data ja ha passat. Indica un dia a partir d'avui.",
    dayClosedText: 'Aquest dia no obrim. Tria un altre dia, sisplau.',
    calendarErrorText: "Hi ha hagut un error consultant el calendari. Torna-ho a provar d'aquí un moment.",
    noSlotsText: 'No queden hores lliures aquest dia. Prova amb una altra data.',
    serviceTooLongText: (service, horario) =>
      `Ho sentim 🙏 No podem oferir-te "${service.nombre}" aquest dia: no hi cap en el nostre horari d'obertura d'aquell dia ` +
      `(${formatHour(horario.horaInicio, horario.horaInicioMinuto)}-${formatHour(horario.horaFin, horario.horaFinMinuto)}). ` +
      'Si us plau, tria un altre dia.',

    slotsListBody: (fecha, note) => `Aquestes són les hores lliures per al ${fecha} ⏰${note}`,
    slotsNoteMore: '\n(mostrant les primeres 10 hores)',
    slotsListButtonText: 'Veure horaris',
    slotsSectionTitle: 'Horaris lliures',

    confirmBookingBody: (negocio, service, slot, clientName) =>
      'Molt bé, resum de la teva cita 📋\n' +
      `👤 Nom: ${clientName}\n` +
      `${emoji(negocio, 'servicio', '✂️')} Servei: ${service.nombre}\n` +
      `📅 Dia: ${slot.toFormat('dd/MM/yyyy')}\n` +
      `⏰ Hora: ${slot.toFormat('HH:mm')}\n` +
      `💶 Preu: ${priceSuffix(service.precio, 'a consultar en el moment de la reserva')}\n\n` +
      'Confirmes la reserva?',
    btnConfirmYes: '✅ Sí, confirmar',
    btnConfirmChangeHour: "🕐 Modificar l'hora",
    btnConfirmNo: '❌ No, cancel·lar',

    bookingConfirmedBody: (negocio, service, start) =>
      'Tot llest! ✅ La teva cita està confirmada:\n' +
      `${emoji(negocio, 'servicio', '✂️')} ${service.nombre} — 📅 ${start.toFormat('dd/MM/yyyy')} a les ⏰ ${start.toFormat('HH:mm')}\n\n` +
      `T'esperem a ${negocio.nombre} ${emoji(negocio, 'marca', '💈')} Gràcies per confiar en nosaltres!`,
    btnCancelarCita: '❌ Cancel·lar cita',
    bookingSaveErrorText: 'No he pogut desar la cita al calendari. Torna-ho a provar més tard.',
    bookingAbortedText: "D'acord, no s'ha fet la reserva.",

    appointmentsListBody: (note) => `Aquestes són les teves properes cites 📋${note}`,
    appointmentsNoteMore: '\n(mostrant les properes 10)',
    appointmentsListButtonText: 'Veure les meves cites',
    appointmentsSectionTitle: 'Les teves cites',
    fetchAppointmentsErrorText: "Hi ha hagut un error consultant les teves cites. Torna-ho a provar d'aquí un moment.",

    cancelConfirmBody: (negocio, eventName, event) =>
      'Segur que vols cancel·lar aquesta cita? 🥺\n' +
      `${emoji(negocio, 'servicio', '✂️')} ${eventName} — ${event.start.toFormat('dd/MM/yyyy')} a les ${event.start.toFormat('HH:mm')}`,
    btnCancelYes: '✅ Sí, cancel·lar',
    btnCancelNo: '❌ No, mantenir',
    cancelSaveErrorText: 'No he pogut cancel·lar la cita. Torna-ho a provar més tard.',

    cancelConfirmedBody: (negocio) =>
      `Cita cancel·lada ❌ Esperem veure't aviat per ${negocio.nombre} ${emoji(negocio, 'marca', '💈')}`,
    btnReservarOtra: '📅 Reservar una altra',
    cancelAbortedText: "D'acord, no s'ha cancel·lat res.",

    noAppointmentsBody: 'No trobo cap cita al teu nom 🤔',

    operationCancelledText: 'Operació cancel·lada.',
    restartingChoiceText: "D'acord, comencem de nou triant el servei 🙌",
    languageSavedText: "Perfecte, a partir d'ara et parlaré en català",
  },

  en: {
    todayWord: 'today',
    tomorrowWord: 'tomorrow',
    weekdayWords: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],

    welcomeBody: (negocio) =>
      `Hi! 👋 Welcome to ${negocio.nombre} ${emoji(negocio, 'marca', '💈')}\n` +
      "I'm the virtual assistant and I'm here to help. What would you like to do?",
    welcomeButtonText: 'View options',
    welcomeSectionTitle: 'Main menu',
    rowHorarios: '📋 Hours & prices',
    rowReservar: '📅 Book an appointment',
    rowCancelar: '❌ Cancel an appointment',
    rowIdioma: '🌐 Language',
    fallbackBody: "Oops, I didn't quite get that 😅 Pick an option:",

    horariosYPreciosBody: (negocio) => {
      const servicios = serviciosUnicos(negocio)
        .map((s) => `• ${s.nombre}: ${pricePrefix(s.precio, 'to be confirmed at booking')}`)
        .join('\n');
      return (
        `🕒 Our hours:\n${formatSchedule(negocio, 'en')}\n\n` +
        `${emoji(negocio, 'servicio', '✂️')} Our services:\n${servicios}`
      );
    },
    btnReservarCita: '📅 Book appointment',
    btnMenuPrincipal: '🏠 Main menu',

    categoryListBody: (negocio) => {
      const bloques = categoriasDeServicios(negocio).map((cat) => {
        const servicios = negocio.servicios
          .filter((s) => s.categoria === cat)
          .map((s) => {
            const precio = pricePrefix(s.precio, 'to be confirmed at booking');
            return `• ${s.nombre}: ${precio}${s.destacado ? ' 🔥 Most popular' : ''}`;
          })
          .join('\n');
        return `*${cat}*\n${servicios}`;
      });
      return `Great! 🙌 Here are our services:\n\n${bloques.join('\n\n')}\n\nChoose a category to book 👇`;
    },
    categoryListButtonText: 'View categories',
    categoryListSectionTitle: 'Categories',

    serviceListBody: "Great! 🙌 Let's book your appointment. Which service would you like?",
    serviceListButtonText: 'View services',
    serviceListSectionTitle: 'Services',
    serviceRowDescription: (service) => {
      const precio = pricePrefix(service.precio, 'price on request');
      return service.destacado ? `${precio} · 🔥 Most popular` : precio;
    },

    askDateText: "Great ✂️ What day works for you? For example: 'tomorrow', 'friday', or a date like '10/09'",
    askNameText: "What's your name? 😊",
    dateNotUnderstoodText: 'I didn\'t understand that date. Try "tomorrow", "friday" or a date like "10/09".',
    datePastText: 'That date has already passed. Please pick a day from today onwards.',
    dayClosedText: "We're closed that day. Please choose another day.",
    calendarErrorText: 'There was an error checking the calendar. Please try again in a moment.',
    noSlotsText: 'No free slots left that day. Try another date.',
    serviceTooLongText: (service, horario) =>
      `We're sorry 🙏 We can't offer "${service.nombre}" that day: it doesn't fit in our opening hours that day ` +
      `(${formatHour(horario.horaInicio, horario.horaInicioMinuto)}-${formatHour(horario.horaFin, horario.horaFinMinuto)}). ` +
      'Please choose another day.',

    slotsListBody: (fecha, note) => `Here are the free slots for ${fecha} ⏰${note}`,
    slotsNoteMore: '\n(showing the first 10 slots)',
    slotsListButtonText: 'View times',
    slotsSectionTitle: 'Available times',

    confirmBookingBody: (negocio, service, slot, clientName) =>
      "Ok, here's a summary of your appointment 📋\n" +
      `👤 Name: ${clientName}\n` +
      `${emoji(negocio, 'servicio', '✂️')} Service: ${service.nombre}\n` +
      `📅 Day: ${slot.toFormat('dd/MM/yyyy')}\n` +
      `⏰ Time: ${slot.toFormat('HH:mm')}\n` +
      `💶 Price: ${pricePrefix(service.precio, 'to be confirmed at booking')}\n\n` +
      'Do you confirm the booking?',
    btnConfirmYes: '✅ Yes, confirm',
    btnConfirmChangeHour: '🕐 Change time',
    btnConfirmNo: '❌ No, cancel',

    bookingConfirmedBody: (negocio, service, start) =>
      'All set! ✅ Your appointment is confirmed:\n' +
      `${emoji(negocio, 'servicio', '✂️')} ${service.nombre} — 📅 ${start.toFormat('dd/MM/yyyy')} at ⏰ ${start.toFormat('HH:mm')}\n\n` +
      `See you at ${negocio.nombre} ${emoji(negocio, 'marca', '💈')} Thanks for trusting us!`,
    btnCancelarCita: '❌ Cancel appointment',
    bookingSaveErrorText: "I couldn't save the appointment to the calendar. Please try again later.",
    bookingAbortedText: "Okay, the booking wasn't made.",

    appointmentsListBody: (note) => `Here are your upcoming appointments 📋${note}`,
    appointmentsNoteMore: '\n(showing the next 10)',
    appointmentsListButtonText: 'View my appointments',
    appointmentsSectionTitle: 'Your appointments',
    fetchAppointmentsErrorText: 'There was an error checking your appointments. Please try again in a moment.',

    cancelConfirmBody: (negocio, eventName, event) =>
      'Are you sure you want to cancel this appointment? 🥺\n' +
      `${emoji(negocio, 'servicio', '✂️')} ${eventName} — ${event.start.toFormat('dd/MM/yyyy')} at ${event.start.toFormat('HH:mm')}`,
    btnCancelYes: '✅ Yes, cancel',
    btnCancelNo: '❌ No, keep it',
    cancelSaveErrorText: "I couldn't cancel the appointment. Please try again later.",

    cancelConfirmedBody: (negocio) =>
      `Appointment cancelled ❌ Hope to see you soon at ${negocio.nombre} ${emoji(negocio, 'marca', '💈')}`,
    btnReservarOtra: '📅 Book another',
    cancelAbortedText: 'Okay, nothing was cancelled.',

    noAppointmentsBody: "I can't find any appointment under your name 🤔",

    operationCancelledText: 'Operation cancelled.',
    restartingChoiceText: "Sure, let's start again by choosing the service 🙌",
    languageSavedText: "Great, I'll speak to you in English from now on 🇬🇧",
  },
};

function t(lang) {
  return catalogs[resolveLanguage(lang)];
}

module.exports = { LANGUAGES, DEFAULT_LANGUAGE, resolveLanguage, t };
