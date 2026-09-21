/* --- STATE & DATA --- */
const initialProducts = [
  {
    id: 1,
    name: 'MacBook Air M1 (8GB / 256GB Space Grey)',
    price: 48500,
    cat: 'Laptops',
    icon: '💻',
    condition: 'Like New',
    location: 'BH-4',
    verified: true,
    urgent: true,
    seller: { name: 'Aman Sharma', rating: 4.9, branch: 'B.Tech CSE' },
    desc: 'Battery health 91%. Comes with original MagSafe charger & sleeve.'
  },
  {
    id: 2,
    name: 'Semester 4 Mechanical Books + Handwritten Notes',
    price: 950,
    cat: 'Books',
    icon: '📚',
    condition: 'Good',
    location: 'BH-1',
    verified: true,
    urgent: false,
    seller: { name: 'Rohan Verma', rating: 4.8, branch: 'Mechanical' },
    desc: 'Includes SOM, Thermo, and Heat Transfer reference books.'
  },
  {
    id: 3,
    name: 'Montra Madrock 21-Speed Alloy Bicycle',
    price: 6200,
    cat: 'Bicycles',
    icon: '🚲',
    condition: 'Good',
    location: 'UniMall',
    verified: true,
    urgent: true,
    seller: { name: 'Kavita Singh', rating: 5.0, branch: 'B.Des' },
    desc: 'Front suspension, smooth Shimano shifters. Moving out of campus.'
  },
  {
    id: 4,
    name: 'Engineered Wood Study Desk + Book Rack',
    price: 1500,
    cat: 'Furniture',
    icon: '🪑',
    condition: 'Used',
    location: 'BH-7',
    verified: false,
    urgent: false,
    seller: { name: 'Vikram Patel', rating: 4.5, branch: 'Civil' },
    desc: 'Solid build, spacious desk drawer. Handover at BH-7 turnstile.'
  },
  {
    id: 5,
    name: 'Sony WH-1000XM4 Active Noise Cancelling',
    price: 13900,
    cat: 'Electronics',
    icon: '🎧',
    condition: 'Like New',
    location: 'Block34',
    verified: true,
    urgent: false,
    seller: { name: 'Ananya Roy', rating: 4.9, branch: 'MBA' },
    desc: 'Used only in library. Complete box and bill available.'
  },
  {
    id: 6,
    name: 'Casio fx-991EX Classwiz Scientific Calculator',
    price: 800,
    cat: 'Study Materials',
    icon: '🧮',
    condition: 'Like New',
    location: 'GH',
    verified: true,
    urgent: true,
    seller: { name: 'Priya Mehta', rating: 4.7, branch: 'ECE' },
    desc: 'Allowed in semester exams, clean condition with slide case.'
  }
];

const categories = [
  { name: 'All', icon: '✨' },
  { name: 'Laptops', icon: '💻' },
  { name: 'Books', icon: '📚' },
  { name: 'Bicycles', icon: '🚲' },
  { name: 'Electronics', icon: '🔌' },
  { name: 'Furniture', icon: '🪑' },
  { name: 'Study Materials', icon: '🧮' },
  { name: 'Hostel Gear', icon: '🛏️' }
];

let products = [...initialProducts];
let activeCat = 'All';
let wishlist = new Set(JSON.parse(localStorage.getItem('uniloop_saved') || '[]'));
let activeModalProduct = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

