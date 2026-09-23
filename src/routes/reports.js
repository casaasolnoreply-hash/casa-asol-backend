const router = require("express").Router();
const auth   = require("../middleware/auth");
const Report = require("../models/Report");
const Role   = require("../models/Role");
const { getReportFields, REPORT_FIELDS, flattenNarrativeFields } = require("../config/reportFields");

// Quién puede ver TODOS los informes de todos los roles y
// aceptarlos/devolverlos — admin/desarrollador por el acceso total
// del sistema, y las dos directoras porque son quienes reciben y
// revisan los informes que envía cada área operativa.
const canSeeAll = (role) => ["admin", "desarrollador", "directora_tecnica", "directora_programatica"].includes(role);

// Editable en borrador (todavía no se manda) o devuelto (se manda a
// corregir). Bloqueado mientras está en revisión (enviado) o ya
// aceptado (final).
const isEditable = (report) => report.status === "borrador" || report.status === "devuelto";

// Un borrador se puede guardar a medio llenar (el periodo se define
// en el paso 1 del formulario, pero guardar antes de eso no debe
// fallar) — por eso periodType/periodStart/periodEnd son opcionales
// aquí; si vienen, se validan. La completitud real solo se exige al
// enviar el informe (ver POST /:id/submit).
const validatePayload = (role, { periodType, periodStart, periodEnd, stats, narrative }) => {
  const config = getReportFields(role);
  if (!config) return { error: `El rol "${role}" todavía no tiene un formulario de informes configurado` };

  if (periodType && !config.periodTypes.includes(periodType)) {
    return { error: "Periodo inválido para este rol" };
  }
  if (periodStart || periodEnd) {
    if (!periodStart || !periodEnd || isNaN(Date.parse(periodStart)) || isNaN(Date.parse(periodEnd))) {
      return { error: "Si defines una fecha del periodo, define ambas y que sean válidas" };
    }
    if (new Date(periodStart) > new Date(periodEnd)) {
      return { error: "period_start no puede ser después de period_end" };
    }
  }

  const statKeys    = new Set(config.statFields.map((f) => f.key));
  const monthlyKeys = new Set((config.monthlyFields || []).map((f) => f.key));
  const listKeys    = new Set((config.listFields || []).map((f) => f.key));

  for (const key of Object.keys(stats || {})) {
    const value = stats[key];

    if (statKeys.has(key)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { error: `El campo "${key}" debe ser un número` };
      }
      continue;
    }

    if (monthlyKeys.has(key)) {
      // Serie por periodo con granularidad elegida por quien llena el
      // informe: { granularity: "diario"|"semanal"|"mensual", rows: [{ label, value }] }
      const GRANULARITIES = ["diario", "semanal", "mensual"];
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { error: `El campo "${key}" debe tener granularidad y filas` };
      }
      if (!GRANULARITIES.includes(value.granularity)) {
        return { error: `Granularidad inválida en "${key}"` };
      }
      if (!Array.isArray(value.rows)) return { error: `El campo "${key}" debe traer una lista de filas` };
      for (const row of value.rows) {
        if (!row || typeof row.label !== "string" || !row.label.trim() || typeof row.value !== "number" || !Number.isFinite(row.value)) {
          return { error: `Cada fila de "${key}" necesita una etiqueta y un número` };
        }
      }
      continue;
    }

    if (listKeys.has(key)) {
      if (!Array.isArray(value)) return { error: `El campo "${key}" debe ser una lista` };
      for (const item of value) {
        if (typeof item !== "string" || !item.trim()) return { error: `Cada elemento de "${key}" debe ser texto` };
      }
      continue;
    }

    return { error: `Campo numérico desconocido: ${key}` };
  }

  const narrativeKeys = new Set(flattenNarrativeFields(config.narrativeFields).map((f) => f.key));
  for (const key of Object.keys(narrative || {})) {
    if (!narrativeKeys.has(key)) return { error: `Sección de texto desconocida: ${key}` };
    if (typeof narrative[key] !== "string") return { error: `La sección "${key}" debe ser texto` };
  }

  return null;
};

