// Wolne terminy: rezerwacja pierwszej rozmowy. Vanilla JS, bez zależności.
// Dostępność pochodzi wyłącznie z backendu (Google Calendar przez Apps Script). Bez adresu backendu strona pokazuje
// stan "niedostępne": nigdy nie pokazuje wymyślonych terminów. Mock deweloperski ładuje się tylko lokalnie z ?mock=1.
(() => {
  "use strict";

  const root = document.querySelector("[data-booking]");
  if (!root) return;

  const TZ = "Europe/Warsaw";
  const SERVICE = { id: root.dataset.serviceId, name: root.dataset.serviceName, minutes: Number(root.dataset.serviceMinutes) };
  const ENDPOINT = root.dataset.endpoint || "";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const desktop = window.matchMedia("(min-width: 64em)");

  const $ = (sel, ctx = root) => ctx.querySelector(sel);
  const $$ = (sel, ctx = root) => [...ctx.querySelectorAll(sel)];

  // ---------------------------------------------------------------- czas: zawsze Europe/Warsaw, nigdy strefa przeglądarki
  const F = {
    ymd: new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }),
    hm: new Intl.DateTimeFormat("pl-PL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    long: new Intl.DateTimeFormat("pl-PL", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }),
    month: new Intl.DateTimeFormat("pl-PL", { timeZone: TZ, month: "long", year: "numeric" }),
  };
  const pad = (n) => String(n).padStart(2, "0");
  const ymdOf = (iso) => F.ymd.format(new Date(iso));
  const hmOf = (iso) => F.hm.format(new Date(iso));
  const dateOf = (ymd) => new Date(ymd + "T12:00:00Z"); // południe UTC = ta sama data w Warszawie (UTC+1/+2)
  const longOf = (ymd) => F.long.format(dateOf(ymd));
  const todayYmd = () => ymdOf(new Date().toISOString());
  const keyOf = (y, m) => `${y}-${pad(m + 1)}`;
  const addDays = (ymd, n) => new Date(dateOf(ymd).getTime() + n * 86400000).toISOString().slice(0, 10);
  const weekdayMon0 = (ymd) => (dateOf(ymd).getUTCDay() + 6) % 7;
  const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? few : many);

  // ---------------------------------------------------------------- komunikaty (jedna lista, jeden głos)
  const MSG = {
    NOT_CONFIGURED: ["Rezerwacja online nie jest jeszcze uruchomiona.", "Nie pokazuję terminów, których nie mogę potwierdzić. Skorzystaj z innego sposobu kontaktu."],
    NETWORK: ["Nie udało się połączyć z serwerem rezerwacji.", "Sprawdź połączenie z internetem i spróbuj ponownie."],
    CALENDAR: ["Nie udało się teraz sprawdzić kalendarza.", "Spróbuj za chwilę. Jeśli problem wraca, skorzystaj z innego sposobu kontaktu."],
    RATE_LIMITED: ["Zbyt wiele prób w krótkim czasie.", "Odczekaj minutę i spróbuj ponownie."],
    TAKEN: ["Ten termin został właśnie zarezerwowany.", "Wybierz inną godzinę."],
    BUSY: ["Rezerwacja jest teraz zajęta innym zgłoszeniem.", "Spróbuj ponownie za chwilę."],
    VALIDATION: ["Nie udało się przyjąć rezerwacji.", "Sprawdź wpisane dane i spróbuj ponownie."],
    UNKNOWN: ["Coś poszło nie tak po stronie rezerwacji.", "Spróbuj ponownie za chwilę."],
  };
  const codeOf = (e) => (e && e.code) || "UNKNOWN";
  const kindOf = (code) => (code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : code === "NETWORK" ? "NETWORK" : code === "CALENDAR_ERROR" ? "CALENDAR" : code === "RATE_LIMITED" ? "RATE_LIMITED" : code === "SLOT_TAKEN" ? "TAKEN" : code === "VALIDATION_ERROR" ? "VALIDATION" : code === "LOCK_TIMEOUT" ? "BUSY" : "UNKNOWN");

  // ---------------------------------------------------------------- API (backend Apps Script albo mock deweloperski)
  const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(location.hostname);
  const wantMock = isLocal && new URLSearchParams(location.search).get("mock") === "1";

  // identyfikator tylko na czas wczytanej strony (bez localStorage i cookies): rozdziela limity żądań między odwiedzających
  const CLIENT_ID = (() => {
    try {
      return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      return Math.random().toString(16).slice(2, 18);
    }
  })();

  function apiError(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
  }

  async function api(action, payload) {
    if (window.__BOOKING_MOCK__) return window.__BOOKING_MOCK__.handle(action, payload || {});
    if (!ENDPOINT) throw apiError("NOT_CONFIGURED");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ action, serviceId: SERVICE.id, clientId: CLIENT_ID }, payload || {})),
        signal: ctl.signal,
      });
    } catch (err) {
      throw apiError("NETWORK");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw apiError("NETWORK");
    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw apiError("CALENDAR_ERROR");
    }
    if (!data || !data.ok) throw apiError((data && data.error) || "UNKNOWN_ERROR");
    return data;
  }

  const VIEW = root.dataset.view || "book";
  const tokenFromHash = () => (location.hash.match(/[#&]t=([0-9a-f]{32,128})/) || [])[1] || "";

  if (VIEW === "cancel") {
    cancelView();
    return;
  }

  // ---------------------------------------------------------------- anulowanie terminu (link z e-maila: anuluj.html#t=...)
  function cancelView() {
    const panels = $$("[data-panel]");
    const show = (name) => panels.forEach((p) => (p.hidden = p.dataset.panel !== name));
    const live = $("[data-live]");
    const say = (m) => {
      live.textContent = "";
      setTimeout(() => (live.textContent = m), 40);
    };
    const token = tokenFromHash();

    function invalid(title, text) {
      $("[data-invalid-title]").textContent = title;
      $("[data-invalid-text]").textContent = text;
      show("invalid");
      say(title);
    }

    function fail(e) {
      const code = codeOf(e);
      if (code === "NOT_FOUND") return invalid("Ten link jest nieważny.", "Termin mógł zostać już anulowany albo się odbyć. Jeśli potrzebujesz nowego terminu, wybierz go na stronie wolnych terminów.");
      if (code === "TOO_LATE") return invalid("Tego terminu nie można już anulować online.", "Do rozpoczęcia zostało zbyt mało czasu. Skorzystaj z innego sposobu kontaktu.");
      if (code === "NOT_CONFIGURED") return invalid(MSG.NOT_CONFIGURED[0], MSG.NOT_CONFIGURED[1]);
      const [t, x] = MSG[kindOf(code)];
      return invalid(t, x);
    }

    async function load() {
      if (!token) return invalid("Ten link jest niepełny.", "Otwórz link z wiadomości e-mail w całości albo wybierz nowy termin.");
      show("loading");
      try {
        const res = await api("lookup", { token });
        const b = res.booking;
        if (b.status !== "confirmed" || !b.canCancel) {
          if (b.status === "cancelled" || b.status === "rescheduled") return invalid("Ten termin został już anulowany lub zmieniony.", "Nie trzeba nic więcej robić.");
          if (b.status === "past") return invalid("Ten termin już się odbył.", "Jeśli potrzebujesz nowego, wybierz go na stronie wolnych terminów.");
          return invalid("Tego terminu nie można już anulować online.", "Do rozpoczęcia zostało zbyt mało czasu. Skorzystaj z innego sposobu kontaktu.");
        }
        $("[data-c-date]").textContent = longOf(ymdOf(b.start));
        $("[data-c-time]").textContent = hmOf(b.start);
        $("[data-c-dur]").textContent = `${SERVICE.minutes} minut`;
        show("confirm");
        say("Sprawdź termin i potwierdź anulowanie.");
        $("[data-confirm-title]").focus();
      } catch (e) {
        fail(e);
      }
    }

    $("[data-cancel-do]").addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = "Anuluję...";
      try {
        await api("cancel", { token });
        show("done");
        say("Termin został anulowany.");
        $("[data-cdone-title]").focus();
      } catch (e) {
        const [t, x] = MSG[kindOf(codeOf(e))];
        if (codeOf(e) === "NOT_FOUND" || codeOf(e) === "TOO_LATE") fail(e);
        else {
          const host = $("[data-confirm-notice]");
          host.textContent = "";
          const box = document.createElement("div");
          box.className = "notice notice--warn";
          box.setAttribute("role", "alert");
          const h = document.createElement("p");
          h.className = "notice__title";
          h.textContent = t;
          const p = document.createElement("p");
          p.className = "notice__text";
          p.textContent = x;
          box.append(h, p);
          host.appendChild(box);
        }
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
    $("[data-retry]") && $("[data-retry]").addEventListener("click", load);

    if (wantMock) startWithMock(load);
    else load();
  }

  // ---------------------------------------------------------------- stan
  const nowYmd = todayYmd();
  const S = {
    y: Number(nowYmd.slice(0, 4)),
    m: Number(nowYmd.slice(5, 7)) - 1,
    days: new Map(), // ymd -> [{start, end}]
    loaded: new Map(), // 'YYYY-MM' -> timestamp
    horizon: null, // {first, last}
    near: null,
    selDay: null,
    selSlot: null,
    panel: "loading",
    focusYmd: null,
    busy: false,
    email: "",
    token: "",
    current: null,
  };

  const el = {
    live: $("[data-live]"),
    rail: $("[data-rail]"),
    railNow: $("[data-rail-now]"),
    month: $("[data-month]"),
    grid: $("[data-grid]"),
    prev: $("[data-prev]"),
    next: $("[data-next]"),
    hoursTitle: $("[data-hours-title]"),
    hoursHint: $("[data-hours-hint]"),
    hours: $("[data-hours]"),
    cont: $("[data-continue]"),
    whenNotice: $("[data-when-notice]"),
    whenTop: $("[data-when-top]"),
    near: $("[data-near]"),
    nearValue: $("[data-near-value]"),
    nearPick: $("[data-near-pick]"),
    sumDate: $("[data-sum-date]"),
    sumTime: $("[data-sum-time]"),
    pick: $("[data-pick]"),
    form: $("[data-form]"),
    formNotice: $("[data-form-notice]"),
    submit: $("[data-submit]"),
    back: $("[data-back]"),
    detailsTitle: $("[data-details-title]"),
    doneTitle: $("[data-done-title]"),
    svcDetails: $("[data-svc-details]"),
  };

  const STEPS = ["service", "day", "hour", "details", "done"];
  const STEP_LABEL = { service: "Rozmowa", day: "Dzień", hour: "Godzina", details: "Dane", done: "Potwierdzenie" };

  function announce(msg) {
    el.live.textContent = "";
    setTimeout(() => {
      el.live.textContent = msg;
    }, 40);
  }

  function showPanel(name) {
    S.panel = name;
    root.dataset.state = name;
    $$("[data-panel]").forEach((p) => {
      p.hidden = p.dataset.panel !== name;
    });
    renderRail();
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function notice(host, kind, title, text, actions) {
    clear(host);
    if (!title) return;
    const box = document.createElement("div");
    box.className = "notice" + (kind === "warn" ? " notice--warn" : "");
    box.setAttribute("role", kind === "warn" ? "alert" : "status");
    const h = document.createElement("p");
    h.className = "notice__title";
    h.textContent = title;
    box.appendChild(h);
    if (text) {
      const p = document.createElement("p");
      p.className = "notice__text";
      p.textContent = text;
      box.appendChild(p);
    }
    if (actions && actions.length) {
      const wrap = document.createElement("p");
      wrap.className = "notice__actions";
      actions.forEach((a) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "linkbtn";
        b.textContent = a.label;
        b.addEventListener("click", a.run);
        wrap.appendChild(b);
      });
      box.appendChild(wrap);
    }
    host.appendChild(box);
  }

  // ---------------------------------------------------------------- rail
  function currentStep() {
    if (S.panel === "done") return 5;
    if (S.panel === "details") return 4;
    if (!S.selDay) return 2;
    if (!S.selSlot) return 3;
    return 4;
  }

  function renderRail() {
    if (!el.rail) return;
    const cur = S.panel === "loading" || S.panel === "unavailable" ? 2 : currentStep();
    el.rail.style.setProperty("--step", String(cur));
    $$("[data-step]", el.rail).forEach((li, i) => {
      const n = i + 1;
      const btn = $("button", li);
      li.classList.toggle("is-done", n < cur || (S.panel === "done" && n <= 5));
      li.classList.toggle("is-current", n === cur && S.panel !== "done");
      const clickable = n < cur && S.panel !== "done" && n > 1;
      btn.disabled = !clickable;
      if (n === cur && S.panel !== "done") btn.setAttribute("aria-current", "step");
      else btn.removeAttribute("aria-current");
    });
    el.railNow.textContent = `Krok ${Math.min(cur, 5)} z 5: ${STEP_LABEL[STEPS[Math.min(cur, 5) - 1]]}`;
  }

  // ---------------------------------------------------------------- dane: miesiące i dostępność
  const monthRange = (y, m) => ({ from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(daysIn(y, m))}` });

  async function loadMonth(y, m, fresh) {
    const key = keyOf(y, m);
    const at = S.loaded.get(key);
    if (!fresh && at && Date.now() - at < 60000) return;
    const { from, to } = monthRange(y, m);
    const res = await api("availability", { from, to });
    for (let d = from; d <= to; d = addDays(d, 1)) S.days.delete(d);
    (res.slots || []).forEach((s) => {
      const day = ymdOf(s.start);
      if (!S.days.has(day)) S.days.set(day, []);
      S.days.get(day).push({ start: s.start, end: s.end });
    });
    S.days.forEach((arr) => arr.sort((a, b) => new Date(a.start) - new Date(b.start)));
    if (res.horizon) S.horizon = res.horizon;
    S.loaded.set(key, Date.now());
  }

  const slotsOf = (ymd) => S.days.get(ymd) || [];
  const hasFree = (ymd) => slotsOf(ymd).length > 0;

  // ---------------------------------------------------------------- kalendarz
  function renderCalendar() {
    const { y, m } = S;
    el.month.textContent = F.month.format(dateOf(`${y}-${pad(m + 1)}-01`));
    const first = `${y}-${pad(m + 1)}-01`;
    const lead = weekdayMon0(first);
    const total = daysIn(y, m);
    const today = todayYmd();
    clear(el.grid);

    const monthDays = [];
    for (let d = 1; d <= total; d++) monthDays.push(`${y}-${pad(m + 1)}-${pad(d)}`);
    const tabTarget = S.focusYmd && monthDays.includes(S.focusYmd) ? S.focusYmd : S.selDay && monthDays.includes(S.selDay) ? S.selDay : monthDays.find(hasFree) || monthDays.find((d) => d >= today) || monthDays[0];

    let tr = null;
    const cells = lead + total;
    const rows = Math.ceil(cells / 7);
    for (let i = 0; i < rows * 7; i++) {
      if (i % 7 === 0) {
        tr = document.createElement("tr");
        tr.setAttribute("role", "row");
        el.grid.appendChild(tr);
      }
      const td = document.createElement("td");
      td.setAttribute("role", "gridcell");
      const dayNum = i - lead + 1;
      if (dayNum >= 1 && dayNum <= total) {
        const ymd = monthDays[dayNum - 1];
        const free = hasFree(ymd);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "day" + (free ? " is-free" : "") + (ymd === today ? " is-today" : "") + (ymd === S.selDay ? " is-selected" : "");
        b.dataset.ymd = ymd;
        b.textContent = String(dayNum);
        const n = slotsOf(ymd).length;
        b.setAttribute("aria-label", `${longOf(ymd)}${ymd === today ? ", dzisiaj" : ""}: ${free ? `${n} ${plural(n, "wolna godzina", "wolne godziny", "wolnych godzin")}` : "brak terminów"}`);
        if (!free) b.setAttribute("aria-disabled", "true");
        if (ymd === S.selDay) b.setAttribute("aria-pressed", "true");
        b.tabIndex = ymd === tabTarget ? 0 : -1;
        td.appendChild(b);
      }
      tr.appendChild(td);
    }

    const tk = keyOf(todayYmd().slice(0, 4) * 1, Number(todayYmd().slice(5, 7)) - 1);
    el.prev.disabled = keyOf(y, m) <= tk;
    const lastKey = S.horizon ? S.horizon.last.slice(0, 7) : null;
    el.next.disabled = lastKey ? keyOf(y, m) >= lastKey : false;
  }

  function focusDay(ymd) {
    const b = $(`.day[data-ymd="${ymd}"]`, el.grid);
    if (b) {
      $$(".day", el.grid).forEach((x) => (x.tabIndex = -1));
      b.tabIndex = 0;
      b.focus();
    }
  }

  async function gotoMonth(y, m, thenFocus) {
    S.y = y;
    S.m = m;
    el.grid.setAttribute("aria-busy", "true");
    try {
      await loadMonth(y, m, false);
      notice(el.whenNotice, "", "");
    } catch (e) {
      showWhenError(e, () => gotoMonth(y, m, thenFocus));
    }
    el.grid.removeAttribute("aria-busy");
    renderCalendar();
    if (thenFocus) focusDay(thenFocus);
    announce(`Miesiąc: ${el.month.textContent}`);
  }

  function showWhenError(e, retry) {
    const [t, x] = MSG[kindOf(codeOf(e))];
    if (codeOf(e) === "NOT_CONFIGURED") return unavailable(e);
    notice(el.whenNotice, "warn", t, x, [{ label: "Spróbuj ponownie", run: retry }]);
  }

  // ---------------------------------------------------------------- godziny
  // przycisk "Dalej" pojawia się dopiero po wyborze godziny (i wtedy jest przyklejony do dołu ekranu)
  function setAction() {
    const wrap = el.cont.parentElement;
    wrap.hidden = !S.selSlot;
    wrap.classList.toggle("is-ready", !!S.selSlot);
    el.cont.disabled = !S.selSlot;
  }

  function renderHours() {
    clear(el.hours);
    if (!S.selDay) {
      el.hoursTitle.textContent = "Wybierz dzień";
      el.hoursHint.textContent = "Po wybraniu dnia pokażę wolne godziny.";
      setAction();
      return;
    }
    const slots = slotsOf(S.selDay);
    el.hoursTitle.textContent = longOf(S.selDay);
    el.hoursHint.textContent = slots.length ? `Wolne godziny: ${slots.length}. Wybierz jedną.` : "W tym dniu nie ma już wolnych godzin.";
    const tabTarget = S.selSlot && slots.find((s) => s.start === S.selSlot.start) ? S.selSlot.start : slots[0] && slots[0].start;
    slots.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(!!S.selSlot && S.selSlot.start === s.start));
      b.dataset.start = s.start;
      b.textContent = hmOf(s.start);
      b.setAttribute("aria-label", `${hmOf(s.start)}, ${longOf(S.selDay)}`);
      b.tabIndex = s.start === tabTarget ? 0 : -1;
      el.hours.appendChild(b);
    });
    setAction();
  }

  function renderSummary() {
    const has = S.selDay && S.selSlot;
    if (!el.sumDate) return;
    el.sumDate.textContent = S.selDay ? longOf(S.selDay) : "nie wybrano";
    el.sumDate.classList.toggle("is-empty", !S.selDay);
    el.sumTime.textContent = has ? hmOf(S.selSlot.start) : "nie wybrano";
    el.sumTime.classList.toggle("is-empty", !has);
    el.pick.textContent = has ? `${longOf(S.selDay)}, ${hmOf(S.selSlot.start)} · ${SERVICE.name}, ${SERVICE.minutes} minut` : "";
  }

  function renderNear() {
    if (!el.near) return;
    if (!S.near) {
      el.near.hidden = true;
      return;
    }
    el.nearValue.textContent = `${longOf(ymdOf(S.near.start))}, ${hmOf(S.near.start)}`;
    el.near.hidden = false;
  }

  function renderAll() {
    renderCalendar();
    renderHours();
    renderSummary();
    renderNear();
    renderRail();
  }

  async function selectDay(ymd, keepSlot) {
    S.selDay = ymd;
    if (!keepSlot) S.selSlot = null;
    S.focusYmd = ymd;
    notice(el.whenNotice, "", "");
    renderAll();
    const n = slotsOf(ymd).length;
    announce(`Wybrano ${longOf(ymd)}. ${n} ${plural(n, "wolna godzina", "wolne godziny", "wolnych godzin")}.`);
    if (!desktop.matches) {
      el.hoursTitle.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
    }
  }

  function selectSlot(start) {
    const s = slotsOf(S.selDay).find((x) => x.start === start);
    if (!s) return;
    S.selSlot = s;
    $$(".slot", el.hours).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.start === start)));
    setAction();
    renderSummary();
    renderRail();
    announce(`Wybrano godzinę ${hmOf(start)}, ${longOf(S.selDay)}. Przycisk "Dalej: dane kontaktowe" jest dostępny.`);
  }

  // ---------------------------------------------------------------- przepływ: dalej, wstecz, rezerwacja
  async function goDetails() {
    if (!S.selSlot || S.busy) return;
    S.busy = true;
    el.cont.disabled = true;
    const label = el.cont.textContent;
    el.cont.textContent = "Sprawdzam termin...";
    try {
      // ponowna kontrola dostępności bezpośrednio przed formularzem (finalna kontrola jest też po stronie serwera)
      await loadMonthDay(S.selDay);
      const still = slotsOf(S.selDay).some((s) => s.start === S.selSlot.start);
      if (!still) return slotTaken();
      showPanel("details");
      renderSummary();
      announce("Podaj dane kontaktowe.");
      el.detailsTitle.focus();
    } catch (e) {
      showWhenError(e, goDetails);
    } finally {
      S.busy = false;
      el.cont.textContent = label;
      el.cont.disabled = !S.selSlot;
    }
  }

  async function loadMonthDay(ymd) {
    const res = await api("availability", { from: ymd, to: ymd });
    S.days.delete(ymd);
    (res.slots || []).forEach((s) => {
      if (ymdOf(s.start) !== ymd) return;
      if (!S.days.has(ymd)) S.days.set(ymd, []);
      S.days.get(ymd).push({ start: s.start, end: s.end });
    });
    if (S.days.has(ymd)) S.days.get(ymd).sort((a, b) => new Date(a.start) - new Date(b.start));
    if (res.horizon) S.horizon = res.horizon;
  }

  function slotTaken() {
    S.selSlot = null;
    showPanel("when");
    renderAll();
    const [t, x] = MSG.TAKEN;
    notice(el.whenNotice, "warn", t, x);
    el.hoursTitle.focus();
    announce(`${t} ${x}`);
  }

  function backToWhen(target) {
    showPanel("when");
    renderAll();
    const t = target === "day" ? $(".day[tabindex='0']", el.grid) : el.hoursTitle;
    if (t) t.focus();
  }

  // ---------------------------------------------------------------- formularz
  const NAME_RE = /\S/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PHONE_RE = /^[0-9 +()\-]{6,24}$/;

  function fieldErr(id, text) {
    const p = $("#e-" + id);
    const input = id === "adult" || id === "consent" ? $("#c-" + id) : $("#f-" + id);
    if (!p || !input) return;
    p.hidden = !text;
    p.textContent = text || "";
    if (text) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function validate() {
    const v = {
      name: $("#f-name").value.trim(),
      email: $("#f-email").value.trim(),
      phone: $("#f-phone").value.trim(),
      adult: $("#c-adult").checked,
      consent: $("#c-consent").checked,
    };
    const errs = {};
    if (!NAME_RE.test(v.name)) errs.name = "Wpisz imię.";
    if (!v.email) errs.email = "Wpisz adres e-mail.";
    else if (!EMAIL_RE.test(v.email)) errs.email = "Sprawdź adres e-mail: brakuje części adresu.";
    if (v.phone && !PHONE_RE.test(v.phone)) errs.phone = "Telefon może zawierać cyfry, spacje, plus, nawiasy i myślniki.";
    if (!v.adult) errs.adult = "Rozmowa jest tylko dla osób dorosłych. Zaznacz, jeśli masz co najmniej 18 lat.";
    if (!v.consent) errs.consent = "Bez tej zgody nie mogę umówić rozmowy.";
    ["name", "email", "phone", "adult", "consent"].forEach((k) => fieldErr(k, errs[k]));
    return { v, errs };
  }

  async function submit(ev) {
    ev.preventDefault();
    if (S.busy) return;
    const { v, errs } = validate();
    const keys = Object.keys(errs);
    if (keys.length) {
      const first = keys[0];
      (first === "adult" || first === "consent" ? $("#c-" + first) : $("#f-" + first)).focus();
      announce(`Formularz wymaga poprawek: ${keys.length}.`);
      return;
    }
    if (!S.selSlot) return backToWhen("hour");
    S.busy = true;
    el.submit.disabled = true;
    const label = el.submit.textContent;
    el.submit.textContent = "Rezerwuję...";
    notice(el.formNotice, "", "");
    announce("Rezerwuję termin.");
    try {
      const res = await api("book", {
        start: S.selSlot.start,
        name: v.name,
        email: v.email,
        phone: v.phone,
        adult: true,
        consent: true,
        consentVersion: "v0-draft",
        hp: ev.target.elements.website ? ev.target.elements.website.value : "",
      });
      S.email = v.email;
      done(res);
    } catch (e) {
      const code = codeOf(e);
      if (code === "SLOT_TAKEN") {
        try {
          await loadMonthDay(S.selDay);
        } catch (e2) {
          /* lista odświeży się przy kolejnej próbie */
        }
        slotTaken();
      } else if (code === "NOT_CONFIGURED") {
        unavailable(e);
      } else {
        const [t, x] = MSG[kindOf(code)];
        notice(el.formNotice, "warn", t, x);
        announce(`${t} ${x}`);
      }
    } finally {
      S.busy = false;
      el.submit.disabled = false;
      el.submit.textContent = label;
    }
  }

  function done(res) {
    const b = res.booking || {};
    const start = b.start || S.selSlot.start;
    $("[data-done-service]").textContent = SERVICE.name;
    $("[data-done-date]").textContent = longOf(ymdOf(start));
    $("[data-done-time]").textContent = hmOf(start);
    $("[data-done-dur]").textContent = `${SERVICE.minutes} minut`;
    const mail = $("[data-done-mail]");
    const note = $(".done__note", root);
    if (res.mock) {
      mail.textContent = "TRYB DEWELOPERSKI: rezerwacja jest przykładowa, żadna wiadomość ani zaproszenie nie zostały wysłane.";
      note.hidden = true;
    } else if (res.emailSent) {
      mail.textContent = `Potwierdzenie zostało wysłane na adres ${S.email}.` + (res.inviteSent ? " Zaproszenie do kalendarza przyjdzie na ten sam adres." : "");
      note.hidden = false;
    } else {
      mail.textContent = "Termin jest zarezerwowany, ale nie udało się wysłać potwierdzenia e-mail. Zapisz sobie datę i godzinę.";
      note.hidden = true;
    }
    showPanel("done");
    announce("Termin jest zarezerwowany.");
    el.doneTitle.focus();
  }

  function unavailable(e) {
    const [t, x] = MSG[kindOf(codeOf(e))];
    $("[data-unavail-title]").textContent = codeOf(e) === "NETWORK" || codeOf(e) === "CALENDAR_ERROR" ? "Rezerwacja online jest teraz niedostępna." : t;
    $("[data-unavail-text]").textContent = codeOf(e) === "NETWORK" || codeOf(e) === "CALENDAR_ERROR" ? `${t} ${x}` : x;
    $("[data-retry]").hidden = codeOf(e) === "NOT_CONFIGURED";
    showPanel("unavailable");
    announce(t);
  }

  // ---------------------------------------------------------------- przełożenie terminu (link z e-maila: przeloz.html#t=...)
  function invalidReschedule(title, text) {
    $("[data-invalid-title]").textContent = title;
    $("[data-invalid-text]").textContent = text;
    showPanel("invalid");
    announce(title);
    return true;
  }

  function rescheduleFail(e) {
    const code = codeOf(e);
    if (code === "NOT_FOUND") return invalidReschedule("Ten link jest nieważny.", "Termin mógł zostać już zmieniony, anulowany albo się odbyć.");
    if (code === "TOO_LATE") return invalidReschedule("Tego terminu nie można już zmienić online.", "Do rozpoczęcia zostało zbyt mało czasu. Skorzystaj z innego sposobu kontaktu.");
    if (code === "RESCHEDULE_LIMIT") return invalidReschedule("Termin był już zmieniany maksymalną liczbę razy.", "Jeśli to konieczne, anuluj go i wybierz nowy albo skorzystaj z innego sposobu kontaktu.");
    if (code === "RESCHEDULE_DISABLED") return invalidReschedule("Zmiana terminu online jest wyłączona.", "Możesz anulować ten termin i wybrać nowy.");
    return null;
  }

  async function loadCurrent() {
    S.token = tokenFromHash();
    if (!S.token) return invalidReschedule("Ten link jest niepełny.", "Otwórz link z wiadomości e-mail w całości."), false;
    const res = await api("lookup", { token: S.token });
    const b = res.booking;
    if (b.status !== "confirmed") {
      invalidReschedule(b.status === "past" ? "Ten termin już się odbył." : "Ten termin został już anulowany lub zmieniony.", "Nie można go przełożyć.");
      return false;
    }
    if (!b.canReschedule) {
      invalidReschedule(b.reschedulesLeft === 0 ? "Termin był już zmieniany maksymalną liczbę razy." : "Tego terminu nie można już zmienić online.", "Możesz go anulować albo skorzystać z innego sposobu kontaktu.");
      return false;
    }
    S.current = b;
    $("[data-current]").textContent = `${longOf(ymdOf(b.start))}, ${hmOf(b.start)}`;
    return true;
  }

  async function doReschedule() {
    if (!S.selSlot || S.busy) return;
    S.busy = true;
    el.cont.disabled = true;
    const label = el.cont.textContent;
    el.cont.textContent = "Przekładam...";
    try {
      const res = await api("reschedule", { token: S.token, newStart: S.selSlot.start });
      const b = res.booking || {};
      $("[data-done-service]").textContent = SERVICE.name;
      $("[data-done-date]").textContent = longOf(ymdOf(b.start || S.selSlot.start));
      $("[data-done-time]").textContent = hmOf(b.start || S.selSlot.start);
      $("[data-done-dur]").textContent = `${SERVICE.minutes} minut`;
      $("[data-done-mail]").textContent = res.mock ? "TRYB DEWELOPERSKI: zmiana jest przykładowa, żadna wiadomość nie została wysłana." : res.emailSent ? "Nowe potwierdzenie zostało wysłane na Twój adres e-mail." : "Termin został zmieniony, ale nie udało się wysłać potwierdzenia e-mail. Zapisz sobie datę i godzinę.";
      el.doneTitle.textContent = "Termin został zmieniony.";
      $(".done__note", root).hidden = true;
      showPanel("done");
      announce("Termin został zmieniony.");
      el.doneTitle.focus();
    } catch (e) {
      if (codeOf(e) === "SLOT_TAKEN") {
        try {
          await loadMonthDay(S.selDay);
        } catch (e2) {
          /* lista odświeży się przy kolejnej próbie */
        }
        slotTaken();
      } else if (!rescheduleFail(e)) {
        const [t, x] = MSG[kindOf(codeOf(e))];
        notice(el.whenNotice, "warn", t, x);
        announce(`${t} ${x}`);
      }
    } finally {
      S.busy = false;
      el.cont.textContent = label;
      el.cont.disabled = !S.selSlot;
    }
  }

  // ---------------------------------------------------------------- start
  async function boot() {
    showPanel("loading");
    S.days.clear();
    S.loaded.clear();
    try {
      if (VIEW === "reschedule") {
        if (!(await loadCurrent())) return;
        el.cont.textContent = "Przełóż termin";
      }
      const [, nearRes] = await Promise.all([loadMonth(S.y, S.m, true), api("nextSlot", {})]);
      S.near = (nearRes && nearRes.slot) || null;
      if (!hasAnyInMonth() && S.near) {
        const nd = ymdOf(S.near.start);
        S.y = Number(nd.slice(0, 4));
        S.m = Number(nd.slice(5, 7)) - 1;
        await loadMonth(S.y, S.m, true);
      }
      showPanel("when");
      renderAll();
      if (!S.near && !hasAnyInMonth()) {
        notice(el.whenTop, "info", "Brak wolnych terminów w najbliższym czasie.", "Zajrzyj tu później: nowe terminy pojawiają się na bieżąco.");
      }
      announce(S.near ? `Najbliższy wolny termin: ${longOf(ymdOf(S.near.start))}, ${hmOf(S.near.start)}.` : "Brak wolnych terminów w najbliższym czasie.");
    } catch (e) {
      if (VIEW === "reschedule" && rescheduleFail(e)) return;
      unavailable(e);
    }
  }

  function hasAnyInMonth() {
    const { from, to } = monthRange(S.y, S.m);
    for (let d = from; d <= to; d = addDays(d, 1)) if (hasFree(d)) return true;
    return false;
  }

  // ---------------------------------------------------------------- zdarzenia
  el.grid.addEventListener("click", (ev) => {
    const b = ev.target.closest(".day");
    if (!b || b.getAttribute("aria-disabled") === "true") return;
    selectDay(b.dataset.ymd);
  });

  el.grid.addEventListener("keydown", async (ev) => {
    const b = ev.target.closest(".day");
    if (!b) return;
    const ymd = b.dataset.ymd;
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
    let target = null;
    if (move) target = addDays(ymd, move);
    else if (ev.key === "Home") target = addDays(ymd, -weekdayMon0(ymd));
    else if (ev.key === "End") target = addDays(ymd, 6 - weekdayMon0(ymd));
    else if (ev.key === "PageUp" || ev.key === "PageDown") {
      const dir = ev.key === "PageUp" ? -1 : 1;
      const d = dateOf(ymd);
      target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, d.getUTCDate(), 12)).toISOString().slice(0, 10);
    } else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      if (b.getAttribute("aria-disabled") !== "true") selectDay(ymd);
      else announce(`${longOf(ymd)}: brak terminów.`);
      return;
    }
    if (!target) return;
    ev.preventDefault();
    const tm = Number(target.slice(5, 7)) - 1;
    const ty = Number(target.slice(0, 4));
    if (ty === S.y && tm === S.m) {
      S.focusYmd = target;
      focusDay(target);
    } else {
      const todayKey = keyOf(Number(nowYmd.slice(0, 4)), Number(nowYmd.slice(5, 7)) - 1);
      if (keyOf(ty, tm) < todayKey) return;
      if (S.horizon && keyOf(ty, tm) > S.horizon.last.slice(0, 7)) return;
      S.focusYmd = target;
      await gotoMonth(ty, tm, target);
    }
  });

  el.prev.addEventListener("click", () => gotoMonth(S.m === 0 ? S.y - 1 : S.y, S.m === 0 ? 11 : S.m - 1));
  el.next.addEventListener("click", () => gotoMonth(S.m === 11 ? S.y + 1 : S.y, S.m === 11 ? 0 : S.m + 1));

  el.hours.addEventListener("click", (ev) => {
    const b = ev.target.closest(".slot");
    if (b) selectSlot(b.dataset.start);
  });
  el.hours.addEventListener("keydown", (ev) => {
    const list = $$(".slot", el.hours);
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    let j = null;
    if (step) j = (i + step + list.length) % list.length;
    else if (ev.key === "Home") j = 0;
    else if (ev.key === "End") j = list.length - 1;
    if (j === null) return;
    ev.preventDefault();
    list.forEach((x) => (x.tabIndex = -1));
    list[j].tabIndex = 0;
    list[j].focus();
    selectSlot(list[j].dataset.start);
  });

  el.cont.addEventListener("click", VIEW === "reschedule" ? doReschedule : goDetails);
  if (el.form) el.form.addEventListener("submit", submit);
  if (el.back) el.back.addEventListener("click", () => backToWhen("hour"));
  const retryBtn = $("[data-retry]");
  if (retryBtn) retryBtn.addEventListener("click", boot);

  if (el.nearPick) el.nearPick.addEventListener("click", async () => {
    if (!S.near) return;
    const nd = ymdOf(S.near.start);
    const ny = Number(nd.slice(0, 4));
    const nm = Number(nd.slice(5, 7)) - 1;
    if (ny !== S.y || nm !== S.m) await gotoMonth(ny, nm);
    await selectDay(nd);
    const slot = slotsOf(nd).find((s) => s.start === S.near.start);
    if (slot) selectSlot(slot.start);
    renderAll();
    el.hoursTitle.focus();
  });

  if (el.rail) {
    $$("[data-goto]", el.rail).forEach((b) =>
      b.addEventListener("click", () => {
        const g = b.dataset.goto;
        if (g === "day" || g === "hour") backToWhen(g);
      })
    );
  }

  if (el.form) {
    ["f-name", "f-email", "f-phone"].forEach((id) => $("#" + id).addEventListener("input", () => fieldErr(id.slice(2), "")));
    ["c-adult", "c-consent"].forEach((id) => $("#" + id).addEventListener("change", () => fieldErr(id.slice(2), "")));
  }

  // opis rozmowy: na telefonie zwinięty, na desktopie zawsze otwarty
  const syncDetails = () => {
    if (el.svcDetails) el.svcDetails.open = desktop.matches;
  };
  syncDetails();
  desktop.addEventListener("change", syncDetails);

  // ---------------------------------------------------------------- uruchomienie (mock tylko lokalnie z ?mock=1)
  if (wantMock) startWithMock(boot);
  else boot();

  function startWithMock(run) {
    const bar = document.createElement("p");
    bar.className = "devbar";
    bar.textContent = "TRYB DEWELOPERSKI (mock): dane przykładowe, to nie jest prawdziwa dostępność.";
    document.body.insertBefore(bar, document.body.firstChild);
    document.title = "[MOCK] " + document.title;
    const sc = document.createElement("script");
    sc.src = "dev/booking-mock.js";
    sc.onload = run;
    sc.onerror = () => {
      const t = $("[data-unavail-title], [data-invalid-title]");
      if (t) t.textContent = "Nie udało się wczytać mocka deweloperskiego.";
    };
    document.head.appendChild(sc);
  }
})();
