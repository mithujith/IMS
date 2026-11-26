import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Download, Link2, Printer, X } from 'lucide-react';
import { Organization } from '../types';
import { generatePrintableDocumentPdf, PdfDocumentInput } from '../lib/pdfGenerator';
import { PrintableDocumentSheet } from './PrintableDocumentSheet';

export type PrintableDocumentData = PdfDocumentInput;

interface DocumentPrintModalProps {
  open: boolean;
  org: Organization | null;
  doc: PrintableDocumentData | null;
  onClose: () => void;
  onCreateShareLink?: () => Promise<string>;
}

export function DocumentPrintModal({
  open,
  org,
  doc,
  onClose,
  onCreateShareLink,
}: DocumentPrintModalProps) {
  const [downloading, setDownloading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setShareUrl(null);
    setActionError(null);
  }, [doc?.docNumber, open]);

  useEffect(() => {
    if (!open || !doc) return;
    document.body.classList.add('has-print-modal');
    return () => {
      document.body.classList.remove('has-print-modal');
    };
  }, [open, doc]);

  if (!open || !doc) return null;

  const handlePrint = () => {
    setActionError(null);
    window.print();
  };

  const handleDownloadPdf = async () => {
    setActionError(null);
    setDownloading(true);
    try {
      await generatePrintableDocumentPdf(doc, org);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to generate PDF file.');
    } finally {
      setDownloading(false);
    }
  };

  const handleShare = async () => {
    if (!onCreateShareLink) return;
    setActionError(null);
    setSharing(true);
    try {
      const url = await onCreateShareLink();
      setShareUrl(url);
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to generate share link.');
    } finally {
      setSharing(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/55 p-4 overflow-y-auto print-modal-portal">
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-4xl w-full my-6 flex flex-col max-h-[92vh]">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-200 bg-slate-50 rounded-t-xl no-print">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{doc.docNumber}</span>
            <span className="text-xs text-slate-500">· {doc.docTitle}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onCreateShareLink && (
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Link2 className="w-3.5 h-3.5" />
                {sharing ? 'Generating...' : 'Share Link'}
              </button>
            )}
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#408dfb] hover:bg-[#2f7ae5] rounded-lg disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Building PDF...' : 'Download PDF'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close document preview"
              className="p-1.5 text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {actionError && (
          <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center gap-2 no-print">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {shareUrl && (
          <div className="px-5 py-2 bg-blue-50 border-b border-blue-200 text-xs text-blue-900 flex items-center justify-between gap-2 no-print">
            <span className="truncate">
              Read-only share link (copied):{' '}
              <a href={shareUrl} className="underline font-medium">
                {shareUrl}
              </a>
            </span>
          </div>
        )}

        <div className="overflow-y-auto p-6 bg-slate-100 flex-1 print-modal-sheet-scroll">
          <PrintableDocumentSheet doc={doc} org={org} />
        </div>
      </div>
    </div>,
    document.body
  );
}
