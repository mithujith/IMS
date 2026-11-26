import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Download, Printer } from 'lucide-react';
import { fetchShareLink } from '../services/salesService';
import { generatePrintableDocumentPdf, PdfDocumentInput } from '../lib/pdfGenerator';
import { PrintableDocumentSheet } from '../components/PrintableDocumentSheet';
import { DocumentLine, Organization } from '../types';

export function ShareInvoicePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetchShareLink(token)
      .then((res) => {
        if (!res) setError('Shared invoice link not found or expired.');
        else setData(res);
      })
      .catch(() => setError('Unable to load shared invoice.'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f8fa] text-xs text-slate-600">
        Loading shared invoice...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f8fa] p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md text-center">
          <h2 className="text-base font-semibold text-slate-900">Invoice Unavailable</h2>
          <p className="text-xs text-slate-500 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  const inv = (data.invoiceData || {}) as {
    invoiceNumber: string;
    customerName: string;
    date: string;
    dueDate: string;
    status: string;
    lines: DocumentLine[];
    subtotal: number;
    discountAmount?: number;
    taxTotal: number;
    shippingCharges?: number;
    adjustment?: number;
    total: number;
    amountPaid: number;
    balanceDue: number;
    notes?: string;
    terms?: string;
  };

  const docInput: PdfDocumentInput = {
    docTitle: 'TAX INVOICE',
    docNumber: String(inv.invoiceNumber || data.invoiceNumber || 'Invoice'),
    date: inv.date,
    dueDate: inv.dueDate,
    partyLabel: 'Bill To',
    partyName: inv.customerName || '',
    status: inv.status || 'sent',
    lines: inv.lines || [],
    subtotal: inv.subtotal || 0,
    discountAmount: inv.discountAmount,
    taxTotal: inv.taxTotal || 0,
    shippingCharges: inv.shippingCharges,
    adjustment: inv.adjustment,
    total: inv.total || 0,
    amountPaid: inv.amountPaid,
    balanceDue: inv.balanceDue,
    notes: inv.notes,
    terms: inv.terms,
  };

  const orgInfo: Partial<Organization> = {
    name: String(data.orgName || 'A & P Brothers (Pvt) Ltd'),
    address: data.orgAddress ? String(data.orgAddress) : undefined,
    phone: data.orgPhone ? String(data.orgPhone) : undefined,
    email: data.orgEmail ? String(data.orgEmail) : undefined,
    logoUrl: data.orgLogoUrl ? String(data.orgLogoUrl) : undefined,
  };

  const handleDownloadPdf = async () => {
    setPdfError(null);
    setDownloading(true);
    try {
      await generatePrintableDocumentPdf(docInput, orgInfo);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Unable to generate PDF.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4 print:min-h-0 print:bg-white print:p-0">
      <div className="max-w-[794px] mx-auto mb-4 flex items-center justify-between no-print">
        <p className="text-xs font-medium text-slate-600">
          Read-only Invoice Link · {orgInfo.name}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
          <button
            type="button"
            disabled={downloading}
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#408dfb] rounded-lg hover:bg-[#2f7ae5] disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {downloading ? 'Building PDF...' : 'Download PDF'}
          </button>
        </div>
      </div>

      {pdfError && (
        <div className="max-w-[794px] mx-auto mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex items-center gap-2 no-print">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{pdfError}</span>
        </div>
      )}

      <PrintableDocumentSheet doc={docInput} org={orgInfo} />
    </div>
  );
}
