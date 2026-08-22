// ─────────────────────────────────────────────────────────────
//  CASA ASOL — Robot de correo (Google Apps Script)
//
//  Esto NO se ejecuta con Node — es el código que se pega en un
//  proyecto nuevo de https://script.google.com y se publica como
//  "Web app". El backend (backend/src/services/email.js) le hace
//  peticiones HTTP a la URL que te da Google al publicarlo.
//
//  Pasos para desplegar:
//   1. https://script.google.com → Proyecto nuevo (con la cuenta de
//      Gmail que va a enviar los correos de Casa ASOL).
//   2. Borra el contenido de Code.gs y pega TODO este archivo
//      (el AUTH_TOKEN de abajo ya viene listo, coincide con backend/.env).
//   3. Implementar → Nueva implementación → tipo "Aplicación web".
//        - Ejecutar como: Yo (tu cuenta)
//        - Quién tiene acceso: Cualquier usuario
//      (si no pones "Cualquier usuario", el backend no va a poder
//      llamarlo porque no inicia sesión con una cuenta de Google)
//   5. Autoriza los permisos que pida Google.
//   6. Copia la URL que termina en /exec y pásamela.
// ─────────────────────────────────────────────────────────────

const AUTH_TOKEN  = "926fade0-7a09-4caa-82dd-0ea31ff82c0d"; // debe ser IGUAL a GOOGLE_APPS_SCRIPT_TOKEN en backend/.env
const SENDER_NAME = "Casa ASOL";

function doGet(e) {
  return jsonResponse({ service: "casa-asol-email", status: "ok" });
}

function doPost(e) {
  try {
    const token = e.parameter.token;
    if (token !== AUTH_TOKEN) {
      return jsonResponse({ success: false, message: "Token inválido" });
    }

    const data = JSON.parse(e.postData.contents);
    const to = data.to;
    const subject = data.subject;
    const html = data.html;
    const text = data.text;

    if (!to || !subject || (!html && !text)) {
      return jsonResponse({ success: false, message: "Faltan campos: to, subject y html o text" });
    }

    const options = { name: SENDER_NAME };
    if (html) options.htmlBody = html;

    MailApp.sendEmail(to, subject, text || "", options);

    return jsonResponse({
      success: true,
      timestamp: new Date().toISOString(),
      data: { messageId: "gas-" + new Date().getTime() },
    });
  } catch (err) {
    return jsonResponse({ success: false, message: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
