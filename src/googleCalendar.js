const path = require('path');
const { google } = require('googleapis');
const { DateTime } = require('luxon');
const config = require('./config');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

let calendarClientPromise = null;
const calendarIdCache = new Map(); // calendarName -> Promise<calendarId>

/**
 * Construye las opciones de autenticacion para GoogleAuth. Prioriza
 * GOOGLE_CREDENTIALS_JSON (el JSON de la cuenta de servicio como variable
 * de entorno, tal cual o en base64) sobre GOOGLE_APPLICATION_CREDENTIALS
 * (ruta a un archivo local), para no depender de rutas del disco en
 * produccion.
 */
function buildAuthOptions() {
  if (config.google.credentialsJson) {
    let raw = config.google.credentialsJson.trim();
    if (!raw.startsWith('{')) {
      raw = Buffer.from(raw, 'base64').toString('utf8');
    }
    return { credentials: JSON.parse(raw), scopes: SCOPES };
  }
  return {
    keyFile: path.resolve(process.cwd(), config.google.credentialsPath),
    scopes: SCOPES,
  };
}

function getCalendarClient() {
  if (!calendarClientPromise) {
    calendarClientPromise = (async () => {
      const auth = new google.auth.GoogleAuth(buildAuthOptions());
      const authClient = await auth.getClient();
      return google.calendar({ version: 'v3', auth: authClient });
    })();
  }
  return calendarClientPromise;
}

/**
 * Resuelve el ID del calendario de un negocio. Si el negocio ya trae
 * googleCalendar.calendarId en negocios.json se usa directamente; si no, se
 * busca por nombre (googleCalendar.calendarName) en la cuenta de servicio.
 */
async function getCalendarId(negocio) {
  const { calendarId, calendarName } = negocio.googleCalendar || {};
  if (calendarId) return calendarId;

  if (!calendarName) {
    throw new Error(
      `El negocio "${negocio.nombre}" no tiene googleCalendar.calendarId ni calendarName en negocios.json`
    );
  }

  if (!calendarIdCache.has(calendarName)) {
    calendarIdCache.set(
      calendarName,
      (async () => {
        const calendar = await getCalendarClient();
        const { data } = await calendar.calendarList.list();
        const match = (data.items || []).find((item) => item.summary === calendarName);
        if (!match) {
          throw new Error(
            `No se ha encontrado un calendario llamado "${calendarName}" en la lista de ` +
              'calendarios de la cuenta de servicio. Comparte el calendario con la cuenta de ' +
              'servicio, o mejor, configura googleCalendar.calendarId en negocios.json con el ' +
              'ID del calendario (Configuracion y uso compartido > Integrar calendario).'
          );
        }
        return match.id;
      })()
    );
  }
  return calendarIdCache.get(calendarName);
}

/**
 * Devuelve los huecos libres de un dia dentro del horario del negocio.
 * @param {object} negocio - negocio (de negocios.json) al que consultar
 * @param {DateTime} day - cualquier DateTime del dia deseado (zona del negocio)
 * @param {number} durationMinutes - duracion del servicio
 * @returns {Promise<DateTime[]>} lista de horas de inicio disponibles
 */
/**
 * Devuelve el horario (horaInicio/horaFin/...) de un negocio para el dia de
 * la semana concreto de `day`, o null si ese dia esta cerrado.
 */
function getDayHours(negocio, day) {
  return negocio.horario.horarioPorDia ? negocio.horario.horarioPorDia[day.weekday] || null : negocio.horario;
}

async function getAvailableSlots(negocio, day, durationMinutes) {
  const calendar = await getCalendarClient();
  const calendarId = await getCalendarId(negocio);
  const dayConfig = getDayHours(negocio, day);
  if (!dayConfig) {
    throw new Error(`El negocio "${negocio.nombre}" no tiene horario configurado para ese día.`);
  }
  const { horaInicio, horaFin, horaInicioMinuto = 0, horaFinMinuto = 0 } = dayConfig;

  const dayStart = day.set({ hour: horaInicio, minute: horaInicioMinuto, second: 0, millisecond: 0 });
  const dayEnd = day.set({ hour: horaFin, minute: horaFinMinuto, second: 0, millisecond: 0 });

  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: dayStart.toISO(),
      timeMax: dayEnd.toISO(),
      items: [{ id: calendarId }],
    },
  });

  const busyPeriods = (data.calendars?.[calendarId]?.busy || []).map((b) => ({
    start: DateTime.fromISO(b.start),
    end: DateTime.fromISO(b.end),
  }));

  const now = DateTime.now().setZone(negocio.timezone);
  const slots = [];
  let cursor = dayStart;
  const slotStepMinutes = 30;

  while (cursor.plus({ minutes: durationMinutes }) <= dayEnd) {
    const slotEnd = cursor.plus({ minutes: durationMinutes });
    const isPast = cursor < now;
    const overlapsBusy = busyPeriods.some((busy) => cursor < busy.end && slotEnd > busy.start);

    if (!isPast && !overlapsBusy) {
      slots.push(cursor);
    }

    cursor = cursor.plus({ minutes: slotStepMinutes });
  }

  return slots;
}

/**
 * Crea un evento en el calendario de citas del negocio.
 */
async function createEvent(negocio, { summary, description, start, end }) {
  const calendar = await getCalendarClient();
  const calendarId = await getCalendarId(negocio);

  const { data } = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: start.toISO(), timeZone: negocio.timezone },
      end: { dateTime: end.toISO(), timeZone: negocio.timezone },
    },
  });

  return data;
}

/**
 * Busca las citas futuras de un cliente (identificado por su numero de
 * WhatsApp) en el calendario del negocio, hasta 90 dias vista.
 * @returns {Promise<Array<{id: string, summary: string, start: DateTime}>>}
 */
async function findUpcomingEvents(negocio, from) {
  const calendar = await getCalendarClient();
  const calendarId = await getCalendarId(negocio);
  const now = DateTime.now().setZone(negocio.timezone);
  const marker = `Teléfono: ${from}.`;

  // No usamos el parametro "q" (busqueda por texto de Google) porque su
  // indice puede tardar en reflejar eventos recien creados, dando falsos
  // negativos justo despues de reservar. Traemos todos los eventos del
  // rango de fechas y filtramos nosotros mismos por el marcador exacto.
  const { data } = await calendar.events.list({
    calendarId,
    timeMin: now.toISO(),
    timeMax: now.plus({ days: 90 }).toISO(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (data.items || [])
    .filter((ev) => (ev.description || '').includes(marker) && ev.start?.dateTime)
    .map((ev) => ({
      id: ev.id,
      summary: ev.summary,
      start: DateTime.fromISO(ev.start.dateTime, { zone: negocio.timezone }),
    }));
}

/**
 * Cancela (elimina) una cita del calendario del negocio.
 */
async function cancelEvent(negocio, eventId) {
  const calendar = await getCalendarClient();
  const calendarId = await getCalendarId(negocio);
  await calendar.events.delete({ calendarId, eventId });
}

module.exports = {
  getDayHours,
  getAvailableSlots,
  createEvent,
  findUpcomingEvents,
  cancelEvent,
};