// GET /api/reports/available-roles — qué roles tienen informes
// configurados (para que admin/desarrollador puedan elegir de cuál
// rol ver/crear informes, ya que ellos no tienen uno propio).
router.get("/available-roles", auth, async (req, res) => {
  try {
    const roles = await Role.findAll();
    const configured = Object.keys(REPORT_FIELDS);
    res.json(
      roles
        .filter((r) => configured.includes(r.name))
        .map((r) => ({ name: r.name, label: r.label }))
    );
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/reports/config/:role — campos del formulario para ese rol
router.get("/config/:role", auth, (req, res) => {
  const config = getReportFields(req.params.role);
  if (!config) return res.status(404).json({ error: "Este rol no tiene informes configurados todavía" });
  res.json(config);
});

// GET /api/reports — admin/desarrollador ven todo; el resto solo lo suyo
router.get("/", auth, async (req, res) => {
  try {
    const filters = canSeeAll(req.admin.role)
      ? { role: req.query.role || undefined }
      : { role: req.admin.role, authorId: req.admin.id };
    res.json(await Report.findAll(filters));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/reports — crea un borrador para el propio rol del autor
// (admin/desarrollador pueden pasar "role" explícito para llenar a nombre de alguien)
router.post("/", auth, async (req, res) => {
  try {
    const role = canSeeAll(req.admin.role) && req.body.role ? req.body.role : req.admin.role;
    const err = validatePayload(role, req.body);
    if (err) return res.status(400).json(err);

    const created = await Report.create({
      role, authorId: req.admin.id,
      periodType: req.body.periodType, periodStart: req.body.periodStart, periodEnd: req.body.periodEnd,
      stats: req.body.stats, narrative: req.body.narrative,
      codePrefix: getReportFields(role).codePrefix,
    });
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PUT /api/reports/:id — el autor o admin/desarrollador
router.put("/:id", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const existing = await Report.findById(id);
    if (!existing) return res.status(404).json({ error: "Informe no encontrado" });
    if (existing.author_id !== req.admin.id && !canSeeAll(req.admin.role)) {
      return res.status(403).json({ error: "No puedes editar el informe de otra persona" });
    }
    if (!isEditable(existing)) {
      return res.status(409).json({ error: `No se puede editar un informe en estado "${existing.status}"` });
    }

    const err = validatePayload(existing.role, {
      periodType: req.body.periodType || existing.period_type,
      periodStart: req.body.periodStart || existing.period_start,
      periodEnd: req.body.periodEnd || existing.period_end,
      stats: req.body.stats,
      narrative: req.body.narrative,
    });
    if (err) return res.status(400).json(err);

    res.json(await Report.update(id, req.body));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/reports/:id/submit — marca el informe como enviado
router.post("/:id/submit", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const existing = await Report.findById(id);
    if (!existing) return res.status(404).json({ error: "Informe no encontrado" });
    if (existing.author_id !== req.admin.id && !canSeeAll(req.admin.role)) {
      return res.status(403).json({ error: "No puedes enviar el informe de otra persona" });
    }
    if (!isEditable(existing)) {
      return res.status(409).json({ error: `No se puede enviar un informe en estado "${existing.status}"` });
    }
    if (!existing.period_type || !existing.period_start || !existing.period_end) {
      return res.status(400).json({ error: "Completa el tipo de periodo y las fechas antes de enviar el informe" });
    }

    res.json(await Report.submit(id));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/reports/:id/accept — admin/desarrollador aceptan un
// informe enviado; queda bloqueado de forma permanente.
router.post("/:id/accept", auth, async (req, res) => {
  try {
    if (!canSeeAll(req.admin.role)) return res.status(403).json({ error: "No tienes permiso para esta acción" });
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const existing = await Report.findById(id);
    if (!existing) return res.status(404).json({ error: "Informe no encontrado" });
    if (existing.status !== "enviado") {
      return res.status(409).json({ error: `Solo se puede aceptar un informe "enviado" (está en "${existing.status}")` });
    }

    res.json(await Report.accept(id, req.admin.id));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/reports/:id/return — admin/desarrollador devuelven un
// informe enviado para que el autor lo corrija y lo reenvíe.
router.post("/:id/return", auth, async (req, res) => {
  try {
    if (!canSeeAll(req.admin.role)) return res.status(403).json({ error: "No tienes permiso para esta acción" });
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const existing = await Report.findById(id);
    if (!existing) return res.status(404).json({ error: "Informe no encontrado" });
    if (existing.status !== "enviado") {
      return res.status(409).json({ error: `Solo se puede devolver un informe "enviado" (está en "${existing.status}")` });
    }

    const comment = req.body?.comment;
    if (comment !== undefined && typeof comment !== "string") {
      return res.status(400).json({ error: "El comentario debe ser texto" });
    }

    res.json(await Report.returnForCorrection(id, req.admin.id, comment));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// DELETE /api/reports/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const existing = await Report.findById(id);
    if (!existing) return res.status(404).json({ error: "Informe no encontrado" });
    if (existing.author_id !== req.admin.id && !canSeeAll(req.admin.role)) {
      return res.status(403).json({ error: "No puedes eliminar el informe de otra persona" });
    }
    if (existing.status === "aceptado") {
      return res.status(409).json({ error: "Un informe aceptado no se puede eliminar" });
    }

    await Report.remove(id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;
