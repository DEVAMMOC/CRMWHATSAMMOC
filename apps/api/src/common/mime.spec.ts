import { mimeToExt, parseDataUrl } from './mime';

describe('mimeToExt', () => {
  it('mapeia mimes conhecidos', () => {
    expect(mimeToExt('image/jpeg')).toBe('jpg');
    expect(mimeToExt('image/png')).toBe('png');
    expect(mimeToExt('audio/ogg; codecs=opus')).toBe('ogg');
    expect(mimeToExt('application/pdf')).toBe('pdf');
    expect(mimeToExt('video/mp4')).toBe('mp4');
  });
  it('faz fallback para bin', () => {
    expect(mimeToExt('application/x-coisa')).toBe('bin');
    expect(mimeToExt('')).toBe('bin');
  });
});

describe('parseDataUrl', () => {
  it('separa mime e bytes de um data-url base64', () => {
    // "hi" em base64 = aGk=
    const r = parseDataUrl('data:text/plain;base64,aGk=');
    expect(r).not.toBeNull();
    expect(r!.mime).toBe('text/plain');
    expect(r!.buffer.toString('utf8')).toBe('hi');
  });
  it('retorna null para entrada inválida', () => {
    expect(parseDataUrl('nope')).toBeNull();
  });
});
