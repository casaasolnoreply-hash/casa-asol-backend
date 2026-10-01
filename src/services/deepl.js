// Traducción automática vía DeepL. Requiere DEEPL_API_KEY en el .env
// (las claves del plan gratuito terminan en ":fx", lo que determina el host).
// Si no hay clave configurada, translateBatch no hace nada: devuelve los
// textos originales tal cual, para que el resto del sistema no se rompa.

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_URL = DEEPL_API_KEY?.trim().endsWith(":fx")
  ? "https://api-free.deepl.com/v2/translate"
  : "https://api.deepl.com/v2/translate";

async function translateBatch(texts, targetLang) {
  if (!DEEPL_API_KEY || !texts.length) return texts;

  const res = await fetch(DEEPL_URL, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "CasaASOL/1.0",
    },
    body: JSON.stringify({
      text: texts,
      target_lang: targetLang, // "EN" o "DE"
      source_lang: "ES",
      preserve_formatting: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`DeepL respondió ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.translations.map((t) => t.text);
}

module.exports = { translateBatch, isConfigured: !!DEEPL_API_KEY };
