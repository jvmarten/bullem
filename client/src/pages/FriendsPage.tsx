import { useState, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useFriends } from '../context/FriendsContext.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { useSound } from '../hooks/useSound.js';
import type { FriendEntry } from '@bull-em/shared';

const AVATAR_EMOJI: Record<string, string> = {
  bull: '\u{1F402}', ace: '\u{1F0A1}', crown: '\u{1F451}', diamond: '\u{1F48E}',
  skull: '\u{1F480}', star: '\u2B50', wolf: '\u{1F43A}', eagle: '\u{1F985}',
  lion: '\u{1F981}', fox: '\u{1F98A}', bear: '\u{1F43B}',
};

/** Online status indicator dot. */
function OnlineDot({ isOnline }: { isOnline: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
        isOnline ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' : 'bg-[var(--gold-dim)] opacity-40'
      }`}
      title={isOnline ? 'Online' : 'Offline'}
    />
  );
}

/** Single friend card with actions. */
function FriendCard({
  friend,
  onAccept,
  onReject,
  onRemove,
  onInvite,
}: {
  friend: FriendEntry;
  onAccept?: () => void;
  onReject?: () => void;
  onRemove?: () => void;
  onInvite?: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="glass px-3 py-2.5 flex items-center gap-3">
      {/* Avatar / status */}
      <div className="relative flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-[var(--felt-light)] flex items-center justify-center text-lg">
          {friend.avatar ? (
            <span className="text-xl">
              {AVATAR_EMOJI[friend.avatar] ?? '\u{1F464}'}
            </span>
          ) : (
            <span className="text-[var(--gold-dim)]">{friend.displayName.charAt(0).toUpperCase()}</span>
          )}
        </div>
        {friend.status === 'accepted' && (
          <span className="absolute -bottom-0.5 -right-0.5">
            <OnlineDot isOnline={friend.isOnline} />
          </span>
        )}
      </div>

      {/* Name and status info */}
      <div className="flex-1 min-w-0">
        <button
          onClick={() => navigate(`/u/${friend.username}`)}
          className="text-sm text-[var(--gold)] font-medium truncate block text-left hover:underline"
        >
          {friend.displayName}
        </button>
        <span className="text-[10px] text-[var(--gold-dim)] opacity-70">
          @{friend.username}
          {friend.status === 'accepted' && friend.isOnline && friend.currentRoomCode && (
            <> &middot; In room <Link to={`/room/${friend.currentRoomCode}`} className="underline">{friend.currentRoomCode}</Link></>
          )}
          {friend.status === 'pending' && (friend.isIncoming ? ' \u00b7 wants to be friends' : ' \u00b7 request sent')}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 flex-shrink-0">
        {friend.status === 'pending' && friend.isIncoming && (
          <>
            <button onClick={onAccept} className="btn-gold px-2.5 py-1.5 text-xs min-h-[36px]">
              Accept
            </button>
            <button onClick={onReject} className="btn-outline px-2.5 py-1.5 text-xs min-h-[36px]">
              Decline
            </button>
          </>
        )}
        {friend.status === 'pending' && !friend.isIncoming && (
          <button onClick={onRemove} className="btn-outline px-2.5 py-1.5 text-xs min-h-[36px] text-[var(--danger)]">
            Cancel
          </button>
        )}
        {friend.status === 'accepted' && (
          <>
            {friend.isOnline && (
              <button onClick={onInvite} className="btn-gold px-2.5 py-1.5 text-xs min-h-[36px]">
                Invite
              </button>
            )}
            <button onClick={onRemove} className="btn-outline px-2.5 py-1.5 text-xs min-h-[36px]">
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type Tab = 'friends' | 'requests' | 'add';

export function FriendsPage() {
  const { user } = useAuth();
  const { acceptedFriends, incomingRequests, outgoingRequests, incomingCount, loading, sendRequest, respondToRequest, removeFriend, inviteFriend, refresh } = useFriends();
  const { addToast } = useToast();
  const { play } = useSound();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('friends');
  const [addUsername, setAddUsername] = useState('');
  const [sending, setSending] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const spinKeyRef = useRef(0);

  const handleSendRequest = useCallback(async () => {
    if (!addUsername.trim()) return;
    setSending(true);
    play('uiSoft');
    const result = await sendRequest(addUsername.trim());
    setSending(false);
    if ('ok' in result) {
      addToast(`Friend request sent to ${addUsername.trim()}`, 'success');
      setAddUsername('');
      setTab('requests');
    } else {
      addToast(result.error, 'error');
    }
  }, [addUsername, sendRequest, addToast, play]);

  const handleAccept = useCallback(async (friend: FriendEntry) => {
    play('uiSoft');
    const result = await respondToRequest(friend.userId, true);
    if ('ok' in result) {
      addToast(`You and ${friend.displayName} are now friends`, 'success');
    } else {
      addToast(result.error, 'error');
    }
  }, [respondToRequest, addToast, play]);

  const handleReject = useCallback(async (friend: FriendEntry) => {
    play('uiSoft');
    const result = await respondToRequest(friend.userId, false);
    if ('ok' in result) {
      addToast('Request declined');
    } else {
      addToast(result.error, 'error');
    }
  }, [respondToRequest, addToast, play]);

  const handleRemove = useCallback(async (friend: FriendEntry) => {
    play('uiSoft');
    const result = await removeFriend(friend.userId);
    if ('ok' in result) {
      addToast(`Removed ${friend.displayName}`);
    } else {
      addToast(result.error, 'error');
    }
  }, [removeFriend, addToast, play]);

  const handleInvite = useCallback(async (friend: FriendEntry) => {
    play('uiSoft');
    // Create a room and invite the friend
    // For now, copy invite link to clipboard
    const roomCode = new URLSearchParams(window.location.search).get('room');
    if (!roomCode) {
      // No active room — navigate to create one
      addToast('Create a room first, then invite from the lobby', 'info');
      navigate('/');
      return;
    }
    const result = await inviteFriend(friend.userId, roomCode);
    if ('ok' in result) {
      addToast(`Invite sent to ${friend.displayName}`, 'success');
    } else {
      addToast(result.error, 'error');
    }
  }, [inviteFriend, addToast, play, navigate]);

  if (!user) {
    return (
      <div className="felt-bg text-[#e8e0d4] items-center justify-center p-4">
        <div className="text-center space-y-4 animate-fade-in">
          <h1 className="text-2xl font-bold text-[var(--gold)]">Friends</h1>
          <p className="text-[var(--gold-dim)]">Log in to add friends and see who's online.</p>
          <Link to="/login" className="btn-gold px-6 py-2 inline-block">Log In</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="felt-bg text-[#e8e0d4]">
      <div className="w-full max-w-lg mx-auto px-4 py-6 space-y-4 animate-fade-in layout-main">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => { play('uiSoft'); navigate('/', { state: { mode: 'online' } }); }} className="text-[var(--gold-dim)] hover:text-[var(--gold)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-[var(--gold)]">Friends</h1>
          </div>
          <button onClick={() => { play('uiSoft'); refresh(); setSpinning(true); spinKeyRef.current += 1; }} className="text-[var(--gold-dim)] hover:text-[var(--gold)] p-1" title="Refresh">
            <svg key={spinKeyRef.current} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={spinning ? 'animate-spin-once' : ''} onAnimationEnd={() => setSpinning(false)}>
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[var(--felt-light)] rounded-lg p-1">
          {(['friends', 'requests', 'add'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { play('uiSoft'); setTab(t); }}
              className={`flex-1 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors relative ${
                tab === t
                  ? 'bg-[var(--gold)] text-[var(--felt-dark)]'
                  : 'text-[var(--gold-dim)] hover:text-[var(--gold)]'
              }`}
            >
              {t === 'friends' ? `Friends (${acceptedFriends.length})` :
               t === 'requests' ? 'Requests' : 'Add Friend'}
              {t === 'requests' && incomingCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--danger)] text-white text-[9px] flex items-center justify-center font-bold">
                  {incomingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'friends' && (
          <div className="space-y-2">
            {acceptedFriends.length === 0 ? (
              <div className="text-center py-8 text-[var(--gold-dim)]">
                <p className="text-sm">No friends yet.</p>
                <button onClick={() => { play('uiSoft'); setTab('add'); }} className="text-[var(--gold)] text-sm mt-2 hover:underline">
                  Add your first friend
                </button>
              </div>
            ) : (
              <>
                {/* Online friends first */}
                {acceptedFriends
                  .sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0))
                  .map((friend) => (
                    <FriendCard
                      key={friend.userId}
                      friend={friend}
                      onRemove={() => handleRemove(friend)}
                      onInvite={() => handleInvite(friend)}
                    />
                  ))}
              </>
            )}
          </div>
        )}

        {tab === 'requests' && (
          <div className="space-y-4">
            {/* Incoming */}
            {incomingRequests.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2 px-1">
                  Incoming ({incomingRequests.length})
                </p>
                <div className="space-y-2">
                  {incomingRequests.map((friend) => (
                    <FriendCard
                      key={friend.userId}
                      friend={friend}
                      onAccept={() => handleAccept(friend)}
                      onReject={() => handleReject(friend)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Outgoing */}
            {outgoingRequests.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2 px-1">
                  Sent ({outgoingRequests.length})
                </p>
                <div className="space-y-2">
                  {outgoingRequests.map((friend) => (
                    <FriendCard
                      key={friend.userId}
                      friend={friend}
                      onRemove={() => handleRemove(friend)}
                    />
                  ))}
                </div>
              </div>
            )}

            {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
              <div className="text-center py-8 text-[var(--gold-dim)]">
                <p className="text-sm">No pending requests.</p>
              </div>
            )}
          </div>
        )}

        {tab === 'add' && (
          <div className="space-y-4">
            <div className="glass p-4 space-y-3">
              <p className="text-sm text-[var(--gold-dim)]">
                Enter a username to send a friend request.
              </p>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); handleSendRequest(); }} autoComplete="off">
                <input
                  type="search"
                  name="friend_search_username"
                  value={addUsername}
                  onChange={(e) => setAddUsername(e.target.value)}
                  placeholder="Username"
                  className="flex-1 px-3 py-2.5 rounded-lg bg-[var(--felt-dark)] border border-[var(--gold-glow)] text-[var(--gold)] placeholder-[var(--gold-dim)] text-sm focus:outline-none focus:border-[var(--gold)] min-h-[44px] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                  maxLength={30}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={sending || !addUsername.trim()}
                  className="btn-gold px-4 py-2.5 text-sm min-h-[44px] whitespace-nowrap"
                >
                  {sending ? 'Sending...' : 'Add Friend'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default FriendsPage;
