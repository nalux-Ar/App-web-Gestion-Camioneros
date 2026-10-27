/**
 * La ayuda de cada pantalla (la que abre la "i"). Español neutro, de "tú", textos planos (nunca HTML), 3 a 5 puntos cortos.
 * Son datos fijos: no llevan nada de la persona ni de su negocio.
 */
export interface AyudaPantalla {
  titulo: string;
  puntos: readonly string[];
}

export const AYUDA_INICIO: AyudaPantalla = {
  titulo: 'Ayuda de Inicio',
  puntos: [
    'Desde aquí vas a Viajes, Gastos, Clientes y Resumen con un toque.',
    'Arriba está el camión con el que trabajas. Si tienes varios, aquí eliges cuál.',
    'En Configuración cambias tu nombre, tus camiones y cómo se ve la app.',
    'Si algo falla o se ve raro, usa «Reportar un problema».',
  ],
};

export const AYUDA_VIAJES: AyudaPantalla = {
  titulo: 'Ayuda de Viajes',
  puntos: [
    'Aquí ves los viajes del mes, con cuántos fueron, los kilómetros y lo que cobraste.',
    'Cambia de mes con las flechas de arriba.',
    'Con «Nuevo viaje» cargas uno: de dónde a dónde, la fecha y lo que cobraste.',
    'Toca un viaje para ver sus entregas, sus gastos y sus devoluciones.',
    'En la pestaña Devoluciones ves las del mes.',
  ],
};

export const AYUDA_VIAJE_DETALLE: AyudaPantalla = {
  titulo: 'Ayuda del viaje',
  puntos: [
    'Aquí ves el viaje completo: el recorrido, la fecha, los kilómetros y lo que cobraste.',
    'En Entregas están los clientes a los que entregaste.',
    'Puedes cargar una devolución o un gasto de este viaje.',
    '«Editar viaje» cambia sus datos o lo elimina.',
  ],
};

export const AYUDA_VIAJE_FORM: AyudaPantalla = {
  titulo: 'Ayuda para cargar un viaje',
  puntos: [
    'Completa la fecha, el origen y el destino. Lo demás es opcional.',
    'Los kilómetros puedes anotarlos de dos formas: el inicial y el final del tablero, o los recorridos.',
    'En Ingreso va lo que cobraste por el viaje.',
    'Agrega las entregas y elige el cliente de cada una.',
  ],
};

export const AYUDA_GASTOS: AyudaPantalla = {
  titulo: 'Ayuda de Gastos',
  puntos: [
    'Aquí ves lo que gastaste en el mes y puedes filtrar por categoría.',
    'Cambia de mes con las flechas de arriba.',
    'Con «Nuevo gasto» cargas combustible, peajes, urea u otros gastos.',
    'Toca un gasto para editarlo o eliminarlo.',
  ],
};

export const AYUDA_GASTO_FORM: AyudaPantalla = {
  titulo: 'Ayuda para cargar un gasto',
  puntos: [
    'Elige la categoría, anota el monto y la fecha.',
    'En el combustible suma los litros y el odómetro (los kilómetros del tablero): así calculamos cuánto rinde tu camión.',
    'Si el gasto fue de un viaje, puedes unirlo a ese viaje.',
    'En «Gastos varios» cuéntanos en qué fue.',
  ],
};

export const AYUDA_CLIENTES: AyudaPantalla = {
  titulo: 'Ayuda de Clientes',
  puntos: [
    'Aquí están las personas y empresas a las que entregas.',
    'Busca por nombre para encontrar uno rápido.',
    'Con «Nuevo cliente» agregas uno. Solo el nombre es obligatorio.',
    'Toca un cliente para ver sus datos, sus viajes y sus devoluciones.',
  ],
};

export const AYUDA_CLIENTE_DETALLE: AyudaPantalla = {
  titulo: 'Ayuda del cliente',
  puntos: [
    'Aquí ves los datos del cliente. Si cargaste su teléfono o su correo, los tocas para llamar o escribir.',
    'Más abajo están sus viajes y sus devoluciones.',
    '«Editar cliente» cambia sus datos o lo elimina.',
  ],
};

export const AYUDA_CLIENTE_FORM: AyudaPantalla = {
  titulo: 'Ayuda para cargar un cliente',
  puntos: [
    'El nombre es lo único obligatorio.',
    'El teléfono, el correo y la dirección ayudan a encontrarlo y contactarlo después.',
    'Si escribes solo el número de teléfono, se puede tocar para llamar.',
  ],
};

export const AYUDA_RESUMEN: AyudaPantalla = {
  titulo: 'Ayuda del Resumen',
  puntos: [
    'Aquí ves cuánto gastaste, en qué y cuánto te quedó según lo que cobraste por los viajes.',
    'Cambia entre Mes y Año con las pestañas de arriba.',
    'También ves cuánto rinde el combustible de tu camión.',
    'Los números salen de los viajes y gastos que cargaste: cuanto más completos, más útil el resumen.',
  ],
};

export const AYUDA_CAMIONES: AyudaPantalla = {
  titulo: 'Ayuda de Camiones',
  puntos: [
    'Aquí están tus camiones. El camión activo es el que se usa en los viajes y las cargas de combustible nuevos.',
    'Con «Nuevo camión» agregas otro. La patente es lo único obligatorio.',
    'Toca un camión para editarlo o archivarlo. Archivar no borra sus viajes ni sus gastos.',
  ],
};

export const AYUDA_CAMION_FORM: AyudaPantalla = {
  titulo: 'Ayuda para cargar un camión',
  puntos: [
    'La patente es lo único obligatorio. Escríbela como quieras: se guarda sin espacios ni guiones.',
    'La marca, el modelo y el año son opcionales.',
    'Al editar, también puedes archivar el camión si ya no lo usas.',
  ],
};

export const AYUDA_DEVOLUCION_FORM: AyudaPantalla = {
  titulo: 'Ayuda para cargar una devolución',
  puntos: [
    'Elige el cliente y el motivo de la devolución.',
    'Cuéntanos qué pasó en la descripción. Es obligatoria si el motivo es «Otro».',
    'La devolución queda unida al viaje desde el que la cargaste.',
  ],
};

export const AYUDA_CONFIGURACION: AyudaPantalla = {
  titulo: 'Ayuda de Configuración',
  puntos: [
    'Aquí ves con qué cuenta iniciaste sesión.',
    'Puedes cambiar tu nombre y entrar a tus camiones.',
    'Elige el tema claro u oscuro y el color de los botones: se guarda solo.',
    'Si algo falla o se ve raro, usa «Reportar un problema».',
  ],
};

/** El botón que repite el recorrido de bienvenida; vive al final de la ayuda de Inicio. */
export const TEXTO_VER_RECORRIDO = 'Ver el recorrido otra vez';
