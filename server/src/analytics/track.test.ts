import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db query function before importing track
const mockQuery = vi.fn();
vi.mock('../db/index.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Mock logger to suppress output and verify error swallowing
const mockWarn = vi.fn();
vi.mock('../logger.js', () => ({
  default: { warn: (...args: unknown[]) => mockWarn(...args) },
}));

// Import after mocks are set up
const { track } = await import('./track.js');

describe('track()', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWarn.mockReset();
  });

  it('inserts a row with the correct shape', () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    track('game:started', { roomCode: 'ABCD', playerCount: 4 }, 'user-123');

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toContain('INSERT INTO events');
    expect(params[0]).toBe('game:started');
    expect(params[1]).toBe('user-123');
    const parsed = JSON.parse(params[2] as string);
    expect(parsed).toEqual({ roomCode: 'ABCD', playerCount: 4 });
  });

  it('sets user_id to null when not provided', () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    track('player:login', { authMethod: 'email' });

    const [, params] = mockQuery.mock.calls[0]!;
    expect(params[1]).toBeNull();
  });

  it('defaults properties to empty object when not provided', () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    track('game:completed');

    const [, params] = mockQuery.mock.calls[0]!;
    expect(JSON.parse(params[2] as string)).toEqual({});
  });

  it('does not throw when the database rejects the insert', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));

    // This should not throw
    expect(() => track('game:started', { test: true })).not.toThrow();

    // Allow the microtask (promise rejection) to settle
    await vi.waitFor(() => {
      expect(mockWarn).toHaveBeenCalled();
    });
  });

  it('does not throw when query returns null (DB unavailable)', () => {
    mockQuery.mockResolvedValue(null);

    expect(() => track('bull:called', { wasCorrect: true })).not.toThrow();
  });
});
