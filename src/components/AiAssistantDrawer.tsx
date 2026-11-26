import React, { useState } from 'react';
import { MessageCircle, Send, Sparkles, X, AlertCircle } from 'lucide-react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { AiChatMessage, sendAiChatQuery } from '../services/aiService';
import { BillDoc, InvoiceDoc, Item, PurchaseOrder, SalesOrder } from '../types';

const SUGGESTED_PROMPTS = [
  'Which items should I reorder this week?',
  'Top 5 customers last month?',
  'Summarize overdue invoices and open bills.',
];

export function AiAssistantDrawer() {
  const { orgId, org } = useOrg();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildCompactContext = async () => {
    if (!orgId) return {};
    const [itemsSnap, soSnap, invSnap, poSnap, billSnap] = await Promise.all([
      getDocs(query(collection(db, `organizations/${orgId}/items`), limit(80))),
      getDocs(query(collection(db, `organizations/${orgId}/salesOrders`), orderBy('createdAt', 'desc'), limit(40))),
      getDocs(query(collection(db, `organizations/${orgId}/invoices`), orderBy('createdAt', 'desc'), limit(40))),
      getDocs(query(collection(db, `organizations/${orgId}/purchaseOrders`), orderBy('createdAt', 'desc'), limit(30))),
      getDocs(query(collection(db, `organizations/${orgId}/bills`), orderBy('createdAt', 'desc'), limit(30))),
    ]);

    const items = itemsSnap.docs
      .map((d) => d.data() as Item)
      .filter((i) => !i.isDeleted);

    const lowStock = items
      .filter((i) => i.totalStock <= i.reorderLevel)
      .map((i) => ({
        sku: i.sku,
        name: i.name,
        stock: i.totalStock,
        reorderLevel: i.reorderLevel,
        reorderQty: i.reorderQty,
        costPrice: i.costPrice,
      }));

    const invoices = invSnap.docs
      .map((d) => d.data() as InvoiceDoc)
      .filter((i) => !i.isDeleted)
      .map((i) => ({
        invoiceNumber: i.invoiceNumber,
        customerName: i.customerName,
        date: i.date,
        dueDate: i.dueDate,
        total: i.total,
        balanceDue: i.balanceDue,
        status: i.status,
      }));

    const salesOrders = soSnap.docs
      .map((d) => d.data() as SalesOrder)
      .filter((s) => !s.isDeleted)
      .map((s) => ({
        orderNumber: s.orderNumber,
        customerName: s.customerName,
        date: s.date,
        status: s.status,
        total: s.total,
      }));

    const purchaseOrders = poSnap.docs
      .map((d) => d.data() as PurchaseOrder)
      .filter((p) => !p.isDeleted)
      .map((p) => ({
        poNumber: p.poNumber,
        vendorName: p.vendorName,
        date: p.date,
        status: p.status,
        total: p.total,
      }));

    const bills = billSnap.docs
      .map((d) => d.data() as BillDoc)
      .filter((b) => !b.isDeleted)
      .map((b) => ({
        billNumber: b.billNumber,
        vendorName: b.vendorName,
        date: b.date,
        balanceDue: b.balanceDue,
        status: b.status,
      }));

    return {
      organization: org?.name || 'A & P Brothers (Pvt) Ltd',
      currency: 'LKR',
      totalCatalogItems: items.length,
      totalInventoryCostValue: items.reduce((s, i) => s + i.totalStock * i.costPrice, 0),
      belowReorderItems: lowStock,
      recentSalesOrders: salesOrders,
      recentInvoices: invoices,
      recentPurchaseOrders: purchaseOrders,
      recentBills: bills,
    };
  };

  const handleSend = async (promptText?: string) => {
    const q = (promptText ?? input).trim();
    if (!q || loading) return;

    setError(null);
    const nextHistory: AiChatMessage[] = [...messages, { role: 'user', text: q }];
    setMessages(nextHistory);
    if (!promptText) setInput('');
    setLoading(true);

    try {
      const contextSummary = await buildCompactContext();
      const reply = await sendAiChatQuery({
        message: q,
        history: messages,
        contextSummary,
      });
      setMessages([...nextHistory, { role: 'model', text: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach AI assistant.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 sm:right-14 z-40 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#1f2a44] hover:bg-[#2a3859] text-white text-xs font-semibold shadow-lg transition-transform hover:scale-[1.02] no-print"
        >
          <MessageCircle className="w-4 h-4 text-[#408dfb]" />
          <span>Chat with our experts</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-4 right-4 sm:right-14 z-50 w-[calc(100vw-2rem)] sm:w-96 h-[520px] max-h-[80vh] bg-white border border-slate-200 rounded-xl shadow-2xl flex flex-col no-print">
          <div className="px-4 py-3 bg-[#1f2a44] text-white rounded-t-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#408dfb]" />
              <div>
                <p className="text-xs font-semibold">Inventory AI Assistant</p>
                <p className="text-[11px] text-slate-300">Powered by live stock &amp; billing data</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close AI assistant"
              className="text-slate-300 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-50">
            {messages.length === 0 && (
              <div className="space-y-2.5">
                <div className="bg-white border border-slate-200 rounded-lg p-3 text-xs text-slate-700">
                  Ask me about stock levels, reorder priorities, top customers, or overdue invoices for{' '}
                  <span className="font-semibold">{org?.name || 'A & P Brothers'}</span>.
                </div>
                <div className="space-y-1.5">
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => void handleSend(p)}
                      className="w-full text-left px-3 py-2 bg-white hover:bg-blue-50 border border-slate-200 rounded-lg text-xs text-[#408dfb] font-medium transition-colors"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-[#408dfb] text-white'
                      : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {loading && (
              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500 w-36">
                Analyzing data...
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="p-2.5 border-t border-slate-200 bg-white rounded-b-xl flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about stock, orders, invoices..."
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="p-2 bg-[#408dfb] hover:bg-[#2f7ae5] text-white rounded-lg disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
