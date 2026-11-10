/* FIX AVRECEIVER Parts Store — Cloudflare Worker + D1 edition
   Public catalogue and orders use the separate Cloudflare D1 store database.
   Admin access uses the ADMIN_TOKEN secret configured on the store Worker.
*/
const STORE_CONFIG = {
  API_BASE: "https://fix-avreceiver-store-api.balamsc-vit.workers.dev",
  CURRENCY: "INR"
};

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const money = n => new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR" }).format(Number(n || 0));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let products = [], settings = { business_name:"FIX AVRECEIVER", currency:"INR", payment_method:"UPI", whatsapp_number:"", upi_id:"" };
let cart = [];
try { cart = JSON.parse(localStorage.getItem("fixav_parts_cart") || "[]"); if (!Array.isArray(cart)) cart = []; } catch { cart = []; }
let adminToken = "";
let toastTimer;

function toast(message) {
  const el = $("#toast"); if (!el) return;
  el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}
function saveCart() { localStorage.setItem("fixav_parts_cart", JSON.stringify(cart)); renderCart(); }
function cartTotalPaise() { return cart.reduce((sum, line) => sum + Number(line.price_paise) * line.qty, 0); }
function productById(id) { return products.find(p => String(p.id) === String(id)); }
function imageMarkup(url) { return url ? `<img src="${esc(url)}" alt="Product image" loading="lazy" onerror="this.parentElement.innerHTML='&lt;div class=&quot;image-placeholder&quot;&gt;▦&lt;/div&gt;'">` : `<div class="image-placeholder">▦</div>`; }

