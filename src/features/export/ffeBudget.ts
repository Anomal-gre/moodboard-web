import type { Card, StudioProfile } from '../../domain/types';

export type CurrencyCode = 'VND' | 'USD';

/**
 * Parses flexible interior-designer price strings into numeric values:
 * Examples:
 * - "12.500.000 đ" -> 12500000
 * - "12,500,000 VND" -> 12500000
 * - "12.5tr" / "12,5 triệu" -> 12500000
 * - "850k" -> 850000
 * - "$1,250.50" / "1250 USD" -> 1250.5
 */
export function parsePriceAmount(raw?: string): number | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.trim().toLowerCase();

  // Detect shorthand multipliers: tr / triệu / m (million) or k / nghìn (thousand)
  const trMatch = cleaned.match(/(\d+(?:[.,]\d+)?)\s*(?:tr\b|triệu|trieu)/i);
  if (trMatch) {
    const val = parseFloat(trMatch[1].replace(',', '.'));
    return Number.isFinite(val) ? Math.round(val * 1_000_000) : null;
  }

  const kMatch = cleaned.match(/(\d+(?:[.,]\d+)?)\s*(?:k\b|nghìn|nghin)/i);
  if (kMatch) {
    const val = parseFloat(kMatch[1].replace(',', '.'));
    return Number.isFinite(val) ? Math.round(val * 1_000) : null;
  }

  // Extract first numeric token (handling thousand separators like 12.500.000 or 1,250.50)
  const numMatch = cleaned.match(/\d[\d.,\s]*/);
  if (!numMatch) return null;
  const token = numMatch[0].replace(/\s+/g, '');

  // Multiple dots (e.g. 12.500.000) -> dots are thousand separators
  if ((token.match(/\./g) || []).length >= 2) {
    const val = parseFloat(token.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(val) ? val : null;
  }
  // Multiple commas (e.g. 12,500,000) -> commas are thousand separators
  if ((token.match(/,/g) || []).length >= 2) {
    const val = parseFloat(token.replace(/,/g, ''));
    return Number.isFinite(val) ? val : null;
  }
  // Single dot with exact 3 digits after (e.g. 850.000 or 1.850) -> Vietnamese thousands
  if (/^\d{1,3}\.\d{3}$/.test(token)) {
    const val = parseFloat(token.replace('.', ''));
    return Number.isFinite(val) ? val : null;
  }
  // Single comma with exact 3 digits after (e.g. 1,250) -> thousands
  if (/^\d{1,3},\d{3}$/.test(token)) {
    const val = parseFloat(token.replace(',', ''));
    return Number.isFinite(val) ? val : null;
  }
  // Otherwise normalize comma decimal -> dot decimal
  const normalized = token.replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  const val = parseFloat(normalized);
  return Number.isFinite(val) && val >= 0 ? val : null;
}

export function detectCurrency(cards: Card[], profile?: StudioProfile): CurrencyCode {
  if (profile?.currency === 'USD' || profile?.currency === 'VND') {
    return profile.currency;
  }
  let usdHits = 0;
  let vndHits = 0;
  for (const c of cards) {
    const p = (c.spec?.price || '').toLowerCase();
    if (!p) continue;
    if (p.includes('$') || p.includes('usd')) usdHits++;
    if (p.includes('đ') || p.includes('vnd') || p.includes('tr') || p.includes('k')) vndHits++;
  }
  return usdHits > vndHits ? 'USD' : 'VND';
}

export function formatCurrency(amount: number, currency: CurrencyCode): string {
  if (currency === 'USD') {
    const hasCents = Math.abs(amount - Math.round(amount)) > 0.001;
    return `$${amount.toLocaleString('en-US', {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    })}`;
  }
  return `${Math.round(amount).toLocaleString('vi-VN')} ₫`;
}

export interface FfeBudgetRow {
  card: Card;
  qty: number;
  unitAmount: number | null;
  lineTotal: number | null;
}

export interface FfeBudgetSummary {
  rows: FfeBudgetRow[];
  currency: CurrencyCode;
  grandTotal: number;
  pricedCount: number;
}

export function computeFfeBudget(
  cards: Card[],
  profile?: StudioProfile
): FfeBudgetSummary {
  const items = cards.filter((c) => c.kind !== 'frame');
  const currency = detectCurrency(items, profile);
  let grandTotal = 0;
  let pricedCount = 0;

  const rows: FfeBudgetRow[] = items.map((card) => {
    const qty = Math.max(1, card.spec?.qty ?? 1);
    const unitAmount = parsePriceAmount(card.spec?.price);
    const lineTotal = unitAmount !== null ? unitAmount * qty : null;
    if (lineTotal !== null) {
      grandTotal += lineTotal;
      pricedCount++;
    }
    return { card, qty, unitAmount, lineTotal };
  });

  return { rows, currency, grandTotal, pricedCount };
}
