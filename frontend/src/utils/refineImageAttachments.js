const IMAGE_MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
};

export const REFINE_MAX_IMAGES = 4;
export const REFINE_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const REFINE_MAX_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;
export const REFINE_IMAGE_ACCEPT = Object.keys(IMAGE_MIME_BY_EXTENSION).join(',');

const guessImageMimeTypeFromFileName = (fileName) => {
  const normalized = String(fileName || '').toLowerCase();
  const extension = normalized.slice(normalized.lastIndexOf('.'));
  return IMAGE_MIME_BY_EXTENSION[extension] || 'image/png';
};

export const isImageLikeFile = (file) => {
  const mimeType = String(file?.type || '').toLowerCase();
  const fileName = String(file?.name || '').toLowerCase();
  if (mimeType.startsWith('image/')) return true;
  return Object.keys(IMAGE_MIME_BY_EXTENSION).some((extension) => fileName.endsWith(extension));
};

export const formatBytes = (bytes) => {
  const safe = Math.max(0, Number(bytes) || 0);
  if (safe >= 1024 * 1024) {
    return `${(safe / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (safe >= 1024) {
    return `${Math.round(safe / 1024)} KB`;
  }
  return `${safe} B`;
};

export const buildImagePayloadKey = (value) =>
  `${String(value?.name || '').trim().toLowerCase()}::${Math.max(0, Number(value?.size || 0))}`;

export const readImageFileAsBase64Payload = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const commaIndex = raw.indexOf(',');
      const base64 = commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw;
      resolve({
        name: String(file?.name || 'reference-image').trim() || 'reference-image',
        mimeType: String(file?.type || '').trim() || guessImageMimeTypeFromFileName(file?.name),
        size: Math.max(0, Number(file?.size) || 0),
        base64,
      });
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file?.name || 'image file'}`));
    reader.readAsDataURL(file);
  });
