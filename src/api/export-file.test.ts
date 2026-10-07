import { describe, it, expect } from 'vitest';
import { blobToBase64 } from './export-file';

describe('blobToBase64', () => {
  it('二进制内容转 base64 不失真', async () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(await blobToBase64(new Blob([bytes]))).toBe('AAEC/f7/');
  });

  it('跨分块边界（0x8000）拼接正确', async () => {
    const size = 0x8000 + 3;
    const b64 = await blobToBase64(new Blob([new Uint8Array(size).fill(65)]));
    expect(b64).toBe(btoa('A'.repeat(size)));
  });
});
