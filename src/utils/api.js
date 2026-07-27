export async function apiPost(path, body, { signal } = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`)
  }
  return data
}

export async function apiGet(path, { signal } = {}) {
  const res = await fetch(path, { method: 'GET', signal })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`)
  }
  return data
}

export function abortErrorMessage(err) {
  if (!err) return 'Request failed'
  if (err.name === 'AbortError' || err.message?.includes('aborted')) {
    return err.message?.includes('timed out') || err.message?.includes('Timeout')
      ? 'Render timed out. Try Restart, or cancel and simplify the project.'
      : 'Render cancelled.'
  }
  return err.message || String(err)
}
