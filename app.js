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
  const near = (req("gym_near") || {}).value ?? 1.5;
  const ok = (p.gyms || []).filter(g => g.mi <= near || g.on_way);
  return { ok, top: ok.find(g => g.equipment === "confirmed") || ok.find(g => g.equipment === "likely") || ok[0] };
}

// A must-have fails, or stays open when the listing does not prove it.
function evaluate(p) {
  const speed = $("speed").value, fails = [], open = [];
  const rent = req("max_rent"), beds = req("min_beds"), bike = req("max_bike_netflix_min"), lim = req("max_commute_palantir_min");
  if (rent && low(p) > rent.value) fails.push("Rent over " + money(rent.value));
  if (beds && (p.beds ?? 0) < beds.value) fails.push("Too few bedrooms");
  const b = p.bike_netflix?.[speed];
  if (bike && b && b.min > bike.value) fails.push(`${b.min} min bike to Netflix`);
  if (bike && !b) open.push("No bike route found");
  if (lim && p.drive_palantir && p.drive_palantir.min > lim.value) fails.push(`${p.drive_palantir.min} min to Palantir`);
  const g = bestGym(p), building = p.building_gym;
  if (req("gym_near") && !g.ok.length && !building) fails.push("No gym near or on the way");
  if (req("gym_equipment") && !(g.ok.some(x => x.equipment === "confirmed") || p.gym_equipment === "confirmed")) open.push("Gym equipment");
  if (!p.source_url) open.push("Price not checked");
  if (!p.location_exact) open.push("Exact address");
  return { state: fails.length ? "miss" : open.length ? "check" : "match", fails, open };
}

function visible() {
  const type = $("type").value;
  return DATA.places.map(p => ({ p, e: evaluate(p) })).filter(({ p, e }) =>
    ($("nearMiss").checked || e.state !== "miss") &&
    (type === "all" || (type === "furnished") === !!p.furnished)
  ).sort((a, b) => low(a.p) - low(b.p));
}

function card({ p, e }, i) {
  const s = $("speed").value, b = p.bike_netflix?.[s], g = bestGym(p), t = p.trails?.[0];
  const states = { match: "Match", check: "Not confirmed: " + e.open.join(", ").toLowerCase(), miss: "Near miss: " + e.fails.join(", ").toLowerCase() };
  const rent = p.rent_low ? `${money(p.rent_low)}&ndash;${money(p.rent_monthly)}` : money(p.rent_monthly);
  const gymText = g.top ? `${esc(g.top.name)}, ${g.top.mi} mi${g.top.on_way ? ", on the way" : ""}. ${g.top.note ? esc(g.top.note) : g.top.equipment === "unknown" ? "Equipment unknown" : ""}` : "None within range";
  const building = p.building_gym ? `In the building: ${esc(p.building_gym)}. ` : "";
  const link = safeUrl(p.source_url);
  return `<button type="button" class="card ${p === active ? "on" : ""}" data-i="${DATA.places.indexOf(p)}">
    <div class="head"><div><div class="name">${esc(p.name)}</div><div class="city">${esc(p.city)}${p.location_exact ? "" : ", approximate location"}${p.furnished ? ", furnished" : ""}</div></div>
    <div><div class="price">${rent}</div><div class="each">${money(low(p) / 2)} each</div></div></div>
    <span class="status ${e.state}">${esc(states[e.state])}</span>
    <div class="rows">
      <div><span>Netflix</span><span class="${b && req("max_bike_netflix_min") && b.min > req("max_bike_netflix_min").value ? "fail" : ""}">${b ? `${b.min} min bike, ${b.mi} mi` : "No route"}</span></div>
      <div><span>Palantir</span><span>${p.drive_palantir ? `${p.drive_palantir.min} min drive` : "No route"}${p.bike_palantir ? `, ${p.bike_palantir.min} min bike` : ""}</span></div>
      <div><span>Gym</span><span>${building}${gymText}</span></div>
      <div><span>Trail</span><span>${t ? `${esc(t.name)}, ${t.mi} mi` : "None found"}</span></div>
    </div>
    ${p.amenities?.length ? `<div class="nice">${p.amenities.map(esc).join(" · ")}</div>` : ""}
    ${p.rent_note ? `<div class="nice">${esc(p.rent_note)}</div>` : ""}
    <div class="nice">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(p.source_site)}</a>` : esc(p.source_site)}</div>
  </button>`;
}

function draw() {
  const rows = visible();
  const n = { match: 0, check: 0, miss: 0 };
  DATA.places.forEach(p => n[evaluate(p).state]++);
  $("counts").innerHTML = `<div><b>${n.match}</b><span>Match</span></div><div><b>${n.check}</b><span>Not confirmed</span></div><div><b>${n.miss}</b><span>Near miss</span></div>`;
  $("list").innerHTML = rows.length ? rows.map(card).join("") : `<div class="none">No places fit these filters. Turn on near misses to see what is close.</div>`;
  $("list").querySelectorAll(".card").forEach(c => c.addEventListener("click", ev => {
    if (ev.target.closest("a")) return;
    pick(DATA.places[+c.dataset.i], true);
  }));
  pins.forEach(m => m.remove()); pins.clear();
  for (const { p, e } of rows) {
    const cls = `pin ${e.state === "miss" ? "miss" : priceBand(low(p))} ${p.location_exact ? "" : "approx"} ${p === active ? "on" : ""}`;
    const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: `<span class="${cls}">${short(low(p))}</span>`, iconSize: [0, 0] }), title: p.name, zIndexOffset: 2000 - low(p) / 4 }).addTo(map);
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
