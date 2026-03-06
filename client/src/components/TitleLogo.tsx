interface TitleLogoProps {
  size: 'large' | 'small';
  onClick?: () => void;
}

export function TitleLogo({ size, onClick }: TitleLogoProps) {
  const sizeClass = size === 'large' ? 'title-logo-large' : 'title-logo-small';

  return (
    <button
      onClick={onClick}
      className={`title-logo cursor-pointer bg-transparent border-none p-0 min-h-[44px] relative z-10 transition-transform active:scale-95 ${sizeClass}`}
    >
      <img
        src="/bullem-text-transparent.png"
        alt="Bull 'Em"
        className="title-logo-img"
        draggable={false}
      />
    </button>
  );
}
