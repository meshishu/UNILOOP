/* --- STATE & MOCK DATA --- */
const initialProducts = [
  {
    id: 1,
    name: 'MacBook Air M1 (8GB / 256GB)',
    price: 49000,
    cat: 'Laptops',
    icon: '💻',
    condition: 'Like New',
    location: 'BH-4',
    verified: true,
    urgent: true,
    seller: { name: 'Aman Sharma', rating: 4.9, branch: 'B.Tech CSE - 3rd Yr' },
    desc: 'Battery health 91%. Comes with original MagSafe charger and protective case.'
  },
  {
    id: 2,
    name: 'Semester 4 Mech Engg Books Bundle',
    price: 1100,
    cat: 'Books',
    icon: '📚',
    condition: 'Good',
    location: 'BH-1',
    verified: true,
    urgent: false,
    seller: { name: 'Rohan Verma', rating: 4.8, branch: 'Mechanical - 4th Yr' },
    desc: 'Includes SOM, Thermodynamics and Heat Transfer reference books with handwritten notes.'
  },
  {
    id: 3,
    name: 'Hero Sprint Pro 21-Speed Gear Cycle',
    price: 5800,
    cat: 'Bicycles',
    icon: '🚲',
    condition: 'Good',
    location: 'UniMall',
    verified: true,
    urgent: true,
    seller: { name: 'Kavita Singh', rating: 5.0, branch: 'B.Des - 2nd Yr' },
    desc: 'Brand new tires fitted last month. Moving out of campus, urgent handover.'
  },
  {
    id: 4,
    name: 'Wooden Hostel Study Table + Shelf',
    price: 1600,
    cat: 'Furniture',
    icon: '🪑',
    condition: 'Used',
    location: 'BH-7',
    verified: false,
    urgent: false,
    seller: { name: 'Vikram Patel', rating: 4.5, branch: 'Civil Engg - 3rd Yr' },
    desc: 'Solid engineered wood, spacious legroom and drawer. Pickup from BH-7 3rd floor.'
  },
  {
    id: 5,
    name: 'Sony WH-1000XM4 Noise Cancelling Headphones',
    price: 14500,
    cat: 'Electronics',
    icon: '🎧',
    condition: 'Like New',
    location: 'Block34',
    verified: true,
    urgent: false,
    seller: { name: 'Ananya Roy', rating: 4.9, branch: 'MBA - 1st Yr' },
    desc: 'Barely used for 3 months with bill and original carry case.'
  },
  {
    id: 6,
    name: 'Casio fx-991EX Scientific Calculator',
    price: 850,
    cat: 'Study Materials',
    icon: '🧮',
    condition: 'Brand New',
    location: 'GH',
    verified: true,
    urgent: true,
    seller: { name: 'Priya Mehta', rating: 4.7, branch: 'ECE - 2nd Yr' },
    desc: 'Classwiz high-res display, allowed in all university semester exams.'
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
  { name: 'Hostel Gear', icon: '🛏️' },
  { name: 'Gaming', icon: '🎮' }
];

let products = [...initialProducts];
let activeCategory = 'All';
let wishlist = new Set(JSON.parse(localStorage.getItem('uniloop_saved') || '[]'));
let activeProductForModal = null;

/* --- DOM SELECTORS --- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

/* --- TOAST SYSTEM --- */
function showToast(msg) {
  const container = $('#toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

/* --- THEME TOGGLER --- */
function initTheme() {
  const saved = localStorage.getItem('uniloop_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  $('#themeToggle').textContent = saved === 'dark' ? '☀️' : '🌙';
}
$('#themeToggle').onclick = () => {
  const current = document.documentElement.getAttribute('data-theme');
  const target = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', target);
  localStorage.setItem('uniloop_theme', target);
  $('#themeToggle').textContent = target === 'dark' ? '☀️' : '🌙';
  showToast(`Switched to ${target} mode`);
};

/* --- CATEGORY RENDER --- */
function renderCategories() {
  const container = $('#catScroll');
  container.innerHTML = categories.map(c => `
    <div class="cat-item ${c.name === activeCategory ? 'active' : ''}" data-cat="${c.name}">
      <span>${c.icon}</span>
      <span>${c.name}</span>
    </div>
  `).join('');

  $$('.cat-item').forEach(el => {
    el.onclick = () => {
      activeCategory = el.dataset.cat;
      renderCategories();
      renderProducts();
    };
  });
}

/* --- PRODUCT GRID RENDER --- */
function renderProducts() {
  const q = ($('#mainSearch').value || $('#heroSearch').value || '').toLowerCase();
  const campus = $('#campusSelect').value;
  const condition = $('#filterCondition').value;
  const verifyFilter = $('#filterVerified').value;
  const sort = $('#sortBy').value;

  let filtered = products.filter(p => {
    const matchesQuery = p.name.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q);
    const matchesCat = activeCategory === 'All' || p.cat === activeCategory;
    const matchesCampus = campus === 'all' || p.location === campus;
    const matchesCondition = condition === 'all' || p.condition === condition;
    
    let matchesSpecial = true;
    if (verifyFilter === 'verified') matchesSpecial = p.verified;
    if (verifyFilter === 'urgent') matchesSpecial = p.urgent;

    return matchesQuery && matchesCat && matchesCampus && matchesCondition && matchesSpecial;
  });

  // Sorting
  if (sort === 'low') filtered.sort((a, b) => a.price - b.price);
  if (sort === 'high') filtered.sort((a, b) => b.price - a.price);
  if (sort === 'rating') filtered.sort((a, b) => b.seller.rating - a.seller.rating);

  const grid = $('#productGrid');
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 50px 20px; color: var(--muted);">
        <p style="font-size: 36px; margin-bottom: 8px;">🔍</p>
        <b>No campus listings match your current filters.</b>
        <p style="font-size: 13px; margin-top: 4px;">Try switching your hostel/campus filter or search query.</p>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => `
    <article class="product-card">
      <div class="card-media">
        ${p.img ? `<img src="${p.img}" alt="${p.name}"/>` : p.icon}
        ${p.verified ? '<span class="badge-tag">✓ Student Verified</span>' : ''}
        ${p.urgent ? '<span class="urgent-tag">⚡ Urgent</span>' : ''}
        <button class="fav-btn ${wishlist.has(p.id) ? 'active' : ''}" data-fav="${p.id}">
          ${wishlist.has(p.id) ? '♥' : '♡'}
        </button>
      </div>

      <div class="card-body">
        <div class="card-price-row">
          <span class="price-value">₹${p.price.toLocaleString('en-IN')}</span>
          <span class="condition-pill">${p.condition}</span>
        </div>

        <div class="card-title">${p.name}</div>
        
        <div class="card-seller">
          <span class="seller-avatar">${p.seller.name[0]}</span>
          <span>${p.seller.name} · ⭐ ${p.seller.rating}</span>
        </div>

        <div class="card-location">
          <span>📍</span>
          <span>${p.location} (${p.seller.branch})</span>
        </div>

        <div class="card-actions">
          <button class="btn btn-outline" onclick="openOfferModal(${p.id})">Make Offer</button>
          <button class="btn btn-gold" onclick="openChatModal(${p.id})">Chat</button>
        </div>
      </div>
    </article>
  `).join('');

  // Wishlist clicks
  $$('.fav-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = +btn.dataset.fav;
      if (wishlist.has(id)) {
        wishlist.delete(id);
        showToast('Removed from Saved Items');
      } else {
        wishlist.add(id);
        showToast('Added to Saved Items ❤️');
      }
      localStorage.setItem('uniloop_saved', JSON.stringify([...wishlist]));
      $('#wishCount').textContent = wishlist.size;
      renderProducts();
    };
  });
}

