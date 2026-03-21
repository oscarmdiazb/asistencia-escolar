# AulaPresente — Proyecto de Sistematización de Asistencia Escolar en Bogotá

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
Desarrollar y probar una app web simple que permita registrar asistencia desde el celular. El piloto se realizará con los **monitores de movilidad escolar** de la SED. Objetivo: validar que este enfoque funciona en la práctica antes de invertir en infraestructura mayor.

### Fase 2: Integración con SED
Conectar los datos a un servidor de la SED o solución en la nube (Firebase, Google Sheets via Apps Script, o API propia de la SED). Requiere coordinación con la Oficina de TI de la SED.

### Fase 3: Escala a toda la ciudad
Despliegue masivo en colegios públicos de Bogotá. Posiblemente integrado con SIMAT (sistema de matrículas ya existente).

---

## Nombre y Marca: **AulaPresente**

> ⚠️ **IMPORTANTE PARA CLAUDE:** El nombre oficial del app es **AulaPresente** (una sola palabra, con mayúscula en la A y la P). Este nombre debe usarse de forma consistente en **todo el código, textos de la interfaz, títulos, mensajes, comentarios y documentación**. Nunca usar "Control de Asistencia" como nombre del app — ese era el nombre provisional. El `<title>` del HTML, el hero de la pantalla de inicio, la pantalla de bienvenida del perfil, y cualquier referencia visible al usuario deben decir **AulaPresente**.

## El App: "AulaPresente"

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

## Diseño Visual del App

### Paleta de colores
```css
/* Colores principales (rainbow palette) */
--rojo:     #E8302A   /* alertas, ausentes, eliminar */
--naranja:  #F47920   /* acentos secundarios */
--amarillo: #F9C200   /* advertencias, banners */
--verde:    #4BAD4E   /* presentes, guardado, éxito */
--azul:     #3AABE3   /* acción principal, links, selección */
--morado:   #8B4EA6   /* acentos decorativos */

/* Colores de interfaz */
--bg:       #F4F6FB   /* fondo general (gris azulado claro) */
--white:    #FFFFFF   /* cards, paneles */
--text:     #1A1A2E   /* texto principal */
--text2:    #666677   /* texto secundario */
--border:   #E0E4EF   /* bordes de cards y campos */

/* Hero / header */
Gradiente: linear-gradient(135deg, #1A2A4A 0%, #0D3559 100%)  /* azul marino oscuro */
```

### Tipografía
- **Headings / botones / badges:** `Nunito` (Google Fonts), pesos 700–900
- **Cuerpo / campos de texto:** `Nunito Sans` (Google Fonts), pesos 400–700
- **Fallback:** `system-ui, sans-serif`

### Componentes de diseño
- **Rainbow bar** — franja de 6px en la parte superior de cada pantalla con el gradiente de los 6 colores (izquierda a derecha: rojo → naranja → amarillo → verde → azul → morado)
- **Cards** — fondo blanco, `border-radius: 16px`, sombra suave `0 2px 12px rgba(0,0,0,0.08)`
- **Botones primarios** — `border-radius: 12px`, padding `14px 20px`, fondo de color sólido (azul para acción principal, verde para guardar, rojo para eliminar)
- **Chips / tags** — `border-radius: 20px` (pill), borde de 2px, fondo blanco; seleccionados: fondo azul claro `#EFF8FD`
- **Campos de formulario** — borde `2px solid #E0E4EF`, focus en azul `#3AABE3`
- **Toasts** — fondo `#1A1A2E` (oscuro) para neutros, verde oscuro para éxito, rojo para error

### Principios de UX
- Diseño **mobile-first** (max-width: 480px centrado)
- Tap targets mínimo de 44px de alto
- `touch-action: manipulation` en todos los elementos interactivos
- Sin zoom en inputs (`font-size: 16px` mínimo en campos)
- Navegación por stack (pantallas apiladas, botón ← para volver)
- Feedback inmediato: toasts de 2.5s tras cada acción

---

## Descripción del App

### ¿Qué hace?
App web de página única (SPA) — un solo archivo `index.html` sin dependencias ni servidor. Funciona en el celular abriendo el link en Chrome o Safari.

### Flujo principal
1. **Perfil** — El usuario ingresa su nombre, institución y rol (se guarda una sola vez)
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

El primer piloto se realizará con los **monitores de movilidad escolar** de la Secretaría de Educación de Bogotá. Estos monitores ya tienen presencia en los colegios y rutinas de registro, lo que los convierte en usuarios naturales de la app.

El piloto también está ligado al proyecto **Aulas en Re-Conexión (ARC)** — un RCT de Prácticas Restaurativas en colegios públicos de Bogotá (PI: Oscar M. Diaz-Botia, Paris School of Economics), cuyos facilitadores también usarán la app.

**La app es genérica** — no menciona ARC ni ningún programa específico — para que pueda usarse en cualquier contexto escolar.

---

## Próximos Pasos (por prioridad)

- [ ] **Piloto** — compartir el link con monitores de movilidad escolar y recopilar feedback
- [ ] **Mejoras UX** basadas en feedback del piloto
- [ ] **Conexión a la nube** — hablar con Oficina de TI de la SED sobre opciones de integración
- [ ] **PWA** — agregar `manifest.json` y service worker para instalación como app nativa
- [ ] **Play Store** — PWA → Bubblewrap → APK para distribución masiva

---

## Autor y Contacto

**Oscar M. Diaz-Botia**
PhD Candidate, Paris School of Economics
oscarmdiazb@gmail.com
GitHub: [@oscarmdiazb](https://github.com/oscarmdiazb)
