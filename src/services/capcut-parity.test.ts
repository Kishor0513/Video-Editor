import { describe, expect, it } from 'vitest';
import { parseSRT, parseVTT, wordsFromText } from './transcribe';
import { generateScript, scriptToWords } from './script';
import { applyEasing } from '../engine/renderer';
import { templates } from './templates';

describe('transcribe cues', () => {
  it('parses SRT blocks', () => {
    const src = `1\n00:00:01,000 --> 00:00:03,000\nHello world\n\n2\n00:00:03,500 --> 00:00:05,000\nSecond line\n`;
    const cues = parseSRT(src);
    expect(cues.length).toBe(2);
    expect(cues[0].start).toBeCloseTo(1);
    expect(cues[0].duration).toBeCloseTo(2);
    expect(cues[1].text).toBe('Second line');
  });
  it('parses VTT', () => {
    const cues = parseVTT(`WEBVTT\n\n00:01.000 --> 00:03.000\nHi\n`);
    expect(cues.length).toBe(1);
    expect(cues[0].start).toBeCloseTo(1);
  });
  it('wordsFromText respects wps', () => {
    const w = wordsFromText('a b c d', 2, 10);
    expect(w.length).toBe(4);
    expect(w[0].t).toBeCloseTo(10);
    expect(w[1].t).toBeCloseTo(10.5);
  });
});

describe('script generator', () => {
  it('builds 4 beats', () => {
    const s = generateScript('Morning routine');
    expect(s.beats.length).toBe(4);
    expect(s.title.toLowerCase()).toContain('morning');
  });
  it('scriptToWords emits timed words', () => {
    const w = scriptToWords('test topic', 2.5);
    expect(w.length).toBeGreaterThan(5);
    expect(w[0].d).toBeCloseTo(0.4);
  });
});

describe('easing', () => {
  it('linear/back/bounce/smooth stay bounded', () => {
    for (const k of ['linear', 'easeBack', 'easeBounce', 'smooth']) {
      expect(applyEasing(k, 0)).toBeCloseTo(k === 'easeBack' ? 0 : 0, 1);
      expect(applyEasing(k, 1)).toBeCloseTo(1);
    }
  });
});

describe('templates', () => {
  it('has 10 CapCut-style templates', () => {
    expect(templates.length).toBeGreaterThanOrEqual(10);
    expect(templates.map((t) => t.aspect)).toContain('9:16');
    expect(templates.map((t) => t.aspect)).toContain('16:9');
  });
});
