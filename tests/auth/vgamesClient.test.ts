import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { vgamesQuick, vgamesSetCredentials, vgamesLogin } from '../../src/auth/vgamesClient'

function jsonResponse(status: number, body: any): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('vgamesClient', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  describe('vgamesQuick', () => {
    it('POSTs to /auth/quick with deviceCredential + displayName + game:"jaipur" and returns token/accountId', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { token: 'tok123', accountId: 'acc1' }))

      const result = await vgamesQuick('cred-aaaa', 'Neo')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, init] = mockFetch.mock.calls[0]
      expect(String(url)).toMatch(/\/auth\/quick$/)
      expect(init.method).toBe('POST')
      // Fix M3: stamps origin_game correctly for NEWLY-minted accounts on the
      // worker (cosmetic/analytics only — the worker defaults to 'iota' when
      // this field is absent or unrecognized).
      expect(JSON.parse(init.body)).toEqual({ deviceCredential: 'cred-aaaa', displayName: 'Neo', game: 'jaipur' })
      expect(result).toEqual({ token: 'tok123', accountId: 'acc1' })
    })

    it('throws on a non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }))
      await expect(vgamesQuick('cred', 'Name')).rejects.toThrow()
    })
  })

  describe('vgamesSetCredentials', () => {
    it('POSTs to /auth/set-credentials with a Bearer token and username/password', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }))

      const result = await vgamesSetCredentials('tok123', 'vee', 'hunter2')

      const [url, init] = mockFetch.mock.calls[0]
      expect(String(url)).toMatch(/\/auth\/set-credentials$/)
      expect(init.headers.authorization).toBe('Bearer tok123')
      expect(JSON.parse(init.body)).toEqual({ username: 'vee', password: 'hunter2' })
      expect(result).toEqual({ ok: true })
    })

    it('surfaces a 409 username_taken error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(409, { error: 'username_taken' }))
      const result = await vgamesSetCredentials('tok123', 'vee', 'hunter2')
      expect(result).toEqual({ ok: false, error: 'username_taken' })
    })
  })

  describe('vgamesLogin', () => {
    it('POSTs to /auth/login with username/password/deviceCredential', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { token: 'tok456', accountId: 'acc2', mustChangePassword: false }))

      const result = await vgamesLogin('vee', 'hunter2', 'cred-aaaa')

      const [url, init] = mockFetch.mock.calls[0]
      expect(String(url)).toMatch(/\/auth\/login$/)
      expect(JSON.parse(init.body)).toEqual({ username: 'vee', password: 'hunter2', deviceCredential: 'cred-aaaa' })
      expect(result).toEqual({ ok: true, token: 'tok456', accountId: 'acc2', mustChangePassword: false })
    })

    it('surfaces a 401 invalid_credentials error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_credentials' }))
      const result = await vgamesLogin('vee', 'wrong', 'cred-aaaa')
      expect(result).toEqual({ ok: false, error: 'invalid_credentials' })
    })
  })
})
