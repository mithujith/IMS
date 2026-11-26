import { jsPDF } from 'jspdf';
import { amountInWordsLKR, formatDisplayDate, formatLKR } from './formatters';
import { DocumentLine, Organization } from '../types';

export interface PdfDocumentInput {
  docTitle: string;
  docNumber: string;
  date: string;
  dueDate?: string;
  partyLabel: string;
  partyName: string;
  partyAddress?: string;
  status: string;
  lines: DocumentLine[];
  subtotal: number;
  discountAmount?: number;
  taxTotal: number;
  shippingCharges?: number;
  adjustment?: number;
  total: number;
  amountPaid?: number;
  balanceDue?: number;
  notes?: string;
  terms?: string;
}

export function sanitizePdfFilename(docNumber: string): string {
  const cleaned = (docNumber || 'document').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${cleaned || 'document'}.pdf`;
}

/**
 * Standard PDF Type-1 Helvetica uses WinAnsiEncoding. Normalize common typography
 * and strip unsupported non-Latin / control characters so jsPDF never emits
 * garbled glyphs or throws on unexpected characters.
 */
export function sanitizePdfText(value: string | undefined | null): string {
  if (!value) return '';
  return String(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');
}

export function computeSummaryRows(doc: PdfDocumentInput): Array<{
  label: string;
  value: string;
  bold?: boolean;
  tone?: 'danger' | 'success' | 'default';
}> {
  const rows: Array<{
    label: string;
    value: string;
    bold?: boolean;
    tone?: 'danger' | 'success' | 'default';
  }> = [{ label: 'Sub Total', value: formatLKR(doc.subtotal), tone: 'default' }];

  if ((doc.discountAmount ?? 0) > 0) {
    rows.push({
      label: 'Discount',
      value: `-${formatLKR(doc.discountAmount)}`,
      tone: 'danger',
    });
  }

  rows.push({ label: 'Tax Total', value: formatLKR(doc.taxTotal), tone: 'default' });

  if ((doc.shippingCharges ?? 0) > 0) {
    rows.push({ label: 'Shipping', value: formatLKR(doc.shippingCharges), tone: 'default' });
  }

  if ((doc.adjustment ?? 0) !== 0) {
    rows.push({ label: 'Adjustment', value: formatLKR(doc.adjustment), tone: 'default' });
  }

  rows.push({ label: 'Total', value: formatLKR(doc.total), bold: true, tone: 'default' });

  if (doc.amountPaid !== undefined) {
    rows.push({ label: 'Payment Made', value: formatLKR(doc.amountPaid), tone: 'success' });
  }

  if (doc.balanceDue !== undefined) {
    rows.push({ label: 'Balance Due', value: formatLKR(doc.balanceDue), bold: true, tone: 'default' });
  }

  return rows;
}

interface LoadedLogo {
  dataUrl: string;
  width: number;
  height: number;
}

async function loadImageAsDataUrl(url: string): Promise<LoadedLogo | null> {
  if (!url || typeof window === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    if (!url.startsWith('data:') && !url.startsWith('/')) {
      img.crossOrigin = 'anonymous';
    }
    const timer = window.setTimeout(() => resolve(null), 2500);
    img.onload = () => {
      window.clearTimeout(timer);
      try {
        const w = img.naturalWidth || 128;
        const h = img.naturalHeight || 128;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', 0.92),
          width: w,
          height: h,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

function drawFittedRightText(
  pdf: jsPDF,
  text: string,
  rightX: number,
  y: number,
  maxWidthMm: number,
  baseFontSize: number,
  minFontSize = 6.5
): void {
  const safe = sanitizePdfText(text);
  let size = baseFontSize;
  pdf.setFontSize(size);
  while (size > minFontSize && pdf.getTextWidth(safe) > maxWidthMm) {
    size -= 0.4;
    pdf.setFontSize(size);
  }
  pdf.text(safe, rightX, y, { align: 'right' });
}

export async function buildPrintableDocumentPdfInstance(
  docData: PdfDocumentInput,
  org: Partial<Organization> | null,
  options?: { footerNote?: string; skipLogoFetch?: boolean }
): Promise<jsPDF> {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth(); // 210mm
  const pageHeight = pdf.internal.pageSize.getHeight(); // 297mm
  const margin = 14;
  const bottomLimit = pageHeight - 16; // reserve space for page number / footer note
  const contentWidth = pageWidth - margin * 2; // 182mm
  let y = margin;

  const ensureSpace = (neededMm: number): boolean => {
    if (y + neededMm > bottomLimit) {
      pdf.addPage();
      y = margin;
      return true;
    }
    return false;
  };

  // Optional Company Logo (gracefully skipped if CORS/offline)
  const logo = !options?.skipLogoFetch && org?.logoUrl
    ? await loadImageAsDataUrl(org.logoUrl)
    : null;
  let orgTextX = margin;
  let logoBottomY = y;
  if (logo) {
    try {
      const boxMax = 16;
      const aspect = logo.width / Math.max(1, logo.height);
      const drawW = aspect >= 1 ? boxMax : boxMax * aspect;
      const drawH = aspect >= 1 ? boxMax / aspect : boxMax;
      pdf.addImage(logo.dataUrl, 'JPEG', margin, y, drawW, drawH);
      orgTextX = margin + drawW + 4;
      logoBottomY = y + drawH;
    } catch {
      orgTextX = margin;
    }
  }

  // Company Header Left (bounded width so it never collides with right doc header)
  const leftHeaderMaxWidth = Math.max(60, 118 - (orgTextX - margin));
  const orgName = sanitizePdfText(org?.name || 'A & P Brothers (Pvt) Ltd');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(31, 42, 68);
  const wrappedOrgName = pdf.splitTextToSize(orgName, leftHeaderMaxWidth) as string[];
  pdf.text(wrappedOrgName, orgTextX, y + 4.5);

  let headerLeftY = y + 4.5 + wrappedOrgName.length * 4.8;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(71, 85, 105);

  const addressLine = sanitizePdfText(
    [org?.address, org?.city, org?.country].filter(Boolean).join(', ')
  );
  if (addressLine) {
    const wrappedAddr = pdf.splitTextToSize(addressLine, leftHeaderMaxWidth) as string[];
    pdf.text(wrappedAddr, orgTextX, headerLeftY);
    headerLeftY += wrappedAddr.length * 3.9;
  }

  const contactLine = sanitizePdfText(
    [org?.phone, org?.email].filter(Boolean).join(' · ')
  );
  if (contactLine) {
    const wrappedContact = pdf.splitTextToSize(contactLine, leftHeaderMaxWidth) as string[];
    pdf.text(wrappedContact, orgTextX, headerLeftY);
    headerLeftY += wrappedContact.length * 3.9;
  }

  if (org?.taxId) {
    const wrappedTax = pdf.splitTextToSize(
      sanitizePdfText(`VAT/Tax Reg: ${org.taxId}`),
      leftHeaderMaxWidth
    ) as string[];
    pdf.text(wrappedTax, orgTextX, headerLeftY);
    headerLeftY += wrappedTax.length * 3.9;
  }

  // Document Header Right
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16.5);
  pdf.setTextColor(31, 42, 68);
  pdf.text(sanitizePdfText(docData.docTitle), pageWidth - margin, y + 5, { align: 'right' });

  pdf.setFontSize(10.5);
  pdf.setTextColor(64, 141, 251);
  pdf.text(`# ${sanitizePdfText(docData.docNumber)}`, pageWidth - margin, y + 11, {
    align: 'right',
  });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text(
    sanitizePdfText((docData.status || '').replace(/_/g, ' ').toUpperCase()),
    pageWidth - margin,
    y + 16,
    { align: 'right' }
  );

  y = Math.max(headerLeftY, logoBottomY, y + 20) + 3;
  pdf.setDrawColor(226, 232, 240);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 6;

  // Party & Dates Block
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(100, 116, 139);
  pdf.text(sanitizePdfText(docData.partyLabel || 'Bill To').toUpperCase(), margin, y);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.setTextColor(15, 23, 42);
  const wrappedPartyName = pdf.splitTextToSize(
    sanitizePdfText(docData.partyName || '-'),
    108
  ) as string[];
  pdf.text(wrappedPartyName, margin, y + 5);

  let partyEndY = y + 5 + wrappedPartyName.length * 4.5;
  if (docData.partyAddress) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(71, 85, 105);
    const wrappedPartyAddr = pdf.splitTextToSize(
      sanitizePdfText(docData.partyAddress),
      108
    ) as string[];
    pdf.text(wrappedPartyAddr, margin, partyEndY);
    partyEndY += wrappedPartyAddr.length * 4;
  }

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text(
    `Date: ${sanitizePdfText(formatDisplayDate(docData.date))}`,
    pageWidth - margin,
    y + 4,
    { align: 'right' }
  );
  if (docData.dueDate) {
    pdf.text(
      `Due Date: ${sanitizePdfText(formatDisplayDate(docData.dueDate))}`,
      pageWidth - margin,
      y + 9,
      { align: 'right' }
    );
  }

  y = Math.max(partyEndY, y + 13) + 3;
  pdf.setDrawColor(226, 232, 240);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 6;

  // Balanced A4 Table Columns across 182mm (x = 14 .. 196):
  //   #        15 .. 21  (6mm)
  //   Item     22 .. 83  (61mm wrap width)
  //   Qty      right @ 102  (17mm: 85..102)
  //   Rate     right @ 126  (22mm: 104..126)
  //   Disc     right @ 147  (19mm: 128..147)
  //   Tax      right @ 170  (21mm: 149..170)
  //   Amount   right @ 194  (22mm: 172..194)
  const col = {
    idxX: margin + 2,
    itemX: margin + 9,
    itemWidth: 60,
    qtyRightX: margin + 88,
    qtyWidth: 16,
    rateRightX: margin + 112,
    rateWidth: 22,
    discRightX: margin + 133,
    discWidth: 19,
    taxRightX: margin + 156,
    taxWidth: 21,
    amountRightX: pageWidth - margin - 2,
    amountWidth: 22,
  };

  const drawTableHeader = () => {
    pdf.setFillColor(31, 42, 68);
    pdf.rect(margin, y, contentWidth, 8, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(255, 255, 255);
    pdf.text('#', col.idxX, y + 5.3);
    pdf.text('Item & SKU', col.itemX, y + 5.3);
    pdf.text('Qty', col.qtyRightX, y + 5.3, { align: 'right' });
    pdf.text('Rate', col.rateRightX, y + 5.3, { align: 'right' });
    pdf.text('Discount', col.discRightX, y + 5.3, { align: 'right' });
    pdf.text('Tax', col.taxRightX, y + 5.3, { align: 'right' });
    pdf.text('Amount', col.amountRightX, y + 5.3, { align: 'right' });
    y += 8;
  };

  drawTableHeader();

  docData.lines.forEach((line, index) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.2);
    const wrappedName = pdf.splitTextToSize(
      sanitizePdfText(line.itemName || '-'),
      col.itemWidth
    ) as string[];
    const rowHeight = Math.max(12, wrappedName.length * 4 + 7.5);

    if (ensureSpace(rowHeight + 2)) {
      drawTableHeader();
    }

    if (index % 2 === 1) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin, y, contentWidth, rowHeight, 'F');
    }

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(String(index + 1), col.idxX, y + 5);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.2);
    pdf.setTextColor(15, 23, 42);
    pdf.text(wrappedName, col.itemX, y + 5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.2);
    pdf.setTextColor(100, 116, 139);
    pdf.text(
      `SKU: ${sanitizePdfText(line.sku || '-')}`,
      col.itemX,
      y + 5 + wrappedName.length * 4
    );

    pdf.setTextColor(30, 41, 59);
    pdf.setFont('helvetica', 'normal');
    drawFittedRightText(
      pdf,
      `${line.quantity} ${line.unit || ''}`.trim(),
      col.qtyRightX,
      y + 5,
      col.qtyWidth,
      8
    );
    drawFittedRightText(pdf, formatLKR(line.rate), col.rateRightX, y + 5, col.rateWidth, 8);
    drawFittedRightText(
      pdf,
      formatLKR(line.lineDiscount),
      col.discRightX,
      y + 5,
      col.discWidth,
      8
    );
    drawFittedRightText(pdf, formatLKR(line.lineTax), col.taxRightX, y + 5, col.taxWidth, 8);

    pdf.setFont('helvetica', 'bold');
    drawFittedRightText(
      pdf,
      formatLKR(line.lineTotal),
      col.amountRightX,
      y + 5,
      col.amountWidth,
      8
    );

    y += rowHeight;
    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y, pageWidth - margin, y);
  });

  y += 7;

  // Footer Section: Amount in Words + Totals side by side, then Notes & Terms
  const summaryRows = computeSummaryRows(docData);
  const wordsText = sanitizePdfText(amountInWordsLKR(docData.total));
  const wrappedWords = pdf.splitTextToSize(wordsText, 92) as string[];
  const wordsBoxHeight = 9 + wrappedWords.length * 4;
  const rightHeight = summaryRows.length * 6.5 + 4;

  ensureSpace(Math.max(wordsBoxHeight + 4, rightHeight) + 2);
  const sectionStartY = y;

  // Left: Amount in Words box
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(margin, y, 100, wordsBoxHeight, 1.5, 1.5, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text('AMOUNT IN WORDS', margin + 3, y + 4.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(30, 41, 59);
  pdf.text(wrappedWords, margin + 3, y + 8.8);

  // Right: Totals
  let rightY = sectionStartY + 4;
  const summaryLeftX = margin + 108;
  const summaryRightX = pageWidth - margin;

  for (const row of summaryRows) {
    if (row.bold) {
      pdf.setDrawColor(203, 213, 225);
      pdf.line(summaryLeftX, rightY - 3.5, summaryRightX, rightY - 3.5);
      pdf.setFont('helvetica', 'bold');
    } else {
      pdf.setFont('helvetica', 'normal');
    }

    if (row.tone === 'danger') {
      pdf.setTextColor(220, 38, 38);
    } else if (row.tone === 'success') {
      pdf.setTextColor(4, 120, 87);
    } else if (row.bold) {
      pdf.setTextColor(15, 23, 42);
    } else {
      pdf.setTextColor(71, 85, 105);
    }

    pdf.setFontSize(row.bold ? 9.5 : 8.5);
    pdf.text(sanitizePdfText(row.label), summaryLeftX, rightY);
    drawFittedRightText(pdf, row.value, summaryRightX, rightY, 42, row.bold ? 9.5 : 8.5);
    rightY += row.bold ? 7 : 5.5;
  }

  y = Math.max(sectionStartY + wordsBoxHeight + 6, rightY + 3);

  // Notes & Terms (paginated safely so long text never clips off-page)
  const renderTextBlock = (heading: string, content: string) => {
    const wrapped = pdf.splitTextToSize(sanitizePdfText(content), contentWidth) as string[];
    if (wrapped.length === 0) return;
    ensureSpace(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(51, 65, 85);
    pdf.text(heading, margin, y);
    y += 4.2;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(71, 85, 105);
    for (const textLine of wrapped) {
      ensureSpace(4.5);
      pdf.text(textLine, margin, y);
      y += 4;
    }
    y += 3;
  };

  if (docData.notes?.trim()) {
    renderTextBlock('Notes', docData.notes);
  }
  if (docData.terms?.trim()) {
    renderTextBlock('Terms & Conditions', docData.terms);
  }

  // Page footer on all pages
  const totalPages = pdf.getNumberOfPages();
  const footerNote = sanitizePdfText(options?.footerNote || '');
  for (let p = 1; p <= totalPages; p += 1) {
    pdf.setPage(p);
    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    if (footerNote) {
      pdf.text(footerNote, margin, pageHeight - 7.5);
    }
    pdf.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 7.5, {
      align: 'right',
    });
  }

  return pdf;
}

export async function generatePrintableDocumentPdf(
  docData: PdfDocumentInput,
  org: Partial<Organization> | null,
  options?: { footerNote?: string }
): Promise<void> {
  const pdf = await buildPrintableDocumentPdfInstance(docData, org, options);
  const filename = sanitizePdfFilename(docData.docNumber);
  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
