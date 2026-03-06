import { useState, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useToast } from '../context/ToastContext.js';

interface RoomQRCodeProps {
  roomCode: string;
}

/**
 * Displays a QR code for the room invite link.
 * Togglable via a button — hidden by default to save vertical space on mobile.
 * Supports sharing the QR code image via Web Share API or downloading it.
 */
export function RoomQRCode({ roomCode }: RoomQRCodeProps) {
  const [visible, setVisible] = useState(false);
  const { addToast } = useToast();
  const svgContainerRef = useRef<HTMLDivElement>(null);

  const inviteUrl = `${window.location.origin}/room/${roomCode}`;

  const handleShareQR = useCallback(async () => {
    if (!svgContainerRef.current) return;

    const svgElement = svgContainerRef.current.querySelector('svg');
    if (!svgElement) return;

    // Convert SVG to canvas, then to blob for sharing/downloading
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const canvas = document.createElement('canvas');
    const size = 512;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        // Draw with white background for better scanning
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!blob) return;

    // Try native share with image (mobile)
    if (navigator.share) {
      try {
        const file = new File([blob], `bull-em-room-${roomCode}.png`, { type: 'image/png' });
        await navigator.share({
          title: 'Join my Bull \'Em game!',
          text: `Scan this QR code to join room ${roomCode}`,
          files: [file],
        });
        return;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        // Fall through to download
      }
    }

    // Fallback: download the image
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `bull-em-room-${roomCode}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
    addToast('QR code downloaded!', 'success');
  }, [roomCode, addToast]);

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={() => setVisible(v => !v)}
        className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-xs transition-colors flex items-center gap-1.5 min-h-[44px]"
      >
        <QRIcon />
        <span>{visible ? 'Hide QR Code' : 'Show QR Code'}</span>
      </button>

      {visible && (
        <div className="animate-fade-in flex flex-col items-center gap-2">
          <div
            ref={svgContainerRef}
            className="bg-white p-3 rounded-lg"
          >
            <QRCodeSVG
              value={inviteUrl}
              size={180}
              level="M"
              marginSize={1}
            />
          </div>
          <p className="text-[10px] text-[var(--gold-dim)]">
            Scan to join room <strong className="text-[var(--gold)]">{roomCode}</strong>
          </p>
          <button
            onClick={handleShareQR}
            className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-xs transition-colors flex items-center gap-1.5 min-h-[44px]"
          >
            <ShareQRIcon />
            <span>Share QR Image</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** QR code icon — inline SVG */
function QRIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="6" height="6" rx="1" fillOpacity="0" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2" y="2" width="2" height="2" />
      <rect x="8" y="0" width="6" height="6" rx="1" fillOpacity="0" stroke="currentColor" strokeWidth="1.2" />
      <rect x="10" y="2" width="2" height="2" />
      <rect x="0" y="8" width="6" height="6" rx="1" fillOpacity="0" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2" y="10" width="2" height="2" />
      <rect x="8" y="8" width="2" height="2" />
      <rect x="12" y="8" width="2" height="2" />
      <rect x="8" y="12" width="2" height="2" />
      <rect x="12" y="12" width="2" height="2" />
    </svg>
  );
}

/** Share/download icon for QR */
function ShareQRIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 10V2" />
      <path d="M5 4l3-3 3 3" />
      <path d="M13 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8" />
    </svg>
  );
}
