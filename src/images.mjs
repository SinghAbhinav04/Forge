export function validateImages(input=[]) {
  if (!Array.isArray(input) || input.length>2) throw new Error('Attach at most two images.');
  return input.map(image => {
    if (!image || typeof image.url!=='string' || image.url.length>1_400_000 || !/^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(image.url)) throw new Error('Use a small PNG, JPEG or WebP image attachment.');
    return { url:image.url,name:typeof image.name==='string' ? image.name.slice(0,200) : 'Attached image' };
  });
}
