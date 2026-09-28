import { BrowserRouter } from 'react-router';

import { AppRouter } from '@/app/router';
import { AuthProvider } from '@/features/auth/auth-provider';
import { MemberProvider } from '@/features/member/member-provider';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <MemberProvider>
          <AppRouter />
        </MemberProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
