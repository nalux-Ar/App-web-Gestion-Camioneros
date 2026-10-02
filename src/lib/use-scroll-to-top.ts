import { useEffect } from 'react';

/**
 * Lleva la ventana arriba al montar la pantalla. React Router (con
 * `<BrowserRouter>`) NO reinicia el scroll al navegar: tocar un gasto al final
 * de una lista larga abriría el formulario ya "scrolleado" hacia abajo, con el
 * título y los primeros campos fuera de la vista.
 */
export function useScrollToTopOnMount(): void {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
}
