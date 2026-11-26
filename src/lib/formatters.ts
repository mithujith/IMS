export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatLKR(amount: number | undefined | null): string {
  const num = roundCurrency(Number(amount ?? 0));
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}Rs. ${formatted}`;
}

export function formatDateISO(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function formatDisplayDate(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'string') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
  return '—';
}

export function formatRelativeTime(value: unknown): string {
  let date: Date | null = null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  } else if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    date = (value as { toDate: () => Date }).toDate();
  }
  if (!date) return 'just now';
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDisplayDate(date.toISOString());
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function threeDigitsToWords(n: number): string {
  let res = '';
  if (n >= 100) {
    res += `${ONES[Math.floor(n / 100)]} Hundred`;
    n %= 100;
    if (n > 0) res += ' ';
  }
  if (n >= 20) {
    res += TENS[Math.floor(n / 10)];
    if (n % 10 > 0) res += ` ${ONES[n % 10]}`;
  } else if (n > 0) {
    res += ONES[n];
  }
  return res;
}

function integerToWords(n: number): string {
  if (n === 0) return 'Zero';
  const scales = ['', 'Thousand', 'Million', 'Billion'];
  let words: string[] = [];
  let scaleIdx = 0;
  let num = Math.floor(n);
  while (num > 0) {
    const chunk = num % 1000;
    if (chunk > 0) {
      const chunkWords = threeDigitsToWords(chunk);
      words.unshift(scales[scaleIdx] ? `${chunkWords} ${scales[scaleIdx]}` : chunkWords);
    }
    num = Math.floor(num / 1000);
    scaleIdx += 1;
  }
  return words.join(' ').trim();
}

export function amountInWordsLKR(amount: number): string {
  const rounded = Math.abs(roundCurrency(amount));
  const rupees = Math.floor(rounded);
  const cents = Math.round((rounded - rupees) * 100);
  const rupeesPart = `Sri Lankan Rupees ${integerToWords(rupees)}`;
  if (cents > 0) {
    return `${rupeesPart} and ${integerToWords(cents)} Cents Only`;
  }
  return `${rupeesPart} Only`;
}
