import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useToast } from '../hooks/useToast';

export function ToastContainer() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0 no-print"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const icon =
          toast.variant === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : toast.variant === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          ) : toast.variant === 'warning' ? (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-[#408dfb] shrink-0" />
          );

        const borderClass =
          toast.variant === 'success'
            ? 'border-emerald-200'
            : toast.variant === 'error'
              ? 'border-red-200'
              : toast.variant === 'warning'
                ? 'border-amber-200'
                : 'border-slate-200';

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 bg-white border ${borderClass} rounded-lg shadow-lg px-4 py-3 text-sm`}
          >
            <div className="mt-0.5">{icon}</div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-900">{toast.title}</p>
              {toast.description && (
                <p className="text-xs text-slate-500 mt-0.5 break-words">{toast.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="text-slate-400 hover:text-slate-700 p-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
