import { createContext, useCallback, useContext, useState } from 'react';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const show = useCallback((message, ms = 1800) => {
    const id = Symbol();
    setToast({ id, message });
    setTimeout(() => {
      setToast((current) => (current && current.id === id ? null : current));
    }, ms);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className="toast-root" role="status" aria-live="polite">
          <div className="toast">{toast.message}</div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
