/**
 * Hawasb Cafe POS - Full-Screen Shift History & Executive Reporting Engine
 */

import { request, showToast } from './api.js';
import { currentShift } from './shift.js';

let shiftsList = [];
let selectedShiftId = null;

export function initReports() {
  const shiftsPage = document.getElementById('shifts-history-page');
  const btnOpenHistory = document.getElementById('btn-open-shifts-history');
  const btnCloseHistory = document.getElementById('btn-close-shifts-history');
  const btnOpenCurrentReport = document.getElementById('btn-open-report');

  // Open Full-Screen Shifts History (Admin)
  if (btnOpenHistory) {
    btnOpenHistory.onclick = async () => {
      try {
        shiftsPage.classList.remove('hidden');
        await loadAndRenderShifts();
      } catch (err) {
        showToast('تعذر تحميل سجل الورديات', 'error');
      }
    };
  }

  // Close Full-Screen Shifts History & Return to POS
  if (btnCloseHistory) {
    btnCloseHistory.onclick = () => {
      shiftsPage.classList.add('hidden');
    };
  }

  // "تقرير الوردية" button in the top bar opens the current active shift directly in the full view
  if (btnOpenCurrentReport) {
    btnOpenCurrentReport.onclick = async () => {
      if (!currentShift) {
        showToast('لا توجد وردية مفتوحة حالياً لعرض تقريرها', 'error');
        return;
      }
      shiftsPage.classList.remove('hidden');
      await loadAndRenderShifts(currentShift.id);
    };
  }

  // Shift list search input
  const searchInput = document.getElementById('shift-search-input');
  if (searchInput) {
    searchInput.oninput = () => {
      renderShiftsSidebar(searchInput.value.trim().toLowerCase());
    };
  }
}

async function loadAndRenderShifts(defaultSelectId = null) {
  try {
    shiftsList = await request('/api/shifts');
    if (!shiftsList || shiftsList.length === 0) {
      document.getElementById('shifts-sidebar-list').innerHTML = `
        <div class="text-center py-12 text-slate-500 text-xs">لا توجد ورديات مسجلة في المنظومة</div>`;
      document.getElementById('shift-dossier-content').innerHTML = `
        <div class="flex flex-col items-center justify-center h-full text-slate-500 text-sm">
          <span class="text-4xl mb-2">📋</span>
          <p>لا توجد بيانات ورديات لعرضها</p>
        </div>`;
      return;
    }

    renderShiftsSidebar();

    // Select specified shift, or default to the most recent one
    const targetId = defaultSelectId || shiftsList[0].id;
    await selectShift(targetId);
  } catch (err) {
    console.error('[Load Shifts Error]:', err);
    showToast('فشل في جلب سجل الورديات من الخادم', 'error');
  }
}

