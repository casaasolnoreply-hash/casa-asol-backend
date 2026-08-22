const router    = require("express").Router();
const jwt       = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const auth      = require("../middleware/auth");
const { PRIVATE_KEY } = require("../config/keys");
const User      = require("../models/User");
const Role      = require("../models/Role");
const UserRequest = require("../models/UserRequest");
const { sendEmail, passwordResetEmail } = require("../services/email");
const { generateTempPassword } = require("../utils/credentials");

let googleClient = null;
const getGoogleClient = () => {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  if (!googleClient) {
    const { OAuth2Client } = require("google-auth-library");
    googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }
  return googleClient;
};

const signToken = (user) =>
  jwt.sign(
    { id: user.id, user: user.username, role: user.role, mustChangePassword: !!user.must_change_password },
    PRIVATE_KEY,
    { algorithm: "RS256", expiresIn: "8h" }
  );

// Máximo 10 intentos por IP cada 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Intenta de nuevo en 15 minutos." },
  skipSuccessfulRequests: true,
});

// Máximo 5 solicitudes de acceso por IP cada hora (evita spam del formulario público)
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Intenta de nuevo más tarde." },
});

// Máximo 5 solicitudes de recuperación por IP cada hora
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Intenta de nuevo más tarde." },
});

// POST /api/auth/login
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { user, pass } = req.body;

    if (!user || !pass || typeof user !== "string" || typeof pass !== "string") {
      return res.status(400).json({ error: "Usuario y contraseña requeridos" });
    }
    if (user.length > 100 || pass.length > 200) {
      return res.status(400).json({ error: "Datos inválidos" });
    }

    const dbUser = await User.findByUsername(user.trim());
    const passOk = await User.verifyPassword(pass, dbUser?.active ? dbUser.password : null);

    if (!dbUser || !dbUser.active || !passOk) {
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }

    await User.updateLastLogin(dbUser.id);
    const role = await Role.findByName(dbUser.role);

    res.json({
      token:              signToken(dbUser),
      user:               dbUser.username,
      role:               dbUser.role,
      photoUrl:           dbUser.photo_url || null,
      mustChangePassword: !!dbUser.must_change_password,
      permissions:        role?.permissions || {},
    });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/auth/google — login con Google (requiere GOOGLE_CLIENT_ID)
// Si el correo de Google ya tiene cuenta activa, entra directo. Si no,
// crea una solicitud de acceso pendiente de aprobación (misma cola que
// el formulario "Solicitar acceso").
router.post("/google", async (req, res) => {
  const client = getGoogleClient();
  if (!client) {
    return res.status(501).json({ error: "El inicio de sesión con Google no está configurado todavía." });
  }

  try {
    const { idToken, requestedRole, phone, message } = req.body;
    if (!idToken || typeof idToken !== "string") {
      return res.status(400).json({ error: "idToken requerido" });
    }

    const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.email_verified) {
      return res.status(401).json({ error: "El correo de Google no está verificado" });
    }

    const { sub: googleSub, email, name, picture } = payload;

    let dbUser = await User.findByGoogleSub(googleSub);
    if (!dbUser) {
      const byEmail = await User.findByEmail(email);
      if (byEmail && byEmail.active) {
        await User.linkGoogle(byEmail.id, googleSub);
        dbUser = { ...byEmail, photo_url: byEmail.photo_url };
      }
    }

    if (dbUser) {
      if (!dbUser.active) return res.status(401).json({ error: "Cuenta desactivada" });
      await User.updateLastLogin(dbUser.id);
      const role = await Role.findByName(dbUser.role);
      return res.json({
        token:              signToken(dbUser),
        user:               dbUser.username,
        role:               dbUser.role,
        photoUrl:           dbUser.photo_url || null,
        mustChangePassword: !!dbUser.must_change_password,
        permissions:        role?.permissions || {},
      });
    }

    // No existe cuenta con este correo/Google: pedir rol si aún no lo mandaron,
    // o crear la solicitud si ya lo eligieron.
    if (!requestedRole) {
      return res.json({ status: "needs_role", name, email, picture });
    }

    const role = await Role.findByName(requestedRole);
    if (!role || !role.self_requestable) {
      return res.status(400).json({ error: "Rol solicitado inválido" });
    }

    const already = await UserRequest.findPendingByEmail(email);
    if (already) {
      return res.status(409).json({ error: "Ya existe una solicitud pendiente para este correo" });
    }

    await UserRequest.create({
      name: name || email, email, phone, requestedRole, message,
      source: "google", googleSub, googlePhoto: picture,
    });

    res.status(202).json({ status: "pending", message: "Tu solicitud fue enviada y está pendiente de aprobación." });
  } catch (err) {
    res.status(401).json({ error: "No se pudo verificar la sesión de Google" });
  }
});

