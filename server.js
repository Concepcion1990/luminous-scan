/**
 * Luminous Scan — free barcode inventory for every Shopify store owner.
 *
 * PUBLIC APP (Shopify App Store):
 *   1. Create the app in your Partner dashboard (she's on that screen now!)
 *   2. Set env: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, APP_URL (https://your-host)
 *   3. In Partner dashboard → App setup → set App URL + Allowed redirection URLs
 *      to APP_URL and APP_URL/auth/callback
 *   4. Deploy, install on a dev store to test, then submit for App Store review.
 *
 * SINGLE-STORE shortcut (custom token, no OAuth):
 *   Set SHOPIFY_STORE + SHOPIFY_TOKEN env vars instead.
 *
 * DEMO (default): built-in sample products, no Shopify needed.
 */
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.SHOPIFY_API_KEY || "";
const API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const SCOPES = "read_products,write_products,read_inventory,write_inventory";

// Single-store shortcut
const SINGLE_STORE = process.env.SHOPIFY_STORE || "";
const SINGLE_TOKEN = process.env.SHOPIFY_TOKEN || "";

// --- Tiny per-shop token store (JSON file; swap for a DB when you grow) ---
const STORE_FILE = path.join(__dirname, "shops.json");
function loadShops() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return {}; }
}
function saveShops(s) { fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2)); }
function shopToken(shop) {
  if (SINGLE_STORE && SINGLE_TOKEN && shop === SINGLE_STORE) return SINGLE_TOKEN;
  return loadShops()[shop] || null;
}

// --- Demo products (her real handmade line) ---
let demoProducts = [
  { id: "demo-1", sku: "PORT912", barcode: "850001001001", title: "9×12 Portfolio", price: 68.0, qty: 3 },
  { id: "demo-2", sku: "PORT68", barcode: "850001001002", title: "6×8 Portfolio", price: 50.0, qty: 2 },
  { id: "demo-3", sku: "BAG1214", barcode: "850001001003", title: "12×14 Zippered Book Bag", price: 65.0, qty: 4 },
  { id: "demo-4", sku: "BMK27", barcode: "850001001004", title: "2×7 Pocket Bookmark", price: 9.0, qty: 12 },
  { id: "demo-5", sku: "NP57", barcode: "850001001005", title: "5×7 Notepad", price: 9.0, qty: 8 },
  { id: "demo-6", sku: "NP35", barcode: "850001001006", title: "3×5 Notepad", price: 7.0, qty: 10 },
];

// ============ OAUTH (public app front door) ============
const pendingStates = new Map(); // state → shop (in-memory; fine for start)

// GET /auth?shop=xxx.myshopify.com → bounce to Shopify for permission
app.get("/auth", (req, res) => {
  const shop = (req.query.shop || "").trim().toLowerCase();
  if (!shop || !shop.endsWith(".myshopify.com"))
    return res.status(400).send("Please provide your store address like: /auth?shop=your-store.myshopify.com");
  if (!API_KEY || !APP_URL)
    return res.status(500).send("App not configured yet (missing API key or APP_URL).");
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, shop);
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);
  const redirectUri = `${APP_URL}/auth/callback`;
  const url = `https://${shop}/admin/oauth/authorize?client_id=${API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;
  res.redirect(url);
});

// GET /auth/callback → Shopify sends us back with a code; trade it for a token
app.get("/auth/callback", async (req, res) => {
  const { shop, code, state, hmac } = req.query;
  try {
    if (!pendingStates.has(state)) throw new Error("Expired or invalid install request — please try installing again.");
    pendingStates.delete(state);
    // Verify HMAC so we know this really came from Shopify
    const msg = Object.keys(req.query).filter(k => k !== "hmac" && k !== "signature")
      .sort().map(k => `${k}=${req.query[k]}`).join("&");
    const digest = crypto.createHmac("sha256", API_SECRET).update(msg).digest("hex");
    if (digest !== hmac) throw new Error("Security check failed.");
    // Exchange code for a permanent access token
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: API_KEY, client_secret: API_SECRET, code }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) throw new Error("Shopify didn't return an access token.");
    const shops = loadShops();
    shops[shop] = tokenJson.access_token;
    saveShops(shops);
    // Drop a cookie so the UI knows which shop this is, then open the app
    res.cookie("scanstock_shop", shop, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
    res.redirect("/?shop=" + encodeURIComponent(shop));
  } catch (e) {
    res.status(400).send("Install failed: " + e.message);
  }
});

// ============ API ============
function reqShop(req) {
  return (req.query.shop || req.cookies?.scanstock_shop || "").toLowerCase();
}
// (tiny cookie parser — no extra dependency)
app.use((req, res, next) => {
  req.cookies = {};
  (req.headers.cookie || "").split(";").forEach(c => {
    const [k, ...v] = c.trim().split("="); req.cookies[k] = decodeURIComponent(v.join("="));
  });
  next();
});

async function shopify(shop, path_, method = "GET", body = null) {
  const token = shopToken(shop);
  if (!token) throw new Error("Store not connected. Install the app first.");
  const res = await fetch(`https://${shop}/admin/api/2026-01${path_}`, {
    method,
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  return res.json();
}

