import { amountInWordsLKR, formatDisplayDate, formatLKR } from '../lib/formatters';
import { PdfDocumentInput } from '../lib/pdfGenerator';
import { Organization } from '../types';

interface PrintableDocumentSheetProps {
  doc: PdfDocumentInput;
  org: Partial<Organization> | null;
}

export function PrintableDocumentSheet({ doc, org }: PrintableDocumentSheetProps) {
  return (
    <div className="bg-white border border-slate-200 mx-auto p-8 max-w-[794px] text-slate-800 shadow-sm print-modal-sheet print:border-0 print:shadow-none print:p-0 print:max-w-none print:w-full">
      <div className="flex items-start justify-between gap-6 border-b border-slate-200 pb-6 print-avoid-break">
        <div className="flex items-start gap-4 min-w-0">
          {org?.logoUrl && (
            <img
              src={org.logoUrl}
              alt={org.name || 'Company Logo'}
              referrerPolicy="no-referrer"
              className="w-16 h-16 object-contain rounded border border-slate-200 shrink-0"
            />
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#1f2a44] break-words">
              {org?.name || 'A & P Brothers (Pvt) Ltd'}
            </h2>
            {[org?.address, org?.city, org?.country].filter(Boolean).length > 0 && (
              <p className="text-xs text-slate-600 mt-0.5 break-words">
                {[org?.address, org?.city, org?.country].filter(Boolean).join(', ')}
              </p>
            )}
            {[org?.phone, org?.email].filter(Boolean).length > 0 && (
              <p className="text-xs text-slate-500 break-words">
                {[org?.phone, org?.email].filter(Boolean).join(' · ')}
              </p>
            )}
            {org?.taxId && (
              <p className="text-xs text-slate-500 mt-0.5">VAT/Tax Reg: {org.taxId}</p>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <h1 className="text-2xl font-bold tracking-tight text-[#1f2a44]">{doc.docTitle}</h1>
          <p className="text-sm font-mono-num font-semibold text-[#408dfb] mt-1">
            # {doc.docNumber}
          </p>
          <p className="text-xs text-slate-500 mt-1 uppercase tracking-wide">
            {(doc.status || '').replace(/_/g, ' ')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 py-5 border-b border-slate-200 text-xs print-avoid-break">
        <div className="min-w-0">
          <p className="text-slate-500 font-medium uppercase tracking-wider text-[11px]">
            {doc.partyLabel}
          </p>
          <p className="text-sm font-semibold text-slate-900 mt-1 break-words">{doc.partyName}</p>
          {doc.partyAddress && (
            <p className="text-slate-600 mt-0.5 break-words">{doc.partyAddress}</p>
          )}
        </div>
        <div className="text-right space-y-1 shrink-0">
          <div>
            <span className="text-slate-500">Date: </span>
            <span className="font-medium text-slate-900">{formatDisplayDate(doc.date)}</span>
          </div>
          {doc.dueDate && (
            <div>
              <span className="text-slate-500">Due Date: </span>
              <span className="font-medium text-slate-900">{formatDisplayDate(doc.dueDate)}</span>
            </div>
          )}
        </div>
      </div>

      <table className="w-full text-xs mt-5 border-collapse print-sheet-table">
        <thead>
          <tr className="bg-[#1f2a44] text-white">
            <th className="py-2 px-3 text-left font-medium">#</th>
            <th className="py-2 px-3 text-left font-medium">Item &amp; SKU</th>
            <th className="py-2 px-3 text-right font-medium">Qty</th>
            <th className="py-2 px-3 text-right font-medium">Rate</th>
            <th className="py-2 px-3 text-right font-medium">Discount</th>
            <th className="py-2 px-3 text-right font-medium">Tax</th>
            <th className="py-2 px-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {(doc.lines || []).map((line, i) => (
            <tr key={`${line.itemId}_${i}`}>
              <td className="py-2.5 px-3 text-slate-500 align-top">{i + 1}</td>
              <td className="py-2.5 px-3 align-top">
                <p className="font-medium text-slate-900">{line.itemName}</p>
                <p className="text-[11px] text-slate-500 font-mono-num">SKU: {line.sku}</p>
              </td>
              <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap align-top">
                {line.quantity} {line.unit}
              </td>
              <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap align-top">
                {formatLKR(line.rate)}
              </td>
              <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap align-top">
                {formatLKR(line.lineDiscount)}
              </td>
              <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap align-top">
                {formatLKR(line.lineTax)} ({line.taxRate}%)
              </td>
              <td className="py-2.5 px-3 text-right font-medium tabular-nums whitespace-nowrap align-top">
                {formatLKR(line.lineTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 flex flex-col sm:flex-row print:flex-row justify-between gap-6 print-avoid-break">
        <div className="flex-1 text-xs space-y-3 min-w-0">
          <div className="bg-slate-50 border border-slate-200 rounded p-3">
            <p className="text-[11px] font-medium text-slate-500 uppercase">Amount in Words</p>
            <p className="font-medium text-slate-800 mt-1">{amountInWordsLKR(doc.total)}</p>
          </div>
          {doc.notes && (
            <div>
              <p className="font-semibold text-slate-700">Notes</p>
              <p className="text-slate-600 whitespace-pre-line mt-0.5">{doc.notes}</p>
            </div>
          )}
          {doc.terms && (
            <div>
              <p className="font-semibold text-slate-700">Terms &amp; Conditions</p>
              <p className="text-slate-600 whitespace-pre-line mt-0.5">{doc.terms}</p>
            </div>
          )}
        </div>

        <div className="w-full sm:w-72 print:w-72 shrink-0 text-xs space-y-1.5">
          <div className="flex justify-between py-1">
            <span className="text-slate-600">Sub Total</span>
            <span className="font-medium tabular-nums">{formatLKR(doc.subtotal)}</span>
          </div>
          {(doc.discountAmount ?? 0) > 0 && (
            <div className="flex justify-between py-1">
              <span className="text-slate-600">Discount</span>
              <span className="font-medium text-red-600 tabular-nums">
                -{formatLKR(doc.discountAmount)}
              </span>
            </div>
          )}
          <div className="flex justify-between py-1">
            <span className="text-slate-600">Tax Total</span>
            <span className="font-medium tabular-nums">{formatLKR(doc.taxTotal)}</span>
          </div>
          {(doc.shippingCharges ?? 0) > 0 && (
            <div className="flex justify-between py-1">
              <span className="text-slate-600">Shipping</span>
              <span className="font-medium tabular-nums">{formatLKR(doc.shippingCharges)}</span>
            </div>
          )}
          {(doc.adjustment ?? 0) !== 0 && (
            <div className="flex justify-between py-1">
              <span className="text-slate-600">Adjustment</span>
              <span className="font-medium tabular-nums">{formatLKR(doc.adjustment)}</span>
            </div>
          )}
          <div className="flex justify-between py-2 border-t border-slate-300 text-sm font-bold text-slate-900">
            <span>Total</span>
            <span className="tabular-nums">{formatLKR(doc.total)}</span>
          </div>
          {doc.amountPaid !== undefined && (
            <div className="flex justify-between py-1 text-emerald-700">
              <span>Payment Made</span>
              <span className="font-medium tabular-nums">{formatLKR(doc.amountPaid)}</span>
            </div>
          )}
          {doc.balanceDue !== undefined && (
            <div className="flex justify-between py-1.5 border-t border-slate-200 font-semibold text-slate-900">
              <span>Balance Due</span>
              <span className="tabular-nums">{formatLKR(doc.balanceDue)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
