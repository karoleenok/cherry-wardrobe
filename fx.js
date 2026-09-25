// Анимации интерфейса. Каждая запускается один раз по событию (нажатие, смена вкладки),
// а не при каждой перерисовке. При системной настройке «уменьшить движение» всё отключается.

// На скрытой вкладке кадры анимации не рисуются, поэтому анимации там тоже пропускаем.
export const reduced = () => document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches;
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 8. смена вкладок ---------- */
export function tabIn(main) {
  if (reduced()) return;
  main.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" });
}

/* ---------- 8. скелетоны: картинка проявляется после загрузки ---------- */
export function watchImages() {
  document.addEventListener("load", (e) => { if (e.target.tagName === "IMG") e.target.classList.add("loaded"); }, true);
  document.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.classList.add("loaded"); }, true);
}
export function markCached(root) {
  $$("img", root).forEach((im) => { if (im.complete && im.naturalWidth) im.classList.add("loaded"); });
}

/* ---------- 8. лёгкий 3D-наклон карточек за курсором ---------- */
export function tilt() {
  if (!matchMedia("(pointer: fine)").matches) return;
  let cur = null;
  document.addEventListener("pointermove", (e) => {
    if (reduced()) return;
    const el = e.target.closest?.(".card, .look-card, .pick");
    if (cur && cur !== el) { cur.style.transform = ""; cur = null; }
    if (!el) return;
    cur = el;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg) translateY(-2px)`;
  });
  document.addEventListener("pointerleave", () => { if (cur) cur.style.transform = ""; cur = null; }, true);
}

/* ---------- 8. «✓ Скопировано» ---------- */
export function copied(btn, text = "✓ Скопировано") {
  if (!btn) return;
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = text;
  btn.classList.add("is-done");
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = old; btn.classList.remove("is-done"); }, 1800);
}

/* ---------- 8. вспышка сердечка и прыжок счётчика вишлиста ---------- */
export function heartBurst(x, y) {
  if (reduced()) return;
  const layer = document.createElement("div");
  layer.className = "fx-burst";
  layer.style.left = x + "px"; layer.style.top = y + "px";
  for (let i = 0; i < 8; i++) {
    const s = document.createElement("i");
    const a = (Math.PI * 2 * i) / 8;
    s.style.setProperty("--dx", Math.cos(a) * 34 + "px");
    s.style.setProperty("--dy", Math.sin(a) * 34 + "px");
    layer.append(s);
  }
  const h = document.createElement("b"); h.textContent = "♥"; layer.append(h);
  document.body.append(layer);
  setTimeout(() => layer.remove(), 800);
}
export function bump(el) {
  if (!el || reduced()) return;
  el.animate([{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(.95)" }, { transform: "scale(1)" }], { duration: 480, easing: "ease-out" });
}

/* ---------- 4. полёт мини-вещей к вкладке ---------- */
export async function flyTo(fromEls, target) {
  if (reduced() || !target) return;
  const t = target.getBoundingClientRect();
  fromEls.slice(0, 5).forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const g = el.cloneNode(true);
    g.className += " fx-ghost";
    Object.assign(g.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    document.body.append(g);
    const dx = t.left + t.width / 2 - (r.left + r.width / 2), dy = t.top + t.height / 2 - (r.top + r.height / 2);
    g.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 60}px) scale(.7) rotate(${(i - 2) * 8}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px,${dy}px) scale(.15)`, opacity: 0.2 },
    ], { duration: 720 + i * 70, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" }).onfinish = () => g.remove();
    setTimeout(() => g.remove(), 1400); // страховка, если анимация не доиграла
  });
  await wait(760);
  bump(target);
}
export function checkPop(el) {
  if (!el || reduced()) return;
  el.animate([{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1.15)", opacity: 1, offset: 0.6 }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out" });
}

