// ── Fuente única de la estructura de la base de datos ────────
// Cualquier cambio a las tablas se hace AQUÍ. db.js usa este archivo
// tanto para crear la BD la primera vez como para recrearla desde
// cero cuando RESET_DB=true (ver config/db.js).

// Orden de borrado: inverso a las dependencias (FKs primero).
const TABLES_IN_DROP_ORDER = [
  "report_document_comments",
  "report_document_versions",
  "report_documents",
  "reports",
  "report_sequences",
  "attention_participants",
  "attentions",
  "beneficiaries",
  "user_requests",
  "messages",
  "site_data",
  "users",
  "roles",
];

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permissions JSONB NOT NULL DEFAULT '{}',
    self_requestable BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS users (
    id         SERIAL PRIMARY KEY,
    username   TEXT      NOT NULL UNIQUE,
    email      TEXT      UNIQUE,
    password   TEXT      NOT NULL,
    role       TEXT      NOT NULL REFERENCES roles(name),
    photo_url  TEXT,
    google_sub TEXT      UNIQUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    active     BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_login TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS site_data (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- CHECK en vez de tabla catálogo: son 2 valores fijos que definen
  -- el propio formulario del sitio, no algo que un admin vaya a
  -- agregar/editar desde un panel. Si eso cambia, se vuelve catálogo.
  CREATE TABLE IF NOT EXISTS messages (
    id      SERIAL  PRIMARY KEY,
    type    TEXT    NOT NULL CHECK (type IN ('contacto', 'voluntario')),
    name    TEXT    NOT NULL,
    email   TEXT    NOT NULL,
    subject TEXT,
    phone   TEXT,
    area    TEXT,
    message TEXT,
    read    BOOLEAN   NOT NULL DEFAULT FALSE,
    date    TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Solicitudes de acceso: autoservicio (formulario público) o Google
  -- (correo sin cuenta enlazada). Un admin/desarrollador las aprueba
  -- o rechaza desde el panel.
  CREATE TABLE IF NOT EXISTS user_requests (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    email          TEXT NOT NULL,
    phone          TEXT,
    requested_role TEXT NOT NULL REFERENCES roles(name),
    message        TEXT,
    source         TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'google')),
    google_sub     TEXT,
    google_photo   TEXT,
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by    INTEGER REFERENCES users(id),
    reviewed_at    TIMESTAMP,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Catálogo compartido de estudiantes/beneficiarios (AJ). Varios
  -- roles (tutoría, psicología, trabajo social, dirección técnica...)
  -- van a referenciar esta misma lista en vez de escribir nombres
  -- sueltos en texto libre.
  CREATE TABLE IF NOT EXISTS beneficiaries (
    id             SERIAL PRIMARY KEY,
    full_name      TEXT NOT NULL,
    birth_date     DATE,
    school         TEXT,
    grade_level    TEXT,
    status         TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'egresado', 'retirado')),
    admission_date DATE,
    notes          TEXT,
    created_by     INTEGER REFERENCES users(id),
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Expediente de atenciones: registro individual de cada actividad
  -- que un rol (hoy psicología) realiza — atención a un estudiante
  -- específico, o actividades grupales/de equipo que no son de un
  -- solo estudiante (taller, reunión...). "beneficiary_id" es
  -- opcional por eso: solo aplica cuando el tipo de atención lo pide
  -- (ver attentionFields.js). "type" no lleva CHECK porque la lista
  -- la define cada rol en config/attentionFields.js — y esas mismas
  -- llaves son las que reportFields.js usa para autocalcular los
  -- totales del informe periódico a partir de este registro.
  CREATE TABLE IF NOT EXISTS attentions (
    id             SERIAL PRIMARY KEY,
    beneficiary_id INTEGER REFERENCES beneficiaries(id),
    role           TEXT NOT NULL REFERENCES roles(name),
    author_id      INTEGER NOT NULL REFERENCES users(id),
    attention_date DATE NOT NULL,
    type           TEXT NOT NULL,
    notes          TEXT,
    images         JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Integrantes de una actividad: puede ser un estudiante registrado
  -- (beneficiary_id) o una persona sin registrar en "beneficiaries"
  -- (full_name, ej. personal, familiares, invitados). "beneficiary_id"
  -- sigue existiendo en "attentions" por compatibilidad con registros
  -- viejos de un solo estudiante; las actividades nuevas usan esta
  -- tabla para tener cuantas personas hagan falta.
  CREATE TABLE IF NOT EXISTS attention_participants (
    id             SERIAL PRIMARY KEY,
    attention_id   INTEGER NOT NULL REFERENCES attentions(id) ON DELETE CASCADE,
    beneficiary_id INTEGER REFERENCES beneficiaries(id) ON DELETE SET NULL,
    full_name      TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (beneficiary_id IS NOT NULL OR full_name IS NOT NULL)
  );

  -- Correlativo automático por rol para el código de cada informe
  -- (ej. PSI-0001, PSI-0002...). Tabla aparte en vez de un simple
  -- COUNT(*) porque un COUNT se corrompe si se borra un informe —
  -- esto nunca reutiliza un número aunque se borren filas.
  CREATE TABLE IF NOT EXISTS report_sequences (
    role       TEXT PRIMARY KEY REFERENCES roles(name),
    next_value INTEGER NOT NULL DEFAULT 1
  );

  -- Informes periódicos por rol. "stats" y "narrative" son JSONB
  -- porque cada rol tiene sus propios campos (ver
  -- config/reportFields.js) — no hay que agregar columnas ni migrar
  -- nada cuando se define el informe de un rol nuevo.
  --
  -- Flujo de estados: borrador -> enviado -> aceptado (final, ya no
  -- se edita) ó devuelto (vuelve a ser editable, se puede reenviar).
  CREATE TABLE IF NOT EXISTS reports (
    id             SERIAL PRIMARY KEY,
    report_code    TEXT UNIQUE,
    role           TEXT NOT NULL REFERENCES roles(name),
    author_id      INTEGER NOT NULL REFERENCES users(id),
    period_type    TEXT CONSTRAINT reports_period_type_check
                     CHECK (period_type IN ('diario', 'semanal', 'mensual', 'trimestral', 'semestral', 'anual')),
    period_start   DATE,
    period_end     DATE,
    stats          JSONB NOT NULL DEFAULT '{}',
    narrative      JSONB NOT NULL DEFAULT '{}',
    status         TEXT NOT NULL DEFAULT 'borrador'
                     CONSTRAINT reports_status_check
                     CHECK (status IN ('borrador', 'enviado', 'aceptado', 'devuelto')),
    review_comment TEXT,
    reviewed_by    INTEGER REFERENCES users(id),
    reviewed_at    TIMESTAMP,
    submitted_at   TIMESTAMP,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Documento de trabajo (editor tipo Word) vinculado a un informe ya
  -- generado por el sistema — no lo reemplaza ni lo modifica, es un
  -- contenido aparte que se puede seguir editando. "content" es el JSON
  -- de TipTap (ProseMirror). Ciclo de calificación propio, independiente
  -- del estado del informe original (reports.status): borrador/devuelto
  -- son editables por el autor, enviado espera que un revisor lo tome,
  -- en_revision es cuando puede comentar/calificar, calificado es final.
  CREATE TABLE IF NOT EXISTS report_documents (
    id                 SERIAL PRIMARY KEY,
    report_id          INTEGER NOT NULL UNIQUE REFERENCES reports(id) ON DELETE CASCADE,
    author_id          INTEGER NOT NULL REFERENCES users(id),
    content            JSONB NOT NULL DEFAULT '{}'::jsonb,
    status             TEXT NOT NULL DEFAULT 'borrador'
                         CONSTRAINT report_documents_status_check
                         CHECK (status IN ('borrador', 'enviado', 'en_revision', 'calificado', 'devuelto_a_correccion')),
    score              TEXT,
    reviewed_by        INTEGER REFERENCES users(id),
    reviewed_at        TIMESTAMP,
    submitted_at       TIMESTAMP,
    original_docx_url  TEXT,
    original_docx_name TEXT,
    created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Historial de versiones: el guardado automático nunca agrega una
  -- fila aquí (solo actualiza report_documents.content), el guardado
  -- manual sí. Restaurar una versión vieja también agrega una fila
  -- nueva con ese contenido — el historial nunca se reescribe.
  CREATE TABLE IF NOT EXISTS report_document_versions (
    id          SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES report_documents(id) ON DELETE CASCADE,
    content     JSONB NOT NULL,
    label       TEXT,
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Comentarios del revisor: generales (anchor_from/anchor_to NULL) o
  -- sobre un fragmento concreto del texto (con su posición y una cita
  -- textual, para poder mostrarlo aunque el documento cambie después).
  CREATE TABLE IF NOT EXISTS report_document_comments (
    id          SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES report_documents(id) ON DELETE CASCADE,
    author_id   INTEGER NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL,
    anchor_from INTEGER,
    anchor_to   INTEGER,
    quote       TEXT,
    resolved    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- ── Trigger: mantiene updated_at al día en cada UPDATE ──────
  -- Único trigger del sistema: es infraestructura pura (una marca de
  -- tiempo), no lógica de negocio, así que no hay ambigüedad de
  -- dónde debe vivir.
  CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles;
  CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

  DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
  CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

  DROP TRIGGER IF EXISTS trg_site_data_updated_at ON site_data;
  CREATE TRIGGER trg_site_data_updated_at BEFORE UPDATE ON site_data
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

  DROP TRIGGER IF EXISTS trg_beneficiaries_updated_at ON beneficiaries;
  CREATE TRIGGER trg_beneficiaries_updated_at BEFORE UPDATE ON beneficiaries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

  DROP TRIGGER IF EXISTS trg_reports_updated_at ON reports;
  CREATE TRIGGER trg_reports_updated_at BEFORE UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

  DROP TRIGGER IF EXISTS trg_attentions_updated_at ON attentions;
  CREATE TRIGGER trg_attentions_updated_at BEFORE UPDATE ON attentions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

  DROP TRIGGER IF EXISTS trg_report_documents_updated_at ON report_documents;
  CREATE TRIGGER trg_report_documents_updated_at BEFORE UPDATE ON report_documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`;

module.exports = { SCHEMA_SQL, TABLES_IN_DROP_ORDER };