/* --- TOAST NOTIFICATIONS --- */
function showToast(text, icon = '✨') {
  const host = $('#toastHost');
  const toast = document.createElement('div');
  toast.className = 'aesthetic-toast';
  toast.innerHTML = `<span>${icon}</span><span>${text}</span>`;
  host.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/* --- THEME TOGGLE --- */
function initTheme() {
  const t = localStorage.getItem('uniloop_theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
  $('#themeToggle').textContent = t === 'dark' ? '☀️' : '🌙';
}
$('#themeToggle').onclick = () => {
  const current = document.documentElement.getAttribute('data-theme');
  const target = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', target);
  localStorage.setItem('uniloop_theme', target);
  $('#themeToggle').textContent = target === 'dark' ? '☀️' : '🌙';
  showToast(`Switched to ${target} mode`, '🌓');
};

/* --- RENDER CATEGORY PILLS --- */
function renderCategories() {
  const row = $('#catRow');
  row.innerHTML = categories.map(c => `
    <div class="cat-pill ${c.name === activeCat ? 'active' : ''}" onclick="selectCat('${c.name}')">
      <span>${c.icon}</span>
      <span>${c.name}</span>
    </div>
  `).join('');
}
window.selectCat = function(name) {
  activeCat = name;
  renderCategories();
  renderProducts();
};

/* --- RENDER PRODUCT GRID --- */
function renderProducts() {
  const q = ($('#heroSearch').value || '').toLowerCase();
  const campus = $('#campusSelect').value;
  const condition = $('#filterCondition').value;
  const special = $('#filterSpecial').value;
  const sort = $('#sortBy').value;

  let list = products.filter(p => {
    const matchQuery = p.name.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q);
    const matchCat = activeCat === 'All' || p.cat === activeCat;
    const matchCampus = campus === 'all' || p.location === campus;
    const matchCond = condition === 'all' || p.condition === condition;
    
    let matchSpecial = true;
    if (special === 'verified') matchSpecial = p.verified;
    if (special === 'urgent') matchSpecial = p.urgent;

    return matchQuery && matchCat && matchCampus && matchCond && matchSpecial;
  });

  if (sort === 'low') list.sort((a, b) => a.price - b.price);
  if (sort === 'high') list.sort((a, b) => b.price - a.price);
  if (sort === 'rating') list.sort((a, b) => b.seller.rating - a.seller.rating);

  const grid = $('#productGrid');
  if (list.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--ink-muted);">
        <p style="font-size: 40px; margin-bottom: 12px;">🔍</p>
        <b style="font-size: 16px; color: var(--ink);">No campus listings found</b>
        <p style="font-size: 13px; margin-top: 4px;">Try tweaking your search or location filter.</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(p => `
    <article class="product-card">
      <div class="card-img-wrap">
        ${p.img ? `<img src="${p.img}" alt="${p.name}"/>` : p.icon}
        ${p.verified ? '<span class="card-badge">✓ Student Verified</span>' : ''}
        ${p.urgent ? '<span class="urgent-badge">⚡ Urgent</span>' : ''}
        <button class="like-heart ${wishlist.has(p.id) ? 'active' : ''}" onclick="toggleWish(${p.id})">
          ${wishlist.has(p.id) ? '♥' : '♡'}
        </button>
      </div>

      <div class="card-details">
        <div class="price-row">
          <span class="item-price">₹${p.price.toLocaleString('en-IN')}</span>
          <span class="condition-tag">${p.condition}</span>
        </div>

        <h3 class="item-title">${p.name}</h3>

        <div class="seller-row">
          <span class="seller-glow-avatar">${p.seller.name[0]}</span>
          <span>${p.seller.name} · ⭐ ${p.seller.rating}</span>
        </div>

        <div class="item-location">
          <span>📍</span>
          <span>${p.location} (${p.seller.branch})</span>
        </div>

        <div class="card-cta-group">
          <button class="btn btn-outline" onclick="openOfferModal(${p.id})">⚡ Quick Offer</button>
          <button class="btn btn-gold" onclick="openChatModal(${p.id})">💬 Chat</button>
        </div>
      </div>
    </article>
  `).join('');
}

/* --- WISHLIST --- */
window.toggleWish = function(id) {
  if (wishlist.has(id)) {
    wishlist.delete(id);
    showToast('Removed from Saved', '♡');
  } else {
    wishlist.add(id);
    showToast('Saved to your Wishlist', '❤️');
  }
  localStorage.setItem('uniloop_saved', JSON.stringify([...wishlist]));
  $('#wishCount').textContent = wishlist.size;
  renderProducts();
};

/* --- QUICK SEARCH & TAGS --- */
window.quickSearch = function(tag) {
  $('#heroSearch').value = tag;
  renderProducts();
  location.hash = 'explore';
};
window.filterByTag = function(tag) {
  $('#filterSpecial').value = tag;
  renderProducts();
  location.hash = 'explore';
};

/* --- MODAL UTILS --- */
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modalOverlay').classList.add('active');
}
function closeModal() {
  $('#modalOverlay').classList.remove('active');
}
$('#modalClose').onclick = closeModal;
$('#modalOverlay').onclick = (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
};