async function api(path, options={}) {
  const headers = { "Content-Type":"application/json", ...(options.headers || {}) };
  if (options.admin) {
    if (!adminToken) throw new Error("Please sign in as store admin.");
    headers.Authorization = `Bearer ${adminToken}`;
  }
  const response = await fetch(`${STORE_CONFIG.API_BASE}${path}`, { ...options, headers });
  let data;
  try { data = await response.json(); } catch { throw new Error(`API returned an invalid response (${response.status}).`); }
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

async function init() {
  $("#year").textContent = new Date().getFullYear();
  bindCommon(); renderCart();
  try {
    const health = await api("/api/health");
    if (!health.database) throw new Error("Store database is not responding.");
    await loadSettings(); await loadProducts();
  } catch (error) {
    $("#catalog-status").hidden = false;
    $("#catalog-status").textContent = `Store is temporarily unavailable: ${error.message}`;
    console.error(error);
  }
}

function bindCommon() {
  $("#cart-open").onclick = openCart; $("#cart-close").onclick = closeCart;
  $("#cart-overlay").onclick = closeCart;
  $("#checkout-open").onclick = () => {
    if (!cart.length) return toast("Your cart is empty.");
    closeCart(); $("#checkout-total").textContent = money(cartTotalPaise()/100); openModal("checkout-modal");
  };
  $("#checkout-form").addEventListener("submit", sendOrder);
  $("#search").addEventListener("input", renderProducts);
  $("#category-filter").addEventListener("change", renderProducts);
  $("#admin-open").onclick = () => openModal("admin-modal");
  $$('[data-close]').forEach(b => b.onclick = () => closeModal(b.dataset.close));
  $("#admin-login-form").addEventListener("submit", adminLogin);
  $("#admin-logout").onclick = adminLogout;
  $("#new-product").onclick = () => showProductForm();
  $("#cancel-product").onclick = () => { $("#product-form").hidden = true; };
  $("#product-form").addEventListener("submit", saveProduct);
  $("#settings-form").addEventListener("submit", saveSettings);
  $$(".tab").forEach(b => b.onclick = () => switchTab(b.dataset.tab, b));
  $("#refresh-orders").onclick = loadAdminOrders;
}
function openModal(id) { $("#"+id).classList.add("show"); }
function closeModal(id) { $("#"+id).classList.remove("show"); }
function openCart() { $("#cart-drawer").classList.add("open"); $("#cart-overlay").classList.add("show"); $("#cart-drawer").setAttribute("aria-hidden","false"); }
function closeCart() { $("#cart-drawer").classList.remove("open"); $("#cart-overlay").classList.remove("show"); $("#cart-drawer").setAttribute("aria-hidden","true"); }

async function loadSettings() {
  const data = await api("/api/store-settings");
  settings = { ...settings, ...(data.settings || {}) };
  const contactButton = $("#contact-whatsapp");
  if (contactButton && settings.whatsapp_number) {
    const digits = String(settings.whatsapp_number).replace(/\\D/g, "");
    if (digits) {
      contactButton.href = `https://wa.me/${digits}?text=${encodeURIComponent("Hello FIX AVRECEIVER, I would like to enquire about your repair services.")}`;
      contactButton.target = "_blank";
      contactButton.rel = "noopener";
    }
  }
}
async function loadProducts() {
  $("#catalog-status").hidden = false; $("#catalog-status").textContent = "Loading parts catalogue…";
  const data = await api("/api/products"); products = data.products || [];
  const categories = [...new Set(products.map(p => p.category_name).filter(Boolean))].sort();
  $("#category-filter").innerHTML = '<option value="">All categories</option>' + categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  $("#catalog-status").hidden = products.length > 0;
  if (!products.length) $("#catalog-status").textContent = "No parts listed yet. Please check back soon.";
  renderProducts();
}
function renderProducts() {
  const q = $("#search").value.trim().toLowerCase(), cat = $("#category-filter").value;
  const list = products.filter(p => (!cat || p.category_name === cat) && (!q || [p.name,p.sku,p.category_name,p.description].join(" ").toLowerCase().includes(q)));
  $("#product-grid").innerHTML = list.map(p => `<article class="product-card">
    <div class="product-image">${imageMarkup(p.image_url)}</div>
    <div class="product-info"><span class="product-category">${esc(p.category_name || "Parts")}</span><h3>${esc(p.name)}</h3>
    <span class="sku">${p.sku ? `Part No: ${esc(p.sku)}` : ""}</span><p class="description">${esc(p.description || "")}</p>
    <div class="product-bottom"><span class="price">${money(Number(p.price_paise)/100)}</span><button class="btn btn-primary add-btn" data-add="${esc(p.id)}" ${Number(p.stock_quantity)<=0?"disabled":""}>${Number(p.stock_quantity)<=0?"Out of stock":"Add +"}</button></div>
    <span class="stock ${Number(p.stock_quantity)<=0?"out":""}">${Number(p.stock_quantity)>0?`${Number(p.stock_quantity)} available`:"Currently unavailable"}</span></div></article>`).join("");
  $$("#product-grid [data-add]").forEach(b => b.onclick = () => addToCart(b.dataset.add));
}
function addToCart(id) {
  const p = productById(id); if (!p || Number(p.stock_quantity)<=0) return;
  const line = cart.find(x => String(x.id)===String(id));
  if (line) { if (line.qty >= Number(p.stock_quantity)) return toast("Maximum available stock reached."); line.qty++; }
  else cart.push({ id:p.id, name:p.name, sku:p.sku, price_paise:Number(p.price_paise), qty:1 });
  saveCart(); toast("Added to cart.");
}
function renderCart() {
  $("#cart-count").textContent = cart.reduce((n,x)=>n+x.qty,0);
  $("#cart-subtotal").textContent = money(cartTotalPaise()/100);
  $("#cart-lines").innerHTML = cart.length ? cart.map(x => `<div class="cart-line"><div><strong>${esc(x.name)}</strong><small>${x.sku?`Part No: ${esc(x.sku)} · `:""}${money(x.price_paise/100)} each</small><div class="qty-controls"><button data-minus="${esc(x.id)}">−</button><b>${x.qty}</b><button data-plus="${esc(x.id)}">+</button><button class="remove-line" data-remove="${esc(x.id)}">Remove</button></div></div><strong>${money(x.price_paise*x.qty/100)}</strong></div>`).join("") : '<p class="muted">Your cart is empty.</p>';
  $$('[data-minus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.minus,-1));
  $$('[data-plus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.plus,1));
  $$('[data-remove]').forEach(b=>b.onclick=()=>{cart=cart.filter(x=>String(x.id)!==b.dataset.remove);saveCart();});
}
function changeQty(id,delta) {
  const line=cart.find(x=>String(x.id)===String(id)); if(!line)return;
  const p=productById(id); line.qty+=delta;
  if(line.qty<1)cart=cart.filter(x=>String(x.id)!==String(id));
  else if(p&&line.qty>Number(p.stock_quantity))line.qty=Number(p.stock_quantity);
  saveCart();
}

async function sendOrder(e) {
  e.preventDefault();
  if (!settings.whatsapp_number) return toast("Store WhatsApp number is not configured. Please contact the store.");
  if (!cart.length) return toast("Your cart is empty.");
  const form = e.currentTarget, submit = form.querySelector('[type="submit"]');
  const v = Object.fromEntries(new FormData(form).entries());
  const waWindow = window.open("about:blank", "_blank");
  submit.disabled = true; submit.textContent = "Submitting order…";
  try {
    const result = await api("/api/orders", { method:"POST", body:JSON.stringify({
      customer_name:v.name, mobile:v.phone, address:v.address, city:v.city, state:v.state || "Tamil Nadu", pincode:v.pincode, email:"",
      items:cart.map(x=>({ product_id:Number(x.id), quantity:Number(x.qty) }))
    }) });
    const message = [
      `Hello FIX AVRECEIVER, I have placed parts order ${result.order_number}.`,
      `Order total: ${money(result.total_paise/100)}`,
      `UPI ID (payment only after your confirmation): ${result.upi_id || "Please share UPI details"}`,
      "Please confirm stock availability and courier charges before I make payment.",
      "", `Name: ${v.name}`, `Mobile: ${v.phone}`, `Address: ${v.address}, ${v.city}, ${v.state || "Tamil Nadu"} - ${v.pincode}`,
      v.notes ? `Notes: ${v.notes}` : ""
    ].filter(Boolean).join("\n");
    const waUrl = result.whatsapp_url || `https://wa.me/${settings.whatsapp_number.replace(/\D/g,"")}?text=${encodeURIComponent(message)}`;
    cart=[]; saveCart(); form.reset(); closeModal("checkout-modal");
    toast(`Order ${result.order_number} saved. Opening WhatsApp…`);
    if (waWindow) { waWindow.opener = null; waWindow.location.href = waUrl; }
    else window.location.href = waUrl;
  } catch (error) {
    if (waWindow) waWindow.close();
    toast(error.message || "Could not submit your order. Please try again.");
  } finally { submit.disabled=false; submit.innerHTML='Send order via WhatsApp <span>↗</span>'; }
}

async function adminLogin(e) {
  e.preventDefault();
  const token = new FormData(e.currentTarget).get("token").trim();
  if (!token) return;
  adminToken = token; $("#login-message").textContent = "Checking admin access…";
  try {
    await api("/api/admin/check", { admin:true });
    $("#admin-login").hidden=true; $("#admin-dashboard").hidden=false;
    $("#admin-user").textContent="Store administrator session active";
    await loadAdminProducts(); await populateSettingsForm(); await loadAdminOrders();
  } catch (error) { adminToken=""; $("#login-message").textContent=error.message; }
}
function adminLogout() { adminToken=""; $("#admin-login").hidden=false; $("#admin-dashboard").hidden=true; $("#admin-login-form").reset(); $("#login-message").textContent="Signed out."; }
function switchTab(id,button) {
  $$(".tab").forEach(x=>x.classList.toggle("active",x===button));
  $("#products-admin").hidden=id!=="products-admin";
  $("#store-settings").hidden=id!=="store-settings";
  $("#orders-admin").hidden=id!=="orders-admin";
  if(id==="orders-admin")loadAdminOrders();
}
async function loadAdminProducts() {
  const data=await api("/api/admin/products",{admin:true}); const rows=data.products||[];
  $("#admin-product-list").innerHTML=rows.map(p=>`<div class="admin-product-row">${p.image_url?`<img src="${esc(p.image_url)}" alt="">`:'<div class="image-placeholder">▦</div>'}<div><strong>${esc(p.name)}</strong><small>${esc(p.sku||"No SKU")} · ${money(Number(p.price_paise)/100)} · Stock ${p.stock_quantity} · ${p.active?"Visible":"Hidden"}</small></div><div><button class="btn btn-outline btn-small" data-edit="${p.id}">Edit</button><button class="btn btn-outline btn-small" data-hide="${p.id}">${p.active?"Hide":"Show"}</button></div></div>`).join("")||'<p class="muted">No products yet. Add your first part.</p>';
  $$('[data-edit]').forEach(b=>b.onclick=()=>showProductForm(rows.find(x=>String(x.id)===b.dataset.edit)));
  $$('[data-hide]').forEach(b=>b.onclick=()=>toggleProduct(b.dataset.hide,rows));
}
function showProductForm(p=null) {
  const form=$("#product-form");form.hidden=false;form.reset();
  $("#product-form-title").textContent=p?"Edit product":"Add product";
  form.elements.id.value=p?.id||"";form.elements.name.value=p?.name||"";form.elements.sku.value=p?.sku||"";
  form.elements.category.value=p?.category_name||"";form.elements.price.value=p?(Number(p.price_paise)/100).toFixed(2):"";
  form.elements.stock.value=p?.stock_quantity??0;form.elements.description.value=p?.description||"";
  form.elements.image_url.value=p?.image_url||"";form.elements.featured.checked=!!p?.featured;form.elements.active.checked=p?.active??true;
  $("#product-message").textContent="";
}
async function saveProduct(e) {
  e.preventDefault();const form=e.currentTarget,f=new FormData(form),id=f.get("id");
  const submit=form.querySelector('[type="submit"]');submit.disabled=true;$("#product-message").textContent="Saving…";
  try {
    const body={name:f.get("name").trim(),sku:f.get("sku").trim(),category_name:f.get("category").trim(),price_paise:Math.round(Number(f.get("price"))*100),stock_quantity:Number(f.get("stock")),description:f.get("description").trim(),image_url:f.get("image_url").trim(),featured:form.elements.featured.checked,active:form.elements.active.checked};
    await api(id?`/api/admin/products/${id}`:"/api/admin/products",{method:id?"PUT":"POST",admin:true,body:JSON.stringify(body)});
    form.hidden=true;await loadProducts();await loadAdminProducts();toast("Product saved.");
  } catch(error) { $("#product-message").textContent=error.message; }
  finally { submit.disabled=false; }
}
async function toggleProduct(id,rows) {
  const p=rows.find(x=>String(x.id)===String(id));if(!p)return;
  try { await api(`/api/admin/products/${id}`,{method:"PUT",admin:true,body:JSON.stringify({active:!p.active})});await loadProducts();await loadAdminProducts();toast(p.active?"Product hidden.":"Product visible."); }
  catch(error){toast(error.message);}
}
async function populateSettingsForm() {
  const data=await api("/api/store-settings");settings={...settings,...(data.settings||{})};
  const f=$("#settings-form");f.elements.whatsapp_number.value=settings.whatsapp_number||"";f.elements.upi_id.value=settings.upi_id||"";f.elements.business_name.value=settings.business_name||"FIX AVRECEIVER";
}
async function saveSettings(e) {
  e.preventDefault();const f=new FormData(e.currentTarget);
  const body={business_name:f.get("business_name").trim(),currency:"INR",payment_method:"UPI",whatsapp_number:f.get("whatsapp_number").replace(/\D/g,""),upi_id:f.get("upi_id").trim()};
  try { await api("/api/admin/settings",{method:"PUT",admin:true,body:JSON.stringify(body)});settings={...settings,...body};$("#settings-message").textContent="Store settings saved."; }
  catch(error){$("#settings-message").textContent=error.message;}
}
async function loadAdminOrders() {
  if(!adminToken)return;
  try {
    const data=await api("/api/admin/orders",{admin:true});const rows=data.orders||[];
    $("#admin-order-list").innerHTML=rows.map(o=>`<article class="admin-order-card"><div><strong>${esc(o.order_number)}</strong><small>${esc(o.customer_name)} · ${esc(o.mobile)} · ${esc(o.city||"")}</small><small>${esc(o.created_at||"")} · ${Number(o.item_count)||0} item(s)</small></div><div><strong>${money(Number(o.total_paise)/100)}</strong><small>Payment: ${esc(o.payment_status)} · Order: ${esc(o.order_status)}</small><select data-order-status="${o.id}" aria-label="Order status"><option value="pending" ${o.order_status==="pending"?"selected":""}>Pending</option><option value="confirmed" ${o.order_status==="confirmed"?"selected":""}>Confirmed</option><option value="packed" ${o.order_status==="packed"?"selected":""}>Packed</option><option value="shipped" ${o.order_status==="shipped"?"selected":""}>Shipped</option><option value="completed" ${o.order_status==="completed"?"selected":""}>Completed</option><option value="cancelled" ${o.order_status==="cancelled"?"selected":""}>Cancelled</option></select><button class="btn btn-outline btn-small" data-order-save="${o.id}">Update</button></div></article>`).join("")||'<p class="muted">No customer orders yet.</p>';
    $$('[data-order-save]').forEach(b=>b.onclick=async()=>{const id=b.dataset.orderSave,status=$(`[data-order-status="${id}"]`).value;try{await api(`/api/admin/orders/${id}`,{method:"PUT",admin:true,body:JSON.stringify({order_status:status})});toast("Order status updated.");await loadAdminOrders();}catch(error){toast(error.message);}});
  } catch(error) { $("#admin-order-list").textContent=error.message; }
}

init();
