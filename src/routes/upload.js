const router     = require("express").Router();
const multer     = require("multer");
const auth       = require("../middleware/auth");
const cloudinary = require("../config/cloudinary");

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB máximo
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Solo se permiten imágenes"));
    }
    cb(null, true);
  },
});

// POST /api/upload  — subida segura firmada desde el backend
// (uso compartido: imágenes del sitio y fotos de perfil de cualquier usuario)
router.post("/", auth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se recibió ningún archivo" });
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "casa-asol", resource_type: "image" },
        (err, data) => (err ? reject(err) : resolve(data))
      );
      stream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url, publicId: result.public_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manejo de errores de multer
router.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message });
});

module.exports = router;