/* --- MAKE OFFER MODAL --- */
window.openOfferModal = function(id) {
  const p = products.find(x => x.id === id);
  activeModalProduct = p;
  const o1 = Math.round(p.price * 0.9);
  const o2 = Math.round(p.price * 0.85);

  const html = `
    <h2 style="font-size:22px; font-weight:800; margin-bottom:6px;">Make a Fast Offer</h2>
    <p style="color:var(--ink-muted); font-size:13px; margin-bottom:16px;">
      Listing: <b>${p.name}</b> (Listed: ₹${p.price.toLocaleString('en-IN')})
    </p>

    <div style="display:flex; gap:8px; margin-bottom:16px;">
      <button class="btn btn-outline" style="flex:1" onclick="$('#customOffer').value = ${o1}">-10% (₹${o1})</button>
      <button class="btn btn-outline" style="flex:1" onclick="$('#customOffer').value = ${o2}">-15% (₹${o2})</button>
    </div>

    <label style="font-size:12px; font-weight:700; color:var(--ink-muted)">Your Counter Offer (₹)</label>
    <input type="number" id="customOffer" value="${o1}" style="width:100%; padding:12px; border-radius:12px; border:1px solid var(--border); font-size:18px; font-weight:800; margin:6px 0 16px; background:var(--surface); color:var(--ink);">

    <button class="btn btn-gold" style="width:100%; padding:14px; justify-content:center;" onclick="sendOffer()">Send Offer to Seller</button>
  `;
  openModal(html);
};

window.sendOffer = function() {
  const val = $('#customOffer').value;
  closeModal();
  showToast(`Offer of ₹${Number(val).toLocaleString('en-IN')} sent to ${activeModalProduct.seller.name}!`, '🎉');
};

/* --- LIVE CHAT SIMULATOR --- */
window.openChatModal = function(id) {
  const p = products.find(x => x.id === id);
  activeModalProduct = p;

  const html = `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
      <span class="seller-glow-avatar" style="width:36px; height:36px; font-size:16px;">${p.seller.name[0]}</span>
      <div>
        <b style="font-size:14px; display:block;">${p.seller.name}</b>
        <span style="font-size:11px; color:var(--accent-green);">● Active in ${p.location}</span>
      </div>
    </div>

    <div class="aesthetic-chat">
      <div class="chat-stream" id="chatStream">
        <div class="bubble seller">Hey! Yes, <b>${p.name}</b> is available for handover near ${p.location}.</div>
      </div>
      <div style="display:flex; gap:6px; padding:8px 12px; background:var(--surface); border-top:1px solid var(--border); overflow-x:auto;">
        <span class="tag-chip" onclick="pushChat('Can we meet at Uni-Mall today?')">📍 Uni-Mall meetup</span>
        <span class="tag-chip" onclick="pushChat('Is the price negotiable?')">💬 Negotiable?</span>
      </div>
      <div style="display:flex; padding:8px; gap:8px; background:var(--surface); border-top:1px solid var(--border);">
        <input id="chatBoxInput" placeholder="Type a message to peer..." style="flex:1; border:none; background:transparent; outline:none; font-family:inherit; font-size:13px; color:var(--ink);">
        <button class="btn btn-gold" style="padding:6px 14px;" onclick="sendCustomChat()">Send</button>
      </div>
    </div>
  `;
  openModal(html);
};

window.pushChat = function(txt) {
  appendBubble(txt, 'me');
  setTimeout(() => {
    appendBubble('Sounds great! Let me know what time works best for you.', 'seller');
  }, 900);
};

window.sendCustomChat = function() {
  const input = $('#chatBoxInput');
  const txt = input.value.trim();
  if (!txt) return;
  appendBubble(txt, 'me');
  input.value = '';
  setTimeout(() => {
    appendBubble('Got your message. I am at the campus center right now.', 'seller');
  }, 1000);
};

function appendBubble(txt, type) {
  const stream = $('#chatStream');
  if (!stream) return;
  const b = document.createElement('div');
  b.className = `bubble ${type}`;
  b.textContent = txt;
  stream.appendChild(b);
  stream.scrollTop = stream.scrollHeight;
}

