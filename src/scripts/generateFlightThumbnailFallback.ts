import sharp from 'sharp';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="450" height="450" viewBox="0 0 450 450">
  <rect width="450" height="450" fill="#d9e0dc"/>
  <path d="M0 330C70 260 120 285 180 235S290 205 345 145 420 120 450 80V450H0Z" fill="#bcc9c1"/>
  <path d="M0 370C90 320 125 350 195 292S300 280 365 205 420 180 450 145V450H0Z" fill="#a9b9b0"/>
  <circle cx="225" cy="210" r="78" fill="#eef2ee" fill-opacity="0.9"/>
  <path d="M171 258 225 168 248 204 269 180 315 258Z" fill="#6f8c82"/>
  <path d="m196 258 29-48 20 31 13-16 26 33Z" fill="#496e66"/>
  <path d="M225 150v93M179 197h92" stroke="#496e66" stroke-width="7" stroke-linecap="round" fill="none"/>
</svg>`;

await sharp(Buffer.from(svg)).webp({ quality: 84 }).toFile('public/flight-thumbnail-fallback.webp');
