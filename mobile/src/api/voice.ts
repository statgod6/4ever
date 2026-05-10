import apiClient from './client'
import { API_URL } from '../constants/config'

/**
 * Upload a local audio file to the backend and get its text transcript.
 * @param fileUri  Local file URI produced by expo-audio recorder (e.g. file:///.../rec.m4a)
 * @param mimeType MIME type of the clip (default audio/m4a)
 */
export async function transcribeAudio(
  fileUri: string,
  mimeType: string = 'audio/m4a',
): Promise<{ text: string }> {
  const form = new FormData()
  // RN FormData accepts { uri, name, type } for file fields
  form.append('audio', {
    uri: fileUri,
    name: 'recording.m4a',
    type: mimeType,
  } as any)

  const res = await apiClient.post<{ text: string }>(
    '/orchestration/voice/transcribe',
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      transformRequest: (data) => data, // prevent axios from JSON-stringifying FormData
    },
  )
  return res.data
}

/**
 * Fetch TTS audio bytes for the given text from the backend.
 * Returns a base64 mp3 payload (convenient for expo-audio file-based playback).
 *
 * We bypass axios here and use fetch so we can read the binary body cleanly.
 */
export async function synthesizeSpeech(
  text: string,
  token: string | null,
  voice: string = 'nova',
): Promise<{ base64: string; mime: string }> {
  const res = await fetch(`${API_URL}/orchestration/voice/speak`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text, voice }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`TTS failed (${res.status}): ${errText.slice(0, 200)}`)
  }
  const arrayBuf = await res.arrayBuffer()
  const bytes = new Uint8Array(arrayBuf)
  // Convert to base64 in chunks to avoid call-stack overflow on big payloads.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)) as any,
    )
  }
  // @ts-ignore - global btoa is available in React Native / Hermes
  const base64 = globalThis.btoa ? globalThis.btoa(binary) : Buffer.from(binary, 'binary').toString('base64')
  return { base64, mime: 'audio/mpeg' }
}