// POST /api/auth/request-access — solicitud de cuenta (público, sin login)
router.post("/request-access", requestLimiter, async (req, res) => {
  try {
    const { name, email, phone, requestedRole, message } = req.body;

    if (!name || !email || !requestedRole) {
      return res.status(400).json({ error: "Nombre, correo y rol son obligatorios" });
    }
    if (typeof name !== "string" || typeof email !== "string" || name.length > 100 || email.length > 150) {
      return res.status(400).json({ error: "Datos inválidos" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Correo inválido" });
    }

    const role = await Role.findByName(requestedRole);
    if (!role || !role.self_requestable) {
      return res.status(400).json({ error: "Rol solicitado inválido" });
    }

    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: "Ya existe una cuenta con este correo" });
    }
    const pending = await UserRequest.findPendingByEmail(email);
    if (pending) {
      return res.status(409).json({ error: "Ya existe una solicitud pendiente para este correo" });
    }

    await UserRequest.create({ name, email, phone, requestedRole, message, source: "system" });
    res.status(201).json({ ok: true, message: "Tu solicitud fue enviada. Un administrador la revisará." });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/auth/forgot-password — recuperación por correo (público, sin login)
// Genera una contraseña temporal nueva y la manda al correo registrado.
// Siempre responde el mismo mensaje exista o no la cuenta, para no
// revelar qué correos tienen cuenta en el sistema.
const FORGOT_GENERIC_MESSAGE = "Si existe una cuenta activa con ese correo, te enviamos instrucciones para recuperar el acceso.";

router.post("/forgot-password", forgotLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Correo inválido" });
    }

    const user = await User.findByEmail(email.trim());
    if (user && user.active && user.email) {
      const tempPassword = generateTempPassword();
      const loginUrl = (process.env.ALLOWED_ORIGINS || "").split(",")[0]?.trim();
      const { subject, html, text } = passwordResetEmail({
        username: user.username, password: tempPassword,
        loginUrl: loginUrl ? `${loginUrl}/login` : null,
      });

      // Solo se invalida la contraseña anterior si el correo con la
      // nueva SÍ se pudo mandar — si falla, no lo dejamos sin acceso.
      const emailResult = await sendEmail({ to: user.email, subject, html, text });
      if (emailResult.success) {
        await User.updatePassword(user.id, tempPassword, true);
      } else {
        console.error(`[forgot-password] No se pudo enviar correo a ${user.email}, contraseña NO fue reseteada:`, emailResult.reason);
      }
    }

    res.json({ ok: true, message: FORGOT_GENERIC_MESSAGE });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/auth/me — devuelve info actualizada desde la BD
router.get("/me", auth, async (req, res) => {
  try {
    const u = await User.findById(req.admin.id);
    if (!u || !u.active) return res.status(401).json({ error: "Usuario no encontrado" });
    const role = await Role.findByName(u.role);
    res.json({
      user: u.username, role: u.role, email: u.email, photoUrl: u.photo_url || null,
      mustChangePassword: !!u.must_change_password,
      permissions: role?.permissions || {},
    });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PUT /api/auth/profile — el usuario actualiza su propio perfil
router.put("/profile", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword, photoUrl } = req.body;
    const id = req.admin.id;

    // Cambio de contraseña
    if (newPassword !== undefined) {
      if (typeof newPassword !== "string" || newPassword.length < 8) {
        return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres" });
      }

      const hash = await User.getPasswordHash(id);
      if (!hash) return res.status(404).json({ error: "Usuario no encontrado" });

      const ok = await User.verifyPassword(currentPassword || "", hash);
      if (!ok) return res.status(401).json({ error: "La contraseña actual es incorrecta" });

      // Self-service: el usuario ya demostró que conoce la contraseña
      // actual, así que esta nueva es privada suya. Limpia el flag.
      await User.updatePassword(id, newPassword, false);
    }

    // Cambio de foto
    if (photoUrl !== undefined) {
      await User.updatePhoto(id, photoUrl);
    }

    // El token viejo puede traer mustChangePassword=true grabado; si
    // cambió la contraseña, se reemite uno nuevo para que el bloqueo
    // se levante sin tener que volver a iniciar sesión.
    let freshToken;
    if (newPassword !== undefined) {
      const updated = await User.findById(id);
      freshToken = signToken(updated);
    }

    res.json({ ok: true, ...(freshToken && { token: freshToken }) });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