/* --- MODAL CONTROLLER --- */
function openModal(contentHtml) {
  $('#modalBody').innerHTML = contentHtml;
  $('#mainModal').classList.add('active');
}
function closeModal() {
  $('#mainModal').classList.remove('active');
}
$('#modalClose').onclick = closeModal;
$('#mainModal').onclick = (e) => {
  if (e.target.id === 'mainModal') closeModal();
};

/* --- MAKE OFFER MODAL --- */
window.openOfferModal = function(id) {
  const p = products.find(x => x.id === id);
  activeProductForModal = p;

  const o1 = Math.round(p.price * 0.9);
  const o2 = Math.round(p.price * 0.85);

  const html = `
    <h2 style="font-size:22px; margin-bottom: 6px;">Make an Offer</h2>
    <p style="color:var(--muted); font-size:13px; margin-bottom: 16px;">
      Listing: <b>${p.name}</b> (Listed: ₹${p.price.toLocaleString('en-IN')})
    </p>

    <div class="offer-chips">
      <div class="offer-chip" onclick="setOfferValue(${o1}, this)">-10% (₹${o1})</div>
      <div class="offer-chip" onclick="setOfferValue(${o2}, this)">-15% (₹${o2})</div>
      <div class="offer-chip" onclick="setOfferValue(${p.price}, this)">Full Price</div>
    </div>

    <label style="font-size:12px; font-weight:700; color:var(--muted)">Your Custom Offer (₹)</label>
    <input type="number" id="offerInput" value="${o1}" style="width:100%; padding:12px; border:1px solid var(--line); border-radius:10px; font-size:18px; font-weight:800; margin: 8px 0 16px; background:var(--surface); color:var(--ink);">

    <button class="btn btn-gold" style="width:100%; padding:14px; font-size:15px;" onclick="submitOffer()">Send Official Offer</button>
  `;
  openModal(html);
};

