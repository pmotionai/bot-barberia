function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
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

function horariosText(negocio) {
  const { horaInicio, horaFin } = negocio.horario;
  return `Nuestro horario es de Lunes a Viernes de ${horaInicio}:00 a ${horaFin}:00.`;
}

function serviciosText(negocio) {
  return (
    'Estos son nuestros servicios:\n' +
    negocio.servicios.map((s) => `- ${s.nombre}`).join('\n')
  );
}

function preciosText(negocio) {
  return (
    'Nuestros precios son:\n' +
    negocio.servicios.map((s) => `- ${s.nombre}: ${s.precio}€`).join('\n')
  );
}

function menuText(negocio) {
  return (
    `Hola, somos ${negocio.nombre}. ¿En qué podemos ayudarte?\n` +
    '- *horarios*\n- *servicios*\n- *precios*\n- *reservar* una cita\n- *cancelar* una cita\n\n' +
    'Escribe una de esas palabras para continuar.'
  );
}

module.exports = {
  findService,
  horariosText,
  serviciosText,
  preciosText,
  menuText,
};
