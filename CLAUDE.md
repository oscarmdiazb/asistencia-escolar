# Pase de Lista — Proyecto de Sistematización de Asistencia Escolar

## Visión y Problema

Bogotá **no tiene datos de asistencia escolar sistematizados** a nivel de ciudad. Los colegios registran la asistencia de formas dispares — papel, Excel, sistemas propios — lo que impide:

- Medir la magnitud real del ausentismo escolar en Bogotá
- Identificar patrones por colegio, localidad, grado o población
- Tomar decisiones de política educativa basadas en evidencia
- Detectar a tiempo estudiantes en riesgo de deserción

El objetivo de largo plazo es que **la Secretaría de Educación de Bogotá (SED) cuente con un sistema unificado y en tiempo real de asistencia escolar para toda la ciudad**.

---

## Estrategia: Piloto → Escala

### Fase 1 (actual): Piloto de app
Desarrollar y probar una app web simple que permita a docentes y facilitadores registrar asistencia desde el celular. Objetivo: validar que este enfoque funciona en la práctica antes de invertir en infraestructura mayor.

### Fase 2: Integración con SED
Conectar los datos a un servidor de la SED o solución en la nube (Firebase, Google Sheets via Apps Script, o API propia de la SED). Requiere coordinación con la Oficina de TI de la SED.

### Fase 3: Escala a toda la ciudad
Despliegue masivo en colegios públicos de Bogotá. Posiblemente integrado con SIMAT (sistema de matrículas ya existente).

---

## El App: "Pase de Lista" (nombre provisional)

### URL actual (piloto)
**https://oscarmdiazb.github.io/asistencia-escolar/**

### Repositorio
**https://github.com/oscarmdiazb/asistencia-escolar**

Archivo único: `index.html` en la raíz del repo → se sirve automáticamente via GitHub Pages.

### Carpeta local
`/Users/Oscar/Dropbox/Asistencia Escolar/`

### Flujo para actualizar la app
```bash
cd "/Users/Oscar/Dropbox/Asistencia Escolar"
git add index.html
git commit -m "Descripción del cambio"
git push
```
GitHub Pages actualiza el link en ~30 segundos.

---

## Descripción del App

### ¿Qué hace?
App web de página única (SPA) — un solo archivo `index.html` sin dependencias ni servidor. Funciona en el celular abriendo el link en Chrome o Safari.

### Flujo principal
1. **Perfil** — El docente ingresa su nombre, institución y rol (se guarda una sola vez)
2. **Tomar asistencia** — Selecciona clase → elige fecha, evento y franja horaria → marca ausentes → guarda
3. **Historial** — Consulta registros anteriores, filtra por clase o período
4. **Exportar** — Descarga CSV compatible con Excel con todos los registros

### Pantallas
| Pantalla | Función |
|---|---|
| `home` | Inicio: estadísticas, accesos rápidos, perfil del usuario |
| `profile` | Configuración de perfil (nombre, institución, rol) |
| `sel-cls` | Selección de clase |
| `session` | Detalles de la sesión (fecha, evento, franja horaria) |
| `att` | Toma de asistencia (lista de estudiantes, marcar ausentes) |
| `manage` | Gestión de clases (crear, editar, eliminar) |
| `edit-cls` | Editar/crear clase y lista de estudiantes |
| `settings` | Configurar eventos y franjas horarias predeterminadas |
| `history` | Historial de registros con filtros |

### Datos del estudiante
Cada estudiante se almacena con:
- **N.° SIMAT** (identificador único del sistema de matrículas de Bogotá)
- Apellido 1, Apellido 2, Nombre 1, Nombre 2
- Lista ordenada alfabéticamente por Apellido 1

### Estructura de un registro de asistencia
```javascript
{
  id, classId, eventId, slotLabel, date,
  absentIds: [...],   // IDs de estudiantes ausentes
  savedAt,
  facilitador: { nombre, institucion, rol }
}
```

### Exportación CSV
Columnas: `Facilitador, Institucion, Rol, Fecha, Colegio, Clase, Grado, Evento, FranjaHoraria, SIMAT, Apellido1, Apellido2, Nombre1, Nombre2, Estado`

### Almacenamiento
- **Piloto actual:** `localStorage` del navegador (datos solo en el dispositivo)
- **Fallback:** memoria en RAM si `localStorage` está bloqueado (ej. visor de WhatsApp)
- **Clave de almacenamiento:** `asistencia_arc_v3`
- **Limitación importante:** los datos se pierden si se borra el historial del navegador → por eso existe la exportación CSV y el recordatorio de respaldo cada 5 registros

### Eventos predeterminados
`Clase regular, Matemáticas, Lenguaje, Sesión 1–4 (ARC), Taller / Actividad, Evaluación`
(el usuario puede agregar los suyos)

### Franjas horarias predeterminadas
`6:30–8:00, 8:00–9:30, 9:30–11:00, 11:00–12:30, 12:30–14:00, 14:00–15:30, 15:30–17:00`
(el usuario puede agregar las suyas)

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|---|---|---|
| Arquitectura | SPA en un solo HTML | Cero dependencias, fácil de compartir por WhatsApp/Drive |
| Hosting | GitHub Pages | Gratis, URL real, actualización instantánea con `git push` |
| Base de datos | localStorage | Sin servidor, sin costos, suficiente para el piloto |
| Futura BD | Firebase o Google Sheets via Apps Script | Más fácil de integrar; alternativa: servidor propio de la SED |
| Compartir | Link de URL (no archivo) | El archivo .html no abre bien en WhatsApp (sin JavaScript) |
| Play Store | PWA → Bubblewrap → APK | Reutiliza el HTML/CSS/JS existente |
| Identificador estudiante | N.° SIMAT | Estándar oficial de Bogotá, permite cruzar con SIMAT |

---

## Contexto del Piloto

El primer piloto está ligado al proyecto **Aulas en Re-Conexión (ARC)** — un RCT de Prácticas Restaurativas en colegios públicos de Bogotá (PI: Oscar M. Diaz-Botia, Paris School of Economics). Los facilitadores ARC usan la app para registrar asistencia a las sesiones de intervención.

Sin embargo, **la app es genérica** — no menciona ARC en ninguna parte — para que pueda usarse en cualquier proyecto o colegio.

---

## Próximos Pasos (por prioridad)

- [ ] **Piloto real** — compartir el link con facilitadores ARC y recopilar feedback
- [ ] **Nombre final** — candidatos: *Pase de Lista*, *Presenti*, *Asistec*
- [ ] **Mejoras UX** basadas en feedback del piloto
- [ ] **Conexión a la nube** — hablar con Oficina de TI de la SED sobre opciones de integración
- [ ] **PWA** — agregar `manifest.json` y service worker para que se pueda instalar como app en el celular (sin Play Store)
- [ ] **Play Store** — PWA → Bubblewrap → APK para distribución masiva

---

## Autor y Contacto

**Oscar M. Diaz-Botia**
PhD Candidate, Paris School of Economics
oscarmdiazb@gmail.com
GitHub: [@oscarmdiazb](https://github.com/oscarmdiazb)
