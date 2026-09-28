// AI provider abstraction — never hardcode a vendor in UI. Mock for dev;
// real providers (transcribe, TTS, segmentation) plug in here with Zod-validated plans.
export interface EditOp { type: string; range?: [number, number]; payload?: Record<string, unknown>; }
export interface EditPlan { operations: EditOp[]; summary: string[]; }
export interface AIProvider {
  name: string;
  transcribe(_audio: Blob): Promise<{ text: string; words: { w: string; t: number; d: number }[] }>;
  autoEdit(_info: { duration: number }): Promise<EditPlan>;
}
export const mockAI: AIProvider = {
  name: 'mock',
  async transcribe() {
    const { transcribeOnce } = await import('./voice');
    const text = await transcribeOnce();
    return { text, words: text.split(/\s+/).map((w, i) => ({ w, t: i * 0.4, d: 0.4 })) };
  },
  async autoEdit({ duration }) {
    return { operations: [], summary: [`Analyzed ${duration.toFixed(1)}s (mock). Connect a provider for silence/filler/scene detection.`] };
  },
};
export function validatePlan(p: EditPlan): boolean {
  return Array.isArray(p.operations) && p.operations.every((o) => typeof o.type === 'string');
}
