import { useContext } from 'react';

import { MemberContext, type MemberContextValue } from './member-context';

export function useMember(): MemberContextValue {
  const ctx = useContext(MemberContext);
  if (!ctx) {
    throw new Error('useMember se tiene que usar dentro de <MemberProvider>.');
  }
  return ctx;
}
