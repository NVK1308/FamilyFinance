import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BENEFICIARY_ID,
  CATEGORY_CODE,
  CONFIRMATION_TYPE,
  MEMBER_ID,
  MESSAGE_INTENT,
  MONEY_HOLDER_ID,
  TRANSACTION_TYPE,
  TRANSFER_STATUS,
  type MemberId,
} from '../src/config/constants.ts';
import { parseVietnameseFinanceMessage } from '../src/parser/index.ts';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const contractsTestCasesPath = path.resolve(
  currentDir,
  '../../shared/contracts/parser-test-cases.json',
);

interface ContractTransactionCase {
  id: string;
  senderId: MemberId;
  rawText: string;
  expected: {
    intent: string;
    loai_giao_dich: string;
    so_tien: number;
    ma_danh_muc: string;
    nguoi_tao_id: string;
    nguoi_thuc_hien_id: string;
    nguoi_giu_tien_id: string | null;
    doi_tuong_thu_huong_id?: string | null;
    ngay_giao_dich?: string;
    requires_confirmation: string[];
    cashflow_impact: number;
  };
}

interface ContractTransferCase {
  id: string;
  senderId: MemberId;
  rawText: string;
  expected: {
    intent: string;
    nguoi_chuyen_id: string;
    nguoi_nhan_id: string;
    so_tien: number;
    ngay_chuyen?: string;
    trang_thai: string;
    nguoi_can_xac_nhan_id: string;
    affects_family_total: boolean;
  };
}

interface ContractFundCase {
  id: string;
  senderId: MemberId;
  rawText: string;
  expected: {
    intent: string;
    chieu: string;
    thanh_vien_id: string;
    so_tien: number;
    ly_do_chua_ho_tro: string | null;
  };
}

interface ContractTestSuite {
  version: string;
  referenceDate: string;
  transactionCases: ContractTransactionCase[];
  transferCases: ContractTransferCase[];
  fundCases: ContractFundCase[];
}

const suite = JSON.parse(fs.readFileSync(contractsTestCasesPath, 'utf8')) as ContractTestSuite;

