require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name} en el archivo .env`);
  }
  return value;
}

module.exports = {
  port: process.env.PORT || 3000,

  // Credenciales compartidas de la app de WhatsApp (Meta). Los datos propios
  // de cada negocio (phoneNumberId, horarios, servicios, calendario) viven
  // en negocios.json, no aqui.
  whatsapp: {
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    accessToken: required('WHATSAPP_ACCESS_TOKEN'),
    verifyToken: required('WHATSAPP_VERIFY_TOKEN'),
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
  },

  // Credenciales de la cuenta de servicio de Google, compartidas por todos
  // los negocios. El calendario concreto de cada negocio se indica en
  // negocios.json (googleCalendar.calendarId).
  //
  // En produccion (Render, etc.) se usa GOOGLE_CREDENTIALS_JSON: el
  // contenido completo del JSON de la cuenta de servicio pegado como
  // variable de entorno, para no depender de ningun archivo ni ruta local.
  // En desarrollo local tambien se admite GOOGLE_APPLICATION_CREDENTIALS
  // apuntando al archivo .json descargado de Google Cloud.
  google: {
    credentialsJson: process.env.GOOGLE_CREDENTIALS_JSON || '',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  },
};

if (!module.exports.google.credentialsJson && !module.exports.google.credentialsPath) {
  throw new Error(
    'Faltan las credenciales de Google: define GOOGLE_CREDENTIALS_JSON (el JSON de la cuenta ' +
      'de servicio, recomendado en produccion) o GOOGLE_APPLICATION_CREDENTIALS (ruta a un ' +
      'archivo .json, para desarrollo local) en el .env'
  );
}
