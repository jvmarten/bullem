import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage } from '@bull-em/shared';
import { CHAT_MESSAGE_MAX_LENGTH } from '@bull-em/shared';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  /** When true, the input is disabled (e.g. players during active rounds). */
  disabled?: boolean;
  /** Label shown in the header (e.g. "Spectator Chat"). */
  label?: string;
}

/** Maximum number of messages kept in the chat panel before oldest are trimmed. */
const MAX_VISIBLE_MESSAGES = 100;

export function ChatPanel({ messages, onSend, disabled, label }: ChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);

  // Track unread messages when panel is closed
  useEffect(() => {
    if (!isOpen && messages.length > 0) {
      setUnreadCount(prev => prev + 1);
    }
  // Only fire when a new message arrives (length changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Clear unread when opening
  useEffect(() => {
    if (isOpen) setUnreadCount(0);
  }, [isOpen]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isOpen]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && !wasOpenRef.current && !disabled) {
      inputRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, disabled]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput('');
  }, [input, onSend, disabled]);

  const visibleMessages = messages.slice(-MAX_VISIBLE_MESSAGES);

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end" style={{ maxWidth: '340px' }}>
      {/* Chat messages panel */}
      {isOpen && (
        <div
          className="glass mb-2 w-72 sm:w-80 flex flex-col animate-fade-in"
          style={{ maxHeight: '300px', borderRadius: '8px' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--gold-dim)]/30">
            <span className="text-xs font-semibold text-[var(--gold)] uppercase tracking-wider">
              {label ?? 'Chat'}
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center"
              aria-label="Close chat"
            >
              &times;
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5" style={{ minHeight: '120px', maxHeight: '220px' }}>
            {visibleMessages.length === 0 && (
              <p className="text-[var(--gold-dim)] text-xs text-center py-4 opacity-60">
                No messages yet
              </p>
            )}
            {visibleMessages.map((msg) => (
              <div key={msg.id} className="animate-fade-in">
                <span
                  className={`text-xs font-semibold ${msg.isSpectator ? 'text-[var(--gold-dim)]' : 'text-[var(--gold)]'}`}
                >
                  {msg.senderName}
                  {msg.isSpectator && (
                    <span className="text-[10px] opacity-60 ml-1">(spectator)</span>
                  )}
                </span>
                <span className="text-xs text-[var(--text)] ml-1.5">{msg.message}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          {disabled ? (
            <div className="px-3 py-2 border-t border-[var(--gold-dim)]/30">
              <p className="text-[10px] text-[var(--gold-dim)] text-center opacity-60">
                Chat available between rounds
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="px-3 py-2 border-t border-[var(--gold-dim)]/30 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, CHAT_MESSAGE_MAX_LENGTH))}
                placeholder="Type a message..."
                maxLength={CHAT_MESSAGE_MAX_LENGTH}
                className="flex-1 bg-[var(--surface)] text-[var(--text)] text-xs rounded px-2 py-1.5 border border-[var(--gold-dim)]/30 focus:border-[var(--gold)] focus:outline-none placeholder:text-[var(--gold-dim)]/50 min-h-[36px]"
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="btn-ghost text-xs px-3 py-1.5 min-h-[36px] min-w-[44px] disabled:opacity-30"
              >
                Send
              </button>
            </form>
          )}
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="btn-ghost rounded-full w-11 h-11 flex items-center justify-center shadow-lg relative"
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
        title={label ?? 'Chat'}
      >
        <span className="text-xl leading-none" role="img" aria-hidden="true">💬</span>
        {!isOpen && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-[var(--danger)] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
