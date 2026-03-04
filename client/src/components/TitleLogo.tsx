interface TitleLogoProps {
  size: 'large' | 'small';
  onClick?: () => void;
}

export function TitleLogo({ size, onClick }: TitleLogoProps) {
  const isLarge = size === 'large';

  return (
    <button
      onClick={onClick}
      className={`title-logo cursor-pointer bg-transparent border-none p-0 min-h-[44px] relative z-10 transition-transform active:scale-95 ${isLarge ? 'title-logo-large' : 'title-logo-small'}`}
    >
      <span className="title-logo-text" aria-label="Bull 'Em">
        Bull &rsquo;Em
      </span>
    </button>
  );
}
