const { extractImageData } = require('./extract-image-data');

describe('extractImageData', () => {
  test('returns empty array when message is missing', () => {
    expect(extractImageData({})).toEqual([]);
  });

  test('returns empty array when message has no photo or document', () => {
    expect(extractImageData({ message: { date: 1700000000, text: 'hello' } })).toEqual([]);
  });

  test('extracts data from a photo message', () => {
    const triggerData = {
      message: {
        date: 1700000000,
        photo: [
          { file_id: 'small_id', width: 100, height: 100 },
          { file_id: 'large_id', width: 1280, height: 720 },
        ],
      },
    };

    const result = extractImageData(triggerData);
    expect(result).toHaveLength(1);
    const data = result[0].json;
    expect(data.FileId).toBe('large_id');
    expect(data.FileName).toBe('photo_1700000000.jpg');
    expect(data.Type).toBe('isImage');
    expect(data.Timestamp).toBe(1700000000000);
    expect(data.Time).toBe(new Date(1700000000000).toISOString());
    expect(data.Size.pix).toBe('1280x720');
    expect(data.Size.Mpx).toBe(((1280 * 720) / 1000000).toFixed(2));
    expect(data.URL).toBe('');
    expect(data.Base64).toBe('');
    expect(data.tag).toBe('untagged');
  });

  test('uses Unknown size when photo dimensions are zero', () => {
    const triggerData = {
      message: {
        date: 1700000000,
        photo: [{ file_id: 'id1', width: 0, height: 0 }],
      },
    };

    const result = extractImageData(triggerData);
    expect(result[0].json.Size.pix).toBe('Unknown');
    expect(result[0].json.Size.Mpx).toBe('Unknown');
  });

  test('extracts data from an image document', () => {
    const triggerData = {
      message: {
        date: 1700000000,
        document: {
          file_id: 'doc_id',
          file_name: 'picture.png',
          mime_type: 'image/png',
        },
      },
    };

    const result = extractImageData(triggerData);
    expect(result).toHaveLength(1);
    const data = result[0].json;
    expect(data.FileId).toBe('doc_id');
    expect(data.FileName).toBe('picture.png');
    expect(data.Size.pix).toBe('Unknown');
    expect(data.Size.Mpx).toBe('Unknown');
  });

  test('returns empty array for non-image document', () => {
    const triggerData = {
      message: {
        date: 1700000000,
        document: {
          file_id: 'doc_id',
          file_name: 'file.pdf',
          mime_type: 'application/pdf',
        },
      },
    };

    expect(extractImageData(triggerData)).toEqual([]);
  });

  test('falls back to generated filename when document has no file_name', () => {
    const triggerData = {
      message: {
        date: 1700000000,
        document: {
          file_id: 'doc_id',
          mime_type: 'image/jpeg',
        },
      },
    };

    const result = extractImageData(triggerData);
    expect(result[0].json.FileName).toBe('doc_1700000000.jpg');
  });
});
