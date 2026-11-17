import { useIsMutating } from '@tanstack/react-query';

import { SCOPE_DE_VINCULOS } from './use-gasto-mutations';

/**
 * ¿Hay un «Sumar» o un «Quitar» en curso o en cola, venga de donde venga? Cuenta TODAS las mutaciones del scope compartido
 * (`SCOPE_DE_VINCULOS`: el mismo objeto que usan `useVincularGastos` y `useQuitarGastosDelViaje`, así su id vive en un solo lugar
 * y no puede desalinearse), no solo las que lanzó esta pantalla: una que quedó en vuelo de un montaje anterior de la pantalla (se
 * salió y se volvió a entrar con mala señal) o una que espera su turno detrás de otra (para TanStack una mutación en cola ya está
 * «pendiente») sigue contando. Mientras sea `true`, «Sumar» y «Quitar» no se pueden tocar: así no se encima un pedido con otro
 * sobre los mismos gastos.
 */
export function useVinculosEnCurso(): boolean {
  return useIsMutating({ predicate: (mutation) => mutation.options.scope?.id === SCOPE_DE_VINCULOS.id }) > 0;
}