window.setOfferValue = function(val, el) {
  $('#offerInput').value = val;
  $$('.offer-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
};

window.submitOffer = function() {
  const val = $('#offerInput').value;
  closeModal();
  showToast(`Offer of ₹${Number(val).toLocaleString('en-IN')} sent to ${activeProductForModal.seller.name}! 🎉`);
};

/* --- CHAT MODAL --- */
window.openChatModal = function(id) {
  const p = products.find(x => x.id === id);
  activeProductForModal = p;

  const html = `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
      <span class="seller-avatar" style="width:36px; height:36px; font-size:16px;">${p.seller.name[0]}</span>
      <div>
        <b style="display:block; font-size:14px;">${p.seller.name}</b>
        <span style="font-size:11px; color:var(--green)">● Active in ${p.location}</span>
      </div>
    </div>

    <div class="chat-container">
      <div class="chat-messages" id="chatMsgs">
        <div class="chat-bubble seller">
          Hi! Yes, <b>${p.name}</b> is still available for handover around ${p.location}.
        </div>
      </div>
      <div class="quick-replies">
        <span class="quick-chip" onclick="sendQuickChat('Can we meet at Uni-Mall?')">📍 Meet at Uni-Mall</span>
        <span class="quick-chip" onclick="sendQuickChat('Is the price negotiable?')">💬 Negotiable?</span>
        <span class="quick-chip" onclick="sendQuickChat('Can I test it before paying?')">🔍 Test first</span>
      </div>
      <div class="chat-input-bar">
        <input id="chatInput" placeholder="Type message to student seller...">
        <button class="btn btn-primary" onclick="sendCustomChat()">Send</button>
      </div>
    </div>
  `;
  openModal(html);
};

window.sendQuickChat = function(txt) {
  addChatMessage(txt, 'buyer');
  setTimeout(() => {
    addChatMessage('Sounds good! What time works best for you today?', 'seller');
  }, 1000);
};

window.sendCustomChat = function() {
  const input = $('#chatInput');
  const val = input.value.trim();
  if (!val) return;
  addChatMessage(val, 'buyer');
  input.value = '';
  setTimeout(() => {
    addChatMessage('Got your message. Let me know when you are nearby.', 'seller');
  }, 1200);
};

function addChatMessage(text, sender) {
  const msgs = $('#chatMsgs');
  if (!msgs) return;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${sender}`;
  bubble.textContent = text;
  msgs.appendChild(bubble);
  msgs.scrollTop = msgs.scrollHeight;
}

/* --- CREATE LISTING MODAL --- */
function openSellModal() {
  const html = `
    <h2 style="font-size:22px; margin-bottom: 6px;">Sell on Campus</h2>
    <p style="color:var(--muted); font-size:13px; margin-bottom:16px;">Instant visibility to thousands of verified students.</p>

    <label style="font-size:12px; font-weight:700; color:var(--muted)">Item Title</label>
    <input id="sellTitle" placeholder="e.g. Casio fx-82MS or Montra cycle" style="width:100%; padding:10px; border:1px solid var(--line); border-radius:8px; margin: 4px 0 12px; background:var(--surface); color:var(--ink);">

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <div>
        <label style="font-size:12px; font-weight:700; color:var(--muted)">Category</label>
        <select id="sellCat" style="width:100%; padding:10px; border:1px solid var(--line); border-radius:8px; margin: 4px 0 12px; background:var(--surface); color:var(--ink);">
          ${categories.filter(c => c.name !== 'All').map(c => `<option>${c.name}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="font-size:12px; font-weight:700; color:var(--muted)">Price (₹)</label>
        <input type="number" id="sellPrice" placeholder="e.g. 1500" style="width:100%; padding:10px; border:1px solid var(--line); border-radius:8px; margin: 4px 0 12px; background:var(--surface); color:var(--ink);">
      </div>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <div>
        <label style="font-size:12px; font-weight:700; color:var(--muted)">Condition</label>
        <select id="sellCondition" style="width:100%; padding:10px; border:1px solid var(--line); border-radius:8px; margin: 4px 0 12px; background:var(--surface); color:var(--ink);">
          <option>Brand New</option>
          <option>Like New</option>
          <option>Good</option>
          <option>Used</option>
        </select>
      </div>
      <div>
        <label style="font-size:12px; font-weight:700; color:var(--muted)">Campus Location</label>
        <select id="sellLocation" style="width:100%; padding:10px; border:1px solid var(--line); border-radius:8px; margin: 4px 0 12px; background:var(--surface); color:var(--ink);">
          <option value="BH-1">Boys Hostel 1 & 2</option>
          <option value="BH-4">Boys Hostel 4 & 5</option>
          <option value="BH-7">Boys Hostel 7 & 8</option>
          <option value="GH">Girls Hostels</option>
          <option value="UniMall">Uni-Mall</option>
          <option value="Block34">Block 34</option>
        </select>
      </div>
    </div>

    <label style="font-size:12px; font-weight:700; color:var(--muted)">Photo (Upload or auto-icon)</label>
    <input type="file" id="sellPhoto" accept="image/*" style="width:100%; padding:8px; border:1px solid var(--line); border-radius:8px; margin: 4px 0 12px; background:var(--surface); color:var(--ink);">

    <button class="btn btn-gold" style="width:100%; padding:12px; margin-top:8px; font-size:15px;" onclick="publishListing()">Post Listing Instantly</button>
  `;
  openModal(html);
}

window.publishListing = function() {
  const title = $('#sellTitle').value.trim();
  const cat = $('#sellCat').value;
  const price = +$('#sellPrice').value;
  const cond = $('#sellCondition').value;
  const loc = $('#sellLocation').value;
  const fileInput = $('#sellPhoto');

  if (!title || !price) {
    alert('Please enter a title and price');
    return;
  }

  const createItem = (imgData = null) => {
    const newItem = {
      id: Date.now(),
      name: title,
      price: price,
      cat: cat,
      icon: '📦',
      img: imgData,
      condition: cond,
      location: loc,
      verified: true,
      urgent: false,
      seller: { name: 'You (Student)', rating: 5.0, branch: 'Campus Verified' },
      desc: 'Recently posted listing.'
    };
    products.unshift(newItem);
    closeModal();
    renderProducts();
    showToast('Your item has been published on UNI LOOP! 🚀');
  };

  if (fileInput.files && fileInput.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => createItem(e.target.result);
    reader.readAsDataURL(fileInput.files[0]);
  } else {
    createItem();
  }
};

/* --- EVENT LISTENERS --- */
$('#sellTopBtn').onclick = openSellModal;
$('#dockSell').onclick = openSellModal;

$('#notifBtn').onclick = () => {
  $('#notifPopup').classList.toggle('active');
  $('#notifCount').style.display = 'none';
};

$('#heroSearchBtn').onclick = () => {
  $('#mainSearch').value = $('#heroSearch').value;
  location.hash = 'explore';
  renderProducts();
};

['mainSearch', 'filterCondition', 'filterVerified', 'sortBy', 'campusSelect'].forEach(id => {
  $('#' + id).addEventListener('input', renderProducts);
});

$('#resetFilters').onclick = () => {
  $('#mainSearch').value = '';
  $('#heroSearch').value = '';
  $('#filterCondition').value = 'all';
  $('#filterVerified').value = 'all';
  $('#sortBy').value = 'new';
  $('#campusSelect').value = 'all';
  activeCategory = 'All';
  renderCategories();
  renderProducts();
  showToast('Filters reset');
};

$('#viewAllListings').onclick = () => {
  $('#resetFilters').click();
};

$('#wishlistBtn').onclick = () => {
  if (wishlist.size === 0) {
    showToast('Your saved wishlist is currently empty ♡');
    return;
  }
  products = products.filter(p => wishlist.has(p.id));
  renderProducts();
  showToast(`Showing ${wishlist.size} saved listings`);
};

$('#dockSaved').onclick = () => $('#wishlistBtn').click();
$('#dockChat').onclick = () => showToast('Select any product card to start a student chat!');

/* --- INITIALIZATION --- */
initTheme();
$('#wishCount').textContent = wishlist.size;
renderCategories();
renderProducts();
