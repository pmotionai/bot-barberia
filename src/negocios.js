const fs = require('fs');
const path = require('path');

const NEGOCIOS_PATH = path.resolve(process.cwd(), 'negocios.json');

let cache = null;

function load() {
  if (cache) return cache;

  const raw = fs.readFileSync(NEGOCIOS_PATH, 'utf8');
  const data = JSON.parse(raw);
  const negocios = data.negocios || [];

  const byPhoneNumberId = new Map();
  for (const negocio of negocios) {
    if (!negocio.phoneNumberId) {
      throw new Error(`El negocio "${negocio.nombre || negocio.id}" no tiene phoneNumberId en negocios.json`);
    }
    byPhoneNumberId.set(negocio.phoneNumberId, negocio);
  }

  cache = { negocios, byPhoneNumberId };
  return cache;
}

/** Recarga negocios.json desde disco (util tras editarlo sin reiniciar el proceso). */
function reload() {
  cache = null;
  return load();
}

function getAll() {
  return load().negocios;
}

function findByPhoneNumberId(phoneNumberId) {
  return load().byPhoneNumberId.get(phoneNumberId) || null;
}

module.exports = { getAll, findByPhoneNumberId, reload };
