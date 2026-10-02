import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-refresh': reactRefresh.configs.vite.plugins['react-refresh'],
    },
    rules: {
      ...reactRefresh.configs.vite.rules,
      // Invariante de datos: las mutaciones NO se reintentan solas ni se
      // pausan sin red (src/lib/query-client.ts). Un reintento automático de
      // un INSERT duplica el registro si el primer pedido sí llegó al servidor
      // y solo se perdió la respuesta. Se bloquea a nivel de cada llamada.
      'no-restricted-syntax': [
        'error',
        ...['name', 'value'].map((keyProp) => ({
          selector: `CallExpression[callee.name=/^(useMutation|mutationOptions)$/] > ObjectExpression > Property[key.${keyProp}=/^(retry|retryDelay|networkMode)$/]`,
          message:
            "No configures 'retry', 'retryDelay' ni 'networkMode' en una mutación: los valores por defecto (retry: 0, networkMode: 'always', ver src/lib/query-client.ts) existen para no duplicar registros si se corta la señal. El reintento es manual (useSubmitFeedback).",
        })),
      ],
    },
  },
  {
    // Pruebas (vitest). Los componentes de prueba exponen a la prueba lo que
    // devuelve un hook (`probe.ctx = useMember()`, `ctl.setUser = setUserId`)
    // guardándolo en una variable del módulo: es justo lo que esta regla de
    // código de app prohíbe, y en una prueba es el mecanismo para leer el
    // estado real de un componente.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'react-hooks/immutability': 'off',
    },
  },
);
