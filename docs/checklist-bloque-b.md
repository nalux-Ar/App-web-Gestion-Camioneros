# Checklist manual — Bloque B (auth, onboarding, layout, configuración)

Marcá cada ítem al probarlo. Si algo falla, anotá qué hiciste y qué viste.

## 0. Preparación
- [ ] `npm install` y `npm run dev` → abre en **http://localhost:3000** (si el 3000 está ocupado, el server falla: cerrá lo que lo use).
- [ ] En Supabase → Authentication → URL Configuration: Site URL `http://localhost:3000` y Redirect URLs con `http://localhost:3000/**`.
- [ ] "Confirm email" desactivado (el estado de hoy).
- [ ] Probá en el celular (o en el navegador con vista de celular, 360–390 px de ancho) y también en PC.
- [ ] Tené a mano dos emails reales tuyos (A y B) para probar.

## 1. Registro
- [ ] Entrar a `http://localhost:3000` sin sesión → te manda a **/ingresar**, pantalla oscura con detalles dorados y el logo grande sobre la placa oscura.
- [ ] "Crear cuenta" → poner una contraseña corta (ej. `abc`) → la lista dice qué falta (8 caracteres, una letra, un número) y no deja enviar.
- [ ] Contraseña y confirmación distintas → avisa y no envía.
- [ ] Registro correcto con el email A → entra directo a **/bienvenida** (con "Confirm email" desactivado).
- [ ] Intentar registrarse de nuevo con el email A (después de salir) → mensaje neutral ("No pudimos crear la cuenta con esos datos…"). No dice "ya existe".
- [ ] (Opcional, antes de producción) Con "Confirm email" **activado**: registrarse con un email nuevo → pantalla "Revisá tu correo" y llega el mail; con el email A → la misma pantalla (no se distingue). Volver a desactivarlo si seguís probando.

## 2. Onboarding
- [ ] En /bienvenida, enviar vacío → no deja.
- [ ] Escribir el nombre (ej. "Transportes Pérez") y tocar el botón varias veces rápido → se deshabilita, dice "Creando…", se crea una sola vez y entra a **Inicio**.
- [ ] Ya con transportista, escribir a mano `/bienvenida` en la URL → te devuelve a Inicio.

## 3. Layout y navegación
- [ ] Header con el logo chico sobre la placa oscura y el nombre del transportista.
- [ ] Celular: barra inferior con Inicio, Viajes, Gastos, Clientes, Reportes; Configuración con el botón del header. PC: barra lateral con las 6.
- [ ] Viajes / Gastos / Clientes / Reportes muestran "Próximamente".
- [ ] Una ruta inventada (ej. `/cualquiercosa`) → vuelve a Inicio.
- [ ] Los botones se tocan fácil con el dedo y los textos se leen de un vistazo.

## 4. Logout
- [ ] "Salir" → vuelve a /ingresar, oscuro y dorado (aunque hayas elegido modo claro u otro color).
- [ ] Botón "atrás" del navegador después de salir → no muestra la app, pide ingresar.

## 5. Login
- [ ] Email o contraseña incorrectos → "El email o la contraseña no son correctos" (el mismo mensaje exista o no el email).
- [ ] Login correcto → entra a Inicio.
- [ ] Sin sesión, abrir `http://localhost:3000/configuracion` → pide ingresar y, después del login, te lleva a Configuración.
- [ ] Abrir `http://localhost:3000/ingresar?volver=//google.com` e ingresar → termina en Inicio de la app, **nunca** en otro sitio.

## 6. Recuperación de contraseña
- [ ] "¿Te olvidaste la contraseña?" con el email A → mensaje "Si ese email tiene una cuenta, te mandamos un link…".
- [ ] Lo mismo con un email que NO está registrado → **el mismo mensaje**.
- [ ] Abrir el link del mail (idealmente desde la app de correo del celular, en otro navegador) → cae en **/restablecer-contrasena**.
- [ ] La barra de direcciones **no** muestra `#access_token=…` (se limpió al instante).
- [ ] Botón "atrás" del navegador → no aparece ninguna URL con `access_token`.
- [ ] Estando en /restablecer-contrasena, escribir a mano `/`, `/configuracion` o `/ingresar` → te devuelve a /restablecer-contrasena (no se puede usar la app sin guardar la contraseña nueva).
- [ ] "Cancelar" → cierra la sesión y vuelve a /ingresar.
- [ ] Pedir otro link, abrirlo y **cerrar la pestaña sin guardar**. Volver a abrir `http://localhost:3000` → pide ingresar (la sesión de recuperación se cerró sola).
- [ ] Pedir otro link, abrirlo, poner contraseña nueva válida y guardar → entra a la app. Salir e ingresar con la contraseña nueva → funciona; con la vieja → no.
- [ ] Usar un link ya usado o viejo → "el link venció o ya se usó" con opción de pedir otro.

## 7. Configuración: tema y color
- [ ] Cambiar a modo claro → se aplica al toque, sin recargar; aparece "Guardando…" y después "Guardado".
- [ ] Elegir un color cualquiera con el selector → botones y bordes cambian en vivo.
- [ ] Escribir un hex a mano (ej. `#3B82F6`) → se aplica; uno inválido (ej. `azul`) → no se aplica y avisa.
- [ ] Elegir un rojo (ej. `#E11D48`) → aparece el aviso de que se parece al rojo de los errores, y los errores/botones de borrar se siguen distinguiendo (ícono, texto y contorno).
- [ ] "Volver al dorado" → vuelve a `#F59E0B`.
- [ ] Guardado con falla: en DevTools → Network → "Offline", cambiar el color → muestra el error con "Reintentar" y el color elegido **sigue aplicado**; volver a "Online" y tocar "Reintentar" → "Guardado".

## 8. Recarga y persistencia
- [ ] Con modo claro y un color propio, recargar la página (F5) → sigue logueado, con el mismo tema y color, sin parpadeo fuerte.
- [ ] Cerrar el navegador, volver a abrir `http://localhost:3000` → sigue logueado con sus preferencias.
- [ ] Ingresar con el email A en otro navegador → carga el mismo tema y color (vienen de la base).

## 9. Mala señal y sesión
- [ ] DevTools → Network → "Offline", intentar ingresar → "No hay conexión…", **lo tipeado sigue en el formulario** y hay botón para reintentar. Volver a "Online" y reintentar → entra.
- [ ] Mismo caso en registro, recuperación y bienvenida: no se pierde lo escrito.
- [ ] Con la app abierta en dos pestañas, "Salir" en una → la otra también termina en /ingresar (al navegar o al instante) y sin el color del usuario.

## 10. Aislamiento (sanity)
- [ ] Registrar el email B y crear otro transportista → ve solo su nombre; nada del transportista de A.
