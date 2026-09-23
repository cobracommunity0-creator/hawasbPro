/**
 * Hawasb Cafe POS - Shift Reports & Profitability Rendering
 */

import { request, showToast } from './api.js';
import { currentShift } from './shift.js';

export function initReports() {
  const reportModal = document.getElementById('report-modal');
  const btnOpenReport = document.getElementById('btn-open-report');
  const btnCloseReport = document.getElementById('btn-close-report');

  btnOpenReport.onclick = async () => {
    if (!currentShift) {
      showToast('لا توجد وردية مفتوحة لعرض تقريرها!', 'error');
      return;
    }

    try {
      const report = await request(`/api/shifts/${currentShift.id}/report`);
      renderReportData(report);
      reportModal.classList.remove('hidden');
    } catch (err) {
      showToast('فشل في استخراج تقرير الوردية', 'error');
    }
  };

  btnCloseReport.onclick = () => reportModal.classList.add('hidden');
}

function renderReportData(report) {
  // Sales Breakdown
  document.getElementById('rep-cash-sales').innerText = `${report.sales.cash_sales.toFixed(2)} ج.م`;
  document.getElementById('rep-vf-sales').innerText = `${report.sales.vodafone_cash_sales.toFixed(2)} ج.م`;
  document.getElementById('rep-shakak-sales').innerText = `${report.sales.credit_shakak_sales.toFixed(2)} ج.م`;
  document.getElementById('rep-total-sales').innerText = `${report.sales.total_sales.toFixed(2)} ج.م`;

  // Cash Drawer Flow
  document.getElementById('rep-start-cash').innerText = `${report.cash_drawer.starting_cash.toFixed(2)} ج.م`;
  document.getElementById('rep-exp-cash').innerText = `${report.cash_drawer.closing_cash_expected.toFixed(2)} ج.م`;
  document.getElementById('rep-commission-earned').innerText = `${report.commission.earned.toFixed(2)} ج.م (${report.commission.rate_percentage})`;

  // Discrepancy
  const discEl = document.getElementById('rep-cash-discrepancy');
  if (report.cash_drawer.discrepancy !== null) {
    const disc = report.cash_drawer.discrepancy;
    discEl.innerText = `${disc.toFixed(2)} ج.م`;
    discEl.className = disc < 0 ? 'font-bold text-rose-600' : 'font-bold text-emerald-600';
  } else {
    discEl.innerText = 'بانتظار الجرد';
    discEl.className = 'font-bold text-gray-400';
  }

  // Profitability
  document.getElementById('rep-gross-profit').innerText = `${report.profitability.gross_profit.toFixed(2)} ج.م`;
  document.getElementById('rep-net-profit').innerText = `${report.profitability.net_profit.toFixed(2)} ج.م`;
}