/* ---------- 4. тасование карточек образов ---------- */
export function shuffleIn(cards) {
  if (reduced()) return;
  cards.forEach((c, i) => {
    c.animate([
      { transform: `translate(${(i - 1) * -40}px, 20px) rotate(${(i - 1) * -9}deg) scale(.9)`, opacity: 0 },
      { transform: "none", opacity: 1 },
    ], { duration: 420, delay: i * 80, easing: "cubic-bezier(.2,.8,.2,1.15)", fill: "backwards" });
  });
}

/* ---------- 5. слот-машина в конструкторе ---------- */
// slots: [{el, frames: [html…]}] — el получает быстро сменяющиеся картинки и останавливается по очереди.
export async function slotSpin(slots) {
  if (reduced()) return;
  await Promise.all(slots.map(async ({ el, frames }, i) => {
    const ph = el.querySelector(".ph");
    if (!ph || frames.length < 2) return;
    const final = ph.innerHTML;
    const stopAt = 520 + i * 170;
    const t0 = performance.now();
    let k = 0;
    ph.classList.add("spinning");
    while (performance.now() - t0 < stopAt) {
      ph.innerHTML = frames[k++ % frames.length];
      await wait(70 + Math.min(90, (performance.now() - t0) / 8));
    }
    ph.innerHTML = final;
    ph.classList.remove("spinning");
    el.animate([{ transform: "translateY(-6px)" }, { transform: "translateY(2px)" }, { transform: "none" }], { duration: 260, easing: "ease-out" });
  }));
}
export function magnet(el) {
  if (!el || reduced()) return;
  el.animate([{ transform: "scale(1.06)", boxShadow: "0 0 0 6px var(--accent-soft)" }, { transform: "none", boxShadow: "0 0 0 0 transparent" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1.2)" });
}
export function pillsIn(root) {
  if (reduced()) return;
  $$(".score .pill", root).forEach((p, i) => p.animate([{ opacity: 0, transform: "translateY(4px) scale(.95)" }, { opacity: 1, transform: "none" }], { duration: 240, delay: i * 40, fill: "backwards" }));
}

/* ---------- 6. счётчики, календарь, серия ---------- */
export function countUp(els, dur = 700) {
  els.forEach((el) => {
    const end = parseInt(el.textContent.replace(/\D/g, ""), 10);
    if (!end || reduced()) return;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(end * e).toLocaleString("ru-RU");
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = "0";
    requestAnimationFrame(step);
  });
}
export function calendarIn(root) {
  if (reduced()) return;
  $$(".cd.on .dots i", root).forEach((d, i) => d.animate([{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1.3)", opacity: 1, offset: 0.7 }, { transform: "scale(1)" }], { duration: 360, delay: 120 + i * 35, easing: "ease-out", fill: "backwards" }));
  $$(".cd.streak", root).forEach((d, i) => d.animate([{ boxShadow: "0 0 0 0 transparent" }, { boxShadow: "0 0 0 3px var(--accent)" }, { boxShadow: "0 0 0 1.5px var(--accent)" }], { duration: 500, delay: 300 + i * 90, fill: "backwards" }));
}

/* ---------- 7. капсула: вещи слетаются в чемодан ---------- */
export function packIn(root) {
  if (reduced()) return;
  const items = $$(".checklist li", root);
  const box = root.querySelector(".checklist")?.getBoundingClientRect();
  if (!box) return;
  const cx = box.left + box.width / 2, cy = box.top + 40;
  items.forEach((li, i) => {
    const r = li.getBoundingClientRect();
    li.animate([
      { transform: `translate(${cx - (r.left + r.width / 2)}px, ${cy - (r.top + r.height / 2)}px) scale(.4) rotate(${(i % 2 ? 1 : -1) * 12}deg)`, opacity: 0 },
      { transform: "none", opacity: 1 },
    ], { duration: 520, delay: i * 55, easing: "cubic-bezier(.2,.8,.2,1.1)", fill: "backwards" });
  });
}
