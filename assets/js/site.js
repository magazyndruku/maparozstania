// Doświadczenie strony "Horyzont": noc > świt > dzień (CHAOS > CLARITY > ACTION).
// Bez zależności, bez śledzenia, bez zapisu danych. Bez JS i przy ograniczonym ruchu treść jest od razu w stanie końcowym.
(() => {
  "use strict";

  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const wide = window.matchMedia("(min-width: 64em)");
  const finePointer = window.matchMedia("(pointer: fine)");
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  const topbar = document.querySelector("[data-topbar]");
  const scene = document.querySelector("[data-hero-pin]");
  const hero = document.querySelector("[data-hero]");
  const words = hero ? [...hero.querySelectorAll(".mist__w")] : [];
  const dawn = document.querySelector("[data-dawn]");
  const sunrise = dawn ? dawn.querySelector(".sunrise") : null;
  const nightZones = [...document.querySelectorAll("[data-tone='night']")];
  const path = document.querySelector("[data-path]");
  const steps = path ? [...path.querySelectorAll(".path__step")] : [];
  const where = document.querySelector("[data-where]");
  const chapters = [...document.querySelectorAll("[data-where-label]")];

  // ---------------------------------------------------------------- tryb i pomiary
  const offsetIn = (el, ancestor) => {
    let x = 0;
    let y = 0;
    let n = el;
    while (n && n !== ancestor) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    return { x, y };
  };

  // Słowa leżą w porządku pod linią planu; chaos to przesunięcie do celu na niebie (cele w CSS jako ułamki hero).
  const measureMist = () => {
    if (!hero) return;
    const w = hero.offsetWidth;
    const h = hero.offsetHeight;
    words.forEach((el) => {
      const cs = getComputedStyle(el);
      const cx = parseFloat(cs.getPropertyValue("--cx")) || 0;
      const cy = parseFloat(cs.getPropertyValue("--cy")) || 0;
      const at = offsetIn(el, hero);
      el.style.setProperty("--dx", (cx * w - at.x).toFixed(1) + "px");
      el.style.setProperty("--dy", (cy * h - at.y).toFixed(1) + "px");
    });
  };

  const setMode = () => {
    root.classList.toggle("is-reduced", reduce.matches);
    root.classList.remove("is-pinned");
    const stick = topbar ? topbar.offsetHeight : 0;
    root.style.setProperty("--stick", stick + "px");
    if (hero && scene) {
      // Przypięcie tylko gdy scena mieści się w oknie (powiększenie tekstu, niskie okna: bez obcinania).
      const over = Math.max(0, hero.offsetHeight - (window.innerHeight - stick));
      root.style.setProperty("--pin-top", stick - over + "px");
      root.style.setProperty("--scene-h", Math.round(hero.offsetHeight + window.innerHeight * 0.8) + "px");
      root.classList.toggle("is-pinned", !reduce.matches && wide.matches && over <= 40);
    }
    measureMist();
    placeLights();
  };

  // ---------------------------------------------------------------- hero: lekkie osiadanie przy wejściu
  let settle = reduce.matches ? 1 : 0;
  if (!reduce.matches && hero) {
    const start = performance.now();
    const step = (t) => {
      const x = clamp((t - start) / 1800);
      settle = 1 - Math.pow(1 - x, 4);
      requestUpdate();
      if (x < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- pętla przewijania
  let ticking = false;
  function requestUpdate() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }

  function update() {
    ticking = false;
    const vh = window.innerHeight;
    const y = window.scrollY;
    const doc = root.scrollHeight - vh;
    const stick = topbar ? topbar.offsetHeight : 0;

    if (topbar) {
      topbar.style.setProperty("--sp", doc > 0 ? (y / doc).toFixed(4) : "0");
      topbar.classList.toggle("is-compact", y > 24);
      // Topbar przyjmuje ton tła, nad którym jest: noc albo dzień.
      const night = nightZones.some((z) => {
        const r = z.getBoundingClientRect();
        const end = r.top + r.height * (parseFloat(z.getAttribute("data-tone-end")) || 1);
        return r.top < stick && end > stick;
      });
      topbar.classList.toggle("is-day", !night);
    }

    if (hero) {
      let p;
      if (reduce.matches) {
        p = 1;
      } else if (root.classList.contains("is-pinned")) {
        const travel = scene.offsetHeight - hero.offsetHeight;
        p = travel > 0 ? clamp((stick - scene.getBoundingClientRect().top) / (travel * 0.85)) : 1;
      } else {
        p = clamp(-hero.getBoundingClientRect().top / (hero.offsetHeight * 0.45));
      }
      const q = (1 - p) * (1 - 0.14 * settle);
      hero.style.setProperty("--q", q.toFixed(4));
      hero.style.setProperty("--qo", Math.min(1, q * (wide.matches ? 2.2 : 4)).toFixed(4));
    }

    if (sunrise) {
      const r = sunrise.getBoundingClientRect();
      const rise = reduce.matches ? 1 : clamp((vh - r.top) / (vh * 0.85));
      dawn.style.setProperty("--r", rise.toFixed(4));
    }

    if (path) {
      if (reduce.matches) {
        path.style.setProperty("--pp", "1");
        steps.forEach((s) => s.classList.add("is-lit"));
      } else {
        const r = path.getBoundingClientRect();
        const rail = path.querySelector(".path__rail");
        const pp = wide.matches ? clamp((vh * 0.85 - r.top) / (vh * 0.55)) : clamp((vh * 0.7 - r.top) / (r.height * 0.9));
        path.style.setProperty("--pp", pp.toFixed(4));
        // Krok zapala się, gdy dojdzie do niego światło na linii.
        steps.forEach((s) => {
          const at = offsetIn(s.querySelector(".path__dot"), path);
          const lit = wide.matches ? pp * rail.offsetWidth >= at.x - 2 : rail.offsetTop + pp * rail.offsetHeight >= at.y;
          s.classList.toggle("is-lit", lit);
        });
      }
    }

    if (where && chapters.length) {
      let label = "";
      chapters.forEach((c) => {
        if (c.getBoundingClientRect().top <= stick + 24) label = c.getAttribute("data-where-label");
      });
      if (where.textContent !== label) where.textContent = label;
    }
  }

  // ---------------------------------------------------------------- reakcja na kursor: głębia mgły w hero
  if (hero) {
    hero.addEventListener("pointermove", (e) => {
      if (reduce.matches || !finePointer.matches) return;
      const r = hero.getBoundingClientRect();
      hero.style.setProperty("--px", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      hero.style.setProperty("--py", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
    hero.addEventListener("pointerleave", () => {
      hero.style.setProperty("--px", "0");
      hero.style.setProperty("--py", "0");
    });
  }

  // ---------------------------------------------------------------- reakcja na kursor: magnetyczne CTA
  document.querySelectorAll(".magnetic").forEach((el) => {
    const zone = el.parentElement;
    zone.addEventListener("pointermove", (e) => {
      if (reduce.matches || !finePointer.matches) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", clamp((e.clientX - (r.left + r.width / 2)) * 0.14, -6, 6).toFixed(1) + "px");
      el.style.setProperty("--my", clamp((e.clientY - (r.top + r.height / 2)) * 0.2, -4, 4).toFixed(1) + "px");
    });
    zone.addEventListener("pointerleave", () => {
      el.style.setProperty("--mx", "0px");
      el.style.setProperty("--my", "0px");
    });
  });

  // ---------------------------------------------------------------- wybór sytuacji: zawsze jedna otwarta, światło idzie za wyborem
  const lightGroups = [];
  function placeLights() {
    lightGroups.forEach(({ list, buttons }) => {
      const on = buttons.find((b) => b.getAttribute("aria-expanded") === "true");
      if (!on) return;
      list.style.setProperty("--ly", (offsetIn(on, list).y + on.offsetHeight / 2).toFixed(1) + "px");
      const last = buttons[buttons.length - 1];
      list.style.setProperty("--rail-h", (offsetIn(last, list).y + last.offsetHeight - 8).toFixed(1) + "px");
    });
  }

  document.querySelectorAll("[data-select]").forEach((list) => {
    const buttons = [...list.querySelectorAll("button[aria-controls]")];
    const show = (btn, focus) => {
      buttons.forEach((b) => {
        const on = b === btn;
        b.setAttribute("aria-expanded", String(on));
        const panel = document.getElementById(b.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
      placeLights();
      if (focus) btn.focus();
    };
    buttons.forEach((b, i) => {
      b.addEventListener("click", () => show(b, false));
      b.addEventListener("keydown", (e) => {
        const next = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (next) {
          e.preventDefault();
          show(buttons[(i + next + buttons.length) % buttons.length], true);
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          show(buttons[e.key === "Home" ? 0 : buttons.length - 1], true);
        }
      });
    });
    if (list.hasAttribute("data-light")) lightGroups.push({ list, buttons });
    show(buttons.find((b) => b.getAttribute("aria-expanded") === "true") || buttons[0], false);
  });

  // ---------------------------------------------------------------- odsłanianie (raz): zdanie świtu, grafiki czasu
  const reveals = document.querySelectorAll("[data-reveal], [data-time]");
  if (reduce.matches || !("IntersectionObserver" in window)) {
    reveals.forEach((el) => el.classList.add("is-in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("is-in");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    reveals.forEach((el) => io.observe(el));
  }

  // ---------------------------------------------------------------- menu na telefonie
  const menuBtn = document.querySelector("[data-menu]");
  const masthead = document.querySelector(".masthead");
  if (menuBtn && masthead) {
    const close = () => {
      masthead.classList.remove("is-open");
      menuBtn.setAttribute("aria-expanded", "false");
    };
    menuBtn.addEventListener("click", () => {
      const open = !masthead.classList.contains("is-open");
      masthead.classList.toggle("is-open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && masthead.classList.contains("is-open")) {
        close();
        menuBtn.focus();
      }
    });
    masthead.querySelectorAll(".nav a").forEach((a) => a.addEventListener("click", close));
    wide.addEventListener("change", close);
  }

  // ---------------------------------------------------------------- wschód: film (jedyny zorkiestrowany ruch strony)
  // Gra raz, gdy ok. 40% sceny jest w oknie, i zostaje na ostatniej klatce (bez pętli). Plik pobiera się dopiero, gdy scena
  // zbliża się do okna. Ograniczony ruch, oszczędzanie danych, błąd pliku lub odrzucone play(): zostaje zdjęcie świtu.
  const video = sunrise ? sunrise.querySelector(".sunrise__video") : null;
  if (video && "IntersectionObserver" in window) {
    const conn = navigator.connection;
    const saving = !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "")));
    let state = "idle"; // idle | loading | done | off
    let near = null;
    let watch = null;

    const stop = () => {
      if (near) near.disconnect();
      if (watch) watch.disconnect();
    };
    const useStill = () => {
      if (state === "off") return;
      state = "off";
      stop();
      try {
        video.pause();
      } catch (err) {
        /* brak akcji: zdjęcie i tak zostaje */
      }
      sunrise.classList.remove("is-video");
    };
    const attach = () => {
      if (state !== "idle") return;
      state = "loading";
      video.poster = video.dataset.poster || "";
      video.preload = "auto";
      video.addEventListener("error", useStill, { once: true });
      video.addEventListener(
        "ended",
        () => {
          state = "done";
          stop();
        },
        { once: true }
      );
      video.src = video.dataset.src || "";
      sunrise.classList.add("is-video");
    };
    const play = () => {
      attach();
      if (state !== "loading" || !video.paused) return;
      const p = video.play();
      if (p && p.catch) p.catch((err) => (err && err.name === "AbortError" ? null : useStill()));
    };

    // Obserwatory powstają dopiero po zdarzeniu load, żeby pobieranie filmu nie konkurowało z ładowaniem strony.
    const arm = () => {
      if (state !== "idle" || reduce.matches) return;
      near = new IntersectionObserver(
        (list) => {
          if (list.some((e) => e.isIntersecting)) {
            attach();
            near.disconnect();
          }
        },
        { rootMargin: "20% 0px" }
      );
      watch = new IntersectionObserver(
        (list) => {
          const e = list[list.length - 1];
          if (e.intersectionRatio >= 0.4) play();
          else if (e.intersectionRatio < 0.05 && !video.paused) video.pause();
        },
        { threshold: [0, 0.05, 0.4] }
      );
      near.observe(sunrise);
      watch.observe(sunrise);
    };
    if (!reduce.matches && !saving) {
      if (document.readyState === "complete") arm();
      else window.addEventListener("load", arm, { once: true });
    }
    reduce.addEventListener("change", () => {
      if (reduce.matches) useStill();
    });
  }

  // ---------------------------------------------------------------- start
  const refresh = () => {
    setMode();
    requestUpdate();
  };
  setMode();
  update();
  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", refresh);
  reduce.addEventListener("change", refresh);
  wide.addEventListener("change", refresh);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
})();