function toVariant(p, v) {
  return {
    id: String(v.id), sku: v.sku || "", barcode: v.barcode || "",
    title: p.title + (v.title !== "Default Title" ? ` — ${v.title}` : ""),
    price: parseFloat(v.price || 0), qty: v.inventory_quantity ?? 0,
  };
}

app.get("/api/status", (req, res) => {
  const shop = reqShop(req);
  const mode = shop && shopToken(shop) ? "shopify" : (SINGLE_STORE && SINGLE_TOKEN ? "shopify-single" : "demo");
  res.json({ mode, shop: shop || null });
});

app.get("/api/products", async (req, res) => {
  const shop = reqShop(req);
  try {
    if (!shop || !shopToken(shop)) return res.json(demoProducts);
    const data = await shopify(shop, "/products.json?limit=250");
    const out = [];
    for (const p of data.products || []) for (const v of p.variants || []) out.push(toVariant(p, v));
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/lookup", async (req, res) => {
  const shop = reqShop(req);
  const code = (req.query.code || "").trim();
  if (!code) return res.status(400).json({ error: "Missing code" });
  try {
    if (!shop || !shopToken(shop)) {
      return res.json(demoProducts.find(p => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase()) || null);
    }
    const data = await shopify(shop, "/products.json?limit=250");
    for (const p of data.products || []) for (const v of p.variants || []) {
      if (v.barcode === code || (v.sku || "").toLowerCase() === code.toLowerCase())
        return res.json(toVariant(p, v));
    }
    res.json(null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/adjust", async (req, res) => {
  const shop = reqShop(req);
  const { id, qty } = req.body;
  if (id == null || qty == null) return res.status(400).json({ error: "Missing id/qty" });
  const q = Math.max(0, parseInt(qty, 10) || 0);
  try {
    if (!shop || !shopToken(shop)) {
      const p = demoProducts.find(x => x.id === String(id));
      if (!p) return res.status(404).json({ error: "Not found" });
      p.qty = q; return res.json(p);
    }
    const v = await shopify(shop, `/variants/${id}.json`);
    const locs = await shopify(shop, "/locations.json");
    await shopify(shop, "/inventory_levels/set.json", "POST", {
      location_id: locs.locations[0].id, inventory_item_id: v.variant.inventory_item_id, available: q,
    });
    res.json({ id: String(id), qty: q });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/price", async (req, res) => {
  const shop = reqShop(req);
  const { id, price } = req.body;
  if (id == null || price == null) return res.status(400).json({ error: "Missing id/price" });
  try {
    if (!shop || !shopToken(shop)) {
      const p = demoProducts.find(x => x.id === String(id));
      if (!p) return res.status(404).json({ error: "Not found" });
      p.price = Math.max(0, parseFloat(price) || 0); return res.json(p);
    }
    const updated = await shopify(shop, `/variants/${id}.json`, "PUT",
      { variant: { id: Number(id), price: String(price) } });
    res.json({ id: String(id), price: parseFloat(updated.variant.price) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Webhook: clean up when a shop uninstalls (required for App Store)
app.post("/webhooks/app/uninstalled", express.raw({ type: "application/json" }), (req, res) => {
  const hmac = req.headers["x-shopify-hmac-sha256"] || "";
  const digest = crypto.createHmac("sha256", API_SECRET).update(req.body).digest("base64");
  if (hmac && digest === hmac) {
    try {
      const shop = JSON.parse(req.body.toString()).myshopify_domain;
      const shops = loadShops(); delete shops[shop]; saveShops(shops);
    } catch {}
  }
  res.status(200).send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Luminous Scan on :${PORT}`));
