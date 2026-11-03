const glow = document.querySelector('.cursor-glow');
window.addEventListener('pointermove', (event) => {
  glow.style.left = `${event.clientX}px`;
  glow.style.top = `${event.clientY}px`;
});

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('visible'));
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

const frontGallery = document.querySelector('#front-gallery');
if (frontGallery) {
  const escapeGalleryText = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
  fetch('/api/gallery').then((response) => response.ok ? response.json() : null).then((data) => {
    if (!data?.photos?.length) return;
    frontGallery.innerHTML = data.photos.slice(0, 4).map((photo, index) => `<figure class="gallery-card gallery-live gallery-live-${index + 1}" style="background-image:url('${encodeURI(photo.image_url || photo.drive_url)}')"><a href="${encodeURI(photo.drive_url)}" target="_blank" rel="noreferrer"><span>${String(index + 1).padStart(2, '0')}</span><figcaption>${escapeGalleryText(photo.title)}</figcaption></a></figure>`).join('');
  }).catch(() => {});
}

// The supplied render has a black studio background. Make only that background
// transparent in-browser so the hand can sit naturally in the page space.
const hand = document.querySelector('.hero-hand');
if (hand) {
  const makeHandTransparent = () => {
    const canvas = document.createElement('canvas');
    const image = new Image();
    image.onload = () => {
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const brightness = (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / 3;
        if (brightness < 13) pixels.data[i + 3] = 0;
        else if (brightness < 31) pixels.data[i + 3] = Math.round(((brightness - 13) / 18) * 255);
      }
      context.putImageData(pixels, 0, 0);
      hand.src = canvas.toDataURL('image/png');
    };
    image.src = hand.currentSrc || hand.src;
  };
  makeHandTransparent();
}

document.addEventListener('click', (event) => {
  const join = event.target.closest('.join-trigger');
  if (join) { event.preventDefault(); document.querySelector('#join').scrollIntoView({ behavior: 'smooth' }); }
});
