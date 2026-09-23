/**
 * Hawasb Cafe POS - Shift Reports & Historical Admin View
 */

import { request, showToast } from './api.js';
import { currentShift } from './shift.js';

export function initReports() {
  const reportModal = document.getElementById('report-modal');
  const btnOpenReport = document.getElementById('btn-open-report');
  const btnCloseReport = document.getElementById('btn-close-report');

  const shiftsHistoryModal = document.getElementById('shifts-history-modal');
  const btnOpenHistory = document.getElementById('btn-open-shifts-history');
  const btnCloseHistory = document.getElementById('btn-close-shifts-history');

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

  if (btnOpenHistory) {
    btnOpenHistory.onclick = async () => {
      try {
        const shifts = await request('/api/shifts');
        renderShiftsHistoryList(shifts);
        shiftsHistoryModal.classList.remove('hidden');
      } catch (err) {
        showToast('تعذر تحميل سجل الورديات', 'error');
      }
    };
  }

  if (btnCloseHistory) {
    btnCloseHistory.onclick = () => shiftsHistoryModal.classList.add('hidden');
  }
}

export function renderReportData(report) {
  // Sales Breakdown
  document.getElementById('rep-cash-sales').innerText = `${report.sales.cash_sales.toFixed(2)} ج.م`;
  document.getElementById('rep-vf-sales').innerText = `${report.sales.vodafone_cash_sales.toFixed(2)} ج.م`;
  document.getElementById('rep-shakak-sales').innerText = `${report.sales.credit_shakak_sales.toFixed(2)} ج.م`;
  document.getElementById('rep-total-sales').innerText = `${report.sales.total_sales.toFixed(2)} ج.م`;

  // Drawer Cash Reconciliation
  document.getElementById('rep-start-cash').innerText = `${report.cash_drawer.starting_cash.toFixed(2)} ج.م`;
  document.getElementById('rep-exp-cash').innerText = `${report.cash_drawer.closing_cash_expected.toFixed(2)} ج.م`;
  document.getElementById('rep-commission-earned').innerText = `${report.commission.earned.toFixed(2)} ج.م (${report.commission.rate_percentage} من الكاش)`;

  const discEl = document.getElementById('rep-cash-discrepancy');
  if (report.cash_drawer.discrepancy !== null) {
    const disc = report.cash_drawer.discrepancy;
    discEl.innerText = `${disc.toFixed(2)} ج.م`;
    discEl.className = disc < 0 ? 'font-bold text-rose-600' : 'font-bold text-emerald-600';
  } else {
    discEl.innerText = 'بانتظار الجرد اليدوي';
    discEl.className = 'font-bold text-gray-400';
  }

  // Drawer Money-Split Guidance for Owner
  document.getElementById('rep-cogs-reserve').innerText = `${report.drawer_split.restocking_cogs_reserve.toFixed(2)} ج.م`;
  document.getElementById('rep-owner-drawer-cash').innerText = `${report.drawer_split.owner_drawer_net_cash.toFixed(2)} ج.م`;
  document.getElementById('rep-vf-pure-profit').innerText = `${report.drawer_split.vodafone_pure_profit.toFixed(2)} ج.م`;
  document.getElementById('rep-shakak-profit').innerText = `${report.drawer_split.shakak_pure_profit.toFixed(2)} ج.م`;
  document.getElementById('rep-total-owner-profit').innerText = `${report.drawer_split.total_owner_profit.toFixed(2)} ج.م`;

  // Items Sold List
  const itemsContainer = document.getElementById('rep-items-sold-list');
  itemsContainer.innerHTML = '';
  if (report.items_breakdown && report.items_breakdown.length > 0) {
    report.items_breakdown.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'flex justify-between py-1 border-b border-gray-100 text-[11px]';
      row.innerHTML = `
        <span class="font-semibold text-gray-700">${item.item_name} × ${item.quantity_sold}</span>
        <span class="text-gray-900">${item.revenue.toFixed(2)} ج.م <small class="text-emerald-700">(ربح: ${item.profit.toFixed(2)})</small></span>
      `;
      itemsContainer.appendChild(row);
    });
  } else {
    itemsContainer.innerHTML = '<span class="text-gray-400 text-xs">لا توجد مبيعات مسجلة في هذه الوردية</span>';
  }

  // Handover Shortages List
  const shortagesContainer = document.getElementById('rep-shortages-list');
  shortagesContainer.innerHTML = '';
  if (report.handover_shortages && report.handover_shortages.length > 0) {
    report.handover_shortages.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'flex justify-between py-1 border-b border-rose-50 text-[11px] text-rose-800';
      row.innerHTML = `
        <span>${s.item_name} (عجز: ${s.shortage_qty})</span>
        <span class="font-bold">${s.shortage_cost.toFixed(2)} ج.م [حُمّلت على: ${s.charged_cashier}]</span>
      `;
      shortagesContainer.appendChild(row);
    });
  } else {
    shortagesContainer.innerHTML = '<span class="text-gray-400 text-xs">لا يوجد عجز جرد مسجل</span>';
  }
}

function renderShiftsHistoryList(shifts) {
  const container = document.getElementById('shifts-history-table-body');
  container.innerHTML = '';

  shifts.forEach((s) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-gray-100 hover:bg-gray-50 text-xs cursor-pointer';
    tr.innerHTML = `
      <td class="p-2 font-bold text-gray-900">#${s.id}</td>
      <td class="p-2 text-gray-700">${s.cashier_name}</td>
      <td class="p-2 text-gray-500">${new Date(s.start_time).toLocaleString('ar-EG')}</td>
      <td class="p-2 font-bold text-emerald-700">${Number(s.total_sales || 0).toFixed(2)} ج.م</td>
      <td class="p-2 ${Number(s.cash_discrepancy) < 0 ? 'text-rose-600 font-bold' : 'text-gray-600'}">
        ${s.cash_discrepancy !== null ? `${Number(s.cash_discrepancy).toFixed(2)} ج.م` : 'غير محدد'}
      </td>
      <td class="p-2">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
          s.status === 'open' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'
        }">${s.status === 'open' ? 'نشطة' : 'مغلقة'}</span>
      </td>
      <td class="p-2 text-left">
        <button class="btn-view-shift-report px-2 py-1 bg-emerald-600 text-white rounded text-[11px] font-bold">
          عرض التقرير
        </button>
      </td>
    `;

    tr.querySelector('.btn-view-shift-report').onclick = async () => {
      try {
        const report = await request(`/api/shifts/${s.id}/report`);
        renderReportData(report);
        document.getElementById('report-modal').classList.remove('hidden');
      } catch (err) {
        showToast('تعذر استخراج تقرير هذه الوردية', 'error');
      }
    };

    container.appendChild(tr);
  });
}