/* --- POST LISTING MODAL --- */
function openSellModal() {
  const html = `
    <h2 style="font-size:22px; font-weight:800; margin-bottom:6px;">Sell on Campus</h2>
    <p style="color:var(--ink-muted); font-size:13px; margin-bottom:16px;">Direct student visibility with zero platform commission.</p>

    <label style="font-size:12px; font-weight:700; color:var(--ink-muted)">Item Title</label>
    <input id="newTitle" placeholder="e.g. Sony Headphones or Mechanical Drafter" style="width:100%; padding:10px; border-radius:10px; border:1px solid var(--border); margin:4px 0 12px; background:var(--surface); color:var(--ink);">

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <div>
        <label style="font-size:12px; font-weight:700; color:var(--ink-muted)">Category</label>
        <select id="newCat" style="width:100%; padding:10px; border-radius:10px; border:1px solid var(--border); margin:4px 0 12px; background:var(--surface); color:var(--ink);">
          ${categories.filter(c => c.name !== 'All').map(c => `<option>${c.name}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="font-size:12px; font-weight:700; color:var(--ink-muted)">Price (₹)</label>
        <input type="number" id="newPrice" placeholder="e.g. 1200" style="width:100%; padding:10px; border-radius:10px; border:1px solid var(--border); margin:4px 0 12px; background:var(--surface); color:var(--ink);">
      </div>
    </div>

    <label style="font-size:12px; font-weight:700; color:var(--ink-muted)">Upload Image (Optional)</label>
    <input type="file" id="newImg" accept="image/*" style="width:100%; padding:8px; border-radius:10px; border:1px solid var(--border); margin:4px 0 16px; background:var(--surface); color:var(--ink);">

    <button class="btn btn-gold" style="width:100%; padding:14px; justify-content:center;" onclick="publishItem()">Publish Listing Instantly</button>
  `;
  openModal(html);
}

window.publishItem = function() {
  const title = $('#newTitle').value.trim();
  const cat = $('#newCat').value;
  const price = +$('#newPrice').value;
  const fileInput = $('#newImg');

  if (!title || !price) {
    alert('Please enter a title and valid price');
    return;
  }

  const create = (imgData = null) => {
    products.unshift({
      id: Date.now(),
      name: title,
      price: price,
      cat: cat,
      icon: '📦',
      img: imgData,
      condition: 'Like New',
      location: 'BH-1',
      verified: true,
      urgent: false,
      seller: { name: 'You (Student)', rating: 5.0, branch: 'Campus Verified' },
      desc: 'Just listed on UNI LOOP'
    });
    closeModal();
    renderProducts();
    showToast('Your item is live across campus! 🚀', '⚡');
  };

  if (fileInput.files && fileInput.files[0]) {
    const r = new FileReader();
    r.onload = (e) => create(e.target.result);
    r.readAsDataURL(fileInput.files[0]);
  } else {
    create();
  }
};

/* --- EVENT HOOKS --- */
$('#sellTopBtn').onclick = openSellModal;
$('#dockSell').onclick = openSellModal;
$('#heroSearchBtn').onclick = renderProducts;

['heroSearch', 'filterCondition', 'filterSpecial', 'sortBy', 'campusSelect'].forEach(id => {
  $('#' + id).addEventListener('input', renderProducts);
});

$('#resetBtn').onclick = () => {
  $('#heroSearch').value = '';
  $('#filterCondition').value = 'all';
  $('#filterSpecial').value = 'all';
  $('#sortBy').value = 'new';
  $('#campusSelect').value = 'all';
  activeCat = 'All';
  renderCategories();
  renderProducts();
  showToast('Filters reset', '✨');
};

$('#wishlistBtn').onclick = () => {
  if (wishlist.size === 0) {
    showToast('Wishlist is empty ♡', '🔍');
    return;
  }
  products = initialProducts.filter(p => wishlist.has(p.id));
  renderProducts();
  showToast(`Showing ${wishlist.size} saved items`, '❤️');
};
$('#dockSaved').onclick = () => $('#wishlistBtn').click();

/* --- INIT --- */
initTheme();
$('#wishCount').textContent = wishlist.size;
renderCategories();
renderProducts();