function renderShiftsSidebar(searchTerm = '') {
  const container = document.getElementById('shifts-sidebar-list');
  container.innerHTML = '';

  const filtered = shiftsList.filter((s) => {
    if (!searchTerm) return true;
    const nameMatch = (s.cashier_name || '').toLowerCase().includes(searchTerm);
    const idMatch = String(s.id).includes(searchTerm);
    return nameMatch || idMatch;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="text-center py-8 text-slate-500 text-xs">لا توجد وردية تطابق البحث</div>';
    return;
  }

  filtered.forEach((s) => {
    const isSelected = s.id === selectedShiftId;
    const card = document.createElement('div');
    const hasDiscrepancy = s.cash_discrepancy !== null && Number(s.cash_discrepancy) !== 0;
    const isNegativeDisc = Number(s.cash_discrepancy) < 0;

    card.className = `p-3 rounded-xl cursor-pointer transition-all border ${
      isSelected
        ? 'bg-cyan-950/40 border-cyan-500 shadow-md ring-1 ring-cyan-500/50'
        : 'bg-slate-900/60 border-slate-800 hover:bg-slate-850 hover:border-slate-700'
    }`;

    const startDate = new Date(s.start_time);
    const timeFormatted = startDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const dateFormatted = startDate.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });

    card.innerHTML = `
      <div class="flex items-center justify-between mb-1.5">
        <div class="flex items-center space-x-1.5 space-x-reverse">
          <span class="px-2 py-0.5 rounded text-[11px] font-black ${
            s.status === 'open'
              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/80 animate-pulse'
              : 'bg-slate-800 text-slate-300 border border-slate-700'
          }">وردية #${s.id}</span>
          <span class="text-xs font-bold text-slate-100">${s.cashier_name}</span>
        </div>
        <span class="text-[10px] text-slate-400 font-medium">${dateFormatted} • ${timeFormatted}</span>
      </div>

      <div class="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-800/80">
        <div>
          <span class="text-[10px] text-slate-400 block">إجمالي المبيعات:</span>
          <span class="font-extrabold text-cyan-400">${Number(s.total_sales || 0).toFixed(2)} ج.م</span>
        </div>
        <div class="text-left">
          ${
            hasDiscrepancy
              ? `<span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${                   isNegativeDisc ? 'bg-rose-950/80 text-rose-400 border border-rose-800' : 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'                 }">عجز/زيادة: ${Number(s.cash_discrepancy).toFixed(2)}</span>`
              : `<span class="text-[10px] text-slate-400 font-medium">${s.status === 'open' ? 'نشطة حالياً' : 'الدرج متطابق ✓'}</span>`
          }
        </div>
      </div>
    `;

    card.onclick = () => selectShift(s.id);
    container.appendChild(card);
  });
}

async function selectShift(shiftId) {
  selectedShiftId = shiftId;
  renderShiftsSidebar(document.getElementById('shift-search-input')?.value || '');

  const container = document.getElementById('shift-dossier-content');
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-24 text-cyan-400">
      <span class="inline-block animate-spin text-3xl mb-3">⏳</span>
      <p class="text-sm font-semibold">جاري استخراج التقرير التفصيلي والمبيعات...</p>
    </div>`;

  try {
    const report = await request(`/api/shifts/${shiftId}/report`);
    renderShiftDossier(report);
  } catch (err) {
    container.innerHTML = `
      <div class="text-center py-20 text-rose-400 text-sm">
        فشل في استخراج بيانات الوردية رقم #${shiftId}
      </div>`;
  }
}

function renderShiftDossier(report) {
  const container = document.getElementById('shift-dossier-content');
  const info = report.shift_info;
  const sales = report.sales;
  const drawer = report.cash_drawer;
  const split = report.drawer_split;
  const comm = report.commission;
  const items = report.items_breakdown || [];
  const shortages = report.handover_shortages || [];

  const startDate = new Date(info.start_time).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  const endDate = info.end_time ? new Date(info.end_time).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : 'مستمرة حتى الآن';

  // Compute Total Sold Items Quantity
  const totalItemsSoldQty = items.reduce((sum, it) => sum + it.quantity_sold, 0);

  container.innerHTML = `
    <!-- 1. Header Banner -->
    <div class="bg-[#0b1024] p-5 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md">
      <div>
        <div class="flex items-center space-x-2.5 space-x-reverse">
          <span class="text-2xl font-black text-white">تقرير الوردية #${info.id}</span>
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${
            info.status === 'open' ? 'bg-emerald-950 text-emerald-400 border border-emerald-700' : 'bg-slate-800 text-slate-300'
          }">${info.status === 'open' ? 'نشطة الآن' : 'وردية مغلقة'}</span>
        </div>
        <p class="text-xs text-slate-400 mt-1.5 flex items-center space-x-3 space-x-reverse">
          <span><b>الشيفتاجي:</b> <span class="text-cyan-400">${info.cashier_name}</span></span>
          <span>•</span>
          <span><b>البدء:</b> ${startDate}</span>
          <span>•</span>
          <span><b>الانتهاء:</b> ${endDate}</span>
        </p>
      </div>

      <div class="flex items-center space-x-3 space-x-reverse">
        <div class="text-left bg-slate-900/80 px-4 py-2 rounded-xl border border-slate-750">
          <span class="text-[10px] text-slate-400 block font-semibold">إجمالي المبيعات الكاملة</span>
          <span class="text-xl font-black text-cyan-400">${sales.total_sales.toFixed(2)} <small class="text-xs font-normal">ج.م</small></span>
        </div>
      </div>
    </div>

    <!-- 2. Financial Channels KPI Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
      <!-- Cash Sales -->
      <div class="bg-[#0c1229] p-4 rounded-xl border border-slate-800">
        <span class="text-xs font-bold text-slate-400 block mb-1">كاش الدرج (مبيعات نقدية)</span>
        <span class="text-xl font-black text-emerald-400">${sales.cash_sales.toFixed(2)} <small class="text-xs">ج.م</small></span>
        <span class="text-[10px] text-slate-500 block mt-1">+ ${sales.debt_collected_cash.toFixed(2)} ج.م تحصيلات شكك نقدية</span>
      </div>

      <!-- Vodafone Cash -->
      <div class="bg-[#0c1229] p-4 rounded-xl border border-slate-800">
        <span class="text-xs font-bold text-slate-400 block mb-1">فودافون كاش (محفظة المالك)</span>
        <span class="text-xl font-black text-rose-400">${sales.vodafone_cash_sales.toFixed(2)} <small class="text-xs">ج.م</small></span>
        <span class="text-[10px] text-emerald-400 font-semibold block mt-1">100% ربح خالص لحسابك</span>
      </div>

      <!-- Shakak Credit -->
      <div class="bg-[#0c1229] p-4 rounded-xl border border-slate-800">
        <span class="text-xs font-bold text-slate-400 block mb-1">شكك (حسابات آجلة للزبائن)</span>
        <span class="text-xl font-black text-amber-400">${sales.credit_shakak_sales.toFixed(2)} <small class="text-xs">ج.م</small></span>
        <span class="text-[10px] text-slate-400 block mt-1">مُثبتة بأسماء العملاء في الدفتر</span>
      </div>

      <!-- Cashier Commission -->
      <div class="bg-[#0c1229] p-4 rounded-xl border border-slate-800">
        <span class="text-xs font-bold text-slate-400 block mb-1">عمولة الشيفتاجي المستحقة</span>
        <span class="text-xl font-black text-cyan-300">${comm.earned.toFixed(2)} <small class="text-xs">ج.م</small></span>
        <span class="text-[10px] text-slate-400 block mt-1">${comm.rate_percentage} محسوبة من الكاش فقط</span>
      </div>
    </div>

    <!-- 3. Drawer Reconciliation & Money-Split Plan -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
      <!-- Drawer Cash Balance Card -->
      <div class="bg-[#0c1229] p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
        <div>
          <h4 class="text-sm font-black text-white mb-3 flex items-center space-x-2 space-x-reverse">
            <span>💵</span>
            <span>حركة ومطابقة نقدية الدرج الفعلي</span>
          </h4>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between py-1 border-b border-slate-800 text-slate-300">
              <span>نقدية بداية الوردية (العهدة):</span>
              <b class="font-bold text-white">${drawer.starting_cash.toFixed(2)} ج.م</b>
            </div>
            <div class="flex justify-between py-1 border-b border-slate-800 text-slate-300">
              <span>مبيعات الكاش بالدرج:</span>
              <b class="font-bold text-emerald-400">+ ${drawer.cash_sales.toFixed(2)} ج.م</b>
            </div>
            <div class="flex justify-between py-1 border-b border-slate-800 text-slate-300">
              <span>تحصيلات شكك مقبوضة كاش:</span>
              <b class="font-bold text-emerald-400">+ ${drawer.debt_collected.toFixed(2)} ج.م</b>
            </div>
            <div class="flex justify-between py-1 border-b border-slate-800 text-slate-300">
              <span>مصروفات وسحوبات من الدرج:</span>
              <b class="font-bold text-rose-400">- ${drawer.expenses.toFixed(2)} ج.م</b>
            </div>
            <div class="flex justify-between py-1 border-b border-slate-800 font-bold text-slate-200">
              <span>المبلغ المتوقع وجوده في الدرج:</span>
              <span class="text-cyan-400 font-extrabold text-sm">${drawer.closing_cash_expected.toFixed(2)} ج.م</span>
            </div>
            <div class="flex justify-between py-1 border-b border-slate-800 font-bold text-slate-200">
              <span>المبلغ الفعلي المحسوب بالجرد:</span>
              <span class="text-white font-extrabold text-sm">${drawer.closing_cash_actual !== null ? `${drawer.closing_cash_actual.toFixed(2)} ج.م` : 'بانتظار التسليم'}</span>
            </div>
          </div>
        </div>

        <div class="mt-3 p-3 rounded-xl ${
          drawer.discrepancy === null
            ? 'bg-slate-900 border border-slate-800 text-slate-400'
            : drawer.discrepancy < 0
            ? 'bg-rose-950/60 border border-rose-800 text-rose-300'
            : 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
        } text-xs flex items-center justify-between">
          <span class="font-bold">فارق الدرج النهائي (عجز / زيادة):</span>
          <span class="text-sm font-black">${
            drawer.discrepancy !== null ? `${drawer.discrepancy.toFixed(2)} ج.م` : 'غير محدد بعد'
          }</span>
        </div>
      </div>

      <!-- Owner Money-Split Guidance -->
      <div class="bg-gradient-to-br from-[#0c1229] to-[#081026] p-4 rounded-2xl border border-cyan-900/40 flex flex-col justify-between">
        <div>
          <h4 class="text-sm font-black text-cyan-300 mb-3 flex items-center space-x-2 space-x-reverse">
            <span>💼</span>
            <span>خطة تقسيم أموال الدرج الصافية للمالك</span>
          </h4>
          <p class="text-[11px] text-slate-400 mb-3 leading-relaxed">
            وفقاً لقاعدتك: تكلفة البضاعة المباعة تُجنب من كاش الدرج لحساب شراء النواقص، وتعتبر مبيعات فودافون كاش والشكك أرباحاً صافية للمالك.
          </p>

          <div class="space-y-2 text-xs">
            <div class="flex justify-between py-1 border-b border-slate-800 text-slate-300">
              <span class="flex items-center space-x-1 space-x-reverse">
                <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
                <span>1. تجنيب شراء بضاعة (سعر التكلفة):</span>
              </span>
              <b class="font-extrabold text-cyan-400">${split.restocking_cogs_reserve.toFixed(2)} ج.م</b>
            </div>

            <div class="flex justify-between py-1 border-b border-slate-800 text-slate-300">
              <span class="flex items-center space-x-1 space-x-reverse">
                <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>2. صافي نقدية المالك من الدرج:</span>
              </span>
              <b class="font-extrabold text-emerald-400">${split.owner_drawer_net_cash.toFixed(2)} ج.م</b>
            </div>

            <div class="flex justify-between py-1 border-b border-slate-800 text-slate-300">
              <span class="flex items-center space-x-1 space-x-reverse">
                <span class="w-2 h-2 rounded-full bg-rose-400"></span>
                <span>3. أرباح فودافون كاش الصافية:</span>
              </span>
              <b class="font-extrabold text-rose-400">${split.vodafone_pure_profit.toFixed(2)} ج.م</b>
            </div>

            <div class="flex justify-between py-1 border-b border-slate-800 text-slate-300">
              <span class="flex items-center space-x-1 space-x-reverse">
                <span class="w-2 h-2 rounded-full bg-amber-400"></span>
                <span>4. أرباح شكك آجلة للمالك:</span>
              </span>
              <b class="font-extrabold text-amber-400">${split.shakak_pure_profit.toFixed(2)} ج.م</b>
            </div>
          </div>
        </div>

        <div class="mt-3 p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/60 text-xs flex items-center justify-between">
          <span class="font-black text-cyan-200">إجمالي صافي أرباح المالك من الوردية:</span>
          <span class="text-base font-black text-cyan-300">${split.total_owner_profit.toFixed(2)} ج.م</span>
        </div>
      </div>
    </div>

    <!-- 4. Complete Items Sold Detailed Table -->
    <div class="bg-[#0c1229] p-4 rounded-2xl border border-slate-800 mt-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center space-x-2 space-x-reverse">
          <span class="text-lg">🛒</span>
          <h4 class="text-sm font-black text-white">جدول الأصناف المباعة بالتفصيل خلال الوردية</h4>
        </div>
        <span class="text-xs text-slate-400 font-semibold bg-slate-900 px-3 py-1 rounded-lg border border-slate-750">
          إجمالي القطع المباعة: <b class="text-cyan-400">${totalItemsSoldQty}</b> قطعة
        </span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="bg-slate-900/90 text-slate-400 border-b border-slate-800">
              <th class="p-3">الصنف</th>
              <th class="p-3">التصنيف</th>
              <th class="p-3 text-center">الكمية المباعة</th>
              <th class="p-3 text-left">إجمالي الإيراد (بيع)</th>
              <th class="p-3 text-left">التكلفة (شراء)</th>
              <th class="p-3 text-left">صافي ربح الصنف</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60">
            ${
              items.length === 0
                ? `<tr><td colspan="6" class="p-8 text-center text-slate-500">لم يتم تسجيل مبيعات لأي أصناف في هذه الوردية</td></tr>`
                : items
                    .map((it) => {
                      return `
                  <tr class="hover:bg-slate-850/60 transition-colors">
                    <td class="p-3 font-bold text-white">${it.item_name}</td>
                    <td class="p-3 text-slate-400"><span class="px-2 py-0.5 rounded bg-slate-900 text-[10px] text-slate-300 border border-slate-800">${it.category}</span></td>
                    <td class="p-3 text-center font-extrabold text-cyan-400 text-sm">${it.quantity_sold}</td>
                    <td class="p-3 text-left font-bold text-slate-200">${it.revenue.toFixed(2)} ج.م</td>
                    <td class="p-3 text-left text-slate-400">${it.cost.toFixed(2)} ج.م</td>
                    <td class="p-3 text-left font-extrabold text-emerald-400">+ ${it.profit.toFixed(2)} ج.م</td>
                  </tr>`;
                    })
                    .join('')
            }
          </tbody>
          ${
            items.length > 0
              ? `
          <tfoot>
            <tr class="bg-[#090e21] font-black text-slate-100 border-t-2 border-slate-750">
              <td class="p-3" colspan="2">الإجمالي العام للمبيعات:</td>
              <td class="p-3 text-center text-cyan-400 text-sm">${totalItemsSoldQty}</td>
              <td class="p-3 text-left text-cyan-300 text-sm">${sales.total_sales.toFixed(2)} ج.م</td>
              <td class="p-3 text-left text-slate-400 text-sm">${split.restocking_cogs_reserve.toFixed(2)} ج.م</td>
              <td class="p-3 text-left text-emerald-400 text-sm">+ ${(sales.total_sales - split.restocking_cogs_reserve).toFixed(2)} ج.م</td>
            </tr>
          </tfoot>`
              : ''
          }
        </table>
      </div>
    </div>

    <!-- 5. Handover Inventory Shortages Table -->
    <div class="bg-[#0c1229] p-4 rounded-2xl border border-slate-800 mt-4 mb-6">
      <div class="flex items-center space-x-2 space-x-reverse mb-3">
        <span class="text-lg">⚖️</span>
        <h4 class="text-sm font-black text-rose-300">عجز جرد الأصناف المحمّل على الشيفتاجي المستلم</h4>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="bg-rose-950/20 text-slate-400 border-b border-rose-900/40">
              <th class="p-3">الصنف</th>
              <th class="p-3 text-center">رصيد المنظومة</th>
              <th class="p-3 text-center">الرصيد الفعلي المعدود</th>
              <th class="p-3 text-center">كمية العجز</th>
              <th class="p-3 text-left">قيمة العجز (سعر التكلفة)</th>
              <th class="p-3 text-left">الشيفتاجي المسؤول المتحمل للمديونية</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60">
            ${
              shortages.length === 0
                ? `<tr><td colspan="6" class="p-6 text-center text-slate-500 font-medium">الجرد مطابق تماماً بنسبة 100% ولا يوجد أي عجز في الأصناف المعدودة ✓</td></tr>`
                : shortages
                    .map((s) => {
                      return `
                  <tr class="hover:bg-rose-950/10 transition-colors">
                    <td class="p-3 font-bold text-white">${s.item_name}</td>
                    <td class="p-3 text-center text-slate-300">${s.system_qty}</td>
                    <td class="p-3 text-center text-cyan-400 font-bold">${s.actual_qty}</td>
                    <td class="p-3 text-center font-black text-rose-400">${s.shortage_qty}</td>
                    <td class="p-3 text-left font-black text-rose-300">${s.shortage_cost.toFixed(2)} ج.م</td>
                    <td class="p-3 text-left font-bold text-amber-400">${s.charged_cashier}</td>
                  </tr>`;
                    })
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}