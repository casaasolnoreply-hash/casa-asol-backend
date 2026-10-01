// Define, para cada clave de site_data, exactamente qué campos de texto
// se traducen automáticamente. Es una lista explícita (no "traducir todo
// lo que sea string") a propósito: así nunca se traducen por accidente
// cosas como IBAN, teléfonos, direcciones, URLs, nombres de íconos o ids.

const { translateBatch } = require("./deepl");

const add = (fields, obj, key) => {
  if (obj && typeof obj[key] === "string" && obj[key].trim()) fields.push({ obj, key });
};
const addEach = (fields, arr, key) => (arr || []).forEach((item) => add(fields, item, key));
const addArrayItself = (fields, obj, key) => {
  (obj?.[key] || []).forEach((_, i) => add(fields, obj[key], i));
};

function collectContentFields(c) {
  const fields = [];
  add(fields, c.hero, "title");
  add(fields, c.hero, "subtitle");
  addEach(fields, c.hero?.buttons, "text");

  add(fields, c.historia, "supertitle");
  add(fields, c.historia, "title");
  addArrayItself(fields, c.historia, "paragraphs");
  add(fields, c.historia, "quote");
  add(fields, c.historia, "quoteAuthor");

  add(fields, c.financiacion, "title");
  add(fields, c.financiacion, "desc");
  add(fields, c.financiacion?.patrocinioIndividual, "intro");
  add(fields, c.financiacion?.patrocinioIndividual, "individualHeading");
  addEach(fields, c.financiacion?.patrocinioIndividual?.monthly, "label");
  addEach(fields, c.financiacion?.patrocinioIndividual?.individual, "label");
  add(fields, c.financiacion?.patrocinioEmpresarial, "text");
  add(fields, c.financiacion?.donacionesEspecie, "text");
  add(fields, c.financiacion?.practicasEps, "text");
  // Nota: los datos bancarios (IBAN, titular, banco, etc.) NUNCA se traducen.
  add(fields, c.financiacion?.bank, "heading");
  add(fields, c.financiacion?.bank, "intro");
  add(fields, c.financiacion?.bank, "note");

  add(fields, c.voluntariado, "supertitle");
  add(fields, c.voluntariado, "title");
  add(fields, c.voluntariado, "desc");
  addArrayItself(fields, c.voluntariado, "list");
  add(fields, c.voluntariado, "btnText");

  add(fields, c.contacto, "title");
  (c.contacto?.items || []).forEach((item) => {
    add(fields, item, "title");
    // La dirección, el teléfono y el correo NUNCA se traducen (son datos,
    // no texto). Solo el horario es una frase real que vale la pena traducir.
    if (item.icon === "clock") add(fields, item, "val");
  });

  add(fields, c.footer, "desc");

  return fields;
}

function collectProgramaFields(programa) {
  const fields = [];
  (programa || []).forEach((p) => {
    add(fields, p, "title");
    add(fields, p, "desc");
    addArrayItself(fields, p, "full");
  });
  return fields;
}

function collectTeamFields(team) {
  const fields = [];
  (team || []).forEach((m) => {
    add(fields, m, "name");
    add(fields, m, "role");
  });
  return fields;
}

function collectStatsFields(stats) {
  const fields = [];
  (stats || []).forEach((s) => add(fields, s, "label"));
  return fields;
}

const COLLECTORS = {
  content:  collectContentFields,
  programa: collectProgramaFields,
  team:     collectTeamFields,
  stats:    collectStatsFields,
};

// Traduce `value` (ya guardado en español) a `targetLang` ("EN" | "DE"),
// devolviendo una copia nueva con solo los campos de texto reemplazados.
// Si algo falla (DeepL caído, sin clave, rate limit, etc.) propaga el error
// para que quien llama decida qué hacer — nunca modifica el original.
async function translateValue(key, value, targetLang) {
  const collect = COLLECTORS[key];
  if (!collect || value == null) return null;

  const clone = JSON.parse(JSON.stringify(value));
  const fields = collect(clone);
  if (!fields.length) return clone;

  const texts = fields.map((f) => f.obj[f.key]);
  const translated = await translateBatch(texts, targetLang);
  fields.forEach((f, i) => {
    if (translated[i]) f.obj[f.key] = translated[i];
  });
  return clone;
}

module.exports = { translateValue, TRANSLATABLE_KEYS: Object.keys(COLLECTORS) };
