# NoteX – Google Cloud Project

NoteX es una aplicación de notas construida completamente con **Google Cloud Functions**, **Cloud SQL**, **Secret Manager** y **Cloud Storage**.

## 🚀 Arquitectura

- **Cloud Functions (Gen2)**  
  - Sirve la interfaz web.  
  - Expone la API REST (`GET /notes`, `POST /notes`).  

- **Cloud SQL (PostgreSQL)**  
  - Almacena todas las notas en una tabla `notes`.  

- **Secret Manager**  
  - Guarda credenciales: usuario, contraseña y nombre de la base.  

- **Cloud Storage**  
  - Guarda exportaciones de notas en JSON (backups).



## 🛠 Tecnologías

- Node.js (Cloud Functions)
- PostgreSQL (Cloud SQL)
- Secret Manager
- Cloud Storage
- HTML, CSS, JS (interfaz)

## ✨ Funciones disponibles

### GET /notes
Devuelve todas las notas.

### POST /notes
Crea una nueva nota.

### POST /notes/export
Exporta todas las notas a Cloud Storage.

---


