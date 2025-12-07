// index.js
const { Pool } = require("pg");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const { Storage } = require("@google-cloud/storage");

let dbPool;
let storage;
let config = {};
let secretsLoaded = false;

// ------------------ CARGA DE SECRETOS Y DB ------------------

async function loadSecretsOnce() {
  if (secretsLoaded) return;

  const projectId = "fluid-house-477701-v2";
  const secretClient = new SecretManagerServiceClient();

  async function getSecret(name) {
    const [version] = await secretClient.accessSecretVersion({ name });
    return version.payload.data.toString("utf8");
  }

  // Leemos usuario, pass, nombre de BD y bucket
  const [dbUser, dbPass, dbName, backupBucket] = await Promise.all([
    getSecret(`projects/${projectId}/secrets/db-user/versions/latest`),
    getSecret(`projects/${projectId}/secrets/db-pass/versions/latest`),
    getSecret(`projects/${projectId}/secrets/db-name/versions/latest`),
    getSecret(`projects/${projectId}/secrets/backup-bucket/versions/latest`),
  ]);

  // IP pública de la instancia SQL desde env var
  const dbHost = process.env.DB_HOST;
  if (!dbHost) {
    throw new Error("DB_HOST env var is not set");
  }

  config = { dbUser, dbPass, dbName, dbHost, backupBucket };

  // Conexión TCP normal a Postgres
  dbPool = new Pool({
    user: dbUser,
    password: dbPass,
    database: dbName,
    host: dbHost,
    port: 5432,
    ssl: false,
  });

  // Aseguramos que la tabla notes exista
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  storage = new Storage();
  secretsLoaded = true;
}

// ------------------ INTERFAZ HTML (GET /) ------------------

function handleRoot(req, res) {
  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>NoteX</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 20px auto;
      padding: 0 10px;
      background: #f5f5f5;
    }
    h1 {
      text-align: center;
    }
    form {
      background: #fff;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    input, textarea, button {
      width: 100%;
      margin-bottom: 10px;
      padding: 8px;
      box-sizing: border-box;
    }
    button {
      cursor: pointer;
    }
    .note {
      background: #fff;
      margin-bottom: 10px;
      padding: 10px;
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .note-title {
      font-weight: bold;
    }
    .note-date {
      font-size: 0.8rem;
      color: #666;
    }
  </style>
</head>
<body>
  <h1>NoteX</h1>

  <form id="note-form">
    <input id="title" placeholder="Título" required />
    <textarea id="description" placeholder="Descripción" required></textarea>
    <button type="submit">Crear nota</button>
  </form>

  <h2>Notas</h2>
  <div id="notes-container">Cargando notas...</div>

  <script>
    // Base correcta: incluye /notexApi
    const API_BASE = window.location.pathname.replace(/\\/$/, "");

    async function loadNotes() {
      const container = document.getElementById("notes-container");
      container.textContent = "Cargando notas...";
      try {
        const res = await fetch(API_BASE + "/notes");
        const data = await res.json();

        if (!Array.isArray(data)) {
          container.textContent = "Error al cargar notas.";
          console.error("Respuesta inesperada:", data);
          return;
        }

        if (data.length === 0) {
          container.textContent = "No hay notas todavía.";
          return;
        }

        container.innerHTML = "";
        data.forEach(note => {
          const div = document.createElement("div");
          div.className = "note";
          div.innerHTML = \`
            <div class="note-title">\${note.title}</div>
            <div>\${note.description}</div>
            <div class="note-date">Creada: \${new Date(note.created_at).toLocaleString()}</div>
          \`;
          container.appendChild(div);
        });
      } catch (err) {
        console.error(err);
        container.textContent = "Error al cargar notas (ver consola).";
      }
    }

    async function createNote(event) {
      event.preventDefault();
      const title = document.getElementById("title").value.trim();
      const description = document.getElementById("description").value.trim();
      if (!title || !description) return;

      try {
        const res = await fetch(API_BASE + "/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, description })
        });
        const data = await res.json();
        console.log("Nota creada:", data);
        document.getElementById("title").value = "";
        document.getElementById("description").value = "";
        await loadNotes();
      } catch (err) {
        console.error("Error creando nota:", err);
        alert("Error creando nota (ver consola).");
      }
    }

    document.getElementById("note-form").addEventListener("submit", createNote);
    loadNotes();
  </script>
</body>
</html>
`;
  res.set("Content-Type", "text/html").status(200).send(html);
}

// ------------------ API: GET /notes ------------------

async function handleGetNotes(req, res) {
  const result = await dbPool.query(
    "SELECT * FROM notes ORDER BY created_at DESC"
  );
  res.json(result.rows);
}

// ------------------ API: POST /notes ------------------

async function handleCreateNote(req, res) {
  console.log("Incoming POST /notes, headers:", req.headers);
  console.log(
    "Raw body:",
    req.rawBody ? req.rawBody.toString() : null
  );
  console.log("req.body type:", typeof req.body, "value:", req.body);

  let body = null;

  // Preferimos rawBody (buffer con el JSON crudo)
  if (req.rawBody) {
    try {
      body = JSON.parse(req.rawBody.toString());
    } catch (e) {
      console.error("Error parsing req.rawBody:", e);
    }
  }

  // Si no hay rawBody parseable, usamos req.body
  if (!body && req.body) {
    if (typeof req.body === "string") {
      try {
        body = JSON.parse(req.body);
      } catch (e) {
        console.error("Error parsing req.body string:", e);
      }
    } else if (typeof req.body === "object") {
      body = req.body;
    }
  }

  const { title, description } = body || {};

  if (!title || !description) {
    console.warn("Missing title or description in body:", body);
    return res
      .status(400)
      .json({ error: "title and description are required" });
  }

  try {
    const result = await dbPool.query(
      "INSERT INTO notes (title, description) VALUES ($1, $2) RETURNING *",
      [title, description]
    );

    res.status(201).json(result.rows[0]);
  } catch (dbErr) {
    console.error("Error inserting note into DB:", dbErr);
    res.status(500).json({ error: "DB insert failed" });
  }
}

// ------------------ API: POST /notes/export ------------------

async function handleExportNotes(req, res) {
  const result = await dbPool.query(
    "SELECT * FROM notes ORDER BY created_at DESC"
  );
  const now = new Date();
  const fileName = `note_exports/notes-\${now.toISOString()}.json`;

  const bucket = storage.bucket(config.backupBucket);
  const file = bucket.file(fileName);

  await file.save(JSON.stringify(result.rows, null, 2), {
    contentType: "application/json",
  });

  res.json({
    message: "Export completed",
    file: `gs://${config.backupBucket}/${fileName}`,
  });
}

// ------------------ ENTRY POINT DE LA CLOUD FUNCTION ------------------

exports.notexApi = async (req, res) => {
  try {
    await loadSecretsOnce();

    const { method } = req;
    const path = req.path || "/";

    // HTML en la raíz de la función
    if (method === "GET" && path === "/") {
      return handleRoot(req, res);
    }

    // API JSON
    if (method === "GET" && path === "/notes") {
      return await handleGetNotes(req, res);
    }

    if (method === "POST" && path === "/notes") {
      return await handleCreateNote(req, res);
    }

    if (method === "POST" && path === "/notes/export") {
      return await handleExportNotes(req, res);
    }

    res.status(404).json({ error: "Not found", method, path });
  } catch (err) {
    console.error("Error in notexApi:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

