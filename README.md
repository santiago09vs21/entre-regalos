# Entre Regalos — Amigo secreto familiar

Aplicación web estática para organizar salas de amigo secreto con HTML, CSS y JavaScript; Supabase Auth + PostgreSQL como backend; y GitHub Pages para publicar el enlace.

## Qué incluye esta primera versión

- Crear una sala: la persona que la crea también queda como participante y organizadora.
- Registrarse en una sala con código de invitación, entrando de inmediato o más tarde.
- Iniciar sesión con correo, contraseña y código de sala.
- Cerrar inscripciones solo desde la cuenta organizadora.
- Generar una única asignación global, guardada en la base de datos. Nadie puede sacarse a sí mismo y ninguna persona puede ser asignada a dos participantes.
- Ruleta visual de unos cinco segundos. La animación no elige el resultado: muestra el resultado que ya quedó guardado en el servidor.
- Privacidad a nivel de base de datos: cada usuario solo puede consultar su asignación.
- Dashboard con participantes e ideas de regalo compartidas.
- Recuperación de contraseña por correo.
- Enlaces de invitación del tipo `https://tuusuario.github.io/amigo-secreto-familiar/?sala=CODIGO12`.

## Archivos

- `index.html`: estructura de la interfaz.
- `styles.css`: diseño adaptable a celular y computador, colores y animaciones.
- `app.js`: navegación y comunicación con Supabase.
- `config.js`: URL del proyecto Supabase y clave pública.
- `supabase/schema.sql`: tablas, funciones seguras y políticas RLS.

---

# PASO 1. Crear el proyecto de Supabase