describe('FamilyFinance Shared Contract Test Cases (parser-test-cases.json)', () => {
  for (const tc of suite.transactionCases) {
    it(`${tc.id}: "${tc.rawText}" (sender: ${tc.senderId})`, () => {
      const result = parseVietnameseFinanceMessage(tc.rawText, {
        senderId: tc.senderId,
        referenceDate: suite.referenceDate,
      });

      assert.equal(result.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
      assert.equal(result.loai_giao_dich, tc.expected.loai_giao_dich);
      assert.equal(result.so_tien, tc.expected.so_tien);
      assert.equal(result.ma_danh_muc, tc.expected.ma_danh_muc);
      assert.equal(result.nguoi_tao_id, tc.expected.nguoi_tao_id);
      assert.equal(result.nguoi_thuc_hien_id, tc.expected.nguoi_thuc_hien_id);
      assert.equal(result.nguoi_giu_tien_id, tc.expected.nguoi_giu_tien_id);

      if (tc.expected.doi_tuong_thu_huong_id !== undefined) {
        assert.equal(result.doi_tuong_thu_huong_id, tc.expected.doi_tuong_thu_huong_id);
      }

      if (tc.expected.ngay_giao_dich !== undefined) {
        assert.equal(result.ngay_giao_dich, tc.expected.ngay_giao_dich);
      }

      assert.deepEqual(result.requires_confirmation, tc.expected.requires_confirmation);
      assert.equal(result.cashflow_impact, tc.expected.cashflow_impact);
    });
  }

  for (const tr of suite.transferCases) {
    it(`${tr.id}: "${tr.rawText}" (sender: ${tr.senderId})`, () => {
      const result = parseVietnameseFinanceMessage(tr.rawText, {
        senderId: tr.senderId,
        referenceDate: suite.referenceDate,
      });

      assert.equal(result.intent, MESSAGE_INTENT.INTERNAL_TRANSFER);
      assert.equal(result.nguoi_chuyen_id, tr.expected.nguoi_chuyen_id);
      assert.equal(result.nguoi_nhan_id, tr.expected.nguoi_nhan_id);
      assert.equal(result.so_tien, tr.expected.so_tien);
      assert.equal(result.trang_thai, tr.expected.trang_thai);
      assert.equal(result.nguoi_can_xac_nhan_id, tr.expected.nguoi_can_xac_nhan_id);
      assert.equal(result.affects_family_total, tr.expected.affects_family_total);
      assert.equal(result.ly_do_chua_ho_tro, null);
      if (tr.expected.ngay_chuyen !== undefined) {
        assert.equal(result.ngay_chuyen, tr.expected.ngay_chuyen);
      }
    });
  }

  for (const fc of suite.fundCases) {
    it(`${fc.id}: "${fc.rawText}" (sender: ${fc.senderId})`, () => {
      const result = parseVietnameseFinanceMessage(fc.rawText, {
        senderId: fc.senderId,
        referenceDate: suite.referenceDate,
      });

      assert.equal(result.intent, MESSAGE_INTENT.FUND_TRANSFER);
      assert.equal(result.chieu, fc.expected.chieu);
      assert.equal(result.thanh_vien_id, fc.expected.thanh_vien_id);
      assert.equal(result.so_tien, fc.expected.so_tien);
      assert.equal(result.ly_do_chua_ho_tro, fc.expected.ly_do_chua_ho_tro);
    });
  }
});

describe('FamilyFinance Phase 2 — Edge Cases & Regression Tests', () => {
  const refDate = '2026-11-04';

  it('Hỗ trợ định dạng số tiền viết tắt 1tr5, 2,5 triệu, 1,200,000d', () => {
    const r1 = parseVietnameseFinanceMessage('chi: tiền học 1tr5', {
      senderId: MEMBER_ID.VO,
      referenceDate: refDate,
    });
    assert.equal(r1.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(r1.so_tien, 1_500_000);
    assert.equal(r1.ma_danh_muc, CATEGORY_CODE.HOC_PHI);

    const r2 = parseVietnameseFinanceMessage('thu: thưởng 2,5 triệu', {
      senderId: MEMBER_ID.CHONG,
      referenceDate: refDate,
    });
    assert.equal(r2.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(r2.so_tien, 2_500_000);
    assert.equal(r2.ma_danh_muc, CATEGORY_CODE.THUONG);

    const r3 = parseVietnameseFinanceMessage('chi: tiền điện 1,200,000d', {
      senderId: MEMBER_ID.CHONG,
      referenceDate: refDate,
    });
    assert.equal(r3.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(r3.so_tien, 1_200_000);
    assert.equal(r3.ma_danh_muc, CATEGORY_CODE.DIEN);
  });

  it('Hỗ trợ ngày hôm qua, hôm kia và dd/mm không nhầm với số tiền hoặc số lượng nhỏ', () => {
    const r1 = parseVietnameseFinanceMessage('CHI: hôm qua mua sữa cho 2 con 450k', {
      senderId: MEMBER_ID.VO,
      referenceDate: refDate,
    });
    assert.equal(r1.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(r1.ngay_giao_dich, '2026-11-03');
    assert.equal(r1.so_tien, 450_000);
    assert.equal(r1.ma_danh_muc, CATEGORY_CODE.SUA);
    // Phase 4: bỏ hỏi phân bổ — nhiều đối tượng thì để đối tượng null
    assert.deepEqual(r1.requires_confirmation, []);
    assert.equal(r1.doi_tuong_thu_huong_id, null);

    const r2 = parseVietnameseFinanceMessage('CHI: ngày 01/11/2026 đổ xăng 100k, tiền chồng giữ', {
      senderId: MEMBER_ID.CHONG,
      referenceDate: refDate,
    });
    assert.equal(r2.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(r2.ngay_giao_dich, '2026-11-01');
    assert.equal(r2.so_tien, 100_000);
    assert.equal(r2.nguoi_giu_tien_id, MONEY_HOLDER_ID.CHONG);
    assert.deepEqual(r2.requires_confirmation, []);
  });

  it('Phân biệt đúng "mua quà cho vợ" (RECORD_TRANSACTION) và "ck cho vợ" (INTERNAL_TRANSFER)', () => {
    const gift = parseVietnameseFinanceMessage('CHI: chồng mua quà cho vợ 500k, tiền chồng giữ', {
      senderId: MEMBER_ID.VO,
      referenceDate: refDate,
    });
    assert.equal(gift.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(gift.nguoi_tao_id, MEMBER_ID.VO);
    assert.equal(gift.nguoi_thuc_hien_id, MEMBER_ID.CHONG);
    assert.equal(gift.doi_tuong_thu_huong_id, BENEFICIARY_ID.VO);
    assert.equal(gift.nguoi_giu_tien_id, MONEY_HOLDER_ID.CHONG);
    assert.equal(gift.ma_danh_muc, CATEGORY_CODE.QUA_TANG);

    const transfer = parseVietnameseFinanceMessage('ck cho vo 2tr5', {
      senderId: MEMBER_ID.CHONG,
      referenceDate: refDate,
    });
    assert.equal(transfer.intent, MESSAGE_INTENT.INTERNAL_TRANSFER);
    assert.equal(transfer.nguoi_chuyen_id, MEMBER_ID.CHONG);
    assert.equal(transfer.nguoi_nhan_id, MEMBER_ID.VO);
    assert.equal(transfer.so_tien, 2_500_000);
    assert.equal(transfer.trang_thai, TRANSFER_STATUS.CHO_XAC_NHAN);
  });

  it('Nhận diện đúng người thực hiện trong câu "THU: lương chồng 25tr"', () => {
    const r = parseVietnameseFinanceMessage('THU: lương chồng 25tr', {
      senderId: MEMBER_ID.VO,
      referenceDate: refDate,
    });
    assert.equal(r.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(r.loai_giao_dich, TRANSACTION_TYPE.THU);
    assert.equal(r.nguoi_tao_id, MEMBER_ID.VO);
    assert.equal(r.nguoi_thuc_hien_id, MEMBER_ID.CHONG);
    assert.equal(r.nguoi_giu_tien_id, MONEY_HOLDER_ID.CHONG);
    assert.equal(r.ma_danh_muc, CATEGORY_CODE.LUONG);
    assert.deepEqual(r.requires_confirmation, []);
  });

  it('Q2: giao dịch từ parser không bao giờ có người giữ tiền null, không đòi xác nhận NGUOI_GIU_TIEN', () => {
    const samples: Array<[string, MemberId]> = [
      ...suite.transactionCases.map((tc): [string, MemberId] => [tc.rawText, tc.senderId]),
      ['tiền ăn', MEMBER_ID.VO],
      ['50k', MEMBER_ID.CHONG],
      ['vay ngân hàng 10tr', MEMBER_ID.CHONG],
      ['CHI: tiền ăn 50k 100k', MEMBER_ID.VO],
    ];
    for (const [text, sender] of samples) {
      const r = parseVietnameseFinanceMessage(text, { senderId: sender, referenceDate: refDate });
      if (r.intent !== MESSAGE_INTENT.RECORD_TRANSACTION) {
        continue;
      }
      assert.notEqual(r.nguoi_giu_tien_id, null, text);
      assert.ok(!r.requires_confirmation.includes(CONFIRMATION_TYPE.NGUOI_GIU_TIEN), text);
    }

    const shared = parseVietnameseFinanceMessage('CHI: đi chợ 200k lấy quỹ chung', {
      senderId: MEMBER_ID.VO,
      referenceDate: refDate,
    });
    assert.equal(shared.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(shared.nguoi_giu_tien_id, MONEY_HOLDER_ID.QUY_CHUNG);
  });

  it('Phase 4: "x hay y" chỉ mơ hồ khi cả 2 là số tiền; buổi + qua/nay ra đúng ngày', () => {
    const month = parseVietnameseFinanceMessage('tiền điện tháng 10 hay 500k', { senderId: MEMBER_ID.VO, referenceDate: refDate });
    assert.equal(month.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(month.so_tien, 500_000);
    const night = parseVietnameseFinanceMessage('tối qua ăn uống 200k', { senderId: MEMBER_ID.VO, referenceDate: refDate });
    assert.equal(night.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(night.ngay_giao_dich, '2026-11-03');
    assert.equal(night.so_tien, 200_000);
  });

  it('Bắt lỗi mơ hồ khi có 2 số tiền độc lập trong cùng một câu', () => {
    const r = parseVietnameseFinanceMessage('CHI: tiền ăn 50k 100k', {
      senderId: MEMBER_ID.VO,
      referenceDate: refDate,
    });
    assert.equal(r.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(r.so_tien, null);
    assert.ok(r.requires_confirmation.includes(CONFIRMATION_TYPE.GIAO_DICH_MO_HO));
  });

  it('Yêu cầu xác nhận DANH_MUC_MOI khi từ khóa chưa có trong từ điển danh mục', () => {
    const r = parseVietnameseFinanceMessage('CHI: mua đàn piano 5tr, lấy quỹ chung', {
      senderId: MEMBER_ID.CHONG,
      referenceDate: refDate,
    });
    assert.equal(r.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
    assert.equal(r.so_tien, 5_000_000);
    assert.equal(r.ma_danh_muc, null);
    assert.deepEqual(r.requires_confirmation, [CONFIRMATION_TYPE.DANH_MUC_MOI]);
  });

  it('Phân loại chính xác QUERY_STATISTICS và EXPORT_HTML_REPORT', () => {
    const q1 = parseVietnameseFinanceMessage('Tháng này vợ chi bao nhiêu?', {
      senderId: MEMBER_ID.CHONG,
      referenceDate: refDate,
    });
    assert.equal(q1.intent, MESSAGE_INTENT.QUERY_STATISTICS);

    const q2 = parseVietnameseFinanceMessage('So sánh tháng này với tháng trước', {
      senderId: MEMBER_ID.VO,
      referenceDate: refDate,
    });
    assert.equal(q2.intent, MESSAGE_INTENT.QUERY_STATISTICS);

    const html = parseVietnameseFinanceMessage('Xuất báo cáo HTML tháng này', {
      senderId: MEMBER_ID.CHONG,
      referenceDate: refDate,
    });
    assert.equal(html.intent, MESSAGE_INTENT.EXPORT_HTML_REPORT);
  });
});

