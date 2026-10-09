// Loads the site data once (shared by every script) and shows a random ad banner.
window.MP = fetch('/api/data').then(async (r) => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not load the site data');
  return j;
});
MP.then((d) => {
  if (!d.ads || !d.ads.length) return;
  const box = document.createElement('div');
  box.className = 'ad';
  const img = new Image();
  img.alt = 'Ad';
  img.src = d.ads[Math.floor(Math.random() * d.ads.length)];
  box.append(img);
  document.querySelector('header').after(box);
}).catch(() => {});
