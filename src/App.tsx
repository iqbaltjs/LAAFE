/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { LoginView, type AuthSession } from './components/LoginView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { StaffPortal } from './components/StaffPortal';
import { StudentPortal } from './components/StudentPortal';

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);

  return (
    <>
      {!session ? (
        <LoginView onLoginSuccess={(next) => setSession(next)} />
      ) : session.role === 'student' ? (
        <StudentPortal
          token={session.token}
          student={session.student}
          onStudentUpdated={(updated) =>
            setSession((prev) =>
              prev && prev.role === 'student' ? { ...prev, student: updated } : prev
            )
          }
          onLogout={() => setSession(null)}
        />
      ) : (
        <StaffPortal
          token={session.token}
          staffName={session.staffName}
          onLogout={() => setSession(null)}
        />
      )}
      <OfflineIndicator />
    </>
  );
}
