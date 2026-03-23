(function () {
  const CATEGORY_META = {
    Essen: { icon: '🍴', cls: 'c-food' },
    Transport: { icon: '🚗', cls: 'c-transport' },
    Freizeit: { icon: '🎮', cls: 'c-fun' },
    Haushalt: { icon: '🏠', cls: 'c-house' },
    Sonstiges: { icon: '📦', cls: 'c-other' }
  };

  const storageKey = 'sparplan_static_v2';

  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function monthKeyFromDate(dateStr) {
    return dateStr.slice(0, 7);
  }

  function formatEUR(v) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(v || 0));
  }

  function monthTitle(key) {
    const [y, m] = key.split('-').map(Number);
    return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  }

  function daysInMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function createDefaultState() {
    const month = monthKeyFromDate(todayISO());
    return {
      activeMonth: month,
      months: {
        [month]: {
          income: 2500,
          salaryDay: 1,
          salaryReceivedDate: '',
          savingsType: 'percent',
          savingsValue: 30,
          strictMode: true,
          fixedCosts: [
            { id: uid(), name: 'Miete', amount: 850, dueDay: 1, recurring: true, paidDate: '' },
            { id: uid(), name: 'Strom', amount: 70, dueDay: 5, recurring: true, paidDate: '' },
            { id: uid(), name: 'Internet', amount: 40, dueDay: 10, recurring: true, paidDate: '' },
            { id: uid(), name: 'Versicherungen', amount: 120, dueDay: 15, recurring: true, paidDate: '' }
          ],
          expenses: [
            { id: uid(), date: todayISO(), category: 'Essen', note: 'Rewe Einkauf', amount: 45.8 },
            { id: uid(), date: todayISO(), category: 'Transport', note: 'Tankstelle', amount: 65 },
            { id: uid(), date: todayISO(), category: 'Freizeit', note: 'Kino', amount: 24.5 }
          ]
        }
      }
    };
  }

  function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.months) return createDefaultState();
      return parsed;
    } catch (_) {
      return createDefaultState();
    }
  }

  let state = loadState();
  ensureMonth(state.activeMonth);

  function save() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function ensureMonth(month) {
    if (state.months[month]) return;
    const lastMonth = Object.keys(state.months).sort().slice(-1)[0];
    const prev = state.months[lastMonth] || createDefaultState().months[lastMonth];
    state.months[month] = {
      income: prev.income || 0,
      salaryDay: prev.salaryDay || 1,
      salaryReceivedDate: '',
      savingsType: prev.savingsType || 'percent',
      savingsValue: prev.savingsValue || 20,
      strictMode: !!prev.strictMode,
      fixedCosts: (prev.fixedCosts || []).filter(f => f.recurring).map(f => ({
        id: uid(), name: f.name, amount: f.amount, dueDay: f.dueDay || 1, recurring: true, paidDate: ''
      })),
      expenses: []
    };
  }

  function currentMonth() { return state.months[state.activeMonth]; }

  function getComputed(monthKey = state.activeMonth) {
    ensureMonth(monthKey);
    const month = state.months[monthKey];
    const today = todayISO();
    const isCurrentMonth = monthKey === monthKeyFromDate(today);
    const day = isCurrentMonth ? Number(today.slice(8, 10)) : 1;
    const dim = daysInMonth(monthKey);
    const fixedTotal = month.fixedCosts.reduce((a, b) => a + Number(b.amount || 0), 0);
    const savingsTarget = month.savingsType === 'amount'
      ? Number(month.savingsValue || 0)
      : Number(month.income || 0) * Number(month.savingsValue || 0) / 100;
    const baseFlexible = Math.max(0, Number(month.income || 0) - fixedTotal - savingsTarget);
    const reserve = month.strictMode ? baseFlexible * 0.1 : 0;
    const flexible = Math.max(0, baseFlexible - reserve);
    const expenses = month.expenses.slice().sort((a, b) => b.date.localeCompare(a.date));
    const spent = expenses.reduce((a, b) => a + Number(b.amount || 0), 0);
    const remaining = Math.max(0, flexible - spent);
    const daysLeft = Math.max(1, dim - day + 1);
    const dailyBudget = remaining / daysLeft;
    const todaySpent = expenses.filter(e => e.date === today).reduce((a, b) => a + Number(b.amount || 0), 0);
    const usedPct = flexible > 0 ? clamp((spent / flexible) * 100, 0, 100) : 0;

    const fixedStatus = month.fixedCosts.map(f => {
      const paidThisMonth = (f.paidDate || '').startsWith(monthKey);
      const overdue = !paidThisMonth && Number(f.dueDay || 1) < day && isCurrentMonth;
      const pending = !paidThisMonth && !overdue;
      return {
        ...f,
        paidThisMonth,
        status: paidThisMonth ? 'green' : overdue ? 'amber' : 'red',
        statusLabel: paidThisMonth ? 'Bezahlt' : overdue ? 'Überfällig' : 'Offen'
      };
    });

    const overdueCount = fixedStatus.filter(x => !x.paidThisMonth && x.status === 'amber').length;
    const grouped = {};
    expenses.forEach(e => {
      grouped[e.category] = (grouped[e.category] || 0) + Number(e.amount || 0);
    });
    const categoryRows = Object.entries(grouped)
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({ name, amount, pct: spent > 0 ? Math.round(amount / spent * 100) : 0 }));

    return {
      month,
      fixedTotal,
      savingsTarget,
      reserve,
      flexible,
      spent,
      remaining,
      dailyBudget,
      todaySpent,
      usedPct,
      fixedStatus,
      overdueCount,
      categoryRows,
      txCount: expenses.length,
      avgExpense: expenses.length ? spent / expenses.length : 0,
      daysLeft,
      expenses
    };
  }

  function render() {
    save();
    const computed = getComputed();
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="container">
        <div id="view-start">${renderStart(computed)}</div>
        <div id="view-plan" class="hidden">${renderPlan(computed)}</div>
        <div id="view-expenses" class="hidden">${renderExpenses(computed)}</div>
        <div id="view-analysis" class="hidden">${renderAnalysis(computed)}</div>
      </div>
      <div class="sheet-backdrop" id="sheet-backdrop"></div>
      <div class="sheet" id="sheet-add-expense">
        <div class="sheet-handle"></div>
        ${renderAddExpenseSheet()}
      </div>
      ${renderNav()}
    `;
    bind();
    showView(window.__currentView || 'start');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function renderStart(c) {
    return `
      <div class="topbar">
        <div>
          <div class="title">Sparplan</div>
          <div class="subtitle">${escapeHtml(monthTitle(state.activeMonth))}</div>
        </div>
        <button class="pill" id="toggle-strict">🐷 ${c.month.strictMode ? 'Sparmodus' : 'Normal'}</button>
      </div>

      <div class="hero">
        <div class="label">Tagesbudget</div>
        <div class="value">${formatEUR(c.dailyBudget)}</div>
        <div class="hero-grid">
          <div class="hero-stat"><div class="small">Noch übrig</div><div class="big">${formatEUR(c.remaining)}</div></div>
          <div class="hero-stat"><div class="small">Ausgegeben</div><div class="big">${formatEUR(c.spent)}</div></div>
          <div class="hero-stat"><div class="small">Tage übrig</div><div class="big">${c.daysLeft}</div></div>
        </div>
        <div class="progress-wrap">
          <div class="progress"><span style="width:${c.usedPct}%"></span></div>
          <div class="progress-note">${Math.round(c.usedPct)}% des Budgets genutzt</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card stat-card blue"><div class="stat-label">Einnahmen</div><div class="stat-value">${formatEUR(c.month.income)}</div></div>
        <div class="card stat-card red"><div class="stat-label">Fixkosten</div><div class="stat-value">${formatEUR(c.fixedTotal)}</div></div>
        <div class="card stat-card green"><div class="stat-label">Sparziel</div><div class="stat-value">${formatEUR(c.savingsTarget)}</div></div>
        <div class="card stat-card amber"><div class="stat-label">Heute ausgegeben</div><div class="stat-value">${formatEUR(c.todaySpent)}</div></div>
      </div>

      ${c.overdueCount ? `<div class="alert">⚠️ <div><strong>Achtung:</strong> ${c.overdueCount} Fixkosten sind bereits fällig und noch nicht als bezahlt markiert.</div></div>` : ''}

      <div class="section">
        <div class="section-title">Nächste Fixkosten</div>
        <div class="card list-card">
          ${c.fixedStatus.map(renderFixedPreview).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Einnahme & Gehalt</div>
        <div class="card split-table">
          <div class="split-row"><span class="muted">Geplantes Einkommen</span><strong>${formatEUR(c.month.income)}</strong></div>
          <div class="split-row"><span class="muted">Gehaltstag</span><strong>${c.month.salaryDay}. des Monats</strong></div>
          <div class="split-row"><span class="muted">Eingegangen am</span><strong>${c.month.salaryReceivedDate || 'Noch nicht eingetragen'}</strong></div>
        </div>
      </div>
    `;
  }

  function renderFixedPreview(f) {
    return `
      <div class="row-item">
        <div class="left-group">
          <div class="dot ${f.status}"></div>
          <div>
            <div class="item-title">${escapeHtml(f.name)}</div>
            <div class="item-sub">Fällig am ${Number(f.dueDay)}.</div>
          </div>
        </div>
        <div>
          <div class="amount">${formatEUR(f.amount)}</div>
          <div class="badge ${f.status}">${f.statusLabel}</div>
        </div>
      </div>
    `;
  }

  function renderPlan(c) {
    const month = c.month;
    return `
      <div class="toolbar">
        <div class="title">Monatsplan</div>
        <button class="primary" id="new-month">＋ Neuer Monat</button>
      </div>

      <div class="card form-card">
        <div class="section-title">Einstellungen</div>
        <div class="field">
          <div class="label">Monatliches Einkommen (€)</div>
          <input class="input" id="income-input" type="number" value="${Number(month.income || 0)}" />
        </div>
        <div class="form-grid">
          <div class="field">
            <div class="label">Gehaltstag</div>
            <input class="input" id="salary-day-input" type="number" min="1" max="31" value="${Number(month.salaryDay || 1)}" />
          </div>
          <div class="field">
            <div class="label">Eingegangen am</div>
            <input class="input" id="salary-date-input" type="date" value="${month.salaryReceivedDate || ''}" />
          </div>
        </div>
        <div class="field">
          <div class="label">Sparziel-Art</div>
          <div class="segment">
            <button class="${month.savingsType === 'percent' ? 'active' : ''}" data-savings-type="percent">Prozent</button>
            <button class="${month.savingsType === 'amount' ? 'active' : ''}" data-savings-type="amount">Betrag</button>
          </div>
        </div>
        <div class="field">
          <div class="label">${month.savingsType === 'percent' ? 'Sparziel (%)' : 'Sparziel (€)'}</div>
          <input class="input" id="savings-input" type="number" value="${Number(month.savingsValue || 0)}" />
        </div>
        <div class="switchline">
          <div>
            <div style="font-size:18px;font-weight:800">Sparmodus (10% Reserve)</div>
            <div class="muted">Hält 10% des flexiblen Budgets zurück</div>
          </div>
          <button id="strict-switch" class="switch ${month.strictMode ? 'on' : 'off'}"><span></span></button>
        </div>
      </div>

      <div class="section"></div>
      <div class="card form-card">
        <div class="section-title">Fixkosten hinzufügen</div>
        <div class="field">
          <div class="label">Name</div>
          <input class="input" id="fixed-name" placeholder="z.B. Handyvertrag" />
        </div>
        <div class="form-grid">
          <div class="field">
            <div class="label">Betrag (€)</div>
            <input class="input" id="fixed-amount" type="number" placeholder="0.00" />
          </div>
          <div class="field">
            <div class="label">Fällig am Tag</div>
            <input class="input" id="fixed-due" type="number" min="1" max="31" value="1" />
          </div>
        </div>
        <div class="switchline">
          <div style="font-size:18px;font-weight:800">Wiederkehrend</div>
          <button id="fixed-recurring" class="switch on"><span></span></button>
        </div>
        <div style="margin-top:16px"><button class="primary" id="save-fixed">＋ Fixkosten speichern</button></div>
      </div>

      <div class="section"></div>
      <div class="card list-card">
        <div class="row-item"><div class="section-title" style="margin:0">Deine Fixkosten</div></div>
        ${c.fixedStatus.map(renderFixedManage).join('') || '<div class="row-item"><div class="muted">Noch keine Fixkosten vorhanden.</div></div>'}
      </div>
    `;
  }

  function renderFixedManage(f) {
    return `
      <div class="row-item">
        <div>
          <div class="item-title">${escapeHtml(f.name)}</div>
          <div class="item-sub">${formatEUR(f.amount)} · Am ${Number(f.dueDay)}. · ${f.recurring ? 'Wiederkehrend' : 'Einmalig'}</div>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <button class="success-btn" data-pay-fixed="${f.id}">✓</button>
          <button class="icon-btn" data-delete-fixed="${f.id}">🗑</button>
        </div>
      </div>
    `;
  }

  function renderExpenses(c) {
    const groups = groupExpensesByDate(c.expenses);
    return `
      <div class="topbar">
        <div>
          <div class="title">Ausgaben</div>
          <div class="subtitle">Diesen Monat: ${formatEUR(c.spent)}</div>
        </div>
      </div>
      <div class="metrics">
        <div class="metric"><div class="metric-label">Transaktionen</div><div class="metric-value">${c.txCount}</div></div>
        <div class="metric"><div class="metric-label">Gesamt</div><div class="metric-value">${formatEUR(c.spent)}</div></div>
        <div class="metric"><div class="metric-label">Durchschnitt</div><div class="metric-value">${formatEUR(c.avgExpense)}</div></div>
      </div>

      <div class="section expense-list">
        ${groups.length ? groups.map(group => `
          <div class="section-title" style="font-size:16px; text-transform:uppercase; color:#6b7280;">${escapeHtml(group.label)}</div>
          <div class="card list-card small-list">
            ${group.items.map(renderExpenseRow).join('')}
          </div>
        `).join('') : '<div class="card form-card"><div class="muted">Noch keine Ausgaben vorhanden.</div></div>'}
      </div>
    `;
  }

  function renderExpenseRow(e) {
    const meta = CATEGORY_META[e.category] || CATEGORY_META['Sonstiges'];
    return `
      <div class="row-item">
        <div class="left-group">
          <div class="category-icon ${meta.cls}">${meta.icon}</div>
          <div>
            <div class="item-title">${escapeHtml(e.category)}</div>
            <div class="item-sub">${escapeHtml(e.note || 'Ohne Notiz')}</div>
          </div>
        </div>
        <div style="display:flex; gap:14px; align-items:center;">
          <div class="amount" style="color:#ef4444">-${formatEUR(e.amount).replace('€', '').trim()} €</div>
          <button class="icon-btn" data-delete-expense="${e.id}" style="background:#eef2f8;color:#64748b;">×</button>
        </div>
      </div>
    `;
  }

  function renderAnalysis(c) {
    const fixedPct = c.month.income ? Math.round(c.fixedTotal / c.month.income * 100) : 0;
    const savePct = c.month.income ? Math.round(c.savingsTarget / c.month.income * 100) : 0;
    return `
      <div class="topbar">
        <div>
          <div class="title">Analyse</div>
          <div class="subtitle">Dein finanzieller Überblick</div>
        </div>
      </div>

      <div class="analysis-grid">
        <div class="card analysis-card">
          <div class="left-group" style="margin-bottom:14px"><div class="category-icon c-transport">🏦</div><div><div class="item-sub">Fixkostenquote</div><div class="stat-value" style="margin:4px 0 0">${fixedPct}%</div></div></div>
          <div class="bar"><span style="width:${clamp(fixedPct,0,100)}%; background:#2563eb"></span></div>
        </div>
        <div class="card analysis-card">
          <div class="left-group" style="margin-bottom:14px"><div class="category-icon c-fun">🐷</div><div><div class="item-sub">Sparquote</div><div class="stat-value" style="margin:4px 0 0">${savePct}%</div></div></div>
          <div class="bar"><span style="width:${clamp(savePct,0,100)}%; background:#10b981"></span></div>
        </div>
      </div>

      <div class="section"></div>
      <div class="card analysis-card">
        <div class="section-title" style="margin-bottom:16px">Budget-Nutzung</div>
        <div class="analysis-grid" style="align-items:center;">
          <div>
            <div class="ring" style="background: conic-gradient(#2563eb ${Math.round(c.usedPct) * 3.6}deg, #dbe4f0 0deg);">
              <div class="ring-inner"><div><div style="font-size:34px;font-weight:800">${Math.round(c.usedPct)}%</div><div class="muted">genutzt</div></div></div>
            </div>
          </div>
          <div>
            <div class="legend-line"><span class="legend-dot" style="background:#2563eb"></span>Ausgegeben: ${formatEUR(c.spent)}</div>
            <div class="legend-line"><span class="legend-dot" style="background:#dbe4f0"></span>Verfügbar: ${formatEUR(c.remaining)}</div>
            <div class="legend-line"><span class="legend-dot" style="background:#10b981"></span>Sparziel: ${formatEUR(c.savingsTarget)}</div>
          </div>
        </div>
        <div class="barline"><div class="bar"><span style="width:${c.usedPct}%; background:#2563eb"></span></div></div>
      </div>

      <div class="section"></div>
      <div class="card analysis-card">
        <div class="section-title">Einkommensverteilung</div>
        ${renderBarLine('Fixkosten', c.fixedTotal, c.month.income, '#ef4444')}
        ${renderBarLine('Sparziel', c.savingsTarget, c.month.income, '#10b981')}
        ${renderBarLine('Ausgegeben', c.spent, c.month.income, '#f59e0b')}
        ${renderBarLine('Übrig', c.remaining, c.month.income, '#2563eb')}
      </div>

      <div class="section"></div>
      <div class="card list-card">
        <div class="row-item"><div class="section-title" style="margin:0">Kategorien</div></div>
        ${c.categoryRows.length ? c.categoryRows.map(cat => `
          <div class="row-item">
            <div class="left-group">
              <div class="category-icon ${(CATEGORY_META[cat.name] || CATEGORY_META['Sonstiges']).cls}">${(CATEGORY_META[cat.name] || CATEGORY_META['Sonstiges']).icon}</div>
              <div><div class="item-title">${escapeHtml(cat.name)}</div><div class="item-sub">${cat.pct}% deiner Ausgaben</div></div>
            </div>
            <div class="amount">${formatEUR(cat.amount)}</div>
          </div>`).join('') : '<div class="row-item"><div class="muted">Noch keine Kategorien vorhanden.</div></div>'}
      </div>

      <div class="section"></div>
      <div class="card split-table">
        <div class="section-title">Überblick</div>
        <div class="split-row"><span class="muted">Einnahmen</span><strong>${formatEUR(c.month.income)}</strong></div>
        <div class="split-row"><span class="muted">Fixkosten gesamt</span><strong>${formatEUR(c.fixedTotal)}</strong></div>
        <div class="split-row"><span class="muted">Sparziel</span><strong>${formatEUR(c.savingsTarget)}</strong></div>
        <div class="split-row"><span class="muted">Flexibles Budget</span><strong>${formatEUR(c.flexible)}</strong></div>
        <div class="split-row"><span class="muted">Ausgegeben</span><strong>${formatEUR(c.spent)}</strong></div>
        <div class="split-row"><span class="muted">Noch übrig</span><strong>${formatEUR(c.remaining)}</strong></div>
        <div class="split-row"><span class="muted">Transaktionen</span><strong>${c.txCount}</strong></div>
      </div>
    `;
  }

  function renderBarLine(label, amount, total, color) {
    const pct = total > 0 ? clamp(amount / total * 100, 0, 100) : 0;
    return `
      <div class="barline">
        <div class="barline-top"><span>${escapeHtml(label)}</span><strong>${formatEUR(amount)}</strong></div>
        <div class="bar"><span style="width:${pct}%; background:${color}"></span></div>
      </div>
    `;
  }

  function renderAddExpenseSheet() {
    const today = todayISO();
    return `
      <div class="section-title">Neue Ausgabe</div>
      <div class="field"><div class="label">Betrag (€)</div><input class="input" id="expense-amount" type="number" placeholder="0.00" /></div>
      <div class="field"><div class="label">Kategorie</div>
        <select class="select" id="expense-category">
          <option>Essen</option>
          <option>Transport</option>
          <option>Freizeit</option>
          <option>Haushalt</option>
          <option>Sonstiges</option>
        </select>
      </div>
      <div class="field"><div class="label">Notiz</div><input class="input" id="expense-note" placeholder="z.B. Supermarkt" /></div>
      <div class="field"><div class="label">Datum</div><input class="input" id="expense-date" type="date" value="${today}" /></div>
      <button class="primary" id="save-expense" style="width:100%">Ausgabe speichern</button>
    `;
  }

  function renderNav() {
    return `
      <div class="bottom-nav">
        <div class="nav-shell">
          <button class="nav-btn" data-view="start"><div class="ico">▦</div><div>Start</div></button>
          <button class="nav-btn" data-view="plan"><div class="ico">🗓️</div><div>Monatsplan</div></button>
          <button class="nav-btn plus" id="open-add-sheet"><div class="plus-circle">＋</div></button>
          <button class="nav-btn" data-view="expenses"><div class="ico">🧾</div><div>Ausgaben</div></button>
          <button class="nav-btn" data-view="analysis"><div class="ico">✨</div><div>Analyse</div></button>
        </div>
      </div>
    `;
  }

  function bind() {
    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => showView(btn.getAttribute('data-view')));
    });
    const openSheet = document.getElementById('open-add-sheet');
    if (openSheet) openSheet.addEventListener('click', () => toggleSheet(true));
    const backdrop = document.getElementById('sheet-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => toggleSheet(false));
    const saveExpense = document.getElementById('save-expense');
    if (saveExpense) saveExpense.addEventListener('click', onSaveExpense);
    const strictBtn = document.getElementById('toggle-strict');
    if (strictBtn) strictBtn.addEventListener('click', () => { currentMonth().strictMode = !currentMonth().strictMode; render(); });

    const income = document.getElementById('income-input');
    if (income) income.addEventListener('input', e => { currentMonth().income = Number(e.target.value || 0); save(); });
    const salaryDay = document.getElementById('salary-day-input');
    if (salaryDay) salaryDay.addEventListener('input', e => { currentMonth().salaryDay = clamp(Number(e.target.value || 1), 1, 31); save(); });
    const salaryDate = document.getElementById('salary-date-input');
    if (salaryDate) salaryDate.addEventListener('input', e => { currentMonth().salaryReceivedDate = e.target.value || ''; save(); });
    const savings = document.getElementById('savings-input');
    if (savings) savings.addEventListener('input', e => { currentMonth().savingsValue = Number(e.target.value || 0); save(); });
    document.querySelectorAll('[data-savings-type]').forEach(btn => btn.addEventListener('click', () => {
      currentMonth().savingsType = btn.getAttribute('data-savings-type');
      render();
      showView('plan');
    }));
    const strictSwitch = document.getElementById('strict-switch');
    if (strictSwitch) strictSwitch.addEventListener('click', () => { currentMonth().strictMode = !currentMonth().strictMode; render(); showView('plan'); });
    const recBtn = document.getElementById('fixed-recurring');
    if (recBtn) recBtn.addEventListener('click', () => recBtn.classList.toggle('on'));
    const saveFixed = document.getElementById('save-fixed');
    if (saveFixed) saveFixed.addEventListener('click', onSaveFixed);
    document.querySelectorAll('[data-delete-fixed]').forEach(btn => btn.addEventListener('click', () => {
      currentMonth().fixedCosts = currentMonth().fixedCosts.filter(x => x.id !== btn.getAttribute('data-delete-fixed'));
      render();
      showView('plan');
    }));
    document.querySelectorAll('[data-pay-fixed]').forEach(btn => btn.addEventListener('click', () => {
      const item = currentMonth().fixedCosts.find(x => x.id === btn.getAttribute('data-pay-fixed'));
      if (item) item.paidDate = todayISO();
      render();
      showView('plan');
    }));
    document.querySelectorAll('[data-delete-expense]').forEach(btn => btn.addEventListener('click', () => {
      currentMonth().expenses = currentMonth().expenses.filter(x => x.id !== btn.getAttribute('data-delete-expense'));
      render();
      showView('expenses');
    }));
    const newMonth = document.getElementById('new-month');
    if (newMonth) newMonth.addEventListener('click', onNewMonth);
  }

  function onSaveExpense() {
    const amount = Number(document.getElementById('expense-amount').value || 0);
    const category = document.getElementById('expense-category').value;
    const note = document.getElementById('expense-note').value.trim();
    const date = document.getElementById('expense-date').value || todayISO();
    if (!amount || amount <= 0) { alert('Bitte einen Betrag eingeben.'); return; }
    const m = monthKeyFromDate(date);
    ensureMonth(m);
    state.activeMonth = m;
    currentMonth().expenses.unshift({ id: uid(), amount, category, note, date });
    render();
    showView('expenses');
    toggleSheet(false);
  }

  function onSaveFixed() {
    const name = document.getElementById('fixed-name').value.trim();
    const amount = Number(document.getElementById('fixed-amount').value || 0);
    const due = clamp(Number(document.getElementById('fixed-due').value || 1), 1, 31);
    const recurring = document.getElementById('fixed-recurring').classList.contains('on');
    if (!name || amount <= 0) { alert('Bitte Name und Betrag eingeben.'); return; }
    currentMonth().fixedCosts.push({ id: uid(), name, amount, dueDay: due, recurring, paidDate: '' });
    render();
    showView('plan');
  }

  function onNewMonth() {
    const [y, m] = state.activeMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    ensureMonth(month);
    state.activeMonth = month;
    render();
    showView('plan');
  }

  function showView(view) {
    window.__currentView = view;
    ['start', 'plan', 'expenses', 'analysis'].forEach(v => {
      const el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('hidden', v !== view);
    });
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === view);
    });
  }

  function toggleSheet(show) {
    document.getElementById('sheet-backdrop').classList.toggle('show', show);
    document.getElementById('sheet-add-expense').classList.toggle('show', show);
  }

  function groupExpensesByDate(items) {
    const map = {};
    items.forEach(it => {
      const k = it.date;
      (map[k] ||= []).push(it);
    });
    return Object.keys(map).sort((a,b) => b.localeCompare(a)).map(k => ({
      label: formatDateHeadline(k),
      items: map[k].sort((a,b) => b.id.localeCompare(a.id))
    }));
  }

  function formatDateHeadline(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long' }).format(d).toUpperCase();
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  }

  render();
})();
