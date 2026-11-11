import type { DatabaseAdapter } from '../db/types.ts';
import { ReportService, reportPeriod, type ReportData } from '../services/report-service.ts';
import type { BotAction } from '../telegram/types.ts';
import { CARD_HEIGHT, CARD_WIDTH, fullReportHtml, reportCaption, reportFallbackText, summaryCardHtml } from './report-html.ts';

// Phase 6: 1 báo cáo → ảnh tóm tắt (chụp từ HTML) + file HTML đầy đủ cho từng người nhận

export function reportActions(d: ReportData, chatIds: readonly number[]): BotAction[] {
  const card = summaryCardHtml(d);
  // File đầy đủ dựng 1 lần, lúc gửi file đầu tiên (sau ảnh)
  let cached: string | null = null;
  const full = (): string => (cached ??= fullReportHtml(d));
  const filename = `bao-cao-${d.period.from.slice(0, 7)}.html`;
  return chatIds.flatMap((chatId): BotAction[] => [
    { type: 'photo', chatId, html: card, width: CARD_WIDTH, height: CARD_HEIGHT, caption: reportCaption(d), fallbackText: reportFallbackText(d) },
    { type: 'document', chatId, filename, content: full, caption: 'Báo cáo đầy đủ — mở bằng trình duyệt.' },
  ]);
}

// Báo cáo của tháng month (null = tháng này, tính đến hôm nay)
export function buildReport(db: DatabaseAdapter, now: () => Date, today: string, month: { y: number; m: number } | null): Promise<ReportData> {
  const { period, asOf, partial } = reportPeriod(today, month);
  return new ReportService(db, { now }).build(period, asOf, partial);
}

// Tháng trước của ngày VN today
export function previousMonth(today: string): { y: number; m: number } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}
