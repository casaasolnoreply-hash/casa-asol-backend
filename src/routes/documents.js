const router     = require("express").Router();
const multer     = require("multer");
const mammoth    = require("mammoth");
const auth       = require("../middleware/auth");
const cloudinary = require("../config/cloudinary");
const Report         = require("../models/Report");
const ReportDocument = require("../models/ReportDocument");
const { getScope, mergeScope, isDeveloper } = require("../middleware/authorize");

// Mismo criterio que routes/reports.js: "verInformes" también da
// permiso de EDITAR el documento de otro rol (no solo verlo), y
// "aceptarInformes" es quien puede calificar/comentar (el mismo permiso
// que ya controla aceptar/devolver el informe original).
const canSeeRole = (scope, role) => scope === "all" || (Array.isArray(scope) && scope.includes(role));

const canAccessReport = async (req, report) =>
  report.author_id === req.admin.id || canSeeRole(await getScope(req, "verInformes"), report.role);

const canGradeReport = async (req, report) =>
  canSeeRole(await getScope(req, "aceptarInformes"), report.role);

const EDITABLE_STATUSES = ["borrador", "devuelto_a_correccion"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    cb(ok ? null : new Error("Solo se permiten archivos .docx"), ok);
  },
});

// GET /api/documents — listado (punto 6: buscar/filtrar documentos
// trabajados). Mismo alcance que GET /api/reports.
router.get("/", auth, async (req, res) => {
  try {
    // Igual que en reports.js: alguien con solo "aceptarInformes" (sin
    // "verInformes") sobre un rol también necesita verlo en la lista
    // para poder aceptar/devolver esos documentos.
    const scope = mergeScope(
      await getScope(req, "verInformes"),
      await getScope(req, "verInformesPorUsuario"),
      await getScope(req, "aceptarInformes"),
    );
    let filters;
    if (scope === "all") {
      filters = { role: req.query.role || undefined };
    } else if (Array.isArray(scope) && scope.length) {
      const roles = [...new Set([req.admin.role, ...scope])];
      filters = req.query.role && roles.includes(req.query.role)
        ? { role: req.query.role }
        : { roleIn: roles };
    } else {
      filters = { role: req.admin.role, authorId: req.admin.id };
    }
    if (req.query.status) filters.status = req.query.status;
    if (req.query.authorId) filters.authorId = parseInt(req.query.authorId, 10);
    if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom;
    if (req.query.dateTo) filters.dateTo = req.query.dateTo;
    const list = await ReportDocument.findAll(filters);
    // "desarrollador" nunca aparece para nadie más que otra cuenta
    // desarrollador — igual que en GET /api/users, /api/roles y
    // /api/reports.
    res.json(isDeveloper(req) ? list : list.filter((d) => d.role !== "desarrollador"));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/documents/by-report/:reportId
router.get("/by-report/:reportId", auth, async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId, 10);
    if (isNaN(reportId)) return res.status(400).json({ error: "ID inválido" });

    const report = await Report.findById(reportId);
    if (!report) return res.status(404).json({ error: "Informe no encontrado" });
    if (!(await canAccessReport(req, report))) return res.status(403).json({ error: "No tienes permiso para esta acción" });

    const doc = await ReportDocument.findByReportId(reportId);
    if (!doc) return res.status(404).json({ error: "Este informe todavía no tiene un documento" });
    res.json(doc);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/documents — { reportId }. Crea el documento si no existe;
// si ya existe, lo devuelve (idempotente, para que "Abrir en editor"
// siempre funcione a la primera).
router.post("/", auth, async (req, res) => {
  try {
    const reportId = parseInt(req.body.reportId, 10);
    if (isNaN(reportId)) return res.status(400).json({ error: "reportId es obligatorio" });

    const report = await Report.findById(reportId);
    if (!report) return res.status(404).json({ error: "Informe no encontrado" });
    if (!(await canAccessReport(req, report))) return res.status(403).json({ error: "No tienes permiso para esta acción" });

    const existing = await ReportDocument.findByReportId(reportId);
    if (existing) return res.json(existing);

    res.status(201).json(await ReportDocument.create(reportId, report.author_id));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/documents/:id
router.get("/:id", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    const report = { role: doc.role, author_id: doc.author_id };
    if (!(await canAccessReport(req, report)) && !(await canGradeReport(req, report))) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }
    res.json(doc);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PATCH /api/documents/:id/autosave — { content }
router.patch("/:id/autosave", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    if (!(await canAccessReport(req, { role: doc.role, author_id: doc.author_id }))) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }
    if (!EDITABLE_STATUSES.includes(doc.status)) {
      return res.status(409).json({ error: `No se puede editar un documento en estado "${doc.status}"` });
    }
    if (typeof req.body.content !== "object" || req.body.content === null) {
      return res.status(400).json({ error: "content es obligatorio" });
    }

    res.json(await ReportDocument.updateContent(id, req.body.content));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/documents/:id/versions — { content, label? } (guardado
// manual; también se usa para persistir el resultado de un .docx subido)
router.post("/:id/versions", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    if (!(await canAccessReport(req, { role: doc.role, author_id: doc.author_id }))) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }
    if (!EDITABLE_STATUSES.includes(doc.status)) {
      return res.status(409).json({ error: `No se puede editar un documento en estado "${doc.status}"` });
    }
    if (typeof req.body.content !== "object" || req.body.content === null) {
      return res.status(400).json({ error: "content es obligatorio" });
    }
    if (req.body.label !== undefined && typeof req.body.label !== "string") {
      return res.status(400).json({ error: "label debe ser texto" });
    }

    res.json(await ReportDocument.saveVersion(id, req.body.content, req.body.label, req.admin.id));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/documents/:id/versions
router.get("/:id/versions", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    const report = { role: doc.role, author_id: doc.author_id };
    if (!(await canAccessReport(req, report)) && !(await canGradeReport(req, report))) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }
    res.json(await ReportDocument.listVersions(id));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/documents/:id/versions/:versionId/restore
router.post("/:id/versions/:versionId/restore", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const versionId = parseInt(req.params.versionId, 10);
    if (isNaN(id) || isNaN(versionId)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    if (!(await canAccessReport(req, { role: doc.role, author_id: doc.author_id }))) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }
    if (!EDITABLE_STATUSES.includes(doc.status)) {
      return res.status(409).json({ error: `No se puede editar un documento en estado "${doc.status}"` });
    }

    const updated = await ReportDocument.restoreVersion(id, versionId, req.admin.id);
    if (!updated) return res.status(404).json({ error: "Versión no encontrada" });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/documents/:id/submit — borrador/devuelto -> enviado
router.post("/:id/submit", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    if (!(await canAccessReport(req, { role: doc.role, author_id: doc.author_id }))) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }
    if (!EDITABLE_STATUSES.includes(doc.status)) {
      return res.status(409).json({ error: `No se puede enviar un documento en estado "${doc.status}"` });
    }

    const updated = await ReportDocument.submit(id);

    // El informe (reports.status) es lo que muestra "Mis informes" y lo
    // que habilita el panel de Aceptar/Devolver — quien trabaja su
    // informe como documento de Word en vez del asistente de narrativa
    // nunca llena periodo/fechas, así que el POST /api/reports/:id/submit
    // normal (que sí los exige) nunca aplicaría aquí. Se envía el informe
    // directamente a nivel de modelo, sin esa validación: el contenido
    // real vive en el documento, no en narrative/stats.
    const report = await Report.findById(doc.report_id);
    if (report && (report.status === "borrador" || report.status === "devuelto")) {
      await Report.submit(doc.report_id);
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/documents/:id/start-review — enviado -> en_revision
router.post("/:id/start-review", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    if (doc.author_id === req.admin.id) {
      return res.status(403).json({ error: "No puedes revisar tu propio documento" });
    }
    if (!(await canGradeReport(req, { role: doc.role }))) return res.status(403).json({ error: "No tienes permiso para esta acción" });
    if (doc.status !== "enviado") {
      return res.status(409).json({ error: `Solo se puede tomar para revisión un documento "enviado" (está en "${doc.status}")` });
    }

    const updated = await ReportDocument.startReview(id, req.admin.id);

    // Mismo motivo que en /submit, /grade y /return: sin esto, "Mis
    // informes" se quedaba viendo "Enviado" aunque alguien ya lo
    // hubiera tomado para revisar, sin ninguna señal de que hay
    // alguien trabajando en ello.
    const report = await Report.findById(doc.report_id);
    if (report && report.status === "enviado") {
      await Report.startReview(doc.report_id, req.admin.id);
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/documents/:id/grade — { score } (texto libre), en_revision -> calificado
router.post("/:id/grade", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    if (doc.author_id === req.admin.id) {
      return res.status(403).json({ error: "No puedes calificar tu propio documento" });
    }
    if (!(await canGradeReport(req, { role: doc.role }))) return res.status(403).json({ error: "No tienes permiso para esta acción" });
    if (doc.status !== "en_revision") {
      return res.status(409).json({ error: `Solo se puede calificar un documento "en_revision" (está en "${doc.status}")` });
    }
    if (req.body.score !== undefined && typeof req.body.score !== "string") {
      return res.status(400).json({ error: "score debe ser texto" });
    }

    const updated = await ReportDocument.grade(id, req.admin.id, req.body.score);

    // Mismo motivo que en /submit: el informe (reports.status) es lo
    // que de verdad se ve como "estado general" en Mis informes, y
    // nadie lo tocaba desde acá — "calificar" el documento es la
    // decisión final de aceptarlo, así que el informe debe pasar a
    // "aceptado" también.
    const report = await Report.findById(doc.report_id);
    if (report && report.status !== "aceptado") {
      await Report.accept(doc.report_id, req.admin.id);
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/documents/:id/return — { comment } (se guarda como
// comentario general), en_revision -> devuelto_a_correccion
router.post("/:id/return", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    if (doc.author_id === req.admin.id) {
      return res.status(403).json({ error: "No puedes devolver tu propio documento" });
    }
    if (!(await canGradeReport(req, { role: doc.role }))) return res.status(403).json({ error: "No tienes permiso para esta acción" });
    if (doc.status !== "en_revision") {
      return res.status(409).json({ error: `Solo se puede devolver un documento "en_revision" (está en "${doc.status}")` });
    }

    const comment = req.body?.comment;
    if (comment !== undefined && typeof comment !== "string") {
      return res.status(400).json({ error: "comment debe ser texto" });
    }
    if (comment?.trim()) {
      await ReportDocument.addComment(id, req.admin.id, { body: comment.trim() });
    }

    const updated = await ReportDocument.returnToAuthor(id, req.admin.id);

    // Mismo motivo que en /grade: el informe también debe reflejar
    // que se devolvió para corrección, no solo el documento. Para
    // llegar a /return el documento ya tuvo que pasar por
    // /start-review, así que el informe normalmente ya está en
    // "en_revision" en este punto, no "enviado".
    const report = await Report.findById(doc.report_id);
    if (report && report.status !== "aceptado" && report.status !== "devuelto") {
      await Report.returnForCorrection(doc.report_id, req.admin.id, comment?.trim() || null);
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// GET /api/documents/:id/comments — el autor los ve siempre (nota y
// comentarios), no solo mientras está en revisión.
router.get("/:id/comments", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    const report = { role: doc.role, author_id: doc.author_id };
    if (!(await canAccessReport(req, report)) && !(await canGradeReport(req, report))) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }
    res.json(await ReportDocument.listComments(id));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/documents/:id/comments — { body, anchorFrom?, anchorTo?, quote? }
// Solo el revisor, y solo mientras está en_revision.
router.post("/:id/comments", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    if (!(await canGradeReport(req, { role: doc.role }))) return res.status(403).json({ error: "No tienes permiso para esta acción" });
    if (doc.status !== "en_revision") {
      return res.status(409).json({ error: `Solo se puede comentar un documento "en_revision" (está en "${doc.status}")` });
    }
    if (typeof req.body.body !== "string" || !req.body.body.trim()) {
      return res.status(400).json({ error: "El comentario necesita texto" });
    }

    res.status(201).json(await ReportDocument.addComment(id, req.admin.id, req.body));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// PATCH /api/documents/:id/comments/:commentId — marcar resuelto/no resuelto
router.patch("/:id/comments/:commentId", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const commentId = parseInt(req.params.commentId, 10);
    if (isNaN(id) || isNaN(commentId)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    const report = { role: doc.role, author_id: doc.author_id };
    if (!(await canAccessReport(req, report)) && !(await canGradeReport(req, report))) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }

    await ReportDocument.resolveComment(commentId, !!req.body.resolved);
    res.json(await ReportDocument.listComments(id));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// POST /api/documents/:id/upload-docx — multipart "file". Convierte con
// mammoth (las imágenes embebidas se suben a Cloudinary, nunca base64),
// sube también el archivo original, y responde el HTML para que el
// frontend lo meta al editor y guarde la versión resultante.
router.post("/:id/upload-docx", auth, upload.single("file"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });
    if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    if (!(await canAccessReport(req, { role: doc.role, author_id: doc.author_id }))) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }
    if (!EDITABLE_STATUSES.includes(doc.status)) {
      return res.status(409).json({ error: `No se puede editar un documento en estado "${doc.status}"` });
    }

    const uploadBuffer = (buffer, options) => new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(options, (err, data) => (err ? reject(err) : resolve(data)));
      stream.end(buffer);
    });

    const originalUpload = await uploadBuffer(req.file.buffer, { folder: "casa-asol/documentos", resource_type: "raw" });

    const { value: html } = await mammoth.convertToHtml(
      { buffer: req.file.buffer },
      {
        convertImage: mammoth.images.imgElement((image) =>
          image.read().then(async (imageBuffer) => {
            const ext = (image.contentType || "image/png").split("/")[1] || "png";
            const result = await uploadBuffer(imageBuffer, { folder: "casa-asol/documentos/imagenes", resource_type: "image", format: ext });
            return { src: result.secure_url };
          })
        ),
      }
    );

    await ReportDocument.setOriginalDocx(id, originalUpload.secure_url, req.file.originalname);
    res.json({ html, originalDocxUrl: originalUpload.secure_url, originalDocxName: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: err.message || "No se pudo convertir el archivo" });
  }
});

// DELETE /api/documents/:id/original-docx — quita la referencia al
// .docx original (ej. se subió el archivo equivocado por error). No
// toca el contenido del editor, solo el archivo adjunto.
router.delete("/:id/original-docx", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await ReportDocument.findById(id);
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    if (!(await canAccessReport(req, { role: doc.role, author_id: doc.author_id }))) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }
    if (!EDITABLE_STATUSES.includes(doc.status)) {
      return res.status(409).json({ error: `No se puede editar un documento en estado "${doc.status}"` });
    }

    res.json(await ReportDocument.clearOriginalDocx(id));
  } catch {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// Manejo de errores de multer (archivo inválido, demasiado grande...)
router.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message });
});

module.exports = router;