1. Entra a [supabase.com](https://supabase.com/) y crea una cuenta o inicia sesión.
2. Pulsa **New project** y asigna un nombre, por ejemplo `entre-regalos`.
3. Guarda de forma segura la contraseña de base de datos que solicite Supabase. No va dentro de estos archivos y no es la contraseña de los participantes.
4. Selecciona la región disponible más cercana a Colombia, si aparece una opción apropiada, y crea el proyecto.
5. Espera a que el proyecto termine de aprovisionarse.

El plan gratuito es adecuado para un uso familiar pequeño, pero sus límites y condiciones pueden cambiar. No guardes datos que no necesitas para el juego.

**Ojo con la fecha del evento:** Supabase puede pausar los proyectos gratuitos después de una semana con poca actividad. Como este sorteo es para el 24 de diciembre de 2026, haz las pruebas iniciales y, durante la semana previa a la reunión, abre el Dashboard de Supabase y verifica que el proyecto esté activo. Si aparece como pausado, pulsa **Resume project** y prueba iniciar sesión y sortear antes de compartir el enlace con todos. Consulta la política actual de [pausa de proyectos](https://supabase.com/docs/guides/platform/free-project-pausing).

# PASO 2. Crear la base de datos

1. Dentro del proyecto, abre **SQL Editor**.
2. Pulsa **New query**.
3. Abre el archivo `supabase/schema.sql` de esta carpeta, copia todo su contenido y pégalo en el editor SQL.
4. Pulsa **Run**.
5. Confirma que la consulta termina sin errores. Este archivo crea las tablas y funciones necesarias, además de las políticas de seguridad.

**Importante:** ejecuta el SQL antes de probar el registro en la página. El archivo está preparado para la primera instalación. Si más adelante modificas el esquema, aplica migraciones controladas en vez de borrar las tablas, porque al borrarlas perderías los datos.

## Qué protege el SQL

- `assignments` tiene una asignación por participante, una sola aparición por destinatario y una restricción que prohíbe asignarse a sí mismo.
- La función `draw_room` bloquea la sala durante la operación y genera todas las asignaciones dentro de una sola transacción. Dos clics simultáneos no generan dos sorteos.
- Las tablas tienen Row Level Security (RLS). No se puede leer la asignación de otro participante desde el navegador, aunque alguien intente consultar la API manualmente.
- Los cambios sensibles (crear sala, unirse, cerrar, sortear y aceptar el resultado) pasan por funciones de base de datos.
- El código del frontend no contiene la clave de administración `service_role`.

# PASO 3. Configurar el registro de usuarios

Para esta primera versión, el registro está pensado para entrar de inmediato después de crear una cuenta. En Supabase:

1. Abre **Authentication** y entra en **Sign In / Providers** (el nombre exacto puede variar ligeramente con la interfaz).
2. Abre el proveedor **Email**.
3. Desactiva **Confirm email** para permitir que los familiares entren sin tener que seguir un enlace de verificación durante el registro inicial.

Esta decisión simplifica la experiencia del grupo familiar, pero permite que una persona se registre usando un correo que no haya verificado. La contraseña sigue siendo validada por Supabase. Si más adelante deseas exigir correos verificados, conviene adaptar el flujo de registro para completar la sala después de confirmar el correo antes de volver a activar esa opción.

## Copiar los datos de conexión

1. Dentro de Supabase, abre **Project Settings → API Keys** (en algunos paneles, la URL aparece en **Project Settings → API**).
2. Copia la **Project URL**.
3. Copia la **Publishable key** o la clave pública **anon** heredada. Esas claves están diseñadas para usarse en un frontend cuando RLS está configurado.
4. Abre `config.js` y reemplaza los valores de ejemplo:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU_CLAVE_PUBLICABLE_O_ANON"
};
```

**Nunca pegues aquí `service_role`, una clave `secret`, la contraseña de la base de datos ni un token privado.** La URL y la clave publicable/anon se entregan al navegador; la protección la hacen RLS y las funciones SQL.

# PASO 4. Publicar gratis con GitHub Pages

1. Entra a [github.com](https://github.com/) y crea una cuenta si todavía no tienes.
2. Crea un repositorio nuevo llamado `amigo-secreto-familiar`.
3. Para GitHub Free, deja el repositorio **Public** para usar GitHub Pages sin costo.
4. Sube al nivel raíz del repositorio estos elementos: `index.html`, `styles.css`, `app.js`, `config.js`, `README.md` y la carpeta `supabase`.
5. En el repositorio, abre **Settings → Pages**.
6. En **Build and deployment**, elige **Deploy from a branch**.
7. Selecciona la rama `main` y la carpeta `/ (root)`, y guarda.
8. Espera a que aparezca el enlace publicado. Normalmente tendrá esta forma:

   `https://TU-USUARIO.github.io/amigo-secreto-familiar/`

9. Abre ese enlace. Si ves el mensaje de configuración de Supabase, revisa que `config.js` tenga la URL y la clave publicable correctas.

El repositorio es público, por lo que cualquier persona puede ver el código fuente. Esto es normal para una web estática: no guardamos contraseñas ni claves secretas en el repositorio. Los datos privados permanecen en Supabase y deben seguir protegidos por RLS.

# PASO 5. Configurar la URL del sitio en Supabase

Para que los enlaces de recuperación de contraseña vuelvan a la página correcta:

1. En Supabase abre **Authentication → URL Configuration**.
2. En **Site URL**, pega la URL publicada completa, incluida la carpeta del proyecto y la barra final. Ejemplo: `https://TU-USUARIO.github.io/amigo-secreto-familiar/`.
3. En **Redirect URLs**, añade la URL publicada y la ruta de recuperación. Si el panel admite patrones, puedes permitir `https://TU-USUARIO.github.io/amigo-secreto-familiar/**`. Evita autorizar dominios que no controles.
4. Guarda los cambios.

Si pruebas localmente con Live Server o un servidor local, añade también la URL exacta de desarrollo que uses, por ejemplo `http://127.0.0.1:5500/**`. No uses `file://` para probar la autenticación.

# PASO 6. Prueba controlada antes de invitar a toda la familia

Haz primero un ensayo con cuentas de prueba. Necesitarás un correo distinto por cuenta, o alias compatibles con tu proveedor de correo.

1. Abre la página publicada y selecciona **Crear sala**. Registra al organizador y crea una sala como `Prueba Amigo Secreto`.
2. Copia el código o usa **Compartir** para enviar el enlace de invitación.
3. En otro navegador o ventana privada, selecciona **Registrarme** e ingresa un segundo participante. Repite para crear al menos tres participantes.
4. Como organizador, confirma que los tres aparecen en la lista y pulsa **Cerrar inscripciones**.
5. Desde una cuenta participante, pulsa **Girar y descubrir**. Espera la animación.
6. Entra con cada otra cuenta y descubre su asignación. Los resultados deben ser distintos, nadie debe recibir su propio nombre y cada persona debe aparecer como destinataria una sola vez.
7. Pulsa **Aceptar y continuar**, publica una idea de regalo y comprueba que aparece al entrar desde otra cuenta.
8. Cierra sesión y vuelve a entrar. La aplicación debe llevar a la persona que ya aceptó al dashboard; la que todavía no aceptó debe poder descubrir su asignación guardada.

### Comprobación técnica opcional del sorteo

Si quieres comprobar las asignaciones durante la prueba, como administrador del proyecto puedes ejecutar temporalmente esta consulta en el SQL Editor. **No la conviertas en una función pública ni la pongas en `app.js`**, porque revela el sorteo completo:

```sql
select
  r.name as sala,
  giver.full_name as quien_regala,
  receiver.full_name as quien_recibe
from public.assignments a
join public.rooms r on r.id = a.room_id
join public.profiles giver on giver.id = a.giver_id
join public.profiles receiver on receiver.id = a.receiver_id
where r.name = 'Prueba Amigo Secreto'
order by giver.full_name;
```

Esta consulta es solo para la prueba privada del desarrollador. No muestres su resultado a los participantes.

# Uso normal en familia

1. El organizador abre la página, pulsa **Crear sala** y comparte el enlace/código por WhatsApp.
2. Cada familiar pulsa **Registrarme** una sola vez e ingresa el código. Puede entrar inmediatamente o cerrar la página y entrar después.
3. El organizador verifica los participantes y cierra las inscripciones.
4. Cada participante entra y pulsa **Girar y descubrir**. El primer clic crea las asignaciones de toda la sala de manera atómica; los siguientes solo muestran el resultado ya guardado de cada persona.
5. Después de aceptar, cada participante ve su dashboard, la lista de participantes y las ideas compartidas.

## Limitaciones que debes conocer

- El nombre de la sala es una etiqueta visible. Para evitar salas con nombres iguales o errores al entrar, la entrada utiliza el **código único de invitación** de 12 caracteres; el enlace compartido lo completa automáticamente.
- No se pueden añadir participantes después de cerrar las inscripciones. Para cambiar la lista, crea otra sala.
- La página no utiliza una base de datos local del navegador: los registros y resultados residen en Supabase.
- GitHub Pages publica frontend estático. No contiene un servidor privado; las funciones sensibles viven en Supabase.
- El proyecto gratuito de Supabase puede pausarse por inactividad después de una semana. Comprueba su estado antes de la fecha del sorteo y reactívalo desde el Dashboard si hace falta. La restauración se hace desde Supabase y conserva los datos dentro de la ventana de restauración indicada por el proveedor.
- El plan gratuito de cualquier proveedor puede cambiar sus límites o condiciones. Revisa la página de precios del proveedor si el proyecto crece.

## Si algo no funciona

- **La página dice que falta Supabase:** revisa `config.js`, guarda y vuelve a publicar.
- **El registro pide confirmar correo:** revisa el Paso 3. Para esta versión rápida, `Confirm email` debe estar desactivado.
- **No reconoce el código:** verifica que sean los 12 caracteres del código de invitación, no el nombre de la sala.
- **La sala no aparece en una cuenta:** confirma que esa cuenta se registró con el código correcto y que las inscripciones no estaban cerradas.
- **El enlace de recuperación no abre el formulario:** revisa Site URL y Redirect URLs del Paso 5.
- **No aparecen mensajes o asignaciones:** confirma que ejecutaste `supabase/schema.sql` completo y que las políticas RLS están instaladas.
