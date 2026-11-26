import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPrintableDocumentPdfInstance,
  computeSummaryRows,
  sanitizePdfFilename,
  sanitizePdfText,
} from './pdfGenerator';

test('sanitizePdfFilename creates safe PDF filenames', () => {
  assert.equal(sanitizePdfFilename('INV-000001'), 'INV-000001.pdf');
  assert.equal(sanitizePdfFilename('INV / 2026 #4'), 'INV___2026__4.pdf');
  assert.equal(sanitizePdfFilename(''), 'document.pdf');
});

test('sanitizePdfText normalizes smart punctuation and removes unsupported glyphs', () => {
  assert.equal(
    sanitizePdfText('A & P “Brothers” — Colombo 10 · Spares 🔧'),
    'A & P "Brothers" - Colombo 10 · Spares '
  );
  assert.equal(sanitizePdfText(null), '');
});

test('computeSummaryRows includes discount, shipping, adjustment, payment, and balance rows cleanly', () => {
  const rows = computeSummaryRows({
    docTitle: 'TAX INVOICE',
    docNumber: 'INV-000012',
    date: '2026-11-20',
    partyLabel: 'Bill To',
    partyName: 'Lanka Moto Spares',
    status: 'partially_paid',
    lines: [],
    subtotal: 10000,
    discountAmount: 500,
    taxTotal: 1710,
    shippingCharges: 350,
    adjustment: -10,
    total: 11550,
    amountPaid: 5000,
    balanceDue: 6550,
  });

  assert.deepEqual(
    rows.map((r) => r.label),
    ['Sub Total', 'Discount', 'Tax Total', 'Shipping', 'Adjustment', 'Total', 'Payment Made', 'Balance Due']
  );
  assert.equal(rows[1].tone, 'danger');
  assert.equal(rows[6].tone, 'success');
  assert.equal(rows[5].bold, true);
});

test('buildPrintableDocumentPdfInstance generates valid single-page A4 PDF with large LKR values', async () => {
  const pdf = await buildPrintableDocumentPdfInstance(
    {
      docTitle: 'TAX INVOICE',
      docNumber: 'INV-000099',
      date: '2026-11-26',
      dueDate: '2026-12-26',
      partyLabel: 'Bill To',
      partyName: 'Kandy Hill Motorcycle Spare Parts & Service Centre (Pvt) Ltd',
      partyAddress: 'No. 48 Peradeniya Road, Kandy',
      status: 'sent',
      lines: [
        {
          itemId: 'i1',
          itemName: 'PETROL PIPE PULSAR/DISCOVER 270mm HEAVY DUTY FUEL LINE',
          sku: 'YYPP005',
          unit: 'PCS',
          quantity: 120,
          rate: 125000.5,
          discountType: 'amount',
          discountValue: 15000,
          lineSubtotal: 15000060,
          lineDiscount: 15000,
          taxRate: 18,
          lineTax: 2697300,
          lineTotal: 17682360,
        },
      ],
      subtotal: 15000060,
      discountAmount: 15000,
      taxTotal: 2697300,
      shippingCharges: 2500,
      total: 17684860,
      amountPaid: 5000000,
      balanceDue: 12684860,
      notes: 'Thank you for doing business with A & P Brothers.',
      terms: 'Goods once sold cannot be returned without original invoice.',
    },
    {
      name: 'A & P Brothers (Pvt) Ltd — Head Office & Distribution',
      address: 'No. 142, Panchikawatta Road',
      city: 'Colombo 10',
      country: 'Sri Lanka',
      phone: '+94 11 243 8890',
      email: 'sales@apbrothers.lk',
      taxId: 'VAT-114892034-7000',
    },
    { footerNote: 'A & P Brothers (Pvt) Ltd', skipLogoFetch: true }
  );

  assert.equal(pdf.getNumberOfPages(), 1);
  assert.equal(Math.round(pdf.internal.pageSize.getWidth()), 210);
  assert.equal(Math.round(pdf.internal.pageSize.getHeight()), 297);
  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  const header = String.fromCharCode(...bytes.slice(0, 5));
  assert.equal(header, '%PDF-');
});

test('buildPrintableDocumentPdfInstance paginates multi-page invoices cleanly', async () => {
  const lines = Array.from({ length: 34 }, (_, idx) => ({
    itemId: `item-${idx + 1}`,
    itemName: `Spare Part Component #${idx + 1} for Bajaj Pulsar / Honda Dio`,
    sku: `SKU-${String(idx + 1).padStart(4, '0')}`,
    unit: 'PCS',
    quantity: 5 + idx,
    rate: 1250,
    discountType: 'percent' as const,
    discountValue: 0,
    lineSubtotal: (5 + idx) * 1250,
    lineDiscount: 0,
    taxRate: 18,
    lineTax: 1125,
    lineTotal: 7375,
  }));

  const pdf = await buildPrintableDocumentPdfInstance(
    {
      docTitle: 'PURCHASE ORDER',
      docNumber: 'PO-00042',
      date: '2026-11-26',
      partyLabel: 'Vendor',
      partyName: 'Colombo Auto Imports Ltd',
      status: 'issued',
      lines,
      subtotal: 212500,
      taxTotal: 38250,
      total: 250750,
      notes: 'Deliver to WH-MAIN loading bay before 4 PM.',
      terms: '1. Inspect all sealed cartons on delivery.\n2. Include packing list and tax invoice.',
    },
    { name: 'A & P Brothers (Pvt) Ltd' },
    { skipLogoFetch: true }
  );

  assert.ok(pdf.getNumberOfPages() >= 2);
});
