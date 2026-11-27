import { REPORTAR_VISIBLE } from '@/features/reportar/reportar-config';

/**
 * La ayuda de cada pantalla (la que abre el botón «Ayuda»). Español neutro, de "tú", textos planos (nunca HTML), 3 a 5 puntos cortos.
 * Son datos fijos: no llevan nada de la persona ni de su negocio.
 */
export interface AyudaPantalla {
  titulo: string;
  puntos: readonly string[];
}

/**
 * El punto que manda a «Reportar un problema». Va al final de la ayuda de Inicio y de la de Configuración, y solo si esa
 * función está visible (`reportar-config.ts`).
 */
const PUNTO_REPORTAR = 'Si algo falla o se ve raro, usa «Reportar un problema».';

/**
 * La ayuda de Inicio (el camión, los dos botones grandes, los dos accesos de contorno, dónde está Clientes y Configuración).
 * Función pura que recibe el interruptor de «Reportar un problema» (así se prueban los dos estados sin recargar módulos): con
 * `false` no nombra esa función (4 puntos); con `true` lleva el punto de siempre, al final (5).
 */
export function ayudaInicio(reportarVisible: boolean): AyudaPantalla {
  return {
    titulo: 'Ayuda de Inicio',
    puntos: [
      'Arriba está el camión con el que trabajas. Si tienes varios, aquí eliges cuál.',
      'Toca «Anotar un gasto» o «Anotar un viaje» para anotarlo con un solo toque.',
      '«Ver mis viajes» y «Resumen» te llevan a esas pantallas. Clientes está en la barra de navegación.',
      'En Configuración cambias tu nombre, tus camiones y cómo se ve la app.',
      ...(reportarVisible ? [PUNTO_REPORTAR] : []),
    ],
  };
}

export const AYUDA_INICIO: AyudaPantalla = ayudaInicio(REPORTAR_VISIBLE);

export const AYUDA_VIAJES: AyudaPantalla = {
  titulo: 'Ayuda de Viajes',
  puntos: [
    'Aquí ves los viajes del mes, con cuántos fueron, los kilómetros y lo que cobraste.',
    'Cambia de mes con las flechas de arriba.',
    'Con «Nuevo viaje» anotas uno: de dónde a dónde, la fecha y lo que cobraste.',
    'Toca un viaje para ver sus entregas, sus gastos y sus devoluciones.',
    'En la pestaña Devoluciones ves las del mes.',
  ],
};

export const AYUDA_VIAJE_DETALLE: AyudaPantalla = {
  titulo: 'Ayuda del viaje',
  puntos: [
    'Aquí ves el viaje completo: el recorrido, la fecha, los kilómetros y lo que cobraste.',
    'En Entregas están los clientes a los que entregaste.',
    'Puedes anotar una devolución o un gasto de este viaje.',
    '«Editar viaje» cambia sus datos o lo elimina.',
  ],
};

export const AYUDA_VIAJE_FORM: AyudaPantalla = {
  titulo: 'Ayuda para anotar un viaje',
  puntos: [
    'Completa la fecha, el origen y el destino. Lo demás es opcional.',
    'Los kilómetros puedes anotarlos de dos formas: el inicial y el final del tablero, o los recorridos.',
    'En «Lo que cobraste» pones el monto que te pagaron por el viaje.',
    'Agrega las entregas y elige el cliente de cada una.',
  ],
};

export const AYUDA_GASTOS: AyudaPantalla = {
  titulo: 'Ayuda de Gastos',
  puntos: [
    'Aquí ves lo que gastaste en el mes y puedes filtrar por categoría.',
    'Cambia de mes con las flechas de arriba.',
    'Con «Nuevo gasto» anotas combustible, peajes, urea u otros gastos.',
    'Toca un gasto para editarlo o eliminarlo.',
  ],
};

export const AYUDA_SUMAR_GASTOS: AyudaPantalla = {
  titulo: 'Ayuda para sumar gastos al viaje',
  puntos: [
    'Aquí ves los gastos sin viaje. Los más cercanos a la fecha de este viaje van primero.',
    'Marca los que fueron de este viaje y toca «Sumar». «Marcar todos» los marca de una vez.',
    'Uno de otro camión, o que ya está en otro viaje, no se suma: te avisamos cuál.',
    'Sumar cambia la ganancia del viaje y «Gasto por camión» del Resumen, pero no los totales por fecha.',
  ],
};

export const AYUDA_QUITAR_GASTOS: AyudaPantalla = {
  titulo: 'Ayuda para quitar gastos del viaje',
  puntos: [
    'Aquí ves los gastos de este viaje. Marca los que quieres sacar y toca «Quitar».',
    'Los gastos no se borran: quedan sin viaje. Puedes quitar hasta 100 por vez.',
    'Quitar cambia la ganancia del viaje y «Gasto por camión» del Resumen, pero no los totales por fecha.',
    'Para volver a ponerlos en un viaje, usa «Sumar gastos que ya cargué».',
  ],
};

