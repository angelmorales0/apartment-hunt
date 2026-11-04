#!/usr/bin/env python3
"""Turn listings/*.json into data/places.json.

Runs the bike, drive, gym, and trail checks. Uses only the standard library.
Results are cached in data/cache.json, so repeat runs only check new places.
"""
import glob, json, math, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UA = {"User-Agent": "apartment-hunt-map"}
NETFLIX = {"lat": 37.2596, "lon": -121.9627, "name": "Netflix Los Gatos", "address": "100 Winchester Cir, Los Gatos"}
PALANTIR_ADDRESS = "100 Hamilton Avenue, Palo Alto, CA"
BBOX = "37.17,-122.25,37.47,-121.82"
SPEEDS = [16, 20, 25]  # km/h: 9.9, 12.4, and 15.5 mph
SKIP_GYM = re.compile(r"yoga|pilates|barre|dance|orangetheory|f45|boxing|martial|karate|jiu|taekwon|physical therapy|rehab|massage|cycle|spin|swim|tennis|golf|climb|bouldering|personal train|dojo|stretch|lagree|aquatic|mat room|active age|studio|wellness|senior|kids|gymnastics", re.I)
SKIP_TRAIL = re.compile(r"do not enter|connector|access|bmx|spur|cutoff|jump", re.I)


def load(name, default):
    p = os.path.join(DATA, name)
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return default


def save(name, obj):
    with open(os.path.join(DATA, name), "w") as f:
        json.dump(obj, f, separators=(",", ":"))


def fetch(url, data=None, tries=3, wait=2):
    for t in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except Exception as e:
            print("  retry:", str(e)[:80], file=sys.stderr)
            time.sleep(wait * (t + 1))
    return None


def miles(a, b):
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * 69.055, (a[1] - b[1]) * 69.055 * k)


def decode(shape):
    i, lat, lon, out = 0, 0, 0, []
    while i < len(shape):
        for which in (0, 1):
            sh, res = 0, 0
            while True:
                b = ord(shape[i]) - 63
                i += 1
                res |= (b & 0x1f) << sh
                sh += 5
                if b < 0x20:
                    break
            d = ~(res >> 1) if res & 1 else res >> 1
            if which == 0:
                lat += d
            else:
                lon += d
        out.append((lat / 1e6, lon / 1e6))
    return out


def geocode(q, cache):
    key = "geo:" + q
    if key not in cache:
        r = fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + urllib.parse.quote(q))
        time.sleep(1.2)
        if not r:
            print("  no location for", q, file=sys.stderr)
            return None
        cache[key] = [float(r[0]["lat"]), float(r[0]["lon"])]
    return cache[key]


def route(frm, to, costing, cache, speed=None):
    key = f"route:{costing}:{speed}:{frm[0]:.5f},{frm[1]:.5f}:{to[0]:.5f},{to[1]:.5f}"
    if key not in cache:
        q = {"locations": [{"lat": frm[0], "lon": frm[1]}, {"lat": to[0], "lon": to[1]}], "costing": costing, "units": "miles"}
        if speed:
            q["costing_options"] = {"bicycle": {"bicycle_type": "Hybrid", "cycling_speed": speed}}
        r = fetch("https://valhalla1.openstreetmap.de/route?json=" + urllib.parse.quote(json.dumps(q)))
        time.sleep(1.1)
        if not r or "trip" not in r:
            return None
        s = r["trip"]["summary"]
        pts = [p for leg in r["trip"]["legs"] for p in decode(leg["shape"])]
        cache[key] = {"min": round(s["time"] / 60), "mi": round(s["length"], 1), "shape": [[round(a, 4), round(b, 4)] for a, b in pts[::12]]}
    return cache[key]


def overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    for u in ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"):
        r = fetch(u, body, tries=2, wait=5)
        if r:
            return r
    return None


def fresh(name, days=30):
    p = os.path.join(DATA, name)
    return os.path.exists(p) and time.time() - os.path.getmtime(p) < days * 86400


def get_gyms():
    if fresh("osm_gyms.json"):
        return load("osm_gyms.json", [])
    r = overpass(f'[out:json][timeout:60][bbox:{BBOX}];(nwr[leisure=fitness_centre];nwr[amenity=gym];);out center tags;')
    if not r:
        return load("osm_gyms.json", [])
    gyms, seen = [], set()
    for e in r["elements"]:
        t = e.get("tags", {})
        n = t.get("name") or t.get("brand")
        c = e.get("center") or e
        if not n or SKIP_GYM.search(n) or "lat" not in c or (t.get("access") == "private"):
            continue
        k = (n, round(c["lat"], 3), round(c["lon"], 3))
        if k not in seen:
            seen.add(k)
            gyms.append({"name": n, "lat": c["lat"], "lon": c["lon"]})
    save("osm_gyms.json", gyms)
    return gyms


def get_trails():
    if fresh("osm_trails.json"):
        return load("osm_trails.json", [])
    r = overpass(f'[out:json][timeout:90][bbox:{BBOX}];way[highway~"^(cycleway|path|footway)$"][name~"(Trail|Creek Path|Bike Path)"];out geom tags;')
    if not r:
        return load("osm_trails.json", [])
    by = {}
    for e in r["elements"]:
        n = e.get("tags", {}).get("name")
        if not n or SKIP_TRAIL.search(n) or "geometry" not in e:
            continue
        g = [(p["lat"], p["lon"]) for p in e["geometry"]]
        v = by.setdefault(n, {"len": 0.0, "pts": []})
        v["len"] += sum(miles(a, b) for a, b in zip(g, g[1:]))
        v["pts"] += [[round(p[0], 4), round(p[1], 4)] for p in g[::4]]
    out = [{"name": n, "miles": round(v["len"], 1), "pts": v["pts"]} for n, v in by.items() if v["len"] >= 1.5]
    save("osm_trails.json", out)
    return out


