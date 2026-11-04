const $ = id => document.getElementById(id);
const money = n => "$" + Math.round(n).toLocaleString("en-US");
const short = n => n >= 1000 ? "$" + (n / 1000).toFixed(n % 100 ? 2 : 1).replace(/0$/, "") + "k" : "$" + n;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = u => /^https:\/\//.test(u || "") ? u : null;
const low = p => p.rent_low ?? p.rent_monthly;
const priceBand = n => n <= 3300 ? "p1" : n <= 3700 ? "p2" : n <= 4100 ? "p3" : "p4";

let DATA, REQ, RINGS, map, active = null;
const pins = new Map();
const ringLayers = {};

const KNOWN = new Set(["max_rent", "min_beds", "max_bike_netflix_min", "max_commute_palantir_min", "gym_near", "gym_equipment", "trail_near"]);
function req(kind) { return REQ.items.find(r => r.kind === kind && r.value !== null && r.value !== undefined); }

function bestGym(p) {
  const near = (req("gym_near") || {}).value ?? 3;
  const ok = (p.gyms || []).filter(g => g.mi <= near || g.on_way);
  return { ok, top: ok.find(g => g.equipment === "yes") || ok.find(g => g.equipment === "unknown") || ok[0] };
}

// A place passes every must-have, or it is a near miss with the reasons.
function evaluate(p) {
  const speed = $("speed").value, fails = [];
  const rent = req("max_rent"), beds = req("min_beds"), bike = req("max_bike_netflix_min"), lim = req("max_commute_palantir_min");
  if (rent && low(p) > rent.value) fails.push("Rent over " + money(rent.value));
  if (beds && (p.beds ?? 0) < beds.value) fails.push("Too few bedrooms");
  const b = p.bike_netflix?.[speed];
  if (bike?.must && b && b.min > bike.value) fails.push(`${b.min} min bike to Netflix`);
  if (lim && p.drive_palantir && p.drive_palantir.min > lim.value) fails.push(`${p.drive_palantir.min} min to Palantir`);
  const g = bestGym(p);
  if (req("gym_near") && (!g.ok.length || (req("gym_equipment") && !g.ok.some(x => x.equipment === "yes")))) fails.push("No barbell gym close by");
  return { state: fails.length ? "miss" : "match", fails };
}

function visible() {
  const type = $("type").value;
  return DATA.places.map(p => ({ p, e: evaluate(p) })).filter(({ p, e }) =>
    ($("nearMiss").checked || e.state !== "miss") &&
    (type === "all" || (type === "furnished") === !!p.furnished)
  ).sort((a, b) => low(a.p) - low(b.p));
}

const nearestGym = p => [...(p.gyms || [])].sort((a, b) => a.mi - b.mi)[0];
function netflixText(p) {
  const b = p.bike_netflix?.[$("speed").value], c = p.drive_netflix;
  return [b && `${b.min} min bike`, c && `${c.min} min car`].filter(Boolean).join(", ") || "No route";
}
const palantirText = p => p.drive_palantir ? `${p.drive_palantir.min} min car` : "No route";

function tip(p) {
  const g = bestGym(p).top || nearestGym(p), t = p.trails?.[0];
  return `<b>${esc(p.name)}</b><br>Netflix: ${netflixText(p)}<br>Palantir: ${palantirText(p)}<br>Gym: ${g ? `${g.mi} mi` : "None within 3 mi"}<br>Trail: ${t ? `${t.mi} mi` : "None found"}`;
}

function card({ p, e }, i) {
  const s = $("speed").value, b = p.bike_netflix?.[s], g = bestGym(p), t = p.trails?.[0];
  const states = { match: "Fits your limits", miss: "Near miss: " + e.fails.join(", ").toLowerCase() };
  const rent = p.rent_low ? `${money(p.rent_low)}&ndash;${money(p.rent_monthly)}` : money(p.rent_monthly);
  const shown = g.top || nearestGym(p);
  const gymText = shown ? `${shown.mi} mi, ${esc(shown.name)}${shown.on_way ? ", on the way" : ""}. ${shown.note ? esc(shown.note) : "Equipment not published"}` : "None within 3 mi";
  const site = safeUrl(p.website), listing = safeUrl(p.source_url);
  const size = [`${p.beds} bed`, p.baths && `${p.baths} bath`, p.sqft && `${p.sqft} sq ft`].filter(Boolean).join(", ");
  const links = [site && `<a href="${esc(site)}" target="_blank" rel="noopener">Website</a>`, listing && listing !== site && `<a href="${esc(listing)}" target="_blank" rel="noopener">${esc(p.source_site)}</a>`].filter(Boolean).join(" · ");
  return `<div class="card ${p === active ? "on" : ""}" tabindex="0" data-i="${DATA.places.indexOf(p)}">
    <div class="head"><div><div class="name"><a href="${esc(site || listing || "#")}" target="_blank" rel="noopener">${esc(p.name)}</a></div><div class="city">${p.address ? esc(p.address.replace(/, CA$/, "")) : esc(p.city) + ", area only. The exact address is private"}${p.furnished ? ", furnished" : ""}</div></div>
    <div><div class="price">${rent}</div><div class="each">${money(low(p) / 2)} each</div></div></div>
    <span class="status ${e.state}">${esc(states[e.state])}</span>
    <div class="rows">
      <div><span>Netflix</span><span>${netflixText(p)}${b && req("max_bike_netflix_min") && b.min > req("max_bike_netflix_min").value ? ". Bike is over your 1 hour goal" : ""}</span></div>
      <div><span>Palantir</span><span>${palantirText(p)}</span></div>
      <div><span>Size</span><span>${esc(size)}</span></div>
      <div><span>Gym</span><span>${gymText}</span></div>
      ${p.building_gym ? `<div><span>In building</span><span>Gym: ${esc(p.building_gym)}</span></div>` : ""}
      <div><span>Trail</span><span>${t ? `${t.mi} mi, ${esc(t.name)}` : "None found"}</span></div>
      ${p.laundry ? `<div><span>Laundry</span><span>${esc(p.laundry)}</span></div>` : ""}
      ${p.available_date ? `<div><span>Open</span><span>${esc(p.available_date)}</span></div>` : ""}
    </div>
    ${p.amenities?.length ? `<div class="nice">${p.amenities.map(esc).join(" · ")}</div>` : ""}
    ${p.rent_note ? `<div class="nice">${esc(p.rent_note)}</div>` : ""}
    <div class="nice">${links}${p.seen_on ? ` · Checked ${esc(p.seen_on)}` : ""}</div>
  </div>`;
}

