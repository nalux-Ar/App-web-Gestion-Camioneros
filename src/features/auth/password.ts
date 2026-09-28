/**
 * Reglas de contraseña del lado del cliente: solo UX (checklist en vivo,
 * feedback inmediato). La validación real de "es lo bastante fuerte" la
 * hace Supabase Auth en el servidor (puede rechazar con `weak_password`
 * aunque estas reglas pasen, si el proyecto tiene una política más
 * estricta configurada). Nunca alcanza con esto solo.
 */
export interface PasswordRequirement {
  id: 'length' | 'letter' | 'number';
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = [
  { id: 'length', label: 'al menos 8 caracteres', test: (pw) => pw.length >= 8 },
  { id: 'letter', label: 'una letra', test: (pw) => /[A-Za-z]/.test(pw) },
  { id: 'number', label: 'un número', test: (pw) => /[0-9]/.test(pw) },
];

export function getMissingPasswordRequirements(password: string): PasswordRequirement[] {
  return PASSWORD_REQUIREMENTS.filter((requirement) => !requirement.test(password));
}

export function isPasswordValid(password: string): boolean {
  return getMissingPasswordRequirements(password).length === 0;
}
