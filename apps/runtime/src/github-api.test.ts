import { describe, it, expect, vi } from 'vitest';
import { ensureLearnerBranch } from './github-api.js';

function mockResponse(opts: { ok: boolean; status?: number; body?: unknown }) {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 404),
    json: async () => opts.body,
    text: async () => (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)),
  } as unknown as Response;
}

describe('ensureLearnerBranch (T6)', () => {
  it('이미 있는 브랜치 → created=false, sha 반환', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ ok: true, body: { object: { sha: 'abc123' } } }));
    const r = await ensureLearnerBranch('uj_choe', 'tok', fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ created: false, sha: 'abc123' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toContain('/git/ref/heads/learner/uj_choe');
  });

  it('없는 브랜치 → main에서 새로 생성', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 404 })) // check
      .mockResolvedValueOnce(mockResponse({ ok: true, body: { object: { sha: 'main-sha' } } })) // main
      .mockResolvedValueOnce(mockResponse({ ok: true, body: { ref: 'refs/heads/learner/x' } })); // create
    const r = await ensureLearnerBranch('uj_choe', 'tok', fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ created: true, sha: 'main-sha' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // 마지막 호출은 POST
    const last = fetchMock.mock.calls[2]!;
    expect(last[1].method).toBe('POST');
    const body = JSON.parse(last[1].body);
    expect(body.ref).toBe('refs/heads/learner/uj_choe');
    expect(body.sha).toBe('main-sha');
  });

  it('main 조회 실패 → error 반환', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 404 }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 500 }));
    const r = await ensureLearnerBranch('uj_choe', 'tok', fetchMock as unknown as typeof fetch);
    expect(r.sha).toBeNull();
    expect(r.created).toBe(false);
    expect(r.error).toContain('main ref fetch failed');
  });

  it('create POST 실패 → error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 404 }))
      .mockResolvedValueOnce(mockResponse({ ok: true, body: { object: { sha: 'main-sha' } } }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 422, body: 'reference already exists' }));
    const r = await ensureLearnerBranch('a', 't', fetchMock as unknown as typeof fetch);
    expect(r.created).toBe(false);
    expect(r.error).toContain('create branch failed');
  });

  it('fetch 자체가 throw → error 안전 처리', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const r = await ensureLearnerBranch('a', 't', fetchMock as unknown as typeof fetch);
    expect(r.sha).toBeNull();
    // 첫 check가 throw하면 그냥 main 조회로 fallthrough → 거기도 throw → error
    expect(r.error).toBeDefined();
  });
});
