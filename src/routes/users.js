const router = require("express").Router();
const auth   = require("../middleware/auth");
const { requireRole } = require("../middleware/authorize");
const User        = require("../models/User");
const Role        = require("../models/Role");
const UserRequest = require("../models/UserRequest");
const { suggestUsername, generateTempPassword } = require("../utils/credentials");
const { sendEmail, credentialsEmail } = require("../services/email");

// Gestión de usuarios: admin y desarrollador. Solo desarrollador puede
// otorgar o quitar el rol "desarrollador" (acceso total).
const manageUsers = requireRole("admin", "desarrollador");

const assertAssignableRole = async (roleName, actorRole) => {
  const role = await Role.findByName(roleName);
  if (!role) return "Rol inválido";
  if (roleName === "desarrollador" && actorRole !== "desarrollador") {
    return "Solo un desarrollador puede asignar el rol de desarrollador";
  }
  return null;
};

// GET /api/users
router.get("/", auth, manageUsers, async (_req, res) => {
  try {
    res.json(await User.findAll());
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ── Solicitudes de acceso ──────────────────────────────────

// GET /api/users/requests — solicitudes pendientes
router.get("/requests", auth, manageUsers, async (_req, res) => {
  try {
    res.json(await UserRequest.findPending());
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/users/requests/:id/approve
// body opcional: { username, password, role }. Si no se envían,
// se generan automáticamente (se devuelven en la respuesta para
// que el admin las comparta con la persona).
router.post("/requests/:id/approve", auth, manageUsers, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const request = await UserRequest.findById(id);
    if (!request) return res.status(404).json({ error: "Solicitud no encontrada" });
    if (request.status !== "pending") return res.status(409).json({ error: "Esta solicitud ya fue revisada" });

    const role = req.body?.role || request.requested_role;
    const roleError = await assertAssignableRole(role, req.admin.role);
    if (roleError) return res.status(400).json({ error: roleError });

    const existingUser = await User.findByEmail(request.email);
    if (existingUser) return res.status(409).json({ error: "Ya existe una cuenta con este correo" });

    let username = req.body?.username?.trim();
    if (username) {
      if (await User.usernameTaken(username)) {
        return res.status(409).json({ error: "El nombre de usuario ya está en uso" });
      }
    } else {
      username = suggestUsername(request.name, request.email);
      let candidate = username, suffix = 1;
      while (await User.usernameTaken(candidate)) candidate = `${username}${++suffix}`;
      username = candidate;
    }

    const passwordProvided = !!req.body?.password;
    const password = req.body?.password || generateTempPassword();
    if (password.length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });

    const created = await User.create({ username, email: request.email, password, role, mustChangePassword: true });
    if (request.google_sub) await User.linkGoogle(created.id, request.google_sub);
    if (request.google_photo) await User.updatePhoto(created.id, request.google_photo);

    await UserRequest.markReviewed(id, "approved", req.admin.id);

    // El correo puede tardar (arranque en frío de Apps Script) — no hacemos
    // esperar al admin por eso. La contraseña generada ya va en la
    // respuesta como respaldo confiable de todas formas.
    const loginUrl = (process.env.ALLOWED_ORIGINS || "").split(",")[0]?.trim();
    const { subject, html, text } = credentialsEmail({ name: request.name, username, password, loginUrl: loginUrl ? `${loginUrl}/login` : null });
    sendEmail({ to: request.email, subject, html, text }).catch(() => {});

    res.status(201).json({
      ok: true,
      user: { id: created.id, username, role },
      generatedPassword: passwordProvided ? null : password,
    });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/users/requests/:id/reject
router.post("/requests/:id/reject", auth, manageUsers, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const request = await UserRequest.findById(id);
    if (!request) return res.status(404).json({ error: "Solicitud no encontrada" });
    if (request.status !== "pending") return res.status(409).json({ error: "Esta solicitud ya fue revisada" });

    await UserRequest.markReviewed(id, "rejected", req.admin.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/users
router.post("/", auth, manageUsers, async (req, res) => {
  try {
    const { username, password, email, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: "Usuario, contraseña y rol requeridos" });
    }
    if (typeof username !== "string" || username.length < 3 || username.length > 50) {
      return res.status(400).json({ error: "El usuario debe tener entre 3 y 50 caracteres" });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    }

    const roleError = await assertAssignableRole(role, req.admin.role);
    if (roleError) return res.status(400).json({ error: roleError });

    if (await User.usernameTaken(username.trim())) {
      return res.status(409).json({ error: "El nombre de usuario ya está en uso" });
    }

    const created = await User.create({ username, email, password, role, mustChangePassword: true });
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PUT /api/users/:id
router.put("/:id", auth, manageUsers, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    if (req.admin.id === id) {
      const { role, active } = req.body;
      if (role !== undefined && role !== req.admin.role) {
        return res.status(400).json({ error: "No puedes cambiar tu propio rol" });
      }
      if (active !== undefined && !active) {
        return res.status(400).json({ error: "No puedes desactivar tu propia cuenta" });
      }
    }

    const target = await User.findById(id);
    if (!target) return res.status(404).json({ error: "Usuario no encontrado" });

    const { email, role, active, password } = req.body;

    if (password !== undefined) {
      if (typeof password !== "string" || password.length < 8) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
      }
      // La puso un admin, no el propio usuario: debe cambiarla al entrar.
      await User.updatePassword(id, password, true);
    }
    if (role !== undefined) {
      const roleError = await assertAssignableRole(role, req.admin.role);
      if (roleError) return res.status(400).json({ error: roleError });
      if (target.role === "desarrollador" && role !== "desarrollador" && req.admin.role !== "desarrollador") {
        return res.status(400).json({ error: "Solo un desarrollador puede cambiar el rol de otro desarrollador" });
      }
      await User.updateRole(id, role);
    }
    if (email !== undefined) {
      await User.updateEmail(id, email);
    }
    if (active !== undefined) {
      await User.updateActive(id, active);
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// DELETE /api/users/:id
router.delete("/:id", auth, manageUsers, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    if (req.admin.id === id) {
      return res.status(400).json({ error: "No puedes eliminar tu propia cuenta" });
    }

    const target = await User.findById(id);
    if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
    if (target.role === "desarrollador" && req.admin.role !== "desarrollador") {
      return res.status(400).json({ error: "Solo un desarrollador puede eliminar a otro desarrollador" });
    }

    await User.remove(id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
