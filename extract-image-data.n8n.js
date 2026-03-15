// n8n Code node — paste this script directly into a "Code" node in your n8n workflow.
// Place this node after a "Telegram Trigger" node named "Telegram Trigger1".
// The node returns one item whose `.json` contains unified image metadata,
// or an empty array when the incoming message carries no supported image.

const triggerData = $('Telegram Trigger1').first().json;
const msg = triggerData.message;

if (!msg) return [];
if (!msg.photo && !msg.document) return [];

let fileId, fileName, mimeType, width, height;
const timestamp = msg.date * 1000;
const timeISO = new Date(timestamp).toISOString();

if (msg.photo) {
  const photo = msg.photo[msg.photo.length - 1];
  fileId = photo.file_id;
  fileName = `photo_${msg.date}.jpg`;
  width = photo.width || 0;
  height = photo.height || 0;
  mimeType = 'image/jpeg';
} else if (msg.document) {
  mimeType = msg.document.mime_type || '';
  if (!mimeType.startsWith('image/')) return [];
  fileId = msg.document.file_id;
  fileName = msg.document.file_name || `doc_${msg.date}.jpg`;
  width = 0;
  height = 0;
}

const sizePix = width && height ? `${width}x${height}` : 'Unknown';
const sizeMpx = width && height ? ((width * height) / 1000000).toFixed(2) : 'Unknown';

const unifiedData = {
  FileId: fileId,
  FileName: fileName,
  Type: 'isImage',
  Time: timeISO,
  Timestamp: timestamp,
  URL: '',
  Base64: '',
  Size: { pix: sizePix, Mpx: sizeMpx },
  tag: 'untagged',
};

return [{ json: unifiedData }];
