import { useState } from 'react';
import { BookOpen, HelpCircle, StickyNote, X } from 'lucide-react';

export function RightUtilityRail() {
  const [activePanel, setActivePanel] = useState<null | 'help' | 'tutorials' | 'notes'>(null);
  const [quickNotes, setQuickNotes] = useState(() => localStorage.getItem('apb_quick_notes') || '');

  const saveNotes = (val: string) => {
    setQuickNotes(val);
    localStorage.setItem('apb_quick_notes', val);
  };

  return (
    <>
      <aside className="hidden md:flex flex-col items-center w-10 bg-white border-l border-slate-200 py-3 gap-3 shrink-0 no-print">
        <button
          type="button"
          onClick={() => setActivePanel(activePanel === 'help' ? null : 'help')}
          title="Help & Shortcuts"
          aria-label="Help and keyboard shortcuts"
          className={`p-1.5 rounded-md transition-colors ${
            activePanel === 'help' ? 'bg-blue-50 text-[#408dfb]' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setActivePanel(activePanel === 'tutorials' ? null : 'tutorials')}
          title="Workflow Guides"
          aria-label="Workflow guides"
          className={`p-1.5 rounded-md transition-colors ${
            activePanel === 'tutorials' ? 'bg-blue-50 text-[#408dfb]' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <BookOpen className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setActivePanel(activePanel === 'notes' ? null : 'notes')}
          title="Quick Notes"
          aria-label="Quick scratchpad notes"
          className={`p-1.5 rounded-md transition-colors ${
            activePanel === 'notes' ? 'bg-blue-50 text-[#408dfb]' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <StickyNote className="w-4 h-4" />
        </button>
      </aside>

      {activePanel && (
        <div className="fixed right-10 top-16 bottom-0 w-80 bg-white border-l border-slate-200 shadow-xl z-40 flex flex-col no-print">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
              {activePanel === 'help'
                ? 'Help & Shortcuts'
                : activePanel === 'tutorials'
                  ? 'Order-to-Cash Guides'
                  : 'Quick Notes'}
            </h3>
            <button
              type="button"
              onClick={() => setActivePanel(null)}
              aria-label="Close utility panel"
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 flex-1 overflow-y-auto text-xs text-slate-600 space-y-3">
            {activePanel === 'help' && (
              <>
                <p className="font-semibold text-slate-900">Keyboard Shortcuts</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span>Focus global search</span>
                    <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-[11px]">/</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span>Create new record</span>
                    <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-[11px]">n</kbd>
                  </div>
                  <div className="flex justify-between">
                    <span>Close dialogs / drawers</span>
                    <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-[11px]">Esc</kbd>
                  </div>
                </div>
                <p className="font-semibold text-slate-900 pt-2">Stock Accounting</p>
                <p>
                  Confirming a Sales Order commits stock; creating a Shipment deducts stock on hand
                  and appends an immutable entry in the Stock Ledger.
                </p>
              </>
            )}

            {activePanel === 'tutorials' && (
              <>
                <div>
                  <p className="font-semibold text-slate-900">1. Sales Fulfillment Flow</p>
                  <p className="mt-1">
                    Sales Order (Draft → Confirmed) → Package → Shipment (deducts stock) → Invoice →
                    Payment Received.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">2. Purchasing &amp; Replenishment</p>
                  <p className="mt-1">
                    Purchase Order (Draft → Issued) → Purchase Receive (increases stock &amp; blends
                    weighted average cost) → Bill → Payment Made.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">3. Stock Reconciliation</p>
                  <p className="mt-1">
                    Admins can run &ldquo;Recalculate stock from ledger&rdquo; under Settings to verify
                    denormalized warehouse counts against the append-only ledger.
                  </p>
                </div>
              </>
            )}

            {activePanel === 'notes' && (
              <div className="h-full flex flex-col">
                <p className="text-slate-500 mb-2">Personal scratchpad (saved locally in browser):</p>
                <textarea
                  value={quickNotes}
                  onChange={(e) => saveNotes(e.target.value)}
                  placeholder="Jot down supplier phone numbers, reorder notes, or dispatch reminders..."
                  className="flex-1 w-full p-2.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb] resize-none"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