function draw() {
  const rows = visible();
  const n = { match: 0, miss: 0 };
  DATA.places.forEach(p => n[evaluate(p).state]++);
  $("counts").innerHTML = `<div><b>${n.match}</b><span>Fit your limits</span></div><div><b>${n.miss}</b><span>Near miss</span></div>`;
  $("list").innerHTML = rows.length ? rows.map(card).join("") : `<div class="none">No places fit these filters. Turn on near misses to see what is close.</div>`;
  $("list").querySelectorAll(".card").forEach(c => c.addEventListener("click", ev => {
    if (ev.target.closest("a")) return;
    pick(DATA.places[+c.dataset.i], true);
  }));
  $("list").querySelectorAll(".card").forEach(c => c.addEventListener("keydown", ev => {
    if (ev.key === "Enter" && ev.target === c) pick(DATA.places[+c.dataset.i], true);
  }));
  pins.forEach(m => m.remove()); pins.clear();
  for (const { p, e } of rows) {
    const cls = `pin ${e.state === "miss" ? "miss" : priceBand(low(p))} ${p.location_exact ? "" : "approx"} ${p === active ? "on" : ""}`;
    const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: `<span class="${cls}">${short(low(p))}</span>`, iconSize: [0, 0] }), title: p.name, zIndexOffset: 2000 - low(p) / 4 }).addTo(map);
    m.bindTooltip(tip(p), { direction: "top", offset: [0, -22] });
    m.on("click", () => pick(p, false));
    pins.set(p, m);
  }
  drawRings();
  declutter();
}

// The cheapest pins keep their price. A pin that would cover one becomes a dot.
function declutter() {
  const placed = [];
  const order = [...pins.entries()].sort(([a], [b]) => (b === active) - (a === active) || low(a) - low(b));
  for (const [p, m] of order) {
    const el = m.getElement()?.querySelector(".pin");
    if (!el) continue;
    const c = map.latLngToLayerPoint(m.getLatLng());
    const box = [c.x - 28, c.y - 27, c.x + 28, c.y + 2];
    const hit = placed.some(o => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]);
    el.classList.toggle("dot", hit && p !== active);
    if (!hit || p === active) placed.push(box);
  }
}

function pick(p, pan) {
  active = active === p ? null : p;
  draw();
  if (active && pan) map.panTo([p.lat, p.lon]);
  if (active && !pan) document.querySelector(".card.on")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function drawRings() {
  const css = getComputedStyle(document.documentElement);
  Object.values(ringLayers).forEach(l => l.remove());
  const add = (key, g, color) => { if (g) ringLayers[key] = L.geoJSON(g, { interactive: false, style: { color, weight: 2, fillColor: color, fillOpacity: .07 } }).addTo(map); };
  if ($("ringNetflix").checked) add("n", RINGS["netflix_" + $("speed").value], css.getPropertyValue("--net").trim());
  if ($("ringPalantir").checked) add("p", RINGS.palantir_drive, css.getPropertyValue("--pal").trim());
}

function drawReqs() {
  const groups = [["shared", "Both of you"], ["netflix", "Netflix"], ["palantir", "Palantir"]];
  $("reqCount").textContent = `(${REQ.items.length})`;
  $("reqList").innerHTML = groups.map(([k, t]) => {
    const items = REQ.items.filter(r => r.list === k);
    return items.length ? `<h3>${t}</h3><ul>${items.map(r => `<li class="${r.must ? "" : "opt"}">${esc(r.label)}${KNOWN.has(r.kind) ? "" : " (House Hunter checks this)"}</li>`).join("")}</ul>` : "";
  }).join("");
}

async function start() {
  const get = u => fetch(u + "?v=" + Date.now()).then(r => r.json());
  [DATA, REQ, RINGS] = await Promise.all([get("data/places.json"), get("requirements.json"), get("data/rings.json")]);
  const when = new Date(DATA.generated.replace("Z", ":00Z"));
  $("updated").textContent = `Cheapest first. Last updated ${isNaN(when) ? DATA.generated : when.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`;
  map = L.map("map", { scrollWheelZoom: true }).setView([37.34, -122.03], 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  map.on("zoomend", declutter);
  for (const o of Object.values(DATA.offices)) {
    L.marker([o.lat, o.lon], { icon: L.divIcon({ className: "", html: `<span class="office">${esc(o.name)}</span>`, iconSize: [0, 0] }), title: o.address, zIndexOffset: 3000 }).addTo(map);
  }
  drawReqs();
  for (const id of ["speed", "type", "nearMiss", "ringNetflix", "ringPalantir"]) $(id).addEventListener("change", draw);
  draw();
  const all = DATA.places.map(p => [p.lat, p.lon]).concat(Object.values(DATA.offices).map(o => [o.lat, o.lon]));
  if (all.length) map.fitBounds(all, { padding: [30, 30] });
}
start().catch(e => { $("updated").textContent = "The data did not load. Try again later."; console.error(e); });
