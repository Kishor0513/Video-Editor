// Real voice-file generation with user-supplied provider key (browser-direct, no backend secrets).
export async function ttsElevenLabs(text: string, key: string, voice = '21m00Tcm4TlvDq8ikWAM'): Promise<Blob> {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_monolingual_v1' }),
  });
  if (!r.ok) throw new Error('ElevenLabs ' + r.status);
  return await r.blob();
}
export async function ttsOpenAI(text: string, key: string, voice = 'alloy'): Promise<Blob> {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', input: text, voice }),
  });
  if (!r.ok) throw new Error('OpenAI ' + r.status);
  return await r.blob();
}