export const AYUDA_SUMAR_A_VIAJE: AyudaPantalla = {
  titulo: 'Ayuda para sumar varios gastos a un viaje',
  puntos: [
    'Aquí ves los gastos sin viaje del mes. Marca los que quieres poner en un viaje y toca «Elegir el viaje».',
    'Después eliges el viaje. Puedes cambiar de mes para buscarlo. Puedes sumar hasta 100 por vez.',
    'Si cambias el mes o la categoría, se desmarca lo que habías marcado.',
    'Los gastos que ya están en un viaje no aparecen aquí. Si uno es de otro camión que el viaje, no se suma: te avisamos cuántos son.',
  ],
};

export const AYUDA_GASTO_FORM: AyudaPantalla = {
  titulo: 'Ayuda para anotar un gasto',
  puntos: [
    'Elige la categoría y anota el monto. La fecha es la de hoy: toca «Cambiar» si fue otro día.',
    'Puedes marcar más de una categoría: cada una se guarda como un gasto, con su monto.',
    'Elige siempre cómo pagaste: efectivo, tarjeta o transferencia.',
    'En el combustible suma los litros y los kilómetros que marca el tablero: así calculamos cuánto rinde tu camión.',
    'Con «Agregar nota o viaje» sumas una nota o lo unes a un viaje. En «Gastos varios» cuenta en qué gastaste.',
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
    'Aquí ves los datos del cliente. Si anotaste su teléfono o su correo, los tocas para llamar o escribir.',
    'Más abajo están sus viajes y sus devoluciones.',
    '«Editar cliente» cambia sus datos o lo elimina.',
  ],
};

export const AYUDA_CLIENTE_FORM: AyudaPantalla = {
  titulo: 'Ayuda para agregar un cliente',
  puntos: [
    'El nombre es lo único obligatorio.',
    'El teléfono, el correo y la dirección ayudan a encontrarlo y contactarlo después.',
    'Si escribes solo el número de teléfono, se puede tocar para llamar.',
  ],
};

export const AYUDA_RESUMEN: AyudaPantalla = {
  titulo: 'Ayuda del Resumen',
  puntos: [
    'Primero ves cuánto te quedó: lo que cobraste por los viajes menos lo que gastaste.',
    'Debajo, en «En qué gastaste», ves tus gastos separados por categoría.',
    'Lo demás se abre tocando su título: cómo pagaste, cuánto rinde tu camión y más.',
    'Cambia entre Mes y Año con las pestañas de arriba.',
    'Los números salen de los viajes y gastos que anotaste: cuanto más completos, más útil el resumen.',
  ],
};

export const AYUDA_CAMIONES: AyudaPantalla = {
  titulo: 'Ayuda de Camiones',
  puntos: [
    'Aquí están tus camiones. El camión activo es el que se usa en los viajes y las cargas de combustible nuevos.',
    'Con «Nuevo camión» agregas otro. La patente es lo único obligatorio.',
    'Toca un camión para editarlo o marcarlo con «Ya no uso este camión». Eso no borra sus viajes ni sus gastos.',
  ],
};

export const AYUDA_CAMION_FORM: AyudaPantalla = {
  titulo: 'Ayuda para agregar un camión',
  puntos: [
    'La patente es lo único obligatorio. Escríbela como quieras: se guarda sin espacios ni guiones.',
    'La marca, el modelo y el año son opcionales.',
    'Al editar, también puedes tocar «Ya no uso este camión» si ya no lo usas.',
  ],
};

export const AYUDA_DEVOLUCION_FORM: AyudaPantalla = {
  titulo: 'Ayuda para anotar una devolución',
  puntos: [
    'Elige el cliente y el motivo de la devolución.',
    'Cuéntanos qué pasó en la descripción. Es obligatoria si el motivo es «Otro».',
    'La devolución queda unida al viaje desde el que la anotaste.',
  ],
};

/** La ayuda de Configuración. Igual que `ayudaInicio`: recibe el interruptor de «Reportar un problema» y, con `true`, lo nombra al final. */
export function ayudaConfiguracion(reportarVisible: boolean): AyudaPantalla {
  return {
    titulo: 'Ayuda de Configuración',
    puntos: [
      'Aquí ves con qué cuenta iniciaste sesión y puedes cerrarla.',
      'Puedes cambiar tu nombre y entrar a tus camiones.',
      'Elige el tema claro u oscuro y el color de los botones: se guarda solo.',
      ...(reportarVisible ? [PUNTO_REPORTAR] : []),
    ],
  };
}

export const AYUDA_CONFIGURACION: AyudaPantalla = ayudaConfiguracion(REPORTAR_VISIBLE);

/** El botón que repite el recorrido de bienvenida; vive al final de la ayuda de Inicio. */
export const TEXTO_VER_RECORRIDO = 'Ver el recorrido otra vez';