def gym_quality(g, known):
    for k in known:
        if k["match"].lower() not in g["name"].lower():
            continue
        if "near" in k and miles(k["near"], (g["lat"], g["lon"])) > k["radius_mi"]:
            continue
        return k["equipment"], k.get("note")
    return "unknown", None


def isochrone(lat, lon, costing, minutes, speed=None):
    q = {"locations": [{"lat": lat, "lon": lon}], "costing": costing, "contours": [{"time": minutes}], "polygons": True, "denoise": 0.6, "generalize": 60}
    if speed:
        q["costing_options"] = {"bicycle": {"bicycle_type": "Hybrid", "cycling_speed": speed}}
    r = fetch("https://valhalla1.openstreetmap.de/isochrone?json=" + urllib.parse.quote(json.dumps(q)))
    time.sleep(1.5)
    return r["features"][0]["geometry"] if r and r.get("features") else None


def main():
    cache = load("cache.json", {})
    gyms = [g for g in get_gyms() if not SKIP_GYM.search(g["name"])]
    trails, known = get_trails(), load("gyms_known.json", [])
    print(len(gyms), "gyms,", len(trails), "trails")
    pal = geocode(PALANTIR_ADDRESS, cache)
    net = (NETFLIX["lat"], NETFLIX["lon"])

    merged = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "listings", "*.json"))):
        try:
            with open(path) as f:
                rows = json.load(f)
        except Exception as e:
            print("skip bad file", path, e, file=sys.stderr)
            continue
        for x in rows if isinstance(rows, list) else []:
            if not isinstance(x, dict) or not isinstance(x.get("rent_monthly"), (int, float)):
                continue
            k = x.get("source_url") or x.get("address") or x.get("name")
            merged[k] = {**merged.get(k, {}), **{a: b for a, b in x.items() if b is not None}}

    places = []
    for x in merged.values():
        print("-", x.get("name"))
        if x.get("lat") is not None and x.get("lon") is not None:
            pt = (float(x["lat"]), float(x["lon"]))
        elif x.get("address"):
            pt = geocode(x["address"], cache)
        else:
            pt = None
        if not pt or miles(pt, net) > 40:
            print("  no usable location", file=sys.stderr)
            continue
        pt = tuple(pt)
        exact = bool(x.get("address")) or bool(x.get("location_exact"))
        bike = {str(s): route(pt, net, "bicycle", cache, s) for s in SPEEDS}
        bike_p = route(pt, pal, "bicycle", cache, 20)
        drive_p = route(pt, pal, "auto", cache)
        drive_n = route(pt, net, "auto", cache)
        corridor = [tuple(p) for r in (bike["20"], drive_p) if r for p in r["shape"]]
        near = []
        for g in gyms:
            d = miles(pt, (g["lat"], g["lon"]))
            way = min((miles(p, (g["lat"], g["lon"])) for p in corridor), default=9) <= 0.3
            if d <= 3 or way:
                q, note = gym_quality(g, known)
                near.append({"name": g["name"], "mi": round(d, 1), "on_way": way, "equipment": q, "note": note, "lat": g["lat"], "lon": g["lon"]})
        rank = {"yes": 0, "unknown": 1, "no": 2}
        near.sort(key=lambda g: (g["mi"] > 1.5 and not g["on_way"], rank[g["equipment"]], g["mi"]))
        tr = sorted(({"name": t["name"], "miles": t["miles"], "mi": round(min(miles(pt, p) for p in t["pts"]), 1)} for t in trails), key=lambda t: t["mi"])[:2]
        x.update({
            "lat": round(pt[0], 5), "lon": round(pt[1], 5), "location_exact": exact,
            "bike_netflix": {s: ({"min": r["min"], "mi": r["mi"]} if r else None) for s, r in bike.items()},
            "bike_palantir": {"min": bike_p["min"], "mi": bike_p["mi"]} if bike_p else None,
            "drive_palantir": {"min": drive_p["min"], "mi": drive_p["mi"]} if drive_p else None,
            "drive_netflix": {"min": drive_n["min"], "mi": drive_n["mi"]} if drive_n else None,
            "gyms": near[:4], "trails": tr,
        })
        places.append(x)
        save("cache.json", cache)

    rings = load("rings.json", {})
    for s in SPEEDS:
        rings.setdefault(f"netflix_{s}", None)
        if not rings[f"netflix_{s}"]:
            rings[f"netflix_{s}"] = isochrone(net[0], net[1], "bicycle", 60, s)
    if not rings.get("palantir_drive"):
        rings["palantir_drive"] = isochrone(pal[0], pal[1], "auto", 20)
    save("rings.json", rings)

    places.sort(key=lambda p: p.get("rent_low", p["rent_monthly"]))
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "offices": {"netflix": {**NETFLIX}, "palantir": {"lat": pal[0], "lon": pal[1], "name": "Palantir", "address": "100 Hamilton Ave, Palo Alto"}},
           "places": places}
    save("places.json", out)
    save("cache.json", cache)
    print(len(places), "places written")


if __name__ == "__main__":
    main()
