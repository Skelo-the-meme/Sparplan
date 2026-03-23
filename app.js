
const STORAGE_KEY = "sparplan_app_v2_static";

const state = loadState();

function currentMonthStr() {
  return new Date().toISOString().slice(0, 7);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function formatEUR(v) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(v || 0));
}
function daysInMonth(month) {
  const [y,m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function dateInMonth(date, month) {
  return (date || "").startsWith(month);
}
function monthLabel(month) {
  const [y,m] = month.split("-").map(Number);
  const d = new Date(y, m-1, 1);
  return d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}
function newId() {
  return Date.now() + Math.floor(Math.random()*100000);
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      ensureMonth(data, currentMonthStr());
      return data;
    }
  } catch (e) {}
  return {
    currentTab: "start",
    settings: { strictMode: true },
    months: {
      [currentMonthStr()]: {
        income: 2500,
        salaryDay: 1,
        salaryReceivedDate: "",
        savingsType: "percent",
        savingsValue: 30,
        fixedCosts: [
          { id:newId(), name:"Miete", amount:850, dueDay:1, lastPaidDate:"", recurring:true },
          { id:newId(), name:"Strom", amount:70, dueDay:5, lastPaidDate:"", recurring:true },
          { id:newId(), name:"Internet", amount:40, dueDay:10, lastPaidDate:"", recurring:true },
          { id:newId(), name:"Versicherungen", amount:120, dueDay:15, lastPaidDate:"", recurring:true }
        ],
        entries: [],
        notes: ""
      }
    }
  };
}
function ensureMonth(data, month) {
  if (data.months[month]) return;
  const months = Object.keys(data.months).sort();
  const prev = data.months[months[months.length-1]];
  data.months[month] = {
    income: prev?.income || 0,
    salaryDay: prev?.salaryDay || 1,
    salaryReceivedDate: "",
    savingsType: prev?.savingsType || "percent",
    savingsValue: prev?.savingsValue || 20,
    fixedCosts: (prev?.fixedCosts || []).filter(x => x.recurring).map(x => ({
      id:newId(), name:x.name, amount:x.amount, dueDay:x.dueDay || 1, lastPaidDate:"", recurring:true
    })),
    entries: [],
    notes: ""
  };
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function appMonth() {
  ensureMonth(state, selectedMonth());
  return state.months[selectedMonth()];
}
function selectedMonth() {
  const el = document.getElementById("monthSelect");
  return el ? el.value : currentMonthStr();
}
function calc(month) {
  const m = state.months[month];
  const income = Number(m.income || 0);
  const fixedTotal = m.fixedCosts.reduce((s,x)=>s+Number(x.amount||0),0);
  const savingsTarget = m.savingsType === "amount" ? Number(m.savingsValue||0) : income * (Number(m.savingsValue||0)/100);
  const plannedFlexible = Math.max(0, income - fixedTotal - savingsTarget);
  const strictReserve = state.settings.strictMode ? plannedFlexible * 0.1 : 0;
  const usableFlexible = Math.max(0, plannedFlexible - strictReserve);
  const entriesThisMonth = m.entries.filter(e => dateInMonth(e.date, month));
  const spentTotal = entriesThisMonth.reduce((s,x)=>s+Number(x.amount||0),0);
  const todaySpent = entriesThisMonth.filter(e => e.date===todayStr()).reduce((s,x)=>s+Number(x.amount||0),0);
  const dim = daysInMonth(month);
  const today = dateInMonth(todayStr(), month) ? new Date().getDate() : 1;
  const remainingDays = Math.max(1, dim - today + 1);
  const remainingFlexible = usableFlexible - spentTotal;
  const dayBudgetRemaining = Math.max(0, remainingFlexible) / remainingDays;
  const progress = usableFlexible > 0 ? Math.min(100, (spentTotal / usableFlexible) * 100) : 0;
  return { income,fixedTotal,savingsTarget,plannedFlexible,strictReserve,usableFlexible,entriesThisMonth,spentTotal,todaySpent,remainingFlexible,dayBudgetRemaining,progress,dim };
}
function upcomingBills(month) {
  const m = state.months[month];
  const today = dateInMonth(todayStr(), month) ? Number(todayStr().slice(8,10)) : 1;
  return [...m.fixedCosts].sort((a,b)=>(Number(a.dueDay||1)-Number(b.dueDay||1))).map(x => {
    const due = Number(x.dueDay || 1);
    let status = "future";
    if (x.lastPaidDate && dateInMonth(x.lastPaidDate, month)) status = "paid";
    else if (due < today) status = "late";
    else if (due === today) status = "today";
    return {...x,status};
  });
}
function assistantMessage(month, c) {
  if (c.usableFlexible <= 0) {
    return { cls:"danger", text:"Es bleibt aktuell kein flexibles Budget. Prüfe Einkommen, Fixkosten oder Sparziel." };
  }
  if (c.remainingFlexible < 0) {
    return { cls:"danger", text:`Du bist ${formatEUR(Math.abs(c.remainingFlexible))} über deinem Monatsbudget.` };
  }
  const billsLate = upcomingBills(month).filter(x => x.status === "late");
  if (billsLate.length) {
    return { cls:"warn", text:`Achtung: ${billsLate.length} Fixkosten sind laut Plan bereits fällig und noch nicht als bezahlt markiert.` };
  }
  return { cls:"good", text:`Gut. Du liegst unter Plan. Für die restlichen Tage sind etwa ${formatEUR(c.dayBudgetRemaining)} pro Tag sinnvoll.` };
}
function render() {
  const month = selectedMonth() || currentMonthStr();
  ensureMonth(state, month);
  const m = state.months[month];
  const c = calc(month);
  const assistant = assistantMessage(month, c);
  const bills = upcomingBills(month);
  const categories = {};
  c.entriesThisMonth.forEach(e => categories[e.category] = (categories[e.category] || 0) + Number(e.amount || 0));
  const categoryRows = Object.entries(categories).sort((a,b)=>b[1]-a[1]);

  const monthOptions = Object.keys(state.months).sort().map(x => `<option value="${x}" ${x===month?'selected':''}>${monthLabel(x)}</option>`).join("");

  document.getElementById("app").innerHTML = `
    <div class="header">
      <div class="title">
        <h1>Sparplan App</h1>
        <p>Budget planen. Alltag erfassen. Mehr sparen.</p>
      </div>
      <div class="badge">${state.settings.strictMode ? "Sparmodus aktiv" : "Sparmodus aus"}</div>
    </div>

    <div class="card">
      <div class="row">
        <div class="col">
          <label>Monat</label>
          <select id="monthSelect">${monthOptions}</select>
        </div>
        <div class="col" style="max-width:210px">
          <label>Neuen Monat anlegen</label>
          <button class="secondary" id="newMonthBtn">Neuen Monat erstellen</button>
        </div>
      </div>
    </div>

    <div class="grid stats">
      ${stat("Einnahmen", formatEUR(c.income))}
      ${stat("Fixkosten", formatEUR(c.fixedTotal))}
      ${stat("Sparziel", formatEUR(c.savingsTarget))}
      ${stat("Heute noch möglich", formatEUR(c.dayBudgetRemaining))}
    </div>

    <div id="panel-start" class="panel ${state.currentTab==="start"?"active":""}">
      <div class="card">
        <h3 class="section-title">Dein Assistent</h3>
        <div class="assistant ${assistant.cls}">${assistant.text}</div>
        <div class="progress-wrap">
          <div class="progress-head"><span>Budgetfortschritt</span><span>${formatEUR(c.spentTotal)} von ${formatEUR(c.usableFlexible)}</span></div>
          <div class="progress"><div style="width:${c.progress}%"></div></div>
        </div>
        <div class="info-grid" style="margin-top:14px">
          <div class="info-box"><div class="muted">Tagesbudget ab jetzt</div><div class="strong" style="font-size:1.8rem">${formatEUR(c.dayBudgetRemaining)}</div></div>
          <div class="info-box"><div class="muted">Monat noch übrig</div><div class="strong" style="font-size:1.8rem">${formatEUR(Math.max(0,c.remainingFlexible))}</div></div>
        </div>
      </div>

      <div class="dual">
        <div class="card">
          <h3 class="section-title">Einnahme & Gehalt</h3>
          <div class="list">
            <div class="kv"><span class="muted">Geplantes Einkommen</span><span class="strong">${formatEUR(m.income)}</span></div>
            <div class="kv"><span class="muted">Gehaltstag</span><span class="strong">${m.salaryDay || "-"}. des Monats</span></div>
            <div class="kv"><span class="muted">Tatsächlich eingegangen</span><span class="strong">${m.salaryReceivedDate || "noch nicht eingetragen"}</span></div>
          </div>
        </div>
        <div class="card">
          <h3 class="section-title">Nächste Fixkosten</h3>
          <div class="list">
            ${bills.length ? bills.slice(0,4).map(billCard).join("") : `<div class="empty">Noch keine Fixkosten vorhanden.</div>`}
          </div>
        </div>
      </div>
    </div>

    <div id="panel-plan" class="panel ${state.currentTab==="plan"?"active":""}">
      <div class="card">
        <h3 class="section-title">Monatsplan</h3>
        <div class="row">
          <div class="col"><label>Einnahmen</label><input id="incomeInput" type="number" value="${m.income}" /></div>
          <div class="col"><label>Gehaltstag</label><input id="salaryDayInput" type="number" min="1" max="31" value="${m.salaryDay || 1}" /></div>
          <div class="col"><label>Tatsächlich eingegangen am</label><input id="salaryReceivedInput" type="date" value="${m.salaryReceivedDate || ""}" /></div>
        </div>
        <div class="row" style="margin-top:10px">
          <div class="col">
            <label>Sparziel-Art</label>
            <select id="savingsTypeInput">
              <option value="percent" ${m.savingsType==="percent"?"selected":""}>Prozent</option>
              <option value="amount" ${m.savingsType==="amount"?"selected":""}>Fester Betrag</option>
            </select>
          </div>
          <div class="col"><label>${m.savingsType==="amount"?"Sparziel Betrag":"Sparziel %"}</label><input id="savingsValueInput" type="number" value="${m.savingsValue}" /></div>
          <div class="col"><label>Sparmodus</label><button class="${state.settings.strictMode?'primary':'secondary'}" id="strictModeToggle">${state.settings.strictMode?'Aktiv':'Deaktiviert'}</button></div>
        </div>
        <div style="margin-top:10px">
          <label>Monatsnotiz</label>
          <textarea id="monthNotesInput" placeholder="z. B. diesen Monat besonders auf Essen und Freizeit achten">${m.notes || ""}</textarea>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="primary" id="savePlanBtn">Monatsplan speichern</button>
          <button class="secondary" id="exportBtn">Daten exportieren</button>
        </div>
      </div>

      <div class="card">
        <h3 class="section-title">Fixkosten hinzufügen</h3>
        <div class="row">
          <div class="col"><label>Name</label><input id="fcName" placeholder="z. B. Handyvertrag" /></div>
          <div class="col"><label>Betrag</label><input id="fcAmount" type="number" placeholder="0.00" /></div>
        </div>
        <div class="row" style="margin-top:10px">
          <div class="col"><label>Fällig am Tag</label><input id="fcDueDay" type="number" min="1" max="31" value="1" /></div>
          <div class="col"><label>Letztes Zahlungsdatum</label><input id="fcLastPaid" type="date" /></div>
          <div class="col"><label>Wiederkehrend</label><select id="fcRecurring"><option value="true">Ja</option><option value="false">Nein</option></select></div>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="primary" id="addFixedBtn">Fixkosten speichern</button>
        </div>
      </div>

      <div class="card">
        <h3 class="section-title">Deine Fixkosten</h3>
        <div class="list">
          ${m.fixedCosts.length ? m.fixedCosts.sort((a,b)=>Number(a.dueDay||1)-Number(b.dueDay||1)).map(fixedCostRow).join("") : `<div class="empty">Noch keine Fixkosten eingetragen.</div>`}
        </div>
      </div>
    </div>

    <div id="panel-erfassen" class="panel ${state.currentTab==="erfassen"?"active":""}">
      <div class="card">
        <h3 class="section-title">Ausgabe erfassen</h3>
        <div class="row">
          <div class="col"><label>Datum</label><input id="entryDate" type="date" value="${todayStr()}" /></div>
          <div class="col">
            <label>Kategorie</label>
            <select id="entryCategory">
              <option>Essen</option><option>Haushalt</option><option>Transport</option><option>Kinder</option><option>Freizeit</option><option>Gesundheit</option><option>Sonstiges</option>
            </select>
          </div>
        </div>
        <div class="row" style="margin-top:10px">
          <div class="col"><label>Notiz</label><input id="entryNote" placeholder="z. B. Rewe" /></div>
          <div class="col"><label>Betrag</label><input id="entryAmount" type="number" placeholder="0.00" /></div>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="primary" id="addEntryBtn">Ausgabe speichern</button>
        </div>
      </div>
    </div>

    <div id="panel-ausgaben" class="panel ${state.currentTab==="ausgaben"?"active":""}">
      <div class="card">
        <h3 class="section-title">Ausgaben dieses Monats</h3>
        <div class="list">
          ${c.entriesThisMonth.length ? [...c.entriesThisMonth].sort((a,b)=>b.date.localeCompare(a.date)).map(entryRow).join("") : `<div class="empty">Noch keine Ausgaben für diesen Monat.</div>`}
        </div>
      </div>
    </div>

    <div id="panel-analyse" class="panel ${state.currentTab==="analyse"?"active":""}">
      <div class="card">
        <h3 class="section-title">Analyse</h3>
        <div class="list">
          <div class="item"><div><div class="strong">Fixkostenquote</div><div class="meta">Anteil der festen Kosten am Einkommen</div></div><div class="strong">${c.income ? Math.round((c.fixedTotal / c.income) * 100) : 0}%</div></div>
          <div class="item"><div><div class="strong">Geplante Sparquote</div><div class="meta">Anteil des Sparziels am Einkommen</div></div><div class="strong">${c.income ? Math.round((c.savingsTarget / c.income) * 100) : 0}%</div></div>
          <div class="item"><div><div class="strong">Flexibles Budget genutzt</div><div class="meta">Wie viel vom freien Budget bereits ausgegeben wurde</div></div><div class="strong">${Math.round(c.progress)}%</div></div>
        </div>
        <hr class="sep" />
        <h3 class="section-title">Kategorien</h3>
        <div class="list">
          ${categoryRows.length ? categoryRows.map(([cat,total]) => `<div class="item"><div><div class="strong">${cat}</div><div class="meta">${c.spentTotal ? Math.round((total / c.spentTotal) * 100) : 0}% deiner Ausgaben</div></div><div class="strong">${formatEUR(total)}</div></div>`).join("") : `<div class="empty">Sobald du Ausgaben erfasst, erscheinen hier deine Kategorien.</div>`}
        </div>
      </div>
    </div>

    <div class="tabs">
      ${tabBtn("start","Start")}
      ${tabBtn("plan","Monatsplan")}
      ${tabBtn("erfassen","Erfassen")}
      ${tabBtn("ausgaben","Ausgaben")}
      ${tabBtn("analyse","Analyse")}
    </div>
  `;

  bindEvents();
}
function stat(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}
function tabBtn(key, label) {
  return `<button class="tab-btn ${state.currentTab===key?"active":""}" data-tab="${key}">${label}</button>`;
}
function billCard(x) {
  const statusClass = x.status==="paid" ? "good" : x.status==="late" ? "warn" : "good";
  const statusLabel = x.status==="paid" ? "bezahlt" : x.status==="late" ? "überfällig" : x.status==="today" ? "heute" : `fällig am ${x.dueDay}.`;
  return `<div class="item">
    <div>
      <div class="strong">${x.name}</div>
      <div class="meta">${formatEUR(x.amount)} · fällig am ${x.dueDay}. · ${x.lastPaidDate ? "letzte Zahlung: " + x.lastPaidDate : "noch kein Zahlungsdatum"}</div>
    </div>
    <div class="tag ${statusClass}">${statusLabel}</div>
  </div>`;
}
function fixedCostRow(x) {
  return `<div class="item">
    <div>
      <div class="strong">${x.name}</div>
      <div class="meta">${formatEUR(x.amount)} · fällig am ${x.dueDay}. · ${x.recurring ? "wiederkehrend" : "einmalig"} · ${x.lastPaidDate ? "letzte Zahlung: " + x.lastPaidDate : "kein Zahlungsdatum"}</div>
    </div>
    <div class="row">
      <button class="secondary small" data-mark-paid="${x.id}">Heute bezahlt</button>
      <button class="danger small" data-delete-fixed="${x.id}">Löschen</button>
    </div>
  </div>`;
}
function entryRow(x) {
  return `<div class="item">
    <div>
      <div class="strong">${x.category} · ${formatEUR(x.amount)}</div>
      <div class="meta">${x.date}${x.note ? " · " + x.note : ""}</div>
    </div>
    <button class="danger small" data-delete-entry="${x.id}">Löschen</button>
  </div>`;
}
function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach(btn => btn.onclick = () => {
    state.currentTab = btn.dataset.tab;
    saveState();
    render();
  });
  const monthSel = document.getElementById("monthSelect");
  if (monthSel) monthSel.onchange = () => render();

  const newMonthBtn = document.getElementById("newMonthBtn");
  if (newMonthBtn) newMonthBtn.onclick = () => {
    const month = prompt("Neuen Monat eingeben (YYYY-MM)", nextMonthString(selectedMonth()));
    if (!month) return;
    ensureMonth(state, month);
    saveState();
    render();
    document.getElementById("monthSelect").value = month;
    render();
  };

  const savePlanBtn = document.getElementById("savePlanBtn");
  if (savePlanBtn) savePlanBtn.onclick = () => {
    const m = appMonth();
    m.income = Number(document.getElementById("incomeInput").value || 0);
    m.salaryDay = Number(document.getElementById("salaryDayInput").value || 1);
    m.salaryReceivedDate = document.getElementById("salaryReceivedInput").value || "";
    m.savingsType = document.getElementById("savingsTypeInput").value;
    m.savingsValue = Number(document.getElementById("savingsValueInput").value || 0);
    m.notes = document.getElementById("monthNotesInput").value || "";
    saveState();
    render();
  };

  const strictToggle = document.getElementById("strictModeToggle");
  if (strictToggle) strictToggle.onclick = () => {
    state.settings.strictMode = !state.settings.strictMode;
    saveState();
    render();
  };

  const addFixedBtn = document.getElementById("addFixedBtn");
  if (addFixedBtn) addFixedBtn.onclick = () => {
    const name = document.getElementById("fcName").value.trim();
    const amount = Number(document.getElementById("fcAmount").value || 0);
    const dueDay = Number(document.getElementById("fcDueDay").value || 1);
    const lastPaidDate = document.getElementById("fcLastPaid").value || "";
    const recurring = document.getElementById("fcRecurring").value === "true";
    if (!name || amount <= 0) {
      alert("Bitte Namen und Betrag eingeben.");
      return;
    }
    appMonth().fixedCosts.push({ id:newId(), name, amount, dueDay, lastPaidDate, recurring });
    saveState();
    render();
  };

  const addEntryBtn = document.getElementById("addEntryBtn");
  if (addEntryBtn) addEntryBtn.onclick = () => {
    const date = document.getElementById("entryDate").value;
    const category = document.getElementById("entryCategory").value;
    const note = document.getElementById("entryNote").value.trim();
    const amount = Number(document.getElementById("entryAmount").value || 0);
    if (!date || amount <= 0) {
      alert("Bitte Datum und Betrag eingeben.");
      return;
    }
    appMonth().entries.unshift({ id:newId(), date, category, note, amount });
    saveState();
    state.currentTab = "ausgaben";
    render();
  };

  document.querySelectorAll("[data-delete-fixed]").forEach(btn => btn.onclick = () => {
    const id = Number(btn.dataset.deleteFixed);
    appMonth().fixedCosts = appMonth().fixedCosts.filter(x => x.id !== id);
    saveState();
    render();
  });
  document.querySelectorAll("[data-mark-paid]").forEach(btn => btn.onclick = () => {
    const id = Number(btn.dataset.markPaid);
    const item = appMonth().fixedCosts.find(x => x.id === id);
    if (item) item.lastPaidDate = todayStr();
    saveState();
    render();
  });
  document.querySelectorAll("[data-delete-entry]").forEach(btn => btn.onclick = () => {
    const id = Number(btn.dataset.deleteEntry);
    appMonth().entries = appMonth().entries.filter(x => x.id !== id);
    saveState();
    render();
  });

  const exportBtn = document.getElementById("exportBtn");
  if (exportBtn) exportBtn.onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sparplan-export-${selectedMonth()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
}
function nextMonthString(month) {
  const [y,m] = month.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
render();
