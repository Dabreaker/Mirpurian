fetch('/api/ad').then((r) => r.json()).then(({ url }) => {
  if (!url) return;
  const d = document.createElement('div');
  d.className = 'ad';
  d.innerHTML = '<img alt="Ad">';
  d.firstChild.src = url;
  document.querySelector('header').after(d);
}).catch(() => {});
