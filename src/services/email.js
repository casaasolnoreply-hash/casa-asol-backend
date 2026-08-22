const axios = require("axios");

// ── Envío de correo vía el Apps Script de Google (ver
//    backend/scripts/apps-script-mailer.gs para el código desplegado
//    y las instrucciones). No lanza si falla: los llamadores deciden
//    qué hacer cuando isConfigured es false o sendEmail no tiene éxito
//    (ej. mostrar la contraseña en el panel como respaldo).
const URL   = process.env.GOOGLE_APPS_SCRIPT_URL;
const TOKEN = process.env.GOOGLE_APPS_SCRIPT_TOKEN;
const SENDER_NAME = process.env.MAIL_SENDER_NAME || "Casa ASOL";

const isConfigured = !!(URL && TOKEN && URL.includes("script.google.com") && URL.includes("/exec"));

if (!isConfigured) {
  console.warn("[email] GOOGLE_APPS_SCRIPT_URL / GOOGLE_APPS_SCRIPT_TOKEN no configurados — el envío de correo está desactivado.");
}

const sendEmail = async ({ to, subject, html, text }) => {
  if (!isConfigured) {
    return { success: false, reason: "not_configured" };
  }
  try {
    // Apps Script puede tardar bastante en responder (arranque en frío,
    // envío real por Gmail) aunque el correo sí salga. Un timeout corto
    // aquí da falsos negativos — es mejor esperar más que reportar un
    // fallo cuando en realidad sí se mandó.
    const { data } = await axios.post(
      `${URL}?token=${encodeURIComponent(TOKEN)}`,
      { to, subject, html, text },
      { headers: { "Content-Type": "application/json" }, timeout: 45000 }
    );
    if (!data?.success) {
      console.error(`[email] Apps Script respondió sin éxito al enviar a ${to}:`, data?.message);
      return { success: false, reason: data?.message || "unknown" };
    }
    return { success: true };
  } catch (err) {
    console.error(`[email] Error al enviar correo a ${to}:`, err.message);
    return { success: false, reason: err.message };
  }
};

const credentialsEmail = ({ name, username, password, loginUrl }) => ({
  subject: `Tu acceso al sistema de ${SENDER_NAME}`,
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a2e;">
      <h2 style="color: #1e88e5;">Bienvenido/a a ${SENDER_NAME}</h2>
      <p>Hola ${name || ""},</p>
      <p>Tu solicitud de acceso fue aprobada. Estas son tus credenciales para entrar al panel:</p>
      <div style="background:#f4f6f8; border-radius:8px; padding:16px 20px; margin:20px 0;">
        <p style="margin:0 0 8px;"><strong>Usuario:</strong> ${username}</p>
        <p style="margin:0;"><strong>Contraseña temporal:</strong> <code style="background:#e5e7eb; padding:2px 8px; border-radius:4px;">${password}</code></p>
      </div>
      <p>Al iniciar sesión por primera vez se te va a pedir que la cambies por una contraseña propia.</p>
      ${loginUrl ? `<p><a href="${loginUrl}" style="color:#1e88e5;">Entrar al sistema →</a></p>` : ""}
      <p style="color:#9ca3af; font-size:12px; margin-top:30px;">Si no solicitaste esta cuenta, ignora este correo.</p>
    </div>
  `,
  text: `Bienvenido/a a ${SENDER_NAME}.\n\nUsuario: ${username}\nContraseña temporal: ${password}\n\nAl iniciar sesión por primera vez se te va a pedir que la cambies.${loginUrl ? `\n\nEntrar: ${loginUrl}` : ""}`,
});

const passwordResetEmail = ({ username, password, loginUrl }) => ({
  subject: `Recuperación de acceso — ${SENDER_NAME}`,
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a2e;">
      <h2 style="color: #1e88e5;">Recuperación de acceso</h2>
      <p>Recibimos una solicitud para recuperar el acceso a tu cuenta de ${SENDER_NAME}. Estos son tus datos actualizados:</p>
      <div style="background:#f4f6f8; border-radius:8px; padding:16px 20px; margin:20px 0;">
        <p style="margin:0 0 8px;"><strong>Usuario:</strong> ${username}</p>
        <p style="margin:0;"><strong>Contraseña temporal:</strong> <code style="background:#e5e7eb; padding:2px 8px; border-radius:4px;">${password}</code></p>
      </div>
      <p>Al iniciar sesión se te va a pedir que la cambies por una contraseña propia.</p>
      ${loginUrl ? `<p><a href="${loginUrl}" style="color:#1e88e5;">Entrar al sistema →</a></p>` : ""}
      <p style="color:#9ca3af; font-size:12px; margin-top:30px;">Si no fuiste tú quien lo solicitó, ignora este correo — tu contraseña anterior dejó de funcionar, así que tu cuenta sigue protegida.</p>
    </div>
  `,
  text: `Recuperación de acceso — ${SENDER_NAME}.\n\nUsuario: ${username}\nContraseña temporal: ${password}\n\nAl iniciar sesión se te va a pedir que la cambies.${loginUrl ? `\n\nEntrar: ${loginUrl}` : ""}`,
});

module.exports = { isConfigured, sendEmail, credentialsEmail, passwordResetEmail };
