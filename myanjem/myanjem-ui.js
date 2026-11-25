(function(){
  'use strict';
  const KEY='myanjem_ui_preferences_v1';
  const palettes={pink:'#e83e8c',blue:'#3978d7',purple:'#8054c7',teal:'#159b91',orange:'#e58a32',green:'#2e9b65'};
  let prefs={theme:'light',accent:'pink'};
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');if(saved&&typeof saved==='object')prefs={...prefs,...saved}}catch(e){}
  const apply=()=>{
    const root=document.documentElement;
    root.dataset.theme=prefs.theme==='dark'?'dark':'light';
    root.dataset.accent=palettes[prefs.accent]?prefs.accent:'pink';
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta=>meta.setAttribute('content',root.dataset.theme==='dark'?'#211c24':palettes[root.dataset.accent]));
    document.querySelectorAll('[data-ma-mode]').forEach(b=>{const on=b.dataset.maMode===root.dataset.theme;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
    document.querySelectorAll('[data-ma-accent]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.maAccent===root.dataset.accent)));
    try{localStorage.setItem(KEY,JSON.stringify(prefs))}catch(e){}
  };
  apply();
  function mount(){
    if(document.getElementById('myanjem-ui-root'))return;
    const root=document.createElement('div');root.id='myanjem-ui-root';
    root.innerHTML=`<button id="myanjem-ui-launcher" type="button" aria-label="Pengaturan tampilan" aria-expanded="false" aria-controls="myanjem-ui-panel"><i class="bx bx-palette"></i></button>
      <section id="myanjem-ui-panel" role="dialog" aria-label="Pengaturan tampilan MyAnjem" aria-modal="false">
       <div class="ma-ui-head"><strong><i class="bx bx-palette"></i> Tampilan MyAnjem</strong><button class="ma-ui-close" id="myanjem-ui-close" type="button" aria-label="Tutup pengaturan"><i class="bx bx-x"></i></button></div>
       <div class="ma-ui-group"><span class="ma-ui-label">Mode tampilan</span><div class="ma-ui-segments"><button class="ma-ui-mode" type="button" data-ma-mode="light"><i class="bx bx-sun"></i> Terang</button><button class="ma-ui-mode" type="button" data-ma-mode="dark"><i class="bx bx-moon"></i> Gelap</button></div></div>
       <div class="ma-ui-group"><span class="ma-ui-label">Warna aksen</span><div class="ma-ui-swatches"><button type="button" class="ma-ui-swatch" data-ma-accent="pink" aria-label="Pink" style="--swatch:#e83e8c"><i class="bx bx-check" aria-hidden="true"></i></button><button type="button" class="ma-ui-swatch" data-ma-accent="blue" aria-label="Biru" style="--swatch:#3978d7"><i class="bx bx-check" aria-hidden="true"></i></button><button type="button" class="ma-ui-swatch" data-ma-accent="purple" aria-label="Ungu" style="--swatch:#8054c7"><i class="bx bx-check" aria-hidden="true"></i></button><button type="button" class="ma-ui-swatch" data-ma-accent="teal" aria-label="Toska" style="--swatch:#159b91"><i class="bx bx-check" aria-hidden="true"></i></button><button type="button" class="ma-ui-swatch" data-ma-accent="orange" aria-label="Oranye" style="--swatch:#e58a32"><i class="bx bx-check" aria-hidden="true"></i></button><button type="button" class="ma-ui-swatch" data-ma-accent="green" aria-label="Hijau" style="--swatch:#2e9b65"><i class="bx bx-check" aria-hidden="true"></i></button></div><p class="ma-ui-hint">Pilihan tersimpan otomatis dan diterapkan pada seluruh halaman di perangkat ini.</p></div>
       <div class="ma-ui-group"><button type="button" id="myanjem-install-app" class="ma-ui-install"><i class="bx bx-download"></i><span>Pasang aplikasi MyAnjem</span></button><p class="ma-ui-hint" id="myanjem-install-hint">Tambahkan MyAnjem ke desktop atau layar utama dari browser yang mendukung instalasi.</p></div>
      </section>`;
    document.body.appendChild(root);
    apply();
    const launcher=root.querySelector('#myanjem-ui-launcher'),panel=root.querySelector('#myanjem-ui-panel'),close=root.querySelector('#myanjem-ui-close');
    const setOpen=(yes)=>{panel.classList.toggle('open',yes);launcher.setAttribute('aria-expanded',String(yes))};
    launcher.addEventListener('click',()=>setOpen(!panel.classList.contains('open')));close.addEventListener('click',()=>setOpen(false));
    root.querySelectorAll('[data-ma-mode]').forEach(b=>b.addEventListener('click',()=>{prefs.theme=b.dataset.maMode;apply()}));
    root.querySelectorAll('[data-ma-accent]').forEach(b=>b.addEventListener('click',()=>{prefs.accent=b.dataset.maAccent;apply()}));
    document.addEventListener('keydown',e=>{if(e.key==='Escape')setOpen(false)});
    document.addEventListener('click',e=>{if(panel.classList.contains('open')&&!root.contains(e.target))setOpen(false)});
    setupInstall(root.querySelector('#myanjem-install-app'),root.querySelector('#myanjem-install-hint'));
  }
  function setupInstall(button,hint){
    let installPrompt=null;
    const setText=(text)=>{if(hint)hint.textContent=text};
    const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
    if(isStandalone()){button.innerHTML='<i class="bx bx-check-circle"></i><span>MyAnjem sudah terpasang</span>';button.disabled=true;setText('Aplikasi dapat dibuka langsung dari desktop atau layar utama perangkat.');return}
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;button.disabled=false;button.innerHTML='<i class="bx bx-download"></i><span>Tambahkan ke desktop</span>';setText('Browser siap memasang MyAnjem sebagai aplikasi.');});
    window.addEventListener('appinstalled',()=>{button.innerHTML='<i class="bx bx-check-circle"></i><span>MyAnjem sudah terpasang</span>';button.disabled=true;setText('Aplikasi berhasil ditambahkan ke perangkat ini.');});
    button.addEventListener('click',async()=>{
      if(installPrompt){button.disabled=true;try{installPrompt.prompt();const choice=await installPrompt.userChoice;if(choice&&choice.outcome==='accepted'){setText('Permintaan pemasangan diterima. Ikuti langkah browser sampai selesai.')}else{setText('Pemasangan belum dilakukan. Kamu dapat mencobanya kembali kapan saja.')}}catch(e){setText('Browser tidak dapat membuka dialog pemasangan. Gunakan menu browser.')}finally{installPrompt=null;button.disabled=false}return}
      const ua=navigator.userAgent||'';
      if(/iphone|ipad|ipod/i.test(ua)){setText('Di Safari iPhone/iPad: tekan Bagikan, pilih “Add to Home Screen”, lalu tekan Tambah.');return}
      if(/android/i.test(ua)){setText('Di Chrome Android: buka menu ⋮ lalu pilih “Install app” atau “Tambahkan ke layar utama”.');return}
      setText('Di Chrome / Edge desktop: buka menu browser (⋮ atau …), lalu pilih “Cast, save and share” / “Apps” → “Install MyAnjem” atau “Install this site as an app”.');
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  if('serviceWorker' in navigator && /^https?:$/.test(location.protocol))window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}),{once:true});
})();
